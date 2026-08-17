import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRule, occurrenceAt, nextOccurrence, dueOccurrences, runRecurring } from '../js/features/recurring.js';

const salary = (over = {}) => makeRule({
  name: 'Lương', template: { type: 'income', amount: 15_000_000, category: 'Lương', accountId: 'cash' },
  freq: 'monthly', interval: 1, byMonthDay: 1, startDate: '2026-05-01', ...over,
});

test('monthly: kỳ thứ k đúng ngày 01', () => {
  const r = salary();
  assert.equal(occurrenceAt(r, 0), '2026-05-01');
  assert.equal(occurrenceAt(r, 3), '2026-08-01');
  assert.equal(occurrenceAt(r, 8), '2027-01-01');
});

test('monthly: ngày 31 tự co về cuối tháng ngắn', () => {
  const r = makeRule({ freq: 'monthly', byMonthDay: 31, startDate: '2026-01-31', template: { amount: 1 } });
  assert.equal(occurrenceAt(r, 1), '2026-02-28');
  assert.equal(occurrenceAt(r, 3), '2026-04-30');
  assert.equal(occurrenceAt(r, 4), '2026-05-31');
});

test('monthly: startDate sau byMonthDay → kỳ đầu là tháng kế', () => {
  const r = makeRule({ freq: 'monthly', byMonthDay: 5, startDate: '2026-08-20', template: { amount: 1 } });
  assert.equal(occurrenceAt(r, 0), '2026-09-05');
});

test('3 tháng không mở app → bù đủ 3 kỳ (lỗi #6, nay tổng quát)', () => {
  const r = salary({ lastDate: '2026-05-01' });
  const { toAdd, newLastDate } = dueOccurrences(r, '2026-08-16');
  assert.deepEqual(toAdd.map((o) => o.date), ['2026-06-01', '2026-07-01', '2026-08-01']);
  assert.equal(newLastDate, '2026-08-01');
});

test('lần đầu (lastDate null) từ startDate tới nay', () => {
  const r = salary({ startDate: '2026-08-01' });
  const { toAdd } = dueOccurrences(r, '2026-08-16');
  assert.deepEqual(toAdd.map((o) => o.date), ['2026-08-01']);
});

test('kỳ đã bỏ qua (skippedDates) không sinh nhưng watermark vẫn tiến', () => {
  const r = salary({ lastDate: '2026-05-01', skippedDates: ['2026-07-01'] });
  const { toAdd, newLastDate } = dueOccurrences(r, '2026-08-16');
  assert.deepEqual(toAdd.map((o) => o.date), ['2026-06-01', '2026-08-01']);
  assert.equal(newLastDate, '2026-08-01');
});

test('tương thích lương cũ: periodKey "YYYY-MM" đã có → không sinh trùng', () => {
  const r = salary({ startDate: '2026-06-01' });
  const { toAdd } = dueOccurrences(r, '2026-08-16', new Set(['2026-06', '2026-08-01']));
  assert.deepEqual(toAdd.map((o) => o.date), ['2026-07-01']);
});

test('rule tắt / endDate / chưa tới hạn → không sinh', () => {
  assert.equal(dueOccurrences(salary({ enabled: false }), '2026-08-16').toAdd.length, 0);
  assert.equal(dueOccurrences(salary({ endDate: '2026-05-31' }), '2026-08-16').toAdd.length, 1);
  assert.equal(dueOccurrences(salary({ startDate: '2026-09-01' }), '2026-08-16').toAdd.length, 0);
});

test('weekly interval 2, daily, yearly (29/02 → 28/02 năm thường)', () => {
  const w = makeRule({ freq: 'weekly', interval: 2, startDate: '2026-08-03', template: { amount: 1 } });
  assert.deepEqual(dueOccurrences(w, '2026-09-01').toAdd.map((o) => o.date), ['2026-08-03', '2026-08-17', '2026-08-31']);
  const d = makeRule({ freq: 'daily', startDate: '2026-08-14', template: { amount: 1 } });
  assert.equal(dueOccurrences(d, '2026-08-16').toAdd.length, 3);
  const y = makeRule({ freq: 'yearly', startDate: '2024-02-29', byMonthDay: 29, template: { amount: 1 } });
  assert.equal(occurrenceAt(y, 1), '2025-02-28');
  assert.equal(occurrenceAt(y, 4), '2028-02-29');
});

test('nextOccurrence bỏ qua kỳ skipped và tôn trọng endDate', () => {
  const r = salary({ skippedDates: ['2026-09-01'] });
  assert.equal(nextOccurrence(r, '2026-08-16'), '2026-10-01');
  assert.equal(nextOccurrence(salary({ endDate: '2026-08-31' }), '2026-08-16'), null);
});

test('runRecurring: nhiều rule, dựng existingKeys từ recurringId, trả ruleUpdates', () => {
  const r1 = salary({ id: 'r1', lastDate: '2026-06-01' });
  const r2 = makeRule({ id: 'r2', freq: 'monthly', byMonthDay: 15, startDate: '2026-07-15', template: { type: 'expense', amount: 200000, category: 'Hóa đơn', note: 'Internet' } });
  const tx = [{ recurringId: 'r1', periodKey: '2026-07', date: '2026-07-01', source: 'auto-salary' }];
  const { toAdd, ruleUpdates } = runRecurring([r1, r2], tx, '2026-08-16');
  const dates = toAdd.map((t) => `${t.recurringId}:${t.date}`).sort();
  assert.deepEqual(dates, ['r1:2026-08-01', 'r2:2026-07-15', 'r2:2026-08-15']);
  assert.equal(ruleUpdates.get('r1'), '2026-08-01');
  assert.equal(ruleUpdates.get('r2'), '2026-08-15');
  const t = toAdd.find((x) => x.recurringId === 'r2');
  assert.equal(t.source, 'recurring');
  assert.equal(t.note, 'Internet');
  assert.equal(t.amount, 200000);
});

test('makeRule giữ cờ legacySalary và chuẩn hóa dữ liệu bẩn', () => {
  const r = makeRule({ legacySalary: true, freq: 'bogus', interval: -3, template: { type: 'x', amount: '1e3' } });
  assert.equal(r.legacySalary, true);
  assert.equal(r.freq, 'monthly');
  assert.equal(r.interval, 1);
  assert.equal(r.template.type, 'expense');
  assert.equal(r.template.amount, 1000);
});
