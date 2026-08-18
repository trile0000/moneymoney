// Điểm vào ứng dụng (v2.1 / P1a): boot, router, luồng dùng chung (thêm/sửa/xóa/undo/nhập/xuất/xóa tất cả), theme, i18n, SW.
import { APP_VERSION } from './version.js';
import { loadAll, unlockAndLoad, onStorageEvent, blobGet, blobPut, blobDelete, blobClear, blobUsage } from './storage.js';
import * as S from './state.js';
import { $, el } from './utils/dom.js';
import { formatVND } from './utils/money.js';
import { toLocalYMD } from './utils/date.js';
import { transactionsToCSV, backupToJSON, downloadText, dedupeAgainst, parseBackupJSON, dataUrlToBlob, blobToDataUrl } from './features/importExport.js';
import { pathName } from './features/categories.js';
import { t, setLocale, applyI18n, getLocale } from './i18n.js';
import { applyTheme, nextTheme, onThemeChange } from './ui/theme.js';
import { showToast } from './ui/toast.js';
import { confirmDialog } from './ui/confirm.js';
import { openEditSheet } from './ui/editSheet.js';
import { initUndo, queueUndo, commit as commitUndo } from './ui/undo.js';
import { registerSW } from './ui/swUpdate.js';
import { startRouter, onView, navigate, currentView } from './router.js';
import { initHome, renderHome, resetAchievementState } from './views/home.js';
import { initTx, renderTx } from './views/tx.js';
import { initBudget, renderBudget } from './views/budget.js';
import { initWealth, renderWealth, snapshotNow, healthSummary, syncBadges } from './views/wealth.js';
import { initIou, renderIou } from './views/iou.js';
import { initInvest, renderInvest } from './views/invest.js';
import { shouldOnboard, runOnboarding } from './ui/onboarding.js';
import { openCsvWizard } from './ui/csvWizard.js';
import { showLockScreen } from './ui/lock.js';
import { initSecurity, renderSecurity } from './views/security.js';
import { initSettings, renderSettings, openCategoryForm, openAccountForm, openRuleForm } from './views/settings.js';

let version = 0; // tăng mỗi lần dữ liệu đổi (để virtual list biết cần dựng lại dòng)
const dirty = { home: true, tx: true, budget: true, settings: true };

const ctx = {
  editFlow, deleteFlow, refresh, exportCSV: doExportCSV, openCategoryForm, openAccountForm, openRuleForm,
  applyTheme: () => { applyTheme(S.getSettings().theme); refresh('theme'); },
  applyLocale: () => { setLocale(S.getSettings().locale); applyI18n(); refresh('settings'); },
  version: () => version,
};

