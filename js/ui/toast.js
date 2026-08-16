import { $ } from '../utils/dom.js';

let timer = null;
let holdUntil = 0; // toast lỗi/cảnh báo không bị toast "ok" đè lên trước khi hết hạn

export function showToast(text, { kind = 'ok', duration = 3000 } = {}) {
  const t = $('#appToast');
  if (!t) return;
  const now = Date.now();
  if (kind === 'ok' && now < holdUntil) return; // đang hiện cảnh báo quan trọng → bỏ qua toast thường
  t.textContent = text;
  t.className = 'toast show' + (kind === 'warn' ? ' warn' : kind === 'error' ? ' error' : '');
  if (kind !== 'ok') holdUntil = now + duration; else holdUntil = 0;
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('show'), duration);
}
