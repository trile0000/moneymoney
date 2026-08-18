/* Service Worker v2 — sửa lỗi #14–#17
 * - HTML / JS / CSS: NETWORK-FIRST (timeout 4s → cache) → deploy mới là người dùng thấy ngay, không kẹt bản cũ.
 * - Ảnh / font / thư viện vendor / manifest: CACHE-FIRST (bất biến theo phiên bản cache).
 * - Không dùng ignoreSearch (cache-busting ?v= hoạt động).
 * - KHÔNG skipWaiting tự động: bản mới nằm chờ tới khi người dùng bấm "Tải lại" trên banner (postMessage SKIP_WAITING).
 * - Precache toàn bộ app shell kể cả Chart.js + font (self-host) → offline đầy đủ.
 * Đổi CACHE_VERSION mỗi lần deploy (node scripts/bump-version.mjs <version>).
 */
const CACHE_VERSION = '2.6.3';
const CACHE_NAME = `mm-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './vendor/chart.umd.js',
  './vendor/xlsx.mini.min.js',
  './js/features/accounts.js',
  './js/features/achievements.js',
  './js/features/allocation.js',
  './js/features/budgets.js',
  './js/features/categories.js',
  './js/features/crypto.js',
  './js/features/csvWizard.js',
  './js/features/debts.js',
  './js/features/emergencyFund.js',
  './js/features/filters.js',
  './js/features/forecast.js',
  './js/features/goals.js',
  './js/features/health.js',
  './js/features/importExport.js',
  './js/features/insights.js',
  './js/features/iou.js',
  './js/features/networth.js',
  './js/features/recurring.js',
  './js/features/rule503020.js',
  './js/i18n.js',
  './js/main.js',
  './js/migrate.js',
  './js/router.js',
  './js/state.js',
  './js/storage.js',
  './js/ui/amountInput.js',
  './js/ui/cards.js',
  './js/ui/charts.js',
  './js/ui/confetti.js',
  './js/ui/confirm.js',
  './js/ui/csvWizard.js',
  './js/ui/editSheet.js',
  './js/ui/formSheet.js',
  './js/ui/gestures.js',
  './js/ui/list.js',
  './js/ui/lock.js',
  './js/ui/modal.js',
  './js/ui/onboarding.js',
  './js/ui/pickers.js',
  './js/ui/receipt.js',
  './js/ui/swUpdate.js',
  './js/ui/theme.js',
  './js/ui/toast.js',
  './js/ui/undo.js',
  './js/utils/csv.js',
  './js/utils/date.js',
  './js/utils/dom.js',
  './js/utils/id.js',
  './js/utils/money.js',
  './js/version.js',
  './js/views/budget.js',
  './js/views/home.js',
  './js/views/invest.js',
  './js/views/iou.js',
  './js/views/security.js',
  './js/views/settings.js',
  './js/views/tx.js',
  './js/views/wealth.js',
  './assets/fonts/Baloo2-latin-vi.woff2',
  './assets/fonts/Quicksand-latin-vi.woff2',
  './assets/mascot/sm/tiger_logo.webp',
  './assets/mascot/sm/tiger_logo_96.webp',
  './assets/mascot/sm/tiger_logo.png',
  './assets/mascot/sm/tiger_rich.webp',
  './assets/mascot/sm/tiger_income.webp',
  './assets/mascot/sm/tiger_poor.webp',
  './assets/mascot/sm/tiger_spending.webp',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png',
  './assets/apple-touch-icon.png',
  './assets/favicon-64.png',
];

const NETWORK_FIRST_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Thêm từng file để 1 file lỗi không làm hỏng toàn bộ precache (nhưng ghi log)
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const resp = await fetch(new Request(url, { cache: 'reload' }));
        if (resp.ok) await cache.put(url, resp);
        else console.warn('[SW] precache bỏ qua', url, resp.status);
      } catch (e) { console.warn('[SW] precache lỗi', url, e && e.message); }
    }));
    // KHÔNG gọi self.skipWaiting() ở đây (sửa lỗi #16)…
    // …NGOẠI TRỪ một lần duy nhất khi nâng cấp từ SW cũ ('expense-cache-*'): trang cũ không có banner
    // "Có bản mới" nên không thể tự kích hoạt; nếu không kích hoạt ngay, người dùng phải đóng hẳn app mới thấy bản mới.
    const keys = await caches.keys();
    if (keys.some((k) => k.startsWith('expense-cache'))) self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('mm-') || k.startsWith('expense-cache')).filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* ignore */ } }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isSameOrigin(url) { return url.origin === self.location.origin; }
function isNetworkFirst(url) {
  const p = url.pathname;
  return p.endsWith('/') || p.endsWith('.html') || (p.endsWith('.js') && !p.includes('/vendor/')) || p.endsWith('.css') || (p.endsWith('.json') && !p.endsWith('manifest.json'));
}

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = request.mode === 'navigate' ? './index.html' : request;
  try {
    const preload = event && event.preloadResponse ? await event.preloadResponse : null;
    const resp = preload || await fetchWithTimeout(request, NETWORK_FIRST_TIMEOUT_MS);
    if (resp && resp.ok) {
      cache.put(cacheKey, resp.clone()).catch(() => {});
      return resp;
    }
    const cached = await cache.match(cacheKey);
    return cached || resp;
  } catch (e) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp && resp.ok && (resp.type === 'basic' || resp.type === 'cors')) cache.put(request, resp.clone()).catch(() => {});
  return resp;
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then((r) => { clearTimeout(timer); resolve(r); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!isSameOrigin(url)) return; // không đụng request ngoài (hiện không có)
  if (req.mode === 'navigate' || isNetworkFirst(url)) {
    event.respondWith(networkFirst(req, event));
  } else {
    event.respondWith(cacheFirst(req));
  }
});