// ---------- Khởi động ----------
(async function boot() {
  window.addEventListener('error', (e) => { console.error(e.error || e.message); showToast(t('common.error') + ': ' + (e.message || 'JS error'), { kind: 'error' }); });
  window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); showToast(t('common.error') + ': ' + (e.reason && e.reason.message || 'Promise'), { kind: 'error' }); });

  let loaded = await loadAll();
  if (loaded.locked) {
    // Dữ liệu đang mã hóa: hiện màn hình khóa trước, chỉ đi tiếp khi PIN/mã khôi phục đúng
    setLocale(loaded.settings.locale); applyI18n(); applyTheme(loaded.settings.theme);
    const lockedInfo = loaded;
    let result = null;
    await showLockScreen({ tryUnlock: async (secret) => { result = await unlockAndLoad(lockedInfo, secret); return !!result; } });
    loaded = result;
  }
  const { data, settings, migrated, fromVersion, source } = loaded;
  S.init({ data, settings });
  setLocale(settings.locale);
  applyI18n();
  applyTheme(settings.theme);
  onThemeChange(() => { if (currentView() === 'home') renderHome('chart'); });

  onStorageEvent((ev) => {
    if (ev.type === 'quota') showToast(t(ev.idb ? 'toast.quotaIdb' : 'toast.quotaFail'), { kind: 'error', duration: 8000 });
    else if (ev.type === 'error') showToast(t(ev.idb ? 'toast.lsErrIdb' : 'toast.lsErr'), { kind: 'error', duration: 8000 });
  });

  initHome(ctx);
  initTx(ctx);
  initBudget(ctx);
  initWealth(ctx);
  initIou(ctx);
  initInvest(ctx);
  initSettings(ctx);
  initSecurity(ctx);
  initUndo({
    onCommit: async (ids) => { for (const id of ids) { const tx = S.getById(id); if (tx && tx.receiptId) await blobDelete(tx.receiptId); } await S.purgeDeleted(ids); },
    onUndo: async (ids) => { for (const id of ids) await S.restore(id); refresh('data'); showToast(t('undo.done')); },
  });
  bindGlobal();
  updateOnline();

  // Định kỳ đến hạn (kể cả kỳ còn thiếu)
  const added = await S.runRecurringNow();
  if (added.length) toastRecurring(added);

  onView('home', (p, info) => { if (info.changed || dirty.home) { renderHome(info.changed && !dirty.home ? 'chart' : 'init'); dirty.home = false; } });
  onView('tx', (p, info) => { renderTx(info.changed ? p : {}); dirty.tx = false; });
  onView('budget', (p, info) => { renderBudget(); renderIou(); renderInvest(); renderWealth(info.changed ? p : {}); dirty.budget = false; });
  onView('settings', (p, info) => { renderSettings(info.changed ? p : {}); renderSecurity(); dirty.settings = false; });
  startRouter();
  registerSW();

  afterDataChange();
  if (shouldOnboard(settings, data)) setTimeout(() => runOnboarding(ctx), 400);
  else if (!settings.onboarded) S.updateSettings({ onboarded: true }, { silent: true });
  if (migrated && fromVersion === 1) showToast(t('toast.migratedV1', { n: data.transactions.length }), { duration: 6000 });
  else if (migrated && fromVersion === 2) showToast(t('toast.migratedV2', { acc: (data.accounts[0] || {}).name || 'Tiền mặt', c: data.categories.length }), { duration: 7000 });
  if (source === 'indexedDB') showToast(t('toast.recovered'), { kind: 'warn', duration: 5000 });
})();

function toastRecurring(added) {
  if (added.length === 1) showToast(t('toast.recurring1', { name: added[0].note || added[0].category || '', amount: formatVND(added[0].amount), date: added[0].date }), { duration: 5000 });
  else showToast(t('toast.recurringN', { n: added.length }), { duration: 5000 });
}

/** Gọi sau mọi thay đổi dữ liệu / cài đặt: đánh dấu bẩn & render lại view đang mở */
function refresh(reason = 'data') {
  if (reason === 'data') version++;
  dirty.home = dirty.tx = dirty.budget = dirty.settings = true;
  const v = currentView();
  if (v === 'home') { renderHome(reason === 'theme' ? 'chart' : reason); dirty.home = false; }
  else if (v === 'tx') { renderTx(); dirty.tx = false; }
  else if (v === 'budget') { renderBudget(); renderIou(); renderInvest(); renderWealth(); dirty.budget = false; }
  else if (v === 'settings') { renderSettings(); renderSecurity(); dirty.settings = false; }
  if (reason === 'data') afterDataChange();
}

/** P1c: sau khi dữ liệu đổi — lưu snapshot tài sản ròng tháng này & kiểm tra huy hiệu mới (không chặn UI) */
let afterTimer = 0;
function afterDataChange() {
  clearTimeout(afterTimer);
  afterTimer = setTimeout(async () => {
    try { await snapshotNow(); await syncBadges(healthSummary().badges); } catch (e) { console.error(e); }
  }, 300);
}

