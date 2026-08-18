import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS, ASSET_CLASSES, riskScore, profileOf, targetAllocation, currentAllocation, compareAllocation, prerequisites, dcaPlan, suggestMonthly, classOfItem, BASE_TARGETS } from '../js/features/allocation.js';

const sum = (o) => ASSET_CLASSES.reduce((a, k) => a + (o[k] || 0), 0);

test('điểm rủi ro & hồ sơ: thấp nhất → thận trọng, cao nhất → năng động, thiếu câu trả lời vẫn ra số', () => {
  const pick = (q, fn) => q.options.reduce((b, o) => (fn(o[1], b[1]) ? o : b))[0];
  const low = Object.fromEntries(QUESTIONS.map((q) => [q.key, pick(q, (a, b) => a < b)]));
  const high = Object.fromEntries(QUESTIONS.map((q) => [q.key, pick(q, (a, b) => a > b)]));
  assert.equal(riskScore(low), 0); assert.equal(profileOf(riskScore(low)), 'conservative');
  assert.equal(riskScore(high), 100); assert.equal(profileOf(riskScore(high)), 'aggressive');
  const mid = { age: 'u40', horizon: 'y5_10', income: 'stable', drop: 'hold', exp: 'funds', goal: 'balanced' };
  const s = riskScore(mid); assert.ok(s > 45 && s < 82, String(s));
  assert.equal(riskScore({}), 0);
  assert.equal(profileOf(30), 'moderate'); assert.equal(profileOf(70), 'growth');
});

test('phân bổ mục tiêu tổng 100, kỳ hạn ngắn giảm cổ phiếu, mọi hồ sơ hợp lệ', () => {
  for (const p of Object.keys(BASE_TARGETS)) {
    assert.equal(sum(BASE_TARGETS[p]), 100, p);
    for (const h of ['lt2', 'y2_5', 'y5_10', 'gt10']) assert.equal(sum(targetAllocation(p, { horizon: h })), 100, p + h);
  }
  const long = targetAllocation('growth', { horizon: 'gt10' }), short = targetAllocation('growth', { horizon: 'lt2' });
  assert.ok(short.stock < long.stock && short.fixed + short.cash > long.fixed + long.cash);
  assert.equal(long.stock, 55);
});

test('phân bổ hiện tại từ tài sản ròng: ví → tiền mặt, sổ TK → cố định, xe/phải thu bỏ qua', () => {
  const items = [
    { kind: 'account', name: 'Tiền mặt', value: 10_000_000, type: 'cash' },
    { kind: 'account', name: 'VCB', value: 30_000_000, type: 'bank' },
    { kind: 'account', name: 'Thẻ', value: -2_000_000, type: 'credit' },
    { kind: 'asset', name: 'Sổ TK', value: 100_000_000, type: 'savings' },
    { kind: 'asset', name: 'ETF', value: 40_000_000, type: 'fund' },
    { kind: 'asset', name: 'Vàng', value: 20_000_000, type: 'gold' },
    { kind: 'asset', name: 'Xe', value: 50_000_000, type: 'vehicle' },
    { kind: 'iou', name: 'Cho mượn', value: 5_000_000, type: 'receivable' },
    { kind: 'debt', name: 'Vay', value: -80_000_000, type: 'debt' },
  ];
  const cur = currentAllocation(items);
  assert.equal(cur.total, 200_000_000);
  assert.equal(cur.byClass.cash, 40_000_000); assert.equal(cur.byClass.fixed, 100_000_000); assert.equal(cur.byClass.stock, 40_000_000); assert.equal(cur.byClass.gold, 20_000_000);
  assert.equal(Math.round(cur.pct.fixed), 50);
  assert.equal(classOfItem({ kind: 'asset', type: 'crypto', value: 1 }), 'other');
  const cmp = compareAllocation(targetAllocation('balanced', { horizon: 'gt10' }), cur);
  const stock = cmp.rows.find((r) => r.cls === 'stock');
  assert.equal(stock.targetPct, 40); assert.equal(stock.action, 'add'); assert.equal(stock.deltaVND, 80_000_000 - 40_000_000);
  assert.equal(cmp.rows.find((r) => r.cls === 'gold').action, 'ok'); // 10% vs 10%
  assert.ok(cmp.needsRebalance);
  const empty = currentAllocation([]); assert.equal(empty.total, 0); assert.equal(empty.pct.cash, 0);
});

test('điều kiện tiên quyết: quỹ khẩn cấp < 3 tháng chặn, nợ lãi ≥ 20% chặn, còn lại cảnh báo', () => {
  assert.equal(prerequisites({ efCoveredMonths: 6, efTargetMonths: 6, highRateDebts: [] }).ok, true);
  const p1 = prerequisites({ efCoveredMonths: 1.5, efTargetMonths: 6 });
  assert.equal(p1.ok, false); assert.equal(p1.items[0].key, 'ef'); assert.equal(p1.items[0].level, 'block');
  const p2 = prerequisites({ efCoveredMonths: 4, efTargetMonths: 6, highRateDebts: [{ name: 'Thẻ', rate: 30, balance: 1 }, { name: 'Vay xe', rate: 9, balance: 1 }] });
  assert.equal(p2.ok, false); assert.deepEqual(p2.items.map((i) => [i.key, i.level]), [['ef', 'warn'], ['debt', 'block']]);
  assert.equal(p2.items[1].vars.n, 1);
  const p3 = prerequisites({ efCoveredMonths: 6, highRateDebts: [{ name: 'Vay', rate: 14, balance: 1 }] });
  assert.equal(p3.ok, true); assert.equal(p3.items[0].level, 'warn');
});

test('DCA: chia theo mục tiêu, dự phóng lãi kép, lợi suất 0 → bằng tổng góp', () => {
  const target = targetAllocation('balanced', { horizon: 'gt10' });
  const zero = dcaPlan({ monthly: 5_000_000, years: 2, target, returns: { cash: 0, fixed: 0, stock: 0, gold: 0, realestate: 0, other: 0 } });
  assert.equal(zero.contributed, 120_000_000);
  assert.equal(zero.projected, 120_000_000);
  assert.equal(sum(zero.perClass), 5_000_000);
  assert.equal(zero.yearly.length, 2); assert.equal(zero.yearly[1].value, 120_000_000);
  const g = dcaPlan({ monthly: 5_000_000, years: 10, target });
  assert.ok(g.projected > g.contributed && g.contributed === 600_000_000, `${g.projected} vs ${g.contributed}`);
  assert.equal(g.yearly.length, 10);
  const withStart = dcaPlan({ monthly: 0, years: 1, target, returns: { cash: 12, fixed: 0, stock: 0, gold: 0, realestate: 0, other: 0 }, startByClass: { cash: 1_000_000 } });
  assert.ok(withStart.projected > 1_120_000 && withStart.projected < 1_130_000, String(withStart.projected));
});

test('gợi ý số tiền đầu tư mỗi tháng', () => {
  const s = suggestMonthly({ avgIncome: 20_000_000, avgExpense: 12_000_000, debtPayments: 3_000_000, efMissing: 24_000_000, efMonthsToFill: 12 });
  assert.equal(s.surplus, 5_000_000); assert.equal(s.efPart, 2_000_000); assert.equal(s.investable, 3_000_000);
  assert.equal(suggestMonthly({ avgIncome: 1, avgExpense: 5 }).investable, 0);
});
