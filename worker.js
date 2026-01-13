/* worker.js — Beauty Booking PWA Service Worker (stable) */
const CACHE = "bb-cache-v4";

// Core shell
const CORE = [
  "./",
  "./index.html",
  "./profile.html",
  "./data.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE.map(u => new Request(u, { cache: "reload" })));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

// Network-first for HTML/JS, cache-first for images/fonts, stale-while-revalidate for others
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only same-origin
  if (url.origin !== location.origin) return;

  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  const isJS = url.pathname.endsWith(".js");
  const isCSS = url.pathname.endsWith(".css");
  const isIMG = /\.(png|jpg|jpeg|webp|svg|gif)$/i.test(url.pathname);
  const isFONT = /\.(woff2?|ttf|otf)$/i.test(url.pathname);

  if (isHTML || isJS || isCSS) {
    event.respondWith(networkFirst(req));
    return;
  }

  if (isIMG || isFONT) {
    event.respondWith(cacheFirst(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((fresh) => {
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  }).catch(() => null);

  return cached || (await fetchPromise) || new Response("Offline", { status: 503 });
}


