import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV } from '../js/utils/csv.js';
import { detectHeaderRow, guessMapping, detectPreset, parseNumberLoose, detectDateFormat, parseDateWith, guessCategory, buildLearnedMap, applyMapping, BANK_PRESETS } from '../js/features/csvWizard.js';

test('parseNumberLoose: các kiểu số VN/EN', () => {
  assert.equal(parseNumberLoose('1,250,000'), 1250000);
  assert.equal(parseNumberLoose('1.250.000'), 1250000);
  assert.equal(parseNumberLoose('1.250.000,50'), 1250000.5);
  assert.equal(parseNumberLoose('1,250,000.75'), 1250000.75);
  assert.equal(parseNumberLoose('-500.000'), -500000);
  assert.equal(parseNumberLoose('(500)'), -500);
  assert.equal(parseNumberLoose('500.000 VND'), 500000);
  assert.equal(parseNumberLoose('12.5'), 12.5);
  assert.equal(parseNumberLoose('0,5'), 0.5);
  assert.equal(parseNumberLoose('1250.00'), 1250);
  assert.equal(parseNumberLoose(1234), 1234);
  assert.equal(parseNumberLoose(''), null);
  assert.equal(parseNumberLoose('abc'), null);
});

test('parseDateWith / detectDateFormat', () => {
  assert.equal(parseDateWith('05/08/2026', 'dmy'), '2026-08-05');
  assert.equal(parseDateWith('08/05/2026', 'mdy'), '2026-08-05');
  assert.equal(parseDateWith('2026-08-05 13:20:00', 'dmy'), '2026-08-05');
  assert.equal(parseDateWith('31/12/25', 'dmy'), '2025-12-31');
  assert.equal(parseDateWith('13/05/2026', 'mdy'), '2026-05-13'); // đảo tự động khi tháng > 12
  assert.equal(parseDateWith(46239, 'dmy'), '2026-08-05'); // Excel serial
  assert.equal(parseDateWith(new Date(2026, 7, 5), 'dmy'), '2026-08-05');
  assert.equal(parseDateWith('x'), null);
  assert.equal(detectDateFormat(['13/05/2026', '20/05/2026']), 'dmy');
  assert.equal(detectDateFormat(['05/13/2026', '05/20/2026']), 'mdy');
  assert.equal(detectDateFormat(['2026-05-13']), 'ymd');
  assert.equal(detectDateFormat(['01/02/2026']), 'dmy'); // mặc định VN
});

const VCB = `Sao kê tài khoản,,,,,
Số tài khoản,0011000123456,,,,
Từ ngày,01/08/2026,Đến ngày,17/08/2026,,
,,,,,
Ngày giao dịch,Số tham chiếu,Số tiền ghi nợ,Số tiền ghi có,Số dư,Nội dung chi tiết
05/08/2026,5081.12345,"120,000",,"18,880,000",GRAB*A1B2 THANH TOAN
06/08/2026,5081.22222,,"18,000,000","36,880,000",CTY ABC TRA LUONG T8
07/08/2026,5081.33333,"1,250,000",,"35,630,000",SHOPEE ORDER 123
08/08/2026,5081.44444,"45,000",,"35,585,000",HIGHLANDS COFFEE
`;

test('VCB: dò dòng tiêu đề, preset, ánh xạ 2 cột nợ/có, tự gán danh mục', () => {
  const rows = parseCSV(VCB);
  const h = detectHeaderRow(rows);
  assert.equal(h, rows.findIndex((r) => r[0] === 'Ngày giao dịch'));
  const preset = detectPreset(rows[h]);
  assert.equal(preset && preset.key, 'vcb');
  const map = guessMapping(rows[h], preset);
  assert.deepEqual({ date: map.date, debit: map.debit, credit: map.credit, note: map.note, id: map.id, balance: map.balance }, { date: 0, debit: 2, credit: 3, note: 5, id: 1, balance: 4 });
  assert.equal(map.amount, undefined);
  const r = applyMapping(rows, { headerIndex: h, map, dateFormat: 'auto' });
  assert.equal(r.items.length, 4);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.items.map((x) => [x.date, x.type, x.amount, x.category]), [
    ['2026-08-05', 'expense', 120000, 'Đi lại'],
    ['2026-08-06', 'income', 18000000, 'Lương'],
    ['2026-08-07', 'expense', 1250000, 'Mua sắm'],
    ['2026-08-08', 'expense', 45000, 'Ăn uống'],
  ]);
  assert.equal(r.items[0].id, '5081.12345');
  assert.equal(r.dateFormatUsed, 'dmy');
});

test('Cột số tiền có dấu (Money Lover) + học danh mục từ dữ liệu cũ + mdy', () => {
  const text = 'Id,Note,Amount,Category,Account,Currency,Date\n1,Cafe voi Nam,-45000,Ăn uống,Tiền mặt,VND,08/05/2026\n2,Luong thang 8,18000000,Lương,VCB,VND,08/06/2026\n3,Tra tien net,-200000,,Tiền mặt,VND,08/07/2026\n';
  const rows = parseCSV(text);
  const h = detectHeaderRow(rows); assert.equal(h, 0);
  const preset = detectPreset(rows[h]); assert.equal(preset.key, 'moneylover');
  const map = guessMapping(rows[h], preset);
  const learned = buildLearnedMap([{ note: 'Tra tien net thang 7', categoryId: 'c1', category: 'Hóa đơn', type: 'expense' }], (id, t) => t.category);
  const r = applyMapping(rows, { headerIndex: h, map, dateFormat: 'mdy', learned });
  assert.equal(r.signMode, 'negIsExpense');
  assert.deepEqual(r.items.map((x) => [x.date, x.type, x.amount, x.category, x.accountName]), [
    ['2026-08-05', 'expense', 45000, 'Ăn uống', 'Tiền mặt'],
    ['2026-08-06', 'income', 18000000, 'Lương', 'VCB'],
    ['2026-08-07', 'expense', 200000, 'Hóa đơn', 'Tiền mặt'],
  ]);
});

test('Cột số tiền không dấu + cột loại; dòng trống bỏ qua; lỗi ngày', () => {
  const rows = [['Ngày', 'Số tiền', 'Loại giao dịch', 'Nội dung'], ['05/08/2026', '50.000', 'Thanh toán', 'GRAB'], [], ['06/08/2026', '1.000.000', 'Nhận tiền', 'Ban tra no'], ['xx', '5', 'Chi', 'x']];
  const map = guessMapping(rows[0]);
  assert.equal(map.type, 2);
  const r = applyMapping(rows, { headerIndex: 0, map });
  assert.equal(r.items.length, 2); assert.equal(r.stats.skipped, 1); assert.equal(r.errors.length, 1);
  assert.equal(r.items[0].type, 'expense'); assert.equal(r.items[1].type, 'income');
});

test('guessCategory: từ khóa & thu nhập', () => {
  assert.equal(guessCategory('EVN HCMC TIEN DIEN T8'), 'Hóa đơn');
  assert.equal(guessCategory('NETFLIX.COM'), 'Giải trí');
  assert.equal(guessCategory('CTY XYZ TRA LUONG', { type: 'income' }), 'Lương');
  assert.equal(guessCategory('SHOPEE', { type: 'income' }), null); // không gán danh mục chi cho thu
  assert.equal(guessCategory(''), null);
  assert.ok(BANK_PRESETS.length >= 8);
});
