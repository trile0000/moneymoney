import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSalaryBackfill } from '../js/features/recurring.js';

const base = { salary: 15_000_000, salaryCategory: 'Lương', salaryEnabled: null, lastSalaryPeriod: null };

test('không cấu hình lương → không thêm gì', () => {
  const r = computeSalaryBackfill({ settings: { ...base, salary: 0 }, transactions: [], todayYM: '2026-08' });
  assert.equal(r.toAdd.length, 0);
});

test('lần đầu (chưa có lastSalaryPeriod, chưa có lương tự động) → chỉ sinh tháng hiện tại, không bù ngược lịch sử', () => {
  const r = computeSalaryBackfill({ settings: base, transactions: [], todayYM: '2026-08' });
  assert.equal(r.toAdd.length, 1);
  assert.equal(r.toAdd[0].periodKey, '2026-08');
  assert.equal(r.toAdd[0].date, '2026-08-01');
  assert.equal(r.toAdd[0].source, 'auto-salary');
  assert.equal(r.toAdd[0].amount, 15_000_000);
  assert.equal(r.lastSalaryPeriod, '2026-08');
});

test('người dùng 3 tháng không mở app → bù đủ 3 kỳ còn thiếu (lỗi #6)', () => {
  const r = computeSalaryBackfill({ settings: { ...base, lastSalaryPeriod: '2026-05' }, transactions: [], todayYM: '2026-08' });
  assert.deepEqual(r.toAdd.map((t) => t.periodKey), ['2026-06', '2026-07', '2026-08']);
  assert.equal(r.lastSalaryPeriod, '2026-08');
});

test('không thêm trùng kỳ đã có lương tự động (kể cả đã bị xóa mềm)', () => {
  const tx = [
    { type: 'income', amount: 1, category: 'Lương', date: '2026-06-01', source: 'auto-salary', periodKey: '2026-06' },
    { type: 'income', amount: 1, category: 'Lương', date: '2026-07-01', source: 'auto-salary', periodKey: '2026-07', deletedAt: 123 },
  ];
  const r = computeSalaryBackfill({ settings: { ...base, lastSalaryPeriod: '2026-05' }, transactions: tx, todayYM: '2026-08' });
  assert.deepEqual(r.toAdd.map((t) => t.periodKey), ['2026-08']);
});

test('tháng đã có khoản thu THỦ CÔNG đúng danh mục lương → không thêm trùng; danh mục khác có chữ "lương" không bị nhầm (lỗi #7)', () => {
  const tx = [
    { type: 'income', amount: 15_000_000, category: 'lương', date: '2026-07-05', source: 'manual' },
    { type: 'income', amount: 30_000_000, category: 'Thưởng lương tháng 13', date: '2026-08-02', source: 'manual' },
  ];
  const r = computeSalaryBackfill({ settings: { ...base, lastSalaryPeriod: '2026-06' }, transactions: tx, todayYM: '2026-08' });
  assert.deepEqual(r.toAdd.map((t) => t.periodKey), ['2026-08']); // 07 đã có lương thủ công; 08 chỉ có thưởng → vẫn thêm
});

test('đổi danh mục lương thành "Thu nhập" không sinh trùng (dựa vào source, không dò chuỗi)', () => {
  const tx = [{ type: 'income', amount: 1, category: 'Lương', date: '2026-08-01', source: 'auto-salary', periodKey: '2026-08' }];
  const r = computeSalaryBackfill({ settings: { ...base, salaryCategory: 'Thu nhập', lastSalaryPeriod: '2026-07' }, transactions: tx, todayYM: '2026-08' });
  assert.equal(r.toAdd.length, 0);
});

test('lần đầu chạy cơ chế mới nhưng dữ liệu cũ đã có lương tự động từ T05 → bù các tháng thiếu từ T05 tới nay', () => {
  const tx = [
    { type: 'income', amount: 1, category: 'Lương', date: '2026-05-01', source: 'auto-salary', periodKey: '2026-05' },
    { type: 'income', amount: 1, category: 'Lương', date: '2026-07-01', source: 'auto-salary', periodKey: '2026-07' },
  ];
  const r = computeSalaryBackfill({ settings: base, transactions: tx, todayYM: '2026-08' });
  assert.deepEqual(r.toAdd.map((t) => t.periodKey), ['2026-06', '2026-08']);
});

test('lastSalaryPeriod ở tương lai (đổi giờ máy) → không làm gì, không crash', () => {
  const r = computeSalaryBackfill({ settings: { ...base, lastSalaryPeriod: '2027-01' }, transactions: [], todayYM: '2026-08' });
  assert.equal(r.toAdd.length, 0);
});

test('salaryEnabled=false tắt hẳn dù salary > 0', () => {
  const r = computeSalaryBackfill({ settings: { ...base, salaryEnabled: false }, transactions: [], todayYM: '2026-08' });
  assert.equal(r.toAdd.length, 0);
});
