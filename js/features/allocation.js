// Module C — Phân bổ đầu tư theo LỚP TÀI SẢN (thuần túy, có test).
// Nguyên tắc: chỉ nói về lớp tài sản (tiền mặt, thu nhập cố định, cổ phiếu/quỹ, vàng, bất động sản, khác),
// KHÔNG BAO GIỜ gợi ý mã cổ phiếu/quỹ/coin cụ thể. Mọi con số là giả định minh bạch, không phải tư vấn đầu tư.
// Luồng: câu hỏi hồ sơ rủi ro → điểm 0–100 → hồ sơ → phân bổ mục tiêu (điều chỉnh theo kỳ hạn & tuổi)
//        → so với phân bổ hiện tại (từ tài sản ròng) → chênh lệch/tái cân bằng → điều kiện tiên quyết → kế hoạch DCA + dự phóng.

export const ASSET_CLASSES = ['cash', 'fixed', 'stock', 'gold', 'realestate', 'other'];

/** Bộ câu hỏi: mỗi phương án có điểm 0..4 (4 = chấp nhận rủi ro cao nhất). Nhãn ở i18n: inv.q.<key>, inv.q.<key>.<opt> */
export const QUESTIONS = [
  { key: 'age', weight: 1.0, options: [['u30', 4], ['u40', 3], ['u50', 2], ['u60', 1], ['o60', 0]] },
  { key: 'horizon', weight: 1.6, options: [['lt2', 0], ['y2_5', 1], ['y5_10', 3], ['gt10', 4]] },
  { key: 'income', weight: 1.0, options: [['unstable', 0], ['ok', 2], ['stable', 3], ['multi', 4]] },
  { key: 'drop', weight: 1.6, options: [['sellAll', 0], ['sellSome', 1], ['hold', 3], ['buyMore', 4]] },
  { key: 'exp', weight: 0.8, options: [['none', 0], ['savings', 1], ['funds', 3], ['active', 4]] },
  { key: 'goal', weight: 1.0, options: [['preserve', 0], ['income', 1], ['balanced', 2], ['grow', 3], ['max', 4]] },
];

export const PROFILES = ['conservative', 'moderate', 'balanced', 'growth', 'aggressive'];

/** Phân bổ gốc theo hồ sơ (%, tổng 100). fixed = tiết kiệm có kỳ hạn / trái phiếu / quỹ trái phiếu. */
export const BASE_TARGETS = {
  conservative: { cash: 20, fixed: 55, stock: 10, gold: 10, realestate: 0, other: 5 },
  moderate: { cash: 15, fixed: 45, stock: 25, gold: 10, realestate: 0, other: 5 },
  balanced: { cash: 10, fixed: 35, stock: 40, gold: 10, realestate: 0, other: 5 },
  growth: { cash: 10, fixed: 20, stock: 55, gold: 10, realestate: 0, other: 5 },
  aggressive: { cash: 5, fixed: 10, stock: 70, gold: 5, realestate: 0, other: 10 },
};

/** Lợi suất danh nghĩa GIẢ ĐỊNH mặc định (%/năm) — người dùng chỉnh được; chỉ để dự phóng, không phải kỳ vọng thực. */
export const DEFAULT_RETURNS = { cash: 2, fixed: 5, stock: 8, gold: 4, realestate: 5, other: 0 };

/** Tính điểm 0..100 từ câu trả lời { key: optKey } */
export function riskScore(answers = {}) {
  let sum = 0, max = 0;
  for (const q of QUESTIONS) {
    const opt = q.options.find((o) => o[0] === answers[q.key]);
    max += 4 * q.weight;
    if (opt) sum += opt[1] * q.weight;
  }
  return max ? Math.round(sum / max * 100) : 0;
}

export function profileOf(score) {
  if (score < 25) return 'conservative';
  if (score < 45) return 'moderate';
  if (score < 65) return 'balanced';
  if (score < 82) return 'growth';
  return 'aggressive';
}

