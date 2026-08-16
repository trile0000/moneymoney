// Kiểm thử trình duyệt (Playwright, headless Chromium). Chạy: node tests/e2e.mjs  (cần server tĩnh ở :8080)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = '/tmp/mm-shots';
mkdirSync(OUT, { recursive: true });
let failures = 0;
function check(name, cond, extra = '') { const ok = !!cond; console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; }

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const todayYM = ym(now);
const prevYM = (k) => ym(new Date(now.getFullYear(), now.getMonth() - k, 1));

const V1_TX = [
  { id: '1700000000000', type: 'expense', amount: 50000, category: 'Ăn uống', note: 'phở, bún "ngon"', createdAt: now.getTime() - 3600e3 },
  { id: '1700000000000', type: 'expense', amount: 70000, category: 'Đi lại', note: 'grab', createdAt: now.getTime() - 7200e3 }, // ID trùng
  { id: '1700000000001', type: 'income', amount: 15000000, category: 'Lương', note: 'Tự động thêm từ hệ thống', createdAt: new Date(now.getFullYear(), now.getMonth(), 1, 9).getTime() },
  { id: '1700000000002', type: 'expense', amount: 1000, category: '<img src=x onerror=window.__xss=1>', note: '<b>bold</b>', createdAt: now.getTime() - 100 },
  { id: '1700000000003', type: 'income', amount: 90000000, category: 'Thưởng', note: 'tháng cũ nhiều tiền', createdAt: new Date(now.getFullYear(), now.getMonth() - 2, 10).getTime() },
];
const V1_SETTINGS = { salary: 15000000, salaryCategory: 'Lương', thresholds: { t2: 5000000, t3: 10000000, t4: 20000000 }, bestTier: 1 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', async (d) => { errors.push('DIALOG: ' + d.message()); await d.dismiss(); });

// 1) Seed v1 + load → migrate
await page.goto(BASE);
await page.evaluate(({ tx, st }) => { localStorage.clear(); localStorage.setItem('mm_transactions_v1', JSON.stringify(tx)); localStorage.setItem('mm_settings_v1', JSON.stringify(st)); }, { tx: V1_TX, st: V1_SETTINGS });
await page.reload();
await page.waitForFunction(() => window.__mm && document.querySelectorAll('.tx').length > 0, null, { timeout: 10000 });
await page.waitForTimeout(400);
const mig = await page.evaluate(() => ({
  v1: JSON.parse(localStorage.getItem('mm_transactions_v1')).length,
  v2: JSON.parse(localStorage.getItem('mm_data_v2')),
  s2: JSON.parse(localStorage.getItem('mm_settings_v2')),
  xss: window.__xss,
  ids: new Set(JSON.parse(localStorage.getItem('mm_data_v2')).transactions.map((t) => t.id)).size,
}));
check('Dữ liệu v1 vẫn giữ nguyên (5 bản ghi)', mig.v1 === 5);
check('v2 đủ 5 giao dịch (kể cả 2 bản ghi trùng ID)', mig.v2.transactions.length === 5, `got ${mig.v2.transactions.length}`);
check('ID sau migrate duy nhất', mig.ids === 5);
check('Lương cũ được gắn source=auto-salary + periodKey', mig.v2.transactions.some((t) => t.source === 'auto-salary' && t.periodKey === todayYM));
check('Không sinh trùng lương tháng này sau migrate', mig.v2.transactions.filter((t) => t.source === 'auto-salary' && t.periodKey === todayYM).length === 1);
check('Settings migrate: salary giữ 15tr, lastSalaryPeriod = tháng này', mig.s2.salary === 15000000 && mig.s2.lastSalaryPeriod === todayYM, JSON.stringify({ salary: mig.s2.salary, last: mig.s2.lastSalaryPeriod }));
check('XSS không thực thi', mig.xss === undefined);
const xssText = await page.evaluate(() => Array.from(document.querySelectorAll('.tx .cat')).map((n) => n.textContent).find((t) => t.includes('<img')));
check('Danh mục XSS hiển thị nguyên văn', !!xssText, xssText);
check('Không có img rác trong DOM', await page.evaluate(() => document.querySelectorAll('.tx img').length === 0));
await page.screenshot({ path: `${OUT}/01-mobile-home.png`, fullPage: true });

// 2) Thêm giao dịch với gõ tắt
await page.fill('#category', 'Ăn uống');
await page.fill('#amount', '1tr5');
const hint = await page.textContent('#amountHint');
check('Hint hiển thị số đã hiểu (1tr5 → 1.500.000 đ)', hint.includes('1.500.000'), hint);
await page.fill('#note', 'lẩu, 3 người');
await page.click('#add');
await page.waitForTimeout(300);
const added = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_data_v2')).transactions.find((t) => t.note === 'lẩu, 3 người'));
check('Giao dịch 1tr5 lưu đúng 1.500.000', added && added.amount === 1500000 && added.type === 'expense', JSON.stringify(added));
check('ID mới là UUID', added && /^[0-9a-f-]{36}$/.test(added.id));
check('date là chuỗi YYYY-MM-DD, không lệch tháng', added && added.date.slice(0, 7) === todayYM);

// 3) Validate
await page.fill('#amount', '0');
await page.fill('#category', '');
await page.click('#add');
const err = await page.textContent('#formError');
check('Chặn số tiền 0 với thông báo lỗi', err && err.length > 0, err);
await page.fill('#amount', '50k');
await page.click('#add');
const err2 = await page.textContent('#formError');
check('Chặn danh mục rỗng', err2 && err2.includes('danh mục'), err2);
await page.fill('#category', 'Cà phê');
await page.click('#add');
await page.waitForTimeout(200);

// 4) Xóa + Undo
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_data_v2')).transactions.filter((t) => !t.deletedAt).length);
await page.click('.tx .tx-delete >> nth=0');
await page.waitForTimeout(200);
check('Snackbar Hoàn tác hiện', await page.isVisible('#undoBar'));
const midDel = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_data_v2')).transactions.filter((t) => !t.deletedAt).length);
check('Sau xóa: hiển thị bớt 1', midDel === before - 1);
await page.click('#undoBtn');
await page.waitForTimeout(200);
const afterUndo = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_data_v2')).transactions.filter((t) => !t.deletedAt).length);
check('Hoàn tác khôi phục đúng', afterUndo === before);
await page.click('.tx .tx-delete >> nth=0');
await page.waitForTimeout(5600);
const afterCommit = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_data_v2')).transactions.length);
check('Hết 5s → xóa hẳn khỏi storage', afterCommit === before - 1, `${afterCommit} vs ${before - 1}`);

// 5) Sửa qua bottom sheet
await page.click('.tx >> nth=0');
await page.waitForSelector('#editSheet.open');
check('Bottom sheet mở, focus vào ô số tiền', await page.evaluate(() => document.activeElement && document.activeElement.id === 'edAmount'));
await page.fill('#edAmount', '2tr');
await page.fill('#edNote', 'đã sửa');
await page.click('#edSave');
await page.waitForTimeout(300);
const edited = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_data_v2')).transactions.find((t) => t.note === 'đã sửa'));
check('Sửa qua form: amount = 2.000.000', edited && edited.amount === 2000000, JSON.stringify(edited && edited.amount));
// Esc đóng modal + focus trap
await page.click('.tx >> nth=0');
await page.waitForSelector('#editSheet.open');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('Esc đóng sheet', !(await page.isVisible('#editSheet.open')));

// 6) Đổi tháng cũ nhiều tiền → không ghi đè bestTier
const bestBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_settings_v2')).bestTier);
await page.fill('#filterMonth', prevYM(2));
await page.dispatchEvent('#filterMonth', 'change');
await page.waitForTimeout(300);
const bestAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_settings_v2')).bestTier);
const kpi = await page.textContent('#sumBalance');
check('Xem tháng cũ (90tr) hiển thị số dư tháng đó', kpi.includes('90.000.000'), kpi);
check('…nhưng KHÔNG ghi đè bestTier (lỗi #11)', bestBefore === bestAfter, `${bestBefore} → ${bestAfter}`);
const scope = await page.textContent('#chartScope');
check('Ghi chú phạm vi biểu đồ', scope.includes('Phạm vi'), scope);
await page.selectOption('#chartMode', 'trend');
await page.waitForTimeout(200);
const scope2 = await page.textContent('#chartScope');
check('Biểu đồ biến động ghi rõ "toàn bộ lịch sử"', scope2.includes('toàn bộ lịch sử'), scope2);
await page.click('#thisMonth');
await page.selectOption('#chartMode', 'byCategory');

// 7) Bù lương thiếu: giả lập lastSalaryPeriod = 3 tháng trước, reload
await page.evaluate((p) => { const s = JSON.parse(localStorage.getItem('mm_settings_v2')); s.lastSalaryPeriod = p; localStorage.setItem('mm_settings_v2', JSON.stringify(s)); }, prevYM(3));
await page.reload();
await page.waitForFunction(() => window.__mm && document.querySelectorAll('.tx').length > 0);
await page.waitForTimeout(500);
const sal = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_data_v2')).transactions.filter((t) => t.source === 'auto-salary').map((t) => t.periodKey).sort());
check('Bù đủ kỳ lương thiếu (T-2, T-1) + không trùng tháng này', sal.length === 3 && sal.includes(prevYM(1)) && sal.includes(prevYM(2)) && sal.filter((p) => p === todayYM).length === 1, sal.join(','));

// 8) Xuất CSV: BOM + quote
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportCSV')]);
const csvPath = await dl.path();
const csvText = (await import('node:fs')).readFileSync(csvPath, 'utf8');
check('CSV có BOM UTF-8', csvText.charCodeAt(0) === 0xfeff);
check('CSV bọc ngoặc kép ghi chú có dấu phẩy', csvText.includes('"phở, bún ""ngon"""'), csvText.split('\n').find((l) => l.includes('phở')) || csvText.slice(0, 300));

// 9) Settings modal a11y: Esc đóng, focus trap
await page.click('#openSettings');
await page.waitForSelector('#settingsModal.open');
check('Modal cài đặt aria-hidden=false', (await page.getAttribute('#settingsModal', 'aria-hidden')) === 'false');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('Esc đóng modal cài đặt', !(await page.isVisible('#settingsModal.open')));

// 10) Xóa tất cả 2 bước
await page.click('#clearAll');
await page.waitForSelector('#confirmModal.open');
check('Bước 1 có nút Sao lưu JSON', await page.isVisible('#confirmExtra'));
await page.click('#confirmOk');
await page.waitForTimeout(200);
check('Bước 2: nút Đồng ý bị khóa cho tới khi tick', await page.isDisabled('#confirmOk'));
await page.click('#confirmCancel');
await page.waitForTimeout(100);
const stillThere = await page.evaluate(() => JSON.parse(localStorage.getItem('mm_data_v2')).transactions.length);
check('Hủy → dữ liệu còn nguyên', stillThere > 0);

// 11) Service worker + offline
await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
const swState = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); const keys = await caches.keys(); const c = await caches.open(keys.find((k) => k.startsWith('mm-')) || 'x'); const ks = await c.keys(); return { active: !!(r && r.active), controller: !!navigator.serviceWorker.controller, caches: keys, cached: ks.length }; });
check('SW active & controlling', swState.active && swState.controller, JSON.stringify(swState));
check('Precache có Chart.js + font', swState.cached >= 30, `cached=${swState.cached}`);
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => window.__mm && document.querySelectorAll('.tx').length > 0, null, { timeout: 15000 }).catch(() => {});
const offline = await page.evaluate(() => ({ chart: typeof window.Chart !== 'undefined', rows: document.querySelectorAll('.tx').length, font: document.fonts.check('16px "Baloo 2"'), badge: getComputedStyle(document.querySelector('.offline-badge')).display }));
check('Offline: app mở được, có Chart.js', offline.chart && offline.rows > 0, JSON.stringify(offline));
check('Offline: font Baloo 2 có sẵn', offline.font);
check('Offline: hiển thị badge Offline', offline.badge !== 'none');
await page.screenshot({ path: `${OUT}/02-mobile-offline.png`, fullPage: true });
await ctx.setOffline(false);

