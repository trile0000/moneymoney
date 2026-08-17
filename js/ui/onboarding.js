// Onboarding 60 giây (P1d): 3 bước cho người mới — ví & số dư, thu nhập định kỳ, ngân sách tháng. Bỏ qua được ở mọi bước.
import * as S from '../state.js';
import { toLocalYM } from '../utils/date.js';
import { formatVND } from '../utils/money.js';
import { t } from '../i18n.js';
import { openFormSheet } from './formSheet.js';
import { confirmDialog } from './confirm.js';
import { showToast } from './toast.js';

/** Có nên chạy onboarding không: chưa đánh dấu + chưa có giao dịch nào */
export function shouldOnboard(settings, data) {
  return !settings.onboarded && !(data.transactions || []).some((x) => !x.deletedAt);
}

/** Chạy tuần tự 3 bước; resolve khi xong hoặc bỏ qua. */
export async function runOnboarding(ctx) {
  const done = async () => { await S.updateSettings({ onboarded: true }, { silent: true }); };
  const accs = S.getAccounts();
  const main = accs[0];
  // Bước 1: ví & số dư đầu
  const s1 = await step({
    title: t('onb.step1Title'),
    intro: t('onb.step1Intro'),
    fields: [
      { type: 'row2', fields: [{ key: 'name', label: t('onb.mainWallet'), type: 'text', autofocus: true }, { key: 'balance', label: t('onb.mainBalance'), type: 'amount', placeholder: 'VD: 2tr' }] },
      { type: 'row2', fields: [{ key: 'bankName', label: t('onb.bankWallet'), type: 'text', placeholder: 'VD: Vietcombank' }, { key: 'bankBalance', label: t('onb.bankBalance'), type: 'amount', placeholder: 'VD: 15tr' }] },
    ],
    values: { name: main ? main.name : 'Tiền mặt', balance: main ? main.openingBalance : 0 },
    stepNo: 1,
  });
  if (s1 === 'skip' || s1 === null) { await done(); return finish(false); }
  if (s1) {
    if (main) await S.updateAccount(main.id, { name: String(s1.name || '').trim() || main.name, openingBalance: s1.balance || 0 });
    if (String(s1.bankName || '').trim() || (s1.bankBalance || 0) > 0) await S.addAccount({ name: String(s1.bankName || '').trim() || 'Ngân hàng', type: 'bank', openingBalance: s1.bankBalance || 0 });
  }
  // Bước 2: thu nhập định kỳ
  const s2 = await step({
    title: t('onb.step2Title'),
    intro: t('onb.step2Intro'),
    fields: [{ type: 'row2', fields: [{ key: 'salary', label: t('onb.salary'), type: 'amount', autofocus: true, placeholder: 'VD: 15tr' }, { key: 'day', label: t('onb.salaryDay'), type: 'number', attrs: { min: 1, max: 31 } }] }],
    values: { day: 1 },
    stepNo: 2,
  });
  if (s2 === 'skip' || s2 === null) { await done(); return finish(true); }
  if (s2 && s2.salary > 0) {
    const cat = S.ensureCategoryByName('Lương', 'income');
    const acc = S.getAccounts()[0];
    const day = Math.min(31, Math.max(1, Number(s2.day) || 1));
    await S.addRule({ name: t('onb.salaryRuleName'), freq: 'monthly', interval: 1, byMonthDay: day, startDate: `${toLocalYM()}-01`, template: { type: 'income', amount: s2.salary, categoryId: cat.id, category: cat.name, accountId: acc ? acc.id : null, note: '' } });
    await S.runRecurringNow();
  }
  // Bước 3: ngân sách tháng
  const s3 = await step({
    title: t('onb.step3Title'),
    intro: t('onb.step3Intro', { hint: s2 && s2.salary > 0 ? t('onb.step3Hint', { amount: formatVND(Math.round(s2.salary * 0.8 / 100000) * 100000) }) : '' }),
    fields: [{ key: 'budget', label: t('onb.budget'), type: 'amount', autofocus: true, placeholder: 'VD: 10tr' }],
    values: { budget: s2 && s2.salary > 0 ? Math.round(s2.salary * 0.8 / 100000) * 100000 : 0 },
    stepNo: 3,
  });
  if (s3 && s3 !== 'skip' && s3.budget > 0 && !S.getBudgets().length) await S.addBudget({ categoryId: null, amount: s3.budget, note: '' });
  await done();
  return finish(true);

  async function finish(changed) {
    if (changed) ctx.refresh('data');
    if (!changed) return;
    await confirmDialog({ title: t('onb.doneTitle'), body: t('onb.doneBody'), okText: t('onb.start'), okClass: 'primary' });
    showToast(t('onb.toast'));
  }
}

/** Mở một bước dạng form sheet: resolve values | 'skip' | null (đóng) */
function step({ title, intro, fields, values, stepNo }) {
  return new Promise((resolve) => {
    let settled = false;
    const finishWith = (v) => { if (!settled) { settled = true; resolve(v); } };
    const api = openFormSheet({
      title: `${t('onb.stepOf', { n: stepNo, total: 3 })} · ${title}`,
      fields,
      values,
      saveText: stepNo === 3 ? t('onb.finish') : t('onb.next'),
      onSave: (v) => { finishWith(v); },
      extraText: t('onb.skip'),
      onExtra: (a) => { finishWith('skip'); a.close(); },
    });
    const p = document.createElement('p');
    p.className = 'note-box'; p.textContent = intro;
    api.root.insertBefore(p, api.root.firstChild);
    // đóng bằng ✕/Esc → coi như bỏ qua bước này
    const modal = document.getElementById('formSheet');
    const obs = new MutationObserver(() => { if (modal.getAttribute('aria-hidden') === 'true') { obs.disconnect(); finishWith(null); } });
    obs.observe(modal, { attributes: true, attributeFilter: ['aria-hidden'] });
  });
}
