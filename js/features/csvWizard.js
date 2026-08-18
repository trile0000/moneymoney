// Wizard nhập CSV/XLSX (P1d-2) — phần thuần túy: dò dòng tiêu đề, mẫu ngân hàng VN, ánh xạ cột,
// parse số/ngày linh hoạt, gán danh mục theo từ khóa. Không đụng DOM.
import { isValidYMD, toLocalYMD } from '../utils/date.js';

export const FIELDS = ['date', 'amount', 'debit', 'credit', 'note', 'category', 'type', 'account', 'balance', 'id'];

const ALIASES = {
  date: ['date', 'ngày', 'ngay', 'ngày giao dịch', 'ngay giao dich', 'ngày gd', 'ngay gd', 'transaction date', 'trans date', 'thời gian', 'thoi gian', 'ngày hạch toán', 'ngày hiệu lực', 'value date', 'posting date', 'time', 'datetime', 'created', 'createdat'],
  amount: ['amount', 'số tiền', 'so tien', 'sotien', 'tiền', 'value', 'money', 'số tiền giao dịch', 'so tien giao dich', 'giá trị', 'gia tri', 'phát sinh', 'phat sinh', 'transaction amount'],
  debit: ['debit', 'ghi nợ', 'ghi no', 'số tiền ghi nợ', 'so tien ghi no', 'phát sinh nợ', 'phat sinh no', 'tiền ra', 'tien ra', 'chi', 'withdrawal', 'withdrawals', 'money out', 'out', 'nợ', 'psn', 'ps nợ', 'số tiền rút', 'rút'],
  credit: ['credit', 'ghi có', 'ghi co', 'số tiền ghi có', 'so tien ghi co', 'phát sinh có', 'phat sinh co', 'tiền vào', 'tien vao', 'thu', 'deposit', 'deposits', 'money in', 'in', 'có', 'psc', 'ps có', 'số tiền nạp', 'nạp'],
  note: ['note', 'notes', 'ghi chú', 'ghi chu', 'ghichu', 'mô tả', 'mo ta', 'description', 'memo', 'nội dung', 'noi dung', 'nội dung chi tiết', 'noi dung chi tiet', 'diễn giải', 'dien giai', 'chi tiết giao dịch', 'chi tiet giao dich', 'details', 'transaction details', 'remark', 'remarks', 'narrative', 'nội dung giao dịch', 'dịch vụ', 'dich vu', 'tên giao dịch'],
  category: ['category', 'danh mục', 'danh muc', 'danhmuc', 'nhóm', 'nhom', 'loại chi', 'loai chi', 'hạng mục', 'hang muc'],
  type: ['type', 'loại', 'loai', 'kind', 'loại giao dịch', 'loai giao dich', 'transaction type', 'dr/cr', 'nợ/có', 'no/co'],
  account: ['account', 'ví', 'vi', 'tài khoản', 'tai khoan', 'wallet', 'số tài khoản', 'so tai khoan', 'account name'],
  balance: ['balance', 'số dư', 'so du', 'số dư cuối', 'so du cuoi', 'running balance', 'số dư sau gd', 'closing balance'],
  id: ['id', 'mã', 'ma', 'mã giao dịch', 'ma giao dich', 'số tham chiếu', 'so tham chieu', 'reference', 'ref', 'ref no', 'transaction id', 'mã gd', 'số bút toán', 'so but toan'],
};

