// ============================================================
// Booking Club — Cloudflare Worker v4
// ------------------------------------------------------------
// Що вміє:
// 1) POST /book, /join — бронювання і заявки салонів:
//    повідомлення летить САЛОНУ (якщо у бронювання є chatId салону)
//    + копія власнику платформи (CHAT_ID). Відповідь — JSON
//    {"ok":true,"code":"BK-XXXXXX"} (код бронювання з календаря KV).
// 2) Telegram webhook (POST з update_id) — команди:
//    Салонам: /myid — ID і довідка, /bookings, /cancel BK-XXXXXX,
//             /close /open /closed — графік (KV, ключ sched:<chatId>).
//    Клієнтам: /start BK-XXXXXX (deep link із сайту) — привʼязка чату
//             до бронювання: підтвердження + нагадування; /cancel —
//             скасування власного запису (салон отримує сповіщення).
// 3) Календар бронювань у KV: успішний POST /book зберігає запис
//    (ключ bk|<listingKey>|<dateISO>|<time>|<BK-id> + індекс bkc|<код>).
//    Анти-дубль: той самий слот вдруге → 409 slot_taken.
//    GET /booked?listing=<id>&date=<iso> — зайняті часи (без перс. даних).
//    GET /schedule?chat=<chatId> — закриті дні салону.
// 4) Нагадування клієнтам: scan за записами з clientChatId — повідомлення
//    за ~24 год і ~2 год до візиту (час America/Toronto, ідемпотентно).
//    Виклики: scheduled handler (Cloudflare Cron) і GET /remind.
// 5) Кабінет салону (admin.html): POST /cabinet/code → код у Telegram,
//    POST /cabinet/login → сесійний токен (KV, 30 днів),
//    GET /cabinet/data?token=, POST /cabinet/schedule, POST /cabinet/prices
//    (цінові оверрайди у KV ovr:<listingId>; публічно — GET /overrides?listing=<id>).
// 6) Stripe-депозит $10 CAD: POST /deposit/checkout {code} → Checkout Session
//    (501, якщо немає STRIPE_SECRET_KEY); POST /stripe/webhook — перевірка
//    підпису STRIPE_WEBHOOK_SECRET, checkout.session.completed → depositPaid.
// 7) GET /p?site=..&id=.. — OG-превʼю для шарингу профілів.
//
// 🔐 НАЛАШТУВАННЯ — див. SETUP-OWNER.md (секрети тільки через env!):
// - TG_BOT_TOKEN (або BOT_TOKEN), TG_CHAT_ID (або CHAT_ID) — власник платформи
// - KV binding BC_KV, webhook на цей воркер
// - Опційно: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET; Cron Trigger (hourly)
// ============================================================

const BK_PREFIX = "bk|";
const BKI_PREFIX = "bkc|";
const BK_TTL = 60 * 60 * 24 * 90; // 90 днів

function getBotToken(env) { return (env && (env.TG_BOT_TOKEN || env.BOT_TOKEN)) || ""; }
function getOwnerChat(env) { return (env && (env.TG_CHAT_ID || env.CHAT_ID)) || "7384123064"; }

