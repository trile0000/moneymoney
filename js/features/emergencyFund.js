// Quỹ khẩn cấp — thuần túy.
import { addMonths } from '../utils/date.js';
import { effectiveGroup } from './categories.js';

/**
 * Chi thiết yếu (nhóm need) trung bình n tháng gần nhất TRƯỚC tháng hiện tại (tháng hiện tại chưa đủ nên bỏ).
 * Nếu chưa xếp nhóm cho danh mục nào → fallback: dùng toàn bộ chi tiêu.
 * @returns {{ avg, months: number, usedFallback: boolean }}
 */
export function avgEssentialMonthly(monthIndex, categories, currentYM, n = 6) {
  const cache = new Map();
  const groupOf = (id) => { if (!cache.has(id)) cache.set(id, effectiveGroup(categories, id)); return cache.get(id); };
  const hasGroups = categories.some((c) => c.group);
  let total = 0, count = 0;
  for (let k = 1; k <= n; k++) {
    const m = monthIndex.get(addMonths(currentYM, -k));
    if (!m) continue;
    let s = 0;
    for (const t of m.items) {
      if (t.type !== 'expense' || t.deletedAt) continue;
      if (!hasGroups || groupOf(t.categoryId) === 'need') s += t.amount;
    }
    if (s > 0) { total += s; count++; }
  }
  if (!count) {
    // chưa có tháng trước → dùng tháng hiện tại làm ước lượng
    const m = monthIndex.get(currentYM);
    if (m) { let s = 0; for (const t of m.items) if (t.type === 'expense' && !t.deletedAt && (!hasGroups || groupOf(t.categoryId) === 'need')) s += t.amount; if (s > 0) return { avg: s, months: 0, usedFallback: !hasGroups }; }
    return { avg: 0, months: 0, usedFallback: !hasGroups };
  }
  return { avg: total / count, months: count, usedFallback: !hasGroups };
}

/**
 * @param {number} fund  số tiền quỹ hiện có
 * @param {number} avgEssential  chi thiết yếu TB/tháng
 * @param {number} targetMonths  3 | 6 | 12
 */
export function efStatus(fund, avgEssential, targetMonths = 6) {
  const target = avgEssential * targetMonths;
  const coveredMonths = avgEssential > 0 ? fund / avgEssential : 0;
  const pct = target > 0 ? Math.min(1, fund / target) : 0;
  const level = coveredMonths >= targetMonths ? 'ok' : coveredMonths >= 3 ? 'warn' : 'low';
  return { target, coveredMonths, pct, level, missing: Math.max(0, target - fund) };
}

/** Cảnh báo "đầu tư mạnh khi quỹ khẩn cấp chưa đủ": chi nhóm save/Đầu tư > 20% thu nhập tháng và coveredMonths < 3 */
export function investWarning({ investSpend, income, coveredMonths }) {
  if (!income || coveredMonths >= 3) return false;
  return investSpend / income > 0.2;
}
