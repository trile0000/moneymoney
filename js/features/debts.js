// Quản lý nợ: lịch trả nợ (annuity), trạng thái, so sánh snowball vs avalanche, lãi tiết kiệm khi trả sớm — thuần túy.
// debt: { id, name, kind: 'loan'|'installment'|'creditcard'|'other', principal, rate (%/năm), termMonths, startDate, paymentDay,
//         extraPayments: [{ id, date, amount }], note, createdAt, closedAt? }
import { uuid } from '../utils/id.js';
import { isValidYMD, toLocalYMD, addMonths } from '../utils/date.js';

export const DEBT_KINDS = ['loan', 'installment', 'creditcard', 'other'];

export function makeDebt(p = {}) {
  return {
    id: p.id || uuid(),
    name: String(p.name || '').trim() || 'Khoản vay',
    kind: DEBT_KINDS.includes(p.kind) ? p.kind : 'loan',
    principal: Math.max(0, Math.round(Number(p.principal) || 0)),
    rate: Math.max(0, Number(p.rate) || 0),
    termMonths: Math.max(1, Math.round(Number(p.termMonths) || 1)),
    startDate: isValidYMD(p.startDate) ? p.startDate : toLocalYMD(),
    paymentDay: Math.min(31, Math.max(1, Math.round(Number(p.paymentDay) || Number(String(p.startDate || '').slice(8, 10)) || 1))),
    extraPayments: Array.isArray(p.extraPayments) ? p.extraPayments.filter((x) => x && Number(x.amount) > 0).map((x) => ({ id: x.id || uuid(), date: isValidYMD(x.date) ? x.date : toLocalYMD(), amount: Math.round(Number(x.amount)) })) : [],
    note: String(p.note || '').trim(),
    createdAt: p.createdAt || Date.now(),
    closedAt: Number(p.closedAt) || null,
  };
}

/** Khoản trả hàng tháng theo công thức niên kim; lãi 0 → chia đều */
export function monthlyPayment(principal, ratePct, months) {
  const r = ratePct / 100 / 12;
  if (months <= 0) return principal;
  if (r === 0) return principal / months;
  return principal * r / (1 - Math.pow(1 + r, -months));
}

function clampDay(ym, day) { const [y, m] = ym.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return `${ym}-${String(Math.min(day, last)).padStart(2, '0')}`; }

/**
 * Lịch trả nợ đầy đủ. extraPayments được trừ vào gốc tại kỳ có ngày >= ngày trả thêm.
 * @returns {{ rows: [{k, date, payment, interest, principal, extra, balance}], payment, totalInterest, totalPaid, months, payoffDate }}
 */
export function schedule(debt) {
  const rows = [];
  const r = debt.rate / 100 / 12;
  const pay = monthlyPayment(debt.principal, debt.rate, debt.termMonths);
  let balance = debt.principal;
  const startYM = debt.startDate.slice(0, 7);
  const extras = debt.extraPayments.slice().sort((a, b) => a.date.localeCompare(b.date));
  let ei = 0, totalInterest = 0, totalPaid = 0, k = 0;
  const firstDate = clampDay(startYM, debt.paymentDay) >= debt.startDate ? clampDay(startYM, debt.paymentDay) : clampDay(addMonths(startYM, 1), debt.paymentDay);
  let ym = firstDate.slice(0, 7);
  while (balance > 0.5 && k < 1200) {
    k++;
    const date = clampDay(ym, debt.paymentDay);
    const interest = balance * r;
    let principalPart = Math.min(balance, pay - interest);
    if (principalPart < 0) principalPart = 0;
    let extra = 0;
    while (ei < extras.length && extras[ei].date <= date) { extra += extras[ei].amount; ei++; }
    extra = Math.min(extra, Math.max(0, balance - principalPart));
    const payment = interest + principalPart + extra;
    balance = Math.max(0, balance - principalPart - extra);
    totalInterest += interest; totalPaid += payment;
    rows.push({ k, date, payment: Math.round(payment), interest: Math.round(interest), principal: Math.round(principalPart), extra: Math.round(extra), balance: Math.round(balance) });
    ym = addMonths(ym, 1);
  }
  return { rows, payment: Math.round(pay), totalInterest: Math.round(totalInterest), totalPaid: Math.round(totalPaid), months: rows.length, payoffDate: rows.length ? rows[rows.length - 1].date : null };
}

