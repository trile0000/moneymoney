// Tab Ngân sách (P1b): ngân sách theo danh mục, 50/30/20, quỹ khẩn cấp, mục tiêu tiết kiệm, insight.
import * as S from '../state.js';
import { $, el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { toLocalYM, toLocalYMD, isValidYM, isValidYMD, dateLabel } from '../utils/date.js';
import { t, monthLabelL } from '../i18n.js';
import { showToast } from '../ui/toast.js';
import { openFormSheet } from '../ui/formSheet.js';
import { confirmDialog } from '../ui/confirm.js';
import { fillCategorySelect } from '../ui/pickers.js';
import { spentByCategory, sumFor, avgPrevMonths, budgetStatus, dailyAllowance } from '../features/budgets.js';
import { compute503020 } from '../features/rule503020.js';
import { avgEssentialMonthly, efStatus, investWarning } from '../features/emergencyFund.js';
import { goalStatus } from '../features/goals.js';
import { buildInsights } from '../features/insights.js';
import { effectiveGroup } from '../features/categories.js';

let ctx = null;
let ym = toLocalYM();

export function initBudget(c) {
  ctx = c;
  const bm = $('#bMonth');
  bm.value = ym;
  bm.addEventListener('change', () => { ym = isValidYM(bm.value) ? bm.value : toLocalYM(); renderBudget(); });
  $('#addBudget').addEventListener('click', () => openBudgetForm());
  $('#addGoal').addEventListener('click', () => openGoalForm());
  $('#editRule').addEventListener('click', openRuleWeightsForm);
  $('#editEF').addEventListener('click', openEFForm);
}

export function renderBudget() {
  renderBudgetList($('#budgetList'), $('#budgetEmpty'), ym, { compact: false });
  render503020(ym);
  renderEF();
  renderGoals($('#goalList'), $('#goalEmpty'), { compact: false });
  renderInsights($('#insightListFull'), $('#insightEmptyFull'), ym, 8);
}

// ---------- Ngân sách ----------
function catIdsFor(budget) { return budget.categoryId ? S.getCategoryDescendants(budget.categoryId) : null; }
function budgetName(b) { if (!b.categoryId) return t('budget.total'); const c = S.getCategoryById(b.categoryId); return c ? `${c.icon} ${c.name}` : '?'; }

/** Trạng thái mọi ngân sách cho tháng ym (sắp: vượt → cảnh báo → ok) */
export function budgetStatuses(ymKey) {
  const month = S.getMonth(ymKey);
  const spent = spentByCategory(month.items);
  const idx = S.getMonthIndex();
  const today = toLocalYMD();
  return S.getBudgets().map((b) => {
    const ids = catIdsFor(b);
    const st = budgetStatus(b.amount, sumFor(spent, ids), avgPrevMonths(idx, ymKey, ids, 3));
    return { budget: b, name: budgetName(b), status: st, daily: dailyAllowance(st.remaining, today, ymKey) };
  }).sort((a, b) => b.status.pct - a.status.pct);
}

export function renderBudgetList(holder, emptyEl, ymKey, { compact = false, limit = 0 } = {}) {
  clear(holder);
  let rows = budgetStatuses(ymKey);
  if (limit) rows = rows.slice(0, limit);
  emptyEl.style.display = rows.length ? 'none' : 'flex';
  for (const r of rows) {
    const { budget: b, name, status: st } = r;
    const pct = Math.min(1, st.pct);
    const sub = [
      st.remaining >= 0 ? t('budget.remaining', { amount: formatVND(st.remaining) }) : t('budget.over', { amount: formatVND(-st.remaining) }),
      !compact && st.vsAvgPct !== null ? t('budget.vsAvg', { sign: st.vsAvgPct >= 0 ? '+' : '−', pct: Math.abs(Math.round(st.vsAvgPct * 100)) }) : null,
      !compact && r.daily && st.remaining > 0 ? t('budget.perDay', { amount: formatVND(r.daily.perDay), days: r.daily.daysLeft }) : null,
    ].filter(Boolean).join(' · ');
    holder.appendChild(el('div', {
      className: `bar-row budget-row lvl-${st.level}`, attrs: { role: 'listitem', tabindex: '0', 'aria-label': `${name}: ${formatVND(st.spent)} / ${formatVND(st.limit)}` },
      on: { click: () => openBudgetForm(b), keydown: (e) => { if (e.key === 'Enter') openBudgetForm(b); } },
    }, [
      el('div', { className: 'bar-label', text: name }),
      el('div', { className: 'bar-val', text: t('budget.spentOf', { spent: formatVND(st.spent, { withUnit: false }), limit: formatVND(st.limit) }) }),
      el('div', { className: 'bar-track' }, [el('div', { className: 'bar-fill', style: { width: `${Math.max(1, pct * 100)}%` } })]),
      el('div', { className: 'bar-sub', text: sub }),
    ]));
  }
}

export function openBudgetForm(budget = null) {
  const isNew = !budget;
  const values = budget ? { target: budget.categoryId || '__total__', amount: budget.amount, note: budget.note } : { target: '', amount: 0, note: '' };
  const api = openFormSheet({
    title: isNew ? t('budget.new') : t('budget.editTitle'),
    fields: [
      { key: 'target', label: t('budget.category'), type: 'select', options: [] },
      { key: 'amount', label: t('budget.amount'), type: 'amount', autofocus: true, placeholder: 'VD: 3tr' },
      { key: 'note', label: t('budget.note'), type: 'text' },
    ],
    values,
    onSave: async (v) => {
      if (!v.amount || v.amount <= 0) { const e = new Error(t('budget.errAmount')); e.focusKey = 'amount'; throw e; }
      const categoryId = v.target === '__total__' ? null : v.target;
      if (isNew) await S.addBudget({ categoryId, amount: v.amount, note: v.note });
      else await S.updateBudget(budget.id, { categoryId, amount: v.amount, note: v.note });
      showToast(t('budget.saved'));
      ctx.refresh('data');
    },
    deleteText: isNew ? null : t('common.delete'),
    onDelete: isNew ? null : async () => {
      const ok = await confirmDialog({ title: t('budget.deleteTitle', { name: budgetName(budget) }), body: '', okText: t('common.delete') });
      if (!ok) throw new Error('');
      await S.removeBudget(budget.id);
      showToast(t('budget.deleted'));
      ctx.refresh('data');
    },
  });
  const sel = api.ctl('target').el;
  fillCategorySelect(sel, { type: 'expense', value: values.target === '__total__' ? '' : values.target, includeArchived: false });
  sel.insertBefore(el('option', { value: '__total__', text: `Σ ${t('budget.total')}` }), sel.firstChild);
  if (values.target === '__total__') sel.value = '__total__';
  else if (!values.target) sel.selectedIndex = 1 < sel.options.length ? 1 : 0;
  return api;
}

// ---------- 50/30/20 ----------
function render503020(ymKey) {
  const holder = $('#ruleBars'), note = $('#ruleNote'), un = $('#ruleUnassigned');
  clear(holder); clear(un);
  const month = S.getMonth(ymKey);
  const cats = S.getCategories({ includeArchived: true });
  const r = compute503020(month.items, cats, S.getSettings().rule503020);
  const rows = [
    ['need', t('rule.need'), r.ratios.need, r.target.need, '#1565c0'],
    ['want', t('rule.want'), r.ratios.want, r.target.want, '#ef6c00'],
    ['save', t('rule.save'), r.ratios.save + (r.baseIsIncome ? r.leftoverRatio : 0), r.target.save, '#2e7d32'],
  ];
  if (r.spend.unassigned > 0) rows.push(['unassigned', t('rule.unassigned'), r.ratios.unassigned, null, '#9e9e9e']);
  for (const [key, label, actual, target, color] of rows) {
    const a = Math.round(actual * 100), tg = target === null ? null : Math.round(target * 100);
    const over = tg !== null && key !== 'save' && a > tg;
    const under = tg !== null && key === 'save' && a < tg;
    holder.appendChild(el('div', { className: 'bar-row' }, [
      el('div', { className: 'bar-label', text: label }),
      el('div', { className: 'bar-val' + (over || under ? ' warn' : ''), text: tg === null ? `${a}%` : t('rule.actualVsTarget', { actual: a, target: tg }) }),
      el('div', { className: 'bar-track' }, [
        el('div', { className: 'bar-fill', style: { width: `${Math.min(100, a)}%`, background: color } }),
        tg !== null ? el('div', { className: 'bar-target', style: { left: `${Math.min(100, tg)}%` }, attrs: { title: `${tg}%` } }) : null,
      ]),
      el('div', { className: 'bar-sub', text: formatVND(key === 'need' ? r.spend.need : key === 'want' ? r.spend.want : key === 'save' ? r.spend.save + (r.baseIsIncome ? r.leftover : 0) : r.spend.unassigned) + (key === 'save' && r.baseIsIncome && r.leftover > 0 ? ` (${t('rule.leftover').toLowerCase()} ${formatVND(r.leftover)})` : '') }),
    ]));
  }
  note.textContent = r.baseIsIncome ? t('rule.hint') : t('rule.noIncome');
  if (r.unassignedCategoryIds.length) {
    un.appendChild(el('div', { className: 'hint', text: t('rule.assignHint', { n: r.unassignedCategoryIds.length }) }));
    for (const id of r.unassignedCategoryIds.slice(0, 8)) {
      const c = S.getCategoryById(id);
      if (!c) continue;
      const sel = el('select', { attrs: { 'aria-label': `${t('cat.group')}: ${c.name}` }, on: { change: async (e) => { if (!e.target.value) return; await S.updateCategory(c.id, { group: e.target.value }); ctx.refresh('data'); } } }, [
        el('option', { value: '', text: t('cat.groupNone') }), el('option', { value: 'need', text: t('cat.groupNeed') }), el('option', { value: 'want', text: t('cat.groupWant') }), el('option', { value: 'save', text: t('cat.groupSave') }),
      ]);
      un.appendChild(el('div', { className: 'assign-row' }, [el('span', { text: `${c.icon} ${c.name}` }), sel]));
    }
  }
}

function openRuleWeightsForm() {
  const w = S.getSettings().rule503020;
  openFormSheet({
    title: t('rule.weightsTitle'),
    fields: [
      { key: 'need', label: t('rule.need'), type: 'number', attrs: { min: 0, max: 100 } },
      { key: 'want', label: t('rule.want'), type: 'number', attrs: { min: 0, max: 100 } },
      { key: 'save', label: t('rule.save'), type: 'number', attrs: { min: 0, max: 100 }, hint: t('rule.weightsHint') },
    ],
    values: { need: w.need, want: w.want, save: w.save },
    onSave: async (v) => {
      await S.updateSettings({ rule503020: { need: Math.max(0, Number(v.need) || 0), want: Math.max(0, Number(v.want) || 0), save: Math.max(0, Number(v.save) || 0) } }, { silent: true });
      showToast(t('rule.saved'));
      ctx.refresh('settings');
    },
  });
}

// ---------- Quỹ khẩn cấp ----------
export function efSummary() {
  const s = S.getSettings();
  const cats = S.getCategories({ includeArchived: true });
  const cur = toLocalYM();
  const avg = avgEssentialMonthly(S.getMonthIndex(), cats, cur, 6);
  const bal = S.getBalances();
  let fund = Number(s.emergencyExtra) || 0;
  for (const id of s.emergencyAccountIds || []) fund += Math.max(0, bal.get(id) || 0);
  const st = efStatus(fund, avg.avg, s.emergencyMonths || 6);
  const month = S.getMonth(cur);
  let investSpend = 0;
  for (const tx of month.items) if (tx.type === 'expense' && effectiveGroup(cats, tx.categoryId) === 'save') investSpend += tx.amount;
  const warnInvest = investWarning({ investSpend, income: month.income, coveredMonths: st.coveredMonths });
  return { avg, fund, st, warnInvest, investPct: month.income ? Math.round(investSpend / month.income * 100) : 0, configured: (s.emergencyAccountIds || []).length > 0 || (Number(s.emergencyExtra) || 0) > 0 };
}
function renderEF() {
  const body = $('#efBody');
  clear(body);
  const s = S.getSettings();
  const e = efSummary();
  body.appendChild(el('div', { className: 'hint', text: t('ef.avg', { amount: formatVND(e.avg.avg), note: e.avg.usedFallback ? t('ef.avgFallback') : (e.avg.months ? t('ef.avgNote', { n: e.avg.months }) : '') }) }));
  body.appendChild(el('div', { className: 'ef-line', text: t('ef.target', { months: s.emergencyMonths, amount: formatVND(e.st.target) }) }));
  body.appendChild(el('div', { className: 'ef-line', text: t('ef.current', { amount: formatVND(e.fund), months: e.st.coveredMonths.toFixed(1) }) }));
  body.appendChild(el('div', { className: 'bar-track ef-track' }, [el('div', { className: `bar-fill lvl-${e.st.level === 'ok' ? 'ok' : e.st.level === 'warn' ? 'warn' : 'over'}`, style: { width: `${Math.max(1, e.st.pct * 100)}%` } })]));
  if (!e.configured) body.appendChild(el('div', { className: 'note-box', text: t('ef.noAccounts') }));
  else if (e.st.level === 'ok') body.appendChild(el('div', { className: 'status-bar status--rich', text: t('ef.ok') }));
  else if (e.st.level === 'warn') body.appendChild(el('div', { className: 'status-bar status--neutral', text: t('ef.warn', { months: e.st.coveredMonths.toFixed(1), target: s.emergencyMonths }) }));
  else body.appendChild(el('div', { className: 'status-bar status--poor', text: t('ef.low') }));
  if (e.st.missing > 0 && e.configured) body.appendChild(el('div', { className: 'hint', text: t('ef.missing', { amount: formatVND(e.st.missing) }) }));
  if (e.warnInvest) body.appendChild(el('div', { className: 'note-box danger', text: t('ef.investWarn', { pct: e.investPct }) }));
}
function openEFForm() {
  const s = S.getSettings();
  const accs = S.getAccounts();
  const fields = [
    { key: 'months', label: t('ef.months'), type: 'select', options: [3, 6, 12].map((n) => ({ value: String(n), label: String(n) })) },
    ...accs.map((a) => ({ key: 'acc_' + a.id, label: `${a.icon} ${a.name} (${formatVND(S.getBalances().get(a.id) || 0)})`, type: 'checkbox' })),
    { key: 'extra', label: t('ef.extra'), type: 'amount' },
  ];
  const values = { months: String(s.emergencyMonths || 6), extra: s.emergencyExtra || 0 };
  for (const a of accs) values['acc_' + a.id] = (s.emergencyAccountIds || []).includes(a.id);
  openFormSheet({
    title: t('ef.formTitle'), fields, values,
    onSave: async (v) => {
      const ids = accs.filter((a) => v['acc_' + a.id]).map((a) => a.id);
      await S.updateSettings({ emergencyMonths: Number(v.months) || 6, emergencyAccountIds: ids, emergencyExtra: v.extra || 0 }, { silent: true });
      showToast(t('ef.saved'));
      ctx.refresh('settings');
    },
  });
  // nhãn nhóm ví
  const first = document.getElementById('fs_acc_' + (accs[0] || {}).id);
  if (first) first.closest('.fs-check').before(el('label', { text: t('ef.accounts') }));
}

// ---------- Mục tiêu ----------
export function renderGoals(holder, emptyEl, { compact = false, limit = 0 } = {}) {
  clear(holder);
  const today = toLocalYMD();
  let goals = S.getGoals().map((g) => ({ g, st: goalStatus(g, today) })).sort((a, b) => Number(a.st.done) - Number(b.st.done) || (a.g.deadline || '9999').localeCompare(b.g.deadline || '9999'));
  if (limit) goals = goals.slice(0, limit);
  emptyEl.style.display = goals.length ? 'none' : 'flex';
  for (const { g, st } of goals) {
    let sub;
    if (st.done) sub = t('goal.done');
    else if (st.overdue) sub = t('goal.overdue', { amount: formatVND(st.remaining) });
    else if (st.monthsLeft === null) sub = t('goal.perMonthNoDeadline', { amount: formatVND(st.remaining) });
    else if (st.monthsLeft === 0) sub = t('goal.dueNow', { amount: formatVND(st.remaining) });
    else sub = t('goal.perMonth', { amount: formatVND(st.perMonth), n: st.monthsLeft });
    holder.appendChild(el('div', {
      className: 'bar-row goal-row' + (st.done ? ' done' : ''), attrs: { role: 'listitem', tabindex: '0', 'aria-label': `${g.name}: ${formatVND(st.saved)} / ${formatVND(g.target)}` },
      on: { click: () => openGoalForm(g), keydown: (e) => { if (e.key === 'Enter') openGoalForm(g); } },
    }, [
      el('div', { className: 'bar-label', text: `${g.icon} ${g.name}${g.deadline ? ' · ' + dateLabel(g.deadline) : ''}` }),
      el('div', { className: 'bar-val', text: `${Math.round(st.pct * 100)}%` }),
      el('div', { className: 'bar-track' }, [el('div', { className: 'bar-fill lvl-ok', style: { width: `${Math.max(1, st.pct * 100)}%` } })]),
      el('div', { className: 'bar-sub goal-sub' }, [
        el('span', { text: `${t('goal.progress', { saved: formatVND(st.saved, { withUnit: false }), target: formatVND(g.target) })} · ${sub}` }),
        !compact && !st.done ? el('button', { className: 'btn ghost small', type: 'button', text: t('goal.contribute'), on: { click: (e) => { e.stopPropagation(); openContributionForm(g); } } }) : null,
      ]),
    ]));
  }
}

export function openGoalForm(goal = null) {
  const isNew = !goal;
  const values = goal ? { name: goal.name, icon: goal.icon, target: goal.target, deadline: goal.deadline || '' } : { icon: '🎯' };
  const api = openFormSheet({
    title: isNew ? t('goal.new') : t('goal.editTitle'),
    fields: [
      { type: 'row2', fields: [{ key: 'name', label: t('goal.name'), type: 'text', autofocus: true, placeholder: 'VD: Mua xe máy' }, { key: 'icon', label: t('goal.icon'), type: 'emoji' }] },
      { type: 'row2', fields: [{ key: 'target', label: t('goal.target'), type: 'amount', placeholder: 'VD: 60tr' }, { key: 'deadline', label: t('goal.deadline'), type: 'date' }] },
    ],
    values,
    onSave: async (v) => {
      if (!v.name.trim()) { const e = new Error(t('goal.errName')); e.focusKey = 'name'; throw e; }
      if (!v.target || v.target <= 0) { const e = new Error(t('goal.errTarget')); e.focusKey = 'target'; throw e; }
      const patch = { name: v.name.trim(), icon: v.icon || '🎯', target: v.target, deadline: isValidYMD(v.deadline) ? v.deadline : null };
      if (isNew) await S.addGoal(patch); else await S.updateGoal(goal.id, patch);
      showToast(t('goal.saved'));
      ctx.refresh('data');
    },
    deleteText: isNew ? null : t('common.delete'),
    onDelete: isNew ? null : async () => {
      const ok = await confirmDialog({ title: t('goal.deleteTitle', { name: goal.name }), body: t('goal.deleteBody'), okText: t('common.delete') });
      if (!ok) throw new Error('');
      await S.removeGoal(goal.id);
      showToast(t('goal.deleted'));
      ctx.refresh('data');
    },
    extraText: isNew ? null : t('goal.contribute'),
    onExtra: isNew ? null : (a) => { a.close(); openContributionForm(goal); },
  });
  if (!isNew && goal.contributions.length) {
    const box = el('div', { className: 'contrib-list' }, [el('div', { className: 'section-title', text: t('goal.history', { n: goal.contributions.length }) })]);
    for (const c of goal.contributions.slice().reverse().slice(0, 12)) {
      box.appendChild(el('div', { className: 'contrib-row' }, [
        el('span', { text: `${c.date ? dateLabel(c.date) + ' · ' : ''}${formatVND(c.amount)}${c.note ? ' · ' + c.note : ''}` }),
        el('button', { className: 'btn danger-text', type: 'button', text: '✕', attrs: { 'aria-label': t('goal.removeContrib') }, on: { click: async () => { await S.removeContribution(goal.id, c.id); showToast(t('goal.contribRemoved')); api.close(); ctx.refresh('data'); } } }),
      ]));
    }
    api.root.appendChild(box);
  }
  return api;
}

function openContributionForm(goal) {
  openFormSheet({
    title: t('goal.contribTitle', { name: goal.name }),
    fields: [
      { type: 'row2', fields: [{ key: 'amount', label: t('goal.contribAmount'), type: 'amount', autofocus: true, placeholder: 'VD: 2tr' }, { key: 'date', label: t('goal.contribDate'), type: 'date' }] },
      { key: 'note', label: t('goal.contribNote'), type: 'text' },
    ],
    values: { date: toLocalYMD() },
    onSave: async (v) => {
      if (!v.amount || v.amount <= 0) { const e = new Error(t('goal.contribErr')); e.focusKey = 'amount'; throw e; }
      await S.addContribution(goal.id, { amount: v.amount, date: isValidYMD(v.date) ? v.date : toLocalYMD(), note: v.note });
      showToast(t('goal.contribSaved', { amount: formatVND(v.amount) }));
      ctx.refresh('data');
    },
  });
}

// ---------- Insight ----------
export function renderInsights(holder, emptyEl, ymKey, limit = 4) {
  clear(holder);
  const list = buildInsights({ monthIndex: S.getMonthIndex(), ym: ymKey, categories: S.getCategories({ includeArchived: true }), rules: S.getRules() }).slice(0, limit);
  emptyEl.style.display = list.length ? 'none' : 'flex';
  for (const ins of list) {
    const vars = { ...ins.vars };
    for (const k of ['amount', 'avg']) if (typeof vars[k] === 'number') vars[k] = formatVND(vars[k]);
    if (vars.note) vars.note = ' — ' + vars.note; else vars.note = '';
    const item = el('div', { className: `insight lvl-${ins.level}` }, [el('div', { text: t(ins.key, vars) })]);
    if (ins.key === 'insight.top5') {
      const ul = el('ul', { className: 'insight-ul' });
      for (const it of ins.vars.items) ul.appendChild(el('li', { text: `${formatVND(it.amount)} · ${it.category}${it.note ? ' — ' + it.note : ''} (${dateLabel(it.date)})` }));
      item.appendChild(ul);
    }
    holder.appendChild(item);
  }
}

/** Cảnh báo ngân sách 80/100% cho tháng hiện tại (dùng ở trang chủ) */
export function budgetAlerts() {
  return budgetStatuses(toLocalYM()).filter((r) => r.status.level !== 'ok').map((r) => (r.status.level === 'over'
    ? { level: 'over', text: t('budget.over100', { name: r.name, amount: formatVND(-r.status.remaining) }) }
    : { level: 'warn', text: t('budget.warn80', { name: r.name, pct: Math.round(r.status.pct * 100) }) }));
}

export { monthLabelL };