// 12) Hiệu năng 10.000 giao dịch
await page.evaluate((today) => {
  const cats = ['Ăn uống', 'Đi lại', 'Hóa đơn', 'Mua sắm', 'Giải trí'];
  const tx = [];
  const [y, m] = today.split('-').map(Number);
  for (let i = 0; i < 10000; i++) {
    const d = new Date(y, m - 1 - Math.floor(i / 400), 1 + (i % 28));
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    tx.push({ id: 'p' + i, type: i % 9 === 0 ? 'income' : 'expense', amount: 10000 + (i % 50) * 1000, category: cats[i % 5], note: 'note ' + i, date: ds, createdAt: Date.now() - i * 1000, source: 'manual' });
  }
  localStorage.setItem('mm_data_v2', JSON.stringify({ schemaVersion: 2, transactions: tx, meta: {}, savedAt: Date.now() }));
}, todayYM);
const t0 = Date.now();
await page.reload();
await page.waitForFunction(() => window.__mm && document.querySelectorAll('.tx').length > 0, null, { timeout: 20000 });
const loadMs = Date.now() - t0;
const perf = await page.evaluate(() => ({ rows: document.querySelectorAll('.tx').length, count: document.getElementById('txCount').textContent }));
check('10.000 giao dịch: tải < 3s', loadMs < 3000, `${loadMs}ms`);
check('Virtual list: DOM chỉ render ~vài chục dòng', perf.rows < 60, `rows=${perf.rows}, ${perf.count}`);
// đổi tháng nhanh nhiều lần → không giật (đo thời gian)
const t1 = Date.now();
for (let k = 1; k <= 8; k++) { await page.fill('#filterMonth', prevYM(k)); await page.dispatchEvent('#filterMonth', 'change'); }
const swMs = Date.now() - t1;
check('Đổi tháng 8 lần với 10k giao dịch < 2s', swMs < 2000, `${swMs}ms`);
// cuộn danh sách
await page.evaluate(() => { const v = document.getElementById('listViewport'); v.scrollTop = 5000; });
await page.waitForTimeout(200);
const afterScroll = await page.evaluate(() => document.querySelectorAll('.tx').length);
check('Cuộn xa vẫn giữ số dòng DOM nhỏ', afterScroll < 60, `rows=${afterScroll}`);
await page.click('#thisMonth');
await page.screenshot({ path: `${OUT}/03-mobile-10k.png` });

// 13) Desktop screenshot
const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'vi-VN' });
const dpage = await dctx.newPage();
await dpage.goto(BASE);
await dpage.evaluate(({ tx, st }) => { localStorage.setItem('mm_transactions_v1', JSON.stringify(tx)); localStorage.setItem('mm_settings_v1', JSON.stringify(st)); }, { tx: V1_TX, st: V1_SETTINGS });
await dpage.reload();
await dpage.waitForFunction(() => window.__mm && document.querySelectorAll('.tx').length > 0);
await dpage.waitForTimeout(500);
await dpage.screenshot({ path: `${OUT}/04-desktop.png`, fullPage: true });
await dpage.click('.tx >> nth=0');
await dpage.waitForSelector('#editSheet.open');
await dpage.screenshot({ path: `${OUT}/05-desktop-edit.png` });
await dctx.close();

check('Không có lỗi JS / dialog native trong suốt phiên', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
console.log(failures ? `\n❌ ${failures} kiểm tra thất bại` : '\n✅ Tất cả kiểm tra E2E đạt');
process.exit(failures ? 1 : 0);
