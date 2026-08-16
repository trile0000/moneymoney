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
