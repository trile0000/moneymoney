// Xuất/nhập CSV & sao lưu/khôi phục JSON (sửa lỗi #5, #25)

import { toCSV, parseCSV } from '../utils/csv.js';
import { toLocalYMD, isValidYMD } from '../utils/date.js';
import { parseAmount } from '../utils/money.js';
import { migrate, SCHEMA_VERSION } from '../migrate.js';

export const CSV_HEADER = ['date', 'type', 'amount', 'category', 'note', 'account', 'toAccount', 'tags', 'id', 'createdAt', 'source'];

/**
 * @param {Array} list giao dịch
 * @param {object} ctx { accountName(id) → string, categoryPath(id) → string } (tùy chọn)
 */
export function transactionsToCSV(list, ctx = {}) {
  const accName = ctx.accountName || (() => '');
  const catPath = ctx.categoryPath || ((id, t) => t.category || '');
  const rows = [CSV_HEADER, ...list.map((t) => [
    t.date,
    t.type,
    t.amount,
    t.type === 'transfer' ? '' : catPath(t.categoryId, t),
    t.note || '',
    accName(t.accountId),
    t.type === 'transfer' ? accName(t.toAccountId) : '',
    (t.tags || []).join(' '),
    t.id,
    new Date(t.createdAt).toISOString(),
    t.source || 'manual',
  ])];
  return toCSV(rows);
}

export function backupToJSON(data, settings) {
  const { transactions, ...rest } = data;
  return JSON.stringify({
    app: 'moneymoney',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ...rest,
    transactions: transactions.filter((t) => !t.deletedAt),
    settings,
  }, null, 2);
}

export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Nhập CSV ----------
const HEADER_ALIASES = {
  date: ['date', 'ngày', 'ngay', 'ngày giao dịch', 'transaction date', 'thời gian', 'thoi gian'],
  type: ['type', 'loại', 'loai', 'kind'],
  amount: ['amount', 'số tiền', 'so tien', 'sotien', 'tiền', 'value', 'money'],
  category: ['category', 'danh mục', 'danh muc', 'danhmuc', 'nhóm', 'nhom'],
  note: ['note', 'ghi chú', 'ghi chu', 'ghichu', 'mô tả', 'mo ta', 'description', 'memo', 'nội dung', 'noi dung'],
  id: ['id', 'mã', 'ma'],
  createdAt: ['createdat', 'created_at', 'created', 'timestamp'],
  source: ['source', 'nguồn', 'nguon'],
  periodKey: ['periodkey', 'period'],
  account: ['account', 'ví', 'vi', 'tài khoản', 'tai khoan', 'wallet'],
  toAccount: ['toaccount', 'to_account', 'ví đích', 'đến ví'],
  tags: ['tags', 'tag', 'nhãn', 'nhan'],
};

function norm(s) { return String(s || '').trim().toLowerCase().replace(/^\uFEFF/, ''); }

/** Đoán ánh xạ cột từ dòng tiêu đề → { field: colIndex } */
export function guessColumnMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const n = norm(h);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] === undefined && aliases.includes(n)) { map[field] = i; break; }
    }
  });
  return map;
}

function parseType(v) {
  const s = norm(v);
  if (['income', 'thu', 'in', '+', 'credit', 'thu nhập', 'thu nhap'].includes(s)) return 'income';
  if (['expense', 'chi', 'out', '-', 'debit', 'chi tiêu', 'chi tieu'].includes(s)) return 'expense';
  if (['transfer', 'chuyển khoản', 'chuyen khoan', 'chuyển', 'chuyen'].includes(s)) return 'transfer';
  return null;
}

function parseDateCell(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (isValidYMD(s.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    // 'YYYY-MM-DD' hoặc ISO có giờ → nếu ISO có Z/offset thì convert về local
    if (s.length > 10) { const d = new Date(s); if (!isNaN(d)) return toLocalYMD(d); }
    return s.slice(0, 10);
  }
  // dd/MM/yyyy hoặc dd-MM-yyyy
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) {
    const ymd = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isValidYMD(ymd) ? ymd : null;
  }
  // epoch ms
  if (/^\d{12,13}$/.test(s)) return toLocalYMD(Number(s));
  const d = new Date(s);
  return isNaN(d) ? null : toLocalYMD(d);
}