/** Mẫu sao kê phổ biến — chỉ là gợi ý ánh xạ (người dùng vẫn chỉnh được). match: từ khóa xuất hiện trong dòng tiêu đề. */
export const BANK_PRESETS = [
  { key: 'auto', name: 'Tự nhận dạng', match: [], map: {} },
  { key: 'vcb', name: 'Vietcombank (VCB Digibank)', match: ['số tiền ghi nợ', 'số tiền ghi có', 'nội dung chi tiết'], map: { date: 'ngày giao dịch', debit: 'số tiền ghi nợ', credit: 'số tiền ghi có', note: 'nội dung chi tiết', id: 'số tham chiếu', balance: 'số dư' }, dateFormat: 'dmy' },
  { key: 'tcb', name: 'Techcombank', match: ['ghi nợ', 'ghi có', 'mô tả'], map: { date: 'ngày giao dịch', debit: 'ghi nợ', credit: 'ghi có', note: 'mô tả', balance: 'số dư' }, dateFormat: 'dmy' },
  { key: 'mb', name: 'MB Bank', match: ['số tiền ghi nợ', 'số tiền ghi có', 'nội dung'], map: { date: 'ngày giao dịch', debit: 'số tiền ghi nợ', credit: 'số tiền ghi có', note: 'nội dung', balance: 'số dư' }, dateFormat: 'dmy' },
  { key: 'bidv', name: 'BIDV', match: ['phát sinh nợ', 'phát sinh có', 'diễn giải'], map: { date: 'ngày gd', debit: 'phát sinh nợ', credit: 'phát sinh có', note: 'diễn giải', balance: 'số dư cuối' }, dateFormat: 'dmy' },
  { key: 'vpb', name: 'VPBank', match: ['số tiền', 'nội dung', 'loại giao dịch'], map: { date: 'ngày giao dịch', amount: 'số tiền', note: 'nội dung', type: 'loại giao dịch' }, dateFormat: 'dmy' },
  { key: 'tpb', name: 'TPBank', match: ['ngày', 'nội dung', 'số tiền', 'số dư'], map: { date: 'ngày', amount: 'số tiền', note: 'nội dung', balance: 'số dư' }, dateFormat: 'dmy' },
  { key: 'acb', name: 'ACB', match: ['ngày hiệu lực', 'ghi nợ', 'ghi có'], map: { date: 'ngày hiệu lực', debit: 'ghi nợ', credit: 'ghi có', note: 'nội dung', balance: 'số dư' }, dateFormat: 'dmy' },
  { key: 'momo', name: 'MoMo', match: ['thời gian', 'mã giao dịch', 'số tiền'], map: { date: 'thời gian', amount: 'số tiền', note: 'dịch vụ', id: 'mã giao dịch', type: 'loại giao dịch' }, dateFormat: 'dmy' },
  { key: 'moneylover', name: 'Money Lover (export)', match: ['note', 'amount', 'category', 'account'], map: { date: 'date', amount: 'amount', note: 'note', category: 'category', account: 'account', id: 'id' }, dateFormat: 'dmy', signedAmount: true },
  { key: 'moneymoney', name: 'Quản Lý Chi Tiêu (CSV của app)', match: ['type', 'amount', 'category', 'date', 'account'], map: { date: 'date', amount: 'amount', type: 'type', note: 'note', category: 'category', account: 'account', id: 'id' }, dateFormat: 'ymd' },
];

export const DATE_FORMATS = ['auto', 'dmy', 'mdy', 'ymd'];

