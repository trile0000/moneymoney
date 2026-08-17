// Công nợ cho mượn / đi mượn (IOU) — thuần túy.
// Mô hình: mỗi khoản là MỘT GIAO DỊCH thật (tiền thực sự ra/vào ví) gắn thêm meta `debt`:
//   { kind: 'lend' | 'borrow' | 'repay', person, refId? }
//   - lend   : expense — tôi cho `person` mượn
//   - borrow : income  — tôi mượn của `person`
//   - repay  : income  → họ trả lại tôi (thu nợ);  expense → tôi trả lại họ (trả nợ)
// Số dư theo người = (cho mượn − đã thu về) − (đi mượn − đã trả lại). Dương: họ nợ tôi; âm: tôi nợ họ.
// Không tính thành phần "lãi"; công nợ ngoài app (không đi qua ví) → khai báo ở Tài sản ròng.

export const IOU_KINDS = ['lend', 'borrow', 'repay'];

/** Danh mục hệ thống dùng cho các giao dịch công nợ (tạo khi cần) */
export const IOU_CATEGORIES = {
  lend: { name: 'Cho mượn', icon: '🤝', kind: 'expense', color: '#5d4037' },
  borrow: { name: 'Đi mượn', icon: '🙏', kind: 'income', color: '#5d4037' },
  repayIn: { name: 'Thu nợ', icon: '💸', kind: 'income', color: '#2e7d32' },
  repayOut: { name: 'Trả nợ vay', icon: '💳', kind: 'expense', color: '#b3261e' },
};

export function personKey(name) { return String(name || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/**
 * Tổng hợp công nợ theo người từ danh sách giao dịch (đã lọc xóa mềm).
 * @returns {{ people: Array<{ person, key, lent, lentBack, borrowed, paidBack, balance, items, lastDate, open }>, receivable, payable, openCount }}
 */
export function iouSummary(transactions) {
  const map = new Map();
  for (const t of transactions) {
    if (!t.debt || t.deletedAt) continue;
    const key = personKey(t.debt.person) || '?';
    let p = map.get(key);
    if (!p) { p = { person: String(t.debt.person || '').trim() || '?', key, lent: 0, lentBack: 0, borrowed: 0, paidBack: 0, balance: 0, items: [], lastDate: '' }; map.set(key, p); }
    const a = Math.abs(Number(t.amount) || 0);
    if (t.debt.kind === 'lend') p.lent += a;
    else if (t.debt.kind === 'borrow') p.borrowed += a;
    else if (t.debt.kind === 'repay') { if (t.type === 'income') p.lentBack += a; else p.paidBack += a; }
    p.items.push(t);
    if (t.date > p.lastDate) p.lastDate = t.date;
  }
  let receivable = 0, payable = 0, openCount = 0;
  const people = [];
  for (const p of map.values()) {
    p.balance = (p.lent - p.lentBack) - (p.borrowed - p.paidBack);
    p.open = Math.abs(p.balance) >= 1;
    if (p.balance > 0) receivable += p.balance; else if (p.balance < 0) payable += -p.balance;
    if (p.open) openCount++;
    p.items.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : (y.createdAt || 0) - (x.createdAt || 0)));
    people.push(p);
  }
  people.sort((x, y) => Number(y.open) - Number(x.open) || Math.abs(y.balance) - Math.abs(x.balance) || x.person.localeCompare(y.person, 'vi'));
  return { people, receivable, payable, openCount };
}

/** Xác định loại giao dịch (income/expense) và danh mục hệ thống cho một khoản công nợ */
export function iouTxShape(kind, { direction } = {}) {
  // direction cho repay: 'in' (họ trả tôi) | 'out' (tôi trả họ)
  if (kind === 'lend') return { type: 'expense', category: IOU_CATEGORIES.lend };
  if (kind === 'borrow') return { type: 'income', category: IOU_CATEGORIES.borrow };
  if (direction === 'in') return { type: 'income', category: IOU_CATEGORIES.repayIn };
  return { type: 'expense', category: IOU_CATEGORIES.repayOut };
}

/** Danh sách tên người đã từng có công nợ (để gợi ý) */
export function knownPeople(transactions) {
  const seen = new Map();
  for (const t of transactions) if (t.debt && t.debt.person && !t.deletedAt) { const k = personKey(t.debt.person); if (!seen.has(k)) seen.set(k, t.debt.person.trim()); }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'vi'));
}
