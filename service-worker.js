const CACHE_NAME = "packrat-inventory-v5-runtime-8";
const APP_PATHS = [
  "./",
  "./index.html",
  "./ocr-priority-patch.js",
  "./ocr-hard-rules.js",
  "./ocr-compact-variations.js",
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
const OCR_PATCH_TAGS = [
  '<script src="./ocr-priority-patch.js"></script>',
  '<script src="./ocr-hard-rules.js"></script>',
  '<script src="./ocr-compact-variations.js"></script>'
];

async function injectOcrPriorityPatch(response) {
  if (!response) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  const missingTags = OCR_PATCH_TAGS.filter(tag => !html.includes(tag));
  if (missingTags.length) {
    const injection = missingTags.join("\n");
    html = html.includes("</body>")
      ? html.replace("</body>", injection + "\n</body>")
      : html + injection;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

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
        return injectOcrPriorityPatch(response);
      } catch {
        const cachedResponse = (await caches.match(INDEX_URL)) || (await caches.match(ROOT_URL));
        return injectOcrPriorityPatch(cachedResponse);
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
