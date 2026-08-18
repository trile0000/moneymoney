// Cài đặt → Bảo mật (P1d-2): bật/tắt khóa PIN & mã hóa, đổi PIN, mã khôi phục, tự khóa; nút khóa ngay ở header.
import * as S from '../state.js';
import { $ } from '../utils/dom.js';
import { t } from '../i18n.js';
import { openFormSheet } from '../ui/formSheet.js';
import { confirmDialog } from '../ui/confirm.js';
import { showToast } from '../ui/toast.js';
import { showLockScreen } from '../ui/lock.js';
import { encryptionEnabled, encryptionSupported, enableEncryption, disableEncryption, changePin, regenerateRecovery, verifySecret } from '../storage.js';
import { validPin } from '../features/crypto.js';

let ctx = null;
let hiddenAt = 0;
let locking = false;

export function initSecurity(c) {
  ctx = c;
  $('#secEnable').addEventListener('click', enableFlow);
  $('#secChangePin').addEventListener('click', changePinFlow);
  $('#secRecovery').addEventListener('click', recoveryFlow);
  $('#secDisable').addEventListener('click', disableFlow);
  $('#secAutoLock').addEventListener('change', async (e) => { await S.updateSettings({ lock: { ...(S.getSettings().lock || {}), autoLockMin: Number(e.target.value) || 0 } }, { silent: true }); showToast(t('settings.saved')); });
  $('#lockNow').addEventListener('click', () => lockNow());
  // Tự khóa khi rời app quá N phút
  document.addEventListener('visibilitychange', () => {
    if (!encryptionEnabled()) return;
    const min = Number((S.getSettings().lock || {}).autoLockMin) || 0;
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (min > 0 && hiddenAt && Date.now() - hiddenAt >= min * 60000) lockNow();
    hiddenAt = 0;
  });
  renderSecurity();
}

export function renderSecurity() {
  const on = encryptionEnabled();
  const st = $('#secStatus');
  st.className = 'status-bar ' + (on ? 'status--rich' : 'status--neutral');
  st.textContent = !encryptionSupported() ? t('sec.unsupported') : on ? t('sec.statusOn') : t('sec.statusOff');
  $('#secEnable').hidden = on || !encryptionSupported();
  for (const id of ['secChangePin', 'secRecovery', 'secDisable']) $('#' + id).hidden = !on;
  $('#secAutoLockGroup').hidden = !on;
  $('#secAutoLock').value = String(Number((S.getSettings().lock || {}).autoLockMin) || 0);
  $('#lockNow').hidden = !on;
}

/** Khóa màn hình ngay (dữ liệu vẫn trong bộ nhớ; cần PIN/mã khôi phục để tiếp tục) */
export async function lockNow() {
  if (locking || !encryptionEnabled()) return;
  locking = true;
  try { await showLockScreen({ tryUnlock: (secret) => verifySecret(secret) }); }
  finally { locking = false; }
}

function pinFields(prefix = '') {
  return [
    { key: prefix + 'pin', label: t('sec.pinNew'), type: 'password', attrs: { inputmode: 'numeric', pattern: '[0-9]*', maxlength: 8, autocomplete: 'off' }, autofocus: true, hint: t('sec.pinHint') },
    { key: prefix + 'pin2', label: t('sec.pinConfirm'), type: 'password', attrs: { inputmode: 'numeric', pattern: '[0-9]*', maxlength: 8, autocomplete: 'off' } },
  ];
}
function checkPins(v, k1 = 'pin', k2 = 'pin2') {
  if (!validPin(v[k1])) { const e = new Error(t('sec.errPin')); e.focusKey = k1; throw e; }
  if (String(v[k1]).replace(/\D/g, '') !== String(v[k2]).replace(/\D/g, '')) { const e = new Error(t('sec.errMatch')); e.focusKey = k2; throw e; }
}

async function showRecovery(code, { title }) {
  await confirmDialog({ title, body: t('sec.recoveryBody', { code }), okText: t('sec.recoverySaved'), okClass: 'primary', requireCheck: true, checkLabel: t('sec.recoveryCheck') });
}

async function enableFlow() {
  const ok = await confirmDialog({ title: t('sec.enableTitle'), body: t('sec.enableBody'), okText: t('common.continue'), okClass: 'primary' });
  if (!ok) return;
  openFormSheet({
    title: t('sec.enableTitle'), fields: pinFields(), values: {},
    onSave: async (v) => {
      checkPins(v);
      const { recoveryCode } = await enableEncryption(S.getData(), v.pin);
      await S.updateSettings({ lock: { ...(S.getSettings().lock || {}), autoLockMin: Number((S.getSettings().lock || {}).autoLockMin) || 5, enabledAt: Date.now() } }, { silent: true });
      renderSecurity();
      showToast(t('sec.enabled'));
      setTimeout(() => showRecovery(recoveryCode, { title: t('sec.recoveryTitle') }), 200);
    },
  });
}

async function changePinFlow() {
  openFormSheet({
    title: t('sec.changePin'),
    fields: [{ key: 'old', label: t('sec.pinOld'), type: 'password', attrs: { inputmode: 'numeric', pattern: '[0-9]*', maxlength: 8, autocomplete: 'off' }, autofocus: true }, ...pinFields()],
    values: {},
    onSave: async (v) => {
      checkPins(v);
      const ok = await changePin(S.getData(), v.old, v.pin);
      if (!ok) { const e = new Error(t('sec.errOld')); e.focusKey = 'old'; throw e; }
      showToast(t('sec.pinChanged'));
    },
  });
}

async function recoveryFlow() {
  openFormSheet({
    title: t('sec.newRecovery'),
    fields: [{ key: 'old', label: t('sec.pinCurrent'), type: 'password', attrs: { inputmode: 'numeric', pattern: '[0-9]*', maxlength: 8, autocomplete: 'off' }, autofocus: true, hint: t('sec.newRecoveryHint') }],
    values: {},
    onSave: async (v) => {
      const code = await regenerateRecovery(S.getData(), v.old);
      if (!code) { const e = new Error(t('sec.errOld')); e.focusKey = 'old'; throw e; }
      setTimeout(() => showRecovery(code, { title: t('sec.recoveryTitle') }), 200);
    },
  });
}

async function disableFlow() {
  openFormSheet({
    title: t('sec.disable'),
    fields: [{ key: 'old', label: t('sec.pinCurrent'), type: 'password', attrs: { inputmode: 'numeric', pattern: '[0-9]*', maxlength: 8, autocomplete: 'off' }, autofocus: true, hint: t('sec.disableHint') }],
    values: {},
    saveText: t('sec.disable'),
    onSave: async (v) => {
      const ok = await disableEncryption(S.getData(), v.old);
      if (!ok) { const e = new Error(t('sec.errOld')); e.focusKey = 'old'; throw e; }
      renderSecurity();
      showToast(t('sec.disabled'));
    },
  });
}

