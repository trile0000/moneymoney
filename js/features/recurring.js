// Giao dịch định kỳ tổng quát (ngày / tuần / tháng / năm) — engine thuần túy, có test.
// Kế thừa cơ chế "kỳ còn thiếu" của P0: mỗi rule có watermark `lastDate` (ngày kỳ cuối đã xử lý);
// mỗi lần mở app, mọi kỳ từ sau lastDate tới hôm nay được sinh (bù đủ dù không mở app đúng ngày).
// - `skippedDates`: các kỳ người dùng chủ động bỏ qua.
// - Người dùng xóa 1 giao dịch đã sinh → không sinh lại (watermark đã qua).
// - Tương thích lương cũ: giao dịch source='auto-salary' periodKey 'YYYY-MM' được coi là đã có kỳ tháng đó.

import { uuid } from '../utils/id.js';
import { toLocalYMD, isValidYMD, ymOf } from '../utils/date.js';

export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
export const AUTO_SALARY_SOURCE = 'auto-salary';
const MAX_OCC = 400;

export function makeRule(partial = {}) {
  const tpl = partial.template || {};
  const freq = FREQS.includes(partial.freq) ? partial.freq : 'monthly';
  const startDate = isValidYMD(partial.startDate) ? partial.startDate : toLocalYMD();
  return {
    id: partial.id || uuid(),
    name: String(partial.name || tpl.category || tpl.note || 'Định kỳ').trim(),
    enabled: partial.enabled !== false,
    template: {
      type: ['income', 'expense', 'transfer'].includes(tpl.type) ? tpl.type : 'expense',
      amount: Math.max(0, Math.round(Number(tpl.amount) || 0)),
      categoryId: tpl.categoryId || null,
      category: String(tpl.category || '').trim(),
      accountId: tpl.accountId || null,
      toAccountId: tpl.toAccountId || null,
      note: String(tpl.note || '').trim(),
      tags: Array.isArray(tpl.tags) ? tpl.tags.slice() : [],
    },
    freq,
    interval: Math.max(1, Math.round(Number(partial.interval) || 1)),
    byMonthDay: partial.byMonthDay ? Math.min(31, Math.max(1, Math.round(Number(partial.byMonthDay)))) : Number(startDate.slice(8, 10)),
    startDate,
    endDate: isValidYMD(partial.endDate) ? partial.endDate : null,
    lastDate: isValidYMD(partial.lastDate) ? partial.lastDate : null,
    skippedDates: Array.isArray(partial.skippedDates) ? partial.skippedDates.filter(isValidYMD) : [],
    legacySalary: !!partial.legacySalary, // rule sinh ra từ cài đặt "lương hàng tháng" bản cũ
    createdAt: partial.createdAt || Date.now(),
  };
}

// ---- lịch ----
function parts(ymd) { const [y, m, d] = ymd.split('-').map(Number); return { y, m: m - 1, d }; }
function clampDate(y, m, d) { const last = new Date(y, m + 1, 0).getDate(); return toLocalYMD(new Date(y, m, Math.min(d, last))); }
function addDays(ymd, n) { const { y, m, d } = parts(ymd); return toLocalYMD(new Date(y, m, d + n)); }

/** Kỳ thứ k (k = 0,1,2…) của rule, hoặc null nếu k âm */
export function occurrenceAt(rule, k) {
  if (k < 0) return null;
  const s = parts(rule.startDate);
  const iv = rule.interval || 1;
  switch (rule.freq) {
    case 'daily': return addDays(rule.startDate, k * iv);
    case 'weekly': return addDays(rule.startDate, k * iv * 7);
    case 'monthly': {
      // kỳ đầu: tháng bắt đầu với ngày byMonthDay nếu ≥ startDate, ngược lại tháng kế
      const first = clampDate(s.y, s.m, rule.byMonthDay);
      const offset = first >= rule.startDate ? 0 : 1;
      const total = s.m + (offset + k * iv);
      return clampDate(s.y + Math.floor(total / 12), ((total % 12) + 12) % 12, rule.byMonthDay);
    }
    case 'yearly': {
      const first = clampDate(s.y, s.m, rule.byMonthDay);
      const offset = first >= rule.startDate ? 0 : 1;
      return clampDate(s.y + offset + k * iv, s.m, rule.byMonthDay);
    }
    default: return null;
  }
}

