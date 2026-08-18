// Kiểm thử trình duyệt (Playwright, headless Chromium) cho v2.1 (P1a). Chạy: node tests/e2e.mjs (cần static server :8080)
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8080/';
const OUT = '/tmp/mm-shots';
mkdirSync(OUT, { recursive: true });
let failures = 0;
function check(name, cond, extra = '') { const ok = !!cond; console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const ymd = (d) => `${ym(d)}-${pad(d.getDate())}`;
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
const ls = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), k);
const goto = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(250); };

// 1) Seed v1 + load → migrate thẳng lên v3
await page.goto(BASE);
await page.waitForFunction(() => window.__mm && window.__mm.state.getData(), null, { timeout: 10000 });
await page.evaluate(({ tx, st }) => { localStorage.clear(); localStorage.setItem('mm_transactions_v1', JSON.stringify(tx)); localStorage.setItem('mm_settings_v1', JSON.stringify(st)); }, { tx: V1_TX, st: V1_SETTINGS });
await page.reload();
await page.waitForFunction(() => window.__mm && document.querySelectorAll('#accountList .acc-row').length > 0, null, { timeout: 10000 });
await sleep(400);
const v3 = await ls('mm_data_v3'); const s3 = await ls('mm_settings_v3');
check('v1 giữ nguyên (5 bản ghi)', (await ls('mm_transactions_v1')).length === 5);
check('v3 đủ 5 giao dịch, id duy nhất', v3.transactions.length === 5 && new Set(v3.transactions.map((t) => t.id)).size === 5);
check('v3: ví mặc định "Tiền mặt", mọi giao dịch có accountId + categoryId', v3.accounts.length === 1 && v3.transactions.every((t) => t.accountId === v3.accounts[0].id && t.categoryId));
check('v3: danh mục XSS được tạo, không có tag html trong DOM', v3.categories.some((c) => c.name.includes('<img')) && await page.evaluate(() => document.querySelectorAll('img[src="x"]').length === 0 && window.__xss === undefined));
check('v3: lương cũ → rule định kỳ (legacySalary, lastDate tháng này), tx có recurringId', v3.recurring.length === 1 && v3.recurring[0].legacySalary && v3.recurring[0].lastDate === `${todayYM}-01` && v3.transactions.find((t) => t.source === 'auto-salary').recurringId === v3.recurring[0].id, JSON.stringify({ rules: v3.recurring.map((r) => [r.name, r.lastDate, r.legacySalary]), sal: v3.transactions.filter((t) => t.source === 'auto-salary').map((t) => t.recurringId), todayYM }));
check('Không sinh trùng lương tháng này sau migrate', v3.transactions.filter((t) => t.recurringId && (t.periodKey || '').startsWith(todayYM)).length === 1);
check('settings v3: defaultAccountId, theme system, locale vi', s3.defaultAccountId === v3.accounts[0].id && s3.theme === 'system' && s3.locale === 'vi');
check('Trang chủ: KPI thu = 15tr', (await page.textContent('#sumIncome')).includes('15.000.000'));
check('Trang chủ: số dư ví hiển thị', (await page.textContent('#accountList')).includes('Tiền mặt'));
await page.screenshot({ path: `${OUT}/p1a-01-home.png`, fullPage: true });

// 2) Thêm nhanh ở tab Giao dịch
await goto('#/tx?focus=amount');
await page.waitForSelector('[data-view="tx"]:not([hidden])');
check('FAB/route focus vào ô số tiền', await page.evaluate(() => document.activeElement && document.activeElement.id === 'amount'));
await page.fill('#amount', '1tr5');
check('Hint số tiền', (await page.textContent('#amountHint')).includes('1.500.000'));
const catOpt = await page.evaluate(() => { const s = document.getElementById('qCategory'); const o = Array.from(s.options).find((x) => x.textContent.includes('Ăn uống')); s.value = o.value; s.dispatchEvent(new Event('change')); return o.value; });
await page.fill('#note', 'lẩu, 3 người');
await page.fill('#qTags', 'ban-be, toi');
await page.click('#add');
await sleep(300);
let d3 = await ls('mm_data_v3');
const added = d3.transactions.find((t) => t.note === 'lẩu, 3 người');
check('Giao dịch 1tr5 lưu đúng, có categoryId/accountId/tags', added && added.amount === 1500000 && added.categoryId === catOpt && added.accountId === d3.accounts[0].id && added.tags.join(',') === 'ban-be,toi', JSON.stringify(added));
check('Nhớ danh mục dùng gần nhất', (await ls('mm_settings_v3')).lastCategoryId === catOpt);
// validate
await page.fill('#amount', '0'); await page.click('#add');
check('Chặn số tiền 0', ((await page.textContent('#formError')) || '').length > 0);
await page.fill('#amount', '50k'); await page.click('#add'); await sleep(200);

// 3) Xóa + Undo
const before = (await ls('mm_data_v3')).transactions.filter((t) => !t.deletedAt).length;
await page.click('.tx .tx-delete >> nth=0'); await sleep(200);
check('Snackbar Undo hiện', await page.isVisible('#undoBar'));
await page.click('#undoBtn'); await sleep(200);
check('Undo khôi phục', (await ls('mm_data_v3')).transactions.filter((t) => !t.deletedAt).length === before);
await page.click('.tx .tx-delete >> nth=0'); await sleep(5600);
check('Hết 5s xóa hẳn', (await ls('mm_data_v3')).transactions.length === before - 1);

