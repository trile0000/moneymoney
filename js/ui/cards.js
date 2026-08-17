// Sắp xếp thẻ trang chủ: lưu settings.cardOrder; kéo-thả (desktop, HTML5 DnD) + nút ▲▼ (mọi thiết bị, a11y).
import { el, $$ } from '../utils/dom.js';
import { t } from '../i18n.js';

export function applyCardOrder(grid, order) {
  if (!Array.isArray(order) || !order.length) return;
  const cards = new Map($$('[data-card]', grid).map((c) => [c.dataset.card, c]));
  for (const key of order) { const c = cards.get(key); if (c) grid.appendChild(c); }
}
export function currentOrder(grid) { return $$('[data-card]', grid).map((c) => c.dataset.card); }

/**
 * Bật/tắt chế độ sắp xếp. onChange(order) được gọi mỗi khi đổi thứ tự.
 */
export function setReorderMode(grid, on, onChange) {
  grid.classList.toggle('reorder', on);
  $$('[data-card]', grid).forEach((card) => {
    card.querySelector('.card-reorder')?.remove();
    card.draggable = on;
    if (!on) return;
    const bar = el('div', { className: 'card-reorder' }, [
      el('span', { className: 'drag-handle', text: '⋮⋮', attrs: { 'aria-hidden': 'true' } }),
      el('button', { className: 'btn ghost small', type: 'button', text: '▲', attrs: { 'aria-label': t('home.moveUp') }, on: { click: () => { const p = card.previousElementSibling; if (p && p.dataset.card) { grid.insertBefore(card, p); onChange(currentOrder(grid)); card.querySelector('.card-reorder button').focus(); } } } }),
      el('button', { className: 'btn ghost small', type: 'button', text: '▼', attrs: { 'aria-label': t('home.moveDown') }, on: { click: () => { const n = card.nextElementSibling; if (n && n.dataset.card) { grid.insertBefore(n, card); onChange(currentOrder(grid)); card.querySelectorAll('.card-reorder button')[1].focus(); } } } }),
    ]);
    card.insertBefore(bar, card.firstChild);
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragover', onDragOver);
    card.addEventListener('drop', onDrop);
    card.addEventListener('dragend', onDragEnd);
  });
  let dragging = null;
  function onDragStart(e) { dragging = e.currentTarget; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragging.dataset.card); } catch { /* ignore */ } dragging.classList.add('dragging'); }
  function onDragOver(e) { if (!dragging || e.currentTarget === dragging) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDrop(e) {
    e.preventDefault();
    const target = e.currentTarget;
    if (!dragging || target === dragging) return;
    const cards = $$('[data-card]', grid);
    const from = cards.indexOf(dragging), to = cards.indexOf(target);
    if (from < to) grid.insertBefore(dragging, target.nextSibling); else grid.insertBefore(dragging, target);
    onChange(currentOrder(grid));
  }
  function onDragEnd() { if (dragging) dragging.classList.remove('dragging'); dragging = null; }
}
