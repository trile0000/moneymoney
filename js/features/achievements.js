// Tier & thành tựu (sửa lỗi #11: tách tier HIỂN THỊ khỏi SỰ KIỆN thành tựu).
// - tierOf(): thuần túy, dùng cho bất kỳ tháng nào đang xem.
// - evaluateAchievement(): chỉ trả về sự kiện khi (a) tháng đang xem là tháng hiện tại và
//   (b) thay đổi đến từ dữ liệu thật (thêm/sửa/xóa/import), không phải do đổi bộ lọc tháng.

export function tierOf(balance, thresholds) {
  const { t2, t3, t4 } = thresholds || {};
  let tier = 0;
  if (balance > 0) tier = 1;
  if (t2 > 0 && balance >= t2) tier = 2;
  if (t3 > 0 && balance >= t3) tier = 3;
  if (t4 > 0 && balance >= t4) tier = 4;
  return tier;
}

export function tierMessage(tier, balance, messages, formatVND) {
  const absFmt = formatVND(Math.abs(balance));
  const sign = balance > 0 ? '+' : balance < 0 ? '-' : '';
  const templ = messages[`t${tier}`] || '';
  return templ.replace('{sign}', sign).replace('{amount}', absFmt);
}

export function mascotFor(tier) {
  if (tier >= 2) return { file: 'tiger_rich', status: 'rich' };
  if (tier === 1) return { file: 'tiger_income', status: 'neutral' };
  return { file: 'tiger_poor', status: 'poor' };
}

/**
 * @param {object} p
 * @param {number} p.tier           tier của tháng hiện tại (đã tính)
 * @param {number} p.prevTier       tier hiện tại lần trước (trong phiên)
 * @param {number} p.bestTier       kỷ lục đã lưu
 * @param {boolean} p.isCurrentMonth  tháng đang xem có phải tháng hiện tại
 * @param {string} p.reason         'data' | 'filter' | 'init' | 'settings'
 * @returns {{ confetti: boolean, newBest: boolean, tier: number }}
 */
export function evaluateAchievement({ tier, prevTier, bestTier, isCurrentMonth, reason }) {
  const fromData = reason === 'data';
  const confetti = isCurrentMonth && fromData && prevTier !== null && tier > prevTier;
  const newBest = isCurrentMonth && fromData && tier > (bestTier || 0);
  return { confetti, newBest, tier };
}

// ---------- Streak & huy hiệu (P1c) ----------
import { toLocalYMD } from '../utils/date.js';

/**
 * Chuỗi ngày ghi chép liên tục (theo ngày tạo giao dịch, giờ địa phương).
 * @returns {{ current, best, lastDay, days: number }}
 */
export function computeStreak(transactions, todayYMD = toLocalYMD()) {
  const days = new Set();
  for (const t of transactions) { if (t.deletedAt || t.source === 'recurring' || t.source === 'auto-salary') continue; const d = toLocalYMD(t.createdAt); if (d <= todayYMD) days.add(d); }
  if (!days.size) return { current: 0, best: 0, lastDay: null, days: 0 };
  const sorted = [...days].sort();
  let best = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00'), cur = new Date(sorted[i] + 'T00:00:00');
    if (Math.round((cur - prev) / 86400000) === 1) { run++; if (run > best) best = run; } else run = 1;
  }
  const lastDay = sorted[sorted.length - 1];
  const yesterday = toLocalYMD(new Date(new Date(todayYMD + 'T00:00:00').getTime() - 86400000));
  let current = 0;
  if (lastDay === todayYMD || lastDay === yesterday) {
    let d = lastDay;
    while (days.has(d)) { current++; d = toLocalYMD(new Date(new Date(d + 'T00:00:00').getTime() - 86400000)); }
  }
  return { current, best, lastDay, days: days.size };
}

export const BADGES = [
  { key: 'first_tx', icon: '🌱' },
  { key: 'tx_100', icon: '💯' },
  { key: 'tx_1000', icon: '🏆' },
  { key: 'streak_7', icon: '🔥' },
  { key: 'streak_30', icon: '🐯' },
  { key: 'first_budget', icon: '🎯' },
  { key: 'goal_done', icon: '🎉' },
  { key: 'ef_3', icon: '🛡️' },
  { key: 'ef_6', icon: '🏰' },
  { key: 'health_70', icon: '💪' },
  { key: 'positive_3', icon: '📈' },
];

/**
 * Xác định huy hiệu đạt được từ trạng thái hiện tại (thuần).
 * @param {object} s { txCount, streakBest, budgets, goalsDone, efMonths, healthScore, positiveMonthsInRow }
 * @returns {string[]} keys
 */
export function earnedBadges(s) {
  const out = [];
  if (s.txCount >= 1) out.push('first_tx');
  if (s.txCount >= 100) out.push('tx_100');
  if (s.txCount >= 1000) out.push('tx_1000');
  if (s.streakBest >= 7) out.push('streak_7');
  if (s.streakBest >= 30) out.push('streak_30');
  if (s.budgets >= 1) out.push('first_budget');
  if (s.goalsDone >= 1) out.push('goal_done');
  if (s.efMonths >= 3) out.push('ef_3');
  if (s.efMonths >= 6) out.push('ef_6');
  if (s.healthScore >= 70) out.push('health_70');
  if (s.positiveMonthsInRow >= 3) out.push('positive_3');
  return out;
}

/** Số tháng liên tiếp (tính từ tháng trước) có thu ≥ chi */
export function positiveMonthsInRow(monthIndex, currentYM) {
  let n = 0;
  for (let k = 1; k <= 24; k++) {
    const key = shiftYM(currentYM, -k);
    const m = monthIndex.get(key);
    if (!m || !m.items.length) break;
    if (m.income >= m.expense && m.income > 0) n++; else break;
  }
  return n;
}
function shiftYM(ym, n) { const [y, m] = ym.split('-').map(Number); const total = y * 12 + (m - 1) + n; return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`; }