export function norm(s) { return String(s ?? '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, ' '); }
function stripVN(s) { return norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd'); }

/** Ô bất kỳ (string/number/Date) → chuỗi ổn định */
export function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isNaN(v) ? '' : toLocalYMD(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v);
}

/** Đếm số ô "giống tiêu đề" (chữ, không phải số/ngày) trong một dòng */
function headerScore(row) {
  let score = 0, filled = 0;
  for (const c of row) {
    const s = norm(cellText(c));
    if (!s) continue;
    filled++;
    if (/^[\d.,\-\s/:]+$/.test(s)) { score -= 1; continue; } // số / ngày
    for (const aliases of Object.values(ALIASES)) if (aliases.includes(s) || aliases.includes(stripVN(s))) { score += 3; break; }
    if (/^[\p{L} /()._-]+$/u.test(s)) score += 1;
  }
  return filled >= 2 ? score : -99;
}

/** Tìm dòng tiêu đề trong tối đa 30 dòng đầu (sao kê ngân hàng thường có vài dòng thông tin trước bảng) */
export function detectHeaderRow(rows, maxScan = 30) {
  let best = 0, bestScore = -Infinity;
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const sc = headerScore(rows[i] || []);
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  return best;
}

/** Ánh xạ tiêu đề → { field: colIndex } (kèm mẫu ngân hàng nếu chỉ định) */
export function guessMapping(headerRow, preset = null) {
  const hdr = headerRow.map((h) => norm(cellText(h)));
  const hdrVN = hdr.map(stripVN);
  const map = {};
  const findCol = (label) => { const n = norm(label), nv = stripVN(label); let i = hdr.indexOf(n); if (i < 0) i = hdrVN.indexOf(nv); if (i < 0) i = hdr.findIndex((h) => h.includes(n)); if (i < 0) i = hdrVN.findIndex((h) => h.includes(nv)); return i; };
  if (preset && preset.map) for (const [f, label] of Object.entries(preset.map)) { const i = findCol(label); if (i >= 0) map[f] = i; }
  // tự dò phần còn thiếu — khớp chính xác trước, rồi "chứa"
  const used = new Set(Object.values(map));
  for (const pass of ['exact', 'contains']) {
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (map[field] !== undefined) continue;
      for (let i = 0; i < hdr.length; i++) {
        if (used.has(i) || !hdr[i]) continue;
        const ok = pass === 'exact' ? (aliases.includes(hdr[i]) || aliases.includes(hdrVN[i])) : aliases.some((a) => a.length >= 4 && (hdr[i].includes(a) || hdrVN[i].includes(stripVN(a))));
        if (ok) { map[field] = i; used.add(i); break; }
      }
    }
  }
  // nếu có debit/credit thì không cần amount đơn (tránh gán nhầm cột "số dư")
  if (map.debit !== undefined && map.credit !== undefined && map.amount !== undefined && (map.amount === map.debit || map.amount === map.credit)) delete map.amount;
  return map;
}

/** Nhận dạng mẫu ngân hàng từ dòng tiêu đề */
export function detectPreset(headerRow) {
  const hdr = headerRow.map((h) => norm(cellText(h)));
  const joined = hdr.join(' | ');
  let best = null, bestScore = 0;
  for (const p of BANK_PRESETS) {
    if (!p.match.length) continue;
    if (!p.match.every((m) => joined.includes(m))) continue;
    const score = p.match.reduce((a, m) => a + m.length, 0); // mẫu càng đặc thù (chuỗi dài) càng ưu tiên
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

/**
 * Parse số linh hoạt: "1,250,000", "1.250.000", "1.250.000,50", "1250000.5", "-500.000", "(500)", "500.000 VND", "1,5tr"
 * → số (VND, làm tròn); null nếu không hiểu.
 */
export function parseNumberLoose(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[-−–]/.test(s)) { neg = true; s = s.slice(1); }
  if (/^\+/.test(s)) s = s.slice(1);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let num;
  if (lastDot >= 0 && lastComma >= 0) {
    // ký tự phân cách cuối cùng là thập phân nếu sau nó ≤ 2 chữ số, ngược lại cả hai đều là nhóm nghìn
    const lastSep = Math.max(lastDot, lastComma);
    const decimals = s.length - lastSep - 1;
    if (decimals <= 2) num = Number(s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1));
    else num = Number(s.replace(/[.,]/g, ''));
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    // "1.250.000" / "1,250,000" (nhóm 3) → nghìn; "12.5" / "0,5" → thập phân; "1250.00" → thập phân
    if (parts.length > 2 || (tail.length === 3 && parts[0].length <= 3 && parts.length === 2 && !(parts[0] === '0'))) num = Number(parts.join(''));
    else num = Number(parts.slice(0, -1).join('') + '.' + tail);
  } else num = Number(s);
  if (!Number.isFinite(num)) return null;
  return neg ? -num : num;
}

/** Đoán định dạng ngày từ mẫu ô: 'dmy' | 'mdy' | 'ymd' */
export function detectDateFormat(samples) {
  let dmy = 0, mdy = 0, ymd = 0;
  for (const v of samples) {
    const s = cellText(v).trim();
    if (!s) continue;
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s)) { ymd++; continue; }
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12) dmy++; else if (b > 12) mdy++;
  }
  if (ymd && ymd >= dmy && ymd >= mdy) return 'ymd';
  if (mdy > dmy) return 'mdy';
  return 'dmy'; // mặc định Việt Nam
}