// 4) Sửa qua sheet + Lặp lại
await page.click('.tx >> nth=0');
await page.waitForSelector('#editSheet.open');
await page.fill('#edAmount', '2tr'); await page.fill('#edNote', 'đã sửa'); await page.click('#edSave'); await sleep(300);
check('Sửa qua sheet: 2.000.000', !!(await ls('mm_data_v3')).transactions.find((t) => t.note === 'đã sửa' && t.amount === 2000000));
const cntBeforeDup = (await ls('mm_data_v3')).transactions.length;
await page.click('.tx >> nth=0'); await page.waitForSelector('#editSheet.open'); await page.click('#edDuplicate'); await sleep(300);
check('Lặp lại tạo bản sao', (await ls('mm_data_v3')).transactions.length === cntBeforeDup + 1);
await page.click('.tx >> nth=0'); await page.waitForSelector('#editSheet.open'); await page.keyboard.press('Escape'); await sleep(100);
check('Esc đóng sheet', !(await page.isVisible('#editSheet.open')));

// 5) Ví thứ hai + chuyển khoản
await goto('#/settings?section=accounts');
await page.click('#addAccount'); await page.waitForSelector('#formSheet.open');
await page.fill('#fs_name', 'Vietcombank');
await page.selectOption('#fs_type', 'bank');
await page.fill('#fs_openingBalance', '10tr');
await page.click('#fsSave'); await sleep(300);
d3 = await ls('mm_data_v3');
const bank = d3.accounts.find((a) => a.name === 'Vietcombank');
check('Thêm ví Vietcombank (bank, số dư đầu 10tr)', bank && bank.type === 'bank' && bank.openingBalance === 10000000);
await goto('#/tx?focus=amount&type=transfer');
await sleep(300);
check('Chuyển: ẩn danh mục, hiện ví đích', await page.evaluate(() => document.getElementById('qCatGroup').hidden && !document.getElementById('qToGroup').hidden));
await page.selectOption('#qAccount', bank.id);
await page.selectOption('#qToAccount', d3.accounts[0].id);
await page.fill('#amount', '3tr'); await page.click('#add'); await sleep(300);
d3 = await ls('mm_data_v3');
const tr = d3.transactions.find((t) => t.type === 'transfer');
check('Chuyển khoản lưu đúng (không categoryId, có toAccountId)', tr && tr.amount === 3000000 && tr.accountId === bank.id && tr.toAccountId === d3.accounts[0].id && !tr.categoryId);
await goto('#/home'); await sleep(300);
const accText = await page.textContent('#accountList');
check('Số dư ví: Vietcombank 7tr sau chuyển 3tr', accText.includes('7.000.000'), accText.replace(/\s+/g, ' ').slice(0, 120));
check('KPI thu/chi KHÔNG tính chuyển khoản', !(await page.textContent('#sumExpense')).includes('3.000.000'));

// 6) Lọc & tìm kiếm
await goto('#/tx');
await page.fill('#fSearch', 'pho'); await sleep(400);
check('Tìm "pho" (không dấu) ra dòng phở', await page.evaluate(() => Array.from(document.querySelectorAll('.tx .note')).some((n) => n.textContent.includes('phở'))) && (await page.evaluate(() => document.querySelectorAll('.tx').length)) === 1);
await page.fill('#fSearch', ''); await sleep(300);
await page.click('[data-preset="all"]'); await sleep(200);
const allCount = await page.evaluate(() => document.querySelectorAll('.tx').length);
check('Preset "Tất cả" hiện cả tháng cũ (>= 6)', allCount >= 6, String(allCount));
await page.click('#fToggle'); await page.selectOption('#fType', 'transfer'); await sleep(200);
check('Lọc loại Chuyển', (await page.evaluate(() => document.querySelectorAll('.tx').length)) === 1);
await page.click('#fSave'); await page.waitForSelector('#formSheet.open'); await page.fill('#fs_name', 'Chuyển khoản'); await page.click('#fsSave'); await sleep(200);
check('Lưu bộ lọc', ((await ls('mm_settings_v3')).savedFilters || []).some((f) => f.name === 'Chuyển khoản'));
await page.click('#fClear'); await sleep(200);
check('Xóa lọc → về tháng này', await page.evaluate(() => document.querySelector('[data-preset="thisMonth"]').classList.contains('active')));

// 7) Danh mục con + rule định kỳ trong quá khứ (bù kỳ)
await goto('#/settings?section=categories');
const anUongId = catOpt;
await page.click(`#stCategoryTree .mini-row .btn >> nth=0`); // "+ con" của danh mục cấp 1 đầu tiên (Ăn uống)
await page.waitForSelector('#formSheet.open');
await page.fill('#fs_name', 'Cà phê'); await page.fill('#fs_icon', '☕'); await page.click('#fsSave'); await sleep(300);
d3 = await ls('mm_data_v3');
const cafe = d3.categories.find((c) => c.name === 'Cà phê');
check('Tạo danh mục con Cà phê', cafe && cafe.parentId, JSON.stringify(cafe && { parent: cafe.parentId }));
await page.click('#addRule'); await page.waitForSelector('#formSheet.open');
await page.fill('#fs_name', 'Internet');
await page.fill('#fs_amount', '200k');
await page.evaluate(() => { const s = document.getElementById('fs_categoryId'); const o = Array.from(s.options).find((x) => x.textContent.includes('Hóa đơn')); if (o) s.value = o.value; });
await page.selectOption('#fs_freq', 'monthly');
await page.fill('#fs_byMonthDay', '15');
await page.fill('#fs_startDate', `${prevYM(2)}-01`);
await page.click('#fsSave'); await sleep(500);
d3 = await ls('mm_data_v3');
const rule = d3.recurring.find((r) => r.name === 'Internet');
const gen = d3.transactions.filter((t) => rule && t.recurringId === rule.id).map((t) => t.date).sort();
const expected = [prevYM(2), prevYM(1), todayYM].map((m) => `${m}-15`).filter((d) => d <= ymd(now));
check('Rule Internet sinh đủ kỳ từ 2 tháng trước tới nay', JSON.stringify(gen) === JSON.stringify(expected), `${gen} vs ${expected}`);
check('Rule watermark lastDate = kỳ cuối', rule && rule.lastDate === expected[expected.length - 1]);
// bỏ qua kỳ tới
await page.click('#stRuleList .mini-row >> nth=-1'); await page.waitForSelector('#formSheet.open'); await page.click('#fsExtra'); await sleep(300); await page.keyboard.press('Escape'); await sleep(100);
d3 = await ls('mm_data_v3');
check('Bỏ qua kỳ tới → skippedDates có 1 mục', d3.recurring.find((r) => r.name === 'Internet').skippedDates.length === 1);
// toggle tắt rule
await page.click('#stRuleList .mini-row >> nth=-1 >> .switch span'); await sleep(300);
check('Tắt rule qua switch', (await ls('mm_data_v3')).recurring.find((r) => r.name === 'Internet').enabled === false);