function normalize100(t) {
  const total = ASSET_CLASSES.reduce((a, k) => a + (t[k] || 0), 0) || 1;
  const out = {};
  for (const k of ASSET_CLASSES) out[k] = (t[k] || 0) / total * 100;
  // làm tròn về số nguyên, bù chênh vào lớp lớn nhất
  const rounded = {}; let acc = 0, maxK = 'fixed', maxV = -1;
  for (const k of ASSET_CLASSES) { rounded[k] = Math.round(out[k]); acc += rounded[k]; if (out[k] > maxV) { maxV = out[k]; maxK = k; } }
  rounded[maxK] += 100 - acc;
  return rounded;
}

/**
 * Phân bổ mục tiêu: gốc theo hồ sơ, điều chỉnh theo kỳ hạn (ngắn → bớt cổ phiếu, thêm tiền mặt/cố định).
 * @param {string} profile
 * @param {object} p { horizon: 'lt2'|'y2_5'|'y5_10'|'gt10' }
 */
export function targetAllocation(profile, { horizon } = {}) {
  const base = { ...(BASE_TARGETS[profile] || BASE_TARGETS.balanced) };
  const shift = horizon === 'lt2' ? 0.6 : horizon === 'y2_5' ? 0.3 : 0; // % cổ phiếu chuyển sang cố định/tiền mặt
  if (shift > 0) {
    const moved = base.stock * shift;
    base.stock -= moved;
    base.fixed += moved * 0.6;
    base.cash += moved * 0.4;
    if (horizon === 'lt2') { const o = base.other * 0.5; base.other -= o; base.fixed += o; }
  }
  return normalize100(base);
}

/** Lớp tài sản của một mục trong tài sản ròng (kind: account|asset|debt|iou|liability) → null nếu không tính là tài sản đầu tư */
export function classOfItem(item) {
  if (!item || item.value <= 0) return null;
  if (item.kind === 'account') return 'cash';
  if (item.kind === 'iou') return null; // phải thu: không phải tài sản đầu tư
  if (item.kind !== 'asset') return null;
  switch (item.type) {
    case 'savings': return 'fixed';
    case 'stock': case 'fund': return 'stock';
    case 'gold': return 'gold';
    case 'realestate': return 'realestate';
    case 'crypto': case 'other': return 'other';
    case 'vehicle': return null; // tiêu sản
    default: return 'other';
  }
}

/** Phân bổ hiện tại từ danh sách items của computeNetWorth → { total, byClass{VND}, pct{%} } */
export function currentAllocation(items = []) {
  const byClass = {}; for (const k of ASSET_CLASSES) byClass[k] = 0;
  for (const it of items) { const c = classOfItem(it); if (c) byClass[c] += it.value; }
  const total = ASSET_CLASSES.reduce((a, k) => a + byClass[k], 0);
  const pct = {}; for (const k of ASSET_CLASSES) pct[k] = total ? byClass[k] / total * 100 : 0;
  return { total, byClass, pct };
}

/**
 * Chênh lệch mục tiêu − hiện tại và gợi ý tái cân bằng (ngưỡng ±band điểm %).
 * @returns {{ rows: [{ cls, targetPct, currentPct, currentVND, targetVND, deltaVND, deltaPct, action: 'add'|'reduce'|'ok' }], needsRebalance }}
 */
export function compareAllocation(target, current, { band = 5 } = {}) {
  const rows = ASSET_CLASSES.map((cls) => {
    const targetPct = target[cls] || 0, currentPct = current.pct[cls] || 0;
    const targetVND = Math.round(current.total * targetPct / 100);
    const deltaVND = targetVND - Math.round(current.byClass[cls] || 0);
    const deltaPct = targetPct - currentPct;
    const action = Math.abs(deltaPct) < band ? 'ok' : deltaPct > 0 ? 'add' : 'reduce';
    return { cls, targetPct, currentPct, currentVND: Math.round(current.byClass[cls] || 0), targetVND, deltaVND, deltaPct, action };
  });
  return { rows, needsRebalance: rows.some((r) => r.action !== 'ok') };
}

