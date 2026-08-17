import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iouSummary, iouTxShape, knownPeople, personKey } from '../js/features/iou.js';
import { computeNetWorth } from '../js/features/networth.js';
import { normalizeTransaction } from '../js/migrate.js';
import { makeAccount } from '../js/features/accounts.js';

const tx = (type, amount, debt, date = '2026-08-01', extra = {}) => ({ id: Math.random().toString(36).slice(2), type, amount, debt, date, createdAt: 1, ...extra });

test('iouSummary: số dư theo người, phải thu / phải trả, thứ tự', () => {
  const list = [
    tx('expense', 5_000_000, { kind: 'lend', person: 'Nam' }, '2026-07-01'),
    tx('income', 2_000_000, { kind: 'repay', person: 'nam ' }, '2026-07-20'),       // Nam trả 2tr → còn 3tr
    tx('income', 10_000_000, { kind: 'borrow', person: 'Mẹ' }, '2026-06-01'),
    tx('expense', 10_000_000, { kind: 'repay', person: 'Mẹ' }, '2026-08-05'),      // đã trả hết → đóng
    tx('income', 1_000_000, { kind: 'borrow', person: 'Lan' }),
    tx('expense', 100_000, null),
    tx('expense', 999, { kind: 'lend', person: 'Xóa' }, '2026-08-01', { deletedAt: 5 }),
  ];
  const s = iouSummary(list);
  assert.equal(s.people.length, 3);
  const nam = s.people.find((p) => p.key === 'nam');
  assert.equal(nam.person, 'Nam');
  assert.equal(nam.balance, 3_000_000);
  assert.equal(nam.lent, 5_000_000); assert.equal(nam.lentBack, 2_000_000);
  assert.equal(nam.lastDate, '2026-07-20');
  assert.equal(nam.items[0].date, '2026-07-20'); // mới nhất trước
  const me = s.people.find((p) => p.key === 'mẹ');
  assert.equal(me.balance, 0); assert.equal(me.open, false);
  const lan = s.people.find((p) => p.key === 'lan');
  assert.equal(lan.balance, -1_000_000);
  assert.equal(s.receivable, 3_000_000);
  assert.equal(s.payable, 1_000_000);
  assert.equal(s.openCount, 2);
  assert.equal(s.people[s.people.length - 1].key, 'mẹ'); // đã tất toán xuống cuối
  assert.deepEqual(knownPeople(list), ['Lan', 'Mẹ', 'Nam']);
  assert.equal(personKey('  Anh   Ba '), 'anh ba');
});

test('iouTxShape: loại giao dịch & danh mục hệ thống', () => {
  assert.equal(iouTxShape('lend').type, 'expense');
  assert.equal(iouTxShape('borrow').type, 'income');
  assert.equal(iouTxShape('repay', { direction: 'in' }).type, 'income');
  assert.equal(iouTxShape('repay', { direction: 'out' }).category.name, 'Trả nợ vay');
});

test('normalizeTransaction giữ debt meta (kể cả repay + refId), bỏ kind lạ', () => {
  const t = normalizeTransaction({ type: 'income', amount: 1, date: '2026-08-01', debt: { kind: 'repay', person: ' Nam ', refId: 'abc' } });
  assert.deepEqual(t.debt, { kind: 'repay', person: 'Nam', settledAt: null, refId: 'abc' });
  assert.equal(normalizeTransaction({ type: 'income', amount: 1, date: '2026-08-01', debt: { kind: 'x', person: 'a' } }).debt, undefined);
});

test('net worth: phải thu là tài sản, phải trả là nợ; không tính vào đa dạng hóa', () => {
  const accs = [makeAccount({ id: 'c', name: 'Tiền mặt', type: 'cash' })];
  const nw = computeNetWorth({ accounts: accs, balances: new Map([['c', 1_000_000]]), assets: [], debtBalances: [], iou: { receivable: 3_000_000, payable: 1_000_000 } });
  assert.equal(nw.assets, 4_000_000); assert.equal(nw.liabilities, 1_000_000); assert.equal(nw.net, 3_000_000);
  assert.ok(nw.items.some((i) => i.kind === 'iou' && i.value === 3_000_000));
  assert.ok(nw.items.some((i) => i.kind === 'iou' && i.value === -1_000_000));
});

test('sao lưu kèm ảnh: backupToJSON có receipts, parseBackupJSON trả receipts, dataUrlToBlob giải mã đúng', async () => {
  const { backupToJSON, parseBackupJSON, dataUrlToBlob } = await import('../js/features/importExport.js');
  const { emptyData } = await import('../js/migrate.js');
  const data = emptyData();
  data.transactions.push({ id: 't1', type: 'expense', amount: 1000, category: 'Ăn uống', date: '2026-08-01', createdAt: 1, receiptId: 't1', source: 'manual', tags: [] });
  const dataUrl = 'data:image/jpeg;base64,' + Buffer.from('hello').toString('base64');
  const json = backupToJSON(data, { locale: 'vi' }, { receipts: [{ id: 't1', dataUrl }] });
  const parsed = parseBackupJSON(json);
  assert.equal(parsed.receipts.length, 1);
  assert.equal(parsed.transactions[0].receiptId, 't1');
  const blob = dataUrlToBlob(parsed.receipts[0].dataUrl);
  assert.equal(blob.type, 'image/jpeg');
  assert.equal(await blob.text(), 'hello');
  assert.equal(dataUrlToBlob('nope'), null);
  assert.equal(JSON.parse(backupToJSON(data, {})).receipts, undefined);
});
