import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, migrateSettings, normalizeTransaction, LEGACY_SALARY_NOTE, SCHEMA_VERSION } from '../js/migrate.js';
import { toLocalYMD } from '../js/utils/date.js';

const T0 = new Date(2026, 7, 16, 10, 0, 0).getTime(); // 16/08/2026 10:00 local

test('migrate v1 → v2 giữ đủ giao dịch, thêm date local, source', () => {
  const v1 = [
    { id: '1723770000000', type: 'expense', amount: 50000, category: 'Ăn uống', note: 'phở', createdAt: T0 },
    { id: '1723770000001', type: 'income', amount: 15000000, category: 'Lương', note: LEGACY_SALARY_NOTE, createdAt: new Date(2026, 7, 1, 8).getTime() },
    { id: '1723770000002', type: 'expense', amount: '120000', category: '', note: null, createdAt: undefined },
  ];
  const { data, fromVersion, changed, stats } = migrate(v1, { now: T0 });
  assert.equal(fromVersion, 1);
  assert.equal(changed, true);
  assert.equal(data.schemaVersion, SCHEMA_VERSION);
  assert.equal(data.transactions.length, 3);
  assert.equal(stats.dropped, 0);
  const byId = Object.fromEntries(data.transactions.map((t) => [t.id, t]));
  assert.equal(byId['1723770000000'].date, toLocalYMD(T0));
  assert.equal(byId['1723770000000'].source, 'manual');
  assert.equal(byId['1723770000001'].source, 'auto-salary');
  assert.equal(byId['1723770000001'].periodKey, '2026-08');
  assert.equal(byId['1723770000001'].date, '2026-08-01');
  // amount chuỗi → số, category rỗng → 'Khác', createdAt thiếu → now
  assert.equal(byId['1723770000002'].amount, 120000);
  assert.equal(byId['1723770000002'].category, 'Khác');
  assert.equal(byId['1723770000002'].note, '');
  assert.equal(byId['1723770000002'].createdAt, T0);
});

test('migrate: ID trùng (lỗi #1) → giao dịch thứ 2 được cấp UUID mới, không mất giao dịch nào', () => {
  const v1 = [
    { id: '1700000000000', type: 'expense', amount: 1000, category: 'A', createdAt: T0 },
    { id: '1700000000000', type: 'expense', amount: 2000, category: 'B', createdAt: T0 },
    { id: '1700000000000', type: 'income', amount: 3000, category: 'C', createdAt: T0 },
  ];
  const { data, stats } = migrate(v1, { now: T0 });
  assert.equal(data.transactions.length, 3);
  assert.equal(stats.dupIdsFixed, 2);
  const ids = new Set(data.transactions.map((t) => t.id));
  assert.equal(ids.size, 3);
  assert.ok(ids.has('1700000000000'));
});

test('migrate: dữ liệu rác không làm crash', () => {
  assert.equal(migrate(null).data.transactions.length, 0);
  assert.equal(migrate('abc').data.transactions.length, 0);
  assert.equal(migrate({ foo: 1 }).data.transactions.length, 0);
  const { data, stats } = migrate([null, 5, 'x', { amount: 100, createdAt: T0 }], { now: T0 });
  assert.equal(data.transactions.length, 1);
  assert.equal(stats.dropped, 3);
});

test('migrate v2 → v2: idempotent (không đổi gì)', () => {
  const v1 = [{ id: 'a', type: 'expense', amount: 1000, category: 'A', createdAt: T0 }];
  const first = migrate(v1, { now: T0 }).data;
  const second = migrate(JSON.parse(JSON.stringify(first)), { now: T0 + 1000 });
  assert.equal(second.changed, false);
  assert.deepEqual(second.data.transactions, first.transactions);
});

test('normalizeTransaction: date ưu tiên hơn createdAt; date sai → suy từ createdAt', () => {
  const a = normalizeTransaction({ id: 'x', type: 'expense', amount: 1, date: '2026-02-10', createdAt: T0 });
  assert.equal(a.date, '2026-02-10');
  const b = normalizeTransaction({ id: 'y', type: 'expense', amount: 1, date: '2026-02-30', createdAt: T0 });
  assert.equal(b.date, toLocalYMD(T0));
});

test('migrateSettings: giữ giá trị cũ, thêm mặc định mới, ép ngưỡng tăng dần', () => {
  const s = migrateSettings({ salary: 12000000, salaryCategory: 'Thu nhập', thresholds: { t2: 9000000, t3: 5000000 }, messages: { t0: 'x' }, bestTier: 3 });
  assert.equal(s.salary, 12000000);
  assert.equal(s.salaryCategory, 'Thu nhập');
  assert.equal(s.thresholds.t2, 9000000);
  assert.equal(s.thresholds.t3, 9000000); // ép ≥ t2
  assert.equal(s.thresholds.t4, 20000000);
  assert.equal(s.messages.t0, 'x');
  assert.ok(s.messages.t4.length > 0);
  assert.equal(s.bestTier, 3);
  assert.equal(s.lastSalaryPeriod, null);
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrateSettings(null).salary, 0);
});
