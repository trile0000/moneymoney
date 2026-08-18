// Khóa PIN + mã hóa dữ liệu (P1d-2) — WebCrypto, thuần túy (chạy được trong Node ≥ 20 để test).
// Mô hình:
//   - dataKey: khóa AES-GCM-256 ngẫu nhiên, dùng mã hóa toàn bộ JSON dữ liệu.
//   - dataKey được BỌC (wrap) hai lần: bằng khóa dẫn xuất từ PIN (PBKDF2-SHA256) và bằng khóa dẫn xuất từ MÃ KHÔI PHỤC.
//   - Envelope lưu trong localStorage/IDB: { enc: 1, v, meta: { salt, saltR, iter, wrapPin, wrapRec }, iv, ct, savedAt, schemaVersion }
//   - Sai PIN → unwrap thất bại (AES-GCM xác thực) → không lộ gì. Không có "reset PIN" ngoài mã khôi phục — người dùng phải sao lưu.
const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;
export const ENVELOPE_VERSION = 1;
export const PBKDF2_ITER = 210000;

export function cryptoAvailable() { return !!subtle() && typeof globalThis.crypto.getRandomValues === 'function'; }

const te = new TextEncoder(), td = new TextDecoder();
export function toB64(bytes) { let s = ''; const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
export function fromB64(s) { const bin = atob(String(s || '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** Khóa bọc từ bí mật (PIN hoặc mã khôi phục) */
export async function deriveWrappingKey(secret, salt, iter = PBKDF2_ITER) {
  const base = await subtle().importKey('raw', te.encode(String(secret)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function generateDataKey() { return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ 0/O/1/I
/** Mã khôi phục 20 ký tự (100 bit) dạng XXXX-XXXX-XXXX-XXXX-XXXX */
export function generateRecoveryCode() {
  const b = rand(20);
  let s = '';
  for (let i = 0; i < 20; i++) { s += ALPHABET[b[i] % 32]; if (i % 4 === 3 && i < 19) s += '-'; }
  return s;
}
export function normalizeRecovery(code) { return String(code || '').toUpperCase().replace(/[^A-Z2-9]/g, ''); }
export function normalizePin(pin) { return String(pin || '').replace(/\D/g, ''); }
export function validPin(pin) { const p = normalizePin(pin); return p.length >= 4 && p.length <= 8; }

async function wrapKey(dataKey, wrappingKey) {
  const raw = new Uint8Array(await subtle().exportKey('raw', dataKey));
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, wrappingKey, raw));
  return { iv: toB64(iv), ct: toB64(ct) };
}
async function unwrapKey(wrapped, wrappingKey) {
  try {
    const raw = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(wrapped.iv) }, wrappingKey, fromB64(wrapped.ct));
    return subtle().importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  } catch { return null; }
}

/** Tạo meta mới (bật mã hóa): trả về { meta, dataKey, recoveryCode } */
export async function createEnvelopeMeta(pin, recoveryCode = generateRecoveryCode(), iter = PBKDF2_ITER) {
  const dataKey = await generateDataKey();
  const salt = rand(16), saltR = rand(16);
  const kPin = await deriveWrappingKey(normalizePin(pin), salt, iter);
  const kRec = await deriveWrappingKey(normalizeRecovery(recoveryCode), saltR, iter);
  const meta = { v: ENVELOPE_VERSION, iter, salt: toB64(salt), saltR: toB64(saltR), wrapPin: await wrapKey(dataKey, kPin), wrapRec: await wrapKey(dataKey, kRec) };
  return { meta, dataKey, recoveryCode };
}

/** Mở khóa dataKey bằng PIN hoặc mã khôi phục → CryptoKey | null */
export async function unwrapDataKey(meta, { pin, recovery } = {}) {
  if (!meta || !meta.wrapPin) return null;
  if (pin !== undefined && pin !== null) {
    const k = await deriveWrappingKey(normalizePin(pin), fromB64(meta.salt), meta.iter || PBKDF2_ITER);
    return unwrapKey(meta.wrapPin, k);
  }
  if (recovery && meta.wrapRec) {
    const k = await deriveWrappingKey(normalizeRecovery(recovery), fromB64(meta.saltR), meta.iter || PBKDF2_ITER);
    return unwrapKey(meta.wrapRec, k);
  }
  return null;
}

/** Đổi PIN: bọc lại dataKey bằng PIN mới (giữ nguyên mã khôi phục) */
export async function rewrapWithPin(meta, dataKey, newPin) {
  const salt = rand(16);
  const kPin = await deriveWrappingKey(normalizePin(newPin), salt, meta.iter || PBKDF2_ITER);
  return { ...meta, salt: toB64(salt), wrapPin: await wrapKey(dataKey, kPin) };
}
/** Tạo mã khôi phục mới (khi người dùng làm mất) — cần đang mở khóa */
export async function rewrapWithNewRecovery(meta, dataKey) {
  const recoveryCode = generateRecoveryCode();
  const saltR = rand(16);
  const kRec = await deriveWrappingKey(normalizeRecovery(recoveryCode), saltR, meta.iter || PBKDF2_ITER);
  return { meta: { ...meta, saltR: toB64(saltR), wrapRec: await wrapKey(dataKey, kRec) }, recoveryCode };
}

export async function encryptJSON(dataKey, obj) {
  const iv = rand(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, dataKey, te.encode(JSON.stringify(obj))));
  return { iv: toB64(iv), ct: toB64(ct) };
}
export async function decryptJSON(dataKey, { iv, ct }) {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, dataKey, fromB64(ct));
  return JSON.parse(td.decode(pt));
}

export function isEnvelope(raw) { return !!(raw && typeof raw === 'object' && raw.enc === 1 && raw.meta && typeof raw.ct === 'string'); }

/** Đóng gói dữ liệu đã mã hóa thành envelope để lưu */
export async function sealData(dataKey, meta, data, { now = Date.now() } = {}) {
  const { iv, ct } = await encryptJSON(dataKey, data);
  return { enc: 1, v: ENVELOPE_VERSION, meta, iv, ct, savedAt: now, schemaVersion: data.schemaVersion || 3 };
}
export async function openData(dataKey, envelope) { return decryptJSON(dataKey, envelope); }
