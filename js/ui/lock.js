// Màn hình khóa PIN (P1d-2): dùng khi khởi động (dữ liệu mã hóa) và khi tự khóa. Chặn 30s sau 5 lần sai.
import { $ } from '../utils/dom.js';
import { t } from '../i18n.js';

let visible = false;
export function isLockVisible() { return visible; }

/**
 * @param {object} p
 * @param {(secret: {pin?: string, recovery?: string}) => Promise<boolean>} p.tryUnlock
 * @param {string} [p.hint]
 * @returns {Promise<void>} resolve khi mở khóa thành công
 */
export function showLockScreen({ tryUnlock, hint } = {}) {
  return new Promise((resolve) => {
    const lock = $('#lockScreen'), form = $('#lockForm'), pin = $('#lockPin'), rec = $('#lockRecovery'), err = $('#lockError'), toggle = $('#lockToggle'), submit = $('#lockSubmit'), hintEl = $('#lockHint');
    let recovery = false, fails = 0, blockedUntil = 0, timer = 0;
    visible = true;
    lock.hidden = false; lock.setAttribute('aria-hidden', 'false');
    document.body.classList.add('locked');
    if (hint) hintEl.textContent = hint;
    pin.value = ''; rec.value = ''; err.textContent = '';
    setMode(false);
    setTimeout(() => pin.focus(), 50);

    function setMode(useRecovery) {
      recovery = useRecovery;
      pin.hidden = useRecovery; rec.hidden = !useRecovery;
      toggle.textContent = useRecovery ? t('lock.usePin') : t('lock.forgot');
      err.textContent = '';
      (useRecovery ? rec : pin).focus();
    }
    function tick() {
      const left = Math.ceil((blockedUntil - Date.now()) / 1000);
      if (left > 0) { submit.disabled = true; err.textContent = t('lock.blocked', { s: left }); timer = setTimeout(tick, 500); }
      else { submit.disabled = false; err.textContent = ''; }
    }
    async function onSubmit(e) {
      e.preventDefault();
      if (Date.now() < blockedUntil) return;
      const secret = recovery ? { recovery: rec.value } : { pin: pin.value };
      if ((recovery ? rec.value : pin.value).trim().length < 4) { err.textContent = t('lock.errShort'); return; }
      submit.disabled = true; err.textContent = t('lock.checking');
      let ok = false;
      try { ok = await tryUnlock(secret); } catch { ok = false; }
      if (ok) { cleanup(); resolve(); return; }
      fails++;
      pin.value = ''; rec.value = '';
      if (fails % 5 === 0) { blockedUntil = Date.now() + 30000; tick(); }
      else { submit.disabled = false; err.textContent = t(recovery ? 'lock.errRecovery' : 'lock.errPin', { n: 5 - (fails % 5) }); (recovery ? rec : pin).focus(); }
    }
    const onToggle = () => setMode(!recovery);
    const onKey = (e) => { if (e.key === 'Tab') { const f = [pin, rec, submit, toggle].filter((x) => !x.hidden); const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } };
    form.addEventListener('submit', onSubmit);
    toggle.addEventListener('click', onToggle);
    lock.addEventListener('keydown', onKey);
    function cleanup() {
      clearTimeout(timer);
      form.removeEventListener('submit', onSubmit); toggle.removeEventListener('click', onToggle); lock.removeEventListener('keydown', onKey);
      lock.hidden = true; lock.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('locked');
      pin.value = ''; rec.value = ''; err.textContent = ''; submit.disabled = false;
      visible = false;
    }
  });
}