// ---------- CRUD flows dùng chung ----------
async function deleteFlow(id) {
  const tx = S.getById(id);
  if (!tx) return;
  await S.softDelete(id);
  refresh('data');
  const cat = tx.type !== 'transfer' ? S.getCategoryById(tx.categoryId) : null;
  queueUndo(id, `${cat ? cat.name : (tx.type === 'transfer' ? t('tx.transfer') : tx.category)} ${formatVND(tx.amount)}`);
}
function editFlow(id) {
  const tx = S.getById(id);
  if (!tx) return;
  openEditSheet(tx, {
    onSave: async (tid, patch) => { await S.updateTransaction(tid, patch); refresh('data'); showToast(t('edit.updated')); },
    onDelete: deleteFlow,
    onDuplicate: async (orig, patch) => {
      await S.addTransaction({ ...patch, date: toLocalYMD(), source: 'manual' });
      refresh('data');
      showToast(t('edit.duplicated'));
    },
    onNewCategory: (type) => openCategoryForm(null, { kind: type === 'income' ? 'income' : 'expense' }),
  });
}

// ---------- Xuất / nhập / sao lưu ----------
function csvCtx() {
  const cats = S.getCategories({ includeArchived: true });
  return { accountName: (id) => { const a = S.getAccountById(id); return a ? a.name : ''; }, categoryPath: (id, tx) => (id ? pathName(cats, id) || tx.category : tx.category) };
}
function doExportCSV(items, tag = 'tatca') {
  if (!items || !items.length) { showToast(t('data.exportNone'), { kind: 'warn' }); return; }
  downloadText(transactionsToCSV(items, csvCtx()), `moneymoney-${tag}-${toLocalYMD()}.csv`, 'text/csv;charset=utf-8;');
  showToast(t('data.exported', { n: items.length }));
}
async function doBackup() {
  let receipts = null;
  const withIds = S.getVisible().filter((x) => x.receiptId);
  if (withIds.length) {
    const u = await blobUsage();
    const r = await confirmDialog({ title: t('data.backupReceiptsTitle'), body: t('data.backupReceiptsBody', { n: withIds.length, mb: (u.bytes / 1048576).toFixed(1) }), okText: t('data.backupWith'), okClass: 'primary', extraText: t('data.backupWithout'), extraResolves: true });
    if (!r) return;
    if (r === true) {
      receipts = [];
      for (const x of withIds) { const b = await blobGet(x.receiptId); if (b) receipts.push({ id: x.receiptId, dataUrl: await blobToDataUrl(b) }); }
    }
  }
  downloadText(backupToJSON(S.getData(), S.getSettings(), { receipts }), `moneymoney-backup-${toLocalYMD()}.json`, 'application/json;charset=utf-8');
  showToast(t('data.backupDone'));
}
async function restoreReceipts(list, onlyIds = null) {
  let n = 0;
  for (const r of list || []) { if (onlyIds && !onlyIds.has(r.id)) continue; const b = dataUrlToBlob(r.dataUrl); if (b && (await blobPut(r.id, b)) !== false) n++; }
  return n;
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
  await openCsvWizard(file, {
    onImport: async (fresh) => {
      const n = await S.addMany(fresh, { source: 'import' });
      refresh('data');
      return n;
    },
  });
}
async function restoreJSONFlow() {
  const file = await pickFile($('#fileJSON'));
  if (!file) return;
  let parsed;
  try { parsed = parseBackupJSON(await file.text()); }
  catch (e) { await confirmDialog({ title: t('data.restoreFail'), body: e.message, okText: t('common.close'), okClass: 'primary' }); return; }
  const cur = S.getVisible().length;
  const ok = await confirmDialog({
    title: t('data.restoreTitle'),
    body: t('data.restoreBody', { n: parsed.transactions.length, settings: parsed.settings ? t('data.restoreSettings') : '', a: parsed.data.accounts.length, c: parsed.data.categories.length, cur }),
    okText: t('data.restoreReplace'), okClass: 'danger',
    extraText: t('data.restoreMerge'), extraResolves: true,
    requireCheck: true, checkLabel: t('data.restoreCheck'),
  });
  if (ok === 'extra') {
    // Gộp: thêm ví/danh mục còn thiếu (theo tên) rồi giao dịch mới
    const accMap = new Map();
    for (const a of parsed.data.accounts) {
      const found = S.getAccounts({ includeArchived: true }).find((x) => x.name.trim().toLowerCase() === a.name.trim().toLowerCase());
      accMap.set(a.id, found ? found.id : (await S.addAccount({ ...a, id: undefined })).id);
    }
    const catMap = new Map();
    for (const c of parsed.data.categories) {
      const found = S.getCategories({ includeArchived: true }).find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase() && !x.parentId);
      catMap.set(c.id, found ? found.id : (await S.addCategory({ ...c, id: undefined, parentId: null })).id);
    }
    const items = parsed.transactions.map((x) => ({ ...x, accountId: accMap.get(x.accountId) || S.getSettings().defaultAccountId, toAccountId: x.toAccountId ? accMap.get(x.toAccountId) : undefined, categoryId: x.categoryId ? catMap.get(x.categoryId) : undefined }));
    const { fresh, dupes } = dedupeAgainst(items, S.getAllRaw());
    const n = await S.addMany(fresh, { source: 'import' });
    await restoreReceipts(parsed.receipts, new Set(fresh.map((x) => x.receiptId).filter(Boolean)));
    refresh('data');
    showToast(t('data.merged', { n, d: dupes }));
    return;
  }
  if (!ok) return;
  commitUndo();
  await blobClear();
  await S.replaceData(parsed.data);
  await restoreReceipts(parsed.receipts);
  if (parsed.settings) await S.updateSettings(parsed.settings, { silent: true });
  setLocale(S.getSettings().locale); applyI18n(); applyTheme(S.getSettings().theme);
  resetAchievementState();
  refresh('data');
  showToast(t('data.restored', { n: parsed.transactions.length }));
}
async function clearAllFlow() {
  const n = S.getVisible().length;
  if (!n) { showToast(t('clear.none')); return; }
  const step1 = await confirmDialog({ title: t('clear.title1'), body: t('clear.body1', { n }), okText: t('clear.ok1'), okClass: 'primary', extraText: t('data.backup'), onExtra: doBackup });
  if (!step1) return;
  const step2 = await confirmDialog({ title: t('clear.title2'), body: t('clear.body2', { n }), okText: t('clear.ok2'), okClass: 'danger', requireCheck: true, checkLabel: t('clear.check2') });
  if (!step2) return;
  commitUndo();
  await S.clearAllTransactions();
  await blobClear();
  resetAchievementState();
  refresh('data');
  showToast(t('clear.done'));
}

// ---------- Sự kiện toàn cục ----------
function bindGlobal() {
  $('#rerunOnboarding').addEventListener('click', () => runOnboarding(ctx));
  $('#themeToggle').addEventListener('click', async () => {
    const nt = nextTheme(S.getSettings().theme);
    await S.updateSettings({ theme: nt }, { silent: true });
    applyTheme(nt);
    if (currentView() === 'settings') renderSettings();
    else if (currentView() === 'home') renderHome('chart');
  });
  $('#backupJSON').addEventListener('click', doBackup);
  $('#restoreJSON').addEventListener('click', restoreJSONFlow);
  $('#importCSV').addEventListener('click', importCSVFlow);
  $('#exportCSVAll').addEventListener('click', () => doExportCSV(S.getVisible(), 'tatca'));
  $('#clearAll').addEventListener('click', clearAllFlow);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    const added = await S.runRecurringNow();
    if (added.length) { toastRecurring(added); refresh('data'); }
  });
}
function updateOnline() { document.body.classList.toggle('offline', !navigator.onLine); }

// Dùng cho kiểm thử tự động
window.__mm = { state: S, refresh, navigate, version: APP_VERSION, t, getLocale };
