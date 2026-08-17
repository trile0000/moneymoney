import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAccount, computeBalances, totals, creditStatus } from '../js/features/accounts.js';
import { makeCategory, buildTree, pathName, descendantIds, mergeCategory, findOrCreate, effectiveGroup, forType } from '../js/features/categories.js';
import { normalizeVN, applyFilter, presetRange, summarize, emptyFilter, isFilterEmpty } from '../js/features/filters.js';

// ---------- Ví ----------
test('computeBalances: thu/chi/chuyển khoản/số dư đầu/đã xóa mềm', () => {
  const accs = [makeAccount({ id: 'c', name: 'Tiền mặt', openingBalance: 100 }), makeAccount({ id: 'b', name: 'Bank', type: 'bank', openingBalance: 1000 }), makeAccount({ id: 'cc', name: 'Thẻ', type: 'credit', credit: { limit: 5000, statementDay: 20, dueDay: 5 } })];
  const tx = [
    { type: 'income', amount: 500, accountId: 'b' },
    { type: 'expense', amount: 50, accountId: 'c' },
    { type: 'transfer', amount: 300, accountId: 'b', toAccountId: 'c' },
    { type: 'expense', amount: 700, accountId: 'cc' },
    { type: 'expense', amount: 999, accountId: 'c', deletedAt: 1 },
  ];
  const m = computeBalances(accs, tx);
  assert.equal(m.get('c'), 100 - 50 + 300);
  assert.equal(m.get('b'), 1000 + 500 - 300);
  assert.equal(m.get('cc'), -700);
  const t = totals(accs, m);
  assert.equal(t.assets, 350 + 1200);
  assert.equal(t.liabilities, 700);
  assert.equal(t.net, 850);
  const cs = creditStatus(accs[2], -700, new Date(2026, 7, 16));
  assert.equal(cs.debt, 700);
  assert.equal(cs.available, 4300);
  assert.equal(cs.dueDate, '2026-09-05');
  assert.equal(cs.statementDate, '2026-08-20');
  assert.equal(cs.warn, false);
  const cs2 = creditStatus(accs[2], -700, new Date(2026, 8, 3));
  assert.equal(cs2.daysToDue, 2);
  assert.equal(cs2.warn, true);
});

// ---------- Danh mục ----------
test('cây danh mục 2 cấp, path, descendants, effectiveGroup', () => {
  const cats = [
    makeCategory({ id: 'p', name: 'Ăn uống', group: 'need' }),
    makeCategory({ id: 'c1', name: 'Cà phê', parentId: 'p' }),
    makeCategory({ id: 'c2', name: 'Nhà hàng', parentId: 'p', group: 'want' }),
    makeCategory({ id: 'x', name: 'Xe', kind: 'expense' }),
    makeCategory({ id: 'orphan', name: 'Mồ côi', parentId: 'nope' }),
    makeCategory({ id: 'arch', name: 'Cũ', archived: true }),
  ];
  const tree = buildTree(cats);
  assert.deepEqual(tree.map((n) => n.name), ['Ăn uống', 'Mồ côi', 'Xe']);
  assert.deepEqual(tree[0].children.map((c) => c.name), ['Cà phê', 'Nhà hàng']);
  assert.equal(pathName(cats, 'c1'), 'Ăn uống › Cà phê');
  assert.deepEqual([...descendantIds(cats, 'p')].sort(), ['c1', 'c2', 'p']);
  assert.equal(effectiveGroup(cats, 'c1'), 'need');
  assert.equal(effectiveGroup(cats, 'c2'), 'want');
  assert.equal(forType(cats, 'income').length, 0);
  assert.equal(forType(cats, 'transfer').length, 0);
});