/** Parse ngày theo định dạng → 'YYYY-MM-DD' | null */
export function parseDateWith(v, fmt = 'dmy') {
  if (v instanceof Date) return isNaN(v) ? null : toLocalYMD(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel serial
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d{12,13}$/.test(s)) return toLocalYMD(Number(s));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) { const ymd = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; if (isValidYMD(ymd)) { if (s.length > 10 && /[zZ]|[+-]\d{2}:\d{2}$/.test(s)) { const d = new Date(s); if (!isNaN(d)) return toLocalYMD(d); } return ymd; } }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = m[3]; if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
    const [a, b] = [m[1], m[2]];
    const [d, mo] = fmt === 'mdy' ? [b, a] : [a, b];
    const ymd = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (isValidYMD(ymd)) return ymd;
    // thử đảo nếu sai
    const alt = `${y}-${d.padStart(2, '0')}-${mo.padStart(2, '0')}`;
    return isValidYMD(alt) ? alt : null;
  }
  const d = new Date(s);
  return isNaN(d) ? null : toLocalYMD(d);
}

function parseTypeCell(v) {
  const s = stripVN(cellText(v));
  if (!s) return null;
  if (/^(income|thu|in|\+|credit|cr|thu nhap|nhan tien|tien vao|nap tien|deposit)$/.test(s) || /nhan tien|tien vao|thu nhap|credit/.test(s)) return 'income';
  if (/^(expense|chi|out|-|debit|dr|chi tieu|thanh toan|tien ra|rut tien|withdraw)$/.test(s) || /chi tieu|thanh toan|tien ra|chuyen tien|debit|rut tien/.test(s)) return 'expense';
  if (/^(transfer|chuyen khoan|chuyen)$/.test(s)) return 'transfer';
  return null;
}

/** Từ khóa → tên danh mục mặc định (chỉ dùng khi bật "tự gán danh mục") */
export const KEYWORD_CATEGORIES = [
  ['Ăn uống', ['grabfood', 'shopeefood', 'baemin', 'gojek food', 'be food', 'highlands', 'phuc long', 'phúc long', 'starbucks', 'the coffee house', 'coffee', 'cafe', 'cà phê', 'ca phe', 'com', 'cơm', 'pho', 'phở', 'bun', 'bún', 'tra sua', 'trà sữa', 'kfc', 'lotteria', 'jollibee', 'pizza', 'nha hang', 'nhà hàng', 'quan an', 'quán ăn', 'an uong', 'ăn uống', 'food', 'restaurant', 'circle k', 'ministop', 'gs25', 'family mart', 'bakery', 'banh', 'bánh']],
  ['Đi lại', ['grab', 'gojek', 'xanh sm', 'taxi', 'xang', 'xăng', 'petrolimex', 'pvoil', 'gui xe', 'gửi xe', 'bai xe', 'vetc', 'epass', 'bus', 'xe buyt', 'metro', 'vexere', 'vietjet', 'vietnam airlines', 'bamboo', 'may bay', 'máy bay', 'ga ', 'tau', 'tàu']],
  ['Mua sắm', ['shopee', 'lazada', 'tiki', 'sendo', 'tiktok shop', 'uniqlo', 'zara', 'h&m', 'the gioi di dong', 'thế giới di động', 'dien may xanh', 'điện máy xanh', 'fpt shop', 'cellphones', 'coopmart', 'co.opmart', 'winmart', 'vinmart', 'bach hoa xanh', 'bách hóa xanh', 'lotte mart', 'aeon', 'big c', 'go!', 'mega market', 'emart', 'guardian', 'watsons', 'sieu thi', 'siêu thị', 'mua sam', 'mua sắm']],
  ['Hóa đơn', ['evn', 'dien luc', 'điện lực', 'tien dien', 'tiền điện', 'tien nuoc', 'tiền nước', 'cap nuoc', 'cấp nước', 'internet', 'fpt telecom', 'viettel', 'vnpt', 'mobifone', 'vinaphone', 'cuoc', 'cước', 'truyen hinh', 'truyền hình', 'k+', 'phi quan ly', 'phí quản lý', 'chung cu', 'chung cư', 'gas', 'điện thoại', 'dien thoai', 'bao hiem', 'bảo hiểm', 'insurance']],
  ['Nhà cửa', ['tien nha', 'tiền nhà', 'thue nha', 'thuê nhà', 'tien tro', 'tiền trọ', 'rent', 'sua nha', 'sửa nhà', 'noi that', 'nội thất', 'ikea', 'jysk']],
  ['Sức khỏe', ['pharmacity', 'long chau', 'long châu', 'an khang', 'nha thuoc', 'nhà thuốc', 'benh vien', 'bệnh viện', 'phong kham', 'phòng khám', 'bac si', 'bác sĩ', 'medlatec', 'vinmec', 'hospital', 'clinic', 'thuoc', 'thuốc', 'gym', 'yoga', 'california fitness', 'elite fitness']],
  ['Giáo dục', ['hoc phi', 'học phí', 'truong', 'trường', 'khoa hoc', 'khóa học', 'udemy', 'coursera', 'sach', 'sách', 'fahasa', 'tieng anh', 'tiếng anh', 'ielts', 'english']],
  ['Giải trí', ['netflix', 'spotify', 'youtube', 'apple.com/bill', 'apple music', 'google play', 'steam', 'playstation', 'nintendo', 'cgv', 'lotte cinema', 'galaxy cinema', 'bhd', 'rap phim', 'rạp phim', 'karaoke', 'game', 'zing mp3', 'fpt play', 'vieon', 'du lich', 'du lịch', 'khach san', 'khách sạn', 'hotel', 'booking', 'agoda', 'traveloka', 'resort']],
  ['Đầu tư', ['chung khoan', 'chứng khoán', 'ssi', 'vndirect', 'vps', 'tcbs', 'vinacapital', 'dragon capital', 'finhay', 'infina', 'fmarket', 'quy mo', 'quỹ mở', 'etf', 'crypto', 'binance', 'vang', 'vàng', 'sjc', 'pnj', 'doji']],
  ['Tiết kiệm', ['tiet kiem', 'tiết kiệm', 'saving', 'gui tiet kiem', 'gửi tiết kiệm', 'so tk', 'sổ tk', 'term deposit']],
  ['Lương', ['luong', 'lương', 'salary', 'payroll', 'thu nhap', 'thu nhập', 'tra luong', 'trả lương', 'tien luong', 'tiền lương']],
  ['Thưởng', ['thuong', 'thưởng', 'bonus', 'hoa hong', 'hoa hồng', 'commission']],
];

