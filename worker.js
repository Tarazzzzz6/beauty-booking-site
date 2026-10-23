// ============================================================
// Booking Club — Cloudflare Worker v8
// ------------------------------------------------------------
// Нове у v8 (пакет за аудитом 22.10.2026):
// H2) POST /book: валідація (минулі дати, закриті дні sched:, послуга
//     за канонічним каталогом / послугами динамічного лістинга) і
//     порядок «запис у KV → нотифікації»; bk===null → 400, помилка
//     запису → 502, код — тільки після успішних put.
// H3) GET /remind: із заданим SETUP_KEY — тільки з ключем
//     (заголовок x-setup-key або ?key=); без секрету — перехідний
//     відкритий режим, як у C2. Крон ходить із ключем.
// M1) Коди кабінету: crypto.getRandomValues; ліміти видачі — у KV
//     (cabrl:); перегенерація НЕ скидає лічильник спроб входу.
// M3) GET /listings більше не віддає phone і telegramChatId;
//     chatId за listingId воркер бере сам із KV (lst:/salonmap:).
// M4) CORS: allowlist тільки https://bookingclub.beauty (+www).
// M8) 409 slot_taken — JSON {error:"slot_taken"}.
// M13) salonmap — окремі ключі salonmap:<chatId> (легасі-JSON ще
//     читається); правки записів — перечитування+мердж, TTL від
//     createdAt; коди BK — цикл із перевіркою колізії bkc:.
// L2) /photo: тільки file_id з опублікованих lst: записів.
// L4) /deposit/checkout: rate-limit на код+IP.
// L11) pend: заявки мають TTL 30 діб.
// ------------------------------------------------------------
// Нове у v7:
// 13) AI-консьєрж: POST /ai {q, lang, catalog} → OpenAI (gpt-4o-mini).
//     Каталог надсилає САЙТ (він знає всі лістинги включно з
//     динамічними після мерджу) — воркер нічого не зберігає і не
//     вигадує: picks валідуються проти id каталогу, чужих id у
//     відповіді бути не може. Без OPENAI_API_KEY → 501
//     ai_not_configured (сайт тоді мовчки падає на правила).
// ------------------------------------------------------------
// Нове у v6:
// 10) Кабінет — глибина: /cabinet/data тепер повертає revenue
//     {week,month,total} (сума цін візитів attended; ціна — priceFrom
//     із запису, далі оверрайди цін салону, далі картка динамічного
//     лістинга), counts {booked,attended,noshow,upcoming} і clients[]
//     (агрегація клієнтів салону: візити, attended/noshow, останній
//     візит, витрачено). У запис бронювання тепер зберігаються
//     serviceId і priceFrom із payload сайту.
// 11) Telegram Mini App: GET /setup-menu реєструє кнопку-меню бота
//     (web_app → bookingclub.beauty); звичайний /start без параметрів
//     додатково шле інлайн-кнопку «📱 Відкрити каталог» (web_app).
// 12) Автопости в канал: якщо задано env CHANNEL_ID, публікація
//     нового лістинга (✅ у флоу заявок) постить анонс у канал.
// ------------------------------------------------------------
// Нове у v5:
// 8) Самопідключення салонів: бот-майстер /join (або /start join) —
//    покроковий діалог (назва → тип → адреса/район → послуги кнопками →
//    ціни → години → мови → фото) → заявка pend:<id> у KV → власник
//    затверджує інлайн-кнопками ✅/❌ у Telegram → автопублікація
//    lst:<id>. Заявка з форми /join (salon_join) іде тим самим шляхом.
//    GET /listings — динамічні лістинги для сайту; GET /photo/<file_id> —
//    проксі фото з Telegram (getFile → стрім).
// 9) Відвідуваність: у запису бронювання status booked|attended|noshow.
//    Скан після візиту (+30 хв) питає салон кнопками ✅ Прийшов /
//    🚫 Не прийшов (callback att:<BK-id>:y|n); ручні /done і /noshow;
//    /stats — статистика по лістингах (тільки власник); у кабінеті
//    власника — блок «Платформа» (GET /cabinet/data → platform).
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
// - Опційно: OPENAI_API_KEY — AI-консьєрж (POST /ai); без нього сайт
//   користується правиловим підбором
// - Опційно: CHANNEL_ID (автопости нових салонів у Telegram-канал),
//   SETUP_KEY (захист GET /setup-menu і GET /remind; /remind приймає
//   заголовок x-setup-key або ?key=<SETUP_KEY>)
// ============================================================

const BK_PREFIX = "bk|";
const BKI_PREFIX = "bkc|";
const BK_TTL = 60 * 60 * 24 * 90; // 90 днів
const WIZ_PREFIX = "wiz:";         // стан бот-майстра підключення салону
const WIZ_TTL = 60 * 60 * 24 * 7;  // 7 днів
const PEND_PREFIX = "pend:";       // заявки салонів на затвердження
const PEND_TTL = 60 * 60 * 24 * 30; // L11: заявки живуть 30 діб
const LST_PREFIX = "lst:";         // опубліковані динамічні лістинги
const WORKER_ORIGIN = "https://snowy-shadow-0b58.irafarm2000.workers.dev";

// Канонічні послуги платформи (ті самі 12, що у data.js SERVICES)
const SVC_CATALOG = [
  { id: "manicure", ua: "Манікюр", dur: 60 },
  { id: "pedicure", ua: "Педикюр", dur: 75 },
  { id: "brows", ua: "Брови", dur: 45 },
  { id: "lashes", ua: "Вії", dur: 120 },
  { id: "mens_haircut", ua: "Стрижка чоловіча", dur: 45 },
  { id: "womens_haircut", ua: "Стрижка жіноча", dur: 75 },
  { id: "coloring", ua: "Фарбування", dur: 150 },
  { id: "barber", ua: "Барбер", dur: 50 },
  { id: "makeup", ua: "Макіяж", dur: 60 },
  { id: "massage", ua: "Масаж", dur: 60 },
  { id: "cosmetology", ua: "Косметолог", dur: 60 },
  { id: "depilation", ua: "Депіляція", dur: 35 },
];
const LANG_CATALOG = [
  { code: "ua", label: "Українська" },
  { code: "ru", label: "Російська" },
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
];

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

// Універсальний виклик Telegram Bot API (для інлайн-клавіатур і callback-ів).
async function tgApi(token, method, body) {
  if (!token) return null;
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const j = await resp.json().catch(() => null);
    return j && j.ok ? j.result : null;
  } catch { return null; }
}

// Надіслати повідомлення з інлайн-клавіатурою (rows = [[{text, callback_data}], ...]).
async function tgSendKb(token, chatId, text, rows) {
  const body = { chat_id: chatId, text, disable_web_page_preview: true };
  if (rows && rows.length) body.reply_markup = { inline_keyboard: rows };
  const r = await tgApi(token, "sendMessage", body);
  return !!r;
}

async function tgEditKb(token, chatId, messageId, rows) {
  return tgApi(token, "editMessageReplyMarkup", {
    chat_id: chatId, message_id: messageId,
    reply_markup: { inline_keyboard: rows || [] },
  });
}

async function tgEditText(token, chatId, messageId, text, rows) {
  const body = { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true };
  body.reply_markup = { inline_keyboard: rows || [] };
  return tgApi(token, "editMessageText", body);
}

