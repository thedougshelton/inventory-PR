const CACHE_NAME = "packrat-inventory-v5-runtime-1";
const APP_PATHS = [
  "./",
  "./index.html",
  "./vendor/xlsx.bundle.js",
  "./vendor/tesseract.min.js",
  "./vendor/tesseract-worker.min.js",
  "./vendor/tesseract-core.wasm.js",
  "./vendor/tesseract-core-simd.wasm.js",
  "./vendor/tesseract-core-lstm.wasm.js",
  "./vendor/tesseract-core-simd-lstm.wasm.js",
  "./vendor/eng.traineddata.gz"
];
const APP_FILES = APP_PATHS.map(path => new URL(path, self.location.href).href);
const INDEX_URL = new URL("./index.html", self.location.href).href;
const ROOT_URL = new URL("./", self.location.href).href;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(APP_FILES.map(url => cache.add(new Request(url, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith("packrat-inventory-") && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(INDEX_URL, response.clone());
        return response;
      } catch {
        return (await caches.match(INDEX_URL)) || (await caches.match(ROOT_URL));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, response.clone());
    }
    return response;
  })());
});
