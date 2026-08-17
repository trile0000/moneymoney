// Danh mục 2 cấp (cha/con) — helpers thuần túy.
import { uuid } from '../utils/id.js';

// Danh mục mặc định cho người dùng Việt Nam. group: nhóm 50/30/20 (need/want/save) — dùng ở P1b.
export const DEFAULT_CATEGORIES = [
  { name: 'Ăn uống', icon: '🍜', color: '#ef6c00', kind: 'expense', group: 'need' },
  { name: 'Đi lại', icon: '🛵', color: '#1565c0', kind: 'expense', group: 'need' },
  { name: 'Hóa đơn', icon: '🧾', color: '#6d4c41', kind: 'expense', group: 'need' },
  { name: 'Nhà cửa', icon: '🏠', color: '#00897b', kind: 'expense', group: 'need' },
  { name: 'Sức khỏe', icon: '💊', color: '#c2185b', kind: 'expense', group: 'need' },
  { name: 'Giáo dục', icon: '📚', color: '#6a1b9a', kind: 'expense', group: 'need' },
  { name: 'Gia đình', icon: '👨‍👩‍👧', color: '#8e24aa', kind: 'expense', group: 'need' },
  { name: 'Mua sắm', icon: '🛍️', color: '#e91e63', kind: 'expense', group: 'want' },
  { name: 'Giải trí', icon: '🎮', color: '#7b1fa2', kind: 'expense', group: 'want' },
  { name: 'Tiết kiệm', icon: '🐷', color: '#2e7d32', kind: 'expense', group: 'save' },
  { name: 'Đầu tư', icon: '📈', color: '#1b5e20', kind: 'expense', group: 'save' },
  { name: 'Lương', icon: '💼', color: '#2e7d32', kind: 'income', group: null },
  { name: 'Thưởng', icon: '🎁', color: '#43a047', kind: 'income', group: null },
  { name: 'Khác', icon: '📦', color: '#607d8b', kind: 'both', group: null },
];

export function normName(s) { return String(s || '').trim().toLowerCase(); }

export function makeCategory(partial = {}) {
  return {
    id: partial.id || uuid(),
    name: String(partial.name || '').trim() || 'Khác',
    parentId: partial.parentId || null,
    kind: ['expense', 'income', 'both'].includes(partial.kind) ? partial.kind : 'expense',
    icon: partial.icon || '📦',
    color: partial.color || '#607d8b',
    group: ['need', 'want', 'save'].includes(partial.group) ? partial.group : null,
    archived: !!partial.archived,
    createdAt: partial.createdAt || Date.now(),
  };
}

export function defaultCategoryList() {
  return DEFAULT_CATEGORIES.map((c) => makeCategory(c));
}

/** Tìm danh mục theo tên (không phân biệt hoa thường), ưu tiên cấp 1 */
export function findByName(categories, name, { parentId } = {}) {
  const n = normName(name);
  if (!n) return null;
  const list = categories.filter((c) => normName(c.name) === n && (parentId === undefined || (c.parentId || null) === (parentId || null)));
  return list.find((c) => !c.parentId) || list[0] || null;
}

/** Tạo danh mục nếu chưa có; trả về { category, created } */
export function findOrCreate(categories, name, { kind = 'expense', parentId = null } = {}) {
  const found = findByName(categories, name, { parentId });
  if (found) return { category: found, created: false };
  const def = DEFAULT_CATEGORIES.find((d) => normName(d.name) === normName(name));
  const category = makeCategory({ ...(def || {}), name: String(name).trim(), parentId, kind: def ? def.kind : kind });
  return { category, created: true };
}

/** Map id → category */
export function byId(categories) { return new Map(categories.map((c) => [c.id, c])); }

/** Cây: [{...parent, children: [...]}] sắp theo tên; danh mục con mồ côi được coi là cấp 1 */
export function buildTree(categories, { includeArchived = false } = {}) {
  const ids = new Set(categories.map((c) => c.id));
  const roots = [];
  const childrenOf = new Map();
  for (const c of categories) {
    if (!includeArchived && c.archived) continue;
    const pid = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    if (pid) { if (!childrenOf.has(pid)) childrenOf.set(pid, []); childrenOf.get(pid).push(c); }
    else roots.push(c);
  }
  const sortFn = (a, b) => a.name.localeCompare(b.name, 'vi');
  roots.sort(sortFn);
  return roots.map((r) => ({ ...r, children: (childrenOf.get(r.id) || []).sort(sortFn) }));
}

/** Tên đầy đủ "Cha › Con" */
export function pathName(categories, id) {
  const m = byId(categories);
  const c = m.get(id);
  if (!c) return '';
  const p = c.parentId ? m.get(c.parentId) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
}

/** Tập id gồm chính nó và mọi con (dùng khi lọc theo danh mục cha) */
export function descendantIds(categories, id) {
  const out = new Set([id]);
  for (const c of categories) if (c.parentId === id) out.add(c.id);
  return out;
}

/** Nhóm 50/30/20 hiệu lực (con kế thừa cha nếu không tự đặt) */
export function effectiveGroup(categories, id) {
  const m = byId(categories);
  const c = m.get(id);
  if (!c) return null;
  if (c.group) return c.group;
  const p = c.parentId ? m.get(c.parentId) : null;
  return p ? p.group || null : null;
}

/**
 * Gộp danh mục `fromId` vào `intoId`: trả về { transactions (đã đổi categoryId/category), categories (đã bỏ from, con của from chuyển sang into) }
 * Thuần túy — không mutate input.
 */
export function mergeCategory(categories, transactions, fromId, intoId) {
  if (fromId === intoId) return { categories, transactions, moved: 0 };
  const m = byId(categories);
  const into = m.get(intoId);
  if (!into) return { categories, transactions, moved: 0 };
  let moved = 0;
  const tx = transactions.map((t) => {
    if (t.categoryId !== fromId) return t;
    moved++;
    return { ...t, categoryId: intoId, category: into.name, updatedAt: Date.now() };
  });
  const cats = categories
    .filter((c) => c.id !== fromId)
    .map((c) => (c.parentId === fromId ? { ...c, parentId: into.parentId ? into.parentId : intoId } : c));
  return { categories: cats, transactions: tx, moved };
}

/** Danh mục hợp lệ cho loại giao dịch */
export function forType(categories, type) {
  if (type === 'transfer') return [];
  return categories.filter((c) => !c.archived && (c.kind === 'both' || c.kind === (type === 'income' ? 'income' : 'expense')));
}
