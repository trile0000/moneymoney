#!/usr/bin/env node
// Đổi phiên bản đồng bộ ở js/version.js và service-worker.js (CACHE_VERSION) trước khi deploy.
// Dùng: node scripts/bump-version.mjs 2.0.1
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const v = process.argv[2];
if (!v || !/^\d+\.\d+\.\d+([-.][\w.]+)?$/.test(v)) {
  console.error('Cách dùng: node scripts/bump-version.mjs <x.y.z>');
  process.exit(1);
}
const files = [
  [join(root, 'js/version.js'), /APP_VERSION = '[^']+'/, `APP_VERSION = '${v}'`],
  [join(root, 'service-worker.js'), /CACHE_VERSION = '[^']+'/, `CACHE_VERSION = '${v}'`],
];
for (const [f, re, rep] of files) {
  const s = readFileSync(f, 'utf8');
  if (!re.test(s)) { console.error('Không tìm thấy mẫu trong', f); process.exit(1); }
  writeFileSync(f, s.replace(re, rep));
  console.log('✔', f, '→', v);
}
