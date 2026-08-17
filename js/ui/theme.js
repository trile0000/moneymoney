// Dark mode: theo hệ thống (prefers-color-scheme) + ghi đè thủ công.
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set();

export function applyTheme(setting) {
  const root = document.documentElement;
  if (setting === 'dark' || setting === 'light') root.dataset.theme = setting;
  else delete root.dataset.theme;
  const dark = isDark();
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') || (() => { const m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); return m; })();
  meta.content = dark ? '#1c1412' : '#7a2a1a';
  for (const fn of listeners) { try { fn(dark); } catch (e) { console.error(e); } }
}
export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return !!(mq && mq.matches);
}
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
if (mq) mq.addEventListener('change', () => { if (!document.documentElement.dataset.theme) applyTheme('system'); });
/** Chu kỳ nút bấm nhanh: system → dark → light → system */
export function nextTheme(cur) { return cur === 'system' ? (isDark() ? 'light' : 'dark') : cur === 'dark' ? 'light' : 'dark'; }
