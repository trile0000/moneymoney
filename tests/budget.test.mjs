import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spentByCategory, sumFor, avgPrevMonths, budgetStatus, dailyAllowance, makeBudget } from '../js/features/budgets.js';
import { compute503020 } from '../js/features/rule503020.js';
import { avgEssentialMonthly, efStatus, investWarning } from '../js/features/emergencyFund.js';
import { makeGoal, goalStatus, monthsUntil } from '../js/features/goals.js';
import { buildInsights, monthlyEquivalent, findSubscriptionSuspects } from '../js/features/insights.js';
import { makeCategory } from '../js/features/categories.js';

const cats = [
  makeCategory({ id: 'food', name: 'Ăn uống', group: 'need' }),
  makeCategory({ id: 'coffee', name: 'Cà phê', parentId: 'food' }),
  makeCategory({ id: 'fun', name: 'Giải trí', group: 'want' }),
  makeCategory({ id: 'invest', name: 'Đầu tư', group: 'save' }),
  makeCategory({ id: 'misc', name: 'Khác' }),
  makeCategory({ id: 'sal', name: 'Lương', kind: 'income' }),
];
const tx = (type, amount, categoryId, extra = {}) => ({ type, amount, categoryId, date: '2026-08-10', ...extra });
function idx(obj) { const m = new Map(); for (const [k, items] of Object.entries(obj)) { let income = 0, expense = 0; for (const t of items) { if (t.type === 'income') income += t.amount; else if (t.type === 'expense') expense += t.amount; } m.set(k, { income, expense, items }); } return m; }

test('spentByCategory / sumFor / budgetStatus / dailyAllowance', () => {
  const items = [tx('expense', 100, 'food'), tx('expense', 50, 'coffee'), tx('expense', 30, 'fun'), tx('transfer', 999), tx('income', 1000, 'sal'), { ...tx('expense', 77, 'food'), deletedAt: 1 }];
  const sp = spentByCategory(items);
  assert.equal(sp.get('food'), 100); assert.equal(sp.get('coffee'), 50);
  assert.equal(sumFor(sp, new Set(['food', 'coffee'])), 150);
  assert.equal(sumFor(sp, null), 180);
  const st = budgetStatus(200, 150, 100);
  assert.equal(st.level, 'ok'); assert.equal(st.pct, 0.75); assert.equal(st.remaining, 50); assert.equal(st.vsAvgPct, 0.5);
  assert.equal(budgetStatus(200, 170, 0).level, 'warn');
  assert.equal(budgetStatus(200, 250, 0).level, 'over');
  assert.equal(budgetStatus(0, 10, 0).pct, 0);
  const da = dailyAllowance(310000, '2026-08-01', '2026-08');
  assert.equal(da.daysLeft, 31); assert.equal(Math.round(da.perDay), 10000);
  assert.equal(dailyAllowance(1, '2026-09-01', '2026-08'), null);
  assert.equal(makeBudget({ amount: '5tr' }).amount, 0);
});

test('avgPrevMonths chỉ tính các tháng có ghi chép', () => {
  const mi = idx({ '2026-07': [tx('expense', 300, 'food')], '2026-06': [tx('expense', 600, 'food')], '2026-05': [] });
  assert.equal(avgPrevMonths(mi, '2026-08', new Set(['food']), 3), 450); // (300+600)/2
  assert.equal(avgPrevMonths(mi, '2026-08', new Set(['fun']), 3), 0);
});

test('50/30/20: nhóm kế thừa cha, chưa xếp nhóm, phần dư', () => {
  const items = [tx('income', 10_000_000, 'sal'), tx('expense', 4_000_000, 'food'), tx('expense', 1_000_000, 'coffee'), tx('expense', 2_000_000, 'fun'), tx('expense', 500_000, 'invest'), tx('expense', 500_000, 'misc'), tx('transfer', 3_000_000)];
  const r = compute503020(items, cats, { need: 50, want: 30, save: 20 });
  assert.equal(r.income, 10_000_000);
  assert.equal(r.spend.need, 5_000_000);
  assert.equal(r.spend.want, 2_000_000);
  assert.equal(r.spend.save, 500_000);
  assert.equal(r.spend.unassigned, 500_000);
  assert.equal(r.ratios.need, 0.5);
  assert.deepEqual(r.unassignedCategoryIds, ['misc']);
  assert.equal(r.leftover, 2_000_000);
  assert.equal(r.target.want, 0.3);
  const r2 = compute503020([tx('expense', 100, 'fun')], cats);
  assert.equal(r2.baseIsIncome, false); assert.equal(r2.ratios.want, 1);
});

