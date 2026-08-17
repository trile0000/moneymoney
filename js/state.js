// State trung tâm (v3): nguồn sự thật trong bộ nhớ + chỉ mục memoized. Không đụng DOM.
import { saveData, saveSettings } from './storage.js';
import { normalizeTransaction, sortTx } from './migrate.js';
import { uuid } from './utils/id.js';
import { ymOf, toLocalYMD } from './utils/date.js';
import { makeAccount, computeBalances } from './features/accounts.js';
import { makeCategory, buildTree, byId as catById, mergeCategory as mergeCat, descendantIds } from './features/categories.js';
import { makeRule, runRecurring, nextOccurrence } from './features/recurring.js';

const state = {
  data: null,
  settings: null,
  _index: null, _visible: null, _byId: null, _balances: null, _catTree: null, _catMap: null, _accMap: null, _tagStats: null,
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify(change) { for (const fn of subs) { try { fn(change); } catch (e) { console.error(e); } } }
function invalidate() { state._index = state._visible = state._byId = state._balances = state._catTree = state._catMap = state._accMap = state._tagStats = null; }

export function init({ data, settings }) { state.data = data; state.settings = settings; invalidate(); }
export const getSettings = () => state.settings;
export const getMeta = () => state.data.meta;
export const getData = () => state.data;

// ---------- Giao dịch ----------
export function getVisible() {
  if (!state._visible) state._visible = sortTx(state.data.transactions.filter((t) => !t.deletedAt));
  return state._visible;
}
export function getAllRaw() { return state.data.transactions; }
export function getById(id) {
  if (!state._byId) state._byId = new Map(state.data.transactions.map((t) => [t.id, t]));
  return state._byId.get(id);
}
/** Chỉ mục theo tháng: income/expense KHÔNG tính chuyển khoản; items gồm cả chuyển khoản */
export function getMonthIndex() {
  if (state._index) return state._index;
  const idx = new Map();
  for (const t of getVisible()) {
    const k = ymOf(t.date);
    let m = idx.get(k);
    if (!m) { m = { income: 0, expense: 0, transfer: 0, count: 0, items: [] }; idx.set(k, m); }
    if (t.type === 'income') m.income += t.amount; else if (t.type === 'expense') m.expense += t.amount; else m.transfer += t.amount;
    m.count++;
    m.items.push(t);
  }
  state._index = idx;
  return idx;
}
export function getMonth(ym) { return getMonthIndex().get(ym) || { income: 0, expense: 0, transfer: 0, count: 0, items: [] }; }
export function getMonthsSorted() { return Array.from(getMonthIndex().keys()).sort(); }

async function persist(change) {
  invalidate();
  const r = await saveData(state.data);
  notify(change);
  return r;
}

export async function addTransaction(input) {
  const now = Date.now();
  const t = normalizeTransaction({ ...input, id: input.id || uuid(), createdAt: input.createdAt || now }, { now });
  if (!t) throw new Error('Giao dịch không hợp lệ');
  fillNames(t);
  state.data.transactions.push(t);
  await persist({ type: 'add', tx: t });
  return t;
}
export async function updateTransaction(id, patch) {
  const i = state.data.transactions.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const old = state.data.transactions[i];
  const merged = normalizeTransaction({ ...old, ...patch, id: old.id, createdAt: old.createdAt, updatedAt: Date.now() }, { now: Date.now() });
  if (merged.type !== 'transfer') delete merged.toAccountId;
  fillNames(merged);
  state.data.transactions[i] = merged;
  await persist({ type: 'update', tx: merged, old });
  return merged;
}
/** Đồng bộ tên danh mục hiển thị từ categoryId; xóa categoryId nếu là chuyển khoản */
function fillNames(t) {
  if (t.type === 'transfer') { delete t.categoryId; t.category = ''; return; }
  const c = t.categoryId ? getCategoryById(t.categoryId) : null;
  if (c) t.category = c.name;
}
export async function softDelete(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t || t.deletedAt) return null;
  t.deletedAt = Date.now();
  await persist({ type: 'delete', tx: t });
  return t;
}
export async function restore(id) {
  const t = state.data.transactions.find((x) => x.id === id);
  if (!t || !t.deletedAt) return null;
  delete t.deletedAt;
  await persist({ type: 'restore', tx: t });
  return t;
}
export async function purgeDeleted(ids = null) {
  const before = state.data.transactions.length;
  state.data.transactions = state.data.transactions.filter((t) => !t.deletedAt || (ids && !ids.includes(t.id)));
  if (state.data.transactions.length !== before) await persist({ type: 'purge' });
}
export async function addMany(list, { source = 'import' } = {}) {
  const now = Date.now();
  const seen = new Set(state.data.transactions.map((t) => t.id));
  let n = 0;
  for (const raw of list) {
    const t = normalizeTransaction({ ...raw, createdAt: raw.createdAt || now }, { seenIds: seen, now, defaultSource: source });
    if (!t) continue;
    if (!t.accountId || !getAccountById(t.accountId)) t.accountId = state.settings.defaultAccountId;
    if (t.type !== 'transfer' && (!t.categoryId || !getCategoryById(t.categoryId))) {
      const c = ensureCategoryByName(t.category, t.type === 'income' ? 'income' : 'expense');
      t.categoryId = c.id; t.category = c.name;
    } else fillNames(t);
    state.data.transactions.push(t);
    n++;
  }
  if (n) await persist({ type: 'addMany', count: n });
  return n;
}
/** Thay toàn bộ dữ liệu (khôi phục backup) */
export async function replaceData(data) {
  state.data = data;
  await persist({ type: 'replace' });
}
export async function clearAllTransactions() {
  state.data.transactions = [];
  await persist({ type: 'clear' });
}
export async function setMeta(patch) {
  state.data.meta = { ...state.data.meta, ...patch };
  await saveData(state.data);
}
export async function updateSettings(patch, { silent = false } = {}) {
  state.settings = { ...state.settings, ...patch };
  await saveSettings(state.settings);
  if (!silent) notify({ type: 'settings' });
  return state.settings;
}

