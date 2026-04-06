/* worker.js — Beauty Booking PWA (GitHub Edition) */
const CACHE_NAME = "bb-v" + "2024.05.28.1"; // Змінюй цю дату при пуші в GitHub, щоб скинути кеш у всіх

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./profile.html",
  "./data.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@300;400;600&display=swap"
];

// 1. ВСТАНОВЛЕННЯ: Кешуємо базу миттєво
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 2. АКТИВАЦІЯ: Чистимо старі версії (щоб GitHub Pages не тупив)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// 3. СТРАТЕГІЯ FETCH: "Network First, then Offline Page"
self.addEventListener("fetch", (event) => {
  const req = event.request;
  
  // Не кешуємо запити до Worker (Telegram) — вони мають бути тільки Live
  if (req.url.includes("workers.dev")) {
    return; 
  }

  event.respondWith(
    fetch(req)
      .then(res => {
        // Якщо мережа ок — оновлюємо кеш і віддаємо ресурс
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return res;
      })
      .catch(() => {
        // Якщо мережі нема — беремо з кешу
        return caches.match(req).then(cached => {
          if (cached) return cached;
          
          // Якщо немає навіть в кеші (наприклад, нова сторінка)
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});

// 4. OFFLINE QUEUE (Профі-фішка)
// Якщо ти додаси логіку збереження заявок в IndexedDB, 
// цей воркер зможе відправити їх автоматично, коли з'явиться інет.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-bookings') {
    console.log('🚀 Знайдено чергу заявок. Відправляємо в Telegram...');
    // Тут буде виклик функції відправки
  }
});
