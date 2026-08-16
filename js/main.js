// Điểm vào ứng dụng — nối state ↔ UI. Không chứa logic nghiệp vụ (nằm ở features/), không innerHTML.
import { APP_VERSION } from './version.js';
import { loadAll, onStorageEvent, estimateUsage } from './storage.js';
import * as S from './state.js';
import { $, $$, el, clear } from './utils/dom.js';
import { formatVND, parseAmount } from './utils/money.js';
import { toLocalYMD, toLocalYM, isValidYMD, isValidYM, addMonths, monthLabel } from './utils/date.js';
import { computeSalaryBackfill } from './features/recurring.js';
import { tierOf, tierMessage, mascotFor, evaluateAchievement } from './features/achievements.js';
import { transactionsToCSV, backupToJSON, downloadText, parseTransactionsCSV, dedupeAgainst, parseBackupJSON } from './features/importExport.js';
import { showToast } from './ui/toast.js';
import { fireConfetti } from './ui/confetti.js';
import { openModal } from './ui/modal.js';
import { confirmDialog } from './ui/confirm.js';
import { openEditSheet } from './ui/editSheet.js';
import { createVirtualList } from './ui/list.js';
import { bindListGestures } from './ui/gestures.js';
import { renderChart } from './ui/charts.js';
import { bindAmountInput } from './ui/amountInput.js';
import { initUndo, queueUndo, commit as commitUndo } from './ui/undo.js';
import { registerSW } from './ui/swUpdate.js';

const ASSET = 'assets/mascot/sm/';
const els = {};
let list = null;
let amountCtl = null;
let prevCurrentTier = null; // tier tháng hiện tại lần render trước (chỉ dùng cho thành tựu)
let lastMascotPick = null;

// ---------- Khởi động ----------
(async function boot() {
  cacheEls();
  $('#appVersion').textContent = 'v' + APP_VERSION;
  window.addEventListener('error', (e) => { console.error(e.error || e.message); showToast('Lỗi: ' + (e.message || 'JS error'), { kind: 'error' }); });
  window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); showToast('Lỗi: ' + (e.reason && e.reason.message || 'Promise'), { kind: 'error' }); });

  const { data, settings, migrated, source } = await loadAll();
  S.init({ data, settings });
  if (migrated) showToast(`✅ Đã nâng cấp dữ liệu (${data.transactions.length} giao dịch), bản cũ vẫn được giữ nguyên.`, { duration: 5000 });
  if (source === 'indexedDB') showToast('ℹ️ Đã khôi phục dữ liệu từ IndexedDB.', { kind: 'warn', duration: 5000 });

  onStorageEvent((ev) => {
    if (ev.type === 'quota') showToast(ev.idb ? '⚠️ Bộ nhớ localStorage đầy — dữ liệu vẫn được lưu vào IndexedDB. Hãy Sao lưu JSON ngay.' : '❌ KHÔNG LƯU ĐƯỢC dữ liệu (bộ nhớ đầy). Hãy Sao lưu JSON ngay!', { kind: 'error', duration: 8000 });
    else if (ev.type === 'error') showToast(ev.idb ? '⚠️ localStorage lỗi, đã lưu vào IndexedDB.' : '❌ Không lưu được dữ liệu!', { kind: 'error', duration: 8000 });
  });

  const today = toLocalYMD();
  els.txDate.value = today;
  els.filterMonth.value = today.slice(0, 7);
  amountCtl = bindAmountInput(els.amount, els.amountHint);

  list = createVirtualList(els.listViewport, els.listCanvas, { onEdit: editFlow, onDelete: deleteFlow });
  bindListGestures(els.listViewport, { onEdit: editFlow, onDelete: deleteFlow });
  initUndo({
    onCommit: async (ids) => { await S.purgeDeleted(ids); },
    onUndo: async (ids) => { for (const id of ids) await S.restore(id); render('data'); showToast('↩️ Đã hoàn tác'); },
  });

  bindEvents();
  updateOnline();
  await runSalaryBackfill();
  render('init');
  registerSW();
})();

function cacheEls() {
  const ids = ['listViewport', 'listCanvas', 'emptyState', 'sumIncome', 'sumExpense', 'sumBalance', 'chart', 'chartType', 'chartMode', 'chartScope',
    'mascotBalance', 'mascotChart', 'balanceStatus', 'txDate', 'filterMonth', 'txCount', 'amount', 'amountHint', 'category', 'note', 'type',
    'addForm', 'formError', 'recentCats', 'settingsModal', 'storageInfo'];
  for (const id of ids) els[id] = $('#' + id);
}

