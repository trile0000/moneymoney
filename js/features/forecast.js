// Dự báo dòng tiền 3–6 tháng tới — thuần túy.
// Cách tính (minh bạch): mỗi tháng tới = thu định kỳ + thu không định kỳ TB 3 tháng − chi định kỳ − chi không định kỳ TB 3 tháng − trả nợ tới hạn.
import { addMonths } from '../utils/date.js';
import { monthlyEquivalent } from './insights.js';

/** TB thu/chi KHÔNG định kỳ của n tháng gần nhất trước ym (bỏ giao dịch có recurringId) */
export function avgNonRecurring(monthIndex, ym, n = 3) {
  let inc = 0, exp = 0, count = 0;
  for (let k = 1; k <= n; k++) {
    const m = monthIndex.get(addMonths(ym, -k));
    if (!m || !m.items.length) continue;
    count++;
    for (const t of m.items) {
      if (t.deletedAt || t.recurringId) continue;
      if (t.type === 'income') inc += t.amount; else if (t.type === 'expense') exp += t.amount;
    }
  }
  return { income: count ? inc / count : 0, expense: count ? exp / count : 0, months: count };
}

/**
 * @param {object} p
 * @param {Map} p.monthIndex
 * @param {string} p.currentYM
 * @param {number} p.startBalance  tổng số dư thanh khoản hiện tại
 * @param {Array} p.rules  giao dịch định kỳ
 * @param {Array} p.debtPayments  [{ ym, amount }] các khoản trả nợ theo tháng (tùy chọn)
 * @param {number} p.months  3..12
 * @returns {{ rows: [{ym, income, expense, net, end, negative}], assumptions }}
 */
export function forecast({ monthIndex, currentYM, startBalance = 0, rules = [], debtPayments = [], months = 6 }) {
  const avg = avgNonRecurring(monthIndex, currentYM, 3);
  let recInc = 0, recExp = 0;
  for (const r of rules) {
    if (!r.enabled) continue;
    const m = monthlyEquivalent(r);
    if (r.template.type === 'income') recInc += m; else if (r.template.type === 'expense') recExp += m;
  }
  const debtByYM = new Map();
  for (const d of debtPayments) debtByYM.set(d.ym, (debtByYM.get(d.ym) || 0) + d.amount);
  const rows = [];
  let bal = startBalance;
  // Tháng hiện tại: phần còn lại = dự phóng theo phần đã chi (đơn giản hóa: bắt đầu từ tháng kế tiếp)
  for (let k = 1; k <= months; k++) {
    const ym = addMonths(currentYM, k);
    const income = recInc + avg.income;
    const expense = recExp + avg.expense + (debtByYM.get(ym) || 0);
    const net = income - expense;
    bal += net;
    rows.push({ ym, income: Math.round(income), expense: Math.round(expense), net: Math.round(net), end: Math.round(bal), negative: bal < 0, debt: Math.round(debtByYM.get(ym) || 0) });
  }
  return { rows, assumptions: { recurringIncome: Math.round(recInc), recurringExpense: Math.round(recExp), avgOtherIncome: Math.round(avg.income), avgOtherExpense: Math.round(avg.expense), basedOnMonths: avg.months, startBalance } };
}