async function tgAnswerCb(token, callbackId, text) {
  return tgApi(token, "answerCallbackQuery", { callback_query_id: callbackId, text: text || "" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // АУДИТ-ФІКС v8 (M4): CORS-allowlist замість "*". Дзеркалимо Origin лише
    // для власного домену; без Origin (Telegram/серверні виклики) —
    // дефолтний домен; чужий Origin заголовка не отримує — браузер сам
    // заблокує відповідь. Для /p (OG-превʼю) поведінка не змінюється:
    // скрапери Origin не шлють і отримують HTML як раніше.
    const reqOrigin = request.headers.get("Origin") || "";
    const corsHeaders = {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    if (reqOrigin === "https://bookingclub.beauty" || reqOrigin === "https://www.bookingclub.beauty") {
      corsHeaders["Access-Control-Allow-Origin"] = reqOrigin;
    } else if (!reqOrigin) {
      corsHeaders["Access-Control-Allow-Origin"] = "https://bookingclub.beauty";
    }
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

    // ---------- Telegram webhook: команди, майстер підключення, callback-и ----------
    if (request.method === "POST") {
      let peek = null;
      try { peek = await request.clone().json(); } catch { /* not json */ }
      if (peek && typeof peek.update_id === "number") {
        // АУДИТ-ФІКС (Critical): автентифікація Telegram-webhook. Раніше будь-хто
        // міг POST-ити підроблені update від імені власника/салонів (from.id із тіла).
        // Перехідний режим: перевірка активна лише коли заданий секрет TG_WEBHOOK_SECRET;
        // тоді webhook у Telegram треба перевиставити з тим самим secret_token.
        const tgHookSecret = (env && env.TG_WEBHOOK_SECRET) || "";
        if (tgHookSecret) {
          const hdr = request.headers.get("x-telegram-bot-api-secret-token") || "";
          let same = hdr.length === tgHookSecret.length;
          for (let i = 0; i < tgHookSecret.length; i++) { if (hdr[i] !== tgHookSecret[i]) same = false; }
          if (!same) return new Response("unauthorized", { status: 401, headers: corsHeaders });
        }
        if (!BOT_TOKEN) return new Response("ok", { headers: corsHeaders });
        const wctx = { KV, token: BOT_TOKEN, ownerChat: OWNER_CHAT, channelId: (env && env.CHANNEL_ID) || "" };
        // Інлайн-кнопки: майстер (wiz:), публікація (pub:/rej:), відвідуваність (att:)
        if (peek.callback_query) {
          try { await handleCallbackQuery(peek.callback_query, wctx); } catch { /* ignore */ }
          return new Response("ok", { headers: corsHeaders });
        }
        const msg = peek.message || peek.edited_message;
        if (msg && msg.chat) {
          const chatId = String(msg.chat.id);
          const textIn = String(msg.text || msg.caption || "").trim();
          // Фото — крок «фото» бот-майстра підключення
          if (Array.isArray(msg.photo) && msg.photo.length && KV) {
            const used = await wizardPhoto(chatId, msg.photo, wctx);
            if (used) return new Response("ok", { headers: corsHeaders });
            if (!textIn) return new Response("ok", { headers: corsHeaders });
          }
          const wParts = textIn.split(/\s+/);
          const wCmd = (wParts[0] || "").toLowerCase().replace(/@.*$/, "");
          const wArg = (wParts[1] || "").toLowerCase();
          // Старт майстра: /join або deep link /start join
          if (KV && (wCmd === "/join" || (wCmd === "/start" && wArg === "join"))) {
            await wizardStart(chatId, wctx);
            return new Response("ok", { headers: corsHeaders });
          }
          // Текстові кроки майстра (звичайний текст, не команди)
          if (KV && textIn && !textIn.startsWith("/")) {
            const consumed = await wizardText(chatId, textIn, wctx);
            if (consumed) return new Response("ok", { headers: corsHeaders });
          }
          if (msg.text) {
            const reply = await handleBotCommand(textIn, chatId, KV, tgSend, OWNER_CHAT);
            if (reply) await tgSend(chatId, reply);
            // Mini App: звичайний /start без параметрів — інлайн-кнопка каталогу (web_app)
            if (wCmd === "/start" && !wArg) {
              try {
                await tgSendKb(BOT_TOKEN, chatId, "📱 Каталог салонів Монреаля — прямо тут, у Telegram:", [[
                  { text: "📱 Відкрити каталог", web_app: { url: "https://bookingclub.beauty" } },
                ]]);
              } catch { /* ignore */ }
            }
          }
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
            // M13: перечитуємо свіжий запис і мерджимо лише свої поля.
            const rec = key ? await updateBookingRec(KV, key, r => {
              r.depositPaid = true;
              r.depositSessionId = sess.id || r.depositSessionId || "";
              r.depositPaidAt = new Date().toISOString();
            }) : null;
            if (rec && key) {
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
        // M1: ліміти видачі — у KV (cabrl:), код — CSPRNG, а лічильник
        // спроб входу перегенерація НЕ скидає (інакше захист обходився
        // запитом нового коду).
        if (!(await codeRateOkKv(KV, chatId, Date.now()))) return jsonResp({ error: "rate_limited" }, 429);
        let prevTries = 0;
        try {
          const prevRaw = await KV.get("cabcode:" + chatId);
          if (prevRaw) {
            const prev = JSON.parse(prevRaw);
            if (prev && Date.now() <= (prev.exp || 0)) prevTries = prev.tries || 0;
          }
        } catch { /* ignore */ }
        const code = cryptoCode6();
        await KV.put("cabcode:" + chatId, JSON.stringify({ code, exp: Date.now() + 10 * 60 * 1000, tries: prevTries }), { expirationTtl: 600 });
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
      // L4: ліміт спроб на код+IP — не плодити Stripe-сесії абузом.
      const depIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
      if (!depRateOk(code, depIp, Date.now())) return jsonResp({ error: "rate_limited" }, 429);
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
        await updateBookingRec(KV, key, r => { r.depositSessionId = sj.id || ""; });
        return jsonResp({ ok: true, url: sj.url });
      } catch {
        return jsonResp({ error: "stripe_error" }, 502);
      }
    }

    // --- AI-консьєрж v1: POST /ai {q, lang, catalog} → OpenAI → {picks, message} ---
    // Каталог шле сайт (єдине джерело правди про лістинги). Воркер тільки
    // валідує вхід, кличе модель і ріже відповідь до id з каталогу.
    if (request.method === "POST" && url.pathname === "/ai") {
      let body = null;
      try { body = await request.json(); } catch { return jsonResp({ error: "bad_json" }, 400); }
      const aiKey = (env && env.OPENAI_API_KEY) || "";
      if (!aiKey) return jsonResp({ error: "ai_not_configured" }, 501);
      const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
      if (!rateLimit(ip, Date.now())) return jsonResp({ error: "rate_limited" }, 429);
      const q = String(body?.q || "").trim().slice(0, 300);
      if (!q) return jsonResp({ error: "bad_query" }, 400);
      const lang = ["uk", "ru", "en"].includes(String(body?.lang || "")) ? String(body.lang) : "uk";
      // Каталог: максимум 40 записів, тільки потрібні поля, усе обрізано.
      const catalog = [];
      for (const c of (Array.isArray(body?.catalog) ? body.catalog.slice(0, 40) : [])) {
        if (!c || typeof c !== "object") continue;
        const id = String(c.id || "").trim().slice(0, 80);
        if (!id) continue;
        const services = (Array.isArray(c.services) ? c.services : []).slice(0, 12)
          .map(s => ({
            id: String(s?.id || "").slice(0, 40),
            name: String(s?.name || "").slice(0, 60),
            priceFrom: (typeof s?.priceFrom === "number" && isFinite(s.priceFrom)) ? s.priceFrom : null,
          }))
          .filter(s => s.id || s.name);
        catalog.push({
          id,
          name: String(c.name || "").slice(0, 80),
          district: String(c.district || "").slice(0, 60),
          rating: (typeof c.rating === "number" && isFinite(c.rating)) ? c.rating : null,
          services,
          nextSlot: (c.nextSlot && typeof c.nextSlot === "object")
            ? { date: String(c.nextSlot.date || "").slice(0, 10), time: String(c.nextSlot.time || "").slice(0, 5) }
            : null,
        });
      }
      if (!catalog.length) return jsonResp({ error: "empty_catalog" }, 400);
      const sysPrompt = [
        "Ти — AI-консьєрж Booking Club, сервісу онлайн-запису в салони краси Монреаля (Канада) для українсько- та російськомовної діаспори.",
        "За запитом клієнта підбери до 3 найкращих варіантів ВИКЛЮЧНО з наданого нижче каталогу.",
        "Відповідай ТІЛЬКИ валідним JSON-обʼєктом: {\"picks\":[\"<id>\", ...], \"message\":\"...\"} — без markdown і без тексту поза JSON.",
        "picks — тільки id, що є в каталозі, не більше 3, у порядку релевантності.",
        "message — 1–2 дружні речення мовою клієнта (код мови: " + lang + "). Поясни, чому ці варіанти пасують, спираючись ТІЛЬКИ на дані каталогу: назва, район (district), рейтинг, ціна «від» (priceFrom, CAD), найближчий вільний слот (nextSlot). НІКОЛИ не вигадуй ціни, години, послуги чи салони, яких нема в каталозі.",
        "Якщо жоден варіант не підходить — picks: [] і чесне message із порадою послабити запит (інший район, час або бюджет).",
      ].join("\n");
      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + aiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.3,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: sysPrompt },
              { role: "user", content: "Запит клієнта: " + q + "\n\nКаталог (JSON):\n" + JSON.stringify(catalog) },
            ],
          }),
        });
        const oj = await resp.json().catch(() => null);
        if (!resp.ok || !oj || !oj.choices || !oj.choices[0] || !oj.choices[0].message || !oj.choices[0].message.content) {
          return jsonResp({ error: "ai_error", detail: (oj && oj.error && oj.error.message) || resp.status }, 502);
        }
        let parsed = null;
        try { parsed = JSON.parse(oj.choices[0].message.content); } catch { return jsonResp({ error: "ai_bad_json" }, 502); }
        const validIds = new Set(catalog.map(c => c.id));
        const picks = (Array.isArray(parsed?.picks) ? parsed.picks : [])
          .map(x => String(x || "")).filter(id => validIds.has(id)).slice(0, 3);
        const message = String(parsed?.message || "").slice(0, 500);
        return jsonResp({ ok: true, picks, message });
      } catch {
        return jsonResp({ error: "ai_error" }, 502);
      }
    }

    // ---------- Динамічні лістинги (самопідключення салонів) ----------
    if (request.method === "GET" && url.pathname === "/listings") {
      let out = [];
      if (KV) {
        try {
          const keys = await kvListKeys(KV, LST_PREFIX);
          for (const k of keys) {
            const rec = await readBookingRec(KV, k);
            if (rec && rec.id) out.push(listingForSite(rec));
          }
        } catch { /* ignore */ }
      }
      out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      return jsonResp(out);
    }

    // ---------- Фото салонів: проксі файлів Telegram ----------
    if (request.method === "GET" && url.pathname.startsWith("/photo/")) {
      const fid = url.pathname.slice("/photo/".length);
      if (!BOT_TOKEN || !KV || !/^[A-Za-z0-9_-]{10,}$/.test(fid)) {
        return new Response("not found", { status: 404, headers: corsHeaders });
      }
      // L2: проксі віддає ТІЛЬКИ фото опублікованих лістингів (lst:),
      // а не будь-який файл бота за відомим file_id.
      const allowedPhotos = await publishedPhotoIds(KV);
      if (!allowedPhotos.has(fid)) {
        return new Response("not found", { status: 404, headers: corsHeaders });
      }
      try {
        const gf = await tgApi(BOT_TOKEN, "getFile", { file_id: fid });
        const path = gf && gf.file_path;
        if (!path) return new Response("not found", { status: 404, headers: corsHeaders });
        const fr = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
        if (!fr.ok || !fr.body) return new Response("not found", { status: 404, headers: corsHeaders });
        const headers = new Headers(corsHeaders);
        headers.set("Content-Type", fr.headers.get("content-type") || "image/jpeg");
        headers.set("Cache-Control", "public, max-age=86400");
        return new Response(fr.body, { status: 200, headers });
      } catch {
        return new Response("not found", { status: 404, headers: corsHeaders });
      }
    }

    // ---------- OG preview ----------
    if (request.method === "GET" && (url.pathname === "/p" || url.pathname === "/p/")) {
      // АУДИТ-ФІКС: був open redirect на довільний домен через ?site=.
      // Дозволяємо редірект тільки на власний домен.
      let site = url.searchParams.get("site") || "";
      if (site && !/^https:\/\/bookingclub\.beauty\/?$/.test(site)) site = "https://bookingclub.beauty/";
      if (site && !site.endsWith("/")) site += "/";
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
      // --- v6: виручка / лічильники / клієнти по ВСІХ записах салону ---
      // Ціна візиту: priceFrom із запису → оверрайди цін (ovr:) → картка
      // динамічного лістинга (lst:). Для записів без жодного джерела ціни
      // price = null — у виручку вони не потрапляють.
      let cabOverrides = {};
      if (listingId) {
        try {
          const rawO = await KV.get("ovr:" + sanitizeListingKey(listingId));
          if (rawO) cabOverrides = JSON.parse(rawO) || {};
        } catch { /* ignore */ }
      }
      const dynSvc = {};
      if (listingId) {
        try {
          const lrec = await readBookingRec(KV, LST_PREFIX + listingId);
          for (const s of (lrec && lrec.services) || []) {
            if (s && s.serviceId && Number(s.from) > 0) dynSvc[s.serviceId] = Number(s.from);
          }
        } catch { /* ignore */ }
      }
      const priceById = {};
      const counts = { booked: 0, attended: 0, noshow: 0, upcoming: 0 };
      const revenue = { week: 0, month: 0, total: 0 };
      const todayISO = torontoTodayISO();
      const weekFrom = addDaysISO(todayISO, -6);    // останні 7 днів включно з сьогодні
      const monthFrom = addDaysISO(todayISO, -29); // останні 30 днів
      const nowMs = Date.now();
      const clientMap = new Map();
      for (const b of mine) {
        const price = visitPrice(b, cabOverrides, dynSvc);
        priceById[b.id] = price;
        const st = b.status || "booked";
        counts.booked += 1;
        if (st === "attended") counts.attended += 1;
        else if (st === "noshow") counts.noshow += 1;
        else {
          const v = torontoVisitMs(b.dateISO, b.time);
          if (v !== null && v >= nowMs) counts.upcoming += 1;
        }
        if (st === "attended" && price !== null) {
          revenue.total += price;
          if (b.dateISO >= monthFrom) revenue.month += price;
          if (b.dateISO >= weekFrom) revenue.week += price;
        }
        const phoneKey = String(b.phone || "").replace(/\D/g, "");
        const ckey = phoneKey || (b.clientChatId ? "tg:" + b.clientChatId : (b.name ? "n:" + String(b.name).trim().toLowerCase() : ""));
        if (ckey) {
          let c = clientMap.get(ckey);
          if (!c) { c = { name: "", phone: "", chatId: "", visits: 0, attended: 0, noshow: 0, lastVisit: "", spent: 0, _w: "" }; clientMap.set(ckey, c); }
          c.visits += 1;
          if (st === "attended") { c.attended += 1; if (price !== null) c.spent += price; }
          else if (st === "noshow") c.noshow += 1;
          const when = (b.dateISO || "") + " " + (b.time || "");
          if (!c._w || when > c._w) { c._w = when; c.lastVisit = b.dateISO || ""; if (b.name) c.name = b.name; }
          if (b.phone && !c.phone) c.phone = b.phone;
          if (b.name && !c.name) c.name = b.name;
          if (b.clientChatId) c.chatId = String(b.clientChatId);
        }
      }
      const clients = Array.from(clientMap.values())
        .map(c => ({ name: c.name, phone: c.phone, chatId: c.chatId, visits: c.visits, attended: c.attended, noshow: c.noshow, lastVisit: c.lastVisit, spent: c.spent }))
        .sort((a, b) => (b.visits - a.visits) || (b.spent - a.spent))
        .slice(0, 200);
      const fromISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const bookings = mine
        .filter(b => b.dateISO >= fromISO)
        .sort((a, b) => (a.dateISO + "T" + a.time).localeCompare(b.dateISO + "T" + b.time))
        .slice(0, 100)
        .map(b => ({
          id: b.id, dateISO: b.dateISO, time: b.time, serviceName: b.serviceName || "",
          name: b.name || "", phone: b.phone || "",
          status: b.status || "booked",
          clientLinked: !!b.clientChatId, depositPaid: !!b.depositPaid,
          depositRequested: !!b.depositRequested,
        }));
      for (const b of bookings) b.price = (priceById[b.id] !== undefined ? priceById[b.id] : null);
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
      // Власник платформи бачить агреговану статистику по всіх салонах
      let platform = null;
      if (chatId === OWNER_CHAT) {
        try { platform = { listings: await platformStats(KV) }; } catch { platform = { listings: [] }; }
      }
      return jsonResp({ ok: true, chatId, listingId: listingId || "", bookings, closed, overrides, platform, revenue, counts, clients });
    }

    // ---------- Mini App: реєстрація кнопки-меню бота (web_app) ----------
    // Одноразова дія власника: GET /setup-menu?owner=<chatId власника>
    // або ?key=<SETUP_KEY>, якщо секрет SETUP_KEY заданий. Кнопка «Записатись»
    // з'явиться у бота біля поля вводу і відкриватиме сайт усередині Telegram.
    if (request.method === "GET" && url.pathname === "/setup-menu") {
      const setupKey = (env && env.SETUP_KEY) || "";
      const allowed = setupKey
        ? url.searchParams.get("key") === setupKey
        : url.searchParams.get("owner") === OWNER_CHAT;
      if (!allowed) return jsonResp({ error: "forbidden" }, 403);
      if (!BOT_TOKEN) return jsonResp({ error: "bot_token_missing" }, 503);
      const res = await tgApi(BOT_TOKEN, "setChatMenuButton", {
        menu_button: { type: "web_app", text: "Записатись", web_app: { url: "https://bookingclub.beauty" } },
      });
      return jsonResp({ ok: !!res, result: res === undefined ? null : res });
    }

    // ---------- Нагадування + відвідуваність: ручний запуск scan (ідемпотентний) ----------
    // АУДИТ-ФІКС v8 (H3): із заданим SETUP_KEY доступ — тільки з ключем:
    // заголовок x-setup-key: <SETUP_KEY> або ?key=<SETUP_KEY> (так ходить
    // щогодинний крон). Без заданого секрету — перехідний відкритий режим.
    if (request.method === "GET" && url.pathname === "/remind") {
      const setupKey = (env && env.SETUP_KEY) || "";
      if (setupKey) {
        const provided = request.headers.get("x-setup-key") || url.searchParams.get("key") || "";
        if (!constTimeEq(provided, setupKey)) return jsonResp({ error: "forbidden" }, 403);
      }
      const stats = await scanReminders(env);
      const att = await scanAttendance(env);
      return jsonResp({ ok: true, ...stats, attAsked: att.asked });
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

    // ---------- Заявка салону з форми /join → pend: + кнопки власнику ----------
    // Той самий шлях затвердження, що й у бот-майстра: власник тисне ✅/❌.
    // Без KV — падаємо у старий флоу (просто повідомлення власнику нижче).
    if (data?.type === "salon_join" && KV) {
      const listing = buildListingFromForm(data);
      const pendId = await uniqueListingId(KV, listing.name);
      listing.id = pendId;
      try {
        await KV.put(PEND_PREFIX + pendId, JSON.stringify({
          listing, chatId: listing.telegramChatId || "", source: "form",
          submittedAt: new Date().toISOString(),
        }), { expirationTtl: PEND_TTL });
        await notifyOwnerApplication({ KV, token: BOT_TOKEN, ownerChat: OWNER_CHAT }, pendId, listing, "form");
        return jsonResp({ ok: true, pending: true, id: pendId });
      } catch {
        return new Response("kv_error", { status: 502, headers: { ...corsHeaders } });
      }
    }

    // ---------- Календар бронювань (KV): валідація → запис → нотифікації ----------
    // АУДИТ-ФІКС v8 (H2): сервер валідує бронювання і пише у KV ДО
    // Telegram-нотифікацій. Код повертаємо тільки після успішних обох
    // put (запис + bkc-індекс), інакше 502 — кодів-«привидів» більше
    // немає. bk===null (немає дати/часу) → 400, а не ok:true.
    const salonChatEarly = String(data?.chatId || "").trim();
    const bk = extractBooking(data);
    if (!bk) {
      return jsonResp({ error: "bad_booking" }, 400);
    }
    let bkKey = "", bkRecId = "", bkStored = false;
    let salonChatResolved = /^\d{5,}$/.test(salonChatEarly) ? salonChatEarly : "";
    if (KV) {
      bkKey = sanitizeListingKey(data?.listingId) || (/^\d{5,}$/.test(salonChatEarly) ? "chat-" + salonChatEarly : "anon");
      // (1) дата не в минулому (America/Toronto)
      if (bk.dateISO < torontoTodayISO()) {
        return jsonResp({ error: "past_date" }, 400);
      }
      // (2) послуга: канонічний каталог; динамічний лістинг — лише свої послуги
      const svcIdIn = String(data?.serviceId || "").trim();
      const lidIn = String(data?.listingId || "").trim();
      let dynListing = null;
      if (lidIn) dynListing = await readBookingRec(KV, LST_PREFIX + lidIn);
      if (svcIdIn && !SVC_CATALOG.some(s => s.id === svcIdIn)) {
        return jsonResp({ error: "bad_service" }, 400);
      }
      if (dynListing && svcIdIn && !(dynListing.services || []).some(s => s.serviceId === svcIdIn)) {
        return jsonResp({ error: "bad_service" }, 400);
      }
      // (3) закритий день салону: sched: за chatId з payload, картки lst: або salonmap
      if (!salonChatResolved) salonChatResolved = await salonChatForListing(KV, lidIn);
      if (salonChatResolved) {
        try {
          const rawS = await KV.get("sched:" + salonChatResolved);
          const closedDays = rawS ? (JSON.parse(rawS).closed || []) : [];
          if (closedDays.includes(bk.dateISO)) {
            return jsonResp({ error: "day_closed" }, 400);
          }
        } catch { /* ignore */ }
      }
      // (4) анти-дубль слота (M8: відповідь — JSON)
      try {
        const keys = await kvListKeys(KV, BK_PREFIX + bkKey + "|" + bk.dateISO + "|");
        for (const k of keys) {
          const r = await readBookingRec(KV, k);
          if (r && r.time === bk.time) {
            return jsonResp({ error: "slot_taken" }, 409);
          }
        }
      } catch { /* KV list недоступний — бронювання не блокуємо */ }
      // (5) запис у KV: спочатку запис, потім індекс за кодом
      bkRecId = await makeUniqueBookingId(KV);
      const rec = {
        id: bkRecId,
        listingId: String(data?.listingId || ""),
        listingKey: bkKey,
        listingName: String(data?.listingName || ""),
        chatId: salonChatEarly,
        dateISO: bk.dateISO,
        time: bk.time,
        serviceId: String(data?.serviceId || ""),
        serviceName: bk.serviceName,
        priceFrom: (data?.priceFrom != null && Number.isFinite(Number(data.priceFrom)) && Number(data.priceFrom) > 0)
          ? Number(data.priceFrom) : null,
        name, phone,
        status: "booked",
        depositRequested: !!(data?.deposit && Number(data.deposit) > 0),
        createdAt: new Date().toISOString()
      };
      const fullKey = BK_PREFIX + bkKey + "|" + bk.dateISO + "|" + bk.time + "|" + bkRecId;
      try {
        await KV.put(fullKey, JSON.stringify(rec), { expirationTtl: BK_TTL });
        await KV.put(BKI_PREFIX + bkRecId, fullKey, { expirationTtl: BK_TTL });
        bkStored = true;
      } catch {
        return jsonResp({ error: "kv_error" }, 502);
      }
      // звʼязка chatId салону → listingId (M13: окремий ключ на салон)
      const mapChat = salonChatEarly || salonChatResolved;
      if (/^\d{5,}$/.test(mapChat) && data?.listingId) {
        try { await KV.put("salonmap:" + mapChat, String(data.listingId)); } catch { /* ignore */ }
      }
    }

    let text = (data?.message && String(data.message).trim())
      ? String(data.message).trim()
      : buildTextFallback(data);
    if (bkRecId) text += "\n\n🆔 Код бронювання: " + bkRecId + "\nСкасувати: /cancel " + bkRecId;

    // Маршрутизація: салону (chatId із payload або знайдений у KV) + копія власнику
    const targets = [];
    const salonTarget = salonChatEarly || salonChatResolved;
    if (/^\d{5,}$/.test(salonTarget) && salonTarget !== OWNER_CHAT) targets.push(salonTarget);
    targets.push(OWNER_CHAT);

    let sent = 0;
    for (const t of targets) {
      if (await tgSend(t, text)) sent++;
    }
    // Без запису в KV (легасі-середовище без KV) — стара семантика:
    // нема доставки → 502. Із записом бронювання вже існує — код віддаємо
    // незалежно від Telegram (салон побачить його у /bookings і кабінеті).
    if (!bkStored && !sent) {
      return new Response("telegram_error", { status: 502, headers: { ...corsHeaders } });
    }
    // Відповідь сайту: JSON із кодом бронювання (старий текст "ok" — у git-історії v3)
    return jsonResp({ ok: true, code: bkRecId || null });
  },

  // ---------- Cron: нагадування клієнтам + питання про відвідуваність ----------
  async scheduled(event, env, ctx) {
    const p = (async () => { await scanReminders(env); await scanAttendance(env); })();
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
    "/cancel BK-XXXXXX — скасувати запис (слот знову стане вільним на сайті)\n" +
    "/done BK-XXXXXX — клієнт прийшов · /noshow BK-XXXXXX — клієнт не прийшов\n\n" +
    "Підключити салон або майстра:\n" +
    "/join — покроковий майстер підключення (з фото)\n\n" +
    "Керування графіком:\n" +
    "/close 2026-11-03 — закрити день (відпустка, вихідний)\n" +
    "/open 2026-11-03 — відкрити день назад\n" +
    "/closed — список закритих днів";

  // --- Клієнт: /start BK-XXXXXX (deep link із сайту після бронювання) ---
  if (cmd === "/start" && /^BK-[A-Z0-9]{6}$/i.test(arg || "")) {
    const code = arg.toUpperCase();
    if (!KV) return "⚠️ Сховище бронювань ще не підключено платформою. Спробуйте пізніше.";
    const key = await KV.get(BKI_PREFIX + code);
    const rec = key ? await readBookingRec(KV, key) : null;
    if (!rec || !key) {
      return "Не знайшов бронювання з кодом " + code + ". Перевірте код у повідомленні після запису на сайті або забронюйте ще раз на bookingclub.beauty.";
    }
    if (rec.chatId && rec.chatId === chatId) return ID_MSG; // салон відкрив власний лінк
    await updateBookingRec(KV, key, r => {
      r.clientChatId = chatId;
      r.clientLinkedAt = new Date().toISOString();
    });
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
      "Якщо ви салон або майстер: підключіться командою /join — бот покроково збере назву, послуги, ціни й фото.\n" +
      "Або вкажіть свій Telegram ID (" + chatId + ") у формі bookingclub.beauty/join. Детальніше: /myid";
  }
  if (cmd === "/myid" || cmd === "/id") return ID_MSG;
  if (cmd === "/help") return ID_MSG;

  if (cmd === "/bookings" || cmd === "/cancel") {
    if (!KV) {
      return "⚠️ Сховище бронювань ще не підключено платформою. Ваш ID: " + chatId + " — передайте його команді Booking Club — ми завершимо налаштування.";
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

  // --- Відвідуваність: /done BK-… · /noshow BK-… · /stats (власник) ---
  if (cmd === "/done" || cmd === "/noshow") {
    if (!KV) return "⚠️ Сховище бронювань ще не підключено платформою.";
    let want = (arg || "").toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(want)) want = "BK-" + want;
    if (!/^BK-[A-Z0-9]{6}$/.test(want)) {
      return "Формат: " + cmd + " BK-XXXXXX — код є у повідомленні про бронювання і у /bookings";
    }
    const rec = await findBookingForActor(KV, want, chatId, ownerChat);
    if (!rec) return "Не знайшов бронювання " + want + " серед ваших.";
    const status = cmd === "/done" ? "attended" : "noshow";
    if ((rec.status || "booked") === status) {
      return "ℹ️ Запис " + want + " уже позначено: " + (status === "attended" ? "клієнт прийшов ✅" : "no-show 🚫");
    }
    await setBookingStatus(KV, rec, status);
    if (status === "noshow" && chatId !== ownerChat) {
      await say(ownerChat, "🚫 No-show у салоні " + (rec.listingName || rec.listingId || "") + "\n" +
        "💅 " + (rec.serviceName || "Послуга") + " · 📅 " + rec.dateISO + " о " + rec.time + "\n" +
        "👤 " + (rec.name || "") + (rec.phone ? " · " + rec.phone : "") + "\n🆔 " + rec.id);
    }
    return status === "attended"
      ? "✅ " + want + ": клієнт прийшов. Дякуємо, що відмітили!"
      : "🚫 " + want + ": позначено no-show. Власника платформи сповіщено.";
  }

  if (cmd === "/stats") {
    if (!KV) return "⚠️ Сховище ще не підключено.";
    if (chatId !== ownerChat) return "📊 Статистика платформи доступна тільки адміністрації платформи.";
    const rows = await platformStats(KV);
    if (!rows.length) return "📊 Поки немає жодного бронювання у базі.";
    const lines = rows.map(r =>
      "🏠 " + (r.listingName || r.listingId) + "\n" +
      "   записів: " + r.total + " · ✅ прийшло: " + r.attended + " · 🚫 no-show: " + r.noshow + " · 🔜 майбутніх: " + r.upcoming
    );
    return "📊 Booking Club — відвідуваність по салонах:\n\n" + lines.join("\n\n");
  }

  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(arg);
  if (cmd === "/close" || cmd === "/open" || cmd === "/closed") {
    if (!KV) {
      return "⚠️ Сховище графіків ще не підключено платформою. Ваш ID: " + chatId + " — передайте його команді Booking Club — ми завершимо налаштування.";
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
  return "Команди Booking Club: /join — підключити салон, /myid — ваш ID, /bookings — мої бронювання, /cancel BK-XXXXXX — скасувати бронювання, /done BK-XXXXXX — клієнт прийшов, /noshow BK-XXXXXX — не прийшов, /close ДАТА — закрити день, /open ДАТА — відкрити, /closed — закриті дні.";
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

// M13: код бронювання — із перевіркою колізії bkc-індексу, а не наосліп.
async function makeUniqueBookingId(KV) {
  let id = makeBookingId();
  for (let i = 0; i < 12; i++) {
    try { if (!(await KV.get(BKI_PREFIX + id))) return id; } catch { return id; }
    id = makeBookingId();
  }
  return id;
}

// Константно-часове порівняння рядків (ключі/секрети).
function constTimeEq(a, b) {
  const x = String(a || ""), y = String(b || "");
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// M1: 6-значний код кабінету на CSPRNG (rejection sampling — без bias mod 1e6).
function cryptoCode6() {
  const buf = new Uint32Array(1);
  let n = 0;
  do { crypto.getRandomValues(buf); n = buf[0]; } while (n >= 4294000000);
  return String(n % 1000000).padStart(6, "0");
}

// L4: rate-limit /deposit/checkout на пару код+IP (in-memory, як решта RL).
const DEP_RL = new Map();
function depRateOk(code, ip, now) {
  const W = 600000, MAX = 8; // 8 спроб на 10 хв на код з одного IP
  const k = code + "|" + ip;
  const v = DEP_RL.get(k);
  if (!v || now - v.t0 > W) { DEP_RL.set(k, { t0: now, n: 1 }); return true; }
  if (v.n >= MAX) return false;
  v.n += 1; DEP_RL.set(k, v);
  return true;
}

// L2: множина file_id фото опублікованих лістингів (кеш на ізолят, 60 с).
let photoAllowCache = { at: 0, set: null };
async function publishedPhotoIds(KV) {
  const now = Date.now();
  if (photoAllowCache.set && now - photoAllowCache.at < 60000) return photoAllowCache.set;
  const set = new Set();
  try {
    const keys = await kvListKeys(KV, LST_PREFIX);
    for (const k of keys) {
      const rec = await readBookingRec(KV, k);
      for (const fid of (rec && rec.photoFileIds) || []) if (fid) set.add(String(fid));
    }
    photoAllowCache = { at: now, set };
  } catch { /* лишаємо попередній кеш / порожній набір */ }
  return photoAllowCache.set || set;
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
    // M13: окремі ключі salonmap:<chatId> — без read-modify-write усього мапа.
    const v = await KV.get("salonmap:" + chatId);
    if (v) return v;
    // Легасі: до v8 мапінг жив одним JSON у ключі "salonmap".
    const raw = await KV.get("salonmap");
    if (raw) return (JSON.parse(raw) || {})[chatId] || "";
  } catch { /* ignore */ }
  return "";
}

// chatId салону за listingId: картка динамічного лістинга (lst:), далі —
// зворотний пошук у salonmap:<chatId> і легасі-JSON. Треба воркеру там,
// де публічний API listingId знає, а chatId більше не світить (M3/H2).
async function salonChatForListing(KV, listingId) {
  const lid = String(listingId || "").trim();
  if (!lid) return "";
  try {
    const lrec = await readBookingRec(KV, LST_PREFIX + lid);
    const fromLst = String((lrec && lrec.telegramChatId) || "").trim();
    if (/^\d{5,}$/.test(fromLst)) return fromLst;
  } catch { /* ignore */ }
  try {
    const keys = await kvListKeys(KV, "salonmap:");
    for (const k of keys) {
      const v = await KV.get(k);
      if (v === lid) return k.slice("salonmap:".length);
    }
    const raw = await KV.get("salonmap");
    if (raw) {
      const map = JSON.parse(raw) || {};
      for (const chat of Object.keys(map)) if (map[chat] === lid) return chat;
    }
  } catch { /* ignore */ }
  return "";
}

// M13: TTL запису бронювання — від createdAt (90 діб життя запису),
// а не від моменту кожної правки; правки більше не «омолоджують» запис.
function bookingTtl(rec) {
  const created = Date.parse((rec && rec.createdAt) || "");
  if (!Number.isFinite(created)) return BK_TTL;
  const left = Math.floor((created + BK_TTL * 1000 - Date.now()) / 1000);
  return Math.min(BK_TTL, Math.max(60, left));
}

// M13: безпечна правка запису — перечитати свіжий стан, застосувати
// мутацію лише до своїх полів, записати з TTL від createdAt.
async function updateBookingRec(KV, key, mutate) {
  const fresh = await readBookingRec(KV, key);
  if (!fresh) return null;
  const out = mutate(fresh) || fresh;
  const copy = { ...out };
  delete copy._key;
  try { await KV.put(key, JSON.stringify(copy), { expirationTtl: bookingTtl(copy) }); } catch { /* ignore */ }
  return copy;
}

// ---------- Кабінет: ціна візиту, дати (America/Toronto) ----------
// serviceId запису: прямо з payload (нові записи) або за назвою послуги
// (старі записи без serviceId — назви у сайті = українські лейбли каталогу).
function recServiceId(rec) {
  if (rec && rec.serviceId) return String(rec.serviceId);
  const name = String((rec && rec.serviceName) || "").trim().toLowerCase();
  if (!name) return "";
  const m = SVC_CATALOG.find(s => s.ua.toLowerCase() === name);
  return m ? m.id : "";
}

// Ціна візиту для виручки: 1) priceFrom із запису; 2) оверрайд ціни салону;
// 3) ціна з картки динамічного лістинга. Немає жодного джерела → null.
function visitPrice(rec, overrides, dynSvc) {
  const pf = Number(rec && rec.priceFrom);
  if (Number.isFinite(pf) && pf > 0) return pf;
  const sid = recServiceId(rec || {});
  if (sid) {
    const o = overrides && overrides[sid];
    if (o && Number(o.from) > 0) return Number(o.from);
    if (dynSvc && Number(dynSvc[sid]) > 0) return Number(dynSvc[sid]);
  }
  return null;
}

function torontoTodayISO() {
  try {
    const s = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  } catch { /* ignore */ }
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso, days) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + days * 86400000);
  return d.toISOString().slice(0, 10);
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

// M1: ліміти видачі кодів кабінету — у KV (cabrl:<chatId>), а не in-memory
// Map на ізолят: ліміт глобальний між усіма ізолятами воркера.
// Правила як раніше: не частіше ніж раз на 30 с, до 5 кодів на годину.
async function codeRateOkKv(KV, chatId, now) {
  const key = "cabrl:" + chatId;
  let rec = null;
  try {
    const raw = await KV.get(key);
    if (raw) rec = JSON.parse(raw);
  } catch { /* ignore — помилка KV не блокує вхід */ }
  if (rec) {
    if (now - (rec.last || 0) < 30000) return false;
    if (now - (rec.w || 0) <= 3600000 && (rec.n || 0) >= 5) return false;
  }
  const fresh = (!rec || now - (rec.w || 0) > 3600000)
    ? { n: 1, w: now, last: now }
    : { n: (rec.n || 0) + 1, w: rec.w, last: now };
  try { await KV.put(key, JSON.stringify(fresh), { expirationTtl: 3700 }); } catch { /* ignore */ }
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
    let sent24ok = false, sent2ok = false;
    if (!rec.r24 && diff >= 24 * H - WIN && diff <= 24 * H + WIN) {
      const ok = await tgSendWith(token, rec.clientChatId,
        "⏰ Нагадування від Booking Club\n\n" +
        "Завтра, " + rec.dateISO + " о " + rec.time + " — ваш запис:\n" +
        "💅 " + (rec.serviceName || "Послуга") + " — " + (rec.listingName || "салон") + "\n" +
        "🆔 Код: " + rec.id + "\n\n" +
        "Якщо плани змінились — скасувати можна командою: /cancel " + rec.id);
      if (ok) { sent24ok = true; stats.sent24 += 1; }
    }
    if (!rec.r2 && diff >= 2 * H - WIN && diff <= 2 * H + WIN) {
      const ok = await tgSendWith(token, rec.clientChatId,
        "⏰ Уже скоро! Сьогодні о " + rec.time + " — ваш запис:\n" +
        "💅 " + (rec.serviceName || "Послуга") + " — " + (rec.listingName || "салон") + "\n" +
        "🆔 Код: " + rec.id + "\n\n" +
        "Якщо плани змінились — скасувати можна командою: /cancel " + rec.id);
      if (ok) { sent2ok = true; stats.sent2 += 1; }
    }
    if (sent24ok || sent2ok) {
      // M13: прапорці — у свіжий запис (перечитування+мердж), TTL від createdAt.
      await updateBookingRec(KV, k, r => {
        if (sent24ok) r.r24 = true;
        if (sent2ok) r.r2 = true;
      });
    }
  }
  return stats;
}

// ============================================================
// САМОПІДКЛЮЧЕННЯ САЛОНІВ: бот-майстер, заявки, публікація
// ============================================================

function slugifyName(name) {
  const map = { а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ж: "zh", з: "z", и: "y", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ю: "yu", я: "ya", ы: "y", э: "e", ъ: "", ь: "", "'": "", "’": "" };
  const s = String(name || "").toLowerCase().split("").map(ch => map[ch] !== undefined ? map[ch] : ch).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "salon";
}

async function uniqueListingId(KV, name) {
  const base = slugifyName(name);
  for (let i = 0; i < 20; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const id = base + "-" + suffix;
    const taken = (await KV.get(LST_PREFIX + id)) || (await KV.get(PEND_PREFIX + id));
    if (!taken) return id;
  }
  return base + "-" + Date.now().toString(36);
}

// Парсер годин роботи з вільного тексту → тиждень {0..6: [from,to]|null}.
// Розуміє: «Пн–Пт 10–19, Сб 11–17, Нд — вихідний», «10:00-19:00 щодня» тощо.
// Бере перший знайдений діапазон годин; дні — зі згадок/діапазонів; «вихідний»
// поруч із днем → null. Не парситься → null (сайт візьме дефолтний тиждень).
const DAY_TOKENS = [
  [/пн|понеділ|понедельник|mon/i, 1], [/вт|вівтор|вторник|tue/i, 2],
  [/ср|серед|среда|wed/i, 3], [/чт|четвер|четверг|thu/i, 4],
  [/пт|п.?ятниц|пятниц|fri/i, 5], [/сб|субот|суббот|sat/i, 6],
  [/нд|вс|неділ|воскрес|sun/i, 0],
];
function parseWeekHours(text) {
  const t = String(text || "").toLowerCase().replace(/ʼ|’/g, "'");
  if (!t.trim()) return null;
  const hm = t.match(/(\d{1,2})(?::(\d{2}))?\s*(?:-|–|—|до|to)\s*(\d{1,2})(?::(\d{2}))?/);
  if (!hm) return null;
  const h1 = parseInt(hm[1], 10), h2 = parseInt(hm[3], 10);
  if (!(h1 >= 0 && h2 > h1 && h2 <= 24)) return null;
  const hours = [h1, h2];
  // закриті дні: день, поруч із яким «вихідн/зачинен/не працю»
  const closed = new Set();
  for (const [re, n] of DAY_TOKENS) {
    const idx = t.search(re);
    if (idx >= 0) {
      // «вихідний» має стояти одразу після дня (до ~16 символів), інакше це чужий день
      const after = t.slice(idx, idx + 16);
      if (/вихідн|зачинен|не\s+працю|выходн|закрыт/.test(after)) closed.add(n);
    }
  }
  // діапазон днів «пн-пт»
  const active = new Set();
  const spanRe = /(пн|вт|ср|чт|пт|сб|нд|вс)\s*(?:-|–|—)\s*(пн|вт|ср|чт|пт|сб|нд|вс)/;
  const sm = t.replace(/(\d)\s*(?:-|–|—)\s*(\d)/g, "$1~$2").match(spanRe);
  const dayOf = tok => { for (const [re, n] of DAY_TOKENS) if (re.test(tok)) return n; return null; };
  if (sm) {
    let a = dayOf(sm[1]), b = dayOf(sm[2]);
    if (a !== null && b !== null) {
      let d = a;
      for (let i = 0; i < 8; i++) { active.add(d); if (d === b) break; d = (d + 1) % 7; }
    }
  }
  for (const [re, n] of DAY_TOKENS) if (re.test(t) && !closed.has(n)) active.add(n);
  if (!active.size) { [1, 2, 3, 4, 5, 6].forEach(d => active.add(d)); }
  const week = {};
  for (let d = 0; d < 7; d++) week[d] = (active.has(d) && !closed.has(d)) ? hours : null;
  return week;
}

function svcLabel(id) {
  const s = SVC_CATALOG.find(x => x.id === id);
  return s ? s.ua : id;
}

function servicesKeyboard(selected) {
  const rows = [];
  for (let i = 0; i < SVC_CATALOG.length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i + 2, SVC_CATALOG.length); j++) {
      const s = SVC_CATALOG[j];
      row.push({ text: (selected.includes(s.id) ? "✅ " : "") + s.ua, callback_data: "wiz:svc:" + s.id });
    }
    rows.push(row);
  }
  rows.push([{ text: "✔️ Готово — далі", callback_data: "wiz:svcdone" }]);
  return rows;
}

