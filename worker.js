export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- CORS ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    // =========================
    // ✅ ТВОЇ ДАНІ TELEGRAM (HARDCODE)
    // (env має пріоритет, але якщо env пустий — візьме ці)
    // =========================
    const BOT_TOKEN = (env && env.BOT_TOKEN) || "8372355612:AAE7a1Z95LdgFc-h-G1VNlfg5WzW9x0I6VA";
    const CHAT_ID  = (env && env.CHAT_ID)  || "7384123064";

    // --- OG preview для шарингу: /p?site=...&id=...
    if (request.method === "GET" && (url.pathname === "/p" || url.pathname === "/p/")) {
      const site = url.searchParams.get("site") || "";
      const id = url.searchParams.get("id") || "";

      const OG = {
        "iryna-stovban": {
          title: "Iryna Stovban — Beauty Booking",
          desc: "Манікюр для моделей • стерильно • делікатно",
          img: "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1400&q=80"
        },
        "romanukova-nail-studio": {
          title: "Romanukova Nail Studio — Beauty Booking",
          desc: "Преміум манікюр • педикюр • швидкі слоти",
          img: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1400&q=80"
        },
        "studio-aura": {
          title: "Studio Aura — Beauty Booking",
          desc: "Манікюр • гель-лак • брови",
          img: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1400&q=80"
        },
        "lux-nails": {
          title: "LUX Nails — Beauty Booking",
          desc: "Педикюр • SPA • швидкі слоти",
          img: "https://images.unsplash.com/photo-1515378791036-0648a3ef77b2?auto=format&fit=crop&w=1400&q=80"
        },
        "minimal-studio": {
          title: "Minimal Studio — Beauty Booking",
          desc: "Манікюр • гель • нарощування",
          img: "https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?auto=format&fit=crop&w=1400&q=80"
        },
        "bloom-beauty": {
          title: "Bloom Beauty — Beauty Booking",
          desc: "Брови • вії • манікюр",
          img: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1400&q=80"
        },
        "velvet-nails": {
          title: "Velvet Nails — Beauty Booking",
          desc: "Манікюр • педикюр • гель",
          img: "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1400&q=80"
        }
      };

      const p = OG[id] || {
        title: "Beauty Booking",
        desc: "Book beauty services in seconds — verified salons & masters.",
        img: "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1400&q=80"
      };

      const redirect = site ? `${site}profile.html?id=${encodeURIComponent(id)}` : "";
      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta property="og:title" content="${escapeHtml(p.title)}" />
  <meta property="og:description" content="${escapeHtml(p.desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="${escapeHtml(p.img)}" />
  <meta name="twitter:card" content="summary_large_image" />
  ${redirect ? `<meta http-equiv="refresh" content="0;url=${escapeHtml(redirect)}" />` : ""}
  <title>${escapeHtml(p.title)}</title>
</head>
<body style="background:#0b0b10;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center;opacity:.85">
    Opening…<br/><small>${redirect ? escapeHtml(redirect) : ""}</small>
  </div>
  ${redirect ? `<script>location.replace(${JSON.stringify(redirect)});</script>` : ""}
</body>
</html>`;

      return new Response(html, { headers: { "Content-Type":"text/html; charset=utf-8", ...corsHeaders } });
    }

    // Health check
    if (request.method === "GET") {
      return new Response("OK", { headers: { ...corsHeaders } });
    }

    // Booking endpoint
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { ...corsHeaders } });
    }

    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return new Response("Bad content-type", { status: 400, headers: { ...corsHeaders } });
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400, headers: { ...corsHeaders } });
    }

    // ✅ антиспам: мінімум імʼя+телефон
    const name = String(data?.name || "").trim();
    const phone = String(data?.phone || "").trim();
    if (!name || !phone) {
      return new Response("name+phone required", { status: 400, headers: { ...corsHeaders } });
    }

    // ✅ honeypot
    const hp = String(data?.hp || "").trim();
    if (hp) {
      return new Response("blocked", { status: 400, headers: { ...corsHeaders } });
    }

    // ✅ rate limit per IP (best-effort)
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    if (!rateLimit(ip, Date.now())) {
      return new Response("rate_limited", { status: 429, headers: { ...corsHeaders } });
    }

    if (!BOT_TOKEN || !CHAT_ID) {
      return new Response("BOT_TOKEN/CHAT_ID missing", { status: 500, headers: { ...corsHeaders } });
    }

    const text =
      (data?.message && String(data.message).trim())
        ? String(data.message).trim()
        : buildTextFallback(data);

    const tgUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const payload = {
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: false
    };

    const resp = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload),
    });

    const tgBody = await resp.text().catch(() => "");
    if (!resp.ok) {
      return new Response(`telegram_error: ${tgBody}`, { status: 502, headers: { ...corsHeaders } });
    }

    return new Response("ok", { headers: { ...corsHeaders } });
  }
};

function escapeHtml(s){
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

// best-effort rate limiter (per isolate)
const RL = new Map(); // ip -> {t,count}
function rateLimit(ip, now){
  const W = 30_000; // 30s window
  const MAX = 3;    // max 3 req / 30s / ip
  const v = RL.get(ip);
  if (!v){ RL.set(ip, { t: now, count: 1 }); return true; }
  if (now - v.t > W){ RL.set(ip, { t: now, count: 1 }); return true; }
  if (v.count >= MAX) return false;
  v.count += 1;
  RL.set(ip, v);
  return true;
}

function buildTextFallback(d){
  const lines = [];
  const pType = d?.providerType === "salon" ? "Салон" : "Майстер";
  const when = `${d?.date || "—"} ${d?.time || "—"}`.trim();

  lines.push("Нове бронювання ✨");
  lines.push("");
  lines.push(`Імʼя: ${d?.name || ""}`.trim());
  lines.push(`Телефон: ${d?.phone || ""}`.trim());
  if (d?.email) lines.push(`Email: ${d.email}`);
  if (d?.serviceNameUA || d?.serviceNameEN){
    const svc = d?.serviceNameUA || d?.serviceNameEN;
    const price = d?.servicePrice != null ? ` (${d.servicePrice}$)` : "";
    lines.push(`Послуга: ${svc}${price}`);
  }
  if (d?.providerName) lines.push(`${pType}: ${d.providerName}`);
  if (d?.address) lines.push(`Адреса: ${d.address}`);
  lines.push(`Час: ${when}`);
  if (d?.comment) { lines.push(""); lines.push(`Коментар: ${d.comment}`); }
  lines.push("");
  lines.push("#beautybooking");

  return lines.join("\n");
}
