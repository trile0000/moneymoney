// Cử chỉ chạm cho danh sách (sửa lỗi #23, #24):
// - Gắn vào viewport danh sách (không phải document), touchmove KHÔNG passive để preventDefault khi đã khóa hướng ngang.
// - Bỏ qua khi chạm vào nút (✕) → không vừa swipe vừa click.
// - Khóa hướng: |dx| > 12 và |dx| > 1.5·|dy| → ngang (swipe); ngược lại → dọc (cuộn), hủy swipe & long-press.
// - Long-press 500ms (không di chuyển) → sửa. Vuốt trái ≥ 80px → xóa (có Undo).
import { prefersReducedMotion } from '../utils/dom.js';

export function bindListGestures(viewport, { onEdit, onDelete, longPressMs = 500, swipeThreshold = 80 }) {
  let row = null, startX = 0, startY = 0, dx = 0, locked = null, timer = null, suppressClick = false, startTime = 0;

  function reset(animateBack) {
    clearTimeout(timer); timer = null;
    if (row) {
      row.classList.remove('swiping');
      if (animateBack) row.style.transform = row.style.transform.replace(/translateX\([^)]*\)/, '') ;
      row.style.opacity = '';
    }
    row = null; locked = null; dx = 0;
  }
  function baseTransform(r) { return (r.style.transform || '').replace(/\s*translateX\([^)]*\)/, ''); }

  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const target = e.target;
    if (target.closest('button')) return; // sửa lỗi #23: loại trừ vùng nút
    const r = target.closest('.tx');
    if (!r) return;
    row = r; startX = e.touches[0].clientX; startY = e.touches[0].clientY; dx = 0; locked = null; startTime = Date.now();
    timer = setTimeout(() => {
      if (row && locked === null) { const id = row.dataset.id; suppressClick = true; reset(true); onEdit(id); }
    }, longPressMs);
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (!row) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    const mx = x - startX, my = y - startY;
    if (locked === null) {
      if (Math.abs(mx) < 12 && Math.abs(my) < 12) return;
      if (Math.abs(mx) > 1.5 * Math.abs(my)) { locked = 'h'; row.classList.add('swiping'); }
      else { locked = 'v'; clearTimeout(timer); return; }
      clearTimeout(timer);
    }
    if (locked === 'v') return;
    e.preventDefault(); // đã khóa ngang → chặn cuộn dọc
    dx = Math.min(0, mx);
    row.style.transform = `${baseTransform(row)} translateX(${dx}px)`;
    row.style.opacity = String(Math.max(0.35, 1 + dx / 300));
  }, { passive: false });

  function end() {
    if (!row) return;
    const r = row; const id = r.dataset.id; const moved = dx;
    if (locked === 'h' && moved <= -swipeThreshold) {
      suppressClick = true;
      r.classList.remove('swiping');
      if (prefersReducedMotion()) { reset(true); onDelete(id); }
      else {
        r.style.transition = 'transform .18s ease, opacity .18s ease';
        r.style.transform = `${baseTransform(r)} translateX(-110%)`;
        r.style.opacity = '0';
        setTimeout(() => { r.style.transition = ''; r.style.transform = baseTransform(r); r.style.opacity = ''; onDelete(id); }, 180);
        row = null; locked = null; dx = 0; clearTimeout(timer);
      }
      return;
    }
    if (locked === 'h' && Math.abs(moved) > 5) suppressClick = true;
    if (locked === 'h') { r.style.transition = 'transform .2s ease'; r.style.transform = baseTransform(r); setTimeout(() => { r.style.transition = ''; }, 200); }
    reset(false);
  }
  viewport.addEventListener('touchend', end, { passive: true });
  viewport.addEventListener('touchcancel', () => reset(true), { passive: true });

  // Chặn click phát sinh sau swipe / long-press
  viewport.addEventListener('click', (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
  }, true);
}
