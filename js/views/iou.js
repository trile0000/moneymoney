// P1d: công nợ cá nhân (cho mượn / đi mượn / thu–trả nợ) — mỗi khoản là một giao dịch thật gắn meta debt.
import * as S from '../state.js';
import { $, el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { toLocalYMD, isValidYMD, dateLabel } from '../utils/date.js';
import { t } from '../i18n.js';
import { showToast } from '../ui/toast.js';
import { openFormSheet } from '../ui/formSheet.js';
import { fillAccountSelect } from '../ui/pickers.js';

let ctx = null;

export function initIou(c) {
  ctx = c;
  $('#addLend').addEventListener('click', () => openIouForm('lend'));
  $('#addBorrow').addEventListener('click', () => openIouForm('borrow'));
}

export function renderIou() {
  const sum = $('#iouSummary'), list = $('#iouList'), empty = $('#iouEmpty');
  clear(sum); clear(list);
  const s = S.getIouSummary();
  empty.style.display = s.people.length ? 'none' : 'flex';
  sum.hidden = !s.people.length;
  if (s.people.length) {
    sum.appendChild(el('div', { className: 'kpi' }, [el('h3', { text: t('iou.receivable') }), el('div', { className: 'val in', text: formatVND(s.receivable, { withUnit: false }) })]));
    sum.appendChild(el('div', { className: 'kpi' }, [el('h3', { text: t('iou.payable') }), el('div', { className: 'val out', text: formatVND(s.payable, { withUnit: false }) })]));
    sum.appendChild(el('div', { className: 'kpi' }, [el('h3', { text: t('iou.open') }), el('div', { className: 'val', text: String(s.openCount) })]));
  }
  for (const p of s.people) {
    const sub = p.open
      ? (p.balance > 0 ? t('iou.theyOwe', { amount: formatVND(p.balance) }) : t('iou.iOwe', { amount: formatVND(-p.balance) }))
      : t('iou.settled');
    list.appendChild(el('button', {
      className: 'mini-row' + (p.open ? '' : ' archived'), type: 'button', attrs: { role: 'listitem' }, on: { click: () => openPersonSheet(p.key) },
    }, [
      el('div', { className: 'mini-ic', text: p.balance > 0 ? '🤝' : p.balance < 0 ? '🙏' : '✅' }),
      el('div', { className: 'mini-main' }, [el('div', { className: 'mini-title', text: p.person }), el('div', { className: 'mini-sub', text: `${sub} · ${t('iou.lastDate', { date: dateLabel(p.lastDate) })}` })]),
      el('div', { className: 'mini-right ' + (p.balance > 0 ? 'in' : p.balance < 0 ? 'out' : ''), text: (p.balance > 0 ? '+' : p.balance < 0 ? '−' : '') + formatVND(Math.abs(p.balance)) }),
    ]));
  }
}

/** Dòng tóm tắt cho thẻ Ví ở trang chủ (null nếu không có công nợ mở) */
export function iouHomeLine() {
  const s = S.getIouSummary();
  if (!s.receivable && !s.payable) return null;
  return [s.receivable ? t('iou.homeRecv', { amount: formatVND(s.receivable) }) : null, s.payable ? t('iou.homePay', { amount: formatVND(s.payable) }) : null].filter(Boolean).join(' · ');
}

function peopleDatalist() {
  let dl = document.getElementById('iouPeople');
  if (!dl) { dl = el('datalist', { id: 'iouPeople' }); document.body.appendChild(dl); }
  clear(dl);
  for (const n of S.getIouPeople()) dl.appendChild(el('option', { value: n }));
  return dl;
}

/** Form cho mượn / đi mượn / trả–thu nợ. kind: 'lend' | 'borrow' | 'repay' (repay cần person + direction) */
export function openIouForm(kind, { person = '', direction = 'in', suggest = 0 } = {}) {
  peopleDatalist();
  const isRepay = kind === 'repay';
  const title = kind === 'lend' ? t('iou.formLend') : kind === 'borrow' ? t('iou.formBorrow') : direction === 'in' ? t('iou.formRepayIn', { person }) : t('iou.formRepayOut', { person });
  const api = openFormSheet({
    title,
    fields: [
      { type: 'row2', fields: [
        { key: 'person', label: t('iou.person'), type: 'text', autofocus: !isRepay, placeholder: 'VD: Nam, Mẹ, Anh Ba', attrs: { list: 'iouPeople' } },
        { key: 'amount', label: t('iou.amount'), type: 'amount', autofocus: isRepay, placeholder: 'VD: 2tr' },
      ] },
      { type: 'row2', fields: [
        { key: 'account', label: t('iou.account'), type: 'select', options: [] },
        { key: 'date', label: t('iou.date'), type: 'date' },
      ] },
      { key: 'note', label: t('iou.note'), type: 'text' },
    ],
    values: { person, date: toLocalYMD(), amount: suggest || 0 },
    onSave: async (v) => {
      const who = String(v.person || '').trim();
      if (!who) { const e = new Error(t('iou.errPerson')); e.focusKey = 'person'; throw e; }
      if (!v.amount || v.amount <= 0) { const e = new Error(t('iou.errAmount')); e.focusKey = 'amount'; throw e; }
      if (!v.account) { const e = new Error(t('tx.errAccount')); e.focusKey = 'account'; throw e; }
      await S.addIou({ kind, direction, person: who, amount: v.amount, accountId: v.account, date: isValidYMD(v.date) ? v.date : toLocalYMD(), note: v.note });
      showToast(kind === 'lend' ? t('iou.savedLend', { person: who, amount: formatVND(v.amount) }) : kind === 'borrow' ? t('iou.savedBorrow', { person: who, amount: formatVND(v.amount) }) : t('iou.savedRepay', { amount: formatVND(v.amount) }));
      ctx.refresh('data');
    },
  });
  fillAccountSelect(api.ctl('account').el, { value: S.getSettings().lastAccountId || S.getSettings().defaultAccountId, includeArchived: false });
  if (isRepay) api.ctl('person').el.readOnly = true;
  return api;
}

function openPersonSheet(key) {
  const p = S.getIouSummary().people.find((x) => x.key === key);
  if (!p) return;
  const api = openFormSheet({
    title: `🤝 ${p.person}`,
    fields: [],
    values: {},
    saveText: t('common.close'),
    hideCancel: true,
    onSave: () => {},
    extraText: p.balance > 0 ? t('iou.recordRepayIn') : p.balance < 0 ? t('iou.recordRepayOut') : null,
    onExtra: p.open ? (a) => { a.close(); openIouForm('repay', { person: p.person, direction: p.balance > 0 ? 'in' : 'out', suggest: Math.abs(p.balance) }); } : null,
  });
  const box = api.root;
  const line = (label, v, cls) => el('div', { className: 'ef-line' }, [el('span', { text: label + ': ' }), el('strong', { className: cls || '', text: formatVND(v) })]);
  box.appendChild(el('div', { className: 'status-bar ' + (p.balance > 0 ? 'status--rich' : p.balance < 0 ? 'status--poor' : 'status--neutral'), text: p.balance > 0 ? t('iou.theyOwe', { amount: formatVND(p.balance) }) : p.balance < 0 ? t('iou.iOwe', { amount: formatVND(-p.balance) }) : t('iou.settled') }));
  if (p.lent) box.appendChild(line(t('iou.lent'), p.lent)); if (p.lentBack) box.appendChild(line(t('iou.lentBack'), p.lentBack));
  if (p.borrowed) box.appendChild(line(t('iou.borrowed'), p.borrowed)); if (p.paidBack) box.appendChild(line(t('iou.paidBack'), p.paidBack));
  const actions = el('div', { className: 'row-actions', style: { marginTop: '8px' } }, [
    el('button', { className: 'btn ghost small', type: 'button', text: t('iou.moreLend'), on: { click: () => { api.close(); openIouForm('lend', { person: p.person }); } } }),
    el('button', { className: 'btn ghost small', type: 'button', text: t('iou.moreBorrow'), on: { click: () => { api.close(); openIouForm('borrow', { person: p.person }); } } }),
  ]);
  box.appendChild(actions);
  box.appendChild(el('div', { className: 'section-title', text: t('iou.history', { n: p.items.length }) }));
  const hist = el('div', { className: 'contrib-list' });
  for (const x of p.items.slice(0, 30)) {
    const kindLabel = x.debt.kind === 'lend' ? t('iou.kLend') : x.debt.kind === 'borrow' ? t('iou.kBorrow') : x.type === 'income' ? t('iou.kRepayIn') : t('iou.kRepayOut');
    hist.appendChild(el('div', { className: 'contrib-row' }, [
      el('span', { text: `${dateLabel(x.date)} · ${kindLabel} · ${formatVND(x.amount)}${x.note && x.note !== p.person ? ' · ' + x.note : ''}` }),
      el('button', { className: 'btn ghost small', type: 'button', text: t('common.edit'), on: { click: () => { api.close(); ctx.editFlow(x.id); } } }),
    ]));
  }
  box.appendChild(hist);
}
