const CACHE_NAME = "macrovault-mvp-v125";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./styles.css?v=125",
  "./styles-core.css",
  "./styles-core.css?v=125",
  "./styles-content.css",
  "./styles-content.css?v=125",
  "./styles-family.css",
  "./styles-family.css?v=125",
  "./styles-responsive.css",
  "./styles-responsive.css?v=125",
  "./app-core.js",
  "./app-core.js?v=125",
  "./app-views.js",
  "./app-views.js?v=125",
  "./app-editors.js",
  "./app-editors.js?v=125",
  "./app-features.js",
  "./app-features.js?v=125",
  "./app.js",
  "./app.js?v=125",
  "./frontend-utils.js",
  "./frontend-utils.js?v=116",
  "./barcode-nutrition.js",
  "./barcode-nutrition.js?v=114",
  "./zxing-browser.min.js",
  "./zxing-browser.min.js?v=107",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.includes("/api/")) return;
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
