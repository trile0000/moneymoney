// Bottom sheet sửa giao dịch — form thật, thay chuỗi prompt() (sửa lỗi #22)
import { $, $$ } from '../utils/dom.js';
import { openModal } from './modal.js';
import { bindAmountInput } from './amountInput.js';
import { isValidYMD } from '../utils/date.js';

let amountCtl = null;

export function openEditSheet(tx, { onSave, onDelete }) {
  const modal = $('#editSheet');
  if (!amountCtl) amountCtl = bindAmountInput($('#edAmount'), $('#edAmountHint'));
  $('#edId').value = tx.id;
  $$('input[name="edType"]', modal).forEach((r) => { r.checked = r.value === tx.type; });
  $('#edDate').value = tx.date;
  $('#edCategory').value = tx.category || '';
  $('#edNote').value = tx.note || '';
  amountCtl.setValue(tx.amount);
  $('#edError').textContent = '';

  const saveBtn = $('#edSave');
  const delBtn = $('#edDelete');
  const form = $('#editForm');

  function validate() {
    const amount = amountCtl.getValue();
    const category = $('#edCategory').value.trim();
    const date = $('#edDate').value;
    const type = ($$('input[name="edType"]', modal).find((r) => r.checked) || {}).value;
    if (!amount || amount <= 0) return { error: 'Số tiền phải lớn hơn 0', focus: '#edAmount' };
    if (!category) return { error: 'Danh mục không được để trống', focus: '#edCategory' };
    if (!isValidYMD(date)) return { error: 'Ngày không hợp lệ', focus: '#edDate' };
    if (type !== 'income' && type !== 'expense') return { error: 'Chọn loại Thu hoặc Chi' };
    return { patch: { amount, category, date, type, note: $('#edNote').value.trim() } };
  }
  async function save() {
    const v = validate();
    if (v.error) { $('#edError').textContent = v.error; if (v.focus) $(v.focus).focus(); return; }
    saveBtn.disabled = true;
    try { await onSave(tx.id, v.patch); close(); } finally { saveBtn.disabled = false; }
  }
  function del() { close(); onDelete(tx.id); }
  function onSubmit(e) { e.preventDefault(); save(); }
  function onKey(e) { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.isComposing) { e.preventDefault(); save(); } }

  saveBtn.addEventListener('click', save);
  delBtn.addEventListener('click', del);
  form.addEventListener('submit', onSubmit);
  form.addEventListener('keydown', onKey);
  const close = openModal(modal, {
    onClose: () => {
      saveBtn.removeEventListener('click', save);
      delBtn.removeEventListener('click', del);
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('keydown', onKey);
    },
  });
}