/**
 * Đoán danh mục theo từ khóa: ưu tiên "học từ dữ liệu cũ" (learned: Map<noteNorm, categoryName>) rồi tới bảng từ khóa.
 * @returns {string|null} tên danh mục
 */
const kwCache = new Map();
function kwRegex(k) {
  let re = kwCache.get(k);
  if (!re) { re = new RegExp('(^|[^a-z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*') + '($|[^a-z0-9])'); kwCache.set(k, re); }
  return re;
}
export function guessCategory(note, { learned = null, type = 'expense' } = {}) {
  const raw = stripVN(note);
  if (!raw) return null;
  const rawNoDigits = raw.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  if (learned) {
    if (learned.has(rawNoDigits)) return learned.get(rawNoDigits);
    for (const [k, v] of learned) if (k.length >= 4 && (rawNoDigits.includes(k) || (rawNoDigits.length >= 4 && k.includes(rawNoDigits)))) return v;
  }
  // chọn danh mục có TỪ KHÓA DÀI NHẤT khớp (netflix.com → 'netflix' thắng 'com')
  let best = null, bestLen = 0;
  for (const [cat, kws] of KEYWORD_CATEGORIES) {
    if (type === 'income' && !['Lương', 'Thưởng', 'Đầu tư', 'Tiết kiệm'].includes(cat)) continue;
    for (const kw of kws) { const k = stripVN(kw).trim(); if (!k || k.length <= bestLen) continue; const hit = k.length >= 6 ? raw.includes(k) : kwRegex(k).test(raw); if (hit) { best = cat; bestLen = k.length; } }
  }
  return best;
}

/** Xây bảng "học" từ giao dịch cũ: ghi chú chuẩn hóa → tên danh mục dùng nhiều nhất */
export function buildLearnedMap(transactions, categoryNameOf) {
  const counts = new Map();
  for (const t of transactions) {
    if (t.deletedAt || !t.note || t.type === 'transfer') continue;
    const key = stripVN(t.note).replace(/\d+/g, '').trim();
    if (key.length < 3) continue;
    const name = categoryNameOf ? categoryNameOf(t.categoryId, t) : t.category;
    if (!name) continue;
    let m = counts.get(key); if (!m) { m = new Map(); counts.set(key, m); }
    m.set(name, (m.get(name) || 0) + 1);
  }
  const out = new Map();
  for (const [k, m] of counts) { let best = null, n = 0; for (const [name, c] of m) if (c > n) { best = name; n = c; } if (best) out.set(k, best); }
  return out;
}