// 7b) P1b: ngân sách, mục tiêu, 50/30/20, quỹ khẩn cấp, insight, sắp xếp thẻ
await goto('#/budget'); await sleep(300);
await page.click('#addBudget'); await page.waitForSelector('#formSheet.open');
await page.evaluate(() => { const s = document.getElementById('fs_target'); const o = Array.from(s.options).find((x) => x.textContent.includes('Ăn uống')); s.value = o.value; });
await page.fill('#fs_amount', '1tr'); await page.click('#fsSave'); await sleep(300);
d3 = await ls('mm_data_v3');
check('Ngân sách Ăn uống 1tr được lưu', d3.budgets.length === 1 && d3.budgets[0].amount === 1000000 && d3.budgets[0].categoryId === catOpt);
const brow = await page.evaluate(() => { const r = document.querySelector('#budgetList .budget-row'); return r ? { cls: r.className, txt: r.textContent } : null; });
check('Ngân sách hiển thị trạng thái vượt (đã chi 2tr+ / 1tr)', brow && brow.cls.includes('lvl-over') && brow.txt.includes('vượt'), JSON.stringify(brow));
await page.click('#addGoal'); await page.waitForSelector('#formSheet.open');
await page.fill('#fs_name', 'Mua xe'); await page.fill('#fs_target', '60tr'); await page.fill('#fs_deadline', `${now.getFullYear() + 1}-02-15`); await page.click('#fsSave'); await sleep(300);
await page.click('#goalList .goal-row .btn'); await page.waitForSelector('#formSheet.open'); await page.fill('#fs_amount', '12tr'); await page.click('#fsSave'); await sleep(300);
d3 = await ls('mm_data_v3');
const goalTxt = await page.evaluate(() => document.querySelector('#goalList .goal-row').textContent);
check('Mục tiêu 60tr + để dành 12tr → 20%, tính tiền/tháng', d3.goals.length === 1 && d3.goals[0].contributions.length === 1 && goalTxt.includes('20%') && goalTxt.includes('/tháng'), goalTxt.replace(/\s+/g, ' '));
check('50/30/20 hiển thị 3 thanh', (await page.evaluate(() => document.querySelectorAll('#ruleBars .bar-row').length)) >= 3);
await page.click('#editEF'); await page.waitForSelector('#formSheet.open');
await page.selectOption('#fs_months', '3');
await page.evaluate((id) => { const c = document.getElementById('fs_acc_' + id); if (c) c.checked = true; }, bank.id);
await page.fill('#fs_extra', '20tr'); await page.click('#fsSave'); await sleep(300);
const s3b = await ls('mm_settings_v3');
check('Quỹ khẩn cấp: lưu ví + tiền ngoài app + mục tiêu 3 tháng', s3b.emergencyMonths === 3 && s3b.emergencyAccountIds.includes(bank.id) && s3b.emergencyExtra === 20000000);
check('Quỹ khẩn cấp hiển thị số tiền quỹ (27tr = 7tr ví + 20tr ngoài)', (await page.textContent('#efBody')).includes('27.000.000'));
check('Insight có nội dung', (await page.evaluate(() => document.querySelectorAll('#insightListFull .insight').length)) >= 1);

