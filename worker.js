/* worker.js — Beauty Booking PWA Service Worker (stable production) */
const CACHE = "bb-cache-v4"; // bump when you deploy changes

// Core app shell (same-origin)
const CORE = [
  "./",
  "./index.html",
  "./profile.html",
  "./data.js",
  "./manifest.webmanifest",
  "./favicon.svg",

  // iOS / PWA icons (add if you have them)
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // AddAll can fail if some icon doesn't exist -> be resilient:
      await Promise.all(
        CORE.map(async (u) => {
          try {
            await cache.add(u);
          } catch (_) {
            // ignore missing optional files
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

function isHTMLRequest(req) {
  return req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
}
function isJSRequest(url) {
  return url.pathname.endsWith(".js");
}
function isCSSRequest(url) {
  return url.pathname.endsWith(".css");
}
function isSameOrigin(url) {
  return url.origin === self.location.origin;
}
function isIconOrManifest(url) {
  return (
    url.pathname.endsWith("manifest.webmanifest") ||
    url.pathname.endsWith("favicon.svg") ||
    url.pathname.includes("/icons/")
  );
}

// For caching keys: normalize same-origin navigations w/ query params to the clean path
function cacheKeyForRequest(req) {
  const url = new URL(req.url);
  if (isSameOrigin(url) && isHTMLRequest(req)) {
    // Always store navigations as their pathname only (no search)
    return new Request(url.pathname === "/" ? "./index.html" : url.pathname, {
      headers: req.headers,
      method: "GET",
    });
  }
  return req;
}

// Network-first for HTML/JS/CSS (updates come fast), fallback to cache
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const key = cacheKeyForRequest(req);

  try {
    const res = await fetch(req);
    // Only cache good responses
    if (res && res.ok) {
      try {
        await cache.put(key, res.clone());
      } catch (_) {}
    }
    return res;
  } catch (_) {
    const cached = await cache.match(key);
    if (cached) return cached;

    // last resort for navigation: app shell
    if (isHTMLRequest(req)) {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw _;
  }
}

// Cache-first for images/fonts/media
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;

  const res = await fetch(req);
  // Cache only successful, basic/opaque responses
  if (res && (res.ok || res.type === "opaque")) {
    try {
      await cache.put(req, res.clone());
    } catch (_) {}
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only GET
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Always ignore non-http(s)
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const html = isHTMLRequest(req);
  const js = isJSRequest(url);
  const css = isCSSRequest(url);

  // Same-origin important assets: keep them fresh
  if (isSameOrigin(url) && (html || js || css || isIconOrManifest(url))) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Images / fonts / media (including Unsplash): cache-first
  const isImage = req.destination === "image" || /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(url.pathname);
  const isFont = req.destination === "font" || /\.(woff2?|ttf|otf)$/i.test(url.pathname);

  if (isImage || isFont) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Default: try network, fallback cache
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        // If it's navigation, fallback to index
        if (html) return (await caches.match("./index.html")) || Response.error();
        return Response.error();
      }
    })()
  );
});
