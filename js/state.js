// State trung tâm: nguồn sự thật trong bộ nhớ + chỉ mục theo tháng (memoized).
// Sửa lỗi #18/#20: dữ liệu chỉ ghi khi đổi; biểu đồ lấy từ chỉ mục, không load() lại.

import { saveData, saveSettings } from './storage.js';
import { normalizeTransaction } from './migrate.js';
import { uuid } from './utils/id.js';
import { ymOf } from './utils/date.js';

const state = {
  data: { schemaVersion: 2, transactions: [], meta: {}, savedAt: 0 },
  settings: null,
  // cache
  _index: null, // Map<ym, {income, expense, count, items: []}>
  _visible: null, // transactions chưa xóa mềm, đã sort
  _byId: null,
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify(change) { for (const fn of subs) { try { fn(change); } catch (e) { console.error(e); } } }

function invalidate() { state._index = null; state._visible = null; state._byId = null; }

export function init({ data, settings }) {
  state.data = data;
  state.settings = settings;
  invalidate();
}

export const getSettings = () => state.settings;
export const getMeta = () => state.data.meta;

export function sortTx(arr) {
  return arr.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
}

/** Giao dịch đang hiển thị (không tính đã xóa mềm), sort ngày giảm dần */
export function getVisible() {
  if (!state._visible) state._visible = sortTx(state.data.transactions.filter((t) => !t.deletedAt));
  return state._visible;
}
export function getAllRaw() { return state.data.transactions; }
export function getById(id) {
  if (!state._byId) state._byId = new Map(state.data.transactions.map((t) => [t.id, t]));
  return state._byId.get(id);
}

/** Chỉ mục theo tháng: Map<'YYYY-MM', {income, expense, count, items}> — chỉ tính lại khi dữ liệu đổi */
export function getMonthIndex() {
  if (state._index) return state._index;
  const idx = new Map();
  for (const t of getVisible()) {
    const k = ymOf(t.date);
    let m = idx.get(k);
    if (!m) { m = { income: 0, expense: 0, count: 0, items: [] }; idx.set(k, m); }
    if (t.type === 'income') m.income += t.amount; else m.expense += t.amount;
    m.count++;
    m.items.push(t);
  }
  state._index = idx;
  return idx;
}

export function getMonth(ym) {
  return getMonthIndex().get(ym) || { income: 0, expense: 0, count: 0, items: [] };
}

export function getMonthsSorted() {
  return Array.from(getMonthIndex().keys()).sort();
}

// ---------- Mutations ----------
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
  state.data.transactions.push(t);
  await persist({ type: 'add', tx: t });
  return t;
}

export async function updateTransaction(id, patch) {
  const i = state.data.transactions.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const old = state.data.transactions[i];
  const merged = normalizeTransaction({ ...old, ...patch, id: old.id, createdAt: old.createdAt, updatedAt: Date.now() }, { now: Date.now() });
  state.data.transactions[i] = merged;
  await persist({ type: 'update', tx: merged, old });
  return merged;
}

/** Xóa mềm: giữ lại để Undo (sửa lỗi #2) */
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
/** Xóa hẳn các giao dịch đã xóa mềm */
export async function purgeDeleted(ids = null) {
  const before = state.data.transactions.length;
  state.data.transactions = state.data.transactions.filter((t) => !t.deletedAt || (ids && !ids.includes(t.id)));
  if (state.data.transactions.length !== before) await persist({ type: 'purge' });
}

/** Thêm nhiều giao dịch (import / bù lương). Trả về số lượng thêm. */
export async function addMany(list, { source = 'import' } = {}) {
  const now = Date.now();
  const seen = new Set(state.data.transactions.map((t) => t.id));
  let n = 0;
  for (const raw of list) {
    const t = normalizeTransaction({ ...raw, createdAt: raw.createdAt || now }, { seenIds: seen, now, defaultSource: source });
    if (!t) continue;
    state.data.transactions.push(t);
    n++;
  }
  if (n) await persist({ type: 'addMany', count: n });
  return n;
}

export async function replaceAll(transactions, meta) {
  state.data.transactions = transactions.slice();
  if (meta) state.data.meta = { ...meta };
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

/** Danh sách danh mục đã dùng (để gợi ý), sắp theo tần suất */
export function getCategoryStats() {
  const m = new Map();
  for (const t of getVisible()) m.set(t.category, (m.get(t.category) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}