// 8b) P1c: nợ, tài sản ròng, dự báo, sức khỏe, huy hiệu, biểu đồ mới
await page.click('#addDebt'); await page.waitForSelector('#formSheet.open');
await page.fill('#fs_name', 'Vay mua xe'); await page.fill('#fs_principal', '120tr'); await page.fill('#fs_rate', '12'); await page.fill('#fs_termMonths', '24');
await page.fill('#fs_startDate', `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`); await page.fill('#fs_paymentDay', '5'); await page.click('#fsSave'); await sleep(400);
d3 = await ls('mm_data_v3');
const debtRow = await page.evaluate(() => { const r = document.querySelector('#debtList .debt-row'); return r ? r.textContent : ''; });
check('Khoản nợ 120tr/12%/24 kỳ được lưu và hiển thị', d3.debts.length === 1 && d3.debts[0].principal === 120000000 && debtRow.includes('Vay mua xe') && debtRow.includes('Còn nợ'), debtRow.replace(/\s+/g, ' ').slice(0, 120));
check('Chiến lược snowball/avalanche hiển thị 2 dòng', (await page.evaluate(() => document.querySelectorAll('#debtStrategy .strategy-row').length)) === 2);
await page.click('#debtList .debt-row .row-actions .btn'); await page.waitForSelector('#formSheet.open'); await sleep(200);
const schedRows = await page.evaluate(() => document.querySelectorAll('#formSheet .sched tbody tr').length);
await page.fill('#fs_extra', '1tr'); await sleep(200);
const prepayTxt = await page.evaluate(() => (document.querySelector('#formSheet .note-box') || {}).textContent || '');
check('Lịch trả nợ 24 kỳ + mô phỏng trả thêm 1tr/tháng', schedRows === 24 && prepayTxt.includes('xong sớm') && prepayTxt.includes('tiết kiệm'), `rows=${schedRows} ${prepayTxt.slice(0, 80)}`);
await page.click('#fsSave'); await sleep(200);
await page.click('#debtList .debt-row .row-actions .btn:nth-of-type(2)'); await page.waitForSelector('#formSheet.open');
await page.fill('#fs_amount', '10tr'); await page.click('#fsSave'); await sleep(400);
d3 = await ls('mm_data_v3');
check('Trả thêm 10tr được ghi vào khoản nợ', d3.debts[0].extraPayments.length === 1 && d3.debts[0].extraPayments[0].amount === 10000000);
await page.click('#addAsset'); await page.waitForSelector('#formSheet.open');
await page.fill('#fs_name', 'Sổ tiết kiệm'); await page.selectOption('#fs_type', 'savings'); await page.fill('#fs_value', '50tr'); await page.click('#fsSave'); await sleep(400);
d3 = await ls('mm_data_v3');
const nwTxt = await page.textContent('#nwSummary');
check('Tài sản 50tr được lưu; tổng tài sản ròng có Tài sản/Nợ/Ròng', d3.assets.length === 1 && d3.assets[0].value === 50000000 && nwTxt.includes('Tài sản') && nwTxt.includes('Nợ') && nwTxt.includes('Ròng'), nwTxt.replace(/\s+/g, ' '));
check('Snapshot tài sản ròng tháng này đã lưu', ((d3.snapshots || {}).networth || []).some((x) => x.ym === todayYM), JSON.stringify((d3.snapshots || {}).networth));
check('Danh sách tài sản ròng có ví + tài sản + khoản nợ', await page.evaluate(() => { const t = document.getElementById('nwItems').textContent; return t.includes('Sổ tiết kiệm') && t.includes('Vay mua xe') && t.includes('Tiền mặt'); }));
await page.selectOption('#fcMonths', '3'); await sleep(300);
check('Dự báo 3 tháng: 3 dòng + giả định + lưu forecastMonths', (await page.evaluate(() => document.querySelectorAll('#fcBody tbody tr').length)) === 3 && (await page.textContent('#fcAssume')).includes('Giả định') && (await ls('mm_settings_v3')).forecastMonths === 3);
const healthTxt = await page.textContent('#healthBody');
check('Điểm sức khỏe: vòng điểm + 5 thành phần + tên tier', /\d+\/100/.test(healthTxt) && (await page.evaluate(() => document.querySelectorAll('#healthBody .health-row').length)) === 5 && healthTxt.includes('Tier'), healthTxt.replace(/\s+/g, ' ').slice(0, 100));
await page.click('#editHealth'); await page.waitForSelector('#formSheet.open');
await page.fill('#fs_savings', '40'); await page.click('#fsSave'); await sleep(300);
check('Lưu trọng số điểm sức khỏe (savings=40)', (await ls('mm_settings_v3')).healthWeights.savings === 40);
const badgesSaved = (await ls('mm_settings_v3')).badges || [];
check('Huy hiệu đã mở khóa lưu trong settings (first_tx, first_budget)', badgesSaved.includes('first_tx') && badgesSaved.includes('first_budget'), JSON.stringify(badgesSaved));
await goto('#/home'); await sleep(300);
check('Trang chủ: thẻ sức khỏe có điểm, chuỗi và huy hiệu', (await page.evaluate(() => !!document.querySelector('#homeHealth .score-num') && document.querySelectorAll('#homeBadges .badge-chip.on').length >= 2)));
for (const [mode, expectText] of [['cashflow', 'tích lũy'], ['compare', 'so với'], ['heatmap', 'ô càng đậm']]) {
  await page.selectOption('#chartMode', mode); await sleep(250);
  const info = await page.evaluate(() => ({ scope: document.getElementById('chartScope').textContent, hm: !document.getElementById('heatmap').hidden, cells: document.querySelectorAll('#heatmap .hm-cell').length, canvasHidden: document.getElementById('chart').hidden }));
  check(`Biểu đồ ${mode}: phạm vi đúng${mode === 'heatmap' ? ', lưới ngày hiện, canvas ẩn' : ''}`, info.scope.includes(expectText) && (mode !== 'heatmap' ? !info.hm && !info.canvasHidden : info.hm && info.cells >= 28 && info.canvasHidden), JSON.stringify(info));
}
await page.selectOption('#chartMode', 'byCategory'); await sleep(200);
check('Trang chủ: thẻ ngân sách + cảnh báo vượt', (await page.textContent('#homeBudgetList')).includes('Ăn uống') && (await page.evaluate(() => document.querySelectorAll('#homeBudgetList .warn-item').length)) >= 1);
check('Trang chủ: thẻ mục tiêu', (await page.textContent('#homeGoalList')).includes('Mua xe'));
// sắp xếp thẻ: đưa thẻ đầu tiên xuống, kiểm tra lưu thứ tự
await page.click('#reorderCards'); await sleep(100);
const firstBefore = await page.evaluate(() => document.querySelector('#homeGrid [data-card]').dataset.card);
await page.click('#homeGrid [data-card] .card-reorder button:nth-of-type(2)'); await sleep(200);
const orderSaved = (await ls('mm_settings_v3')).cardOrder;
check('Sắp xếp thẻ: thẻ đầu tiên chuyển xuống và lưu cardOrder', orderSaved.length === 9 && orderSaved[1] === firstBefore, JSON.stringify(orderSaved));
await page.click('#reorderCards'); await sleep(100);
await page.reload(); await page.waitForFunction(() => window.__mm && document.querySelectorAll('#accountList .acc-row').length > 0); await sleep(300);
check('Reload giữ thứ tự thẻ', (await page.evaluate(() => document.querySelector('#homeGrid [data-card]').dataset.card)) === orderSaved[0]);

