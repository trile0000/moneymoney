// Tab Trang chủ: tổng kết tháng + mascot/tier, ví & số dư, biểu đồ, giao dịch gần đây, định kỳ sắp tới.
import * as S from '../state.js';
import { $, el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { toLocalYMD, toLocalYM, isValidYM, dateLabel } from '../utils/date.js';
import { t, monthLabelL } from '../i18n.js';
import { tierOf, tierMessage, mascotFor, evaluateAchievement } from '../features/achievements.js';
import { creditStatus, totals, ACCOUNT_ICONS } from '../features/accounts.js';
import { nextOccurrence } from '../features/recurring.js';
import { renderChart } from '../ui/charts.js';
import { fireConfetti } from '../ui/confetti.js';
import { showToast } from '../ui/toast.js';
import { navigate } from '../router.js';

const ASSET = 'assets/mascot/sm/';
let ctx = null;
const els = {};
let prevCurrentTier = null;
let lastMascotPick = null;

export function initHome(c) {
  ctx = c;
  for (const id of ['filterMonth', 'thisMonth', 'txCount', 'mascotBalance', 'balanceStatus', 'sumIncome', 'sumExpense', 'sumBalance', 'accountList', 'accountTotal', 'creditWarnings', 'quickTransfer', 'chart', 'chartMode', 'chartType', 'chartScope', 'mascotChart', 'recentList', 'recentEmpty', 'upcomingList', 'upcomingEmpty']) els[id] = $('#' + id);
  els.filterMonth.value = toLocalYM();
  els.filterMonth.addEventListener('change', () => renderHome('filter'));
  els.thisMonth.addEventListener('click', () => { els.filterMonth.value = toLocalYM(); renderHome('filter'); });
  els.chartMode.addEventListener('change', () => renderHome('chart'));
  els.chartType.addEventListener('change', () => renderHome('chart'));
  els.quickTransfer.addEventListener('click', () => navigate('tx', { focus: 'amount', type: 'transfer' }));
}

function currentMonthKey() { const v = els.filterMonth.value; return isValidYM(v) ? v : ''; }
function monthData(key) {
  if (key) return S.getMonth(key);
  const items = S.getVisible();
  let income = 0, expense = 0;
  for (const tx of items) { if (tx.type === 'income') income += tx.amount; else if (tx.type === 'expense') expense += tx.amount; }
  return { income, expense, count: items.length, items };
}

/** reason: 'init' | 'data' | 'filter' | 'settings' | 'chart' | 'theme' */
export function renderHome(reason = 'data') {
  const key = currentMonthKey();
  const m = monthData(key);
  const settings = S.getSettings();

  setKpi(els.sumIncome, m.income); setKpi(els.sumExpense, m.expense); setKpi(els.sumBalance, m.income - m.expense);
  els.txCount.textContent = t('common.transactions', { n: m.count });

  const balance = m.income - m.expense;
  const tier = tierOf(balance, settings.thresholds);
  const pick = mascotFor(tier);
  if (pick.file !== lastMascotPick) { els.mascotBalance.classList.remove('mascot-animate'); void els.mascotBalance.offsetWidth; els.mascotBalance.classList.add('mascot-animate'); lastMascotPick = pick.file; }
  els.mascotBalance.src = ASSET + pick.file + '.webp';
  els.balanceStatus.className = 'status-bar status--' + pick.status;
  els.balanceStatus.textContent = tierMessage(tier, balance, settings.messages, formatVND);
  els.mascotChart.src = ASSET + (els.chartMode.value === 'byCategory' ? 'tiger_spending' : 'tiger_income') + '.webp';

  if (reason === 'init' || reason === 'data' || reason === 'settings') {
    const cur = S.getMonth(toLocalYM());
    const curTier = tierOf(cur.income - cur.expense, settings.thresholds);
    const ev = evaluateAchievement({ tier: curTier, prevTier: prevCurrentTier, bestTier: settings.bestTier, isCurrentMonth: true, reason });
    if (ev.confetti) fireConfetti(curTier);
    if (ev.newBest) { S.updateSettings({ bestTier: curTier, bestTierMonth: toLocalYM() }, { silent: true }); showToast(t('toast.newBest', { tier: curTier })); }
    prevCurrentTier = curTier;
  }

  renderChart({ canvas: els.chart, scopeEl: els.chartScope, mode: els.chartMode.value, type: els.chartType.value, monthKey: key, month: m, monthIndex: S.getMonthIndex(), categoryOf: S.getCategoryById });
  if (reason !== 'chart' && reason !== 'filter') { renderAccounts(); renderRecent(); renderUpcoming(); }
}
export function resetAchievementState() { prevCurrentTier = null; }

function setKpi(node, value) {
  node.textContent = formatVND(value, { withUnit: false });
  node.style.fontSize = '';
  let size = parseFloat(getComputedStyle(node).fontSize) || 16, guard = 0;
  while (node.scrollWidth > node.clientWidth + 1 && size > 10 && guard++ < 8) { size -= 1; node.style.fontSize = size + 'px'; }
}

function renderAccounts() {
  const bal = S.getBalances();
  const accs = S.getAccounts();
  clear(els.accountList); clear(els.creditWarnings);
  const today = new Date();
  for (const a of accs) {
    const b = bal.get(a.id) || 0;
    const cs = a.type === 'credit' ? creditStatus(a, b, today) : null;
    const sub = cs ? `${t('acc.debt')} ${formatVND(cs.debt)}${cs.available !== null ? ' · ' + formatVND(cs.available) + ' ' + t('acc.available') : ''}` : t('acc.type' + a.type.charAt(0).toUpperCase() + a.type.slice(1));
    els.accountList.appendChild(el('button', {
      className: 'acc-row', type: 'button', attrs: { role: 'listitem' },
      on: { click: () => navigate('tx', { account: a.id }) },
    }, [
      el('div', { className: 'acc-ic', text: a.icon || ACCOUNT_ICONS[a.type], style: { background: a.color } }),
      el('div', {}, [el('div', { className: 'acc-name', text: a.name }), el('div', { className: 'acc-sub', text: sub })]),
      el('div', { className: 'acc-bal' + (b < 0 ? ' neg' : ''), text: formatVND(b) }),
    ]));
    if (cs && cs.warn) {
      const days = cs.daysToDue <= 0 ? t('common.today') : cs.daysToDue === 1 ? t('common.tomorrow') : t('common.inDays', { n: cs.daysToDue });
      els.creditWarnings.appendChild(el('div', { className: 'warn-item', text: t('home.creditDue', { name: a.name, amount: formatVND(cs.debt), date: dateLabel(cs.dueDate), days }) }));
    }
  }
  const tot = totals(accs, bal);
  clear(els.accountTotal);
  els.accountTotal.appendChild(el('span', {}, [document.createTextNode(t('home.total') + ': '), el('strong', { text: formatVND(tot.assets) })]));
  if (tot.liabilities) els.accountTotal.appendChild(el('span', {}, [document.createTextNode(t('home.liabilities') + ': '), el('strong', { text: formatVND(tot.liabilities) })]));
  els.accountTotal.appendChild(el('span', {}, [document.createTextNode(t('home.net') + ': '), el('strong', { text: formatVND(tot.net) })]));
}

function renderRecent() {
  const items = S.getRecent(6);
  clear(els.recentList);
  els.recentEmpty.style.display = items.length ? 'none' : 'flex';
  for (const tx of items) {
    const cat = tx.type !== 'transfer' ? S.getCategoryById(tx.categoryId) : null;
    const acc = S.getAccountById(tx.accountId);
    const toAcc = tx.type === 'transfer' ? S.getAccountById(tx.toAccountId) : null;
    const title = tx.type === 'transfer' ? t('tx.transferRow', { from: acc ? acc.name : '?', to: toAcc ? toAcc.name : '?' }) : (cat ? cat.name : tx.category);
    const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : '';
    els.recentList.appendChild(el('button', {
      className: 'mini-row', type: 'button', attrs: { role: 'listitem' }, on: { click: () => ctx.editFlow(tx.id) },
    }, [
      el('div', { className: 'mini-ic', text: tx.type === 'transfer' ? '⇄' : (cat ? cat.icon : '📦') }),
      el('div', { className: 'mini-main' }, [el('div', { className: 'mini-title', text: title }), el('div', { className: 'mini-sub', text: [dateLabel(tx.date), acc && tx.type !== 'transfer' ? acc.name : null, tx.note].filter(Boolean).join(' · ') })]),
      el('div', { className: 'mini-right ' + (tx.type === 'income' ? 'in' : tx.type === 'expense' ? 'out' : ''), text: sign + formatVND(tx.amount) }),
    ]));
  }
}

function renderUpcoming() {
  const today = toLocalYMD();
  const rows = [];
  for (const r of S.getRules()) {
    if (!r.enabled) continue;
    const next = nextOccurrence(r, today);
    if (next) rows.push({ r, next });
  }
  rows.sort((a, b) => (a.next < b.next ? -1 : 1));
  clear(els.upcomingList);
  els.upcomingEmpty.style.display = rows.length ? 'none' : 'flex';
  for (const { r, next } of rows.slice(0, 5)) {
    const cat = r.template.categoryId ? S.getCategoryById(r.template.categoryId) : null;
    const d = new Date(next + 'T00:00:00');
    const diff = Math.round((d - new Date(today + 'T00:00:00')) / 86400000);
    const when = diff <= 0 ? t('common.today') : diff === 1 ? t('common.tomorrow') : t('common.inDays', { n: diff });
    els.upcomingList.appendChild(el('button', {
      className: 'mini-row', type: 'button', attrs: { role: 'listitem' }, on: { click: () => ctx.openRuleForm(r) },
    }, [
      el('div', { className: 'mini-ic', text: r.template.type === 'transfer' ? '⇄' : (cat ? cat.icon : '🔁') }),
      el('div', { className: 'mini-main' }, [el('div', { className: 'mini-title', text: r.name }), el('div', { className: 'mini-sub', text: `${dateLabel(next)} · ${when}` })]),
      el('div', { className: 'mini-right ' + (r.template.type === 'income' ? 'in' : r.template.type === 'expense' ? 'out' : ''), text: (r.template.type === 'income' ? '+' : r.template.type === 'expense' ? '−' : '') + formatVND(r.template.amount) }),
    ]));
  }
}

export function getHomeMonthKey() { return currentMonthKey(); }
export { monthLabelL };
