// Hash router: #/home | #/tx?focus=amount | #/budget | #/settings?section=accounts
const VIEWS = ['home', 'tx', 'budget', 'settings'];
const handlers = new Map();
let current = null;

export function parseHash(h = location.hash) {
  const m = String(h || '').match(/^#\/?([a-z]*)(?:\?(.*))?$/i);
  const view = m && VIEWS.includes(m[1]) ? m[1] : 'home';
  const params = {};
  if (m && m[2]) for (const [k, v] of new URLSearchParams(m[2])) params[k] = v;
  return { view, params };
}

export function onView(view, fn) { handlers.set(view, fn); }

export function navigate(view, params) {
  const q = params && Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const target = `#/${view}${q}`;
  if (location.hash === target) render(); else location.hash = target;
}

export function currentView() { return current; }

function render() {
  const { view, params } = parseHash();
  document.querySelectorAll('[data-view]').forEach((sec) => { sec.hidden = sec.dataset.view !== view; });
  document.querySelectorAll('.tabbar .tab[data-tab]').forEach((a) => {
    const active = a.dataset.tab === view;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const changed = current !== view;
  current = view;
  const fn = handlers.get(view);
  if (fn) fn(params, { changed });
  if (changed) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  if (!location.hash) history.replaceState(null, '', '#/home');
  render();
}