// ---------- Render ----------
function currentMonthKey() {
  const v = els.filterMonth.value;
  return isValidYM(v) ? v : '';
}
function monthData(key) {
  if (key) return S.getMonth(key);
  const items = S.getVisible();
  let income = 0, expense = 0;
  for (const t of items) { if (t.type === 'income') income += t.amount; else expense += t.amount; }
  return { income, expense, count: items.length, items };
}

/** reason: 'init' | 'data' | 'filter' | 'settings' | 'chart' */
function render(reason = 'data') {
  const key = currentMonthKey();
  const m = monthData(key);
  const settings = S.getSettings();

  // KPI
  setKpi(els.sumIncome, m.income);
  setKpi(els.sumExpense, m.expense);
  setKpi(els.sumBalance, m.income - m.expense);
  els.txCount.textContent = `${m.count} giao dịch`;

  // Tier HIỂN THỊ theo tháng đang xem
  const balance = m.income - m.expense;
  const tier = tierOf(balance, settings.thresholds);
  const pick = mascotFor(tier);
  if (pick.file !== lastMascotPick) {
    els.mascotBalance.classList.remove('mascot-animate');
    void els.mascotBalance.offsetWidth;
    els.mascotBalance.classList.add('mascot-animate');
    lastMascotPick = pick.file;
  }
  els.mascotBalance.src = ASSET + pick.file + '.webp';
  els.balanceStatus.className = 'status-bar status--' + pick.status;
  els.balanceStatus.textContent = tierMessage(tier, balance, settings.messages, formatVND);
  els.mascotChart.src = ASSET + (els.chartMode.value === 'byCategory' ? 'tiger_spending' : 'tiger_income') + '.webp';

  // THÀNH TỰU: chỉ theo tháng hiện tại & khi dữ liệu thật đổi (sửa lỗi #11)
  if (reason === 'init' || reason === 'data' || reason === 'settings') {
    const cur = S.getMonth(toLocalYM());
    const curTier = tierOf(cur.income - cur.expense, settings.thresholds);
    const ev = evaluateAchievement({ tier: curTier, prevTier: prevCurrentTier, bestTier: settings.bestTier, isCurrentMonth: true, reason });
    if (ev.confetti) fireConfetti(curTier);
    if (ev.newBest) { S.updateSettings({ bestTier: curTier, bestTierMonth: toLocalYM() }, { silent: true }); showToast('🎉 Kỷ lục mới: Tier ' + curTier); }
    prevCurrentTier = curTier;
  }

  // Biểu đồ
  renderChart({ canvas: els.chart, scopeEl: els.chartScope, mode: els.chartMode.value, type: els.chartType.value, monthKey: key, month: m, monthIndex: S.getMonthIndex() });

  // Danh sách
  list.setItems(m.items);
  els.emptyState.style.display = m.items.length ? 'none' : 'flex';
  els.emptyState.textContent = key ? `Chưa có giao dịch nào trong ${monthLabel(key)}.` : 'Chưa có giao dịch nào.';
  els.listViewport.setAttribute('aria-label', `Danh sách giao dịch ${key ? monthLabel(key) : 'tất cả'} (${m.items.length})`);

  if (reason !== 'chart' && reason !== 'filter') renderRecentCats();
}

/** Ghi số KPI và tự thu nhỏ chữ nếu không vừa ô (số rất lớn trên màn hình hẹp) */
function setKpi(node, value) {
  node.textContent = formatVND(value, { withUnit: false });
  node.setAttribute('aria-label', formatVND(value));
  node.style.fontSize = '';
  let size = parseFloat(getComputedStyle(node).fontSize) || 16;
  let guard = 0;
  while (node.scrollWidth > node.clientWidth + 1 && size > 10 && guard++ < 8) {
    size -= 1;
    node.style.fontSize = size + 'px';
  }
}

function renderRecentCats() {
  const cats = S.getCategoryStats().slice(0, 6);
  clear(els.recentCats);
  for (const c of cats) {
    els.recentCats.appendChild(el('button', { className: 'chip', type: 'button', text: c, on: { click: () => { els.category.value = c; els.amount.focus(); } } }));
  }
}

