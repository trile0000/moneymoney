// Tầng lưu trữ: localStorage (đọc nhanh, đồng bộ) + IndexedDB (bền, dung lượng lớn).
// Sửa lỗi #3: bọc try/catch quota; khi localStorage đầy → vẫn ghi IndexedDB, cảnh báo người dùng.
// Sửa lỗi #18: chỉ ghi khi dữ liệu thực sự đổi (so sánh chuỗi JSON).
// Không xóa key v1 cũ — giữ nguyên làm phao cứu sinh (yêu cầu: không mất dữ liệu người dùng).

import { migrate, migrateSettings, emptyData, SCHEMA_VERSION } from './migrate.js';

export const KEYS = {
  V1_TX: 'mm_transactions_v1',
  V1_SETTINGS: 'mm_settings_v1',
  V2_DATA: 'mm_data_v2',
  V2_SETTINGS: 'mm_settings_v2',
  V1_MIGRATED_AT: 'mm_migrated_v1_at',
};

const IDB_NAME = 'moneymoney';
const IDB_STORE = 'kv';

let lastDataJSON = null;
let lastSettingsJSON = null;
const listeners = new Set();
export function onStorageEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(ev) { for (const fn of listeners) { try { fn(ev); } catch (e) { console.error(e); } } }

// ---------- IndexedDB ----------
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { return resolve(null); }
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const r = tx.objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch { resolve(false); }
  });
}

// ---------- localStorage an toàn ----------
function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsParse(key) {
  const s = lsGet(key);
  if (s === null || s === undefined) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}
function isQuotaError(e) {
  return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}
/** Trả về { ok, quota } */
function lsSet(key, str) {
  try {
    localStorage.setItem(key, str);
    return { ok: true, quota: false };
  } catch (e) {
    return { ok: false, quota: isQuotaError(e), error: e };
  }
}

// ---------- API ----------

/**
 * loadAll(): đọc dữ liệu + cài đặt, tự migrate v1 → v2, đối chiếu IndexedDB.
 * Trả về { data, settings, migrated, source }
 */
export async function loadAll({ now = Date.now() } = {}) {
  let migrated = false;
  let source = 'localStorage';

  // 1) Cài đặt
  let settingsRaw = lsParse(KEYS.V2_SETTINGS);
  if (settingsRaw === undefined) {
    settingsRaw = lsParse(KEYS.V1_SETTINGS);
    if (settingsRaw !== undefined) migrated = true;
  }
  const settings = migrateSettings(settingsRaw);

  // 2) Dữ liệu giao dịch
  let dataRaw = lsParse(KEYS.V2_DATA);
  if (dataRaw === undefined) {
    const v1 = lsParse(KEYS.V1_TX);
    if (Array.isArray(v1)) { dataRaw = v1; migrated = true; }
  }
  // Đối chiếu với IndexedDB (nếu localStorage bị xóa/hỏng nhưng IDB còn)
  let idbRaw;
  try { idbRaw = await idbGet(KEYS.V2_DATA); } catch { idbRaw = undefined; }
  if (idbRaw && typeof idbRaw === 'object' && Array.isArray(idbRaw.transactions)) {
    const lsSavedAt = dataRaw && !Array.isArray(dataRaw) ? Number(dataRaw.savedAt) || 0 : 0;
    const idbSavedAt = Number(idbRaw.savedAt) || 0;
    const lsCount = Array.isArray(dataRaw) ? dataRaw.length : dataRaw ? (dataRaw.transactions || []).length : 0;
    if (dataRaw === undefined || (idbSavedAt > lsSavedAt && idbRaw.transactions.length >= lsCount)) {
      dataRaw = idbRaw;
      source = 'indexedDB';
    }
  }
  const idbSettings = await idbGet(KEYS.V2_SETTINGS).catch(() => undefined);
  let finalSettings = settings;
  if (settingsRaw === undefined && idbSettings) finalSettings = migrateSettings(idbSettings);

  const { data, changed } = migrate(dataRaw === undefined ? emptyData() : dataRaw, { now });
  // Dọn các giao dịch đã soft-delete quá hạn (Undo chỉ có hiệu lực trong phiên)
  data.transactions = data.transactions.filter((t) => !t.deletedAt);

  lastDataJSON = null; // buộc ghi lần đầu nếu có migrate
  lastSettingsJSON = null;
  if (migrated || changed || source === 'indexedDB') {
    await saveData(data, { force: true });
    await saveSettings(finalSettings, { force: true });
    if (migrated) lsSet(KEYS.V1_MIGRATED_AT, String(now));
  } else {
    lastDataJSON = JSON.stringify(data);
    lastSettingsJSON = JSON.stringify(finalSettings);
  }
  return { data, settings: finalSettings, migrated, source };
}

/**
 * saveData(data): ghi nếu có thay đổi. Trả về { ok, quota, idb }
 * - localStorage lỗi quota → vẫn ghi IndexedDB, phát sự kiện 'quota' để UI cảnh báo.
 */
export async function saveData(data, { force = false, now = Date.now() } = {}) {
  data.schemaVersion = SCHEMA_VERSION;
  data.savedAt = now;
  const json = JSON.stringify(data);
  if (!force && json === lastDataJSON) return { ok: true, skipped: true };
  const r = lsSet(KEYS.V2_DATA, json);
  const idb = await idbSet(KEYS.V2_DATA, JSON.parse(json));
  if (r.ok || idb) lastDataJSON = json;
  if (!r.ok) {
    emit({ type: r.quota ? 'quota' : 'error', idb, error: r.error });
  }
  return { ok: r.ok || idb, ls: r.ok, quota: r.quota, idb };
}

export async function saveSettings(settings, { force = false } = {}) {
  settings.schemaVersion = SCHEMA_VERSION;
  const json = JSON.stringify(settings);
  if (!force && json === lastSettingsJSON) return { ok: true, skipped: true };
  const r = lsSet(KEYS.V2_SETTINGS, json);
  const idb = await idbSet(KEYS.V2_SETTINGS, JSON.parse(json));
  if (r.ok || idb) lastSettingsJSON = json;
  if (!r.ok) emit({ type: r.quota ? 'quota' : 'error', idb, error: r.error });
  return { ok: r.ok || idb, ls: r.ok, quota: r.quota, idb };
}

/** Ước lượng dung lượng đang dùng (bytes) */
export function estimateUsage() {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      total += (k.length + (localStorage.getItem(k) || '').length) * 2;
    }
  } catch { /* ignore */ }
  return total;
}