async function tgSendWith(token, chatId, text) {
  if (!token || !chatId) return false;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    });
    return resp.ok;
  } catch { return false; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const jsonResp = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    // У цьому воркері секрети історично названі TG_BOT_TOKEN / TG_CHAT_ID —
    // підтримуємо обидва варіанти імен.
    const BOT_TOKEN = getBotToken(env);
    const OWNER_CHAT = getOwnerChat(env);
    const KV = (env && env.BC_KV) || null;

    async function tgSend(chatId, text) { return tgSendWith(BOT_TOKEN, chatId, text); }

    // ---------- Telegram webhook: команди салону і клієнтів ----------
    if (request.method === "POST") {
      let peek = null;
      try { peek = await request.clone().json(); } catch { /* not json */ }
      if (peek && typeof peek.update_id === "number") {
        if (!BOT_TOKEN) return new Response("ok", { headers: corsHeaders });
        const msg = peek.message || peek.edited_message;
        if (msg && msg.chat && msg.text) {
          const chatId = String(msg.chat.id);
          const textIn = String(msg.text).trim();
          const reply = await handleBotCommand(textIn, chatId, KV, tgSend, OWNER_CHAT);
          if (reply) await tgSend(chatId, reply);
        }
        return new Response("ok", { headers: corsHeaders });
      }
    }

    // ---------- Stripe webhook (сирий body + перевірка підпису) ----------
    if (request.method === "POST" && url.pathname === "/stripe/webhook") {
      const secret = (env && env.STRIPE_WEBHOOK_SECRET) || "";
      if (!secret) return jsonResp({ error: "stripe_not_configured" }, 501);
      const rawBody = await request.text();
      const sigOk = await verifyStripeSignature(rawBody, request.headers.get("stripe-signature") || "", secret);
      if (!sigOk) return jsonResp({ error: "bad_signature" }, 400);
      let evt = null;
      try { evt = JSON.parse(rawBody); } catch { return jsonResp({ error: "bad_json" }, 400); }
      if (evt && evt.type === "checkout.session.completed") {
        const sess = (evt.data && evt.data.object) || {};
        const code = (sess.metadata && sess.metadata.booking_code) || sess.client_reference_id || "";
        if (code && KV) {
          try {
            const key = await KV.get(BKI_PREFIX + code);
            const rec = key ? await readBookingRec(KV, key) : null;
            if (rec && key) {
              rec.depositPaid = true;
              rec.depositSessionId = sess.id || rec.depositSessionId || "";
              rec.depositPaidAt = new Date().toISOString();
              await KV.put(key, JSON.stringify(rec), { expirationTtl: BK_TTL });
              const note = "💰 Депозит $10 оплачено (" + rec.id + ")\n" +
                "🏠 " + (rec.listingName || "") + "\n💅 " + (rec.serviceName || "Послуга") + "\n" +
                "📅 " + rec.dateISO + " о " + rec.time + "\n👤 " + (rec.name || "");
              if (rec.chatId && rec.chatId !== OWNER_CHAT) await tgSend(rec.chatId, note);
              await tgSend(OWNER_CHAT, note);
              if (rec.clientChatId) await tgSend(rec.clientChatId, "💰 Депозит $10 за бронювання " + rec.id + " оплачено. Дякуємо! Сума зарахується у вартість візиту.");
            }
          } catch { /* ignore */ }
        }
      }
      return jsonResp({ received: true });
    }

    // ---------- JSON API: кабінет, депозит ----------
    if (request.method === "POST" && ["/cabinet/code", "/cabinet/login", "/cabinet/schedule", "/cabinet/prices"].includes(url.pathname)) {
      let body = null;
      try { body = await request.json(); } catch { return jsonResp({ error: "bad_json" }, 400); }
      if (!KV) return jsonResp({ error: "kv_not_configured" }, 503);

      // --- Кабінет: запит коду входу ---
      if (url.pathname === "/cabinet/code") {
        const chatId = String(body?.chatId || "").trim();
        if (!/^\d{5,}$/.test(chatId)) return jsonResp({ error: "bad_chat_id" }, 400);
        if (!codeRateOk(chatId, Date.now())) return jsonResp({ error: "rate_limited" }, 429);
        const code = String(Math.floor(100000 + Math.random() * 900000));
        await KV.put("cabcode:" + chatId, JSON.stringify({ code, exp: Date.now() + 10 * 60 * 1000, tries: 0 }), { expirationTtl: 600 });
        const sentOk = await tgSend(chatId, "🔐 Код входу в кабінет Booking Club: " + code + "\nДіє 10 хвилин. Нікому його не пересилайте.");
        if (!sentOk) return jsonResp({ error: "telegram_error", hint: "Спочатку відкрийте бота @pershe1012_bot і натисніть Start" }, 502);
        return jsonResp({ ok: true });
      }

      // --- Кабінет: вхід за кодом ---
      if (url.pathname === "/cabinet/login") {
        const chatId = String(body?.chatId || "").trim();
        const code = String(body?.code || "").trim();
        const raw = await KV.get("cabcode:" + chatId);
        if (!raw) return jsonResp({ error: "code_expired" }, 401);
        let rec = null;
        try { rec = JSON.parse(raw); } catch { /* ignore */ }
        if (!rec || Date.now() > rec.exp) { await KV.delete("cabcode:" + chatId); return jsonResp({ error: "code_expired" }, 401); }
        if (rec.tries >= 5) return jsonResp({ error: "too_many_tries" }, 429);
        if (code !== rec.code) {
          rec.tries += 1;
          await KV.put("cabcode:" + chatId, JSON.stringify(rec), { expirationTtl: Math.max(60, Math.floor((rec.exp - Date.now()) / 1000)) });
          return jsonResp({ error: "bad_code" }, 401);
        }
        await KV.delete("cabcode:" + chatId);
        const token = randHex(24);
        await KV.put("cabsess:" + token, JSON.stringify({ chatId, exp: Date.now() + 30 * 86400000 }), { expirationTtl: 30 * 86400 });
        return jsonResp({ ok: true, token, chatId });
      }

      // --- Кабінет: потрібна сесія ---
      const sess = await getCabSession(KV, String(body?.token || ""));
      if (!sess) return jsonResp({ error: "unauthorized" }, 401);
      const chatId = sess.chatId;
      const listingId = await salonListingId(KV, chatId);

      if (url.pathname === "/cabinet/schedule") {
        const closedIn = Array.isArray(body?.closed) ? body.closed : null;
        if (!closedIn) return jsonResp({ error: "bad_closed" }, 400);
        const closed = Array.from(new Set(closedIn.map(x => String(x || "").trim()).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)))).sort();
        await KV.put("sched:" + chatId, JSON.stringify({ closed }));
        return jsonResp({ ok: true, closed });
      }

      if (url.pathname === "/cabinet/prices") {
        if (!listingId) return jsonResp({ error: "listing_not_linked" }, 404);
        const prices = sanitizePrices(body?.prices);
        if (!prices) return jsonResp({ error: "bad_prices" }, 400);
        await KV.put("ovr:" + sanitizeListingKey(listingId), JSON.stringify(prices));
        return jsonResp({ ok: true, prices });
      }

    }

    // --- Stripe-депозит: створення Checkout Session ---
    if (request.method === "POST" && url.pathname === "/deposit/checkout") {
      let body = null;
      try { body = await request.json(); } catch { return jsonResp({ error: "bad_json" }, 400); }
      const stripeKey = (env && env.STRIPE_SECRET_KEY) || "";
      if (!stripeKey) return jsonResp({ error: "stripe_not_configured" }, 501);
      if (!KV) return jsonResp({ error: "kv_not_configured" }, 503);
      const code = String(body?.code || "").trim().toUpperCase();
      if (!/^BK-[A-Z0-9]{6}$/.test(code)) return jsonResp({ error: "bad_code" }, 400);
      const key = await KV.get(BKI_PREFIX + code);
      const rec = key ? await readBookingRec(KV, key) : null;
      if (!rec || !key) return jsonResp({ error: "booking_not_found" }, 404);
      if (rec.depositPaid) return jsonResp({ error: "already_paid" }, 409);
      try {
        const form = new URLSearchParams();
        form.set("mode", "payment");
        form.set("line_items[0][quantity]", "1");
        form.set("line_items[0][price_data][currency]", "cad");
        form.set("line_items[0][price_data][unit_amount]", "1000");
        form.set("line_items[0][price_data][product_data][name]", "Booking deposit — Booking Club");
        form.set("success_url", "https://bookingclub.beauty/?deposit=success&code=" + encodeURIComponent(code));
        form.set("cancel_url", "https://bookingclub.beauty/?deposit=cancelled&code=" + encodeURIComponent(code));
        form.set("client_reference_id", code);
        form.set("metadata[booking_code]", code);
        const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + stripeKey, "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
        const sj = await resp.json().catch(() => null);
        if (!resp.ok || !sj || !sj.url) return jsonResp({ error: "stripe_error", detail: (sj && sj.error && sj.error.message) || resp.status }, 502);
        rec.depositSessionId = sj.id || "";
        await KV.put(key, JSON.stringify(rec), { expirationTtl: BK_TTL });
        return jsonResp({ ok: true, url: sj.url });
      } catch {
        return jsonResp({ error: "stripe_error" }, 502);
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

    // ---------- Цінові оверрайди салону (публічно, тільки ціни) ----------
    if (request.method === "GET" && url.pathname === "/overrides") {
      const listing = sanitizeListingKey(url.searchParams.get("listing") || "");
      let out = {};
      if (KV && listing) {
        try {
          const raw = await KV.get("ovr:" + listing);
          if (raw) out = JSON.parse(raw) || {};
        } catch { /* ignore */ }
      }
      return jsonResp(out);
    }

    // ---------- Кабінет: дані салону ----------
    if (request.method === "GET" && url.pathname === "/cabinet/data") {
      if (!KV) return jsonResp({ error: "kv_not_configured" }, 503);
      const sess = await getCabSession(KV, url.searchParams.get("token") || "");
      if (!sess) return jsonResp({ error: "unauthorized" }, 401);
      const chatId = sess.chatId;
      const listingId = await salonListingId(KV, chatId);
      const mine = await salonBookings(KV, chatId);
      const fromISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const bookings = mine
        .filter(b => b.dateISO >= fromISO)
        .sort((a, b) => (a.dateISO + "T" + a.time).localeCompare(b.dateISO + "T" + b.time))
        .slice(0, 100)
        .map(b => ({
          id: b.id, dateISO: b.dateISO, time: b.time, serviceName: b.serviceName || "",
          name: b.name || "", phone: b.phone || "",
          clientLinked: !!b.clientChatId, depositPaid: !!b.depositPaid,
          depositRequested: !!b.depositRequested,
        }));
      let closed = [];
      try {
        const raw = await KV.get("sched:" + chatId);
        if (raw) closed = (JSON.parse(raw) || {}).closed || [];
      } catch { /* ignore */ }
      let overrides = {};
      if (listingId) {
        try {
          const raw = await KV.get("ovr:" + sanitizeListingKey(listingId));
          if (raw) overrides = JSON.parse(raw) || {};
        } catch { /* ignore */ }
      }
      return jsonResp({ ok: true, chatId, listingId: listingId || "", bookings, closed, overrides });
    }

    // ---------- Нагадування: ручний запуск scan (ідемпотентний) ----------
    if (request.method === "GET" && url.pathname === "/remind") {
      const stats = await scanReminders(env);
      return jsonResp({ ok: true, ...stats });
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
          depositRequested: !!(data?.deposit && Number(data.deposit) > 0),
          createdAt: new Date().toISOString()
        };
        const fullKey = BK_PREFIX + bkKey + "|" + bk.dateISO + "|" + bk.time + "|" + bkRecId;
        await KV.put(fullKey, JSON.stringify(rec), { expirationTtl: BK_TTL });
        // індекс за кодом: клієнтський deep link /start, /cancel, Stripe-депозит
        await KV.put(BKI_PREFIX + bkRecId, fullKey, { expirationTtl: BK_TTL });
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
    // Відповідь сайту: JSON із кодом бронювання (старий текст "ok" — у git-історії v3)
    return jsonResp({ ok: true, code: bkRecId || null });
  },

  // ---------- Cron: нагадування клієнтам (див. scanReminders) ----------
  async scheduled(event, env, ctx) {
    const p = scanReminders(env);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
    else await p;
  }
};

