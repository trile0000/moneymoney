// Tab Giao dịch: form thêm nhanh + tìm kiếm/lọc + danh sách ảo.
import * as S from '../state.js';
import { $, $$, el, clear } from '../utils/dom.js';
import { formatVND, parseAmount } from '../utils/money.js';
import { toLocalYMD, isValidYMD } from '../utils/date.js';
import { t } from '../i18n.js';
import { showToast } from '../ui/toast.js';
import { bindAmountInput } from '../ui/amountInput.js';
import { createVirtualList } from '../ui/list.js';
import { bindListGestures } from '../ui/gestures.js';
import { openFormSheet } from '../ui/formSheet.js';
import { confirmDialog } from '../ui/confirm.js';
import { fillAccountSelect, fillCategorySelect, parseTags, refreshTagSuggest, refreshNoteSuggest, NEW_CATEGORY_VALUE } from '../ui/pickers.js';
import { emptyFilter, isFilterEmpty, presetRange, applyFilter, summarize } from '../features/filters.js';
import { uuid } from '../utils/id.js';
import { mountReceiptPicker, saveReceipt } from '../ui/receipt.js';

let ctx = null;
let list = null;
let amountCtl = null;
let receiptPicker = null;
let filter = { ...emptyFilter(), ...presetRange('thisMonth') };
let activePreset = 'thisMonth';
let lastFiltered = [];
const els = {};

export function initTx(c) {
  ctx = c;
  for (const id of ['addForm', 'amount', 'amountHint', 'qCategory', 'qToAccount', 'qCatGroup', 'qToGroup', 'qAccount', 'txDate', 'note', 'qTags', 'formError', 'recentCats',
    'fSearch', 'fToggle', 'fClear', 'fAdvanced', 'fFrom', 'fTo', 'fType', 'fAccount', 'fCategory', 'fTag', 'fMin', 'fMax', 'fSaved', 'fSave', 'fDelete', 'fSummary',
    'listViewport', 'listCanvas', 'emptyState', 'exportCSV']) els[id] = $('#' + id);
  amountCtl = bindAmountInput(els.amount, els.amountHint);
  receiptPicker = mountReceiptPicker($('#qReceipt'));
  els.txDate.value = toLocalYMD();

  list = createVirtualList(els.listViewport, els.listCanvas, { onEdit: ctx.editFlow, onDelete: ctx.deleteFlow, ctx: { getCategory: S.getCategoryById, getAccount: S.getAccountById, version: () => ctx.version() } });
  bindListGestures(els.listViewport, { onEdit: ctx.editFlow, onDelete: ctx.deleteFlow });

  // form
  els.addForm.addEventListener('submit', addFlow);
  $('#resetForm').addEventListener('click', resetForm);
  $$('input[name="qType"]', els.addForm).forEach((r) => r.addEventListener('change', () => { refreshFormPickers(); els.amount.focus(); }));
  els.qAccount.addEventListener('change', () => { if (curType() === 'transfer') fillAccountSelect(els.qToAccount, { value: els.qToAccount.value, exclude: els.qAccount.value }); });
  els.qCategory.addEventListener('change', async () => {
    if (els.qCategory.value === NEW_CATEGORY_VALUE) {
      const created = await ctx.openCategoryForm(null, { kind: curType() === 'income' ? 'income' : 'expense' });
      fillCategorySelect(els.qCategory, { type: curType(), value: created ? created.id : S.getSettings().lastCategoryId || '', allowNew: true });
    }
    refreshNoteSuggest(els.qCategory.value);
  });
  // filter
  els.fSearch.addEventListener('input', debounce(() => { filter.q = els.fSearch.value; renderList(); }, 150));
  $$('[data-preset]', els.addForm.closest('section')).forEach((b) => b.addEventListener('click', () => { setPreset(b.dataset.preset); }));
  els.fToggle.addEventListener('click', () => { const open = els.fAdvanced.hidden; els.fAdvanced.hidden = !open; els.fToggle.setAttribute('aria-expanded', String(open)); els.fToggle.textContent = t(open ? 'filter.less' : 'filter.more'); });
  els.fClear.addEventListener('click', () => { setPreset('thisMonth', true); });
  for (const id of ['fFrom', 'fTo', 'fType', 'fAccount', 'fCategory', 'fTag', 'fMin', 'fMax']) els[id].addEventListener('change', readAdvanced);
  els.fTag.addEventListener('input', debounce(readAdvanced, 200));
  els.fSaved.addEventListener('change', () => applySavedFilter(els.fSaved.value));
  els.fSave.addEventListener('click', saveFilterFlow);
  els.fDelete.addEventListener('click', deleteSavedFilter);
  els.exportCSV.addEventListener('click', () => ctx.exportCSV(lastFiltered, 'loc'));
  els.note.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addFlow(); } });
  els.qTags.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addFlow(); } });
}

function debounce(fn, ms) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }
function curType() { return ($$('input[name="qType"]', els.addForm).find((r) => r.checked) || {}).value || 'expense'; }
export function setQuickType(type) { $$('input[name="qType"]', els.addForm).forEach((r) => { r.checked = r.value === type; }); refreshFormPickers(); }
export function focusAmount() { els.amount.focus(); els.amount.scrollIntoView({ block: 'center', behavior: 'smooth' }); }

