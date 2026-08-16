import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, parseCSV, csvEscapeCell } from '../js/utils/csv.js';
import { uuid } from '../js/utils/id.js';
import { isValidYMD, addMonths, monthRange, ymOf, toLocalYMD, monthLabel } from '../js/utils/date.js';
import { transactionsToCSV, parseTransactionsCSV, dedupeAgainst, parseBackupJSON, guessColumnMap } from '../js/features/importExport.js';
import { migrate } from '../js/migrate.js';

test('uuid: 10.000 ID trong 1 vòng lặp đều duy nhất, đúng dạng v4', () => {
  const s = new Set();
  for (let i = 0; i < 10_000; i++) s.add(uuid());
  assert.equal(s.size, 10_000);
  assert.match(uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('CSV: ghi chú có dấu phẩy, ngoặc kép, xuống dòng → bọc đúng RFC 4180, có BOM', () => {
  const csv = toCSV([['a', 'b'], ['x, y', 'say "hi"\nline2']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv, '\uFEFFa,b\r\n"x, y","say ""hi""\nline2"\r\n');
  const back = parseCSV(csv);
  assert.deepEqual(back, [['a', 'b'], ['x, y', 'say "hi"\nline2']]);
  assert.equal(csvEscapeCell(' lead'), '" lead"');
  assert.equal(csvEscapeCell(123), '123');
});

test('CSV: tự dò dấu ; và tab', () => {
  assert.deepEqual(parseCSV('a;b\n1;2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCSV('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
});

test('Xuất rồi nhập lại CSV: round-trip đủ giao dịch, đúng số liệu', () => {
  const list = [
    { id: 'id1', type: 'expense', amount: 55000, category: 'Ăn uống', note: 'phở, bún "ngon"', date: '2026-08-15', createdAt: 1755000000000, source: 'manual' },
    { id: 'id2', type: 'income', amount: 15000000, category: 'Lương', note: '', date: '2026-08-01', createdAt: 1755000000001, source: 'auto-salary' },
  ];
  const csv = transactionsToCSV(list);
  const { items, errors } = parseTransactionsCSV(csv);
  assert.equal(errors.length, 0);
  assert.equal(items.length, 2);
  assert.equal(items[0].amount, 55000);
  assert.equal(items[0].note, 'phở, bún "ngon"');
  assert.equal(items[0].date, '2026-08-15');
  assert.equal(items[0].type, 'expense');
  assert.equal(items[1].type, 'income');
  // dedupe: nhập lại y nguyên → 0 mới
  const { fresh, dupes } = dedupeAgainst(items, list);
  assert.equal(fresh.length, 0);
  assert.equal(dupes, 2);
});

test('Nhập CSV bản cũ (type,amount,category,note,createdAt ISO)', () => {
  const csv = 'type,amount,category,note,createdAt\nexpense,50000,Ăn uống,com trua,2026-08-10T03:00:00.000Z\nincome,1000000,Thưởng,,2026-08-11T10:00:00.000Z\n';
  const { items, errors } = parseTransactionsCSV(csv);
  assert.equal(errors.length, 0);
  assert.equal(items.length, 2);
  assert.equal(items[0].amount, 50000);
  assert.equal(items[0].date, toLocalYMD(new Date('2026-08-10T03:00:00.000Z')));
});

test('Nhập CSV tiếng Việt: Ngày dd/MM/yyyy, Số tiền có dấu chấm, Loại Thu/Chi', () => {
  const csv = '\uFEFFNgày;Loại;Danh mục;Số tiền;Ghi chú\n15/08/2026;Chi;Ăn uống;1.250.000;"bữa tối, 4 người"\n01/08/2026;Thu;Lương;15tr;\n';
  const { items, errors, map } = parseTransactionsCSV(csv);
  assert.equal(errors.length, 0, errors.join('|'));
  assert.equal(map.amount, 3);
  assert.equal(items[0].date, '2026-08-15');
  assert.equal(items[0].amount, 1250000);
  assert.equal(items[0].type, 'expense');
  assert.equal(items[0].note, 'bữa tối, 4 người');
  assert.equal(items[1].amount, 15000000);
  assert.equal(items[1].type, 'income');
});

test('guessColumnMap không phân biệt hoa thường', () => {
  const m = guessColumnMap(['DATE', 'Type', 'AMOUNT', 'Category', 'Note']);
  assert.deepEqual(m, { date: 0, type: 1, amount: 2, category: 3, note: 4 });
});

test('parseBackupJSON: đọc được backup v2, mảng v1 thuần, và báo lỗi file rác', () => {
  const v2 = JSON.stringify({ schemaVersion: 2, transactions: [{ id: 'a', type: 'expense', amount: 1, category: 'X', date: '2026-01-02', createdAt: 1 }], settings: { salary: 5 } });
  const r = parseBackupJSON(v2);
  assert.equal(r.transactions.length, 1);
  assert.equal(r.settings.salary, 5);
  const v1 = JSON.stringify([{ id: '1', type: 'income', amount: 2, category: 'Y', createdAt: 1700000000000 }]);
  assert.equal(parseBackupJSON(v1).transactions.length, 1);
  assert.throws(() => parseBackupJSON('{"x":1}'));
  assert.throws(() => parseBackupJSON('not json'));
});

test('date utils', () => {
  assert.equal(isValidYMD('2026-02-28'), true);
  assert.equal(isValidYMD('2026-02-30'), false);
  assert.equal(isValidYMD('2026-13-01'), false);
  assert.equal(isValidYMD('26-1-1'), false);
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(monthRange('2026-11', '2026-10'), []);
  assert.equal(ymOf('2026-08-16'), '2026-08');
  assert.equal(monthLabel('2026-08'), 'T08/2026');
});

test('múi giờ (lỗi #10): "2026-08-01" nhập vào luôn thuộc tháng 08 bất kể TZ', () => {
  const { data } = migrate([{ id: 'z', type: 'expense', amount: 1, category: 'A', date: '2026-08-01', createdAt: Date.UTC(2026, 6, 31, 17, 0) }]);
  assert.equal(data.transactions[0].date, '2026-08-01');
  assert.equal(ymOf(data.transactions[0].date), '2026-08');
});
