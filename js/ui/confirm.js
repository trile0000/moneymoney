// Hộp thoại xác nhận (thay confirm()/prompt() — sửa lỗi #4, #22)
import { $, clear, el } from '../utils/dom.js';
import { openModal } from './modal.js';

/**
 * confirmDialog({ title, body (string | Node[]), okText, okClass, requireCheck, checkLabel, extraText, onExtra })
 * → Promise<boolean>
 */
export function confirmDialog({ title = 'Xác nhận', body = '', okText = 'Đồng ý', okClass = 'danger', requireCheck = false, checkLabel = '', extraText = '', onExtra = null, extraResolves = false } = {}) {
  return new Promise((resolve) => {
    const modal = $('#confirmModal');
    $('#confirmTitle').textContent = title;
    const bodyEl = $('#confirmBody');
    clear(bodyEl);
    if (typeof body === 'string') bodyEl.appendChild(el('p', { text: body, style: { margin: 0, whiteSpace: 'pre-line' } }));
    else for (const n of [].concat(body)) bodyEl.appendChild(n);

    const okBtn = $('#confirmOk');
    okBtn.textContent = okText;
    okBtn.className = 'btn ' + okClass;
    const checkWrap = $('#confirmCheckWrap');
    const check = $('#confirmCheck');
    check.checked = false;
    if (requireCheck) { checkWrap.style.display = 'flex'; $('#confirmCheckLabel').textContent = checkLabel; okBtn.disabled = true; }
    else { checkWrap.style.display = 'none'; okBtn.disabled = false; }
    const onCheck = () => { okBtn.disabled = !check.checked; };
    check.addEventListener('change', onCheck);

    const extra = $('#confirmExtra');
    if (extraText) { extra.style.display = ''; extra.textContent = extraText; } else extra.style.display = 'none';

    let done = false;
    const finish = (v) => { if (done) return; done = true; cleanup(); close(); resolve(v); };
    const onOk = () => finish(true);
    const onExtraClick = () => { onExtra && onExtra(); if (extraResolves) finish('extra'); };
    okBtn.addEventListener('click', onOk);
    extra.addEventListener('click', onExtraClick);
    function cleanup() {
      okBtn.removeEventListener('click', onOk);
      extra.removeEventListener('click', onExtraClick);
      check.removeEventListener('change', onCheck);
    }
    const close = openModal(modal, { onClose: () => { if (!done) { done = true; cleanup(); resolve(false); } } });
  });
}
