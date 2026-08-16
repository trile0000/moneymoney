// Snackbar Hoàn tác 5 giây (sửa lỗi #2). Xóa mềm → hết 5s (hoặc rời trang) mới xóa hẳn.
import { $ } from '../utils/dom.js';

const UNDO_MS = 5000;
let pending = []; // ids đang chờ xóa hẳn
let timer = null;
let tick = null;
let deadline = 0;
let handlers = { onCommit: null, onUndo: null };

export function initUndo({ onCommit, onUndo }) {
  handlers = { onCommit, onUndo };
  $('#undoBtn').addEventListener('click', undo);
  // Rời trang / ẩn tab → chốt luôn (không để lơ lửng)
  document.addEventListener('visibilitychange', () => { if (document.hidden) commit(); });
  window.addEventListener('pagehide', commit);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && pending.length && !isTyping(e.target)) { e.preventDefault(); undo(); }
  });
}
function isTyping(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); }

export function queueUndo(id, label) {
  pending.push(id);
  deadline = Date.now() + UNDO_MS;
  clearTimeout(timer); clearInterval(tick);
  const bar = $('#undoBar');
  $('#undoText').textContent = pending.length > 1 ? `Đã xóa ${pending.length} giao dịch` : `Đã xóa ${label || 'giao dịch'}`;
  bar.classList.add('show');
  const upd = () => { $('#undoCount').textContent = String(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))); };
  upd();
  tick = setInterval(upd, 250);
  timer = setTimeout(commit, UNDO_MS);
}

function hide() {
  clearTimeout(timer); clearInterval(tick); timer = null; tick = null;
  $('#undoBar').classList.remove('show');
}

export function commit() {
  if (!pending.length) { hide(); return; }
  const ids = pending; pending = [];
  hide();
  handlers.onCommit && handlers.onCommit(ids);
}

export function undo() {
  if (!pending.length) { hide(); return; }
  const ids = pending; pending = [];
  hide();
  handlers.onUndo && handlers.onUndo(ids);
}

export const hasPendingUndo = () => pending.length > 0;