/** Kỳ đầu tiên > afterYMD (bỏ qua skipped, tôn trọng endDate). Trả null nếu không còn. */
export function nextOccurrence(rule, afterYMD, { includeSkipped = false } = {}) {
  if (!rule.enabled && !includeSkipped) return null;
  for (let k = 0; k < MAX_OCC * 4; k++) {
    const d = occurrenceAt(rule, k);
    if (!d) return null;
    if (rule.endDate && d > rule.endDate) return null;
    if (d <= afterYMD) continue;
    if (!includeSkipped && rule.skippedDates.includes(d)) continue;
    return d;
  }
  return null;
}

/**
 * Các kỳ đến hạn cần sinh tính tới todayYMD (bao gồm), sau watermark lastDate.
 * @param {Set<string>} existingKeys  khóa đã có: 'YYYY-MM-DD' của giao dịch đã sinh cho rule này, hoặc 'YYYY-MM' (lương cũ)
 * @returns {{ toAdd: Array<{date, periodKey}>, newLastDate: string|null }}
 */
export function dueOccurrences(rule, todayYMD, existingKeys = new Set()) {
  const out = [];
  let newLast = rule.lastDate;
  if (!rule.enabled || !isValidYMD(todayYMD)) return { toAdd: out, newLastDate: newLast };
  const floor = rule.lastDate || null;
  for (let k = 0; k < MAX_OCC; k++) {
    const d = occurrenceAt(rule, k);
    if (!d || d > todayYMD) break;
    if (rule.endDate && d > rule.endDate) break;
    if (floor && d <= floor) continue;
    newLast = d;
    if (rule.skippedDates.includes(d)) continue;
    if (existingKeys.has(d) || (rule.freq === 'monthly' && existingKeys.has(ymOf(d)))) continue;
    out.push({ date: d, periodKey: d });
  }
  return { toAdd: out, newLastDate: newLast };
}

/** Sinh object giao dịch từ rule cho một kỳ */
export function buildTransaction(rule, occ, { now = Date.now() } = {}) {
  const t = rule.template;
  return {
    type: t.type,
    amount: t.amount,
    categoryId: t.categoryId,
    category: t.category,
    accountId: t.accountId,
    toAccountId: t.type === 'transfer' ? t.toAccountId : undefined,
    note: t.note,
    tags: t.tags.slice(),
    date: occ.date,
    createdAt: now,
    source: 'recurring',
    recurringId: rule.id,
    periodKey: occ.periodKey,
  };
}

/**
 * Chạy engine cho toàn bộ rules → { toAdd: [tx...], ruleUpdates: Map<ruleId, lastDate> }
 * `transactions`: toàn bộ giao dịch (kể cả xóa mềm) để dựng existingKeys.
 */
export function runRecurring(rules, transactions, todayYMD, { now = Date.now() } = {}) {
  const byRule = new Map();
  for (const t of transactions || []) {
    if (!t.recurringId) continue;
    if (!byRule.has(t.recurringId)) byRule.set(t.recurringId, new Set());
    const s = byRule.get(t.recurringId);
    if (t.periodKey) s.add(t.periodKey);
    if (t.date) s.add(t.date);
  }
  const toAdd = [];
  const ruleUpdates = new Map();
  for (const r of rules || []) {
    const { toAdd: occ, newLastDate } = dueOccurrences(r, todayYMD, byRule.get(r.id) || new Set());
    for (const o of occ) toAdd.push(buildTransaction(r, o, { now }));
    if (newLastDate !== r.lastDate) ruleUpdates.set(r.id, newLastDate);
  }
  return { toAdd, ruleUpdates };
}

/** Nhãn chu kỳ ngắn gọn (dùng UI) — hàm thuần, i18n ở tầng UI */
export function freqLabelKey(rule) {
  return `recur.freq.${rule.freq}` + (rule.interval > 1 ? '.n' : '');
}
