import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cryptoAvailable, createEnvelopeMeta, unwrapDataKey, rewrapWithPin, rewrapWithNewRecovery, sealData, openData, isEnvelope, generateRecoveryCode, normalizeRecovery, validPin } from '../js/features/crypto.js';

const ITER = 5000; // nhanh cho test (thật: 210k)

test('bật mã hóa: PIN mở được, PIN sai không mở, mã khôi phục mở được', async () => {
  assert.ok(cryptoAvailable());
  const { meta, dataKey, recoveryCode } = await createEnvelopeMeta('1234', undefined, ITER);
  assert.match(recoveryCode, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
  const data = { schemaVersion: 3, transactions: [{ id: 'a', amount: 1, note: 'tiếng Việt 💸' }] };
  const env = await sealData(dataKey, meta, data);
  assert.ok(isEnvelope(env));
  assert.ok(!JSON.stringify(env).includes('tiếng Việt'));
  const k1 = await unwrapDataKey(env.meta, { pin: '1234' });
  assert.ok(k1);
  assert.deepEqual(await openData(k1, env), data);
  assert.equal(await unwrapDataKey(env.meta, { pin: '9999' }), null);
  const k2 = await unwrapDataKey(env.meta, { recovery: recoveryCode.toLowerCase().replace(/-/g, ' ') });
  assert.ok(k2);
  assert.deepEqual(await openData(k2, env), data);
  assert.equal(await unwrapDataKey(env.meta, { recovery: 'AAAA-BBBB-CCCC-DDDD-EEEE' }), null);
});

test('đổi PIN & đổi mã khôi phục giữ nguyên dataKey', async () => {
  const { meta, dataKey, recoveryCode } = await createEnvelopeMeta('0000', undefined, ITER);
  const meta2 = await rewrapWithPin(meta, dataKey, '5678');
  assert.equal(await unwrapDataKey(meta2, { pin: '0000' }), null);
  assert.ok(await unwrapDataKey(meta2, { pin: '5678' }));
  assert.ok(await unwrapDataKey(meta2, { recovery: recoveryCode })); // mã khôi phục cũ vẫn dùng được
  const { meta: meta3, recoveryCode: rc2 } = await rewrapWithNewRecovery(meta2, dataKey);
  assert.equal(await unwrapDataKey(meta3, { recovery: recoveryCode }), null);
  assert.ok(await unwrapDataKey(meta3, { recovery: rc2 }));
  const env = await sealData(dataKey, meta3, { x: 1 });
  assert.deepEqual(await openData(await unwrapDataKey(env.meta, { pin: '5678' }), env), { x: 1 });
});

test('validPin / normalizeRecovery / isEnvelope', () => {
  assert.ok(validPin('1234')); assert.ok(validPin('12345678')); assert.ok(!validPin('123')); assert.ok(!validPin('123456789'));
  assert.equal(normalizeRecovery(' abcd-efgh '), 'ABCDEFGH');
  assert.ok(!isEnvelope({ transactions: [] })); assert.ok(!isEnvelope(null));
  assert.notEqual(generateRecoveryCode(), generateRecoveryCode());
});
