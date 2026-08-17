// Tab Cài đặt: giao diện/ngôn ngữ, ví, danh mục, định kỳ, tier, dữ liệu.
import * as S from '../state.js';
import { $, el, clear } from '../utils/dom.js';
import { formatVND } from '../utils/money.js';
import { toLocalYMD, dateLabel, isValidYMD } from '../utils/date.js';
import { t, monthLabelL } from '../i18n.js';
import { openFormSheet } from '../ui/formSheet.js';
import { confirmDialog } from '../ui/confirm.js';
import { showToast } from '../ui/toast.js';
import { bindAmountInput } from '../ui/amountInput.js';
import { fillAccountSelect, fillCategorySelect, fillParentSelect, parseTags, tagsToString } from '../ui/pickers.js';
import { ACCOUNT_ICONS, ACCOUNT_TYPES } from '../features/accounts.js';
import { estimateUsage } from '../storage.js';
import { APP_VERSION } from '../version.js';

let ctx = null;
const tierCtl = {};

export function initSettings(c) {
  ctx = c;
  $('#addAccount').addEventListener('click', () => openAccountForm());
  $('#addCategory').addEventListener('click', () => openCategoryForm());
  $('#addRule').addEventListener('click', () => openRuleForm());
  $('#stTheme').addEventListener('change', async (e) => { await S.updateSettings({ theme: e.target.value }, { silent: true }); ctx.applyTheme(); });
  $('#stLocale').addEventListener('change', async (e) => { await S.updateSettings({ locale: e.target.value }, { silent: true }); ctx.applyLocale(); });
  $('#stDefaultAccount').addEventListener('change', async (e) => { await S.updateSettings({ defaultAccountId: e.target.value }, { silent: true }); showToast(t('settings.saved')); });
  $('#saveTier').addEventListener('click', saveTier);
  for (const k of ['stTh2', 'stTh3', 'stTh4']) { const h = el('div', { className: 'hint' }); $('#' + k).after(h); tierCtl[k] = bindAmountInput($('#' + k), h); }
  $('#appVersion').textContent = 'v' + APP_VERSION;
}

