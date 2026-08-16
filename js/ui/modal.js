// Modal có bẫy focus, đóng bằng Esc / click nền / nút [data-close] (sửa lỗi #26)
import { $$, trapFocus } from '../utils/dom.js';

const openStack = [];

export function openModal(modalEl, { onClose } = {}) {
  if (!modalEl || modalEl.classList.contains('open')) return () => {};
  modalEl.classList.add('open');
  modalEl.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  let released = false;
  const release = trapFocus(modalEl, { onEscape: close });
  function onBackdrop(e) { if (e.target === modalEl) close(); }
  const closeBtns = $$('[data-close]', modalEl);
  closeBtns.forEach((b) => b.addEventListener('click', close));
  modalEl.addEventListener('click', onBackdrop);

  function close() {
    if (released) return;
    released = true;
    modalEl.classList.remove('open');
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.removeEventListener('click', onBackdrop);
    closeBtns.forEach((b) => b.removeEventListener('click', close));
    release();
    const i = openStack.indexOf(close);
    if (i >= 0) openStack.splice(i, 1);
    if (!openStack.length) document.body.style.overflow = '';
    onClose && onClose();
  }
  openStack.push(close);
  return close;
}

export function isModalOpen() { return openStack.length > 0; }