/**
 * Áp dụng ánh xạ → danh sách giao dịch ứng viên.
 * @param {Array<Array>} rows  toàn bộ dòng (kể cả tiêu đề)
 * @param {object} p { headerIndex, map, dateFormat, signedAmount ('auto'|'negIsExpense'|'posIsExpense'), defaultType, learned, autoCategory, defaultCategory }
 * @returns {{ items, errors, stats: { total, ok, skipped } }}
 */
export function applyMapping(rows, { headerIndex = 0, map = {}, dateFormat = 'auto', signedAmount = 'auto', defaultType = 'expense', autoCategory = true, learned = null, defaultCategory = 'Khác' } = {}) {
  const items = [], errors = [];
  const body = rows.slice(headerIndex + 1);
  const fmt = dateFormat === 'auto' ? detectDateFormat(body.slice(0, 50).map((r) => r[map.date])) : dateFormat;
  const twoCols = map.debit !== undefined || map.credit !== undefined;
  // dò dấu: nếu cột amount có cả âm lẫn dương → dấu âm là chi; nếu toàn dương và có cột type → theo type; nếu toàn dương không type → defaultType
  let hasNeg = false, hasPos = false;
  if (!twoCols && map.amount !== undefined) for (const r of body.slice(0, 200)) { const n = parseNumberLoose(r[map.amount]); if (n === null) continue; if (n < 0) hasNeg = true; else if (n > 0) hasPos = true; }
  const signMode = signedAmount !== 'auto' ? signedAmount : (hasNeg && hasPos ? 'negIsExpense' : 'unsigned');
  let skipped = 0;
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    const lineNo = headerIndex + i + 2;
    const get = (f) => (map[f] === undefined ? '' : r[map[f]]);
    if (!r || r.every((c) => cellText(c).trim() === '')) { skipped++; continue; }
    const date = parseDateWith(get('date'), fmt);
    if (!date) { errors.push(`Dòng ${lineNo}: ngày không hợp lệ (${cellText(get('date')).slice(0, 20)})`); continue; }
    let amount = null, type = null;
    if (twoCols) {
      const d = parseNumberLoose(get('debit')), c = parseNumberLoose(get('credit'));
      if (d && Math.abs(d) > 0) { amount = Math.abs(d); type = 'expense'; }
      else if (c && Math.abs(c) > 0) { amount = Math.abs(c); type = 'income'; }
    } else {
      const n = parseNumberLoose(get('amount'));
      if (n !== null && n !== 0) {
        amount = Math.abs(n);
        if (signMode === 'negIsExpense') type = n < 0 ? 'expense' : 'income';
        else if (signMode === 'posIsExpense') type = n > 0 ? 'expense' : 'income';
      }
    }
    if (!amount) { errors.push(`Dòng ${lineNo}: không có số tiền`); continue; }
    const typeCell = parseTypeCell(get('type'));
    if (typeCell) type = typeCell;
    if (!type) type = defaultType;
    if (type === 'transfer') type = 'expense'; // sao kê không biết ví đích → coi là chi (người dùng sửa sau)
    const note = cellText(get('note')).replace(/\s+/g, ' ').trim().slice(0, 300);
    let category = cellText(get('category')).trim();
    if (!category && autoCategory) category = guessCategory(note, { learned, type }) || '';
    if (!category) category = type === 'income' ? 'Khác' : defaultCategory;
    const item = { type, amount: Math.round(amount), date, note, category, source: 'import', tags: [] };
    const id = cellText(get('id')).trim(); if (id) item.id = id;
    const acc = cellText(get('account')).trim(); if (acc) item.accountName = acc;
    items.push(item);
  }
  return { items, errors, stats: { total: body.length, ok: items.length, skipped }, dateFormatUsed: fmt, signMode };
}