// ---------- Ví ----------
export function getAccounts({ includeArchived = false } = {}) {
  return state.data.accounts.filter((a) => includeArchived || !a.archived);
}
export function getAccountById(id) {
  if (!state._accMap) state._accMap = new Map(state.data.accounts.map((a) => [a.id, a]));
  return state._accMap.get(id);
}
export function getBalances() {
  if (!state._balances) state._balances = computeBalances(state.data.accounts, state.data.transactions);
  return state._balances;
}
export async function addAccount(partial) {
  const a = makeAccount(partial);
  state.data.accounts.push(a);
  await persist({ type: 'accounts' });
  return a;
}
export async function updateAccount(id, patch) {
  const i = state.data.accounts.findIndex((a) => a.id === id);
  if (i < 0) return null;
  const a = makeAccount({ ...state.data.accounts[i], ...patch, id });
  state.data.accounts[i] = a;
  await persist({ type: 'accounts' });
  return a;
}
/** Xóa ví: nếu có giao dịch → chỉ lưu trữ (archived) trừ khi truyền moveTo để chuyển giao dịch sang ví khác */
export async function removeAccount(id, { moveTo = null } = {}) {
  const used = state.data.transactions.filter((t) => t.accountId === id || t.toAccountId === id);
  if (used.length && !moveTo) {
    return updateAccount(id, { archived: true });
  }
  if (used.length && moveTo) {
    for (const t of used) {
      if (t.accountId === id) t.accountId = moveTo;
      if (t.toAccountId === id) t.toAccountId = moveTo;
      if (t.type === 'transfer' && t.accountId === t.toAccountId) { t.type = 'expense'; delete t.toAccountId; if (!t.categoryId) { const c = ensureCategoryByName('Khác', 'expense'); t.categoryId = c.id; t.category = c.name; } }
    }
  }
  state.data.accounts = state.data.accounts.filter((a) => a.id !== id);
  if (state.settings.defaultAccountId === id) await updateSettings({ defaultAccountId: (getAccounts()[0] || {}).id || null }, { silent: true });
  await persist({ type: 'accounts' });
  return true;
}
export function countTxByAccount(id) { return state.data.transactions.filter((t) => !t.deletedAt && (t.accountId === id || t.toAccountId === id)).length; }

// ---------- Danh mục ----------
export function getCategories({ includeArchived = false } = {}) {
  return state.data.categories.filter((c) => includeArchived || !c.archived);
}
export function getCategoryById(id) {
  if (!state._catMap) state._catMap = catById(state.data.categories);
  return state._catMap.get(id);
}
export function getCategoryTree({ includeArchived = false } = {}) {
  if (includeArchived) return buildTree(state.data.categories, { includeArchived: true });
  if (!state._catTree) state._catTree = buildTree(state.data.categories);
  return state._catTree;
}
export function getCategoryDescendants(id) { return descendantIds(state.data.categories, id); }
export function countTxByCategory(id) { const set = descendantIds(state.data.categories, id); return state.data.transactions.filter((t) => !t.deletedAt && set.has(t.categoryId)).length; }
export function ensureCategoryByName(name, kind = 'expense') {
  const n = String(name || '').trim().toLowerCase() || 'khác';
  let c = state.data.categories.find((x) => x.name.trim().toLowerCase() === n && !x.parentId) || state.data.categories.find((x) => x.name.trim().toLowerCase() === n);
  if (!c) { c = makeCategory({ name: name || 'Khác', kind }); state.data.categories.push(c); invalidate(); }
  return c;
}
export async function addCategory(partial) {
  const c = makeCategory(partial);
  state.data.categories.push(c);
  await persist({ type: 'categories' });
  return c;
}
export async function updateCategory(id, patch) {
  const i = state.data.categories.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const c = makeCategory({ ...state.data.categories[i], ...patch, id });
  state.data.categories[i] = c;
  // đồng bộ tên hiển thị trên giao dịch
  for (const t of state.data.transactions) if (t.categoryId === id) t.category = c.name;
  await persist({ type: 'categories' });
  return c;
}
/** Gộp danh mục from → into (chuyển giao dịch, con của from sang into) */
export async function mergeCategories(fromId, intoId) {
  const r = mergeCat(state.data.categories, state.data.transactions, fromId, intoId);
  state.data.categories = r.categories;
  state.data.transactions = r.transactions;
  await persist({ type: 'categories' });
  return r.moved;
}
/** Xóa danh mục: nếu còn giao dịch → cần intoId để gộp; danh mục con → chuyển lên cấp 1 */
export async function removeCategory(id, { intoId = null } = {}) {
  const used = countTxByCategory(id);
  if (used && intoId) return mergeCategories(id, intoId);
  if (used && !intoId) return updateCategory(id, { archived: true });
  state.data.categories = state.data.categories.filter((c) => c.id !== id).map((c) => (c.parentId === id ? { ...c, parentId: null } : c));
  await persist({ type: 'categories' });
  return 0;
}

