import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, migrateSettings, normalizeTransaction, LEGACY_SALARY_NOTE, SCHEMA_VERSION } from '../js/migrate.js';
import { toLocalYMD } from '../js/utils/date.js';

const T0 = new Date(2026, 7, 16, 10, 0, 0).getTime(); // 16/08/2026 10:00 local

test('migrate v1 → v3 giữ đủ giao dịch, thêm date local, source, accountId, categoryId', () => {
  const v1 = [
    { id: '1723770000000', type: 'expense', amount: 50000, category: 'Ăn uống', note: 'phở', createdAt: T0 },
    { id: '1723770000001', type: 'income', amount: 15000000, category: 'Lương', note: LEGACY_SALARY_NOTE, createdAt: new Date(2026, 7, 1, 8).getTime() },
    { id: '1723770000002', type: 'expense', amount: '120000', category: '', note: null, createdAt: undefined },
    { id: '1723770000003', type: 'expense', amount: 90000, category: 'Cafe sáng', createdAt: T0 },
  ];
  const { data, settings, fromVersion, changed, stats } = migrate(v1, { settings: { salary: 15000000, lastSalaryPeriod: '2026-08' }, now: T0 });
  assert.equal(fromVersion, 1);
  assert.equal(changed, true);
  assert.equal(data.schemaVersion, SCHEMA_VERSION);
  assert.equal(data.transactions.length, 4);
  assert.equal(stats.dropped, 0);
  const byId = Object.fromEntries(data.transactions.map((t) => [t.id, t]));
  assert.equal(byId['1723770000000'].date, toLocalYMD(T0));
  assert.equal(byId['1723770000000'].source, 'manual');
  assert.equal(byId['1723770000001'].source, 'auto-salary');
  assert.equal(byId['1723770000001'].periodKey, '2026-08');
  assert.equal(byId['1723770000002'].amount, 120000);
  assert.equal(byId['1723770000002'].category, 'Khác');
  assert.equal(byId['1723770000002'].createdAt, T0);
  // v3: ví mặc định + danh mục
  assert.equal(data.accounts.length, 1);
  assert.equal(data.accounts[0].name, 'Tiền mặt');
  assert.ok(data.transactions.every((t) => t.accountId === data.accounts[0].id));
  assert.ok(data.transactions.every((t) => t.categoryId));
  const catNames = data.categories.map((c) => c.name);
  assert.ok(catNames.includes('Ăn uống') && catNames.includes('Cafe sáng') && catNames.includes('Lương'));
  const anUong = data.categories.find((c) => c.name === 'Ăn uống');
  assert.equal(anUong.icon, '🍜'); // khớp mặc định → lấy icon/nhóm
  assert.equal(anUong.group, 'need');
  const cafe = data.categories.find((c) => c.name === 'Cafe sáng');
  assert.equal(cafe.group, null);
  assert.equal(byId['1723770000000'].categoryId, anUong.id);
  // lương → rule
  assert.equal(data.recurring.length, 1);
  const rule = data.recurring[0];
  assert.equal(rule.legacySalary, true);
  assert.equal(rule.template.amount, 15000000);
  assert.equal(rule.freq, 'monthly');
  assert.equal(rule.byMonthDay, 1);
  assert.equal(rule.lastDate, '2026-08-01');
  assert.equal(byId['1723770000001'].recurringId, rule.id);
  assert.equal(data.meta.salaryMigrated, true);
  assert.equal(settings.defaultAccountId, data.accounts[0].id);
  assert.equal(settings.schemaVersion, SCHEMA_VERSION);
});

test('migrate: ID trùng (lỗi #1) → cấp UUID mới, không mất giao dịch', () => {
  const v1 = [
    { id: '1700000000000', type: 'expense', amount: 1000, category: 'A', createdAt: T0 },
    { id: '1700000000000', type: 'expense', amount: 2000, category: 'B', createdAt: T0 },
    { id: '1700000000000', type: 'income', amount: 3000, category: 'C', createdAt: T0 },
  ];
  const { data, stats } = migrate(v1, { now: T0 });
  assert.equal(data.transactions.length, 3);
  assert.equal(stats.dupIdsFixed, 2);
  assert.equal(new Set(data.transactions.map((t) => t.id)).size, 3);
});

test('migrate: dữ liệu rác không crash', () => {
  assert.equal(migrate(null).data.transactions.length, 0);
  assert.equal(migrate('abc').data.transactions.length, 0);
  assert.equal(migrate({ foo: 1 }).data.transactions.length, 0);
  const { data, stats } = migrate([null, 5, 'x', { amount: 100, createdAt: T0 }], { now: T0 });
  assert.equal(data.transactions.length, 1);
  assert.equal(stats.dropped, 3);
});