/**
 * Điều kiện tiên quyết trước khi đầu tư rủi ro.
 * @param {object} p { efCoveredMonths, efTargetMonths, highRateDebts: [{ name, rate, balance }], highRateThreshold=12 }
 * @returns {{ ok, items: [{ key: 'ef'|'debt', level: 'block'|'warn', vars }] }}
 */
export function prerequisites({ efCoveredMonths = 0, efTargetMonths = 6, highRateDebts = [], highRateThreshold = 12 } = {}) {
  const items = [];
  if (efCoveredMonths < 3) items.push({ key: 'ef', level: 'block', vars: { months: Number(efCoveredMonths).toFixed(1), target: efTargetMonths } });
  else if (efCoveredMonths < efTargetMonths) items.push({ key: 'ef', level: 'warn', vars: { months: Number(efCoveredMonths).toFixed(1), target: efTargetMonths } });
  const hot = highRateDebts.filter((d) => d.rate >= highRateThreshold && d.balance > 0);
  if (hot.length) items.push({ key: 'debt', level: hot.some((d) => d.rate >= 20) ? 'block' : 'warn', vars: { n: hot.length, names: hot.map((d) => `${d.name} (${d.rate}%)`).join(', ') } });
  return { ok: !items.some((i) => i.level === 'block'), items };
}

/**
 * Kế hoạch DCA: chia số tiền mỗi tháng theo phân bổ mục tiêu và dự phóng giá trị cuối kỳ (lãi kép hàng tháng, giả định cố định).
 * @param {object} p { monthly, years, target, returns, startByClass }
 * @returns {{ perClass: {cls: VND/tháng}, contributed, projected, projectedByClass, yearly: [{ year, value, contributed }] }}
 */
export function dcaPlan({ monthly = 0, years = 5, target, returns = DEFAULT_RETURNS, startByClass = {} } = {}) {
  const months = Math.max(1, Math.round(years * 12));
  const perClass = {}; for (const k of ASSET_CLASSES) perClass[k] = Math.round(monthly * (target[k] || 0) / 100);
  const value = {}; for (const k of ASSET_CLASSES) value[k] = Number(startByClass[k]) || 0;
  const yearly = [];
  let contributed = 0;
  for (let m = 1; m <= months; m++) {
    for (const k of ASSET_CLASSES) {
      const r = (Number(returns[k]) || 0) / 100 / 12;
      value[k] = value[k] * (1 + r) + perClass[k];
    }
    contributed += monthly;
    if (m % 12 === 0 || m === months) yearly.push({ year: Math.ceil(m / 12), value: Math.round(ASSET_CLASSES.reduce((a, k) => a + value[k], 0)), contributed: Math.round(contributed) });
  }
  const projectedByClass = {}; for (const k of ASSET_CLASSES) projectedByClass[k] = Math.round(value[k]);
  return { perClass, contributed: Math.round(contributed), projected: Math.round(ASSET_CLASSES.reduce((a, k) => a + value[k], 0)), projectedByClass, yearly };
}

/** Gợi ý số tiền đầu tư mỗi tháng = TB thặng dư (thu − chi − trả nợ) − phần bồi quỹ khẩn cấp; không âm */
export function suggestMonthly({ avgIncome = 0, avgExpense = 0, debtPayments = 0, efMissing = 0, efMonthsToFill = 12 } = {}) {
  const surplus = Math.max(0, avgIncome - avgExpense - debtPayments);
  const efPart = efMissing > 0 ? Math.min(surplus, efMissing / efMonthsToFill) : 0;
  const r10k = (x) => Math.round(x / 10000) * 10000;
  return { surplus: r10k(surplus), efPart: r10k(efPart), investable: r10k(Math.max(0, surplus - efPart)) };
}