test('mergeCategory chuyển giao dịch và con; findOrCreate không phân biệt hoa thường', () => {
  const cats = [makeCategory({ id: 'a', name: 'Ăn uống' }), makeCategory({ id: 'a2', name: 'Ăn ngoài' }), makeCategory({ id: 'a2c', name: 'Bún', parentId: 'a2' })];
  const tx = [{ id: 't1', categoryId: 'a2', category: 'Ăn ngoài' }, { id: 't2', categoryId: 'a', category: 'Ăn uống' }];
  const r = mergeCategory(cats, tx, 'a2', 'a');
  assert.equal(r.moved, 1);
  assert.equal(r.transactions[0].categoryId, 'a');
  assert.equal(r.transactions[0].category, 'Ăn uống');
  assert.ok(!r.categories.some((c) => c.id === 'a2'));
  assert.equal(r.categories.find((c) => c.id === 'a2c').parentId, 'a');
  const f = findOrCreate(cats, 'ăn uống');
  assert.equal(f.created, false); assert.equal(f.category.id, 'a');
  const g = findOrCreate(cats, 'Mua sắm');
  assert.equal(g.created, true); assert.equal(g.category.icon, '🛍️');
});

// ---------- Lọc ----------
test('normalizeVN bỏ dấu và đ', () => {
  assert.equal(normalizeVN('Ăn Uống — Đi lại, phở'), 'an uong — di lai, pho');
});

test('applyFilter: q không dấu, ngày, loại, ví (kể cả đích chuyển khoản), danh mục cha gồm con, tag, khoảng tiền, số tiền', () => {
  const items = [
    { id: 1, type: 'expense', amount: 55000, date: '2026-08-10', note: 'Phở bò', categoryId: 'food', accountId: 'c', tags: ['sang'] },
    { id: 2, type: 'expense', amount: 1250000, date: '2026-07-30', note: 'Tiền điện', categoryId: 'bill', accountId: 'b', tags: [] },
    { id: 3, type: 'transfer', amount: 2000000, date: '2026-08-01', note: '', accountId: 'b', toAccountId: 'c', tags: [] },
    { id: 4, type: 'income', amount: 15000000, date: '2026-08-01', note: 'Lương tự động', categoryId: 'sal', accountId: 'c', tags: [] },
    { id: 5, type: 'expense', amount: 30000, date: '2026-08-12', note: 'cà phê', categoryId: 'coffee', accountId: 'c', tags: ['sang', 'ban'] },
  ];
  const ctx = { categoryIds: new Set(['food', 'coffee']), categoriesById: new Map([['food', { name: 'Ăn uống' }], ['coffee', { name: 'Cà phê', parentId: 'food' }], ['bill', { name: 'Hóa đơn' }], ['sal', { name: 'Lương' }]]), accountsById: new Map([['c', { name: 'Tiền mặt' }], ['b', { name: 'Vietcombank' }]]) };
  const ids = (f) => applyFilter(items, { ...emptyFilter(), ...f }, ctx).map((t) => t.id);
  assert.deepEqual(ids({ q: 'pho' }), [1]);
  assert.deepEqual(ids({ q: 'an uong' }), [1, 5]); // tên danh mục cha của cà phê cũng match
  assert.deepEqual(ids({ from: '2026-08-01', to: '2026-08-31' }), [1, 3, 4, 5]);
  assert.deepEqual(ids({ type: 'transfer' }), [3]);
  assert.deepEqual(ids({ accountId: 'b' }), [2, 3]);
  assert.deepEqual(ids({ categoryId: 'food' }), [1, 5]);
  assert.deepEqual(ids({ tag: 'ban' }), [5]);
  assert.deepEqual(ids({ min: 1000000, max: 3000000 }), [2, 3]);
  assert.deepEqual(ids({ q: '1250' }), [2]);
  assert.deepEqual(ids({ q: 'vietcombank' }), [2, 3]);
  const s = summarize(applyFilter(items, emptyFilter(), ctx));
  assert.equal(s.income, 15000000); assert.equal(s.expense, 1335000); assert.equal(s.transfer, 2000000); assert.equal(s.count, 5);
  assert.equal(isFilterEmpty(emptyFilter()), true);
  assert.equal(isFilterEmpty({ ...emptyFilter(), q: 'x' }), false);
});

test('presetRange', () => {
  const d = new Date(2026, 7, 16);
  assert.deepEqual(presetRange('thisMonth', d), { from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(presetRange('lastMonth', d), { from: '2026-07-01', to: '2026-07-31' });
  assert.deepEqual(presetRange('last30', d), { from: '2026-07-18', to: '2026-08-16' });
  assert.deepEqual(presetRange('all', d), { from: '', to: '' });
});
