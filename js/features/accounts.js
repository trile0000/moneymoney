// Ví / tài khoản — helpers thuần túy.
import { uuid } from '../utils/id.js';
import { toLocalYMD } from '../utils/date.js';

export const ACCOUNT_TYPES = ['cash', 'bank', 'ewallet', 'credit'];
export const ACCOUNT_ICONS = { cash: '💵', bank: '🏦', ewallet: '📱', credit: '💳' };

export function makeAccount(partial = {}) {
  const type = ACCOUNT_TYPES.includes(partial.type) ? partial.type : 'cash';
  const a = {
    id: partial.id || uuid(),
    name: String(partial.name || '').trim() || 'Ví',
    type,
    openingBalance: Math.round(Number(partial.openingBalance) || 0),
    color: partial.color || '#8B2E1A',
    icon: partial.icon || ACCOUNT_ICONS[type],
    archived: !!partial.archived,
    createdAt: partial.createdAt || Date.now(),
  };
  if (type === 'credit') {
    const c = partial.credit || {};
    a.credit = {
      limit: Math.max(0, Math.round(Number(c.limit) || 0)),
      statementDay: clampDay(c.statementDay, 1),
      dueDay: clampDay(c.dueDay, 15),
    };
  }
  return a;
}
function clampDay(v, d) { const n = Math.round(Number(v)); return n >= 1 && n <= 31 ? n : d; }

export function defaultAccountList() {
  return [makeAccount({ name: 'Tiền mặt', type: 'cash', color: '#2e7d32' })];
}

/**
 * Số dư từng ví = số dư đầu + thu − chi − chuyển đi + chuyển đến (bỏ giao dịch đã xóa mềm).
 * @returns Map<accountId, balance>
 */
export function computeBalances(accounts, transactions) {
  const m = new Map(accounts.map((a) => [a.id, a.openingBalance || 0]));
  for (const t of transactions) {
    if (t.deletedAt) continue;
    const amt = Number(t.amount) || 0;
    if (t.type === 'transfer') {
      if (m.has(t.accountId)) m.set(t.accountId, m.get(t.accountId) - amt);
      if (m.has(t.toAccountId)) m.set(t.toAccountId, m.get(t.toAccountId) + amt);
    } else if (t.type === 'income') {
      if (m.has(t.accountId)) m.set(t.accountId, m.get(t.accountId) + amt);
    } else {
      if (m.has(t.accountId)) m.set(t.accountId, m.get(t.accountId) - amt);
    }
  }
  return m;
}

/** Tổng tài sản thanh khoản (không tính thẻ tín dụng âm là tài sản; dư nợ thẻ là nợ) */
export function totals(accounts, balances) {
  let assets = 0, liabilities = 0;
  for (const a of accounts) {
    if (a.archived) continue;
    const b = balances.get(a.id) || 0;
    if (a.type === 'credit') { if (b < 0) liabilities += -b; else assets += b; }
    else if (b >= 0) assets += b; else liabilities += -b;
  }
  return { assets, liabilities, net: assets - liabilities };
}

/**
 * Trạng thái thẻ tín dụng: ngày sao kê / đến hạn kế tiếp, số ngày còn lại, dư nợ.
 * @param {object} acc  tài khoản credit
 * @param {number} balance  số dư (âm = đang nợ)
 * @param {Date} today
 */
export function creditStatus(acc, balance, today = new Date()) {
  if (!acc || acc.type !== 'credit' || !acc.credit) return null;
  const y = today.getFullYear(), mo = today.getMonth(), d = today.getDate();
  const mk = (yy, mm, dd) => { const last = new Date(yy, mm + 1, 0).getDate(); return new Date(yy, mm, Math.min(dd, last)); };
  let due = mk(y, mo, acc.credit.dueDay);
  if (due.getDate() < d || (due.getMonth() === mo && due < new Date(y, mo, d))) due = mk(y, mo + 1, acc.credit.dueDay);
  let statement = mk(y, mo, acc.credit.statementDay);
  if (statement < new Date(y, mo, d)) statement = mk(y, mo + 1, acc.credit.statementDay);
  const daysToDue = Math.round((due - new Date(y, mo, d)) / 86400000);
  const debt = balance < 0 ? -balance : 0;
  const limit = acc.credit.limit || 0;
  return {
    debt,
    available: limit ? Math.max(0, limit - debt) : null,
    utilization: limit ? debt / limit : null,
    statementDate: toLocalYMD(statement),
    dueDate: toLocalYMD(due),
    daysToDue,
    warn: debt > 0 && daysToDue <= 5,
  };
}
