/* worker.js — PWA Service Worker (production only) */
const CACHE = "bb-cache-v1";
const CORE = [
  "./",
  "./index.html",
  "./profile.html",
  "./data.js",
  "./manifest.webmanifest",
  "./favicon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k===CACHE?null:caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Network-first for html/js (so updates always arrive)
  const isHTML = req.mode === "navigate" || (req.headers.get("accept")||"").includes("text/html");
  const isJS = url.pathname.endsWith(".js");

  if (isHTML || isJS){
    event.respondWith(
      fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(CACHE).then(c=>c.put(req, copy)).catch(()=>{});
        return res;
      }).catch(()=>caches.match(req).then(r=>r || caches.match("./index.html")))
    );
    return;
  }

  // Cache-first for images/fonts
  event.respondWith(
    caches.match(req).then(cached=>{
      if(cached) return cached;
      return fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(CACHE).then(c=>c.put(req, copy)).catch(()=>{});
        return res;
      });
    })
  );
});