// ---------- Команди бота: салони і клієнти ----------
// notify(chatId, text) — надсилання повідомлень іншим учасникам (салону/клієнту/власнику).
async function handleBotCommand(textIn, chatId, KV, notify, ownerChat) {
  const say = async (to, text) => { if (notify && to && to !== chatId) { try { await notify(to, text); } catch { /* ignore */ } } };
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

  // --- Клієнт: /start BK-XXXXXX (deep link із сайту після бронювання) ---
  if (cmd === "/start" && /^BK-[A-Z0-9]{6}$/i.test(arg || "")) {
    const code = arg.toUpperCase();
    if (!KV) return "⚠️ Сховище бронювань ще не підключено власником платформи. Спробуйте пізніше.";
    const key = await KV.get(BKI_PREFIX + code);
    const rec = key ? await readBookingRec(KV, key) : null;
    if (!rec || !key) {
      return "Не знайшов бронювання з кодом " + code + ". Перевірте код у повідомленні після запису на сайті або забронюйте ще раз на bookingclub.beauty.";
    }
    if (rec.chatId && rec.chatId === chatId) return ID_MSG; // салон відкрив власний лінк
    rec.clientChatId = chatId;
    rec.clientLinkedAt = new Date().toISOString();
    try { await KV.put(key, JSON.stringify(rec), { expirationTtl: BK_TTL }); } catch { /* ignore */ }
    return "✅ Готово! Ваше бронювання підтверджено.\n\n" +
      "🏠 " + (rec.listingName || "Салон") + "\n" +
      "💅 " + (rec.serviceName || "Послуга") + "\n" +
      "📅 " + rec.dateISO + " о " + rec.time + "\n" +
      "🆔 Код: " + rec.id + "\n\n" +
      "Я надішлю нагадування за день і за 2 години до візиту.\n" +
      "Якщо плани зміняться — скасувати можна командою: /cancel " + rec.id;
  }

  if (cmd === "/start") {
    return "👋 Вітаю у Booking Club!\n\n" +
      "Якщо ви клієнт: після запису на сайті bookingclub.beauty натисніть кнопку «Підтвердження і нагадування в Telegram» — і я підключу ваше бронювання сюди.\n\n" +
      "Якщо ви салон або майстер: ваш Telegram ID — " + chatId + ".\n" +
      "Вкажіть його у формі bookingclub.beauty/join. Детальніше: /myid";
  }
  if (cmd === "/myid" || cmd === "/id") return ID_MSG;
  if (cmd === "/help") return ID_MSG;

  if (cmd === "/bookings" || cmd === "/cancel") {
    if (!KV) {
      return "⚠️ Сховище бронювань ще не підключено власником платформи. Ваш ID: " + chatId + " — передайте його власнику, він завершить налаштування.";
    }
    if (cmd === "/bookings") {
      const mine = await salonBookings(KV, chatId);
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
    // /cancel BK-XXXXXX — салон скасовує свій запис або клієнт свій
    let want = (arg || "").toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(want)) want = "BK-" + want;
    if (!/^BK-[A-Z0-9]{6}$/.test(want)) {
      return "Формат: /cancel BK-XXXXXX — код бронювання є у повідомленні про запис і у списку /bookings";
    }
    // 1) запис салону (за salonmap / chatId / ключем)
    const mine = await salonBookings(KV, chatId);
    let rec = mine.find(b => b.id === want) || null;
    let asClient = false;
    // 2) запис клієнта (через індекс за кодом)
    if (!rec) {
      const key = await KV.get(BKI_PREFIX + want);
      const r = key ? await readBookingRec(KV, key) : null;
      if (r && key && r.clientChatId && r.clientChatId === chatId) { r._key = key; rec = r; asClient = true; }
    }
    if (!rec) return "Не знайшов бронювання " + want + " серед ваших. Перевірте код у /bookings";
    try {
      await KV.delete(rec._key);
      await KV.delete(BKI_PREFIX + rec.id);
    } catch {
      return "⚠️ Не вдалось скасувати — спробуйте ще раз трохи пізніше.";
    }
    if (asClient) {
      const salonNote = "❌ Клієнт скасував бронювання " + rec.id + "\n" +
        "🏠 " + (rec.listingName || "") + "\n💅 " + (rec.serviceName || "Послуга") + "\n" +
        "📅 " + rec.dateISO + " о " + rec.time + "\n👤 " + (rec.name || "") + "\nСлот знову вільний на сайті.";
      if (rec.chatId) await say(rec.chatId, salonNote);
      else if (ownerChat) await say(ownerChat, salonNote);
      return "✅ Ваше бронювання " + want + " скасовано: " + (rec.listingName || "салон") + ", " + rec.dateISO + " о " + rec.time + ". Салон отримав сповіщення.";
    }
    if (rec.clientChatId) {
      await say(rec.clientChatId, "❌ Салон скасував ваше бронювання " + rec.id + "\n" +
        "🏠 " + (rec.listingName || "") + "\n📅 " + rec.dateISO + " о " + rec.time + "\n" +
        "Вибачте за незручності — оберіть інший час на bookingclub.beauty.");
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
// Індекс: bkc|<BK-id> → повний ключ запису (клієнтський лінк, скасування, депозит).
// listingKey — санітизований listingId; fallback: "chat-<chatId салону>", далі "anon".

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
  const listingId = await salonListingId(KV, chatId);
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

async function salonListingId(KV, chatId) {
  try {
    const raw = await KV.get("salonmap");
    if (raw) return (JSON.parse(raw) || {})[chatId] || "";
  } catch { /* ignore */ }
  return "";
}

// ---------- Кабінет салону ----------
function randHex(nBytes) {
  const a = new Uint8Array(nBytes);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getCabSession(KV, token) {
  if (!token || !/^[a-f0-9]{32,}$/i.test(token)) return null;
  try {
    const raw = await KV.get("cabsess:" + token);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.chatId || Date.now() > (s.exp || 0)) return null;
    return s;
  } catch { return null; }
}

function sanitizePrices(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const out = {};
  for (const [svc, v] of Object.entries(p)) {
    const key = sanitizeListingKey(svc);
    if (!key || !v || typeof v !== "object") continue;
    const item = {};
    for (const f of ["from", "to", "durationMin"]) {
      if (v[f] === null || v[f] === undefined || v[f] === "") continue;
      const n = Number(v[f]);
      if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
      item[f] = n;
    }
    if (Object.keys(item).length) out[key] = item;
  }
  return Object.keys(out).length ? out : null;
}

const CODE_RL = new Map(); // chatId -> { last, count, hourStart }
function codeRateOk(chatId, now) {
  const v = CODE_RL.get(chatId);
  if (!v) { CODE_RL.set(chatId, { last: now, count: 1, hourStart: now }); return true; }
  if (now - v.last < 30000) return false;                 // не частіше ніж раз на 30 с
  if (now - v.hourStart > 3600000) { CODE_RL.set(chatId, { last: now, count: 1, hourStart: now }); return true; }
  if (v.count >= 5) return false;                          // до 5 кодів на годину
  v.last = now; v.count += 1; CODE_RL.set(chatId, v);
  return true;
}

// ---------- Нагадування клієнтам ----------
// Час візиту рахуємо з dateISO+time як локальний час Монреаля (America/Toronto).
function tzOffsetMs(tz, date) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, (+parts.hour) % 24, +parts.minute, +parts.second);
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

function torontoVisitMs(dateISO, time) {
  const dm = String(dateISO || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = String(time || "").match(/^(\d{2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const guess = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  let utc = guess - tzOffsetMs("America/Toronto", new Date(guess));
  const off2 = tzOffsetMs("America/Toronto", new Date(utc));
  if (off2 !== tzOffsetMs("America/Toronto", new Date(guess))) utc = guess - off2;
  return utc;
}

// Сканує всі записи календаря; шле нагадування клієнтам із привʼязаним чатом.
// Вікна: 24 год ±45 хв і 2 год ±45 хв; прапорці r24/r2 у записі — захист від дублей.
async function scanReminders(env) {
  const stats = { checked: 0, sent24: 0, sent2: 0 };
  const KV = (env && env.BC_KV) || null;
  const token = getBotToken(env);
  if (!KV || !token) return stats;
  const H = 3600000, WIN = 45 * 60000;
  const now = Date.now();
  let keys = [];
  try { keys = await kvListKeys(KV, BK_PREFIX); } catch { return stats; }
  for (const k of keys) {
    const rec = await readBookingRec(KV, k);
    if (!rec || !rec.clientChatId) continue;
    stats.checked += 1;
    const visit = torontoVisitMs(rec.dateISO, rec.time);
    if (visit === null) continue;
    const diff = visit - now;
    let changed = false;
    if (!rec.r24 && diff >= 24 * H - WIN && diff <= 24 * H + WIN) {
      const ok = await tgSendWith(token, rec.clientChatId,
        "⏰ Нагадування від Booking Club\n\n" +
        "Завтра, " + rec.dateISO + " о " + rec.time + " — ваш запис:\n" +
        "💅 " + (rec.serviceName || "Послуга") + " — " + (rec.listingName || "салон") + "\n" +
        "🆔 Код: " + rec.id + "\n\n" +
        "Якщо плани змінились — скасувати можна командою: /cancel " + rec.id);
      if (ok) { rec.r24 = true; stats.sent24 += 1; changed = true; }
    }
    if (!rec.r2 && diff >= 2 * H - WIN && diff <= 2 * H + WIN) {
      const ok = await tgSendWith(token, rec.clientChatId,
        "⏰ Уже скоро! Сьогодні о " + rec.time + " — ваш запис:\n" +
        "💅 " + (rec.serviceName || "Послуга") + " — " + (rec.listingName || "салон") + "\n" +
        "🆔 Код: " + rec.id + "\n\n" +
        "Якщо плани змінились — скасувати можна командою: /cancel " + rec.id);
      if (ok) { rec.r2 = true; stats.sent2 += 1; changed = true; }
    }
    if (changed) {
      const copy = { ...rec };
      delete copy._key;
      try { await KV.put(k, JSON.stringify(copy), { expirationTtl: BK_TTL }); } catch { /* ignore */ }
    }
  }
  return stats;
}

// ---------- Stripe: перевірка підпису webhook (HMAC-SHA256, вручну) ----------
async function verifyStripeSignature(payload, header, secret) {
  try {
    const items = String(header || "").split(",").map(s => s.trim());
    let t = "", v1 = "";
    for (const it of items) {
      const eq = it.indexOf("=");
      if (eq < 0) continue;
      const k = it.slice(0, eq), val = it.slice(eq + 1);
      if (k === "t") t = val;
      if (k === "v1" && !v1) v1 = val;
    }
    if (!t || !v1) return false;
    const ts = Number(t);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false; // толерантність 5 хв
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(t + "." + payload));
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (hex.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
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