// ---------- Lương định kỳ ----------
async function runSalaryBackfill() {
  const s = S.getSettings();
  const { toAdd, lastSalaryPeriod } = computeSalaryBackfill({ settings: s, transactions: S.getAllRaw(), todayYM: toLocalYM() });
  if (toAdd.length) await S.addMany(toAdd, { source: 'auto-salary' });
  if (lastSalaryPeriod !== s.lastSalaryPeriod) await S.updateSettings({ lastSalaryPeriod }, { silent: true });
  if (toAdd.length) showToast(toAdd.length === 1 ? `💰 Đã tự động thêm lương ${monthLabel(toAdd[0].periodKey)}` : `💰 Đã bù ${toAdd.length} kỳ lương còn thiếu (${toAdd.map((t) => monthLabel(t.periodKey)).join(', ')})`, { duration: 5000 });
  return toAdd.length;
}

// ---------- CRUD flows ----------
async function addFlow(e) {
  e && e.preventDefault();
  els.formError.textContent = '';
  const amount = amountCtl.getValue();
  const category = els.category.value.trim();
  const date = els.txDate.value;
  const type = els.type.value === 'income' ? 'income' : 'expense';
  const note = els.note.value.trim();
  // Validate (sửa lỗi #9)
  if (!amount || amount <= 0) return fail('Số tiền phải lớn hơn 0 (VD: 50k, 1tr5, 1.250.000)', els.amount);
  if (!category) return fail('Vui lòng nhập danh mục', els.category);
  if (!isValidYMD(date)) return fail('Ngày không hợp lệ', els.txDate);
  await S.addTransaction({ type, amount, category, note, date, source: 'manual' });
  amountCtl.clear();
  els.note.value = '';
  els.category.value = '';
  $$('[aria-invalid]', els.addForm).forEach((n) => n.removeAttribute('aria-invalid'));
  // Nếu tháng đang lọc khác tháng của giao dịch vừa thêm → nhảy sang tháng đó để người dùng thấy ngay
  if (currentMonthKey() && currentMonthKey() !== date.slice(0, 7)) els.filterMonth.value = date.slice(0, 7);
  render('data');
  showToast(`✅ Đã thêm ${type === 'income' ? 'khoản thu' : 'khoản chi'} ${formatVND(amount)}`);
  els.category.focus();
  function fail(msg, focusEl) { els.formError.textContent = msg; if (focusEl) { focusEl.setAttribute('aria-invalid', 'true'); focusEl.focus(); } return false; }
}

async function deleteFlow(id) {
  const t = S.getById(id);
  if (!t) return;
  await S.softDelete(id);
  render('data');
  queueUndo(id, `${t.category} ${formatVND(t.amount)}`);
}

function editFlow(id) {
  const t = S.getById(id);
  if (!t) return;
  openEditSheet(t, {
    onSave: async (tid, patch) => { await S.updateTransaction(tid, patch); render('data'); showToast('✅ Đã cập nhật'); },
    onDelete: deleteFlow,
  });
}

// ---------- Xóa tất cả (2 bước + gợi ý backup, sửa lỗi #4) ----------
async function clearAllFlow() {
  const n = S.getVisible().length;
  if (!n) { showToast('Không có giao dịch nào để xóa'); return; }
  const step1 = await confirmDialog({
    title: 'Xóa tất cả giao dịch?',
    body: `Bạn sắp xóa ${n} giao dịch. Việc này KHÔNG thể hoàn tác.\nHãy sao lưu trước — bấm "Sao lưu JSON" bên dưới, file sẽ tải về máy.`,
    okText: 'Tôi đã sao lưu, tiếp tục', okClass: 'primary',
    extraText: '💾 Sao lưu JSON', onExtra: doBackup,
  });
  if (!step1) return;
  const step2 = await confirmDialog({
    title: 'Xác nhận lần cuối',
    body: `Xóa vĩnh viễn ${n} giao dịch? Cài đặt (lương, ngưỡng, thông điệp) vẫn được giữ.`,
    okText: 'Xóa vĩnh viễn', okClass: 'danger',
    requireCheck: true, checkLabel: 'Tôi hiểu toàn bộ giao dịch sẽ bị xóa và không thể khôi phục nếu chưa sao lưu.',
  });
  if (!step2) return;
  commitUndo();
  await S.clearAllTransactions();
  prevCurrentTier = null;
  render('data');
  showToast('🗑️ Đã xóa tất cả giao dịch');
}

