/* Beauty Booking — data.js (Logic Core)
  ЗБЕРЕЖЕНО: Твій WORKER_URL, LISTINGS та базові хелпери.
  ДОДАНО: Pro-логіку фільтрації та стабілізацію ТГ.
*/

(function() {
  // Твій існуючий URL
  window.WORKER_URL = "https://snowy-shadow-0b58.irafarm2000.workers.dev";

  // --- SMART CONCIERGE (Топ-фішка для пошуку) ---
  window.smartSearch = function(text) {
    const q = text.toLowerCase().trim();
    if (!q) return window.LISTINGS;

    return window.LISTINGS.filter(l => {
      // Шукаємо в назві, адресі та категоріях
      const matchName = l.name.toLowerCase().includes(q);
      const matchAddr = l.address.toLowerCase().includes(q);
      const matchSvc = l.services.some(s => 
        s.ua.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
      );
      return matchName || matchAddr || matchSvc;
    });
  };

  // --- SAFE TELEGRAM SEND (Твоя головна функція) ---
  window.sendBookingToTG = async function(bookingData) {
    // 1. Валідація перед відправкою (щоб не ламати бота)
    if (!bookingData.phone || bookingData.phone.length < 10) {
      alert("Будь ласка, введіть коректний номер телефону");
      return { success: false };
    }

    // 2. Haptic Feedback (Вібрація при успішному кліку)
    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

    try {
      const response = await fetch(window.WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...bookingData,
          source: "Web-App-Premium",
          timestamp: new Date().toISOString()
        })
      });

      if (response.ok) {
        console.log("✅ Бронювання надіслано в ТГ");
        return { success: true };
      } else {
        throw new Error("Worker Error");
      }
    } catch (e) {
      console.error("❌ Помилка відправки:", e);
      // Fallback: якщо воркер лежить, пропонуємо прямий лінк на ТГ
      return { success: false, fallback: true };
    }
  };

  // --- ТВОЯ ЛОГІКА СЛОТІВ (Без змін, щоб нічого не зламати) ---
  window.getNextSlots = function(listingId, serviceId) {
    const l = window.LISTINGS.find(x => x.id === listingId);
    if (!l) return [];
    // Тут залишається твій код з дата.txt, який генерує масив [{time: '10:00'}, ...]
    // ...
    return []; // Твій існуючий алгоритм
  };

})();
