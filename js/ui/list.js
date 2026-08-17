// Danh sách giao dịch ảo hóa (sửa lỗi #19): chỉ render các dòng trong khung nhìn.
// Mọi text đi qua textContent (sửa lỗi #12).
import { el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { dateLabel } from '../utils/date.js';
import { t as tr } from '../i18n.js';

const OVERSCAN = 6;

export function createVirtualList(viewport, canvas, { onEdit, onDelete, ctx = {} }) {
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
    const cat = t.type !== 'transfer' && ctx.getCategory ? ctx.getCategory(t.categoryId) : null;
    const parent = cat && cat.parentId && ctx.getCategory ? ctx.getCategory(cat.parentId) : null;
    const acc = ctx.getAccount ? ctx.getAccount(t.accountId) : null;
    const toAcc = t.type === 'transfer' && ctx.getAccount ? ctx.getAccount(t.toAccountId) : null;
    const isTransfer = t.type === 'transfer';
    const title = isTransfer
      ? tr('tx.transferRow', { from: acc ? acc.name : '?', to: toAcc ? toAcc.name : '?' })
      : (parent ? `${parent.name} › ${cat.name}` : (cat ? cat.name : (t.category || 'Khác')));
    const icon = isTransfer ? '⇄' : (cat ? cat.icon : '📦');
    const subBits = [];
    if (!isTransfer && acc) subBits.push(`${acc.icon || ''} ${acc.name}`.trim());
    if (t.note) subBits.push(t.note);
    if (t.tags && t.tags.length) subBits.push(t.tags.map((x) => '#' + x).join(' '));
    const badge = t.source === 'auto-salary' || t.source === 'recurring' ? tr('tx.badgeRecurring') : t.source === 'import' ? tr('tx.badgeImport') : null;

    const ic = el('div', { className: 'tx-ic', text: icon, attrs: { 'aria-hidden': 'true' }, style: cat && cat.color ? { background: cat.color + '22' } : {} });
    const left = el('div', { className: 'tx-left' }, [
      el('div', { className: 'date', text: dateLabel(t.date) }),
      el('div', { className: 'cat' }, [
        document.createTextNode(title),
        badge ? el('span', { className: 'badge', text: badge }) : null,
        t.receiptId ? el('span', { className: 'badge', text: '📎', attrs: { title: tr('receipt.has'), 'aria-label': tr('receipt.has') } }) : null,
        t.debt ? el('span', { className: 'badge', text: '🤝 ' + (t.debt.person || '') }) : null,
      ]),
      subBits.length ? el('div', { className: 'note', text: subBits.join(' · ') }) : null,
    ]);
    const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
    const amt = el('div', { className: 'amt ' + (t.type === 'income' ? 'in' : t.type === 'expense' ? 'out' : 'tr'), text: sign + formatVND(t.amount) });
    const typeLabel = t.type === 'income' ? tr('tx.income') : t.type === 'expense' ? tr('tx.expense') : tr('tx.transfer');
    const del = el('button', {
      className: 'btn danger-text tx-delete', type: 'button', text: '✕',
      attrs: { 'aria-label': tr('tx.deleteAria', { category: title, amount: formatVND(t.amount), date: dateLabel(t.date) }), title: tr('tx.deleteTitle') },
      on: { click: (e) => { e.stopPropagation(); onDelete(t.id); } },
    });
    const row = el('div', {
      className: 'tx', dataset: { id: t.id }, attrs: { role: 'listitem', tabindex: '0', 'aria-label': tr('tx.rowAria', { type: typeLabel, amount: formatVND(t.amount), category: title, date: dateLabel(t.date), note: t.note ? ', ' + t.note : '' }) },
      on: {
        click: () => onEdit(t.id),
        keydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(t.id); }
          else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDelete(t.id); }
        },
      },
    }, [ic, left, amt, del]);
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
  function sig(t) { return `${t.type}|${t.amount}|${t.categoryId}|${t.category}|${t.accountId}|${t.toAccountId}|${t.note}|${(t.tags || []).join(',')}|${t.date}|${t.source}|${t.updatedAt || 0}|${t.receiptId || ''}|${t.debt ? t.debt.person : ''}|${ctx.version ? ctx.version() : 0}`; }

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
