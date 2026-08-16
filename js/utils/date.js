// Ngày tháng — luôn dùng GIỜ ĐỊA PHƯƠNG (sửa lỗi #10: lệch múi giờ khi parse 'YYYY-MM-DD' theo UTC).
// Quy ước:
//   - `date`      : chuỗi 'YYYY-MM-DD' — ngày kinh tế của giao dịch (do người dùng chọn)
//   - `createdAt` : số ms epoch — thời điểm ghi nhận (chỉ để sắp xếp / kiểm toán)
//   - `periodKey` : 'YYYY-MM' — kỳ tháng

const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' theo giờ địa phương từ Date hoặc ms epoch */
export function toLocalYMD(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** 'YYYY-MM' theo giờ địa phương */
export function toLocalYM(d = new Date()) {
  return toLocalYMD(d).slice(0, 7);
}

/** Lấy 'YYYY-MM' từ chuỗi 'YYYY-MM-DD' (không parse Date → không lệch múi giờ) */
export function ymOf(ymd) {
  return typeof ymd === 'string' && ymd.length >= 7 ? ymd.slice(0, 7) : '';
}

/** Kiểm tra chuỗi 'YYYY-MM-DD' hợp lệ (đúng định dạng và tồn tại thật, VD không có 2025-02-30) */
export function isValidYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(y, m, 0).getDate(); // local, ngày cuối tháng
  return d <= dim && y >= 1970 && y <= 2200;
}

/** Kiểm tra 'YYYY-MM' hợp lệ */
export function isValidYM(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** Cộng n tháng vào 'YYYY-MM' → 'YYYY-MM' */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad2(nm)}`;
}

/** Danh sách các kỳ 'YYYY-MM' từ `from` đến `to` (bao gồm cả hai đầu). Trả [] nếu from > to. */
export function monthRange(from, to) {
  const out = [];
  if (!isValidYM(from) || !isValidYM(to) || from > to) return out;
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 1200) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/** So sánh 'YYYY-MM' → -1/0/1 */
export function compareYM(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Nhãn hiển thị 'T08/2026' từ 'YYYY-MM' */
export function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `T${m}/${y}`;
}

/** Nhãn hiển thị ngày dạng dd/MM/yyyy từ 'YYYY-MM-DD' */
export function dateLabel(ymd) {
  if (!ymd || ymd.length < 10) return '';
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
}