test('quỹ khẩn cấp: TB chi thiết yếu 6 tháng trước, trạng thái, cảnh báo đầu tư', () => {
  const mi = idx({ '2026-08': [tx('expense', 9_000_000, 'food')], '2026-07': [tx('expense', 5_000_000, 'food'), tx('expense', 9_000_000, 'fun')], '2026-06': [tx('expense', 7_000_000, 'food')], '2026-05': [] });
  const a = avgEssentialMonthly(mi, cats, '2026-08', 6);
  assert.equal(a.avg, 6_000_000); assert.equal(a.months, 2); assert.equal(a.usedFallback, false);
  const st = efStatus(12_000_000, 6_000_000, 6);
  assert.equal(st.target, 36_000_000); assert.equal(st.coveredMonths, 2); assert.equal(st.level, 'low'); assert.equal(st.missing, 24_000_000);
  assert.equal(efStatus(40_000_000, 6_000_000, 6).level, 'ok');
  assert.equal(investWarning({ investSpend: 3_000_000, income: 10_000_000, coveredMonths: 1 }), true);
  assert.equal(investWarning({ investSpend: 3_000_000, income: 10_000_000, coveredMonths: 4 }), false);
  // chưa xếp nhóm → fallback toàn bộ chi
  const noGroups = cats.map((c) => ({ ...c, group: null }));
  assert.equal(avgEssentialMonthly(mi, noGroups, '2026-08', 6).usedFallback, true);
  // chỉ có tháng hiện tại → dùng tháng hiện tại
  const onlyNow = idx({ '2026-08': [tx('expense', 4_000_000, 'food')] });
  assert.equal(avgEssentialMonthly(onlyNow, cats, '2026-08').avg, 4_000_000);
});

test('goals: monthsUntil, perMonth, done/overdue', () => {
  assert.equal(monthsUntil('2027-02-15', '2026-08-17'), 6);
  assert.equal(monthsUntil('2027-02-20', '2026-08-17'), 7);
  assert.equal(monthsUntil('2026-08-01', '2026-08-17'), 0);
  const g = makeGoal({ name: 'Xe', target: 60_000_000, deadline: '2027-02-15', contributions: [{ amount: 12_000_000, date: '2026-07-01' }, { amount: 'x' }] });
  const st = goalStatus(g, '2026-08-17');
  assert.equal(st.saved, 12_000_000); assert.equal(st.remaining, 48_000_000); assert.equal(st.monthsLeft, 6); assert.equal(st.perMonth, 8_000_000); assert.equal(st.pct, 0.2); assert.equal(st.done, false);
  const done = goalStatus(makeGoal({ target: 100, contributions: [{ amount: 100 }] }), '2026-08-17');
  assert.equal(done.done, true); assert.equal(done.perMonth, null);
  assert.equal(goalStatus(makeGoal({ target: 100, deadline: '2026-01-01' }), '2026-08-17').overdue, true);
});

test('insights: spike danh mục, tiết kiệm, định kỳ/thu nhập, subscription nghi ngờ, top5', () => {
  const rules = [{ enabled: true, template: { type: 'expense', amount: 1_200_000 }, freq: 'monthly', interval: 1 }, { enabled: true, template: { type: 'expense', amount: 120_000 }, freq: 'weekly', interval: 1 }, { enabled: false, template: { type: 'expense', amount: 9e9 }, freq: 'monthly', interval: 1 }];
  assert.equal(monthlyEquivalent(rules[0]), 1_200_000);
  assert.equal(Math.round(monthlyEquivalent(rules[1])), 520_000);
  const sub = (m) => tx('expense', 79_000, 'fun', { note: 'Netflix', date: `${m}-05` });
  const mi = idx({
    '2026-08': [tx('income', 10_000_000, 'sal'), tx('expense', 3_000_000, 'food'), tx('expense', 500_000, 'coffee'), sub('2026-08'), tx('expense', 1_500_000, 'fun', { note: 'phim' }), tx('expense', 700_000, 'misc')],
    '2026-07': [tx('income', 10_000_000, 'sal'), tx('expense', 1_000_000, 'food'), sub('2026-07')],
    '2026-06': [tx('income', 10_000_000, 'sal'), tx('expense', 1_000_000, 'food'), sub('2026-06')],
    '2026-05': [tx('expense', 1_000_000, 'food')],
  });
  const ins = buildInsights({ monthIndex: mi, ym: '2026-08', categories: cats, rules });
  const keys = ins.map((i) => i.key);
  assert.ok(keys.includes('insight.catSpike'), keys.join());
  const spike = ins.find((i) => i.key === 'insight.catSpike' && i.vars.cat.includes('Ăn uống'));
  assert.equal(spike.vars.pct, 250); // 3.5tr vs TB 1tr (3 tháng đều có dữ liệu)
  assert.equal(ins.filter((i) => i.key === 'insight.catSpike').length, 2); // Giải trí cũng tăng vọt
  assert.ok(keys.includes('insight.savingsGood'));
  const rs = ins.find((i) => i.key === 'insight.recurringShare');
  assert.equal(rs.vars.pct, 17);
  const s = ins.find((i) => i.key === 'insight.subscription');
  assert.equal(s.vars.amount, 79_000); assert.equal(s.vars.note, 'Netflix');
  assert.ok(keys.includes('insight.top5'));
  assert.equal(findSubscriptionSuspects(mi, '2026-08', 3).length, 1);
  assert.equal(buildInsights({ monthIndex: mi, ym: '2020-01', categories: cats, rules }).length, 0);
});