// 8) Dark mode + i18n
await goto('#/settings'); await sleep(200);
await page.selectOption('#stTheme', 'dark'); await sleep(200);
check('Dark mode: data-theme=dark', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));
await page.screenshot({ path: `${OUT}/p1a-02-settings-dark.png`, fullPage: true });
await page.selectOption('#stLocale', 'en'); await sleep(300);
check('Đổi sang English: tab Home', (await page.textContent('#tab-home')).includes('Home') && (await page.evaluate(() => document.documentElement.lang)) === 'en');
await goto('#/home'); await sleep(300);
check('English: heading Monthly summary', await page.evaluate(() => Array.from(document.querySelectorAll('[data-view="home"] h2')).some((h) => h.textContent.includes('Monthly summary'))));
await page.screenshot({ path: `${OUT}/p1a-03-home-dark-en.png`, fullPage: true });
await goto('#/settings'); await page.selectOption('#stLocale', 'vi'); await page.selectOption('#stTheme', 'system'); await sleep(200);
await page.reload(); await page.waitForFunction(() => window.__mm); await sleep(500);
check('Reload giữ locale vi', (await page.textContent('#tab-home')).includes('Trang chủ'));

// 9) bestTier không đổi khi xem tháng cũ
await goto('#/home');
const bestBefore = (await ls('mm_settings_v3')).bestTier;
await page.fill('#filterMonth', prevYM(2)); await page.dispatchEvent('#filterMonth', 'change'); await sleep(300);
const oldBal = Number((await page.textContent('#sumBalance')).replace(/\D/g, ''));
check('Xem tháng cũ ~90tr → bestTier không đổi', (await ls('mm_settings_v3')).bestTier === bestBefore && oldBal > 80000000, `bal=${oldBal}`);
await page.click('#thisMonth');

// 10) CSV
await goto('#/tx');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportCSV')]);
const csv = readFileSync(await dl.path(), 'utf8');
check('CSV có BOM + cột account/tags', csv.charCodeAt(0) === 0xfeff && csv.split('\n')[0].includes('account') && csv.includes('Tiền mặt'));

// 11) SW + offline
await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
await sleep(1500);
const sw = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys.find((k) => k.startsWith('mm-')) || 'x'); return { controller: !!navigator.serviceWorker.controller, cached: (await c.keys()).length, keys }; });
check('SW controlling & precache đủ (>= 74 file)', sw.controller && sw.cached >= 74, JSON.stringify(sw));
await goto('#/home');
await ctx.setOffline(true);
await page.reload().catch(() => {});
await page.waitForFunction(() => window.__mm && document.querySelectorAll('#accountList .acc-row').length > 0, null, { timeout: 15000 }).catch(() => {});
check('Offline: app mở, Chart.js + font sẵn', await page.evaluate(() => typeof window.Chart !== 'undefined' && document.fonts.check('16px "Baloo 2"') && document.querySelectorAll('#accountList .acc-row').length > 0).catch(() => false));
await ctx.setOffline(false);

// 12) Hiệu năng 10.000 giao dịch
await page.evaluate((today) => {
  const d = JSON.parse(localStorage.getItem('mm_data_v3'));
  const cats = d.categories.filter((c) => c.kind !== 'income').slice(0, 6);
  const acc = d.accounts[0].id;
  const [y, m] = today.split('-').map(Number);
  const tx = [];
  for (let i = 0; i < 10000; i++) {
    const dt = new Date(y, m - 1 - Math.floor(i / 400), 1 + (i % 28));
    const ds = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const c = cats[i % cats.length];
    tx.push({ id: 'p' + i, type: i % 9 === 0 ? 'income' : 'expense', amount: 10000 + (i % 50) * 1000, category: c.name, categoryId: c.id, accountId: acc, note: 'note ' + i, tags: i % 7 === 0 ? ['weekly'] : [], date: ds, createdAt: Date.now() - i * 1000, source: 'manual' });
  }
  d.transactions = tx; d.savedAt = Date.now();
  localStorage.setItem('mm_data_v3', JSON.stringify(d));
}, todayYM);
const t0 = Date.now();
await goto('#/home');
await page.reload();
await page.waitForFunction(() => window.__mm && document.querySelectorAll('#accountList .acc-row').length > 0, null, { timeout: 20000 });
const loadMs = Date.now() - t0;
check('10.000 giao dịch: tải < 3s', loadMs < 3000, `${loadMs}ms`);
await goto('#/tx'); await sleep(300);
const rows = await page.evaluate(() => document.querySelectorAll('.tx').length);
check('Virtual list DOM nhỏ', rows < 60, `rows=${rows}`);
const t1 = Date.now();
await page.fill('#fSearch', 'note 12'); await sleep(400);
check('Tìm kiếm trên 10k < 1s', Date.now() - t1 < 1200 && (await page.evaluate(() => document.querySelectorAll('.tx').length)) > 0);
await page.click('[data-preset="all"]'); await sleep(300);
await page.evaluate(() => { document.getElementById('listViewport').scrollTop = 20000; }); await sleep(200);
check('Cuộn xa vẫn ít DOM', (await page.evaluate(() => document.querySelectorAll('.tx').length)) < 60);

