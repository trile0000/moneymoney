import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDebt, monthlyPayment, schedule, debtStatus, simulatePayoff, prepaySavings } from '../js/features/debts.js';
import { makeAsset, computeNetWorth, upsertSnapshot, diversification } from '../js/features/networth.js';
import { forecast, avgNonRecurring } from '../js/features/forecast.js';
import { healthScore, healthTier, savingsRate, spendingCV } from '../js/features/health.js';
import { computeStreak, earnedBadges, positiveMonthsInRow } from '../js/features/achievements.js';
import { makeAccount } from '../js/features/accounts.js';

function idx(obj) { const m = new Map(); for (const [k, items] of Object.entries(obj)) { let income = 0, expense = 0; for (const t of items) { if (t.type === 'income') income += t.amount; else if (t.type === 'expense') expense += t.amount; } m.set(k, { income, expense, items }); } return m; }
const tx = (type, amount, extra = {}) => ({ type, amount, ...extra });

test('monthlyPayment: niên kim & lãi 0', () => {
  assert.equal(Math.round(monthlyPayment(120_000_000, 12, 12)), 10_661_855);
  assert.equal(monthlyPayment(12_000_000, 0, 12), 1_000_000);
});

test('schedule: 12 kỳ, dư nợ về 0, tổng lãi hợp lý; trả thêm rút ngắn kỳ', () => {
  const d = makeDebt({ name: 'Vay', principal: 120_000_000, rate: 12, termMonths: 12, startDate: '2026-01-05', paymentDay: 5 });
  const s = schedule(d);
  assert.equal(s.months, 12);
  assert.equal(s.rows[0].date, '2026-01-05');
  assert.equal(s.rows[11].balance, 0);
  assert.ok(s.totalInterest > 7_000_000 && s.totalInterest < 8_500_000, String(s.totalInterest));
  assert.equal(s.payoffDate, '2026-12-05');
  const d2 = makeDebt({ ...d, extraPayments: [{ date: '2026-03-01', amount: 60_000_000 }] });
  const s2 = schedule(d2);
  assert.ok(s2.months < 12 && s2.totalInterest < s.totalInterest);
  assert.equal(s2.rows[2].extra, 60_000_000);
});

test('schedule: startDate sau paymentDay → kỳ đầu tháng kế; ngày 31 co về cuối tháng', () => {
  const d = makeDebt({ principal: 1_000_000, rate: 0, termMonths: 2, startDate: '2026-01-20', paymentDay: 31 });
  const s = schedule(d);
  assert.equal(s.rows[0].date, '2026-01-31');
  assert.equal(s.rows[1].date, '2026-02-28');
});

test('debtStatus tới hôm nay', () => {
  const d = makeDebt({ principal: 12_000_000, rate: 0, termMonths: 12, startDate: '2026-01-01', paymentDay: 1 });
  const st = debtStatus(d, '2026-08-17');
  assert.equal(st.paidPrincipal, 8_000_000);
  assert.equal(st.balance, 4_000_000);
  assert.equal(st.next.date, '2026-09-01');
  assert.equal(st.monthsLeft, 4);
  assert.equal(st.done, false);
  assert.equal(debtStatus(d, '2027-06-01').done, true);
});

test('snowball vs avalanche: avalanche ít lãi hơn, snowball xong khoản nhỏ trước', () => {
  const debts = [
    { name: 'Thẻ TD', balance: 20_000_000, rate: 30, payment: 1_000_000 },
    { name: 'Vay xe', balance: 60_000_000, rate: 9, payment: 2_500_000 },
    { name: 'Vay bạn', balance: 5_000_000, rate: 0, payment: 500_000 },
  ];
  const sb = simulatePayoff(debts, 2_000_000, 'snowball');
  const av = simulatePayoff(debts, 2_000_000, 'avalanche');
  assert.equal(sb.order[0], 'Vay bạn');
  assert.equal(av.order[0], 'Thẻ TD');
  assert.ok(av.totalInterest <= sb.totalInterest, `${av.totalInterest} vs ${sb.totalInterest}`);
  assert.ok(sb.months > 0 && sb.months < 60);
  assert.equal(simulatePayoff([], 1, 'snowball').months, 0);
});

test('prepaySavings: trả thêm 2tr/tháng tiết kiệm lãi và rút ngắn', () => {
  const d = makeDebt({ principal: 120_000_000, rate: 12, termMonths: 24, startDate: '2026-01-05' });
  const r = prepaySavings(d, 2_000_000);
  assert.ok(r.monthsSaved >= 5, String(r.monthsSaved));
  assert.ok(r.interestSaved > 2_000_000, String(r.interestSaved));
});

test('net worth: ví + tài sản − nợ; snapshot upsert; đa dạng hóa', () => {
  const accs = [makeAccount({ id: 'c', name: 'Tiền mặt', type: 'cash' }), makeAccount({ id: 'cc', name: 'Thẻ', type: 'credit', credit: {} }), makeAccount({ id: 'x', name: 'Cũ', archived: true })];
  const bal = new Map([['c', 5_000_000], ['cc', -2_000_000], ['x', 999]]);
  const assets = [makeAsset({ name: 'Sổ TK', type: 'savings', value: 50_000_000 }), makeAsset({ name: 'Vàng', type: 'gold', value: 30_000_000 }), makeAsset({ name: 'Nợ người thân', type: 'other', value: 10_000_000, liability: true })];
  const nw = computeNetWorth({ accounts: accs, balances: bal, assets, debtBalances: [{ name: 'Vay', balance: 20_000_000 }] });
  assert.equal(nw.assets, 85_000_000);
  assert.equal(nw.liabilities, 32_000_000);
  assert.equal(nw.net, 53_000_000);
  const dv = diversification(nw.byType);
  assert.equal(dv.count, 3); // cash, savings, gold
  let snaps = upsertSnapshot([], '2026-07', { assets: 1, liabilities: 0 });
  snaps = upsertSnapshot(snaps, '2026-08', { assets: 2, liabilities: 1 });
  snaps = upsertSnapshot(snaps, '2026-08', { assets: 3, liabilities: 1 });
  assert.equal(snaps.length, 2); assert.equal(snaps[1].net, 2);
});