/**
 * parseTransactionsCSV(text) → { items, errors, header, map, total }
 * items: giao dịch ứng viên (chưa lọc trùng)
 */
export function parseTransactionsCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { items: [], errors: ['File không có dữ liệu'], header: rows[0] || [], map: {}, total: 0 };
  const header = rows[0];
  const map = guessColumnMap(header);
  const errors = [];
  if (map.amount === undefined) errors.push('Không tìm thấy cột số tiền (amount / Số tiền)');
  if (map.date === undefined && map.createdAt === undefined) errors.push('Không tìm thấy cột ngày (date / Ngày / createdAt)');
  if (errors.length) return { items: [], errors, header, map, total: rows.length - 1 };

  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (f) => (map[f] === undefined ? '' : row[map[f]] ?? '');
    const amountRaw = get('amount');
    let amountNum = Number(String(amountRaw).replace(/[^\d.-]/g, ''));
    let type = parseType(get('type'));
    if (!type) type = amountNum < 0 ? 'expense' : 'income';
    // ưu tiên parser hiểu gõ tắt nếu chuỗi có chữ
    const pa = parseAmount(String(amountRaw).replace(/^-/, ''));
    const amount = pa.value !== null ? pa.value : Math.abs(amountNum);
    if (!amount || !Number.isFinite(amount)) { errors.push(`Dòng ${r + 1}: số tiền không hợp lệ (${amountRaw})`); continue; }
    let date = parseDateCell(get('date')) || parseDateCell(get('createdAt'));
    if (!date) { errors.push(`Dòng ${r + 1}: ngày không hợp lệ`); continue; }
    let createdAt = Number(new Date(get('createdAt')));
    if (!Number.isFinite(createdAt) || createdAt <= 0) createdAt = undefined;
    const item = {
      id: get('id') || undefined,
      type,
      amount,
      category: get('category') || 'Khác',
      note: get('note') || '',
      date,
      createdAt,
      source: get('source') || 'import',
      accountName: get('account') || '',
      toAccountName: get('toAccount') || '',
      tags: String(get('tags') || '').split(/[\s,;#]+/).map((x) => x.trim()).filter(Boolean),
    };
    const pk = get('periodKey');
    if (pk) item.periodKey = pk;
    items.push(item);
  }
  return { items, errors, header, map, total: rows.length - 1 };
}

/** Vân tay để khử trùng lặp khi import */
export function fingerprint(t) {
  return [t.date, t.type, t.amount, norm(t.category), norm(t.note)].join('|');
}

/** Lọc trùng so với danh sách hiện có (theo id hoặc vân tay). Trả { fresh, dupes } */
export function dedupeAgainst(items, existing) {
  const ids = new Set(existing.map((t) => t.id));
  const fps = new Set(existing.map(fingerprint));
  const fresh = [];
  let dupes = 0;
  const seenIds = new Set();
  for (const it of items) {
    const fp = fingerprint(it);
    // Trùng nếu: id đã có trong app / id lặp trong file / vân tay trùng với giao dịch đã có.
    // Hai dòng giống hệt nhau TRONG CÙNG file vẫn được giữ (có thể là 2 khoản thật, VD 2 ly cà phê).
    if ((it.id && (ids.has(it.id) || seenIds.has(it.id))) || fps.has(fp)) { dupes++; continue; }
    if (it.id) seenIds.add(it.id);
    fresh.push(it);
  }
  return { fresh, dupes };
}

/** Đọc file JSON backup (v1 mảng / v2 / v3) → { data (v3 đầy đủ), transactions, settings|null, meta } hoặc ném lỗi */
export function parseBackupJSON(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('File JSON không hợp lệ'); }
  let raw;
  if (Array.isArray(obj)) raw = obj; // v1 thuần
  else if (obj && Array.isArray(obj.transactions)) raw = obj;
  else throw new Error('Không tìm thấy danh sách giao dịch trong file');
  const hasSettings = obj && obj.settings && typeof obj.settings === 'object';
  const { data, settings } = migrate(raw, { settings: hasSettings ? obj.settings : undefined });
  return { data, transactions: data.transactions, settings: hasSettings ? settings : null, meta: data.meta || {} };
}
