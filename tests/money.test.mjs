import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatVND, groupDigits } from '../js/utils/money.js';

const cases = [
  ['50k', 50_000],
  ['50K', 50_000],
  ['50 k', 50_000],
  ['50 nghìn', 50_000],
  ['50 ngàn', 50_000],
  ['500n', 500_000],
  ['1tr', 1_000_000],
  ['1 triệu', 1_000_000],
  ['1trieu', 1_000_000],
  ['1m', 1_000_000],
  ['1.5m', 1_500_000],
  ['1,5m', 1_500_000],
  ['1tr5', 1_500_000],
  ['1tr2', 1_200_000],
  ['1tr25', 1_250_000],
  ['1tr250', 1_250_000],
  ['1tr250k', 1_250_000],
  ['1tr 250k', 1_250_000],
  ['2tr5k', 2_005_000],
  ['1.5tr', 1_500_000],
  ['1,5tr', 1_500_000],
  ['0.5tr', 500_000],
  ['2tỷ', 2_000_000_000],
  ['2 tỉ', 2_000_000_000],
  ['1tỷ5', 1_500_000_000],
  ['1.250.000', 1_250_000],
  ['1,250,000', 1_250_000],
  ['1 250 000', 1_250_000],
  ['1250000', 1_250_000],
  ['1.250.000đ', 1_250_000],
  ['1.250.000 đ', 1_250_000],
  ['1.250.000 vnd', 1_250_000],
  ['1.250.000d', 1_250_000],
  ['456.456', 456_456],
  ['15tr', 15_000_000],
  ['15tr đ', 15_000_000],
];

for (const [input, expected] of cases) {
  test(`parseAmount('${input}') = ${expected}`, () => {
    const r = parseAmount(input);
    assert.equal(r.value, expected, `got ${r.value}`);
    assert.equal(r.ok, true);
  });
}

test('parseAmount: chuỗi rỗng / rác → null, không âm thầm ra số sai', () => {
  assert.equal(parseAmount('').value, null);
  assert.equal(parseAmount('abc').value, null);
  assert.equal(parseAmount('k50').value, null);
  assert.equal(parseAmount('5k1tr').value, null); // đơn vị không giảm dần
  assert.equal(parseAmount('0').ok, false); // 0 không hợp lệ (nhưng value = 0)
  assert.equal(parseAmount('0').value, 0);
});

test('formatVND', () => {
  assert.equal(formatVND(1250000), '1.250.000 đ');
  assert.equal(formatVND(0), '0 đ');
  assert.equal(formatVND(-5000), '-5.000 đ');
  assert.equal(formatVND(1250000, { withUnit: false }), '1.250.000');
});

test('groupDigits', () => {
  assert.equal(groupDigits('1250000'), '1.250.000');
  assert.equal(groupDigits('1.250'), '1.250');
  assert.equal(groupDigits(''), '');
});
