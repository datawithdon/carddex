// Offline shell: same-origin files are served cache-first and refreshed in the
// background. Cross-origin requests (card API, images, Claude) are never cached here.

const CACHE = "carddex-v1";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/styles.css", "icons/icon.svg",
  "js/app.js", "js/dom.js", "js/store.js", "js/api.js", "js/match.js", "js/identify.js", "js/ocr.js", "js/ai.js", "js/prices.js", "js/ui.js",
  "js/views/scan.js", "js/views/search.js", "js/views/collection.js", "js/views/sets.js", "js/views/wishlist.js", "js/views/settings.js",
  "vendor/tesseract/tesseract.esm.min.js", "vendor/tesseract/worker.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((res) => {
      if (res.ok && res.type === "basic") cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fresh;
  }));
});
