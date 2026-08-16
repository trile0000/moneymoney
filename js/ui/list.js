// Danh sách giao dịch ảo hóa (sửa lỗi #19): chỉ render các dòng trong khung nhìn.
// Mọi text đi qua textContent (sửa lỗi #12).
import { el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { dateLabel } from '../utils/date.js';

const OVERSCAN = 6;

export function createVirtualList(viewport, canvas, { onEdit, onDelete }) {
  let items = [];
  let rowH = 64;
  let pool = new Map(); // id -> row element
  let raf = 0;
  let lastRange = [-1, -1];

  function readRowH() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim();
    const n = parseInt(v, 10);
    if (n > 0) rowH = n + 6; // + gap
  }
  readRowH();
  window.addEventListener('resize', () => { readRowH(); schedule(true); });

  function buildRow(t) {
    const left = el('div', { className: 'tx-left' }, [
      el('div', { className: 'date', text: dateLabel(t.date) }),
      el('div', { className: 'cat' }, [
        document.createTextNode(t.category || 'Khác'),
        t.source === 'auto-salary' ? el('span', { className: 'badge', text: 'tự động', attrs: { title: 'Lương tự động' } }) : null,
      ]),
      t.note ? el('div', { className: 'note', text: t.note }) : null,
    ]);
    const amt = el('div', { className: 'amt ' + (t.type === 'income' ? 'in' : 'out'), text: (t.type === 'income' ? '+' : '−') + formatVND(t.amount) });
    const del = el('button', {
      className: 'btn danger-text tx-delete', type: 'button', text: '✕',
      attrs: { 'aria-label': `Xóa giao dịch ${t.category} ${formatVND(t.amount)} ngày ${dateLabel(t.date)}`, title: 'Xóa (có hoàn tác)' },
      on: { click: (e) => { e.stopPropagation(); onDelete(t.id); } },
    });
    const row = el('div', {
      className: 'tx', dataset: { id: t.id }, attrs: { role: 'listitem', tabindex: '0', 'aria-label': `${t.type === 'income' ? 'Thu' : 'Chi'} ${formatVND(t.amount)}, ${t.category}, ${dateLabel(t.date)}${t.note ? ', ' + t.note : ''}. Nhấn Enter để sửa, Delete để xóa.` },
      on: {
        click: () => onEdit(t.id),
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(t.id); }
          else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDelete(t.id); }
        },
      },
    }, [left, amt, del]);
    return row;
  }

  function render(force = false) {
    raf = 0;
    const total = items.length;
    canvas.style.height = `${total * rowH}px`;
    if (!total) { clear(canvas); pool.clear(); lastRange = [-1, -1]; return; }
    const scrollTop = viewport.scrollTop;
    const vh = viewport.clientHeight || 400;
    const start = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
    const end = Math.min(total, Math.ceil((scrollTop + vh) / rowH) + OVERSCAN);
    if (!force && start === lastRange[0] && end === lastRange[1]) return;
    lastRange = [start, end];

    const keep = new Set();
    const ordered = [];
    for (let i = start; i < end; i++) {
      const t = items[i];
      keep.add(t.id);
      let row = pool.get(t.id);
      if (!row || row._sig !== sig(t)) {
        const fresh = buildRow(t);
        fresh._sig = sig(t);
        if (row) row.replaceWith(fresh);
        row = fresh;
        pool.set(t.id, row);
      }
      row.style.transform = `translateY(${i * rowH}px)`;
      row.dataset.index = String(i);
      ordered.push(row);
    }
    // gỡ những dòng ngoài khung
    for (const [id, row] of pool) {
      if (!keep.has(id)) { row.remove(); pool.delete(id); }
    }
    // Giữ THỨ TỰ DOM = thứ tự hiển thị (trình đọc màn hình / Tab đi đúng thứ tự); chỉ di chuyển node khi lệch
    for (let k = 0; k < ordered.length; k++) {
      const row = ordered[k];
      const cur = canvas.children[k];
      if (cur !== row) canvas.insertBefore(row, cur || null);
    }
  }
  function sig(t) { return `${t.type}|${t.amount}|${t.category}|${t.note}|${t.date}|${t.source}|${t.updatedAt || 0}`; }

  function schedule(force) {
    if (force) { if (raf) cancelAnimationFrame(raf); raf = 0; render(true); return; }
    if (!raf) raf = requestAnimationFrame(() => render(false));
  }

  viewport.addEventListener('scroll', () => schedule(false), { passive: true });

  return {
    setItems(next) { items = next; schedule(true); },
    refresh() { schedule(true); },
    getRowById(id) { return pool.get(id); },
    get rowHeight() { return rowH; },
  };
}