function refreshFormPickers() {
  const type = curType();
  const s = S.getSettings();
  fillAccountSelect(els.qAccount, { value: els.qAccount.value || s.lastAccountId || s.defaultAccountId });
  if (type === 'transfer') {
    els.qCatGroup.hidden = true; els.qToGroup.hidden = false; els.recentCats.hidden = true;
    fillAccountSelect(els.qToAccount, { value: els.qToAccount.value, exclude: els.qAccount.value });
  } else {
    els.qCatGroup.hidden = false; els.qToGroup.hidden = true; els.recentCats.hidden = false;
    const keep = els.qCategory.value && els.qCategory.value !== NEW_CATEGORY_VALUE ? els.qCategory.value : '';
    fillCategorySelect(els.qCategory, { type, value: keep, allowNew: true });
    if (!els.qCategory.value || els.qCategory.value === NEW_CATEGORY_VALUE) els.qCategory.selectedIndex = 0;
  }
  refreshNoteSuggest(type === 'transfer' ? null : els.qCategory.value);
  refreshTagSuggest();
  renderRecentCats();
}

function renderRecentCats() {
  clear(els.recentCats);
  const type = curType();
  if (type === 'transfer') return;
  const ids = S.getCategoryStats();
  let n = 0;
  for (const id of ids) {
    const c = S.getCategoryById(id);
    if (!c || c.archived) continue;
    if (!(c.kind === 'both' || c.kind === (type === 'income' ? 'income' : 'expense'))) continue;
    els.recentCats.appendChild(el('button', { className: 'chip' + (els.qCategory.value === id ? ' active' : ''), type: 'button', text: `${c.icon} ${c.name}`, on: { click: () => { els.qCategory.value = id; refreshNoteSuggest(id); renderRecentCats(); els.amount.focus(); } } }));
    if (++n >= 8) break;
  }
}

async function addFlow(e) {
  e && e.preventDefault();
  els.formError.textContent = '';
  const amount = amountCtl.getValue();
  const type = curType();
  const date = els.txDate.value;
  const accountId = els.qAccount.value;
  const fail = (msg, focusEl) => { els.formError.textContent = msg; if (focusEl) { focusEl.setAttribute('aria-invalid', 'true'); focusEl.focus(); } return false; };
  if (!amount || amount <= 0) return fail(t('tx.errAmount'), els.amount);
  if (!accountId) return fail(t('tx.errAccount'), els.qAccount);
  if (!isValidYMD(date)) return fail(t('tx.errDate'), els.txDate);
  const input = { type, amount, date, accountId, note: els.note.value.trim(), tags: parseTags(els.qTags.value), source: 'manual' };
  if (type === 'transfer') {
    if (!els.qToAccount.value || els.qToAccount.value === accountId) return fail(t('tx.errToAccount'), els.qToAccount);
    input.toAccountId = els.qToAccount.value;
  } else {
    if (!els.qCategory.value || els.qCategory.value === NEW_CATEGORY_VALUE) return fail(t('tx.errCategory'), els.qCategory);
    input.categoryId = els.qCategory.value;
  }
  const rs = receiptPicker ? receiptPicker.getState() : { blob: null };
  input.id = uuid();
  if (rs.blob) { input.receiptId = input.id; await saveReceipt(input.id, rs.blob); }
  await S.addTransaction(input);
  await S.updateSettings({ lastCategoryId: input.categoryId || S.getSettings().lastCategoryId, lastAccountId: accountId }, { silent: true });
  amountCtl.clear(); els.note.value = ''; els.qTags.value = '';
  if (receiptPicker) receiptPicker.reset();
  $$('[aria-invalid]', els.addForm).forEach((n) => n.removeAttribute('aria-invalid'));
  // đảm bảo giao dịch mới nằm trong bộ lọc đang xem
  if ((filter.from && date < filter.from) || (filter.to && date > filter.to)) setPreset('all', true); else ctx.refresh('data');
  const kind = t(type === 'income' ? 'tx.kindIncome' : type === 'expense' ? 'tx.kindExpense' : 'tx.kindTransfer');
  showToast(t('tx.added', { kind, amount: formatVND(amount) }));
  els.amount.focus();
}
function resetForm() {
  amountCtl.clear(); els.note.value = ''; els.qTags.value = ''; els.formError.textContent = ''; els.txDate.value = toLocalYMD();
  if (receiptPicker) receiptPicker.reset();
  $$('[aria-invalid]', els.addForm).forEach((n) => n.removeAttribute('aria-invalid'));
  els.amount.focus();
}

