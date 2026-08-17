// Tìm kiếm & lọc giao dịch — thuần túy, có test.
import { toLocalYMD } from '../utils/date.js';

/** Bỏ dấu tiếng Việt + thường hóa: 'Ăn Uống' → 'an uong' */
export function normalizeVN(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

export function emptyFilter() {
  return { q: '', from: '', to: '', type: 'all', accountId: '', categoryId: '', tag: '', min: null, max: null };
}

export function isFilterEmpty(f) {
  const e = emptyFilter();
  return Object.keys(e).every((k) => (f[k] ?? e[k]) === e[k] || f[k] === '' || f[k] === null);
}

/** Preset khoảng ngày: 'thisMonth' | 'lastMonth' | 'last30' | 'thisYear' | 'all' */
export function presetRange(name, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth();
  const ymd = (d) => toLocalYMD(d);
  switch (name) {
    case 'thisMonth': return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
    case 'lastMonth': return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case 'last30': return { from: ymd(new Date(y, m, today.getDate() - 29)), to: ymd(today) };
    case 'thisYear': return { from: `${y}-01-01`, to: `${y}-12-31` };
    default: return { from: '', to: '' };
  }
}

/**
 * @param {Array} items giao dịch
 * @param {object} f  filter
 * @param {object} ctx { categoryIds?: Set (id + con), accountsById?: Map, categoriesById?: Map }
 */
export function applyFilter(items, f, ctx = {}) {
  if (!f) return items;
  const q = normalizeVN(f.q);
  const qDigits = q.replace(/\D/g, '');
  const catSet = f.categoryId ? (ctx.categoryIds || new Set([f.categoryId])) : null;
  const tag = normalizeVN(f.tag);
  const min = f.min !== null && f.min !== undefined && f.min !== '' ? Number(f.min) : null;
  const max = f.max !== null && f.max !== undefined && f.max !== '' ? Number(f.max) : null;
  return items.filter((t) => {
    if (f.from && t.date < f.from) return false;
    if (f.to && t.date > f.to) return false;
    if (f.type && f.type !== 'all' && t.type !== f.type) return false;
    if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    if (catSet && !catSet.has(t.categoryId)) return false;
    if (tag && !(t.tags || []).some((x) => normalizeVN(x) === tag)) return false;
    if (min !== null && t.amount < min) return false;
    if (max !== null && t.amount > max) return false;
    if (q) {
      const acc = ctx.accountsById ? ctx.accountsById.get(t.accountId) : null;
      const acc2 = ctx.accountsById && t.toAccountId ? ctx.accountsById.get(t.toAccountId) : null;
      const cat = ctx.categoriesById ? ctx.categoriesById.get(t.categoryId) : null;
      const parent = cat && cat.parentId && ctx.categoriesById ? ctx.categoriesById.get(cat.parentId) : null;
      const hay = normalizeVN([t.note, t.category, cat && cat.name, parent && parent.name, acc && acc.name, acc2 && acc2.name, ...(t.tags || [])].filter(Boolean).join(' '));
      const amountStr = String(t.amount);
      const hit = hay.includes(q) || (qDigits.length >= 3 && amountStr.includes(qDigits));
      if (!hit) return false;
    }
    return true;
  });
}

/** Tổng hợp nhanh cho kết quả lọc */
export function summarize(items) {
  let income = 0, expense = 0, transfer = 0;
  for (const t of items) {
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expense += t.amount;
    else transfer += t.amount;
  }
  return { income, expense, transfer, count: items.length, net: income - expense };
}