test('migrate v2 → v3 → v3: idempotent, không tạo lại rule lương, không đổi id danh mục', () => {
  const v2 = { schemaVersion: 2, transactions: [
    { id: 'a', type: 'expense', amount: 1000, category: 'A', date: '2026-08-10', createdAt: T0, source: 'manual' },
    { id: 's', type: 'income', amount: 10, category: 'Lương', date: '2026-08-01', createdAt: T0, source: 'auto-salary', periodKey: '2026-08' },
  ], meta: {}, savedAt: 1 };
  const first = migrate(v2, { settings: { salary: 10, lastSalaryPeriod: '2026-08' }, now: T0 });
  assert.equal(first.fromVersion, 2);
  assert.equal(first.data.recurring.length, 1);
  const second = migrate(JSON.parse(JSON.stringify(first.data)), { settings: JSON.parse(JSON.stringify(first.settings)), now: T0 + 1000 });
  assert.equal(second.changed, false);
  assert.equal(second.data.recurring.length, 1);
  assert.deepEqual(second.data.transactions, first.data.transactions);
  assert.deepEqual(second.data.categories.map((c) => c.id), first.data.categories.map((c) => c.id));
  // xóa rule lương rồi load lại → không tự mọc lại (meta.salaryMigrated)
  const noRule = JSON.parse(JSON.stringify(second.data)); noRule.recurring = [];
  const third = migrate(noRule, { settings: { ...second.settings, salary: 0 }, now: T0 + 2000 });
  assert.equal(third.data.recurring.length, 0);
});

test('v3: chuyển khoản mất đích → về chi; chuyển khoản hợp lệ giữ nguyên, không có categoryId', () => {
  const v3 = { schemaVersion: 3, accounts: [{ id: 'c', name: 'Tiền mặt', type: 'cash' }, { id: 'b', name: 'Bank', type: 'bank' }],
    categories: [{ id: 'k', name: 'Khác', kind: 'both' }],
    transactions: [
      { id: 't1', type: 'transfer', amount: 500, accountId: 'c', toAccountId: 'b', date: '2026-08-01', createdAt: T0 },
      { id: 't2', type: 'transfer', amount: 500, accountId: 'c', toAccountId: 'zzz', date: '2026-08-01', createdAt: T0 },
    ], meta: { salaryMigrated: true } };
  const { data } = migrate(v3, { now: T0 });
  const t1 = data.transactions.find((t) => t.id === 't1');
  const t2 = data.transactions.find((t) => t.id === 't2');
  assert.equal(t1.type, 'transfer'); assert.equal(t1.toAccountId, 'b'); assert.equal(t1.categoryId, undefined);
  assert.equal(t2.type, 'expense'); assert.equal(t2.toAccountId, undefined); assert.ok(t2.categoryId);
});

test('normalizeTransaction: date ưu tiên hơn createdAt; tags chuẩn hóa; type lạ → expense', () => {
  const a = normalizeTransaction({ id: 'x', type: 'expense', amount: 1, date: '2026-02-10', createdAt: T0, tags: [' cafe ', 'cafe', '', 7] });
  assert.equal(a.date, '2026-02-10');
  assert.deepEqual(a.tags, ['cafe', '7']);
  const b = normalizeTransaction({ id: 'y', type: 'weird', amount: 1, date: '2026-02-30', createdAt: T0 });
  assert.equal(b.type, 'expense');
  assert.equal(b.date, toLocalYMD(T0));
});

test('migrateSettings: giữ giá trị cũ, thêm mặc định mới, ép ngưỡng tăng dần, theme/locale hợp lệ', () => {
  const s = migrateSettings({ salary: 12000000, salaryCategory: 'Thu nhập', thresholds: { t2: 9000000, t3: 5000000 }, messages: { t0: 'x' }, bestTier: 3, theme: 'neon', locale: 'fr' });
  assert.equal(s.salary, 12000000);
  assert.equal(s.thresholds.t3, 9000000);
  assert.equal(s.thresholds.t4, 20000000);
  assert.equal(s.messages.t0, 'x');
  assert.equal(s.bestTier, 3);
  assert.equal(s.theme, 'system');
  assert.equal(s.locale, 'vi');
  assert.deepEqual(s.rule503020, { need: 50, want: 30, save: 20 });
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
});