function langsKeyboard(selected) {
  const rows = [];
  for (let i = 0; i < LANG_CATALOG.length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i + 2, LANG_CATALOG.length); j++) {
      const l = LANG_CATALOG[j];
      row.push({ text: (selected.includes(l.code) ? "✅ " : "") + l.label, callback_data: "wiz:lang:" + l.code });
    }
    rows.push(row);
  }
  rows.push([{ text: "✔️ Готово — далі", callback_data: "wiz:langdone" }]);
  return rows;
}

async function wizLoad(KV, chatId) {
  try {
    const raw = await KV.get(WIZ_PREFIX + chatId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function wizSave(KV, chatId, st) {
  try { await KV.put(WIZ_PREFIX + chatId, JSON.stringify(st), { expirationTtl: WIZ_TTL }); } catch { /* ignore */ }
}
async function wizClear(KV, chatId) {
  try { await KV.delete(WIZ_PREFIX + chatId); } catch { /* ignore */ }
}

function wizFresh() {
  return { step: "name", d: { services: [], prices: {}, priceIdx: 0, langs: [], photos: [] }, upd: Date.now() };
}

async function wizardStart(chatId, ctx) {
  await wizSave(ctx.KV, chatId, wizFresh());
  await tgSendKb(ctx.token, chatId,
    "👋 Вітаю у Booking Club!\n\n" +
    "Підключимо ваш салон або вас як майстра за кілька кроків — прямо тут, у Telegram. " +
    "Наприкінці заявка піде команді Booking Club, і після підтвердження ви зʼявитесь на bookingclub.beauty.\n\n" +
    "Крок 1. Як називається ваш салон / студія? (або ваше імʼя, якщо ви майстер)", null);
}

async function wizardAskKind(chatId, ctx) {
  await tgSendKb(ctx.token, chatId, "Крок 2. Що це буде?", [[
    { text: "🏢 Салон", callback_data: "wiz:kind:salon" },
    { text: "🏠 Майстер на дому", callback_data: "wiz:kind:home" },
    { text: "💈 Барбершоп", callback_data: "wiz:kind:barber" },
  ]]);
}

async function wizardAskPrice(chatId, ctx, st) {
  const svcId = st.d.services[st.d.priceIdx];
  await tgSendKb(ctx.token, chatId,
    "Крок 5. Ціна за послугу «" + svcLabel(svcId) + "» — у CAD, тільки число (наприклад 45). Це ціна «від» — діапазон можна уточнити пізніше у кабінеті.", null);
}

async function wizardSummary(chatId, ctx, st) {
  const d = st.d;
  const lines = [
    "📋 Перевірте заявку:",
    "",
    "Назва: " + (d.name || "—"),
    "Тип: " + (d.kind === "home" ? "Майстер на дому" : d.kind === "barber" ? "Барбершоп" : "Салон"),
    (d.kind === "home" ? "Район: " : "Адреса: ") + (d.place || "—"),
    "Послуги: " + d.services.map(id => svcLabel(id) + " — $" + (d.prices[id] ?? "—")).join("; "),
    "Години: " + (d.hoursText || "за замовчуванням"),
    "Мови: " + (d.langLabels && d.langLabels.length ? d.langLabels.join(", ") : "Українська"),
    "Фото: " + (d.photos.length ? d.photos.length + " шт." : "немає"),
  ];
  await tgSendKb(ctx.token, chatId, lines.join("\n"), [[
    { text: "📨 Надіслати заявку", callback_data: "wiz:send" },
    { text: "🔄 Почати заново", callback_data: "wiz:restart" },
  ]]);
}

async function wizardText(chatId, text, ctx) {
  const st = await wizLoad(ctx.KV, chatId);
  if (!st) return false;
  const d = st.d;
  const val = String(text || "").trim();
  if (!val) return true;
  if (st.step === "name") {
    if (val.length < 2) { await tgSendKb(ctx.token, chatId, "Назва надто коротка — напишіть, будь ласка, повну назву.", null); return true; }
    d.name = val.slice(0, 90);
    st.step = "kind";
    await wizSave(ctx.KV, chatId, st);
    await wizardAskKind(chatId, ctx);
    return true;
  }
  if (st.step === "place") {
    d.place = val.slice(0, 160);
    st.step = "services";
    await wizSave(ctx.KV, chatId, st);
    await tgSendKb(ctx.token, chatId,
      "Крок 4. Оберіть послуги, які надаєте (можна кілька) — тисніть кнопки, потім «Готово»:",
      servicesKeyboard(d.services));
    return true;
  }
  if (st.step === "price") {
    const n = Number(val.replace(",", ".").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n < 1 || n > 10000) {
      await tgSendKb(ctx.token, chatId, "Потрібне число від 1 до 10000 (CAD). Спробуйте ще раз:", null);
      return true;
    }
    const svcId = d.services[d.priceIdx];
    d.prices[svcId] = Math.round(n);
    d.priceIdx += 1;
    await wizSave(ctx.KV, chatId, st);
    if (d.priceIdx < d.services.length) await wizardAskPrice(chatId, ctx, st);
    else {
      st.step = "hours";
      await wizSave(ctx.KV, chatId, st);
      await tgSendKb(ctx.token, chatId,
        "Крок 6. Ваші години роботи — вільним текстом.\nНаприклад: Пн–Пт 10–19, Сб 11–17, Нд — вихідний", null);
    }
    return true;
  }
  if (st.step === "hours") {
    d.hoursText = val.slice(0, 200);
    d.week = parseWeekHours(val);
    st.step = "langs";
    await wizSave(ctx.KV, chatId, st);
    await tgSendKb(ctx.token, chatId, "Крок 7. Мови обслуговування (можна кілька):", langsKeyboard(d.langs));
    return true;
  }
  if (st.step === "photos" && /^готово$/i.test(val)) {
    st.step = "summary";
    await wizSave(ctx.KV, chatId, st);
    await wizardSummary(chatId, ctx, st);
    return true;
  }
  // Текст на кроці з кнопками — нагадаємо, що треба тиснути кнопки
  if (["kind", "services", "langs", "photos", "summary"].includes(st.step)) {
    await tgSendKb(ctx.token, chatId, "Тут треба натиснути кнопку вище 👆 Якщо кнопки загубились — напишіть /join, і почнемо спочатку (уже введене зникне).", null);
    return true;
  }
  return false;
}

async function wizardPhoto(chatId, photos, ctx) {
  const st = await wizLoad(ctx.KV, chatId);
  if (!st || st.step !== "photos") return false;
  const best = photos[photos.length - 1];
  const fid = best && best.file_id;
  if (fid && !st.d.photos.includes(fid) && st.d.photos.length < 6) {
    st.d.photos.push(fid);
    await wizSave(ctx.KV, chatId, st);
  }
  await tgSendKb(ctx.token, chatId,
    "📸 Фото отримано: " + st.d.photos.length + "/6." + (st.d.photos.length >= 6 ? " Це максимум." : " Можете надіслати ще або завершити."),
    [[{ text: "✔️ Готово — до підсумку", callback_data: "wiz:photodone" }]]);
  return true;
}

// Лістинг у внутрішній (канонічній) формі — зберігається у pend:/lst:
function buildListingFromWizard(chatId, d) {
  const services = (d.services || []).map(id => {
    const meta = SVC_CATALOG.find(x => x.id === id) || {};
    return { serviceId: id, from: d.prices[id] ?? 40, to: null, durationMin: meta.dur || 60 };
  });
  return {
    id: "", dynamic: true, source: "bot",
    name: String(d.name || "Салон").replace(/[<>]/g, ""),
    brand: String(d.name || "Салон").replace(/[<>]/g, ""),
    city: "Montréal",
    type: d.kind || "salon",
    address: d.place || "",
    district: d.kind === "home" ? (d.place || "") : "",
    services,
    languages: (d.langLabels && d.langLabels.length) ? d.langLabels : ["Українська"],
    photoFileIds: (d.photos || []).slice(),
    schedule: d.week || null,
    week: d.week || null,
    hoursText: d.hoursText || "",
    description: "",
    bio_ua: "",
    telegramChatId: String(chatId),
    phone: "", instagram: "",
    partner: false, verified: false, sterile: false, recommended: false,
    createdAt: new Date().toISOString(),
  };
}

function buildListingFromForm(data) {
  const svcIds = [];
  const pricesText = String(data?.pricesText || data?.prices || "");
  const priceMap = parsePricesText(pricesText);
  const rawServices = Array.isArray(data?.services) ? data.services : [];
  for (const s of rawServices) {
    const name = String(s || "").trim().toLowerCase();
    const meta = SVC_CATALOG.find(x => x.ua.toLowerCase() === name || x.id === name);
    if (meta && !svcIds.includes(meta.id)) svcIds.push(meta.id);
  }
  const services = svcIds.map(id => {
    const meta = SVC_CATALOG.find(x => x.id === id) || {};
    return { serviceId: id, from: priceMap[id] ?? priceMap._any ?? 40, to: null, durationMin: meta.dur || 60 };
  });
  const address = String(data?.address || "").replace(/[<>]/g, "").trim();
  const district = String(data?.district || "").replace(/[<>]/g, "").trim();
  const hoursText = String(data?.hoursText || "").trim();
  // АУДИТ-ФІКС: години з форми раніше губилися (schedule/week = null) і сайт
  // підставляв DEFAULT_WEEK. Парсимо тим самим парсером, що й бот-майстер.
  const week = parseWeekHours(hoursText);
  return {
    id: "", dynamic: true, source: "form",
    name: String(data?.salonName || "Салон").replace(/[<>]/g, "").slice(0, 90),
    brand: String(data?.salonName || "Салон").replace(/[<>]/g, "").slice(0, 90),
    city: "Montréal",
    type: "salon",
    address: address ? (district ? address + " (" + district + ")" : address) : district,
    district,
    services,
    languages: Array.isArray(data?.languages) ? data.languages.map(x => String(x)) : [],
    photoFileIds: [],
    pricesText,
    schedule: week, week,
    hoursText,
    description: String(data?.description || "").trim(),
    bio_ua: String(data?.description || "").trim(),
    telegramChatId: String(data?.telegramChatId || "").trim(),
    phone: String(data?.phone || ""),
    instagram: String(data?.instagram || ""),
    contactName: String(data?.name || ""),
    plan: String(data?.plan || ""),
    partner: false, verified: false, sterile: false, recommended: false,
    createdAt: new Date().toISOString(),
  };
}

// «Манікюр 45, Педикюр — 60» або рядки «lashes: 80» → {serviceId: price, _any}
function parsePricesText(text) {
  const out = {};
  const t = String(text || "");
  if (!t.trim()) return out;
  for (const meta of SVC_CATALOG) {
    const re = new RegExp(meta.ua.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^0-9]{0,12}(\\d{1,5})", "i");
    const m = t.match(re) || t.match(new RegExp(meta.id + "[^0-9]{0,12}(\\d{1,5})", "i"));
    if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 10000) out[meta.id] = n; }
  }
  if (!Object.keys(out).length) {
    const any = t.match(/(\d{1,5})/);
    if (any) { const n = parseInt(any[1], 10); if (n >= 1 && n <= 10000) out._any = n; }
  }
  return out;
}

function applicationSummary(listing, source) {
  const lines = [
    "🆕 ЗАЯВКА САЛОНУ на Booking Club" + (source === "form" ? " (форма на сайті)" : " (через бота)"),
    "",
    "Назва: " + (listing.name || "—"),
    "Тип: " + (listing.type === "home" ? "Майстер на дому" : listing.type === "barber" ? "Барбершоп" : "Салон"),
    "Адреса/район: " + (listing.address || "—"),
    "Послуги: " + ((listing.services || []).map(s => svcLabel(s.serviceId) + " — $" + s.from).join("; ") || "—"),
  ];
  if (listing.pricesText) lines.push("Ціни (текст салону): " + listing.pricesText);
  if (listing.hoursText) lines.push("Години: " + listing.hoursText);
  if (listing.languages && listing.languages.length) lines.push("Мови: " + listing.languages.join(", "));
  if (listing.plan) lines.push("Тариф: " + listing.plan);
  if (listing.phone) lines.push("Телефон: " + listing.phone);
  if (listing.contactName) lines.push("Контакт: " + listing.contactName);
  if (listing.instagram) lines.push("Instagram: " + listing.instagram);
  lines.push("Фото: " + ((listing.photoFileIds || []).length ? listing.photoFileIds.length + " шт." : "немає"));
  lines.push("Telegram ID салону: " + (listing.telegramChatId || "⚠️ НЕ ВКАЗАНО — бронювання летітимуть тільки вам"));
  return lines.join("\n");
}

async function notifyOwnerApplication(ctx, pendId, listing, source) {
  await tgSendKb(ctx.token, ctx.ownerChat, applicationSummary(listing, source), [[
    { text: "✅ Опублікувати", callback_data: "pub:" + pendId },
    { text: "❌ Відхилити", callback_data: "rej:" + pendId },
  ]]);
}

// Форма лістинга для сайту (GET /listings): ті самі поля, що у data.js LISTINGS,
// без rating (сайт покаже бейдж «Новий»), фото — URL-и проксі /photo/<file_id>.
function listingForSite(rec) {
  const bio = rec.bio_ua || rec.description || (rec.hoursText ? "🕐 " + rec.hoursText : "");
  return {
    id: rec.id,
    name: rec.name || "Салон",
    brand: rec.brand || rec.name || "Салон",
    city: rec.city || "Montréal",
    address: rec.address || "",
    district: rec.district || "",
    lat: (rec.lat != null ? rec.lat : null),
    lng: (rec.lng != null ? rec.lng : null),
    partner: !!rec.partner, recommended: !!rec.recommended,
    verified: !!rec.verified, sterile: !!rec.sterile,
    // M3: phone і telegramChatId публічно НЕ віддаємо — Telegram ID майстра
    // не для публіки (ціль для спаму/атак на кабінет); де воркеру треба
    // chatId за listingId, він бере його сам із KV (lst:/salonmap:).
    instagram: rec.instagram || "",
    images: (rec.photoFileIds || []).map(fid => WORKER_ORIGIN + "/photo/" + fid),
    bio_ua: bio,
    services: rec.services || [],
    schedule: rec.schedule || rec.week || null,
    languages: rec.languages || [],
    dynamic: true,
  };
}

// ---------- Callback-и: майстер, публікація, відвідуваність ----------
async function handleCallbackQuery(cq, ctx) {
  const data = String(cq.data || "");
  const fromId = String((cq.from && cq.from.id) || "");
  const msgChat = String((cq.message && cq.message.chat && cq.message.chat.id) || fromId);
  const msgId = cq.message && cq.message.message_id;
  const msgText = (cq.message && cq.message.text) || "";
  const { KV, token, ownerChat } = ctx;
  if (!KV) { await tgAnswerCb(token, cq.id, "Сховище не підключено"); return; }

  // ----- Майстер підключення -----
  if (data.startsWith("wiz:")) {
    const chatId = msgChat;
    const st = await wizLoad(KV, chatId);
    if (!st) { await tgAnswerCb(token, cq.id, "Сесія застаріла — напишіть /join, щоб почати заново"); return; }
    const d = st.d;
    const parts = data.split(":");
    const action = parts[1], val = parts[2] || "";
    if (action === "kind") {
      d.kind = ["salon", "home", "barber"].includes(val) ? val : "salon";
      st.step = "place";
      await wizSave(KV, chatId, st);
      await tgAnswerCb(token, cq.id, "");
      if (d.kind === "home") {
        await tgSendKb(token, chatId,
          "Крок 3. Ваш район у Монреалі.\n\n" +
          "🏠 Для майстрів на дому ми публічно показуємо ТІЛЬКИ район — точна домашня адреса на сайті не світиться. " +
          "Клієнт дізнається адресу лише особисто від вас після запису.\n\nНапишіть район (наприклад: Verdun, Côte-des-Neiges, Le Plateau):", null);
      } else {
        await tgSendKb(token, chatId,
          "Крок 3. Адреса у Монреалі — вулиця і номер будинку, можна одразу з районом (наприклад: 1242 Rue Stanley, Downtown):", null);
      }
      return;
    }
    if (action === "svc") {
      const i = d.services.indexOf(val);
      if (i >= 0) d.services.splice(i, 1); else if (SVC_CATALOG.some(x => x.id === val)) d.services.push(val);
      await wizSave(KV, chatId, st);
      await tgAnswerCb(token, cq.id, "");
      if (msgId) await tgEditKb(token, chatId, msgId, servicesKeyboard(d.services));
      return;
    }
    if (action === "svcdone") {
      if (!d.services.length) { await tgAnswerCb(token, cq.id, "Оберіть хоча б одну послугу 🙏"); return; }
      d.priceIdx = 0;
      st.step = "price";
      await wizSave(KV, chatId, st);
      await tgAnswerCb(token, cq.id, "");
      await wizardAskPrice(chatId, ctx, st);
      return;
    }
    if (action === "lang") {
      const i = d.langs.indexOf(val);
      if (i >= 0) d.langs.splice(i, 1); else if (LANG_CATALOG.some(x => x.code === val)) d.langs.push(val);
      await wizSave(KV, chatId, st);
      await tgAnswerCb(token, cq.id, "");
      if (msgId) await tgEditKb(token, chatId, msgId, langsKeyboard(d.langs));
      return;
    }
    if (action === "langdone") {
      d.langLabels = (d.langs.length ? d.langs : ["ua"]).map(c => (LANG_CATALOG.find(x => x.code === c) || {}).label || c);
      st.step = "photos";
      await wizSave(KV, chatId, st);
      await tgAnswerCb(token, cq.id, "");
      await tgSendKb(token, chatId,
        "Крок 8. Фото 📸 Надішліть 1–6 фото ваших робіт або салону (по одному чи альбомом).\n" +
        "З фото клієнти записуються значно охочіше. Коли закінчите — кнопка нижче.",
        [[{ text: "✔️ Готово — до підсумку", callback_data: "wiz:photodone" }]]);
      return;
    }
    if (action === "photodone") {
      st.step = "summary";
      await wizSave(KV, chatId, st);
      await tgAnswerCb(token, cq.id, "");
      await wizardSummary(chatId, ctx, st);
      return;
    }
    if (action === "restart") {
      await tgAnswerCb(token, cq.id, "Починаємо спочатку");
      await wizardStart(chatId, ctx);
      return;
    }
    if (action === "send") {
      const listing = buildListingFromWizard(chatId, d);
      const pendId = await uniqueListingId(KV, listing.name);
      listing.id = pendId;
      await KV.put(PEND_PREFIX + pendId, JSON.stringify({
        listing, chatId: String(chatId), source: "bot", submittedAt: new Date().toISOString(),
      }), { expirationTtl: PEND_TTL });
      await wizClear(KV, chatId);
      await tgAnswerCb(token, cq.id, "Заявку надіслано ✅");
      await tgSendKb(token, chatId,
        "📨 Заявку надіслано команді Booking Club!\n\n" +
        "Щойно він підтвердить — ваш салон зʼявиться на bookingclub.beauty, а сюди прийде повідомлення. Зазвичай це швидко.", null);
      await notifyOwnerApplication(ctx, pendId, listing, "bot");
      return;
    }
    await tgAnswerCb(token, cq.id, "");
    return;
  }

  // ----- Публікація / відхилення заявки (тільки власник) -----
  if (data.startsWith("pub:") || data.startsWith("rej:")) {
    const publish = data.startsWith("pub:");
    const pendId = data.slice(4);
    if (fromId !== ownerChat) { await tgAnswerCb(token, cq.id, "Заявки затверджує тільки команда Booking Club"); return; }
    const raw = await KV.get(PEND_PREFIX + pendId);
    if (!raw) { await tgAnswerCb(token, cq.id, "Заявку не знайдено — можливо, уже оброблено"); return; }
    let pend = null;
    try { pend = JSON.parse(raw); } catch { /* ignore */ }
    if (!pend || !pend.listing) { await tgAnswerCb(token, cq.id, "Пошкоджена заявка"); return; }
    const listing = pend.listing;
    const salonChat = String(pend.chatId || listing.telegramChatId || "");
    await KV.delete(PEND_PREFIX + pendId);
    if (publish) {
      await KV.put(LST_PREFIX + listing.id, JSON.stringify(listing));
      if (salonChat && /^\d{5,}$/.test(salonChat)) {
        // M13: окремий ключ на салон — паралельні публікації не затирають одна одну.
        try { await KV.put("salonmap:" + salonChat, listing.id); } catch { /* ignore */ }
      }
      await tgAnswerCb(token, cq.id, "Опубліковано ✅");
      if (msgId) await tgEditText(token, msgChat, msgId, msgText + "\n\n✅ ОПУБЛІКОВАНО на bookingclub.beauty", null);
      if (salonChat) {
        await tgSendKb(token, salonChat,
          "🎉 Вітаємо! Ваш салон уже на сайті Booking Club:\n" +
          "https://bookingclub.beauty/profile.html?id=" + encodeURIComponent(listing.id) + "\n\n" +
          "Бронювання приходитимуть прямо сюди, у цей чат.\n" +
          "Корисні команди:\n" +
          "/bookings — найближчі записи клієнтів\n" +
          "/cancel BK-XXXXXX — скасувати запис\n" +
          "/close 2026-11-03 — закрити день · /open — відкрити\n" +
          "Кабінет (графік і ціни): bookingclub.beauty/admin", null);
      }
      // Автопост у Telegram-канал платформи (тільки якщо задано CHANNEL_ID)
      if (ctx.channelId) {
        try {
          const placeLine = listing.type === "home"
            ? (listing.district || listing.address || "")
            : (listing.address || "");
          const svcLines = (listing.services || [])
            .map(s => "• " + svcLabel(s.serviceId) + " — $" + (s.from != null ? s.from : "—"))
            .join("\n");
          await tgSendKb(token, ctx.channelId,
            "🆕 Новий салон на Booking Club!\n\n" +
            "🏠 " + (listing.name || "Салон") +
            (placeLine ? "\n📍 " + placeLine + ", Montréal" : "") +
            (svcLines ? "\n\n💅 Послуги:\n" + svcLines : "") +
            "\n\nЗапис онлайн — за посиланням 👇", [[
              { text: "📅 Записатись", url: "https://bookingclub.beauty/profile.html?id=" + encodeURIComponent(listing.id) },
            ]]);
        } catch { /* канал — додаткова вітрина, публікацію не блокуємо */ }
      }
    } else {
      await tgAnswerCb(token, cq.id, "Відхилено");
      if (msgId) await tgEditText(token, msgChat, msgId, msgText + "\n\n❌ ВІДХИЛЕНО", null);
      if (salonChat) {
        await tgSendKb(token, salonChat,
          "Дякуємо за заявку до Booking Club! На жаль, цього разу ми не змогли її опублікувати. " +
          "Якщо це помилка або хочете уточнити деталі — напишіть команді Booking Club або на hello@bookingclub.beauty, і ми все владнаємо.", null);
      }
    }
    return;
  }

  // ----- Відвідуваність: кнопки салону -----
  if (data.startsWith("att:")) {
    const parts = data.split(":");
    const code = parts[1] || "";
    const yn = parts[2] || "";
    const key = await KV.get(BKI_PREFIX + code);
    const rec = key ? await readBookingRec(KV, key) : null;
    if (!rec || !key) { await tgAnswerCb(token, cq.id, "Запис не знайдено"); return; }
    if (fromId !== ownerChat && String(rec.chatId || "") !== fromId) {
      await tgAnswerCb(token, cq.id, "Це бронювання іншого салону");
      return;
    }
    const status = yn === "y" ? "attended" : "noshow";
    rec._key = key;
    await setBookingStatus(KV, rec, status);
    await tgAnswerCb(token, cq.id, status === "attended" ? "✅ Позначено: клієнт прийшов" : "🚫 Позначено: no-show");
    if (msgId) {
      await tgEditText(token, msgChat, msgId,
        msgText + "\n\n" + (status === "attended" ? "✅ Позначено: клієнт прийшов" : "🚫 Позначено: клієнт не прийшов"), null);
    }
    if (status === "noshow" && fromId !== ownerChat) {
      await tgSendKb(token, ownerChat,
        "🚫 No-show у салоні " + (rec.listingName || rec.listingId || "") + "\n" +
        "💅 " + (rec.serviceName || "Послуга") + " · 📅 " + rec.dateISO + " о " + rec.time + "\n" +
        "👤 " + (rec.name || "") + (rec.phone ? " · " + rec.phone : "") + "\n🆔 " + rec.id, null);
    }
    return;
  }

  await tgAnswerCb(token, cq.id, "");
}

// ============================================================
// ВІДВІДУВАНІСТЬ: статуси, скан після візиту, статистика
// ============================================================

async function findBookingForActor(KV, code, chatId, ownerChat) {
  const key = await KV.get(BKI_PREFIX + code);
  const rec = key ? await readBookingRec(KV, key) : null;
  if (!rec || !key) return null;
  rec._key = key;
  if (chatId === ownerChat) return rec;
  if (String(rec.chatId || "") === chatId) return rec;
  const listingId = await salonListingId(KV, chatId);
  if (listingId && rec.listingId === listingId) return rec;
  if (rec.listingKey === "chat-" + chatId) return rec;
  return null;
}

async function setBookingStatus(KV, rec, status) {
  // M13: статус пишемо у свіжий запис (перечитування+мердж), а не у
  // потенційно застарілий знімок викликача.
  await updateBookingRec(KV, rec._key, r => {
    r.status = status;
    r.statusAt = new Date().toISOString();
  });
}

// Після візиту (+30 хв) питаємо салон кнопками, чи прийшов клієнт.
async function scanAttendance(env) {
  const stats = { asked: 0 };
  const KV = (env && env.BC_KV) || null;
  const token = getBotToken(env);
  if (!KV || !token) return stats;
  const now = Date.now();
  let keys = [];
  try { keys = await kvListKeys(KV, BK_PREFIX); } catch { return stats; }
  for (const k of keys) {
    const rec = await readBookingRec(KV, k);
    if (!rec) continue;
    if ((rec.status || "booked") !== "booked") continue;
    if (rec.attAsked) continue;
    if (!rec.chatId || !/^\d{5,}$/.test(String(rec.chatId))) continue;
    const visit = torontoVisitMs(rec.dateISO, rec.time);
    if (visit === null || now - visit < 30 * 60000) continue;
    const ok = await tgSendKb(token, rec.chatId,
      "⏰ Як пройшов візит?\n\n" +
      "👤 " + (rec.name || "Клієнт") + "\n" +
      "💅 " + (rec.serviceName || "Послуга") + "\n" +
      "📅 " + rec.dateISO + " о " + rec.time + "\n" +
      "🆔 " + rec.id + "\n\nКлієнт прийшов?",
      [[
        { text: "✅ Прийшов", callback_data: "att:" + rec.id + ":y" },
        { text: "🚫 Не прийшов", callback_data: "att:" + rec.id + ":n" },
      ]]);
    if (ok) {
      await updateBookingRec(KV, k, r => { r.attAsked = true; });
      stats.asked += 1;
    }
  }
  return stats;
}

// Агрегація по лістингах: всього / прийшло / no-show / майбутніх.
async function platformStats(KV) {
  const byId = new Map();
  const keys = await kvListKeys(KV, BK_PREFIX);
  const now = Date.now();
  for (const k of keys) {
    const rec = await readBookingRec(KV, k);
    if (!rec) continue;
    const lid = rec.listingId || rec.listingKey || "—";
    if (!byId.has(lid)) {
      byId.set(lid, { listingId: lid, listingName: rec.listingName || lid, total: 0, attended: 0, noshow: 0, upcoming: 0 });
    }
    const row = byId.get(lid);
    if (!row.listingName && rec.listingName) row.listingName = rec.listingName;
    row.total += 1;
    const st = rec.status || "booked";
    if (st === "attended") row.attended += 1;
    else if (st === "noshow") row.noshow += 1;
    else {
      const visit = torontoVisitMs(rec.dateISO, rec.time);
      if (visit !== null && visit >= now) row.upcoming += 1;
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.total - a.total);
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
