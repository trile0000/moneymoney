// Đăng ký Service Worker + banner "Có bản mới, tải lại" (sửa lỗi #14, #16).
import { $ } from '../utils/dom.js';

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const banner = $('#updateBanner');
  let refreshing = false;
  let waitingWorker = null;

  function showBanner(worker) {
    waitingWorker = worker;
    banner.classList.add('show');
  }
  $('#updateReload').addEventListener('click', () => {
    if (waitingWorker) waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    banner.classList.remove('show');
  });
  $('#updateDismiss').addEventListener('click', () => banner.classList.remove('show'));

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  const start = async () => {
    try {
      const reg = await navigator.serviceWorker.register('service-worker.js');
      if (reg.waiting && navigator.serviceWorker.controller) showBanner(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showBanner(nw);
        });
      });
      // Kiểm tra bản mới khi quay lại app
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    } catch (e) {
      console.warn('SW register failed', e);
    }
  };
  // boot() là async → sự kiện load có thể đã qua; đăng ký ngay nếu trang đã tải xong
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