// 12b) P1d: onboarding (context mới, không dữ liệu), công nợ, ảnh hóa đơn
{
  const octx = await browser.newContext({ viewport: { width: 420, height: 860 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const op = await octx.newPage();
  op.on('pageerror', (e) => errors.push('P1D PAGEERROR ' + e.message));
  op.on('dialog', (d) => { errors.push('P1D DIALOG ' + d.message()); d.dismiss(); });
  await op.goto(BASE + '#/home');
  await op.waitForFunction(() => window.__mm && window.__mm.state.getData(), null, { timeout: 10000 });
  await sleep(900);
  check('Onboarding mở tự động khi chưa có dữ liệu (bước 1/3)', await op.evaluate(() => document.getElementById('formSheet').getAttribute('aria-hidden') === 'false' && document.getElementById('formSheetTitle').textContent.includes('1/3')));
  await op.fill('#fs_name', 'Ví chính'); await op.fill('#fs_balance', '2tr'); await op.fill('#fs_bankName', 'VCB'); await op.fill('#fs_bankBalance', '15tr'); await op.click('#fsSave'); await sleep(400);
  await op.fill('#fs_salary', '18tr'); await op.fill('#fs_day', '5'); await op.click('#fsSave'); await sleep(500);
  const budgetSuggest = await op.evaluate(() => document.getElementById('fs_budget').value);
  await op.click('#fsSave'); await sleep(400);
  const onbDone = await op.evaluate(() => document.getElementById('confirmModal').getAttribute('aria-hidden') === 'false');
  await op.click('#confirmModal .btn.primary'); await sleep(300);
  const onb = await op.evaluate(() => { const S = window.__mm.state; return { accs: S.getAccounts().map((a) => [a.name, a.type, a.openingBalance]), rules: S.getRules().length, budgets: S.getBudgets().map((b) => b.amount), onboarded: S.getSettings().onboarded }; });
  check('Onboarding: 2 ví (2tr + VCB 15tr), rule lương, ngân sách gợi ý 80% (14tr4), onboarded=true', onbDone && budgetSuggest === '14.400.000' && onb.accs.length === 2 && onb.accs[1][2] === 15000000 && onb.rules === 1 && onb.budgets[0] === 14400000 && onb.onboarded === true, JSON.stringify(onb));
  // công nợ
  await op.evaluate(() => { location.hash = '#/budget?section=iou'; }); await sleep(500);
  await op.click('#addLend'); await op.waitForSelector('#formSheet.open'); await op.fill('#fs_person', 'Nam'); await op.fill('#fs_amount', '5tr'); await op.click('#fsSave'); await sleep(400);
  await op.click('#addBorrow'); await op.waitForSelector('#formSheet.open'); await op.fill('#fs_person', 'Mẹ'); await op.fill('#fs_amount', '10tr'); await op.click('#fsSave'); await sleep(400);
  const iou1 = await op.evaluate(() => ({ sum: document.getElementById('iouSummary').textContent, rows: document.querySelectorAll('#iouList .mini-row').length }));
  check('Công nợ: cho Nam mượn 5tr, mượn Mẹ 10tr → phải thu 5tr / phải trả 10tr', iou1.rows === 2 && iou1.sum.includes('5.000.000') && iou1.sum.includes('10.000.000'), JSON.stringify(iou1));
  await op.click('#iouList .mini-row'); await op.waitForSelector('#formSheet.open'); await op.click('#fsExtra'); await sleep(300);
  const repayPrefill = await op.evaluate(() => ({ t: document.getElementById('formSheetTitle').textContent, a: document.getElementById('fs_amount').value }));
  await op.fill('#fs_amount', '2tr'); await op.click('#fsSave'); await sleep(400);
  const iou2 = await op.evaluate(() => { const S = window.__mm.state; const s = S.getIouSummary(); return { payable: s.payable, receivable: s.receivable, debtTx: S.getVisible().filter((x) => x.debt).length, cats: S.getCategories().filter((c) => ['Cho mượn', 'Đi mượn', 'Trả nợ vay'].includes(c.name)).length, nw: document.getElementById('nwSummary').textContent }; });
  check('Trả Mẹ 2tr (form điền sẵn 10tr) → còn nợ 8tr; 3 giao dịch công nợ; danh mục hệ thống tự tạo; tài sản ròng tính phải thu/phải trả', repayPrefill.a === '10.000.000' && iou2.payable === 8000000 && iou2.receivable === 5000000 && iou2.debtTx === 3 && iou2.cats === 3 && iou2.nw.includes('8.000.000'), JSON.stringify({ repayPrefill, iou2 }));
  await op.evaluate(() => { location.hash = '#/home'; }); await sleep(400);
  check('Trang chủ: dòng công nợ trong thẻ Ví', (await op.evaluate(() => (document.querySelector('#accountTotal .iou-line') || {}).textContent || '')).includes('5.000.000'));
  // ảnh hóa đơn
  await op.evaluate(() => { location.hash = '#/tx'; }); await sleep(400);
  await op.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2000; c.height = 1500; const g = c.getContext('2d'); g.fillStyle = '#fc0'; g.fillRect(0, 0, 2000, 1500); g.fillStyle = '#000'; g.font = '120px sans-serif'; g.fillText('HOA DON', 100, 700);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'hd.png', { type: 'image/png' }));
    const input = document.querySelector('#qReceipt input[type=file]'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(1200);
  const picked = await op.evaluate(() => ({ shown: !document.querySelector('#qReceipt .receipt-thumb').hidden, kb: document.querySelector('#qReceipt .hint').textContent }));
  await op.fill('#amount', '123k'); await op.evaluate(() => { const s = document.getElementById('qCategory'); s.value = [...s.options].find((o) => o.textContent.includes('Ăn uống')).value; });
  await op.click('#add'); await sleep(600);
  const rec = await op.evaluate(async () => { const tx = window.__mm.state.getVisible().find((x) => x.amount === 123000); const { blobGet } = await import('./js/storage.js'); const b = await blobGet(tx.receiptId); return { rid: !!tx.receiptId, size: b ? b.size : 0, type: b ? b.type : '', reset: document.querySelector('#qReceipt .receipt-thumb').hidden, badge: [...document.querySelectorAll('.tx .badge')].some((x) => x.textContent === '📎') }; });
  check('Ảnh hóa đơn: nén (2000px PNG → JPEG < 250 KB) và lưu IDB, gắn receiptId, dòng có 📎, picker reset', picked.shown && rec.rid && rec.type === 'image/jpeg' && rec.size > 0 && rec.size < 250 * 1024 && rec.reset && rec.badge, JSON.stringify({ picked, rec }));
  await op.click('.tx'); await sleep(500);
  const edThumb = await op.evaluate(() => !document.querySelector('#edReceipt .receipt-thumb').hidden);
  await op.click('#edReceipt .receipt-thumb .btn'); await sleep(300);
  const lbOpen = await op.evaluate(() => !document.getElementById('lightbox').hidden);
  await op.keyboard.press('Escape'); await sleep(200);
  const lbClosed = await op.evaluate(() => document.getElementById('lightbox').hidden && document.getElementById('editSheet').getAttribute('aria-hidden') === 'false');
  await op.click('#edReceipt .receipt-thumb .danger-text'); await op.click('#edSave'); await sleep(500);
  const removed = await op.evaluate(async () => { const tx = window.__mm.state.getVisible().find((x) => x.amount === 123000); const { blobKeys } = await import('./js/storage.js'); return { rid: tx.receiptId || null, keys: (await blobKeys()).length }; });
  check('Sheet sửa: hiện ảnh, lightbox mở/đóng bằng Esc (sheet vẫn mở), gỡ ảnh → xóa blob', edThumb && lbOpen && lbClosed && removed.rid === null && removed.keys === 0, JSON.stringify({ edThumb, lbOpen, lbClosed, removed }));
  await op.screenshot({ path: `${OUT}/p1d-iou-home.png`, fullPage: true });
  await octx.close();
}

// 12c) P1d-2: wizard nhập CSV (sao kê VCB) + khóa PIN & mã hóa
{
  const wctx = await browser.newContext({ viewport: { width: 420, height: 860 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const wp = await wctx.newPage();
  wp.on('pageerror', (e) => errors.push('P1D2 PAGEERROR ' + e.message));
  wp.on('dialog', (d) => { errors.push('P1D2 DIALOG ' + d.message()); d.dismiss(); });
  await wp.goto(BASE + '#/settings');
  await wp.waitForFunction(() => window.__mm && window.__mm.state.getData(), null, { timeout: 10000 });
  await wp.evaluate(async () => { const S = window.__mm.state; await S.updateSettings({ onboarded: true }, { silent: true }); await S.addTransaction({ type: 'expense', amount: 55000, categoryId: S.getCategories()[0].id, accountId: S.getAccounts()[0].id, date: '2026-08-10', note: 'bí mật cà phê' }); });
  await sleep(500);
  await wp.evaluate(() => { const m = document.getElementById('formSheet'); if (m.getAttribute('aria-hidden') === 'false') m.querySelector('[data-close]').click(); });
  await sleep(200);
  const [fch] = await Promise.all([wp.waitForEvent('filechooser'), wp.click('#importCSV')]);
  await fch.setFiles(new URL('./fixtures-vcb.csv', import.meta.url).pathname);
  await sleep(700);
  const w1 = await wp.evaluate(() => ({ preset: document.getElementById('fs_preset').value, header: document.getElementById('fs_header').value, ths: document.querySelectorAll('#formSheet thead th').length }));
  check('Wizard CSV bước 1: nhận dạng mẫu Vietcombank, dòng tiêu đề 3, xem trước 6 cột', w1.preset === 'vcb' && w1.header === '3' && w1.ths === 6, JSON.stringify(w1));
  await wp.click('#fsSave'); await sleep(500);
  const w2 = await wp.evaluate(() => ({ date: document.getElementById('fs_col_date').value, debit: document.getElementById('fs_col_debit').value, credit: document.getElementById('fs_col_credit').value, note: document.getElementById('fs_col_note').value, hint: document.querySelector('.csvw-preview .hint').textContent }));
  check('Wizard bước 2: tự map Ngày/Ghi nợ/Ghi có/Nội dung, đọc 5/5 dòng', w2.date === '0' && w2.debit === '2' && w2.credit === '3' && w2.note === '5' && w2.hint.includes('5/5'), JSON.stringify(w2));
  await wp.fill('#fs_templateName', 'VCB test'); await wp.click('#fsSave'); await sleep(600);
  const w3 = await wp.evaluate(() => ({ status: document.querySelector('#formSheet .status-bar').textContent, cats: [...document.querySelectorAll('#formSheet tbody tr td:nth-child(3)')].map((x) => x.textContent) }));
  check('Wizard bước 3: 5 hợp lệ, tự gán danh mục theo nội dung (GRAB→Đi lại, LUONG→Lương, SHOPEE→Mua sắm, HIGHLANDS→Ăn uống, EVN→Hóa đơn)', w3.status.includes('sẽ thêm 5') && JSON.stringify(w3.cats) === JSON.stringify(['Đi lại', 'Lương', 'Mua sắm', 'Ăn uống', 'Hóa đơn']), JSON.stringify(w3));
  await wp.click('#fsSave'); await sleep(800);
  const imp = await wp.evaluate(() => ({ n: window.__mm.state.getVisible().length, tpl: (window.__mm.state.getSettings().csvTemplates || []).map((x) => x.name), closed: document.getElementById('formSheet').getAttribute('aria-hidden') === 'true' }));
  check('Wizard: nhập 5 giao dịch (tổng 6), lưu mẫu "VCB test", sheet đóng', imp.n === 6 && imp.tpl.includes('VCB test') && imp.closed, JSON.stringify(imp));
  const [fch2] = await Promise.all([wp.waitForEvent('filechooser'), wp.click('#importCSV')]);
  await fch2.setFiles(new URL('./fixtures-vcb.csv', import.meta.url).pathname); await sleep(600);
  await wp.selectOption('#fs_preset', { label: '⭐ VCB test' }); await wp.click('#fsSave'); await sleep(400); await wp.click('#fsSave'); await sleep(500);
  check('Wizard: nhập lại cùng file → 5 trùng, thêm 0', (await wp.evaluate(() => document.querySelector('#formSheet .status-bar').textContent)).includes('5 trùng'));
  await wp.evaluate(() => document.querySelector('#formSheet [data-close]').click()); await sleep(300);
  // PIN & mã hóa
  await wp.evaluate(() => { location.hash = '#/settings?section=security'; }); await sleep(400);
  await wp.click('#secEnable'); await sleep(300); await wp.click('#confirmModal .btn.primary'); await sleep(300);
  await wp.fill('#fs_pin', '2468'); await wp.fill('#fs_pin2', '2468'); await wp.click('#fsSave'); await sleep(1500);
  const rc = await wp.evaluate(() => { const m = document.getElementById('confirmBody').textContent.match(/[A-Z2-9]{4}(-[A-Z2-9]{4}){4}/); return m ? m[0] : null; });
  await wp.evaluate(() => { const c = document.querySelector('#confirmModal input[type=checkbox]'); if (c) c.click(); }); await sleep(100);
  await wp.click('#confirmModal .btn.primary'); await sleep(300);
  const enc = await wp.evaluate(() => { const raw = JSON.parse(localStorage.getItem('mm_data_v3')); return { enc: raw.enc, plain: JSON.stringify(raw).includes('bí mật'), lockBtn: !document.getElementById('lockNow').hidden, v1: localStorage.getItem('mm_transactions_v1') }; });
  check('Bật mã hóa: hiện mã khôi phục, localStorage là envelope AES-GCM (không còn chuỗi rõ), xóa key v1, nút khóa hiện', !!rc && enc.enc === 1 && enc.plain === false && enc.lockBtn && enc.v1 === null, JSON.stringify({ rc: !!rc, enc }));
  await wp.reload(); await sleep(800);
  const lk = await wp.evaluate(() => ({ lock: !document.getElementById('lockScreen').hidden, blurred: document.body.classList.contains('locked'), data: !!(window.__mm && window.__mm.state.getData()) }));
  await wp.fill('#lockPin', '0000'); await wp.click('#lockSubmit'); await sleep(900);
  const wrong = await wp.evaluate(() => document.getElementById('lockError').textContent);
  await wp.fill('#lockPin', '2468'); await wp.click('#lockSubmit');
  await wp.waitForFunction(() => window.__mm && window.__mm.state.getData(), null, { timeout: 10000 }); await sleep(300);
  const un = await wp.evaluate(() => ({ hidden: document.getElementById('lockScreen').hidden, n: window.__mm.state.getVisible().length }));
  check('Reload → màn hình khóa (chưa tải dữ liệu), PIN sai báo lỗi, PIN đúng mở và giải mã đủ 6 giao dịch', lk.lock && lk.blurred && !lk.data && wrong.includes('PIN sai') && un.hidden && un.n === 6, JSON.stringify({ lk, wrong, un }));
  await wp.click('#lockNow'); await sleep(200);
  await wp.click('#lockToggle'); await wp.fill('#lockRecovery', rc.toLowerCase()); await wp.click('#lockSubmit'); await sleep(1200);
  check('Khóa ngay → mở bằng mã khôi phục (không phân biệt hoa thường)', await wp.evaluate(() => document.getElementById('lockScreen').hidden));
  await wp.evaluate(() => { location.hash = '#/settings?section=security'; }); await sleep(300);
  await wp.click('#secChangePin'); await sleep(200); await wp.fill('#fs_old', '2468'); await wp.fill('#fs_pin', '13579'); await wp.fill('#fs_pin2', '13579'); await wp.click('#fsSave'); await sleep(1500);
  await wp.reload(); await sleep(700); await wp.fill('#lockPin', '13579'); await wp.click('#lockSubmit');
  await wp.waitForFunction(() => window.__mm && window.__mm.state.getData(), null, { timeout: 10000 });
  await wp.evaluate(() => { location.hash = '#/settings?section=security'; }); await sleep(300);
  await wp.click('#secDisable'); await sleep(200); await wp.fill('#fs_old', '13579'); await wp.click('#fsSave'); await sleep(1200);
  const dis = await wp.evaluate(() => { const raw = JSON.parse(localStorage.getItem('mm_data_v3')); return { enc: raw.enc, tx: (raw.transactions || []).length }; });
  await wp.reload(); await sleep(700);
  check('Đổi PIN → mở bằng PIN mới; tắt mã hóa → dữ liệu dạng thường, không còn màn hình khóa', dis.enc === undefined && dis.tx === 6 && (await wp.evaluate(() => document.getElementById('lockScreen').hidden && !!window.__mm)), JSON.stringify(dis));
  await wctx.close();
}

// 13) Desktop screenshots
const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
const dpage = await dctx.newPage();
await dpage.goto(BASE);
await dpage.waitForFunction(() => window.__mm && window.__mm.state.getData(), null, { timeout: 10000 });
await dpage.evaluate(({ tx, st }) => { localStorage.clear(); localStorage.setItem('mm_transactions_v1', JSON.stringify(tx)); localStorage.setItem('mm_settings_v1', JSON.stringify(st)); }, { tx: V1_TX, st: V1_SETTINGS });
await dpage.reload(); await dpage.waitForFunction(() => window.__mm && document.querySelectorAll('#accountList .acc-row').length > 0); await sleep(600);
await dpage.screenshot({ path: `${OUT}/p1a-04-desktop-home.png`, fullPage: true });
await dpage.evaluate(() => { location.hash = '#/tx'; }); await sleep(500);
await dpage.screenshot({ path: `${OUT}/p1a-05-desktop-tx.png`, fullPage: true });
await dctx.close();

check('Không có lỗi JS / dialog native trong suốt phiên', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
console.log(failures ? `\n❌ ${failures} kiểm tra thất bại` : '\n✅ Tất cả kiểm tra E2E đạt');
process.exit(failures ? 1 : 0);
