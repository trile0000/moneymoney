// Tầng lưu trữ: localStorage (đọc nhanh, đồng bộ) + IndexedDB (bền, dung lượng lớn).
// Sửa lỗi #3: bọc try/catch quota; khi localStorage đầy → vẫn ghi IndexedDB, cảnh báo người dùng.
// Sửa lỗi #18: chỉ ghi khi dữ liệu thực sự đổi (so sánh chuỗi JSON).
// Không xóa key v1 cũ — giữ nguyên làm phao cứu sinh (yêu cầu: không mất dữ liệu người dùng).

import { migrate, emptyData, SCHEMA_VERSION } from './migrate.js';

export const KEYS = {
  V1_TX: 'mm_transactions_v1',
  V1_SETTINGS: 'mm_settings_v1',
  V2_DATA: 'mm_data_v2',
  V2_SETTINGS: 'mm_settings_v2',
  V3_DATA: 'mm_data_v3',
  V3_SETTINGS: 'mm_settings_v3',
  V1_MIGRATED_AT: 'mm_migrated_v1_at',
  V2_MIGRATED_AT: 'mm_migrated_v2_at',
};
// Key đang dùng (đổi khi lên schema mới)
const DATA_KEY = KEYS.V3_DATA;
const SETTINGS_KEY = KEYS.V3_SETTINGS;

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
 * loadAll(): đọc dữ liệu + cài đặt, tự migrate v1 → v2 → v3, đối chiếu IndexedDB.
 * Trả về { data, settings, migrated, fromVersion, source }
 */
export async function loadAll({ now = Date.now() } = {}) {
  let migrated = false;
  let source = 'localStorage';

  // 1) Cài đặt: v3 → v2 → v1
  let settingsRaw = lsParse(SETTINGS_KEY);
  if (settingsRaw === undefined) settingsRaw = lsParse(KEYS.V2_SETTINGS);
  if (settingsRaw === undefined) settingsRaw = lsParse(KEYS.V1_SETTINGS);
  if (settingsRaw === undefined) {
    const idbS = await idbGet(SETTINGS_KEY).catch(() => undefined);
    if (idbS && typeof idbS === 'object') settingsRaw = idbS;
  }

  // 2) Dữ liệu: v3 → v2 → v1
  let dataRaw = lsParse(DATA_KEY);
  if (dataRaw === undefined) { const v2 = lsParse(KEYS.V2_DATA); if (v2 && typeof v2 === 'object') { dataRaw = v2; migrated = true; } }
  if (dataRaw === undefined) { const v1 = lsParse(KEYS.V1_TX); if (Array.isArray(v1)) { dataRaw = v1; migrated = true; } }
  // Đối chiếu IndexedDB (nếu localStorage bị xóa/hỏng nhưng IDB còn)
  let idbRaw;
  try { idbRaw = await idbGet(DATA_KEY); } catch { idbRaw = undefined; }
  if (idbRaw && typeof idbRaw === 'object' && Array.isArray(idbRaw.transactions)) {
    const lsSavedAt = dataRaw && !Array.isArray(dataRaw) ? Number(dataRaw.savedAt) || 0 : 0;
    const idbSavedAt = Number(idbRaw.savedAt) || 0;
    const lsCount = Array.isArray(dataRaw) ? dataRaw.length : dataRaw ? (dataRaw.transactions || []).length : 0;
    if (dataRaw === undefined || (idbSavedAt > lsSavedAt && idbRaw.transactions.length >= lsCount)) {
      dataRaw = idbRaw;
      source = 'indexedDB';
      migrated = false;
    }
  }

  const { data, settings, changed, fromVersion } = migrate(dataRaw === undefined ? emptyData() : dataRaw, { settings: settingsRaw, now });
  // Dọn các giao dịch đã soft-delete quá hạn (Undo chỉ có hiệu lực trong phiên)
  data.transactions = data.transactions.filter((t) => !t.deletedAt);

  lastDataJSON = null;
  lastSettingsJSON = null;
  if (migrated || changed || source === 'indexedDB' || settingsRaw === undefined) {
    await saveData(data, { force: true });
    await saveSettings(settings, { force: true });
    if (migrated && fromVersion === 1) lsSet(KEYS.V1_MIGRATED_AT, String(now));
    if (migrated && fromVersion === 2) lsSet(KEYS.V2_MIGRATED_AT, String(now));
  } else {
    lastDataJSON = JSON.stringify(data);
    lastSettingsJSON = JSON.stringify(settings);
  }
  return { data, settings, migrated, fromVersion, source };
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
  const r = lsSet(DATA_KEY, json);
  const idb = await idbSet(DATA_KEY, JSON.parse(json));
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
  const r = lsSet(SETTINGS_KEY, json);
  const idb = await idbSet(SETTINGS_KEY, JSON.parse(json));
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