// ---------- Xuất / nhập ----------
function doExportCSV(all = false) {
  const key = currentMonthKey();
  const items = all || !key ? S.getVisible() : S.getMonth(key).items;
  if (!items.length) { showToast('Không có giao dịch để xuất', { kind: 'warn' }); return; }
  const name = all || !key ? `moneymoney-tatca-${toLocalYMD()}.csv` : `moneymoney-${key}.csv`;
  downloadText(transactionsToCSV(items), name, 'text/csv;charset=utf-8;');
  showToast(`📄 Đã xuất ${items.length} giao dịch`);
}
function doBackup() {
  downloadText(backupToJSON({ transactions: S.getAllRaw(), meta: S.getMeta() }, S.getSettings()), `moneymoney-backup-${toLocalYMD()}.json`, 'application/json;charset=utf-8');
  showToast('💾 Đã tải file sao lưu');
}
function pickFile(inputEl) {
  return new Promise((resolve) => {
    inputEl.value = '';
    const onChange = () => { inputEl.removeEventListener('change', onChange); resolve(inputEl.files && inputEl.files[0] || null); };
    inputEl.addEventListener('change', onChange);
    inputEl.click();
  });
}
async function importCSVFlow() {
  const file = await pickFile($('#fileCSV'));
  if (!file) return;
  const text = await file.text();
  const { items, errors } = parseTransactionsCSV(text);
  if (!items.length) { await confirmDialog({ title: 'Không nhập được', body: errors.slice(0, 8).join('\n') || 'File không có dòng hợp lệ', okText: 'Đóng', okClass: 'primary' }); return; }
  const { fresh, dupes } = dedupeAgainst(items, S.getAllRaw());
  const preview = fresh.slice(0, 5).map((t) => `• ${t.date} ${t.type === 'income' ? '+' : '−'}${formatVND(t.amount)} ${t.category}${t.note ? ' — ' + t.note : ''}`).join('\n');
  const ok = await confirmDialog({
    title: 'Nhập CSV',
    body: `Đọc được ${items.length} dòng, ${dupes} trùng (bỏ qua), sẽ thêm ${fresh.length} giao dịch.${errors.length ? `\n${errors.length} dòng lỗi bị bỏ qua.` : ''}\n\n${preview}${fresh.length > 5 ? '\n…' : ''}`,
    okText: `Thêm ${fresh.length} giao dịch`, okClass: 'primary',
  });
  if (!ok || !fresh.length) return;
  const n = await S.addMany(fresh, { source: 'import' });
  render('data');
  showToast(`📥 Đã nhập ${n} giao dịch`);
}
async function restoreJSONFlow() {
  const file = await pickFile($('#fileJSON'));
  if (!file) return;
  let parsed;
  try { parsed = parseBackupJSON(await file.text()); }
  catch (e) { await confirmDialog({ title: 'Không đọc được file', body: e.message, okText: 'Đóng', okClass: 'primary' }); return; }
  const cur = S.getVisible().length;
  const ok = await confirmDialog({
    title: 'Khôi phục sao lưu',
    body: `File có ${parsed.transactions.length} giao dịch${parsed.settings ? ' + cài đặt' : ''}. Hiện app đang có ${cur} giao dịch.\n\n• "Gộp": chỉ thêm giao dịch chưa có (theo id/vân tay), giữ nguyên dữ liệu hiện tại.\n• "Thay thế": xóa toàn bộ dữ liệu hiện tại rồi nạp từ file.`,
    okText: 'Thay thế toàn bộ', okClass: 'danger',
    extraText: 'Gộp (chỉ thêm mới)', extraResolves: true,
    requireCheck: true, checkLabel: 'Tôi hiểu "Thay thế" sẽ xóa dữ liệu hiện tại.',
  });
  if (ok === 'extra') {
    const { fresh, dupes } = dedupeAgainst(parsed.transactions, S.getAllRaw());
    const n = await S.addMany(fresh, { source: 'import' });
    render('data');
    showToast(`📂 Đã gộp ${n} giao dịch mới (${dupes} trùng)`);
    return;
  }
  if (!ok) return;
  commitUndo();
  await S.replaceAll(parsed.transactions, parsed.meta);
  if (parsed.settings) await S.updateSettings(parsed.settings, { silent: true });
  prevCurrentTier = null;
  render('data');
  showToast(`📂 Đã khôi phục ${parsed.transactions.length} giao dịch`);
}

