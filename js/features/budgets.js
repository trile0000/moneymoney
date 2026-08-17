// Ngân sách theo danh mục (hàng tháng) — helpers thuần túy.
// budget: { id, categoryId|null (null = tổng chi tiêu), amount, note, createdAt }
// Ngân sách gắn danh mục cha bao gồm cả con.
import { uuid } from '../utils/id.js';
import { addMonths } from '../utils/date.js';

export function makeBudget(p = {}) {
  return {
    id: p.id || uuid(),
    categoryId: p.categoryId || null,
    amount: Math.max(0, Math.round(Number(p.amount) || 0)),
    note: String(p.note || '').trim(),
    createdAt: p.createdAt || Date.now(),
  };
}

/** Map<categoryId, tổng chi> cho 1 danh sách giao dịch (chỉ expense, bỏ chuyển khoản/xóa mềm) */
export function spentByCategory(items) {
  const m = new Map();
  for (const t of items) {
    if (t.type !== 'expense' || t.deletedAt) continue;
    m.set(t.categoryId || '?', (m.get(t.categoryId || '?') || 0) + t.amount);
  }
  return m;
}

/** Tổng chi cho 1 tập categoryIds (cha + con) từ map spentByCategory; null → tổng tất cả */
export function sumFor(spentMap, catIds) {
  let s = 0;
  if (!catIds) { for (const v of spentMap.values()) s += v; return s; }
  for (const id of catIds) s += spentMap.get(id) || 0;
  return s;
}

/**
 * Trung bình chi n tháng trước (không tính tháng đang xét) cho tập danh mục.
 * Chỉ tính các tháng CÓ ghi chép (có giao dịch bất kỳ) — tháng chưa dùng app không kéo trung bình xuống.
 * @param {Map} monthIndex  Map<'YYYY-MM', {items}>
 * @param {string} ym  tháng đang xét
 * @param {Set|null} catIds
 */
export function avgPrevMonths(monthIndex, ym, catIds, n = 3) {
  let total = 0, count = 0;
  for (let k = 1; k <= n; k++) {
    const m = monthIndex.get(addMonths(ym, -k));
    if (!m || !m.items.length) continue;
    total += sumFor(spentByCategory(m.items), catIds);
    count++;
  }
  return count ? total / count : 0;
}

/**
 * Trạng thái ngân sách: { spent, limit, pct (0..∞), level: 'ok'|'warn'|'over', remaining, avg3, vsAvgPct }
 */
export function budgetStatus(limit, spent, avg3) {
  const pct = limit > 0 ? spent / limit : 0;
  const level = pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
  const vsAvgPct = avg3 > 0 ? (spent - avg3) / avg3 : null;
  return { spent, limit, pct, level, remaining: limit - spent, avg3, vsAvgPct };
}

/** Số ngày còn lại trong tháng (kể cả hôm nay) và gợi ý mức chi/ngày còn lại */
export function dailyAllowance(remaining, todayYMD, ym) {
  if (!todayYMD.startsWith(ym)) return null;
  const [y, m, d] = todayYMD.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const daysLeft = Math.max(1, last - d + 1);
  return { daysLeft, perDay: Math.max(0, remaining) / daysLeft };
}