// ---------- Lọc ----------
function setPreset(name, resetOthers = false) {
  activePreset = name;
  const r = presetRange(name);
  if (resetOthers) { filter = { ...emptyFilter(), ...r }; els.fSearch.value = ''; writeAdvanced(); }
  else { filter.from = r.from; filter.to = r.to; els.fFrom.value = r.from; els.fTo.value = r.to; }
  els.fSaved.value = '';
  renderList();
}
function readAdvanced() {
  filter.from = els.fFrom.value; filter.to = els.fTo.value; filter.type = els.fType.value; filter.accountId = els.fAccount.value; filter.categoryId = els.fCategory.value; filter.tag = els.fTag.value.trim();
  const mn = parseAmount(els.fMin.value), mx = parseAmount(els.fMax.value);
  filter.min = mn.value; filter.max = mx.value;
  activePreset = null;
  renderList();
}
function writeAdvanced() {
  els.fFrom.value = filter.from || ''; els.fTo.value = filter.to || ''; els.fType.value = filter.type || 'all';
  fillAccountSelect(els.fAccount, { value: filter.accountId || '', allowAll: true, includeArchived: true });
  fillCategorySelect(els.fCategory, { type: 'all', value: filter.categoryId || '', allowAll: true, includeArchived: true });
  els.fTag.value = filter.tag || '';
  els.fMin.value = filter.min ? formatVND(filter.min, { withUnit: false }) : '';
  els.fMax.value = filter.max ? formatVND(filter.max, { withUnit: false }) : '';
  els.fSearch.value = filter.q || '';
}
function renderSavedFilters() {
  const s = S.getSettings();
  const cur = els.fSaved.value;
  clear(els.fSaved);
  els.fSaved.appendChild(el('option', { value: '', text: t('filter.savedNone') }));
  for (const f of s.savedFilters || []) els.fSaved.appendChild(el('option', { value: f.id, text: f.name }));
  if (cur && Array.from(els.fSaved.options).some((o) => o.value === cur)) els.fSaved.value = cur;
}
function applySavedFilter(id) {
  const f = (S.getSettings().savedFilters || []).find((x) => x.id === id);
  if (!f) return;
  filter = { ...emptyFilter(), ...f.filter };
  activePreset = null;
  writeAdvanced();
  if (els.fAdvanced.hidden) els.fToggle.click();
  renderList();
}
async function saveFilterFlow() {
  openFormSheet({
    title: t('filter.saveTitle'),
    fields: [{ key: 'name', label: t('filter.saveName'), type: 'text', autofocus: true }],
    onSave: async (v) => {
      const name = v.name.trim();
      if (!name) throw new Error(t('filter.saveName'));
      const list = (S.getSettings().savedFilters || []).slice();
      const f = { id: uuid(), name, filter: { ...filter } };
      list.push(f);
      await S.updateSettings({ savedFilters: list }, { silent: true });
      renderSavedFilters();
      els.fSaved.value = f.id;
      showToast(t('filter.savedOk', { name }));
    },
  });
}
async function deleteSavedFilter() {
  const id = els.fSaved.value;
  if (!id) return;
  const list = (S.getSettings().savedFilters || []).filter((x) => x.id !== id);
  await S.updateSettings({ savedFilters: list }, { silent: true });
  renderSavedFilters();
  showToast(t('filter.deletedOk'));
}

export function renderTx(params = {}) {
  if (params.account) { filter = { ...emptyFilter(), accountId: params.account }; activePreset = null; if (els.fAdvanced.hidden) els.fToggle.click(); }
  if (params.category) { filter = { ...emptyFilter(), categoryId: params.category, ...presetRange('thisMonth') }; activePreset = null; if (els.fAdvanced.hidden) els.fToggle.click(); }
  if (params.type) setQuickType(params.type); else refreshFormPickers();
  writeAdvanced();
  renderSavedFilters();
  renderList();
  if (params.focus === 'amount') setTimeout(focusAmount, 30);
}

function renderList() {
  $$('[data-preset]').forEach((b) => b.classList.toggle('active', b.dataset.preset === activePreset));
  const ctxF = { gen: ctx.version ? ctx.version() : 0, categoryIds: filter.categoryId ? S.getCategoryDescendants(filter.categoryId) : null, accountsById: new Map(S.getAccounts({ includeArchived: true }).map((a) => [a.id, a])), categoriesById: new Map(S.getCategories({ includeArchived: true }).map((c) => [c.id, c])) };
  lastFiltered = applyFilter(S.getVisible(), filter, ctxF);
  list.setItems(lastFiltered);
  const isDefault = JSON.stringify({ ...filter, min: filter.min ?? null, max: filter.max ?? null }) === JSON.stringify({ ...emptyFilter(), ...presetRange('thisMonth') });
  els.fClear.hidden = isDefault;
  els.emptyState.style.display = lastFiltered.length ? 'none' : 'flex';
  els.emptyState.textContent = S.getVisible().length ? t('tx.emptyFilter') : t('tx.emptyAll');
  const sm = summarize(lastFiltered);
  els.fSummary.textContent = t('filter.summary', { count: sm.count, income: formatVND(sm.income), expense: formatVND(sm.expense), net: formatVND(sm.net) }) + (sm.transfer ? t('filter.summaryTransfer', { transfer: formatVND(sm.transfer) }) : '');
  els.listCanvas.setAttribute('aria-label', `${t('tx.list')} (${lastFiltered.length})`);
}

export function getFiltered() { return lastFiltered; }
export { confirmDialog };
