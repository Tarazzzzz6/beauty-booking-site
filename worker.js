// ============================================================
// Booking Club — Cloudflare Worker v2
// ------------------------------------------------------------
// Що вміє:
// 1) POST /book, /join — бронювання і заявки салонів:
//    повідомлення летить САЛОНУ (якщо у бронювання є chatId салону)
//    + копія власнику платформи (CHAT_ID).
// 2) Telegram webhook (POST з update_id) — команди салону:
//    /start або /myid  → бот відповідає Telegram ID салону
//    /close 2026-11-03 → закрити день (немає слотів)
//    /open  2026-11-03 → відкрити день назад
//    /closed           → список закритих днів
//    Графік зберігається у KV (binding BC_KV), сайт читає його
//    через GET /schedule?chat=<chatId> і ховає закриті дні.
// 3) Календар бронювань у KV: успішний POST /book зберігає запис
//    (код BK-XXXXXX). GET /booked?listing=<id>&date=<iso> віддає тільки
//    зайняті часи (без персональних даних) — сайт ховає ці слоти.
//    Команди салону: /bookings — найближчі записи, /cancel BK-XXXXXX —
//    скасувати запис (слот звільняється).
// 4) GET /p?site=..&id=.. — OG-превʼю для шарингу профілів.
//
// 🔐 НАЛАШТУВАННЯ (робить власник у Cloudflare, 5 хвилин — див. SETUP-OWNER.md):
// - Secret BOT_TOKEN (новий, старий відкликати в BotFather)
// - Variable CHAT_ID — Telegram ID власника (копії всіх бронювань)
// - KV binding BC_KV (інакше команди графіка відповідають, що сховище не підключено)
// - Webhook: відкрити у браузері
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<URL цього воркера>
// ⚠️ НЕ деплоїти, поки BOT_TOKEN не додано в секрети — бронювання впадуть з 500.
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    // У цьому воркері секрети історично названі TG_BOT_TOKEN / TG_CHAT_ID —
    // підтримуємо обидва варіанти імен.
    const BOT_TOKEN = (env && (env.TG_BOT_TOKEN || env.BOT_TOKEN)) || "";
    const OWNER_CHAT = (env && (env.TG_CHAT_ID || env.CHAT_ID)) || "7384123064";
    const KV = (env && env.BC_KV) || null;

    async function tgSend(chatId, text) {
      const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
      });
      return resp.ok;
    }

    // ---------- Telegram webhook: команди салону ----------
    if (request.method === "POST") {
      let peek = null;
      try { peek = await request.clone().json(); } catch { /* not json */ }
      if (peek && typeof peek.update_id === "number") {
        if (!BOT_TOKEN) return new Response("ok", { headers: corsHeaders });
        const msg = peek.message || peek.edited_message;
        if (msg && msg.chat && msg.text) {
          const chatId = String(msg.chat.id);
          const textIn = String(msg.text).trim();
          const reply = await handleBotCommand(textIn, chatId, KV);
          if (reply) await tgSend(chatId, reply);
        }
        return new Response("ok", { headers: corsHeaders });
      }
    }

    // ---------- OG preview ----------
    if (request.method === "GET" && (url.pathname === "/p" || url.pathname === "/p/")) {
      const site = url.searchParams.get("site") || "";
      const id = url.searchParams.get("id") || "";
      const OG = {
        "iryna-stovban": { title: "Iryna Stovban — Booking Club", desc: "Манікюр для моделей • стерильно • делікатно", img: "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1400&q=80" },
        "romanukova-nails": { title: "Romanukova Nail Studio — Booking Club", desc: "Преміум манікюр • педикюр • швидкі слоти", img: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1400&q=80" }
      };
      const p = OG[id] || { title: "Booking Club — Montréal", desc: "Book beauty in seconds — verified salons & masters in Montréal.", img: "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1400&q=80" };
      const redirect = site ? `${site}profile.html?id=${encodeURIComponent(id)}` : "";
      const html = `<!doctype html><html><head><meta charset="utf-8" />
<meta property="og:title" content="${escapeHtml(p.title)}" />
<meta property="og:description" content="${escapeHtml(p.desc)}" />
<meta property="og:type" content="website" />
<meta property="og:image" content="${escapeHtml(p.img)}" />
<meta name="twitter:card" content="summary_large_image" />
${redirect ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(redirect)}" />` : ""}
<title>${escapeHtml(p.title)}</title></head>
<body style="background:#0b0b10;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center;opacity:.85">Opening…</div>
${redirect ? `<script>location.replace(${JSON.stringify(redirect)});</script>` : ""}
</body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders } });
    }

    // ---------- Графік салону для сайту ----------
    if (request.method === "GET" && url.pathname === "/schedule") {
      const chat = url.searchParams.get("chat") || "";
      let out = { closed: [] };
      if (KV && /^\d{5,}$/.test(chat)) {
        try {
          const raw = await KV.get("sched:" + chat);
          if (raw) out = JSON.parse(raw);
        } catch { /* ignore */ }
      }
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // ---------- Календар: зайняті часи лістинга на дату ----------
    if (request.method === "GET" && url.pathname === "/booked") {
      const listingParam = url.searchParams.get("listing") || "";
      const chatParam = url.searchParams.get("chat") || "";
      const date = url.searchParams.get("date") || "";
      let times = [];
      if (KV && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const key = sanitizeListingKey(listingParam) || (/^\d{5,}$/.test(chatParam) ? "chat-" + chatParam : "");
        if (key) {
          try {
            const keys = await kvListKeys(KV, BK_PREFIX + key + "|" + date + "|");
            const set = new Set();
            for (const k of keys) {
              const rec = await readBookingRec(KV, k);
              if (rec && rec.time) set.add(rec.time);
            }
            times = Array.from(set).sort();
          } catch { /* ignore */ }
        }
      }
      return new Response(JSON.stringify({ times }), { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (request.method === "GET") {
      return new Response("OK", { headers: { ...corsHeaders } });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { ...corsHeaders } });
    }

    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return new Response("Bad content-type", { status: 400, headers: { ...corsHeaders } });
    }

    let data;
    try { data = await request.json(); } catch {
      return new Response("Invalid JSON", { status: 400, headers: { ...corsHeaders } });
    }

    const name = String(data?.name || "").trim();
    const phone = String(data?.phone || "").trim();
    if (!name || !phone) {
      return new Response("name+phone required", { status: 400, headers: { ...corsHeaders } });
    }
    if (String(data?.hp || "").trim()) {
      return new Response("blocked", { status: 400, headers: { ...corsHeaders } });
    }
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    if (!rateLimit(ip, Date.now())) {
      return new Response("rate_limited", { status: 429, headers: { ...corsHeaders } });
    }
    if (!BOT_TOKEN) {
      return new Response("TG_BOT_TOKEN/BOT_TOKEN missing", { status: 500, headers: { ...corsHeaders } });
    }

    // ---------- Календар бронювань (KV): перевірка зайнятості слота ----------
    const salonChatEarly = String(data?.chatId || "").trim();
    const bk = extractBooking(data);
    let bkKey = "", bkRecId = "";
    if (bk && KV) {
      bkRecId = makeBookingId();
      bkKey = sanitizeListingKey(data?.listingId) || (/^\d{5,}$/.test(salonChatEarly) ? "chat-" + salonChatEarly : "anon");
      try {
        const keys = await kvListKeys(KV, BK_PREFIX + bkKey + "|" + bk.dateISO + "|");
        for (const k of keys) {
          const r = await readBookingRec(KV, k);
          if (r && r.time === bk.time) {
            return new Response("slot_taken", { status: 409, headers: { ...corsHeaders } });
          }
        }
      } catch { /* KV недоступний — бронювання не блокуємо */ }
    }

    let text = (data?.message && String(data.message).trim())
      ? String(data.message).trim()
      : buildTextFallback(data);
    if (bkRecId) text += "\n\n🆔 Код бронювання: " + bkRecId + "\nСкасувати: /cancel " + bkRecId;

    // Маршрутизація: салону (якщо є його chatId) + завжди копія власнику
    const targets = [];
    const salonChat = String(data?.chatId || "").trim();
    if (/^\d{5,}$/.test(salonChat) && salonChat !== OWNER_CHAT) targets.push(salonChat);
    targets.push(OWNER_CHAT);

    let sent = 0;
    for (const t of targets) {
      if (await tgSend(t, text)) sent++;
    }
    if (!sent) {
      return new Response("telegram_error", { status: 502, headers: { ...corsHeaders } });
    }

    // Зберігаємо бронювання у KV-календар: слот стає зайнятим для інших клієнтів
    if (bk && KV && bkKey && bkRecId) {
      try {
        const rec = {
          id: bkRecId,
          listingId: String(data?.listingId || ""),
          listingKey: bkKey,
          listingName: String(data?.listingName || ""),
          chatId: salonChatEarly,
          dateISO: bk.dateISO,
          time: bk.time,
          serviceName: bk.serviceName,
          name, phone,
          createdAt: new Date().toISOString()
        };
        await KV.put(BK_PREFIX + bkKey + "|" + bk.dateISO + "|" + bk.time + "|" + bkRecId, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 90 });
        // звʼязка chatId салону → listingId (для команд /bookings і /cancel)
        if (/^\d{5,}$/.test(salonChatEarly) && data?.listingId) {
          try {
            const raw = await KV.get("salonmap");
            const map = raw ? JSON.parse(raw) : {};
            map[salonChatEarly] = String(data.listingId);
            await KV.put("salonmap", JSON.stringify(map));
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
    return new Response("ok", { headers: { ...corsHeaders } });
  }
};

// ---------- Команди бота для салонів ----------
async function handleBotCommand(textIn, chatId, KV) {
  const parts = textIn.split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase().replace(/@.*$/, "");
  const arg = parts[1] || "";
  const ID_MSG =
    "👋 Вітаю у Booking Club!\n\n" +
    "Ваш Telegram ID: " + chatId + "\n\n" +
    "Вкажіть цей ID у формі підключення салону (bookingclub.beauty/join) — і бронювання з сайту приходитимуть прямо сюди.\n\n" +
    "Мої бронювання:\n" +
    "/bookings — найближчі записи клієнтів\n" +
    "/cancel BK-XXXXXX — скасувати запис (слот знову стане вільним на сайті)\n\n" +
    "Керування графіком:\n" +
    "/close 2026-11-03 — закрити день (відпустка, вихідний)\n" +
    "/open 2026-11-03 — відкрити день назад\n" +
    "/closed — список закритих днів";

  if (cmd === "/start" || cmd === "/myid" || cmd === "/id") return ID_MSG;
  if (cmd === "/help") return ID_MSG;

  if (cmd === "/bookings" || cmd === "/cancel") {
    if (!KV) {
      return "⚠️ Сховище бронювань ще не підключено власником платформи. Ваш ID: " + chatId + " — передайте його власнику, він завершить налаштування.";
    }
    const mine = await salonBookings(KV, chatId);
    if (cmd === "/bookings") {
      const fromISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const upcoming = mine
        .filter(b => b.dateISO >= fromISO)
        .sort((a, b) => (a.dateISO + "T" + a.time).localeCompare(b.dateISO + "T" + b.time))
        .slice(0, 12);
      if (!upcoming.length) {
        return "📭 У вас поки немає бронювань. Щойно клієнт запишеться на сайті — запис прийде окремим повідомленням і зʼявиться тут.";
      }
      const lines = upcoming.map(b =>
        "📅 " + b.dateISO + " о " + b.time + " — " + (b.serviceName || "Послуга") + "\n" +
        "👤 " + (b.name || "") + (b.phone ? " · " + b.phone : "") + "\n" +
        "🆔 " + b.id + " · скасувати: /cancel " + b.id
      );
      return "📖 Ваші найближчі бронювання:\n\n" + lines.join("\n\n");
    }
    // /cancel BK-XXXXXX
    let want = (arg || "").toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(want)) want = "BK-" + want;
    if (!/^BK-[A-Z0-9]{6}$/.test(want)) {
      return "Формат: /cancel BK-XXXXXX — код бронювання є у повідомленні про запис і у списку /bookings";
    }
    const rec = mine.find(b => b.id === want);
    if (!rec) return "Не знайшов бронювання " + want + " серед ваших. Перевірте код у /bookings";
    try { await KV.delete(rec._key); } catch {
      return "⚠️ Не вдалось скасувати — спробуйте ще раз трохи пізніше.";
    }
    return "✅ Бронювання " + want + " скасовано: " + rec.dateISO + " о " + rec.time + (rec.name ? " (" + rec.name + ")" : "") + ". Слот знову вільний на сайті.";
  }

  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(arg);
  if (cmd === "/close" || cmd === "/open" || cmd === "/closed") {
    if (!KV) {
      return "⚠️ Сховище графіків ще не підключено власником платформи. Ваш ID: " + chatId + " — передайте його власнику, він завершить налаштування.";
    }
    const key = "sched:" + chatId;
    let sched = { closed: [] };
    try {
      const raw = await KV.get(key);
      if (raw) sched = JSON.parse(raw);
    } catch { /* ignore */ }
    if (cmd === "/closed") {
      return sched.closed.length
        ? "🔒 Закриті дні:\n" + sched.closed.sort().join("\n") + "\n\nВідкрити: /open РРРР-ММ-ДД"
        : "У вас немає закритих днів — сайт показує слоти за звичайним графіком.";
    }
    if (!isDate) return "Формат дати: РРРР-ММ-ДД, наприклад /close 2026-11-03";
    if (cmd === "/close") {
      if (!sched.closed.includes(arg)) sched.closed.push(arg);
      await KV.put(key, JSON.stringify(sched));
      return "🔒 " + arg + " — день закрито. На сайті слотів на цю дату не буде.";
    }
    sched.closed = sched.closed.filter(d => d !== arg);
    await KV.put(key, JSON.stringify(sched));
    return "✅ " + arg + " — день знову відкрито за звичайним графіком.";
  }
  return "Команди Booking Club: /myid — ваш ID, /bookings — мої бронювання, /cancel BK-XXXXXX — скасувати бронювання, /close ДАТА — закрити день, /open ДАТА — відкрити, /closed — закриті дні.";
}

// ---------- Календар бронювань у KV ----------
// Ключ запису: bk|<listingKey>|<dateISO>|<time>|<BK-id>, значення — JSON-запис.
// listingKey — санітизований listingId; fallback: "chat-<chatId салону>", далі "anon".
const BK_PREFIX = "bk|";

function sanitizeListingKey(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 80);
}

