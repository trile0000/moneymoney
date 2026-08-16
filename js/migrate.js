// Migration schema dữ liệu — thuần túy (không đụng localStorage) để test được.
//
// v1 (mm_transactions_v1): mảng [{ id, type, amount, category, note, createdAt }]
//    - id = Date.now().toString() → có thể trùng
//    - ngày kinh tế = createdAt (ms) → phụ thuộc múi giờ
//    - lương tự động nhận diện bằng note 'Tự động thêm từ hệ thống'
//
// v2 (mm_data_v2): { schemaVersion: 2, transactions: [...], meta: {...}, savedAt }
//    giao dịch: { id(uuid), type, amount, category, note, date('YYYY-MM-DD' local),
//                createdAt(ms), updatedAt?, source('manual'|'auto-salary'|'import'), periodKey?('YYYY-MM'), deletedAt? }

import { uuid } from './utils/id.js';
import { toLocalYMD, ymOf, isValidYMD } from './utils/date.js';

export const SCHEMA_VERSION = 2;
export const LEGACY_SALARY_NOTE = 'Tự động thêm từ hệ thống';

export function emptyData() {
  return { schemaVersion: SCHEMA_VERSION, transactions: [], meta: {}, savedAt: 0 };
}

/** Chuẩn hóa 1 giao dịch (dùng cho cả migrate v1 và import). Trả null nếu không cứu được. */
export function normalizeTransaction(t, { seenIds, now = Date.now(), defaultSource = 'manual' } = {}) {
  if (!t || typeof t !== 'object') return null;
  const type = t.type === 'income' ? 'income' : 'expense';
  const amount = Math.abs(Math.round(Number(t.amount) || 0));
  const category = String(t.category ?? '').trim() || 'Khác';
  const note = String(t.note ?? '').trim();

  // Ngày kinh tế
  let date = typeof t.date === 'string' && isValidYMD(t.date) ? t.date : null;
  let createdAt = Number(t.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) createdAt = now;
  if (!date) date = toLocalYMD(createdAt);

  // ID: giữ nếu là chuỗi hợp lệ và chưa trùng; nếu trùng → cấp UUID mới (sửa lỗi #1)
  let id = typeof t.id === 'string' || typeof t.id === 'number' ? String(t.id) : '';
  if (!id || (seenIds && seenIds.has(id))) id = uuid();
  if (seenIds) seenIds.add(id);

  let source = t.source;
  let periodKey = t.periodKey;
  if (!source) {
    // Nhận diện lương tự động của bản cũ để không sinh trùng (sửa lỗi #7)
    if (type === 'income' && note === LEGACY_SALARY_NOTE) {
      source = 'auto-salary';
      periodKey = periodKey || ymOf(date);
    } else source = defaultSource;
  }
  if (source === 'auto-salary' && !periodKey) periodKey = ymOf(date);

  const out = { id, type, amount, category, note, date, createdAt, source };
  if (periodKey) out.periodKey = periodKey;
  if (Number.isFinite(Number(t.updatedAt))) out.updatedAt = Number(t.updatedAt);
  if (Number.isFinite(Number(t.deletedAt)) && Number(t.deletedAt) > 0) out.deletedAt = Number(t.deletedAt);
  return out;
}

/**
 * migrate(raw) — nhận bất kỳ dữ liệu nào đọc được (v1 mảng, v2 object, hoặc rác) → v2 hợp lệ.
 * Không bao giờ ném lỗi; không bao giờ mất giao dịch có amount hợp lệ.
 */
export function migrate(raw, { now = Date.now() } = {}) {
  const seen = new Set();
  const result = emptyData();
  let list = [];
  let fromVersion = 0;

  if (Array.isArray(raw)) {
    list = raw;
    fromVersion = 1;
  } else if (raw && typeof raw === 'object' && Array.isArray(raw.transactions)) {
    list = raw.transactions;
    fromVersion = Number(raw.schemaVersion) || 2;
    result.meta = raw.meta && typeof raw.meta === 'object' ? { ...raw.meta } : {};
    result.savedAt = Number(raw.savedAt) || 0;
  } else {
    return { data: result, fromVersion: 0, changed: false, stats: { total: 0, dupIdsFixed: 0, dropped: 0 } };
  }

  let dupIdsFixed = 0;
  let dropped = 0;
  for (const t of list) {
    const before = t && (typeof t.id === 'string' || typeof t.id === 'number') ? String(t.id) : '';
    const n = normalizeTransaction(t, { seenIds: seen, now });
    if (!n) { dropped++; continue; }
    if (before && n.id !== before) dupIdsFixed++;
    result.transactions.push(n);
  }
  // Sắp xếp ổn định: ngày giảm dần, rồi createdAt giảm dần
  result.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

  const changed = fromVersion !== SCHEMA_VERSION || dupIdsFixed > 0 || dropped > 0;
  return { data: result, fromVersion, changed, stats: { total: result.transactions.length, dupIdsFixed, dropped } };
}

/** Migration cài đặt: v1 → v2 (thêm trường mới với giá trị mặc định, giữ nguyên trường cũ) */
export function defaultSettings() {
  return {
    schemaVersion: SCHEMA_VERSION,
    salary: 0,
    salaryCategory: 'Lương',
    salaryEnabled: null, // null = suy ra từ salary > 0 (tương thích ngược)
    thresholds: { t2: 5000000, t3: 10000000, t4: 20000000 },
    messages: {
      t0: '😿 Âm ({sign}{amount}). Thử cắt giảm vài khoản không cần thiết nhé!',
      t1: '🙂 Dư nhẹ ({sign}{amount}). Đặt thêm mục tiêu tiết kiệm nhé!',
      t2: '🤑 Dư dả ({sign}{amount})! Tiếp tục tiết kiệm thông minh!',
      t3: '🚀 Siêu khá ({sign}{amount})! Xịn quá, duy trì đà này!',
      t4: '👑 Đại gia ({sign}{amount})! Đặt mục tiêu đầu tư dài hạn nhé!',
    },
    bestTier: 0,
    bestTierMonth: null,
    lastSalaryPeriod: null, // 'YYYY-MM' — kỳ lương gần nhất đã kiểm tra/sinh (sửa lỗi #6)
  };
}

export function migrateSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const out = {
    ...d,
    ...raw,
    thresholds: { ...d.thresholds, ...(raw.thresholds || {}) },
    messages: { ...d.messages, ...(raw.messages || {}) },
    schemaVersion: SCHEMA_VERSION,
  };
  out.salary = Math.max(0, Number(out.salary) || 0);
  out.salaryCategory = String(out.salaryCategory || 'Lương').trim() || 'Lương';
  out.bestTier = Math.max(0, Math.min(4, Number(out.bestTier) || 0));
  const th = out.thresholds;
  th.t2 = Math.max(0, Number(th.t2) || 0);
  th.t3 = Math.max(th.t2, Number(th.t3) || 0);
  th.t4 = Math.max(th.t3, Number(th.t4) || 0);
  return out;
}
