// Module C (P2): phân bổ đầu tư theo lớp tài sản — hồ sơ rủi ro, mục tiêu vs hiện tại, điều kiện tiên quyết, kế hoạch DCA.
// KHÔNG gợi ý mã cụ thể; mọi màn hình đều kèm disclaimer.
import * as S from '../state.js';
import { $, el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { toLocalYM } from '../utils/date.js';
import { t } from '../i18n.js';
import { showToast } from '../ui/toast.js';
import { openFormSheet } from '../ui/formSheet.js';
import { QUESTIONS, ASSET_CLASSES, riskScore, profileOf, targetAllocation, currentAllocation, compareAllocation, prerequisites, dcaPlan, suggestMonthly, DEFAULT_RETURNS } from '../features/allocation.js';
import { savingsRate } from '../features/health.js';
import { netWorthNow, debtOverview } from './wealth.js';
import { efSummary } from './budget.js';

let ctx = null;

export function initInvest(c) {
  ctx = c;
  $('#invQuiz').addEventListener('click', openQuiz);
}

/** Tổng hợp dùng chung cho tab Ngân sách và thẻ trang chủ */
export function investSummary() {
  const inv = S.getSettings().invest || {};
  const profile = inv.profile || null;
  const horizon = (inv.answers || {}).horizon || 'y5_10';
  const target = profile ? targetAllocation(profile, { horizon }) : null;
  const nw = netWorthNow();
  const current = currentAllocation(nw.items);
  const cmp = target ? compareAllocation(target, current) : null;
  const ef = efSummary();
  const debts = debtOverview();
  const pre = prerequisites({ efCoveredMonths: ef.st.coveredMonths, efTargetMonths: S.getSettings().emergencyMonths || 6, highRateDebts: debts.rows.filter((r) => !r.st.done).map((r) => ({ name: r.d.name, rate: r.d.rate, balance: r.st.balance })) });
  const sr = savingsRate(S.getMonthIndex(), toLocalYM(), 3);
  const avgIncome = sr.months ? sr.income / sr.months : 0, avgExpense = sr.months ? sr.expense / sr.months : 0;
  const suggest = suggestMonthly({ avgIncome, avgExpense, debtPayments: debts.monthly, efMissing: ef.st.missing || 0, efMonthsToFill: 12 });
  const monthly = inv.monthly !== null && inv.monthly !== undefined ? Number(inv.monthly) : suggest.investable;
  const returns = { ...DEFAULT_RETURNS, ...(inv.returns || {}) };
  const years = Number(inv.years) || 10;
  const plan = target ? dcaPlan({ monthly, years, target, returns, startByClass: current.byClass }) : null;
  return { inv, profile, score: inv.score, horizon, target, current, cmp, pre, suggest, monthly, returns, years, plan, hasData: sr.months > 0 };
}

export function renderInvest() {
  const s = investSummary();
  renderProfile(s); renderPrereq(s); renderAlloc(s); renderPlan(s);
}

function renderProfile(s) {
  const box = $('#invProfile'); clear(box);
  if (!s.profile) {
    box.appendChild(el('div', { className: 'empty-state', style: { display: 'flex' }, text: t('inv.noProfile') }));
    return;
  }
  const wrap = el('div', { className: 'inv-profile' });
  wrap.appendChild(el('div', { className: 'score-wrap' }, [
    el('div', { className: 'score-ring inv-ring', attrs: { role: 'img', 'aria-label': `${t('inv.score')}: ${s.score}/100` } }, [el('div', { className: 'score-num', text: String(s.score) })]),
    el('div', {}, [el('div', { className: 'score-tier', text: t('inv.profileName.' + s.profile) }), el('div', { className: 'hint', text: t('inv.profileDesc.' + s.profile) }), el('div', { className: 'hint', text: `${t('inv.horizonLabel')}: ${t('inv.q.horizon.' + s.horizon)}` })]),
  ]));
  wrap.querySelector('.inv-ring').style.setProperty('--pct', String(s.score));
  wrap.appendChild(el('div', { className: 'row-actions' }, [el('button', { className: 'btn ghost small', type: 'button', text: t('inv.redo'), on: { click: openQuiz } })]));
  box.appendChild(wrap);
}

function renderPrereq(s) {
  const box = $('#invPrereq'); clear(box);
  if (!s.pre.items.length) { box.appendChild(el('div', { className: 'status-bar status--rich', text: t('inv.preOk') })); return; }
  for (const it of s.pre.items) box.appendChild(el('div', { className: 'note-box' + (it.level === 'block' ? ' danger' : ''), text: t(`inv.pre.${it.key}.${it.level}`, it.vars) }));
}

function classLabel(cls) { return `${t('inv.cls.' + cls + '.icon')} ${t('inv.cls.' + cls)}`; }

function renderAlloc(s) {
  const box = $('#invAlloc'); clear(box);
  box.appendChild(el('div', { className: 'section-title', text: t('inv.allocTitle') }));
  if (!s.current.total) box.appendChild(el('p', { className: 'hint', text: t('inv.noAssets') }));
  else box.appendChild(el('p', { className: 'hint', text: t('inv.allocHint', { total: formatVND(s.current.total) }) }));
  const bars = el('div', { className: 'bars' });
  const rows = s.cmp ? s.cmp.rows : ASSET_CLASSES.map((cls) => ({ cls, currentPct: s.current.pct[cls], currentVND: Math.round(s.current.byClass[cls]), targetPct: null, action: 'ok', deltaVND: 0 }));
  for (const r of rows) {
    if (!s.cmp && r.currentVND <= 0) continue;
    const val = r.targetPct === null ? `${Math.round(r.currentPct)}%` : t('inv.vs', { cur: Math.round(r.currentPct), target: r.targetPct });
    const sub = r.targetPct === null ? formatVND(r.currentVND) : (r.action === 'add' ? t('inv.actAdd', { amount: formatVND(Math.abs(r.deltaVND)) }) : r.action === 'reduce' ? t('inv.actReduce', { amount: formatVND(Math.abs(r.deltaVND)) }) : t('inv.actOk')) + ` · ${formatVND(r.currentVND)}`;
    bars.appendChild(el('div', { className: `bar-row inv-row ${r.action === 'ok' ? 'lvl-ok' : 'lvl-warn'}` }, [
      el('div', { className: 'bar-label', text: classLabel(r.cls) }),
      el('div', { className: 'bar-val', text: val }),
      el('div', { className: 'bar-track' }, [
        el('div', { className: 'bar-fill', style: { width: `${Math.max(1, Math.min(100, r.currentPct))}%` } }),
        r.targetPct !== null ? el('div', { className: 'bar-target', style: { left: `${Math.min(100, r.targetPct)}%` }, attrs: { title: `${t('inv.target')} ${r.targetPct}%` } }) : null,
      ]),
      el('div', { className: 'bar-sub', text: sub }),
    ]));
  }
  box.appendChild(bars);
  if (s.cmp) box.appendChild(el('p', { className: 'hint', text: s.cmp.needsRebalance ? t('inv.rebalanceHint') : t('inv.balancedHint') }));
  box.appendChild(el('p', { className: 'hint', text: t('inv.classHint') }));
}

function renderPlan(s) {
  const box = $('#invPlan'); clear(box);
  box.appendChild(el('div', { className: 'card-head' }, [el('div', { className: 'section-title', text: t('inv.planTitle') }), el('button', { className: 'btn ghost small', type: 'button', text: t('inv.planEdit'), on: { click: () => openPlanForm(s) } })]));
  if (!s.profile) { box.appendChild(el('p', { className: 'hint', text: t('inv.planNeedProfile') })); return; }
  box.appendChild(el('div', { className: 'ef-line', text: t('inv.suggestLine', { surplus: formatVND(s.suggest.surplus), ef: formatVND(s.suggest.efPart), inv: formatVND(s.suggest.investable) }) }));
  box.appendChild(el('div', { className: 'ef-line', text: t('inv.planLine', { monthly: formatVND(s.monthly), years: s.years }) }));
  const table = el('table', { className: 'sched inv-table' });
  table.appendChild(el('thead', {}, [el('tr', {}, [t('inv.colClass'), t('inv.colPct'), t('inv.colMonthly'), t('inv.colReturn'), t('inv.colEnd')].map((h) => el('th', { text: h })))]));
  const tb = el('tbody');
  for (const cls of ASSET_CLASSES) {
    if (!s.target[cls] && !s.plan.projectedByClass[cls]) continue;
    tb.appendChild(el('tr', {}, [el('td', { text: classLabel(cls) }), el('td', { text: `${s.target[cls]}%` }), el('td', { text: formatVND(s.plan.perClass[cls], { withUnit: false }) }), el('td', { text: `${s.returns[cls]}%` }), el('td', { text: formatVND(s.plan.projectedByClass[cls], { withUnit: false }) })]));
  }
  table.appendChild(tb);
  box.appendChild(el('div', { className: 'sched-wrap' }, [table]));
  box.appendChild(el('div', { className: 'status-bar status--neutral', text: t('inv.projection', { years: s.years, contributed: formatVND(s.plan.contributed), projected: formatVND(s.plan.projected), start: formatVND(s.current.total) }) }));
  const yl = el('div', { className: 'hint', text: t('inv.yearly') + ': ' + s.plan.yearly.filter((y, i, a) => a.length <= 6 || i % Math.ceil(a.length / 6) === 0 || i === a.length - 1).map((y) => `${t('inv.yearN', { n: y.year })} ${formatVND(y.value, { withUnit: false })}`).join(' · ') });
  box.appendChild(yl);
  box.appendChild(el('p', { className: 'hint', text: t('inv.planDisclaimer') }));
}

export function renderHomeInvest() {
  const box = $('#homeInvest'); if (!box) return; clear(box);
  const s = investSummary();
  if (!s.profile) {
    box.appendChild(el('div', { className: 'hint', text: t('inv.homeCta') }));
    box.appendChild(el('button', { className: 'btn primary small', type: 'button', text: t('inv.quiz'), on: { click: openQuiz } }));
    return;
  }
  box.appendChild(el('div', { className: 'ef-line' }, [el('strong', { text: t('inv.profileName.' + s.profile) }), document.createTextNode(` · ${t('inv.score')} ${s.score}/100`)]));
  const blocks = s.pre.items.filter((i) => i.level === 'block');
  if (blocks.length) box.appendChild(el('div', { className: 'note-box danger', text: t(`inv.pre.${blocks[0].key}.block`, blocks[0].vars) }));
  else {
    const top = s.cmp.rows.filter((r) => r.action !== 'ok').sort((a, b) => Math.abs(b.deltaVND) - Math.abs(a.deltaVND))[0];
    box.appendChild(el('div', { className: 'ef-line', text: top ? `${classLabel(top.cls)}: ${top.action === 'add' ? t('inv.actAdd', { amount: formatVND(Math.abs(top.deltaVND)) }) : t('inv.actReduce', { amount: formatVND(Math.abs(top.deltaVND)) })}` : t('inv.balancedHint') }));
    box.appendChild(el('div', { className: 'ef-line', text: t('inv.planLine', { monthly: formatVND(s.monthly), years: s.years }) }));
  }
}

// ---------- Bài hồ sơ rủi ro ----------
function openQuiz() {
  const inv = S.getSettings().invest || {};
  const fields = QUESTIONS.map((q) => ({ key: q.key, label: t('inv.q.' + q.key), type: 'select', options: [{ value: '', label: '—' }, ...q.options.map((o) => ({ value: o[0], label: t(`inv.q.${q.key}.${o[0]}`) }))] }));
  fields.push({ key: 'accept', label: t('inv.accept'), type: 'checkbox' });
  const values = { ...(inv.answers || {}), accept: !!inv.acceptedAt };
  openFormSheet({
    title: t('inv.quizTitle'),
    fields, values,
    saveText: t('inv.quizSave'),
    onSave: async (v) => {
      for (const q of QUESTIONS) if (!v[q.key]) { const e = new Error(t('inv.errAnswer')); e.focusKey = q.key; throw e; }
      if (!v.accept) { const e = new Error(t('inv.errAccept')); e.focusKey = 'accept'; throw e; }
      const answers = {}; for (const q of QUESTIONS) answers[q.key] = v[q.key];
      const score = riskScore(answers);
      await S.updateSettings({ invest: { ...inv, answers, score, profile: profileOf(score), acceptedAt: inv.acceptedAt || Date.now() } }, { silent: true });
      showToast(t('inv.quizDone', { profile: t('inv.profileName.' + profileOf(score)) }));
      ctx.refresh('settings');
    },
  });
}

// ---------- Kế hoạch DCA ----------
function openPlanForm(s) {
  const inv = S.getSettings().invest || {};
  openFormSheet({
    title: t('inv.planTitle'),
    fields: [
      { type: 'row2', fields: [
        { key: 'monthly', label: t('inv.monthly'), type: 'amount', autofocus: true, hint: t('inv.monthlyHint', { amount: formatVND(s.suggest.investable) }) },
        { key: 'years', label: t('inv.years'), type: 'number', attrs: { min: 1, max: 40 } },
      ] },
      ...ASSET_CLASSES.map((cls) => ({ key: 'r_' + cls, label: t('inv.returnFor', { cls: t('inv.cls.' + cls) }), type: 'number', attrs: { min: -20, max: 40, step: '0.5' } })),
    ],
    values: { monthly: s.monthly, years: s.years, ...Object.fromEntries(ASSET_CLASSES.map((c) => ['r_' + c, s.returns[c]])) },
    onSave: async (v) => {
      const returns = {}; for (const c of ASSET_CLASSES) returns[c] = Number(v['r_' + c]) || 0;
      await S.updateSettings({ invest: { ...inv, monthly: v.monthly || 0, years: Math.min(40, Math.max(1, Number(v.years) || 10)), returns } }, { silent: true });
      showToast(t('settings.saved'));
      ctx.refresh('settings');
    },
    extraText: t('inv.resetReturns'),
    onExtra: async (a) => { await S.updateSettings({ invest: { ...inv, monthly: null, returns: null } }, { silent: true }); a.close(); showToast(t('settings.saved')); ctx.refresh('settings'); },
  });
}