function makeBookingId() {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // без схожих символів (0/O, 1/I/L)
  let s = "";
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return "BK-" + s;
}

// Витягує дату/час бронювання з payload сайту (dateISO+time або datetimeISO).
// Для заявок салонів (salon_join) і некоректних даних повертає null.
function extractBooking(d) {
  if (!d || d.type === "salon_join") return null;
  let dateISO = String(d.dateISO || "").trim();
  let time = String(d.time || "").trim();
  if ((!dateISO || !time) && d.datetimeISO) {
    const m = String(d.datetimeISO).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if (m) { if (!dateISO) dateISO = m[1]; if (!time) time = m[2]; }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return { dateISO, time, serviceName: String(d.serviceName || "") };
}

async function kvListKeys(KV, prefix) {
  const out = [];
  let cursor;
  do {
    const res = await KV.list({ prefix, cursor, limit: 1000 });
    for (const k of (res.keys || [])) out.push(k.name);
    cursor = res && !res.list_complete ? res.cursor : undefined;
  } while (cursor);
  return out;
}

async function readBookingRec(KV, key) {
  try {
    const raw = await KV.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Усі бронювання, що належать салону з цим chatId: прямого chatId у записі,
// через звʼязку salonmap (chatId → listingId) або через ключ "chat-<chatId>".
async function salonBookings(KV, chatId) {
  let listingId = "";
  try {
    const raw = await KV.get("salonmap");
    if (raw) listingId = (JSON.parse(raw) || {})[chatId] || "";
  } catch { /* ignore */ }
  const keys = await kvListKeys(KV, BK_PREFIX);
  const out = [];
  for (const k of keys) {
    const rec = await readBookingRec(KV, k);
    if (!rec) continue;
    if (rec.chatId === chatId || (listingId && rec.listingId === listingId) || rec.listingKey === "chat-" + chatId) {
      rec._key = k;
      out.push(rec);
    }
  }
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const RL = new Map();
function rateLimit(ip, now) {
  const W = 30_000, MAX = 3;
  const v = RL.get(ip);
  if (!v) { RL.set(ip, { t: now, count: 1 }); return true; }
  if (now - v.t > W) { RL.set(ip, { t: now, count: 1 }); return true; }
  if (v.count >= MAX) return false;
  v.count += 1; RL.set(ip, v);
  return true;
}

function buildTextFallback(d) {
  if (d?.type === "salon_join") {
    const lines = [];
    lines.push("🆕 ЗАЯВКА САЛОНУ на Booking Club");
    lines.push("");
    lines.push(`Салон: ${d?.salonName || "—"}`);
    lines.push(`Контакт: ${d?.name || ""}`);
    lines.push(`Телефон: ${d?.phone || ""}`);
    if (d?.email) lines.push(`Email: ${d.email}`);
    if (d?.address) lines.push(`Адреса: ${d.address}`);
    if (d?.district) lines.push(`Район: ${d.district}`);
    if (d?.telegramChatId) lines.push(`Telegram ID салону: ${d.telegramChatId}`);
    if (Array.isArray(d?.services) && d.services.length) lines.push(`Послуги: ${d.services.join(", ")}`);
    if (Array.isArray(d?.languages) && d.languages.length) lines.push(`Мови: ${d.languages.join(", ")}`);
    if (d?.plan) lines.push(`Тариф: ${d.plan}`);
    if (d?.instagram) lines.push(`Instagram: ${d.instagram}`);
    if (d?.comment) { lines.push(""); lines.push(`Коментар: ${d.comment}`); }
    lines.push("");
    lines.push("#salon_join");
    return lines.join("\n");
  }
  const lines = [];
  lines.push("Нове бронювання ✨");
  lines.push("");
  if (d?.listingName) lines.push(`Салон: ${d.listingName}`);
  if (d?.serviceName) lines.push(`Послуга: ${d.serviceName}`);
  const when = `${d?.dateISO || d?.date || "—"} ${d?.time || ""}`.trim();
  lines.push(`Час: ${when}`);
  if (d?.priceFrom != null) lines.push(`Ціна від: $${d.priceFrom}`);
  if (d?.deposit) lines.push(`🛡️ Депозит проти no-show: $${d.deposit} (клієнт погодився)`);
  lines.push(`Імʼя: ${d?.name || ""}`.trim());
  lines.push(`Телефон: ${d?.phone || ""}`.trim());
  if (d?.email) lines.push(`Email: ${d.email}`);
  if (d?.address) lines.push(`Адреса: ${d.address}`);
  if (d?.profileUrl) lines.push(`Профіль: ${d.profileUrl}`);
  if (d?.mapsUrl) lines.push(`Карта: ${d.mapsUrl}`);
  lines.push("");
  lines.push("#beautybooking");
  return lines.join("\n");
}
