// Ảnh hóa đơn (P1d): chọn/chụp → nén bằng canvas (≤ ~250 KB, cạnh dài ≤ 1280px) → lưu IndexedDB store 'blobs' theo id giao dịch.
// Không innerHTML; URL.createObjectURL được thu hồi khi đóng.
import { el, clear } from '../utils/dom.js';
import { blobGet, blobPut, blobDelete } from '../storage.js';
import { t } from '../i18n.js';
import { showToast } from './toast.js';

const MAX_SIDE = 1280;
const MAX_BYTES = 250 * 1024;

/** Nén ảnh: trả về Blob JPEG (hoặc gốc nếu đã nhỏ và không phải HEIC). */
export async function compressImage(file, { maxSide = MAX_SIDE, maxBytes = MAX_BYTES } = {}) {
  if (!file || !file.type.startsWith('image/')) throw new Error(t('receipt.errType'));
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { bmp = await loadViaImg(file); }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  let q = 0.8, blob = await toBlob(canvas, q);
  let guard = 0;
  while (blob && blob.size > maxBytes && guard++ < 6) {
    q -= 0.12;
    if (q < 0.35) { // giảm kích thước thay vì chất lượng
      const c2 = document.createElement('canvas'); c2.width = Math.round(canvas.width * 0.8); c2.height = Math.round(canvas.height * 0.8);
      c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
      canvas.width = c2.width; canvas.height = c2.height; canvas.getContext('2d').drawImage(c2, 0, 0);
      q = 0.6;
    }
    blob = await toBlob(canvas, q);
  }
  if (!blob) throw new Error(t('receipt.errCompress'));
  return blob;
}
function toBlob(canvas, q) { return new Promise((res) => canvas.toBlob(res, 'image/jpeg', q)); }
function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('receipt.errType'))); };
    img.src = url;
  });
}

export const saveReceipt = (id, blob) => blobPut(id, blob);
export const loadReceipt = (id) => blobGet(id);
export const removeReceipt = (id) => blobDelete(id);

/**
 * Gắn bộ chọn ảnh vào container. Trạng thái: { blob (mới chọn) | existingId | removed }.
 * @returns { getState(): { blob, removed }, reset(id), destroy() }
 */
export function mountReceiptPicker(container, { existingId = null, onChange } = {}) {
  clear(container);
  const state = { blob: null, removed: false, existingId };
  let url = null;
  const input = el('input', { type: 'file', accept: 'image/*', hidden: true, attrs: { capture: 'environment', 'aria-hidden': 'true', tabindex: '-1' } });
  const btn = el('button', { className: 'btn ghost small', type: 'button', text: t('receipt.add'), on: { click: () => input.click() } });
  const thumbWrap = el('div', { className: 'receipt-thumb', hidden: true });
  const thumb = el('img', { alt: t('receipt.alt'), width: 56, height: 56 });
  const viewBtn = el('button', { className: 'btn ghost small', type: 'button', text: t('receipt.view'), on: { click: () => openLightbox(current()) } });
  const delBtn = el('button', { className: 'btn danger-text small', type: 'button', text: '✕', attrs: { 'aria-label': t('receipt.remove') }, on: { click: () => { state.blob = null; state.removed = !!state.existingId; render(null); onChange && onChange(state); } } });
  thumbWrap.append(thumb, viewBtn, delBtn);
  const status = el('span', { className: 'hint' });
  container.append(input, btn, thumbWrap, status);

  const current = () => state.blob || state._existingBlob || null;
  function render(blob) {
    if (url) { URL.revokeObjectURL(url); url = null; }
    if (blob) { url = URL.createObjectURL(blob); thumb.src = url; thumbWrap.hidden = false; btn.textContent = t('receipt.change'); status.textContent = `${Math.round(blob.size / 1024)} KB`; }
    else { thumb.removeAttribute('src'); thumbWrap.hidden = true; btn.textContent = t('receipt.add'); status.textContent = ''; }
  }
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    status.textContent = t('receipt.compressing');
    try {
      state.blob = await compressImage(f);
      state.removed = false;
      render(state.blob);
      onChange && onChange(state);
    } catch (e) { status.textContent = ''; showToast(e.message || t('receipt.errType'), { kind: 'error' }); }
  });
  if (existingId) loadReceipt(existingId).then((b) => { if (b && !state.blob && !state.removed) { state._existingBlob = b; render(b); } });
  return {
    getState: () => ({ blob: state.blob, removed: state.removed }),
    reset(id = null) { state.blob = null; state.removed = false; state.existingId = id; state._existingBlob = null; render(null); if (id) loadReceipt(id).then((b) => { if (b) { state._existingBlob = b; render(b); } }); },
    destroy() { if (url) URL.revokeObjectURL(url); clear(container); },
  };
}

/** Áp dụng trạng thái picker cho giao dịch id: lưu blob mới / xóa. Trả về receiptId mới (hoặc null). */
export async function applyReceipt(txId, pickerState, existingId) {
  if (pickerState.blob) { const ok = await saveReceipt(txId, pickerState.blob); if (ok === false) showToast(t('receipt.errSave'), { kind: 'error' }); return txId; }
  if (pickerState.removed && existingId) { await removeReceipt(existingId); return null; }
  return existingId || null;
}

// ---------- Lightbox ----------
let lbUrl = null;
export function openLightbox(blob) {
  if (!blob) return;
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  const img = lb.querySelector('img');
  if (lbUrl) URL.revokeObjectURL(lbUrl);
  lbUrl = URL.createObjectURL(blob);
  img.src = lbUrl;
  lb.hidden = false;
  lb.setAttribute('aria-hidden', 'false');
  const closeBtn = lb.querySelector('button');
  const prevFocus = document.activeElement;
  const close = () => {
    lb.hidden = true; lb.setAttribute('aria-hidden', 'true');
    img.removeAttribute('src');
    if (lbUrl) { URL.revokeObjectURL(lbUrl); lbUrl = null; }
    lb.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const onClick = (e) => { if (e.target === lb || e.target === closeBtn || e.target === img) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  lb.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey, true);
  closeBtn.focus();
}
