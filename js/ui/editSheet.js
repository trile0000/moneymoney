// Bottom sheet sửa giao dịch (v3: loại Chi/Thu/Chuyển, ví, ví đích, danh mục 2 cấp, tag, lặp lại)
import { $, $$ } from '../utils/dom.js';
import { openModal } from './modal.js';
import { bindAmountInput } from './amountInput.js';
import { isValidYMD, dateLabel } from '../utils/date.js';
import { fillAccountSelect, fillCategorySelect, parseTags, tagsToString, refreshNoteSuggest, NEW_CATEGORY_VALUE } from './pickers.js';
import { t } from '../i18n.js';

let amountCtl = null;

export function openEditSheet(tx, { onSave, onDelete, onDuplicate, onNewCategory }) {
  const modal = $('#editSheet');
  if (!amountCtl) amountCtl = bindAmountInput($('#edAmount'), $('#edAmountHint'));
  const typeRadios = $$('input[name="edType"]', modal);
  const catSel = $('#edCategory'), accSel = $('#edAccount'), toSel = $('#edToAccount');
  const catGroup = $('#edCatGroup'), toGroup = $('#edToGroup');

  $('#edId').value = tx.id;
  typeRadios.forEach((r) => { r.checked = r.value === tx.type; });
  $('#edDate').value = tx.date;
  $('#edNote').value = tx.note || '';
  $('#edTags').value = tagsToString(tx.tags);
  amountCtl.setValue(tx.amount);
  $('#edError').textContent = '';
  const srcKey = { manual: 'edit.sourceManual', recurring: 'edit.sourceRecurring', import: 'edit.sourceImport', 'auto-salary': 'edit.sourceSalary' }[tx.source] || 'edit.sourceManual';
  $('#edMeta').textContent = t('edit.meta', { created: new Date(tx.createdAt).toLocaleString(), source: t(srcKey) });

  function curType() { return (typeRadios.find((r) => r.checked) || {}).value || 'expense'; }
  function refreshPickers(keepCat = true) {
    const type = curType();
    fillAccountSelect(accSel, { value: tx.accountId, includeArchived: true });
    if (type === 'transfer') {
      catGroup.hidden = true; toGroup.hidden = false;
      fillAccountSelect(toSel, { value: tx.toAccountId || '', exclude: accSel.value, includeArchived: true });
    } else {
      catGroup.hidden = false; toGroup.hidden = true;
      fillCategorySelect(catSel, { type, value: keepCat ? (tx.categoryId || '') : '', allowNew: true, includeArchived: false });
      if (tx.categoryId && !Array.from(catSel.options).some((o) => o.value === tx.categoryId)) {
        // danh mục đã lưu trữ → vẫn cho hiển thị
        fillCategorySelect(catSel, { type, value: tx.categoryId, allowNew: true, includeArchived: true });
      }
    }
    refreshNoteSuggest(type === 'transfer' ? null : catSel.value);
  }
  refreshPickers(true);

  const onType = () => refreshPickers(false);
  typeRadios.forEach((r) => r.addEventListener('change', onType));
  const onAcc = () => { if (curType() === 'transfer') fillAccountSelect(toSel, { value: toSel.value, exclude: accSel.value, includeArchived: true }); };
  accSel.addEventListener('change', onAcc);
  const onCat = async () => {
    if (catSel.value === NEW_CATEGORY_VALUE) {
      const created = onNewCategory ? await onNewCategory(curType()) : null;
      fillCategorySelect(catSel, { type: curType(), value: created ? created.id : (tx.categoryId || ''), allowNew: true });
    }
    refreshNoteSuggest(catSel.value);
  };
  catSel.addEventListener('change', onCat);

  const saveBtn = $('#edSave'), delBtn = $('#edDelete'), dupBtn = $('#edDuplicate'), form = $('#editForm');

  function validate() {
    const amount = amountCtl.getValue();
    const date = $('#edDate').value;
    const type = curType();
    if (!amount || amount <= 0) return { error: t('tx.errAmount'), focus: '#edAmount' };
    if (!isValidYMD(date)) return { error: t('tx.errDate'), focus: '#edDate' };
    if (!accSel.value) return { error: t('tx.errAccount'), focus: '#edAccount' };
    const patch = { amount, date, type, note: $('#edNote').value.trim(), tags: parseTags($('#edTags').value), accountId: accSel.value };
    if (type === 'transfer') {
      if (!toSel.value || toSel.value === accSel.value) return { error: t('tx.errToAccount'), focus: '#edToAccount' };
      patch.toAccountId = toSel.value; patch.categoryId = null; patch.category = '';
    } else {
      if (!catSel.value || catSel.value === NEW_CATEGORY_VALUE) return { error: t('tx.errCategory'), focus: '#edCategory' };
      patch.categoryId = catSel.value; patch.toAccountId = null;
    }
    return { patch };
  }
  async function save() {
    const v = validate();
    if (v.error) { $('#edError').textContent = v.error; if (v.focus) $(v.focus).focus(); return; }
    saveBtn.disabled = true;
    try { await onSave(tx.id, v.patch); close(); } finally { saveBtn.disabled = false; }
  }
  const del = () => { close(); onDelete(tx.id); };
  const dup = async () => {
    const v = validate();
    if (v.error) { $('#edError').textContent = v.error; return; }
    close();
    onDuplicate && onDuplicate(tx, v.patch);
  };
  const onSubmit = (e) => { e.preventDefault(); save(); };
  const onKey = (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT' && !e.isComposing) { e.preventDefault(); save(); } };

  saveBtn.addEventListener('click', save);
  delBtn.addEventListener('click', del);
  dupBtn.addEventListener('click', dup);
  form.addEventListener('submit', onSubmit);
  form.addEventListener('keydown', onKey);
  const close = openModal(modal, {
    onClose: () => {
      saveBtn.removeEventListener('click', save);
      delBtn.removeEventListener('click', del);
      dupBtn.removeEventListener('click', dup);
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('keydown', onKey);
      typeRadios.forEach((r) => r.removeEventListener('change', onType));
      accSel.removeEventListener('change', onAcc);
      catSel.removeEventListener('change', onCat);
    },
  });
}

export { dateLabel };
