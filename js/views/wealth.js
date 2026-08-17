// P1c: điểm sức khỏe tài chính, quản lý nợ, tài sản ròng, dự báo dòng tiền, streak & huy hiệu.
// Sống trong tab Ngân sách (#/budget?section=health|debts|networth|forecast) + thẻ tóm tắt ở trang chủ.
import * as S from '../state.js';
import { $, el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { toLocalYM, toLocalYMD, isValidYMD, dateLabel } from '../utils/date.js';
import { t, monthLabelL } from '../i18n.js';
import { showToast } from '../ui/toast.js';
import { openFormSheet } from '../ui/formSheet.js';
import { bindAmountInput } from '../ui/amountInput.js';
import { confirmDialog } from '../ui/confirm.js';
import { isDark } from '../ui/theme.js';
import { DEBT_KINDS, schedule, debtStatus, simulatePayoff, prepaySavings } from '../features/debts.js';
import { ASSET_TYPES, ASSET_ICONS, computeNetWorth, diversification } from '../features/networth.js';
import { forecast } from '../features/forecast.js';
import { healthScore, healthTier, DEFAULT_WEIGHTS } from '../features/health.js';
import { computeStreak, BADGES, earnedBadges, positiveMonthsInRow } from '../features/achievements.js';
import { goalStatus } from '../features/goals.js';
import { ACCOUNT_ICONS } from '../features/accounts.js';
import { efSummary } from './budget.js';

let ctx = null;
let nwChart = null;
let strategyExtra = 0;

export function initWealth(c) {
  ctx = c;
  $('#editHealth').addEventListener('click', openWeightsForm);
  $('#addDebt').addEventListener('click', () => openDebtForm());
  $('#addAsset').addEventListener('click', () => openAssetForm());
  const fm = $('#fcMonths');
  fm.value = String(S.getSettings().forecastMonths || 6);
  fm.addEventListener('change', async () => { await S.updateSettings({ forecastMonths: Number(fm.value) || 6 }, { silent: true }); renderForecast(); });
}

export function renderWealth(params = {}) {
  renderHealth();
  renderDebts();
  renderNetWorth();
  renderForecast();
  if (params.section) {
    const sec = document.getElementById('sec-' + params.section);
    if (sec) setTimeout(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
}

// ---------- Tổng hợp dùng chung (home + budget) ----------
/** Tổng trả nợ hàng tháng của các khoản chưa xong + dư nợ + lịch trả tương lai */
export function debtOverview() {
  const today = toLocalYMD();
  const rows = S.getDebts().map((d) => ({ d, st: debtStatus(d, today) }));
  const monthly = rows.filter((r) => !r.st.done).reduce((a, r) => a + r.st.payment, 0);
  const balances = rows.map((r) => ({ name: r.d.name, balance: r.st.balance }));
  const future = [];
  for (const r of rows) { if (r.st.done) continue; for (const row of schedule(r.d).rows) if (row.date > today) future.push({ ym: row.date.slice(0, 7), amount: row.payment }); }
  return { rows, monthly, balances, future };
}

export function netWorthNow(debtBalances) {
  const iou = S.getIouSummary();
  return computeNetWorth({ accounts: S.getAccounts(), balances: S.getBalances(), assets: S.getAssets(), debtBalances: debtBalances || debtOverview().balances, iou: { receivable: iou.receivable, payable: iou.payable, receivableLabel: t('iou.receivable'), payableLabel: t('iou.payable') } });
}

/** Điểm sức khỏe + streak + huy hiệu hiện tại (tính từ dữ liệu thật) */
export function healthSummary() {
  const cur = toLocalYM();
  const ef = efSummary();
  const debts = debtOverview();
  const nw = netWorthNow(debts.balances);
  const dv = diversification(nw.byType);
  const h = healthScore({ monthIndex: S.getMonthIndex(), currentYM: cur, efCoveredMonths: ef.st.coveredMonths, monthlyDebtPayments: debts.monthly, diversifyCount: dv.count, weights: S.getSettings().healthWeights });
  const tier = healthTier(h.score);
  const streak = computeStreak(S.getVisible());
  const today = toLocalYMD();
  const goalsDone = S.getGoals().filter((g) => goalStatus(g, today).done).length;
  const badges = earnedBadges({ txCount: S.getVisible().length, streakBest: streak.best, budgets: S.getBudgets().length, goalsDone, efMonths: ef.st.coveredMonths, healthScore: h.score, positiveMonthsInRow: positiveMonthsInRow(S.getMonthIndex(), cur) });
  return { ...h, tier, streak, badges, ef, debts, nw, diversify: dv };
}

/** Lưu snapshot tài sản ròng tháng này (gọi khi boot & khi dữ liệu đổi) */
export async function snapshotNow() {
  const nw = netWorthNow();
  return S.saveSnapshot(toLocalYM(), { assets: nw.assets, liabilities: nw.liabilities });
}

/** Ghi nhận huy hiệu mới → toast; trả về danh sách key mới */
export async function syncBadges(earned) {
  const have = new Set(S.getSettings().badges || []);
  const fresh = earned.filter((k) => !have.has(k));
  if (!fresh.length) return [];
  await S.updateSettings({ badges: [...have, ...fresh] }, { silent: true });
  const b = BADGES.find((x) => x.key === fresh[0]);
  showToast(t('badge.unlocked', { name: `${b ? b.icon + ' ' : ''}${t('badge.' + fresh[0])}` }) + (fresh.length > 1 ? ` +${fresh.length - 1}` : ''), { duration: 5000 });
  return fresh;
}

// ---------- Thẻ trang chủ ----------
export function renderHomeHealth(summary) {
  const s = summary || healthSummary();
  const box = $('#homeHealth'), streakEl = $('#homeStreak'), badgesEl = $('#homeBadges');
  clear(box); clear(streakEl); clear(badgesEl);
  box.appendChild(scoreRing(s.score, s.tier));
  const list = el('div', { className: 'health-mini' });
  for (const c of s.components) {
    list.appendChild(el('div', { className: 'health-mini-row', attrs: { title: t('health.c.' + c.key) } }, [
      el('span', { className: 'hm-label', text: t('health.c.' + c.key) }),
      el('span', { className: 'bar-track hm-track' }, [el('span', { className: `bar-fill ${lvlOf(c.ratio)}`, style: { width: `${Math.max(2, c.ratio * 100)}%` } })]),
      el('span', { className: 'hm-pts', text: `${c.points}/${c.weight}` }),
    ]));
  }
  box.appendChild(list);
  streakEl.textContent = s.streak.current > 0 ? `${t('streak.current', { n: s.streak.current })} · ${t('streak.best', { n: s.streak.best })}` : t('streak.none');
  renderBadgeRow(badgesEl, s.badges);
}

function scoreRing(score, tier) {
  const ring = el('div', { className: 'score-ring', style: { '--pct': String(score) }, attrs: { role: 'img', 'aria-label': `${t('health.title')}: ${t('health.score', { score })} — ${t('health.tierName.' + tier)}` } }, [
    el('div', { className: 'score-num', text: String(score) }),
  ]);
  ring.style.setProperty('--pct', String(score));
  return el('div', { className: 'score-wrap' }, [
    ring,
    el('div', {}, [el('div', { className: 'score-tier', text: `${t('health.tier', { tier })} · ${t('health.tierName.' + tier)}` }), el('div', { className: 'hint', text: t('health.score', { score }) })]),
  ]);
}

function renderBadgeRow(holder, earned) {
  const set = new Set(earned);
  for (const b of BADGES) {
    const on = set.has(b.key);
    holder.appendChild(el('span', { className: 'badge-chip' + (on ? ' on' : ''), attrs: { title: t('badge.' + b.key), 'aria-label': `${t('badge.' + b.key)}${on ? '' : ' (🔒)'}` } }, [el('span', { className: 'badge-ic', text: b.icon }), el('span', { className: 'badge-name', text: t('badge.' + b.key) })]));
  }
}

function lvlOf(ratio) { return ratio >= 0.75 ? 'lvl-ok' : ratio >= 0.4 ? 'lvl-warn' : 'lvl-over'; }

// ---------- Điểm sức khỏe (chi tiết) ----------
function renderHealth() {
  const body = $('#healthBody');
  clear(body);
  const s = healthSummary();
  body.appendChild(scoreRing(s.score, s.tier));
  body.appendChild(el('p', { className: 'hint', text: t('health.formula') }));
  const list = el('div', { className: 'bars' });
  for (const c of s.components) {
    let val;
    if (c.key === 'savings') val = c.value === null ? t('health.v.savingsNone') : t('health.v.savings', { pct: Math.round(c.value * 100) });
    else if (c.key === 'emergency') val = t('health.v.emergency', { months: Number(c.value || 0).toFixed(1) });
    else if (c.key === 'dti') val = t('health.v.dti', { pct: Math.round((c.value || 0) * 100) });
    else if (c.key === 'stability') val = c.value === null ? t('health.v.stabilityNone') : t('health.v.stability', { cv: c.value.toFixed(2) });
    else val = t('health.v.diversify', { n: c.value });
    list.appendChild(el('div', { className: `bar-row health-row ${lvlOf(c.ratio)}` }, [
      el('div', { className: 'bar-label', text: t('health.c.' + c.key) }),
      el('div', { className: 'bar-val', text: `${c.points}/${c.weight}` }),
      el('div', { className: 'bar-track' }, [el('div', { className: 'bar-fill', style: { width: `${Math.max(1, c.ratio * 100)}%` } })]),
      el('div', { className: 'bar-sub', text: `${val} — ${t(`health.tip.${c.key}.${c.tip}`)}` }),
    ]));
  }
  body.appendChild(list);
  const streakLine = el('div', { className: 'streak-row', text: s.streak.current > 0 ? `${t('streak.current', { n: s.streak.current })} · ${t('streak.best', { n: s.streak.best })}` : t('streak.none') });
  body.appendChild(streakLine);
  body.appendChild(el('div', { className: 'section-title', text: t('badge.title') }));
  const badges = el('div', { className: 'badges' });
  renderBadgeRow(badges, s.badges);
  body.appendChild(badges);
}

function openWeightsForm() {
  const w = { ...DEFAULT_WEIGHTS, ...(S.getSettings().healthWeights || {}) };
  const keys = Object.keys(DEFAULT_WEIGHTS);
  openFormSheet({
    title: t('health.weightsTitle'),
    fields: keys.map((k, i) => ({ key: k, label: t('health.c.' + k), type: 'number', attrs: { min: 0, max: 100 }, hint: i === keys.length - 1 ? t('health.weightsHint') : undefined })),
    values: w,
    onSave: async (v) => {
      const out = {};
      for (const k of keys) out[k] = Math.max(0, Number(v[k]) || 0);
      if (!Object.values(out).some((x) => x > 0)) throw new Error(t('health.weightsHint'));
      await S.updateSettings({ healthWeights: out }, { silent: true });
      showToast(t('health.saved'));
      ctx.refresh('settings');
    },
  });
}

// ---------- Nợ ----------
function renderDebts() {
  const holder = $('#debtList'), empty = $('#debtEmpty'), strat = $('#debtStrategy');
  clear(holder);
  const { rows } = debtOverview();
  rows.sort((a, b) => Number(a.st.done) - Number(b.st.done) || (a.st.next ? a.st.next.date : '9999').localeCompare(b.st.next ? b.st.next.date : '9999'));
  empty.style.display = rows.length ? 'none' : 'flex';
  for (const { d, st } of rows) {
    const sub = st.done ? t('debt.done') : [t('debt.status', { balance: formatVND(st.balance), paid: formatVND(st.paidPrincipal), pct: Math.round(st.pct * 100) }), st.next ? t('debt.next', { date: dateLabel(st.next.date), amount: formatVND(st.next.payment) }) : null].filter(Boolean).join(' · ');
    holder.appendChild(el('div', {
      className: 'bar-row goal-row debt-row' + (st.done ? ' done' : ''), attrs: { role: 'listitem', tabindex: '0', 'aria-label': `${d.name}: ${sub}` },
      on: { click: () => openDebtForm(d), keydown: (e) => { if (e.key === 'Enter') openDebtForm(d); } },
    }, [
      el('div', { className: 'bar-label', text: `${kindIcon(d.kind)} ${d.name} · ${d.rate}%/${t('common.year')}` }),
      el('div', { className: 'bar-val', text: `${Math.round(st.pct * 100)}%` }),
      el('div', { className: 'bar-track' }, [el('div', { className: 'bar-fill lvl-ok', style: { width: `${Math.max(1, st.pct * 100)}%` } })]),
      el('div', { className: 'bar-sub goal-sub' }, [
        el('span', { text: sub }),
        st.done ? null : el('span', { className: 'row-actions' }, [
          el('button', { className: 'btn ghost small', type: 'button', text: t('debt.schedule'), on: { click: (e) => { e.stopPropagation(); openScheduleSheet(d); } } }),
          el('button', { className: 'btn ghost small', type: 'button', text: t('debt.extra'), on: { click: (e) => { e.stopPropagation(); openExtraForm(d); } } }),
        ]),
      ]),
    ]));
  }
  // Chiến lược snowball vs avalanche
  const active = rows.filter((r) => !r.st.done);
  clear(strat);
  strat.hidden = active.length < 1;
  if (active.length >= 1) {
    strat.appendChild(el('div', { className: 'section-title', text: t('debt.strategyTitle') }));
    const input = el('input', { id: 'stratExtra', type: 'text', attrs: { inputmode: 'text', 'aria-label': t('debt.strategyExtra'), placeholder: 'VD: 2tr' } });
    const out = el('div', { className: 'strategy-out' });
    const draw = () => {
      clear(out);
      const list = active.map((r) => ({ name: r.d.name, balance: r.st.balance, rate: r.d.rate, payment: r.st.payment }));
      for (const key of ['snowball', 'avalanche']) {
        const r = simulatePayoff(list, strategyExtra, key);
        out.appendChild(el('div', { className: 'strategy-row' }, [el('strong', { text: t('debt.' + key) }), el('div', { className: 'hint', text: t('debt.strategyRow', { months: r.months, interest: formatVND(r.totalInterest), order: r.order.join(' → ') }) })]));
      }
    };
    const hint = el('div', { className: 'hint' });
    const ctl = bindAmountInput(input, hint);
    if (strategyExtra) ctl.setValue(strategyExtra);
    input.addEventListener('input', () => { strategyExtra = ctl.getValue() || 0; draw(); });
    strat.appendChild(el('div', { className: 'fs-field' }, [el('label', { text: t('debt.strategyExtra'), attrs: { for: 'stratExtra' } }), input, hint]));
    strat.appendChild(out);
    strat.appendChild(el('p', { className: 'hint', text: t('debt.strategyHint') }));
    draw();
  }
}

function kindIcon(kind) { return { loan: '🏦', installment: '📱', creditcard: '💳', other: '🧾' }[kind] || '🧾'; }

export function openDebtForm(debt = null) {
  const isNew = !debt;
  const values = debt ? { name: debt.name, kind: debt.kind, principal: debt.principal, rate: debt.rate, termMonths: debt.termMonths, startDate: debt.startDate, paymentDay: debt.paymentDay, note: debt.note }
    : { kind: 'loan', rate: 0, termMonths: 12, startDate: toLocalYMD(), paymentDay: Number(toLocalYMD().slice(8, 10)) };
  const api = openFormSheet({
    title: isNew ? t('debt.new') : t('debt.editTitle'),
    fields: [
      { type: 'row2', fields: [{ key: 'name', label: t('debt.name'), type: 'text', autofocus: true }, { key: 'kind', label: t('debt.kind'), type: 'select', options: DEBT_KINDS.map((k) => ({ value: k, label: t('debt.kind.' + k) })) }] },
      { type: 'row2', fields: [{ key: 'principal', label: t('debt.principal'), type: 'amount', placeholder: 'VD: 120tr' }, { key: 'rate', label: t('debt.rate'), type: 'number', attrs: { min: 0, max: 100, step: '0.1' } }] },
      { type: 'row2', fields: [{ key: 'termMonths', label: t('debt.term'), type: 'number', attrs: { min: 1, max: 600 } }, { key: 'paymentDay', label: t('debt.paymentDay'), type: 'number', attrs: { min: 1, max: 31 } }] },
      { type: 'row2', fields: [{ key: 'startDate', label: t('debt.startDate'), type: 'date' }, { key: 'note', label: t('debt.note'), type: 'text' }] },
    ],
    values,
    onSave: async (v) => {
      if (!v.name.trim()) { const e = new Error(t('debt.errName')); e.focusKey = 'name'; throw e; }
      if (!v.principal || v.principal <= 0) { const e = new Error(t('debt.errPrincipal')); e.focusKey = 'principal'; throw e; }
      const patch = { name: v.name.trim(), kind: v.kind, principal: v.principal, rate: Number(v.rate) || 0, termMonths: Number(v.termMonths) || 1, startDate: isValidYMD(v.startDate) ? v.startDate : toLocalYMD(), paymentDay: Number(v.paymentDay) || 1, note: v.note };
      if (isNew) await S.addDebt(patch); else await S.updateDebt(debt.id, patch);
      showToast(t('debt.saved'));
      ctx.refresh('data');
    },
    deleteText: isNew ? null : t('common.delete'),
    onDelete: isNew ? null : async () => {
      const ok = await confirmDialog({ title: t('debt.deleteTitle', { name: debt.name }), body: '', okText: t('common.delete') });
      if (!ok) throw new Error('');
      await S.removeDebt(debt.id);
      showToast(t('debt.deleted'));
      ctx.refresh('data');
    },
    extraText: isNew ? null : t('debt.schedule'),
    onExtra: isNew ? null : (a) => { a.close(); openScheduleSheet(debt); },
  });
  if (!isNew) {
    const st = debtStatus(debt, toLocalYMD());
    api.root.appendChild(el('div', { className: 'note-box', text: t('debt.summary', { payment: formatVND(st.payment), months: schedule(debt).months, interest: formatVND(st.totalInterest), date: st.payoffDate ? dateLabel(st.payoffDate) : '—' }) }));
    if (debt.extraPayments.length) {
      const box = el('div', { className: 'contrib-list' }, [el('div', { className: 'section-title', text: t('debt.extraList', { n: debt.extraPayments.length }) })]);
      for (const x of debt.extraPayments.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12)) {
        box.appendChild(el('div', { className: 'contrib-row' }, [
          el('span', { text: `${dateLabel(x.date)} · ${formatVND(x.amount)}` }),
          el('button', { className: 'btn danger-text', type: 'button', text: '✕', attrs: { 'aria-label': t('common.delete') }, on: { click: async () => { await S.removeDebtExtraPayment(debt.id, x.id); api.close(); ctx.refresh('data'); } } }),
        ]));
      }
      api.root.appendChild(box);
    }
  }
  return api;
}

function openExtraForm(debt) {
  openFormSheet({
    title: t('debt.extraTitle', { name: debt.name }),
    fields: [{ type: 'row2', fields: [{ key: 'amount', label: t('debt.extraAmount'), type: 'amount', autofocus: true, placeholder: 'VD: 5tr' }, { key: 'date', label: t('debt.extraDate'), type: 'date' }] }],
    values: { date: toLocalYMD() },
    onSave: async (v) => {
      if (!v.amount || v.amount <= 0) { const e = new Error(t('debt.errPrincipal')); e.focusKey = 'amount'; throw e; }
      await S.addDebtExtraPayment(debt.id, { amount: v.amount, date: isValidYMD(v.date) ? v.date : toLocalYMD() });
      showToast(t('debt.extraSaved'));
      ctx.refresh('data');
    },
  });
}

function openScheduleSheet(debt) {
  const s = schedule(debt);
  const today = toLocalYMD();
  const api = openFormSheet({
    title: `${t('debt.schedule')} — ${debt.name}`,
    fields: [{ key: 'extra', label: t('debt.prepayInput'), type: 'amount', placeholder: 'VD: 1tr', onInput: (a) => drawPrepay(a.getValues().extra || 0) }],
    values: {},
    saveText: t('common.close'),
    onSave: () => {},
  });
  const prepay = el('div', { className: 'note-box', hidden: true });
  const drawPrepay = (extra) => {
    if (!extra) { prepay.hidden = true; return; }
    const r = prepaySavings(debt, extra);
    prepay.hidden = false;
    prepay.textContent = t('debt.prepay', { amount: formatVND(extra), months: r.monthsSaved, interest: formatVND(r.interestSaved) });
  };
  api.root.appendChild(prepay);
  api.root.appendChild(el('div', { className: 'note-box', text: t('debt.summary', { payment: formatVND(s.payment), months: s.months, interest: formatVND(s.totalInterest), date: s.payoffDate ? dateLabel(s.payoffDate) : '—' }) }));
  const table = el('table', { className: 'sched' });
  table.appendChild(el('thead', {}, [el('tr', {}, ['colK', 'colDate', 'colPay', 'colInterest', 'colPrincipal', 'colBalance'].map((k) => el('th', { text: t('debt.' + k) })))]));
  const tb = el('tbody');
  for (const row of s.rows) {
    tb.appendChild(el('tr', { className: row.date <= today ? 'paid' : '' }, [
      el('td', { text: String(row.k) }), el('td', { text: dateLabel(row.date) }), el('td', { text: formatVND(row.payment, { withUnit: false }) }),
      el('td', { text: formatVND(row.interest, { withUnit: false }) }), el('td', { text: formatVND(row.principal + row.extra, { withUnit: false }) }), el('td', { text: formatVND(row.balance, { withUnit: false }) }),
    ]));
  }
  table.appendChild(tb);
  api.root.appendChild(el('div', { className: 'sched-wrap' }, [table]));
}

// ---------- Tài sản ròng ----------
function renderNetWorth() {
  const sum = $('#nwSummary'), items = $('#nwItems');
  clear(sum); clear(items);
  const nw = netWorthNow();
  sum.appendChild(el('div', { className: 'kpi' }, [el('h4', { text: t('nw.assets') }), el('div', { className: 'val in', text: formatVND(nw.assets, { withUnit: false }) })]));
  sum.appendChild(el('div', { className: 'kpi' }, [el('h4', { text: t('nw.liabilities') }), el('div', { className: 'val out', text: formatVND(nw.liabilities, { withUnit: false }) })]));
  sum.appendChild(el('div', { className: 'kpi' }, [el('h4', { text: t('nw.net') }), el('div', { className: 'val' + (nw.net < 0 ? ' out' : ''), text: formatVND(nw.net, { withUnit: false }) })]));
  for (const it of nw.items) {
    const asset = it.kind === 'asset' || it.kind === 'liability' ? S.getAssets().find((a) => a.name === it.name && (a.liability ? -a.value : a.value) === it.value) : null;
    const icon = it.kind === 'account' ? (ACCOUNT_ICONS[it.type] || '💵') : it.kind === 'debt' ? '🏦' : it.kind === 'iou' ? '🤝' : (ASSET_ICONS[it.type] || '📦');
    const sub = it.kind === 'account' ? t('nw.kindAccount') : it.kind === 'debt' ? t('nw.kindDebt') : it.kind === 'iou' ? t('nw.kindIou') : `${t('nw.type.' + it.type)}${asset ? ' · ' + t('nw.updated', { date: dateLabel(toLocalYMD(asset.updatedAt)) }) : ''}`;
    const row = el(asset ? 'button' : 'div', {
      className: 'mini-row', type: asset ? 'button' : undefined, attrs: { role: 'listitem' },
      on: asset ? { click: () => openAssetForm(asset) } : undefined,
    }, [
      el('div', { className: 'mini-ic', text: icon }),
      el('div', { className: 'mini-main' }, [el('div', { className: 'mini-title', text: it.name }), el('div', { className: 'mini-sub', text: sub })]),
      el('div', { className: 'mini-right ' + (it.value < 0 ? 'out' : 'in'), text: formatVND(it.value) }),
    ]);
    items.appendChild(row);
  }
  drawNwChart();
}

function drawNwChart() {
  const canvas = $('#nwChart');
  if (!canvas || typeof window.Chart === 'undefined') return;
  if (nwChart) { try { nwChart.destroy(); } catch { /* ignore */ } nwChart = null; }
  const snaps = S.getSnapshots();
  const cur = toLocalYM();
  const nw = netWorthNow();
  const data = snaps.filter((s) => s.ym !== cur).concat([{ ym: cur, assets: nw.assets, liabilities: nw.liabilities, net: nw.net }]).slice(-24);
  const dark = isDark();
  window.Chart.defaults.color = dark ? '#e8dcd7' : '#4a3f3b';
  nwChart = new window.Chart(canvas, {
    type: 'line',
    data: { labels: data.map((s) => monthLabelL(s.ym)), datasets: [
      { label: t('nw.chartLabel'), data: data.map((s) => s.net), borderColor: '#8B2E1A', backgroundColor: 'rgba(139,46,26,.12)', fill: true, tension: .3 },
      { label: t('nw.assets'), data: data.map((s) => s.assets), borderColor: '#2e7d32', borderDash: [4, 4], fill: false, tension: .3 },
      { label: t('nw.liabilities'), data: data.map((s) => -s.liabilities), borderColor: '#b3261e', borderDash: [4, 4], fill: false, tension: .3 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatVND(c.parsed.y)}` } } }, scales: { y: { ticks: { callback: (v) => compact(v) } } } },
  });
  canvas.setAttribute('aria-label', `${t('nw.chartLabel')}: ` + data.map((s) => `${monthLabelL(s.ym)} ${formatVND(s.net)}`).join('; '));
  const hintId = 'nwHistoryHint';
  let hint = document.getElementById(hintId);
  if (data.length < 2) { if (!hint) { hint = el('p', { id: hintId, className: 'hint', text: t('nw.noHistory') }); canvas.parentElement.after(hint); } }
  else if (hint) hint.remove();
}

export function openAssetForm(asset = null) {
  const isNew = !asset;
  const values = asset ? { name: asset.name, type: asset.type, value: asset.value, liability: asset.liability, note: asset.note } : { type: 'savings', liability: false };
  openFormSheet({
    title: isNew ? t('nw.new') : t('nw.editTitle'),
    fields: [
      { type: 'row2', fields: [{ key: 'name', label: t('nw.name'), type: 'text', autofocus: true, placeholder: 'VD: Sổ tiết kiệm VCB' }, { key: 'type', label: t('nw.type'), type: 'select', options: ASSET_TYPES.map((k) => ({ value: k, label: `${ASSET_ICONS[k]} ${t('nw.type.' + k)}` })) }] },
      { type: 'row2', fields: [{ key: 'value', label: t('nw.value'), type: 'amount', placeholder: 'VD: 50tr' }, { key: 'note', label: t('nw.note'), type: 'text' }] },
      { key: 'liability', label: t('nw.liability'), type: 'checkbox' },
    ],
    values,
    onSave: async (v) => {
      if (!v.name.trim()) { const e = new Error(t('nw.errName')); e.focusKey = 'name'; throw e; }
      const patch = { name: v.name.trim(), type: v.type, value: v.value || 0, liability: !!v.liability, note: v.note };
      if (isNew) await S.addAsset(patch); else await S.updateAsset(asset.id, patch);
      await snapshotNow();
      showToast(t('nw.saved'));
      ctx.refresh('data');
    },
    deleteText: isNew ? null : t('common.delete'),
    onDelete: isNew ? null : async () => {
      const ok = await confirmDialog({ title: t('nw.deleteTitle', { name: asset.name }), body: '', okText: t('common.delete') });
      if (!ok) throw new Error('');
      await S.removeAsset(asset.id);
      await snapshotNow();
      showToast(t('nw.deleted'));
      ctx.refresh('data');
    },
  });
}

// ---------- Dự báo ----------
function renderForecast() {
  const body = $('#fcBody'), assume = $('#fcAssume');
  clear(body);
  const months = Number($('#fcMonths').value) || 6;
  const debts = debtOverview();
  const liquid = S.getAccounts().filter((a) => !a.archived).reduce((acc, a) => acc + (S.getBalances().get(a.id) || 0), 0);
  const f = forecast({ monthIndex: S.getMonthIndex(), currentYM: toLocalYM(), startBalance: liquid, rules: S.getRules(), debtPayments: debts.future, months });
  const a = f.assumptions;
  if (!a.basedOnMonths && !a.recurringIncome && !a.recurringExpense) { body.appendChild(el('div', { className: 'empty-state', style: { display: 'flex' }, text: t('fc.noData') })); assume.textContent = ''; return; }
  const table = el('table', { className: 'sched fc' });
  table.appendChild(el('thead', {}, [el('tr', {}, ['colMonth', 'colIn', 'colOut', 'colEnd'].map((k) => el('th', { text: t('fc.' + k) })))]));
  const tb = el('tbody');
  for (const r of f.rows) {
    tb.appendChild(el('tr', { className: r.negative ? 'neg' : '' }, [
      el('td', { text: monthLabelL(r.ym) }), el('td', { className: 'in', text: '+' + formatVND(r.income, { withUnit: false }) }),
      el('td', { className: 'out' }, ['−' + formatVND(r.expense, { withUnit: false }), r.debt ? el('small', { text: `${t('nw.kindDebt')} ${formatVND(r.debt, { withUnit: false })}` }) : null]),
      el('td', { className: r.negative ? 'out' : '', text: formatVND(r.end, { withUnit: false }) }),
    ]));
  }
  table.appendChild(tb);
  body.appendChild(el('div', { className: 'sched-wrap' }, [table]));
  const neg = f.rows.filter((r) => r.negative).length;
  body.appendChild(el('div', { className: 'status-bar ' + (neg ? 'status--poor' : 'status--rich'), text: neg ? t('fc.negative', { n: neg }) : t('fc.ok', { n: months }) }));
  assume.textContent = t('fc.assume', { ri: formatVND(a.recurringIncome), oi: formatVND(a.avgOtherIncome), re: formatVND(a.recurringExpense), oe: formatVND(a.avgOtherExpense), n: a.basedOnMonths, start: formatVND(a.startBalance) });
}

function compact(v) {
  const n = Number(v);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + 'k';
  return String(n);
}

