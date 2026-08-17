// Điền các <select>/<datalist> dùng chung: ví, danh mục (2 cấp, optgroup), tag, ghi chú.
import * as S from '../state.js';
import { el, clear } from '../utils/dom.js';
import { t } from '../i18n.js';
import { forType } from '../features/categories.js';
import { ACCOUNT_ICONS } from '../features/accounts.js';

export const NEW_CATEGORY_VALUE = '__new__';

/** Điền select ví. opts: { value, allowAll, exclude, includeArchived, allowNew } */
export function fillAccountSelect(sel, { value = '', allowAll = false, exclude = null, includeArchived = false } = {}) {
  const prev = value || sel.value;
  clear(sel);
  if (allowAll) sel.appendChild(el('option', { value: '', text: t('filter.allAccounts') }));
  for (const a of S.getAccounts({ includeArchived })) {
    if (a.id === exclude) continue;
    sel.appendChild(el('option', { value: a.id, text: `${a.icon || ACCOUNT_ICONS[a.type] || '💳'} ${a.name}${a.archived ? ' (' + t('acc.archivedBadge') + ')' : ''}` }));
  }
  if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
  else if (!allowAll) { const d = S.getSettings().defaultAccountId; if (d && Array.from(sel.options).some((o) => o.value === d)) sel.value = d; }
}

/**
 * Điền select danh mục theo loại giao dịch với optgroup cha → con.
 * opts: { type: 'expense'|'income'|'all', value, allowAll, allowNew, excludeId }
 */
export function fillCategorySelect(sel, { type = 'expense', value = '', allowAll = false, allowNew = false, excludeId = null, includeArchived = false } = {}) {
  const prev = value || sel.value;
  clear(sel);
  if (allowAll) sel.appendChild(el('option', { value: '', text: t('filter.allCategories') }));
  const all = S.getCategories({ includeArchived });
  const allowed = type === 'all' ? all : forType(all, type);
  const allowedIds = new Set(allowed.map((c) => c.id));
  const tree = S.getCategoryTree({ includeArchived });
  for (const root of tree) {
    if (root.id === excludeId) continue;
    const kids = root.children.filter((c) => allowedIds.has(c.id) && c.id !== excludeId);
    const rootOk = allowedIds.has(root.id);
    if (!rootOk && !kids.length) continue;
    if (kids.length) {
      const g = el('optgroup', { attrs: { label: `${root.icon} ${root.name}` } });
      if (rootOk) g.appendChild(el('option', { value: root.id, text: `${root.icon} ${root.name}` }));
      for (const c of kids) g.appendChild(el('option', { value: c.id, text: `　└ ${c.icon} ${c.name}` }));
      sel.appendChild(g);
    } else {
      sel.appendChild(el('option', { value: root.id, text: `${root.icon} ${root.name}` }));
    }
  }
  if (allowNew) sel.appendChild(el('option', { value: NEW_CATEGORY_VALUE, text: t('tx.newCategory') }));
  if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
  else if (!allowAll) {
    const last = S.getSettings().lastCategoryId;
    if (last && Array.from(sel.options).some((o) => o.value === last)) sel.value = last;
    else if (sel.options.length) sel.selectedIndex = 0;
  }
}

/** Danh sách cha để chọn khi tạo/sửa danh mục (chỉ cấp 1, loại trừ chính nó) */
export function fillParentSelect(sel, { value = '', excludeId = null } = {}) {
  clear(sel);
  sel.appendChild(el('option', { value: '', text: t('cat.noParent') }));
  for (const root of S.getCategoryTree({ includeArchived: true })) {
    if (root.id === excludeId) continue;
    sel.appendChild(el('option', { value: root.id, text: `${root.icon} ${root.name}` }));
  }
  if (value && Array.from(sel.options).some((o) => o.value === value)) sel.value = value;
}

export function refreshTagSuggest() {
  const dl = document.getElementById('tagSuggest');
  if (!dl) return;
  clear(dl);
  for (const tag of S.getTagStats().slice(0, 30)) dl.appendChild(el('option', { value: tag }));
}
export function refreshNoteSuggest(categoryId = null) {
  const dl = document.getElementById('noteSuggest');
  if (!dl) return;
  clear(dl);
  const list = S.getNoteSuggestions(categoryId, 8);
  const more = categoryId ? S.getNoteSuggestions(null, 8).filter((n) => !list.includes(n)) : [];
  for (const n of [...list, ...more].slice(0, 12)) dl.appendChild(el('option', { value: n }));
}

/** 'du-lich, cong ty' → ['du-lich','cong ty']; không có dấu phẩy thì tách theo khoảng trắng: 'a b' → ['a','b'] */
export function parseTags(str) {
  const s = String(str || '').trim();
  if (!s) return [];
  const parts = /[,;\n]/.test(s) ? s.split(/[,;\n]+/) : s.split(/\s+/);
  return Array.from(new Set(parts.map((x) => x.trim().replace(/^#/, '')).filter(Boolean))).slice(0, 20);
}
export function tagsToString(tags) { return (tags || []).join(', '); }
