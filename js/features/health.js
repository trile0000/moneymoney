// Điểm sức khỏe tài chính 0–100 — minh bạch từng thành phần, thuần túy.
// Thành phần (trọng số mặc định):
//   savings 25  — tỉ lệ tiết kiệm TB 3 tháng gần nhất có ghi chép: (thu − chi)/thu; 20% → tối đa
//   emergency 25 — số tháng chi thiết yếu quỹ khẩn cấp phủ được: 6 tháng → tối đa
//   dti 20 — tổng trả nợ hàng tháng / thu nhập TB: ≤10% tối đa, ≥50% = 0
//   stability 15 — độ ổn định chi tiêu 6 tháng: hệ số biến thiên (CV) ≤ 0.15 tối đa, ≥ 0.6 = 0
//   diversify 15 — số lớp tài sản đang nắm: ≥ 4 lớp tối đa
import { addMonths } from '../utils/date.js';

export const DEFAULT_WEIGHTS = { savings: 25, emergency: 25, dti: 20, stability: 15, diversify: 15 };

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function savingsRate(monthIndex, currentYM, n = 3) {
  let inc = 0, exp = 0, count = 0;
  for (let k = 0; k < n; k++) {
    const m = monthIndex.get(addMonths(currentYM, -k));
    if (!m || !m.items.length) continue;
    inc += m.income; exp += m.expense; count++;
  }
  return { rate: inc > 0 ? (inc - exp) / inc : null, income: inc, expense: exp, months: count };
}

export function spendingCV(monthIndex, currentYM, n = 6) {
  const vals = [];
  for (let k = 1; k <= n; k++) { const m = monthIndex.get(addMonths(currentYM, -k)); if (m && m.items.length && m.expense > 0) vals.push(m.expense); }
  if (vals.length < 2) return { cv: null, months: vals.length };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return { cv: mean ? sd / mean : null, months: vals.length, mean };
}

/**
 * @param {object} p
 * @param {Map} p.monthIndex
 * @param {string} p.currentYM
 * @param {number} p.efCoveredMonths
 * @param {number} p.monthlyDebtPayments
 * @param {number} p.diversifyCount  số lớp tài sản
 * @param {object} p.weights
 * @returns {{ score, components: [{ key, weight, ratio, points, value, note }] }}
 */
export function healthScore({ monthIndex, currentYM, efCoveredMonths = 0, monthlyDebtPayments = 0, diversifyCount = 0, weights = DEFAULT_WEIGHTS }) {
  const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 100;
  const comps = [];
  const sr = savingsRate(monthIndex, currentYM, 3);
  const srRatio = sr.rate === null ? 0 : clamp01(sr.rate / 0.2);
  comps.push({ key: 'savings', weight: w.savings, ratio: srRatio, value: sr.rate, months: sr.months, tip: sr.rate === null ? 'noData' : sr.rate < 0.1 ? 'low' : sr.rate < 0.2 ? 'mid' : 'ok' });
  const efRatio = clamp01(efCoveredMonths / 6);
  comps.push({ key: 'emergency', weight: w.emergency, ratio: efRatio, value: efCoveredMonths, tip: efCoveredMonths < 3 ? 'low' : efCoveredMonths < 6 ? 'mid' : 'ok' });
  const income = sr.months ? sr.income / sr.months : 0;
  const dti = income > 0 ? monthlyDebtPayments / income : (monthlyDebtPayments > 0 ? 1 : 0);
  const dtiRatio = dti <= 0.1 ? 1 : dti >= 0.5 ? 0 : 1 - (dti - 0.1) / 0.4;
  comps.push({ key: 'dti', weight: w.dti, ratio: clamp01(dtiRatio), value: dti, tip: dti > 0.35 ? 'low' : dti > 0.2 ? 'mid' : 'ok' });
  const cv = spendingCV(monthIndex, currentYM, 6);
  const stRatio = cv.cv === null ? 0.5 : cv.cv <= 0.15 ? 1 : cv.cv >= 0.6 ? 0 : 1 - (cv.cv - 0.15) / 0.45;
  comps.push({ key: 'stability', weight: w.stability, ratio: clamp01(stRatio), value: cv.cv, months: cv.months, tip: cv.cv === null ? 'noData' : cv.cv > 0.4 ? 'low' : cv.cv > 0.25 ? 'mid' : 'ok' });
  const dvRatio = clamp01(diversifyCount / 4);
  comps.push({ key: 'diversify', weight: w.diversify, ratio: dvRatio, value: diversifyCount, tip: diversifyCount <= 1 ? 'low' : diversifyCount < 4 ? 'mid' : 'ok' });
  let score = 0;
  for (const c of comps) { c.points = Math.round(c.ratio * c.weight / sum * 100 * 10) / 10; score += c.ratio * c.weight / sum * 100; }
  return { score: Math.round(score), components: comps };
}

/** Tier theo điểm sức khỏe: 0..4 */
export function healthTier(score) {
  if (score >= 85) return 4;
  if (score >= 70) return 3;
  if (score >= 50) return 2;
  if (score >= 30) return 1;
  return 0;
}