test('forecast: TB không định kỳ + rule + trả nợ, đánh dấu tháng âm', () => {
  const mi = idx({
    '2026-07': [tx('income', 20_000_000, { recurringId: 'r' }), tx('expense', 8_000_000), tx('expense', 500_000, { recurringId: 'r2' })],
    '2026-06': [tx('income', 20_000_000, { recurringId: 'r' }), tx('expense', 10_000_000)],
  });
  const avg = avgNonRecurring(mi, '2026-08', 3);
  assert.equal(avg.expense, 9_000_000); assert.equal(avg.income, 0); assert.equal(avg.months, 2);
  const rules = [{ enabled: true, freq: 'monthly', interval: 1, template: { type: 'income', amount: 20_000_000 } }, { enabled: true, freq: 'monthly', interval: 1, template: { type: 'expense', amount: 5_000_000 } }];
  const f = forecast({ monthIndex: mi, currentYM: '2026-08', startBalance: 3_000_000, rules, debtPayments: [{ ym: '2026-10', amount: 15_000_000 }], months: 3 });
  assert.equal(f.rows.length, 3);
  assert.equal(f.rows[0].ym, '2026-09');
  assert.equal(f.rows[0].income, 20_000_000); assert.equal(f.rows[0].expense, 14_000_000); assert.equal(f.rows[0].end, 9_000_000);
  assert.equal(f.rows[1].expense, 29_000_000); assert.equal(f.rows[1].end, 0);
  assert.equal(f.rows[1].negative, false);
  const f2 = forecast({ monthIndex: mi, currentYM: '2026-08', startBalance: 0, rules: [rules[1]], months: 2 });
  assert.equal(f2.rows[0].negative, true);
});

test('điểm sức khỏe: thành phần, tổng 0..100, tier', () => {
  const mi = idx({
    '2026-08': [tx('income', 20_000_000), tx('expense', 14_000_000)],
    '2026-07': [tx('income', 20_000_000), tx('expense', 15_000_000)],
    '2026-06': [tx('income', 20_000_000), tx('expense', 16_000_000)],
    '2026-05': [tx('income', 20_000_000), tx('expense', 15_500_000)],
  });
  const sr = savingsRate(mi, '2026-08', 3);
  assert.equal(Math.round(sr.rate * 100), 25);
  const cv = spendingCV(mi, '2026-08', 6);
  assert.ok(cv.cv < 0.05);
  const h = healthScore({ monthIndex: mi, currentYM: '2026-08', efCoveredMonths: 3, monthlyDebtPayments: 2_000_000, diversifyCount: 2 });
  assert.equal(h.components.length, 5);
  const c = Object.fromEntries(h.components.map((x) => [x.key, x]));
  assert.equal(c.savings.ratio, 1);
  assert.equal(c.emergency.ratio, 0.5);
  assert.equal(c.dti.ratio, 1); // 10%
  assert.equal(c.stability.ratio, 1);
  assert.equal(c.diversify.ratio, 0.5);
  assert.equal(h.score, 25 + 12.5 + 20 + 15 + 7.5);
  assert.equal(healthTier(h.score), 3);
  assert.equal(healthTier(20), 0); assert.equal(healthTier(90), 4);
  const empty = healthScore({ monthIndex: new Map(), currentYM: '2026-08' });
  assert.ok(empty.score >= 0 && empty.score <= 100);
});

test('streak & huy hiệu', () => {
  const day = (d, h = 10) => new Date(2026, 7, d, h).getTime();
  const txs = [{ createdAt: day(14) }, { createdAt: day(15) }, { createdAt: day(16) }, { createdAt: day(16, 20) }, { createdAt: day(10) }, { createdAt: day(12), source: 'recurring' }];
  const s = computeStreak(txs, '2026-08-17');
  assert.equal(s.current, 3); // 14,15,16 (hôm qua = 16)
  assert.equal(s.best, 3);
  assert.equal(s.days, 4);
  assert.equal(computeStreak(txs, '2026-08-19').current, 0);
  assert.equal(computeStreak([], '2026-08-17').current, 0);
  const b = earnedBadges({ txCount: 150, streakBest: 7, budgets: 1, goalsDone: 0, efMonths: 3.2, healthScore: 71, positiveMonthsInRow: 1 });
  assert.deepEqual(b, ['first_tx', 'tx_100', 'streak_7', 'first_budget', 'ef_3', 'health_70']);
  const mi = idx({ '2026-07': [tx('income', 10, {}), tx('expense', 5)], '2026-06': [tx('income', 10), tx('expense', 5)], '2026-05': [tx('income', 1), tx('expense', 5)] });
  assert.equal(positiveMonthsInRow(mi, '2026-08'), 2);
});
