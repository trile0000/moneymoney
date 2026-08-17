import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DICTS, t, setLocale } from '../js/i18n.js';

function walk(dir, out = []) { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.js')) out.push(p); } return out; }

test('mọi key data-i18n trong index.html có trong từ điển vi và en', () => {
  const html = readFileSync('index.html', 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-ph|-aria|-title)?="([^"]+)"/g)].map((m) => m[1]);
  const missVi = keys.filter((k) => !(k in DICTS.vi));
  const missEn = keys.filter((k) => !(k in DICTS.en));
  assert.deepEqual(missVi, [], 'thiếu vi: ' + missVi.join(', '));
  assert.deepEqual(missEn, [], 'thiếu en: ' + missEn.join(', '));
});

test("mọi t('key') tĩnh trong js/ có trong từ điển vi và en", () => {
  const files = walk('js');
  const keys = new Set();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'\s*[,)]/g)) keys.add(m[1]);
  const missVi = [...keys].filter((k) => !(k in DICTS.vi));
  const missEn = [...keys].filter((k) => !(k in DICTS.en));
  assert.deepEqual(missVi, [], 'thiếu vi: ' + missVi.join(', '));
  assert.deepEqual(missEn, [], 'thiếu en: ' + missEn.join(', '));
});

test('en có đủ key như vi; t() thay biến và fallback', () => {
  const missing = Object.keys(DICTS.vi).filter((k) => !(k in DICTS.en));
  assert.deepEqual(missing, []);
  setLocale('en');
  assert.equal(t('common.inDays', { n: 3 }), 'in 3 days');
  assert.equal(t('nope.key'), 'nope.key');
  setLocale('vi');
  assert.equal(t('common.inDays', { n: 3 }), 'còn 3 ngày');
});
