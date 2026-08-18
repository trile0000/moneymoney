// Tầng lưu trữ: localStorage (đọc nhanh, đồng bộ) + IndexedDB (bền, dung lượng lớn).
// Sửa lỗi #3: bọc try/catch quota; khi localStorage đầy → vẫn ghi IndexedDB, cảnh báo người dùng.
// Sửa lỗi #18: chỉ ghi khi dữ liệu thực sự đổi (so sánh chuỗi JSON).
// Không xóa key v1 cũ — giữ nguyên làm phao cứu sinh (yêu cầu: không mất dữ liệu người dùng).

import { migrate, emptyData, SCHEMA_VERSION, migrateSettings } from './migrate.js';
import { isEnvelope, sealData, openData, unwrapDataKey, createEnvelopeMeta, rewrapWithPin, rewrapWithNewRecovery, cryptoAvailable } from './features/crypto.js';

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
const IDB_BLOBS = 'blobs'; // P1d: ảnh hóa đơn (id → Blob)
const IDB_VERSION = 2;

let lastDataJSON = null;
let lastSettingsJSON = null;
// P1d-2: mã hóa — khóa dữ liệu & meta bọc khóa đang dùng (null = lưu dạng thường)
let encKey = null;
let encMeta = null;
export const encryptionEnabled = () => !!encKey;
export const encryptionSupported = () => cryptoAvailable();
const listeners = new Set();
export function onStorageEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(ev) { for (const fn of listeners) { try { fn(ev); } catch (e) { console.error(e); } } }

// ---------- IndexedDB ----------
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try { req = indexedDB.open(IDB_NAME, IDB_VERSION); } catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      if (!db.objectStoreNames.contains(IDB_BLOBS)) db.createObjectStore(IDB_BLOBS);
    };
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

// ---------- Blob (ảnh hóa đơn) ----------
function blobTx(mode, fn) {
  return idbOpen().then((db) => {
    if (!db || !db.objectStoreNames.contains(IDB_BLOBS)) return undefined;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_BLOBS, mode);
        const store = tx.objectStore(IDB_BLOBS);
        const r = fn(store);
        if (mode === 'readonly') { r.onsuccess = () => resolve(r.result); r.onerror = () => resolve(undefined); }
        else { tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false); }
      } catch { resolve(undefined); }
    });
  });
}
export const blobGet = (id) => blobTx('readonly', (st) => st.get(id));
export const blobPut = (id, blob) => blobTx('readwrite', (st) => st.put(blob, id));
export const blobDelete = (id) => blobTx('readwrite', (st) => st.delete(id));
export const blobKeys = () => blobTx('readonly', (st) => st.getAllKeys()).then((k) => k || []);
export const blobClear = () => blobTx('readwrite', (st) => st.clear());
/** Tổng dung lượng ảnh (byte) — duyệt tất cả */
export async function blobUsage() {
  const all = await blobTx('readonly', (st) => st.getAll());
  return { count: (all || []).length, bytes: (all || []).reduce((a, b) => a + (b && b.size ? b.size : 0), 0) };
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
  if (idbRaw && typeof idbRaw === 'object' && (Array.isArray(idbRaw.transactions) || isEnvelope(idbRaw))) {
    const lsSavedAt = dataRaw && !Array.isArray(dataRaw) ? Number(dataRaw.savedAt) || 0 : 0;
    const idbSavedAt = Number(idbRaw.savedAt) || 0;
    const anyEnc = isEnvelope(idbRaw) || isEnvelope(dataRaw);
    const lsCount = Array.isArray(dataRaw) ? dataRaw.length : dataRaw ? (dataRaw.transactions || []).length : 0;
    const idbCount = isEnvelope(idbRaw) ? Infinity : idbRaw.transactions.length;
    if (dataRaw === undefined || (idbSavedAt > lsSavedAt && (anyEnc || idbCount >= lsCount))) {
      dataRaw = idbRaw;
      source = 'indexedDB';
      migrated = false;
    }
  }

  // 3) Dữ liệu đang mã hóa → cần PIN trước khi đi tiếp
  if (isEnvelope(dataRaw)) {
    return { locked: true, envelope: dataRaw, settings: migrateSettings(settingsRaw), settingsRaw, source, now };
  }
  return finishLoad({ dataRaw, settingsRaw, migrated, source, now });
}

/** Mở khóa envelope bằng PIN hoặc mã khôi phục rồi tải như bình thường. Trả về null nếu sai. */
export async function unlockAndLoad(locked, { pin, recovery } = {}) {
  const key = await unwrapDataKey(locked.envelope.meta, { pin, recovery });
  if (!key) return null;
  let dataRaw;
  try { dataRaw = await openData(key, locked.envelope); } catch { return null; }
  encKey = key; encMeta = locked.envelope.meta;
  return finishLoad({ dataRaw, settingsRaw: locked.settingsRaw, migrated: false, source: locked.source, now: locked.now || Date.now() });
}

async function finishLoad({ dataRaw, settingsRaw, migrated, source, now }) {
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
  return { data, settings, migrated, fromVersion, source, encrypted: !!encKey };
}

// ---------- Mã hóa: bật / tắt / đổi PIN ----------
/** Bật mã hóa với PIN: mã hóa & lưu lại ngay; xóa bản sao dữ liệu cũ dạng thường (v1/v2). Trả về { recoveryCode }. */
export async function enableEncryption(data, pin) {
  const { meta, dataKey, recoveryCode } = await createEnvelopeMeta(pin);
  encKey = dataKey; encMeta = meta;
  const r = await saveData(data, { force: true });
  if (!r.ok) { encKey = null; encMeta = null; throw new Error('save-failed'); }
  for (const k of [KEYS.V1_TX, KEYS.V2_DATA]) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  return { recoveryCode };
}
/** Tắt mã hóa (yêu cầu PIN đúng): lưu lại dạng thường */
export async function disableEncryption(data, pin) {
  if (!encMeta || !(await unwrapDataKey(encMeta, { pin }))) return false;
  encKey = null; encMeta = null;
  await saveData(data, { force: true });
  return true;
}
export async function verifyPin(pin) { return !!(encMeta && (await unwrapDataKey(encMeta, { pin }))); }
export async function verifySecret(secret) { return !!(encMeta && (await unwrapDataKey(encMeta, secret || {}))); }
export async function changePin(data, oldPin, newPin) {
  if (!(await verifyPin(oldPin))) return false;
  encMeta = await rewrapWithPin(encMeta, encKey, newPin);
  await saveData(data, { force: true });
  return true;
}
export async function regenerateRecovery(data, pin) {
  if (!(await verifyPin(pin))) return null;
  const r = await rewrapWithNewRecovery(encMeta, encKey);
  encMeta = r.meta;
  await saveData(data, { force: true });
  return r.recoveryCode;
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
  let stored = json, storedObj = null;
  if (encKey) { storedObj = await sealData(encKey, encMeta, JSON.parse(json), { now }); stored = JSON.stringify(storedObj); }
  const r = lsSet(DATA_KEY, stored);
  const idb = await idbSet(DATA_KEY, storedObj || JSON.parse(json));
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