export function renderSettings(params = {}) {
  const s = S.getSettings();
  $('#stTheme').value = s.theme || 'system';
  $('#stLocale').value = s.locale || 'vi';
  renderAccountList();
  renderCategoryTree();
  renderRuleList();
  fillAccountSelect($('#stDefaultAccount'), { value: s.defaultAccountId });
  // tier
  tierCtl.stTh2.setValue(s.thresholds.t2); tierCtl.stTh3.setValue(s.thresholds.t3); tierCtl.stTh4.setValue(s.thresholds.t4);
  $('#stBest').value = s.bestTier ? `Tier ${s.bestTier}${s.bestTierMonth ? ' (' + monthLabelL(s.bestTierMonth) + ')' : ''}` : t('settings.bestNone');
  for (let i = 0; i <= 4; i++) $('#msgT' + i).value = s.messages['t' + i] || '';
  $('#storageInfo').textContent = t('settings.storage', { kb: (estimateUsage() / 1024).toFixed(0), n: S.getVisible().length, a: S.getAccounts().length, c: S.getCategories().length, v: s.schemaVersion });
  if (params.section) {
    const sec = document.getElementById('sec-' + params.section);
    if (sec) setTimeout(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
}

async function saveTier() {
  const t2 = Math.max(0, tierCtl.stTh2.getValue() || 0);
  const t3 = Math.max(t2, tierCtl.stTh3.getValue() || 0);
  const t4 = Math.max(t3, tierCtl.stTh4.getValue() || 0);
  await S.updateSettings({ thresholds: { t2, t3, t4 }, messages: Object.fromEntries([0, 1, 2, 3, 4].map((i) => ['t' + i, $('#msgT' + i).value])) }, { silent: true });
  showToast(t('settings.saved'));
  ctx.refresh('settings');
}

// ---------- Ví ----------
function renderAccountList() {
  const holder = $('#stAccountList');
  clear(holder);
  const bal = S.getBalances();
  for (const a of S.getAccounts({ includeArchived: true })) {
    const b = bal.get(a.id) || 0;
    const row = el('button', {
      className: 'mini-row' + (a.archived ? ' archived' : ''), type: 'button', attrs: { role: 'listitem' },
      on: { click: () => openAccountForm(a) },
    }, [
      el('div', { className: 'mini-ic', text: a.icon || ACCOUNT_ICONS[a.type], style: { background: a.color + '33' } }),
      el('div', { className: 'mini-main' }, [
        el('div', { className: 'mini-title' }, [document.createTextNode(a.name), a.archived ? el('span', { className: 'badge-lite', text: t('acc.archivedBadge') }) : null]),
        el('div', { className: 'mini-sub', text: `${t('acc.type' + cap(a.type))} · ${t('acc.txCount', { n: S.countTxByAccount(a.id) })}` }),
      ]),
      el('div', { className: 'mini-right ' + (b < 0 ? 'out' : ''), text: formatVND(b) }),
    ]);
    holder.appendChild(row);
  }
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export function openAccountForm(acc = null) {
  const isNew = !acc;
  const values = acc ? { name: acc.name, type: acc.type, openingBalance: acc.openingBalance, color: acc.color, icon: acc.icon, archived: acc.archived, limit: acc.credit ? acc.credit.limit : 0, statementDay: acc.credit ? acc.credit.statementDay : 20, dueDay: acc.credit ? acc.credit.dueDay : 5 } : { type: 'cash', color: '#2e7d32', icon: '💵', statementDay: 20, dueDay: 5 };
  const api = openFormSheet({
    title: isNew ? t('acc.new') : t('acc.edit'),
    fields: [
      { key: 'name', label: t('acc.name'), type: 'text', autofocus: true, placeholder: 'VD: Vietcombank, Momo' },
      { type: 'row2', fields: [
        { key: 'type', label: t('acc.type'), type: 'select', options: ACCOUNT_TYPES.map((v) => ({ value: v, label: `${ACCOUNT_ICONS[v]} ${t('acc.type' + cap(v))}` })), onChange: (a) => { const tp = a.getValues().type; const isCredit = tp === 'credit'; a.show('limit', isCredit); a.show('statementDay', isCredit); a.show('dueDay', isCredit); if (!acc) a.setValue('icon', ACCOUNT_ICONS[tp]); } },
        { key: 'icon', label: t('acc.icon'), type: 'emoji' },
      ] },
      { type: 'row2', fields: [
        { key: 'openingBalance', label: t('acc.opening'), type: 'amount', placeholder: '0' },
        { key: 'color', label: t('acc.color'), type: 'color' },
      ] },
      { key: 'limit', label: t('acc.limit'), type: 'amount', hidden: values.type !== 'credit' },
      { type: 'row2', fields: [
        { key: 'statementDay', label: t('acc.statementDay'), type: 'number', attrs: { min: 1, max: 31 }, hidden: values.type !== 'credit' },
        { key: 'dueDay', label: t('acc.dueDay'), type: 'number', attrs: { min: 1, max: 31 }, hidden: values.type !== 'credit' },
      ] },
      ...(isNew ? [] : [{ key: 'archived', label: t('acc.archived'), type: 'checkbox' }]),
    ],
    values,
    onSave: async (v) => {
      if (!v.name.trim()) { const e = new Error(t('acc.errName')); e.focusKey = 'name'; throw e; }
      if (!isNew && v.archived && S.getAccounts().filter((x) => x.id !== acc.id).length === 0) throw new Error(t('acc.errLast'));
      const patch = { name: v.name.trim(), type: v.type, openingBalance: v.openingBalance || 0, color: v.color, icon: v.icon || ACCOUNT_ICONS[v.type], archived: !!v.archived, credit: v.type === 'credit' ? { limit: v.limit || 0, statementDay: v.statementDay, dueDay: v.dueDay } : undefined };
      if (isNew) await S.addAccount(patch); else await S.updateAccount(acc.id, patch);
      showToast(t('acc.saved'));
      ctx.refresh('data');
    },
    deleteText: isNew ? null : t('common.delete'),
    onDelete: isNew ? null : async () => { await deleteAccountFlow(acc); },
  });
  return api;
}

async function deleteAccountFlow(acc) {
  const used = S.countTxByAccount(acc.id);
  if (!used) {
    if (S.getAccounts().filter((x) => x.id !== acc.id).length === 0) throw new Error(t('acc.errLast'));
    const ok = await confirmDialog({ title: t('acc.deleteTitle', { name: acc.name }), body: t('acc.deleteBody'), okText: t('common.delete') });
    if (!ok) throw new Error('');
    await S.removeAccount(acc.id);
    showToast(t('acc.deleted'));
    ctx.refresh('data');
    return;
  }
  const others = S.getAccounts().filter((x) => x.id !== acc.id);
  const sel = el('select', { id: 'accMoveTo' });
  sel.appendChild(el('option', { value: '', text: t('acc.archiveOnly') }));
  for (const o of others) sel.appendChild(el('option', { value: o.id, text: `${o.icon} ${o.name}` }));
  const body = [el('p', { text: t('acc.deleteBodyUsed', { n: used }), style: { margin: '0 0 8px' } }), el('label', { text: t('acc.moveTo'), attrs: { for: 'accMoveTo' } }), sel];
  const ok = await confirmDialog({ title: t('acc.deleteTitle', { name: acc.name }), body, okText: t('common.ok'), okClass: 'primary' });
  if (!ok) throw new Error('');
  if (sel.value) { await S.removeAccount(acc.id, { moveTo: sel.value }); showToast(t('acc.deleted')); }
  else { await S.updateAccount(acc.id, { archived: true }); showToast(t('acc.archivedOk')); }
  ctx.refresh('data');
}

// ---------- Danh mục ----------
function renderCategoryTree() {
  const holder = $('#stCategoryTree');
  clear(holder);
  const kindLabel = (k) => t(k === 'income' ? 'cat.kindIncome' : k === 'both' ? 'cat.kindBoth' : 'cat.kindExpense');
  const groupLabel = (g) => (g ? t('cat.group' + cap(g)) : '');
  for (const root of S.getCategoryTree({ includeArchived: true })) {
    holder.appendChild(catRow(root, false, kindLabel, groupLabel));
    for (const c of root.children) holder.appendChild(catRow(c, true, kindLabel, groupLabel));
  }
}
function catRow(c, child, kindLabel, groupLabel) {
  const n = S.countTxByCategory(c.id);
  const sub = [kindLabel(c.kind), groupLabel(c.group), t('cat.txCount', { n })].filter(Boolean).join(' · ');
  const actions = el('div', { className: 'mini-actions' }, [
    !child ? el('button', { className: 'btn ghost small', type: 'button', text: t('cat.addChild'), attrs: { 'aria-label': `${t('cat.addChild')} ${c.name}` }, on: { click: (e) => { e.stopPropagation(); openCategoryForm(null, { parentId: c.id, kind: c.kind }); } } }) : null,
  ]);
  return el('div', {
    className: 'mini-row' + (child ? ' child' : '') + (c.archived ? ' archived' : ''), attrs: { role: 'listitem', tabindex: '0' },
    on: { click: () => openCategoryForm(c), keydown: (e) => { if (e.key === 'Enter') openCategoryForm(c); } },
  }, [
    el('div', { className: 'mini-ic', text: c.icon, style: { background: (c.color || '#999') + '33' } }),
    el('div', { className: 'mini-main' }, [
      el('div', { className: 'mini-title' }, [document.createTextNode(c.name), c.archived ? el('span', { className: 'badge-lite', text: t('acc.archivedBadge') }) : null]),
      el('div', { className: 'mini-sub', text: sub }),
    ]),
    actions,
  ]);
}

/** Mở form danh mục. Trả Promise<category|null> (dùng khi tạo mới từ ô chọn danh mục) */
export function openCategoryForm(cat = null, preset = {}) {
  const isNew = !cat;
  return new Promise((resolve) => {
    let result = null;
    const values = cat ? { name: cat.name, parentId: cat.parentId || '', kind: cat.kind, icon: cat.icon, color: cat.color, group: cat.group || '', archived: cat.archived } : { parentId: preset.parentId || '', kind: preset.kind || 'expense', icon: '📦', color: '#607d8b', group: '' };
    const parentSel = { key: 'parentId', label: t('cat.parent'), type: 'select', options: [] };
    const api = openFormSheet({
      title: isNew ? t('cat.new') : t('cat.edit'),
      fields: [
        { key: 'name', label: t('cat.name'), type: 'text', autofocus: true },
        { type: 'row2', fields: [parentSel, { key: 'kind', label: t('cat.kind'), type: 'select', options: [{ value: 'expense', label: t('cat.kindExpense') }, { value: 'income', label: t('cat.kindIncome') }, { value: 'both', label: t('cat.kindBoth') }] }] },
        { type: 'row2', fields: [{ key: 'icon', label: t('cat.icon'), type: 'emoji' }, { key: 'color', label: t('cat.color'), type: 'color' }] },
        { key: 'group', label: t('cat.group'), type: 'select', options: [{ value: '', label: t('cat.groupNone') }, { value: 'need', label: t('cat.groupNeed') }, { value: 'want', label: t('cat.groupWant') }, { value: 'save', label: t('cat.groupSave') }] },
        ...(isNew ? [] : [{ key: 'archived', label: t('cat.archived'), type: 'checkbox' }]),
      ],
      values,
      onSave: async (v) => {
        if (!v.name.trim()) { const e = new Error(t('cat.errName')); e.focusKey = 'name'; throw e; }
        // chỉ 2 cấp: cha phải là cấp 1 và không phải chính nó; nếu chính nó đang có con thì không thể thành con
        const parentId = v.parentId || null;
        if (parentId) {
          const p = S.getCategoryById(parentId);
          if (!p || p.parentId || (cat && parentId === cat.id) || (cat && S.getCategories({ includeArchived: true }).some((x) => x.parentId === cat.id))) throw new Error(t('cat.errParentSelf'));
        }
        const patch = { name: v.name.trim(), parentId, kind: v.kind, icon: v.icon || '📦', color: v.color, group: v.group || null, archived: !!v.archived };
        result = isNew ? await S.addCategory(patch) : await S.updateCategory(cat.id, patch);
        showToast(t('cat.saved'));
        ctx.refresh('data');
      },
      deleteText: isNew ? null : t('common.delete'),
      onDelete: isNew ? null : async () => { await deleteCategoryFlow(cat); },
    });
    // điền select cha sau khi dựng (cần loại trừ chính nó)
    fillParentSelect(api.ctl('parentId').el, { value: values.parentId, excludeId: cat ? cat.id : null });
    const origClose = api.close;
    // resolve khi sheet đóng
    const modal = document.getElementById('formSheet');
    const obs = new MutationObserver(() => { if (!modal.classList.contains('open')) { obs.disconnect(); resolve(result); } });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
    void origClose;
  });
}

async function deleteCategoryFlow(cat) {
  const used = S.countTxByCategory(cat.id);
  if (!used) {
    const ok = await confirmDialog({ title: t('cat.deleteTitle', { name: cat.name }), body: t('cat.deleteBody'), okText: t('common.delete') });
    if (!ok) throw new Error('');
    await S.removeCategory(cat.id);
    showToast(t('cat.deleted'));
    ctx.refresh('data');
    return;
  }
  const sel = el('select', { id: 'catMergeInto' });
  fillCategorySelect(sel, { type: 'all', allowAll: false, excludeId: cat.id, includeArchived: false });
  sel.insertBefore(el('option', { value: '', text: t('cat.archiveOnly') }), sel.firstChild);
  sel.value = '';
  const body = [el('p', { text: t('cat.deleteBodyUsed', { n: used }), style: { margin: '0 0 8px' } }), el('label', { text: t('cat.mergeInto'), attrs: { for: 'catMergeInto' } }), sel];
  const ok = await confirmDialog({ title: t('cat.deleteTitle', { name: cat.name }), body, okText: t('common.ok'), okClass: 'primary' });
  if (!ok) throw new Error('');
  if (sel.value) { const n = await S.mergeCategories(cat.id, sel.value); showToast(t('cat.merged', { n })); }
  else { await S.updateCategory(cat.id, { archived: true }); showToast(t('acc.archivedOk')); }
  ctx.refresh('data');
}

// ---------- Định kỳ ----------
function renderRuleList() {
  const holder = $('#stRuleList');
  clear(holder);
  const today = toLocalYMD();
  for (const r of S.getRules()) {
    const next = S.ruleNext(r, today);
    const cat = r.template.categoryId ? S.getCategoryById(r.template.categoryId) : null;
    const acc = S.getAccountById(r.template.accountId);
    const freq = t(r.interval > 1 ? `recur.freq.${r.freq}.n` : `recur.freq.${r.freq}`, { n: r.interval });
    const sub = [freq, r.freq === 'monthly' || r.freq === 'yearly' ? `${t('recur.dayOfMonth').split(' ')[0]} ${r.byMonthDay}` : null, acc ? acc.name : null, next ? t('recur.next', { date: dateLabel(next) }) : t('recur.noNext')].filter(Boolean).join(' · ');
    const toggle = el('label', { className: 'switch', attrs: { title: t('recur.enabled') }, on: { click: (e) => e.stopPropagation(), keydown: (e) => e.stopPropagation() } }, [
      el('input', { type: 'checkbox', checked: r.enabled, attrs: { 'aria-label': `${t('recur.enabled')}: ${r.name}` }, on: { click: (e) => e.stopPropagation(), change: async (e) => { await S.updateRule(r.id, { enabled: e.target.checked }); ctx.refresh('data'); } } }),
      el('span'),
    ]);
    const row = el('div', {
      className: 'mini-row' + (r.enabled ? '' : ' archived'), attrs: { role: 'listitem', tabindex: '0' },
      on: { click: () => openRuleForm(r), keydown: (e) => { if (e.key === 'Enter') openRuleForm(r); } },
    }, [
      el('div', { className: 'mini-ic', text: r.template.type === 'transfer' ? '⇄' : (cat ? cat.icon : '🔁') }),
      el('div', { className: 'mini-main' }, [
        el('div', { className: 'mini-title' }, [document.createTextNode(r.name), r.legacySalary ? el('span', { className: 'badge-lite', text: '💼' }) : null, !r.enabled ? el('span', { className: 'badge-lite', text: t('recur.paused') }) : null]),
        el('div', { className: 'mini-sub', text: sub }),
      ]),
      el('div', { className: 'mini-actions' }, [
        el('span', { className: 'mini-right ' + (r.template.type === 'income' ? 'in' : r.template.type === 'expense' ? 'out' : ''), text: (r.template.type === 'income' ? '+' : r.template.type === 'expense' ? '−' : '') + formatVND(r.template.amount) }),
        toggle,
      ]),
    ]);
    holder.appendChild(row);
  }
}

export function openRuleForm(rule = null, preset = {}) {
  const isNew = !rule;
  const tpl = rule ? rule.template : { type: preset.type || 'expense', amount: preset.amount || 0, categoryId: preset.categoryId || '', accountId: preset.accountId || S.getSettings().defaultAccountId, toAccountId: '', note: preset.note || '', tags: preset.tags || [] };
  const values = {
    name: rule ? rule.name : (preset.name || ''),
    type: tpl.type, amount: tpl.amount, categoryId: tpl.categoryId || '', accountId: tpl.accountId || '', toAccountId: tpl.toAccountId || '', note: tpl.note || '', tags: tagsToString(tpl.tags),
    freq: rule ? rule.freq : 'monthly', interval: rule ? rule.interval : 1, byMonthDay: rule ? rule.byMonthDay : Number(toLocalYMD().slice(8, 10)),
    startDate: rule ? rule.startDate : toLocalYMD(), endDate: rule ? (rule.endDate || '') : '', enabled: rule ? rule.enabled : true,
  };
  const api = openFormSheet({
    title: isNew ? t('recur.new') : t('recur.edit'),
    fields: [
      { key: 'name', label: t('recur.name'), type: 'text', autofocus: true },
      { type: 'row2', fields: [
        { key: 'type', label: t('tx.type'), type: 'select', options: [{ value: 'expense', label: t('tx.expense') }, { value: 'income', label: t('tx.income') }, { value: 'transfer', label: t('tx.transfer') }], onChange: (a) => refreshRulePickers(a) },
        { key: 'amount', label: t('tx.amount'), type: 'amount' },
      ] },
      { type: 'row2', fields: [
        { key: 'categoryId', label: t('tx.category'), type: 'select', options: [] },
        { key: 'accountId', label: t('tx.account'), type: 'select', options: [], onChange: (a) => refreshRulePickers(a, true) },
      ] },
      { key: 'toAccountId', label: t('tx.toAccount'), type: 'select', options: [], hidden: tpl.type !== 'transfer' },
      { type: 'row2', fields: [
        { key: 'note', label: t('tx.note'), type: 'text' },
        { key: 'tags', label: t('tx.tags'), type: 'text', placeholder: t('tx.tagsPh') },
      ] },
      { type: 'row2', fields: [
        { key: 'freq', label: t('recur.freq'), type: 'select', options: ['daily', 'weekly', 'monthly', 'yearly'].map((f) => ({ value: f, label: t('recur.freq.' + f) })), onChange: (a) => { const f = a.getValues().freq; a.show('byMonthDay', f === 'monthly' || f === 'yearly'); } },
        { key: 'interval', label: t('recur.interval'), type: 'number', attrs: { min: 1, max: 365 } },
      ] },
      { key: 'byMonthDay', label: t('recur.dayOfMonth'), type: 'number', attrs: { min: 1, max: 31 }, hidden: !(values.freq === 'monthly' || values.freq === 'yearly') },
      { type: 'row2', fields: [
        { key: 'startDate', label: t('recur.startDate'), type: 'date' },
        { key: 'endDate', label: t('recur.endDate'), type: 'date' },
      ] },
      { key: 'enabled', label: t('recur.enabled'), type: 'checkbox' },
    ],
    values,
    onSave: async (v) => {
      if (!v.name.trim()) { const e = new Error(t('recur.errName')); e.focusKey = 'name'; throw e; }
      if (!v.amount || v.amount <= 0) { const e = new Error(t('recur.errAmount')); e.focusKey = 'amount'; throw e; }
      if (!v.accountId) throw new Error(t('recur.errAccount'));
      if (v.type === 'transfer' && (!v.toAccountId || v.toAccountId === v.accountId)) throw new Error(t('recur.errToAccount'));
      if (v.type !== 'transfer' && !v.categoryId) throw new Error(t('recur.errCategory'));
      const cat = v.type !== 'transfer' ? S.getCategoryById(v.categoryId) : null;
      const patch = {
        name: v.name.trim(), enabled: !!v.enabled,
        template: { type: v.type, amount: v.amount, categoryId: cat ? cat.id : null, category: cat ? cat.name : '', accountId: v.accountId, toAccountId: v.type === 'transfer' ? v.toAccountId : null, note: v.note.trim(), tags: parseTags(v.tags) },
        freq: v.freq, interval: Math.max(1, Number(v.interval) || 1), byMonthDay: Math.min(31, Math.max(1, Number(v.byMonthDay) || 1)),
        startDate: isValidYMD(v.startDate) ? v.startDate : toLocalYMD(), endDate: isValidYMD(v.endDate) ? v.endDate : null,
      };
      if (isNew) await S.addRule(patch); else await S.updateRule(rule.id, patch);
      // sinh ngay các kỳ đến hạn (VD startDate trong quá khứ)
      const added = await S.runRecurringNow();
      showToast(added.length ? t('toast.recurringN', { n: added.length }) : t('recur.saved'));
      ctx.refresh('data');
    },
    deleteText: isNew ? null : t('common.delete'),
    onDelete: isNew ? null : async () => {
      const ok = await confirmDialog({ title: t('recur.deleteTitle', { name: rule.name }), body: t('recur.deleteBody'), okText: t('common.delete') });
      if (!ok) throw new Error('');
      await S.removeRule(rule.id);
      showToast(t('recur.deleted'));
      ctx.refresh('data');
    },
    extraText: isNew ? null : t('recur.skipNext'),
    onExtra: isNew ? null : async (a) => {
      const r = await S.skipNext(rule.id);
      const next = r ? r.skippedDates[r.skippedDates.length - 1] : null;
      showToast(next ? t('recur.skipped', { date: dateLabel(next) }) : t('recur.noNext'));
      ctx.refresh('data');
    },
  });
  refreshRulePickers(api);
  return api;

  function refreshRulePickers(a, accountOnly = false) {
    const v = a.getValues();
    const type = v.type;
    if (!accountOnly) {
      a.show('categoryId', type !== 'transfer');
      a.show('toAccountId', type === 'transfer');
      if (type !== 'transfer') fillCategorySelect(a.ctl('categoryId').el, { type, value: v.categoryId || values.categoryId, includeArchived: false });
      fillAccountSelect(a.ctl('accountId').el, { value: v.accountId || values.accountId });
    }
    if (type === 'transfer') fillAccountSelect(a.ctl('toAccountId').el, { value: v.toAccountId || values.toAccountId, exclude: a.getValues().accountId });
  }
}