/** Trạng thái tới ngày todayYMD: dư nợ, đã trả, kỳ kế tiếp */
export function debtStatus(debt, todayYMD) {
  const s = schedule(debt);
  const paidRows = s.rows.filter((row) => row.date <= todayYMD);
  const balance = paidRows.length ? paidRows[paidRows.length - 1].balance : debt.principal;
  const next = s.rows.find((row) => row.date > todayYMD) || null;
  const paidPrincipal = debt.principal - balance;
  const paidInterest = paidRows.reduce((a, row) => a + row.interest, 0);
  return { balance, paidPrincipal, paidInterest, next, monthsLeft: s.rows.length - paidRows.length, payment: s.payment, totalInterest: s.totalInterest, payoffDate: s.payoffDate, pct: debt.principal ? paidPrincipal / debt.principal : 0, done: balance <= 0.5 };
}

/**
 * Mô phỏng trả nợ nhiều khoản với ngân sách thêm mỗi tháng (extraMonthly) theo chiến lược.
 * @param {Array} debts  [{ name, balance, rate, payment }] (số dư hiện tại, lãi %/năm, khoản tối thiểu/tháng)
 * @param {number} extraMonthly
 * @param {'snowball'|'avalanche'} strategy
 * @returns {{ months, totalInterest, order: string[], timeline: [{month, balances}] }}
 */
export function simulatePayoff(debts, extraMonthly, strategy) {
  const list = debts.filter((d) => d.balance > 0).map((d) => ({ ...d, bal: d.balance, done: false }));
  const order = [];
  let months = 0, totalInterest = 0;
  const timeline = [];
  while (list.some((d) => !d.done) && months < 600) {
    months++;
    let extra = extraMonthly + list.filter((d) => d.done).reduce((a, d) => a + d.payment, 0); // snowball: khoản đã xong dồn sang
    const active = list.filter((d) => !d.done);
    const sorted = active.slice().sort((a, b) => strategy === 'avalanche' ? b.rate - a.rate || a.bal - b.bal : a.bal - b.bal || b.rate - a.rate);
    for (const d of active) {
      const interest = d.bal * d.rate / 100 / 12;
      totalInterest += interest;
      d.bal += interest;
      const p = Math.min(d.bal, d.payment);
      d.bal -= p;
      if (p < d.payment) extra += d.payment - p;
    }
    for (const d of sorted) {
      if (extra <= 0) break;
      const p = Math.min(d.bal, extra);
      d.bal -= p; extra -= p;
    }
    for (const d of sorted) if (!d.done && d.bal <= 0.5) { d.done = true; d.bal = 0; order.push(d.name); }
    timeline.push({ month: months, balances: list.map((d) => Math.round(d.bal)) });
  }
  return { months, totalInterest: Math.round(totalInterest), order, timeline };
}

/** Lãi tiết kiệm & số tháng rút ngắn nếu trả thêm extra/tháng cho một khoản */
export function prepaySavings(debt, extraMonthly) {
  const base = schedule(debt);
  const s = schedule(makeDebt({ ...debt, extraPayments: [...debt.extraPayments, ...base.rows.map((row) => ({ date: row.date, amount: extraMonthly }))] }));
  return { baseMonths: base.months, newMonths: s.months, monthsSaved: base.months - s.months, baseInterest: base.totalInterest, newInterest: s.totalInterest, interestSaved: base.totalInterest - s.totalInterest };
}
