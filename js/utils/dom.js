// DOM helpers — không dùng innerHTML với dữ liệu người dùng (sửa lỗi #12: XSS)

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Tạo phần tử an toàn: el('div', { className: 'x', text: userInput, attrs: {...}, on: { click } }, [children])
 * Mọi chuỗi đều đi qua textContent → không bao giờ bị diễn giải thành HTML.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k === 'text') {
      node.textContent = String(v);
    } else if (k === 'className' || k === 'class') {
      node.className = v;
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k === 'attrs') {
      for (const [a, av] of Object.entries(v)) {
        if (av !== undefined && av !== null && av !== false) node.setAttribute(a, av === true ? '' : String(av));
      }
    } else if (k === 'on') {
      for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    } else if (k in node) {
      node[k] = v;
    } else {
      node.setAttribute(k, String(v));
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Xóa toàn bộ con của node */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Bẫy focus trong container (modal / bottom sheet). Trả về hàm gỡ. */
export function trapFocus(container, { onEscape } = {}) {
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const previouslyFocused = document.activeElement;
  function focusables() {
    return $$(FOCUSABLE, container).filter((n) => n.offsetParent !== null || n === document.activeElement);
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEscape && onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  container.addEventListener('keydown', onKey);
  // focus phần tử đầu tiên có [data-autofocus] hoặc focusable đầu tiên
  queueMicrotask(() => {
    const pref = $('[data-autofocus]', container);
    (pref || focusables()[0] || container).focus({ preventScroll: true });
  });
  return function release() {
    container.removeEventListener('keydown', onKey);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      try { previouslyFocused.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  };
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