// ---------- Cài đặt ----------
const stCtl = {};
function openSettings() {
  const s = S.getSettings();
  if (!stCtl.salary) {
    stCtl.salary = bindAmountInput($('#stSalary'), $('#stSalaryHint'));
    for (const k of ['stTh2', 'stTh3', 'stTh4']) { const h = el('div', { className: 'hint' }); $('#' + k).after(h); stCtl[k] = bindAmountInput($('#' + k), h); }
  }
  stCtl.salary.setValue(s.salary || 0);
  $('#stSalaryCategory').value = s.salaryCategory || 'Lương';
  stCtl.stTh2.setValue(s.thresholds.t2); stCtl.stTh3.setValue(s.thresholds.t3); stCtl.stTh4.setValue(s.thresholds.t4);
  $('#stBest').value = s.bestTier ? `Tier ${s.bestTier}${s.bestTierMonth ? ' (' + monthLabel(s.bestTierMonth) + ')' : ''}` : 'Chưa có';
  for (let i = 0; i <= 4; i++) $('#msgT' + i).value = s.messages['t' + i] || '';
  const kb = estimateUsage() / 1024;
  els.storageInfo.textContent = `Đang dùng ~${kb.toFixed(0)} KB localStorage · ${S.getVisible().length} giao dịch · schema v${s.schemaVersion}`;

  const saveBtn = $('#saveSettings');
  const onSave = async () => {
    const prev = S.getSettings();
    const salary = Math.max(0, stCtl.salary.getValue() || 0);
    const t2 = Math.max(0, stCtl.stTh2.getValue() || 0);
    const t3 = Math.max(t2, stCtl.stTh3.getValue() || 0);
    const t4 = Math.max(t3, stCtl.stTh4.getValue() || 0);
    const patch = {
      salary,
      salaryCategory: ($('#stSalaryCategory').value || 'Lương').trim() || 'Lương',
      thresholds: { t2, t3, t4 },
      messages: Object.fromEntries([0, 1, 2, 3, 4].map((i) => ['t' + i, $('#msgT' + i).value])),
    };
    // Vừa bật lương (0 → >0): chỉ sinh cho tháng hiện tại, không bù ngược quá khứ
    if (salary > 0 && !(prev.salary > 0)) patch.lastSalaryPeriod = addMonths(toLocalYM(), -1);
    await S.updateSettings(patch, { silent: true });
    close();
    const added = await runSalaryBackfill();
    render('settings');
    if (!added) showToast('✅ Đã lưu cài đặt');
  };
  saveBtn.addEventListener('click', onSave);
  const close = openModal(els.settingsModal, { onClose: () => saveBtn.removeEventListener('click', onSave) });
}

// ---------- Sự kiện ----------
function bindEvents() {
  els.addForm.addEventListener('submit', addFlow);
  $('#resetForm').addEventListener('click', () => { amountCtl.clear(); els.note.value = ''; els.category.value = ''; els.formError.textContent = ''; els.txDate.value = toLocalYMD(); els.amount.focus(); });
  // Enter trong ô số tiền/danh mục → thêm luôn (Ctrl/Cmd+Enter trong ghi chú)
  els.note.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') addFlow(e); });
  $('#openSettings').addEventListener('click', openSettings);
  $('#exportCSV').addEventListener('click', () => doExportCSV(false));
  $('#exportCSVAll').addEventListener('click', () => doExportCSV(true));
  $('#backupJSON').addEventListener('click', doBackup);
  $('#restoreJSON').addEventListener('click', restoreJSONFlow);
  $('#importCSV').addEventListener('click', importCSVFlow);
  $('#clearAll').addEventListener('click', clearAllFlow);
  els.chartType.addEventListener('change', () => render('chart'));
  els.chartMode.addEventListener('change', () => render('chart'));
  els.filterMonth.addEventListener('change', () => render('filter'));
  $('#thisMonth').addEventListener('click', () => { els.filterMonth.value = toLocalYM(); render('filter'); });
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  // Kiểm tra lương thiếu khi quay lại app sau thời gian dài (qua tháng mới)
  document.addEventListener('visibilitychange', async () => { if (!document.hidden) { const n = await runSalaryBackfill(); if (n) render('data'); } });
}
function updateOnline() { document.body.classList.toggle('offline', !navigator.onLine); }

// Dùng cho kiểm thử tự động (không ảnh hưởng người dùng)
window.__mm = { state: S, render, parseAmount, version: APP_VERSION };
