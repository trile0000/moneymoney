// Form sheet chung: dựng form từ mô tả field (không innerHTML), dùng cho ví / danh mục / định kỳ / lưu bộ lọc.
import { $, el, clear } from '../utils/dom.js';
import { openModal } from './modal.js';
import { bindAmountInput } from './amountInput.js';
import { t } from '../i18n.js';

/**
 * openFormSheet({
 *   title, fields: [{ key, label, type: 'text'|'amount'|'number'|'date'|'select'|'checkbox'|'color'|'emoji'|'row2', options?, value?, placeholder?, required?, autofocus?, half?, hint?, onChange? , fields?(row2) }],
 *   values: {}, onSave(values) → Promise|void (throw Error(msg) để báo lỗi), deleteText?, onDelete?, extraText?, onExtra?
 * })
 * → { close, setError, getValues, root }
 */
export function openFormSheet({ title, fields, values = {}, onSave, deleteText, onDelete, extraText, onExtra, saveText }) {
  const modal = $('#formSheet');
  const form = $('#formSheetForm');
  $('#formSheetTitle').textContent = title;
  clear(form);
  const ctls = {}; // key → { get, set, el }
  const errorEl = el('div', { className: 'form-error', attrs: { role: 'alert' } });

  function build(f, container) {
    if (f.type === 'row2') {
      const row = el('div', { className: 'fs-row2' });
      for (const sub of f.fields) build(sub, row);
      container.appendChild(row);
      return;
    }
    const wrap = el('div', { className: 'fs-field' });
    if (f.hidden) wrap.hidden = true;
    const id = 'fs_' + f.key;
    const val = values[f.key] !== undefined ? values[f.key] : f.value;
    if (f.type !== 'checkbox') wrap.appendChild(el('label', { text: f.label, attrs: { for: id } }));
    let input;
    if (f.type === 'select') {
      input = el('select', { id });
      for (const o of f.options || []) input.appendChild(el('option', { value: o.value, text: o.label }));
      if (val !== undefined && val !== null) input.value = String(val);
      wrap.appendChild(input);
      ctls[f.key] = { get: () => input.value, set: (v) => { input.value = v; }, el: input, wrap };
    } else if (f.type === 'checkbox') {
      input = el('input', { id, type: 'checkbox' });
      input.checked = !!val;
      wrap.className = 'fs-check';
      wrap.appendChild(input);
      wrap.appendChild(el('label', { text: f.label, attrs: { for: id } }));
      ctls[f.key] = { get: () => input.checked, set: (v) => { input.checked = !!v; }, el: input, wrap };
    } else if (f.type === 'amount') {
      input = el('input', { id, type: 'text', attrs: { inputmode: 'text', autocomplete: 'off', placeholder: f.placeholder || '' } });
      const hint = el('div', { className: 'hint', attrs: { 'aria-live': 'polite' } });
      wrap.appendChild(input); wrap.appendChild(hint);
      const ctl = bindAmountInput(input, hint);
      if (val) ctl.setValue(val);
      ctls[f.key] = { get: () => ctl.getValue(), set: (v) => ctl.setValue(v), el: input, wrap };
    } else {
      const type = f.type === 'emoji' ? 'text' : f.type || 'text';
      input = el('input', { id, type, attrs: { autocomplete: 'off', placeholder: f.placeholder || '', ...(f.attrs || {}) } });
      if (f.type === 'emoji') { input.maxLength = 4; input.style.width = '80px'; input.style.fontSize = '22px'; }
      if (val !== undefined && val !== null) input.value = String(val);
      wrap.appendChild(input);
      ctls[f.key] = { get: () => (f.type === 'number' ? Number(input.value) : input.value), set: (v) => { input.value = v; }, el: input, wrap };
    }
    if (f.autofocus) input.dataset.autofocus = '1';
    if (f.hint) wrap.appendChild(el('div', { className: 'hint', text: f.hint }));
    if (f.onChange) input.addEventListener('change', () => f.onChange(api));
    if (f.onInput) input.addEventListener('input', () => f.onInput(api));
    container.appendChild(wrap);
  }
  for (const f of fields) build(f, form);
  form.appendChild(errorEl);

  const saveBtn = $('#fsSave');
  const delBtn = $('#fsDelete');
  const extraBtn = $('#fsExtra');
  saveBtn.textContent = saveText || t('common.save');
  if (deleteText && onDelete) { delBtn.style.display = ''; delBtn.textContent = deleteText; } else delBtn.style.display = 'none';
  if (extraText && onExtra) { extraBtn.style.display = ''; extraBtn.textContent = extraText; } else extraBtn.style.display = 'none';

  const api = {
    getValues() { const o = {}; for (const [k, c] of Object.entries(ctls)) o[k] = c.get(); return o; },
    setValue(k, v) { if (ctls[k]) ctls[k].set(v); },
    setError(msg) { errorEl.textContent = msg || ''; },
    show(k, on) { if (ctls[k]) ctls[k].wrap.hidden = !on; },
    focus(k) { if (ctls[k]) ctls[k].el.focus(); },
    ctl(k) { return ctls[k]; },
    close: null,
    root: form,
  };
  async function save() {
    api.setError('');
    saveBtn.disabled = true;
    try { await onSave(api.getValues(), api); api.close(); }
    catch (e) { api.setError(e && e.message ? e.message : String(e)); if (e && e.focusKey) api.focus(e.focusKey); }
    finally { saveBtn.disabled = false; }
  }
  const onSubmit = (e) => { e.preventDefault(); save(); };
  const onKey = (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.type !== 'checkbox' && !e.isComposing) { e.preventDefault(); save(); } };
  const onDel = async () => { try { await onDelete(api); api.close(); } catch (e) { api.setError(e.message || String(e)); } };
  const onEx = async () => { try { await onExtra(api); } catch (e) { api.setError(e.message || String(e)); } };
  saveBtn.addEventListener('click', save);
  form.addEventListener('submit', onSubmit);
  form.addEventListener('keydown', onKey);
  delBtn.addEventListener('click', onDel);
  extraBtn.addEventListener('click', onEx);
  api.close = openModal(modal, {
    onClose: () => {
      saveBtn.removeEventListener('click', save);
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('keydown', onKey);
      delBtn.removeEventListener('click', onDel);
      extraBtn.removeEventListener('click', onEx);
    },
  });
  return api;
}
