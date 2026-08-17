// Tab Ngân sách — P1a: xem trước chi tiêu theo danh mục tháng này (P1b sẽ thay bằng ngân sách đầy đủ).
import * as S from '../state.js';
import { $, el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { toLocalYM } from '../utils/date.js';

export function renderBudget() {
  const holder = $('#budgetCatBars');
  const empty = $('#budgetEmpty');
  clear(holder);
  const m = S.getMonth(toLocalYM());
  const map = new Map();
  for (const tx of m.items) {
    if (tx.type !== 'expense') continue;
    const c = S.getCategoryById(tx.categoryId);
    const root = c && c.parentId ? S.getCategoryById(c.parentId) || c : c;
    const key = root ? root.id : '?';
    const cur = map.get(key) || { name: root ? `${root.icon} ${root.name}` : (tx.category || '?'), color: root ? root.color : '#999', value: 0 };
    cur.value += tx.amount;
    map.set(key, cur);
  }
  const rows = Array.from(map.values()).sort((a, b) => b.value - a.value);
  empty.style.display = rows.length ? 'none' : 'flex';
  const max = rows.length ? rows[0].value : 1;
  const total = rows.reduce((a, b) => a + b.value, 0);
  for (const r of rows) {
    holder.appendChild(el('div', { className: 'bar-row' }, [
      el('div', { className: 'bar-label', text: r.name }),
      el('div', { className: 'bar-val', text: `${formatVND(r.value)} · ${Math.round(r.value / total * 100)}%` }),
      el('div', { className: 'bar-track' }, [el('div', { className: 'bar-fill', style: { width: `${Math.max(2, r.value / max * 100)}%`, background: r.color } })]),
    ]));
  }
}