// ---------- Định kỳ ----------
export function getRules() { return state.data.recurring; }
export function getRuleById(id) { return state.data.recurring.find((r) => r.id === id); }
export async function addRule(partial) {
  const r = makeRule(partial);
  state.data.recurring.push(r);
  await persist({ type: 'recurring' });
  await syncLegacySalary(r);
  return r;
}
export async function updateRule(id, patch) {
  const i = state.data.recurring.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const r = makeRule({ ...state.data.recurring[i], ...patch, id, template: { ...state.data.recurring[i].template, ...(patch.template || {}) } });
  state.data.recurring[i] = r;
  await persist({ type: 'recurring' });
  await syncLegacySalary(r);
  return r;
}
export async function removeRule(id) {
  const r = getRuleById(id);
  state.data.recurring = state.data.recurring.filter((x) => x.id !== id);
  await persist({ type: 'recurring' });
  if (r && r.legacySalary) await updateSettings({ salary: 0 }, { silent: true });
  return true;
}
/** Giữ settings.salary khớp với rule lương cũ (tương thích ngược) */
async function syncLegacySalary(r) {
  if (!r.legacySalary) return;
  const patch = { salary: r.enabled ? r.template.amount : 0, salaryCategory: r.template.category || state.settings.salaryCategory };
  if (patch.salary !== state.settings.salary || patch.salaryCategory !== state.settings.salaryCategory) await updateSettings(patch, { silent: true });
}
export function ruleNext(rule, afterYMD = toLocalYMD()) { return nextOccurrence(rule, afterYMD); }
/** Bỏ qua kỳ kế tiếp của rule */
export async function skipNext(id) {
  const r = getRuleById(id);
  if (!r) return null;
  const next = nextOccurrence(r, toLocalYMD());
  if (!next) return null;
  return updateRule(id, { skippedDates: [...r.skippedDates, next] });
}
/** Chạy engine định kỳ: sinh giao dịch đến hạn. Trả về danh sách đã thêm. */
export async function runRecurringNow(todayYMD = toLocalYMD()) {
  const { toAdd, ruleUpdates } = runRecurring(state.data.recurring, state.data.transactions, todayYMD);
  let changed = false;
  for (const [id, lastDate] of ruleUpdates) { const r = getRuleById(id); if (r) { r.lastDate = lastDate; changed = true; } }
  if (toAdd.length) {
    const seen = new Set(state.data.transactions.map((t) => t.id));
    for (const raw of toAdd) {
      const t = normalizeTransaction({ ...raw, id: uuid() }, { seenIds: seen, defaultSource: 'recurring' });
      if (!t) continue;
      if (!t.accountId || !getAccountById(t.accountId)) t.accountId = state.settings.defaultAccountId;
      fillNames(t);
      state.data.transactions.push(t);
    }
    changed = true;
  }
  if (changed) await persist({ type: 'recurring-run', count: toAdd.length });
  return toAdd;
}

// ---------- Gợi ý ----------
export function getCategoryStats() {
  const m = new Map();
  for (const t of getVisible()) if (t.categoryId) m.set(t.categoryId, (m.get(t.categoryId) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
export function getTagStats() {
  if (state._tagStats) return state._tagStats;
  const m = new Map();
  for (const t of getVisible()) for (const tag of t.tags || []) m.set(tag, (m.get(tag) || 0) + 1);
  state._tagStats = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return state._tagStats;
}
export function getNoteSuggestions(categoryId = null, limit = 8) {
  const m = new Map();
  for (const t of getVisible()) {
    if (!t.note) continue;
    if (categoryId && t.categoryId !== categoryId) continue;
    m.set(t.note, (m.get(t.note) || 0) + 1);
    if (m.size > 200) break;
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k);
}
export function getRecent(limit = 5) { return getVisible().slice(0, limit); }
