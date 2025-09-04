const CACHE_NAME = "expense-cache-v2";
const OFFLINE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(OFFLINE_ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)));
    self.clients.claim();
  })());
});

// Cache-first for all requests; fall back to network if not cached
self.addEventListener("fetch", (event) => {
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const resp = await fetch(event.request);
      // Optionally cache new GET requests
      if (event.request.method === "GET" && resp && resp.status === 200 && resp.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, resp.clone());
      }
      return resp;
    } catch (e) {
      // If offline and request is navigation, serve index.html
      if (event.request.mode === "navigate") {
        return caches.match("./index.html");
      }
      throw e;
    }
  })());
});