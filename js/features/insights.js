// Insight tự động — thuần túy. Trả về mảng { key, vars, level: 'good'|'info'|'warn', weight } (i18n ở UI).
import { addMonths } from '../utils/date.js';
import { spentByCategory, avgPrevMonths } from './budgets.js';
import { descendantIds } from './categories.js';

/** Quy đổi số tiền rule về mức/tháng */
export function monthlyEquivalent(rule) {
  const a = rule.template.amount || 0, iv = rule.interval || 1;
  switch (rule.freq) {
    case 'daily': return a * 30 / iv;
    case 'weekly': return a * 52 / 12 / iv;
    case 'monthly': return a / iv;
    case 'yearly': return a / 12 / iv;
    default: return a;
  }
}

/**
 * @param {object} p
 * @param {Map} p.monthIndex
 * @param {string} p.ym  tháng đang xét
 * @param {Array} p.categories
 * @param {Array} p.rules
 * @param {Map} p.catById
 */
export function buildInsights({ monthIndex, ym, categories, rules = [] }) {
  const out = [];
  const m = monthIndex.get(ym);
  if (!m) return out;
  const items = m.items.filter((t) => !t.deletedAt);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const rootOf = (id) => { const c = catById.get(id); if (!c) return null; return c.parentId ? catById.get(c.parentId) || c : c; };
  const income = m.income, expense = m.expense;

  // 1) Tỉ lệ tiết kiệm
  if (income > 0) {
    const rate = (income - expense) / income;
    if (rate < 0) out.push({ key: 'insight.negative', vars: { amount: expense - income }, level: 'warn', weight: 100 });
    else if (rate >= 0.2) out.push({ key: 'insight.savingsGood', vars: { pct: Math.round(rate * 100) }, level: 'good', weight: 60 });
    else out.push({ key: 'insight.savingsLow', vars: { pct: Math.round(rate * 100) }, level: 'info', weight: 50 });
  }

  // 2) Danh mục tăng/giảm mạnh so với TB 3 tháng (theo danh mục gốc)
  const spent = spentByCategory(items);
  const byRoot = new Map();
  for (const [cid, v] of spent) { const r = rootOf(cid); if (!r) continue; byRoot.set(r.id, (byRoot.get(r.id) || 0) + v); }
  const spikes = [];
  for (const [rid, v] of byRoot) {
    if (v < 200000) continue;
    const ids = descendantIds(categories, rid);
    const avg = avgPrevMonths(monthIndex, ym, ids, 3);
    if (avg <= 0) continue;
    const diff = (v - avg) / avg;
    if (diff >= 0.3) spikes.push({ rid, diff, v, avg });
  }
  spikes.sort((a, b) => b.diff - a.diff);
  for (const s of spikes.slice(0, 2)) {
    const c = catById.get(s.rid);
    out.push({ key: 'insight.catSpike', vars: { cat: `${c.icon} ${c.name}`, pct: Math.round(s.diff * 100), amount: s.v, avg: s.avg }, level: 'warn', weight: 80 + Math.min(19, s.diff * 10) });
  }

  // 3) Top 5 khoản chi lớn nhất
  const top = items.filter((t) => t.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 5);
  if (top.length >= 3) out.push({ key: 'insight.top5', vars: { items: top.map((t) => ({ amount: t.amount, category: (catById.get(t.categoryId) || {}).name || t.category, note: t.note, date: t.date })) }, level: 'info', weight: 40 });

  // 4) Chi phí định kỳ / thu nhập
  const recurringMonthly = rules.filter((r) => r.enabled && r.template.type === 'expense').reduce((a, r) => a + monthlyEquivalent(r), 0);
  const incomeRef = income > 0 ? income : avgIncome(monthIndex, ym, 3);
  if (recurringMonthly > 0 && incomeRef > 0) {
    const pct = recurringMonthly / incomeRef;
    out.push({ key: 'insight.recurringShare', vars: { pct: Math.round(pct * 100), amount: recurringMonthly }, level: pct > 0.5 ? 'warn' : 'info', weight: pct > 0.5 ? 75 : 45 });
  }

  // 5) Nghi ngờ subscription: cùng danh mục + cùng số tiền, xuất hiện ≥ 3 tháng liên tiếp, không phải rule
  const suspects = findSubscriptionSuspects(monthIndex, ym, 3);
  for (const s of suspects.slice(0, 2)) {
    const c = catById.get(s.categoryId);
    out.push({ key: 'insight.subscription', vars: { amount: s.amount, category: c ? `${c.icon} ${c.name}` : '', note: s.note, months: s.months }, level: 'info', weight: 55 });
  }

  out.sort((a, b) => b.weight - a.weight);
  return out;
}

export function avgIncome(monthIndex, ym, n = 3) {
  let total = 0, count = 0;
  for (let k = 1; k <= n; k++) { const m = monthIndex.get(addMonths(ym, -k)); if (m) { total += m.income; count++; } }
  return count ? total / count : 0;
}

/** Tìm khoản chi lặp lại cùng (danh mục, số tiền) trong ≥ n tháng liên tiếp tính đến ym, không gắn rule */
export function findSubscriptionSuspects(monthIndex, ym, n = 3) {
  const sig = (t) => `${t.categoryId}|${t.amount}`;
  const perMonth = [];
  for (let k = 0; k < n; k++) {
    const m = monthIndex.get(addMonths(ym, -k));
    const set = new Map();
    if (m) for (const t of m.items) if (t.type === 'expense' && !t.deletedAt && !t.recurringId && t.amount >= 20000) set.set(sig(t), t);
    perMonth.push(set);
  }
  const out = [];
  for (const [key, t] of perMonth[0]) {
    if (perMonth.every((s) => s.has(key))) out.push({ categoryId: t.categoryId, amount: t.amount, note: t.note, months: n });
  }
  return out;
}
