export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---------- CORS ----------
    const corsHeaders = (origin) => ({
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });

    if (request.method === "OPTIONS") {
      return new Response("", { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
    }

    // ---------- health ----------
    if (url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(request.headers.get("Origin")) },
      });
    }

    // ---------- book ----------
    if (url.pathname === "/book" && request.method === "POST") {
      try {
        const origin = request.headers.get("Origin") || "*";

        if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) {
          return new Response("Missing TG secrets", {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(origin) },
          });
        }

        const data = await request.json().catch(() => ({}));

        // Fields we expect from index.html
        const name = (data.name || "").trim() || "—";
        const phone = (data.phone || "").trim() || "—";
        const email = (data.email || "").trim() || "—";
        const notes = (data.notes || "").trim() || "—";

        const listingName = (data.listingName || "").trim() || "—";
        const address = (data.address || "").trim() || "—";

        const serviceName = (data.serviceName || data.serviceId || "").trim() || "—";
        const priceFrom = (data.priceFrom != null) ? `$${Math.round(Number(data.priceFrom))}` : "—";
        const durationMin = (data.durationMin != null) ? `${Number(data.durationMin)} min` : "—";

        // ✅ FIX: time + date must show
        const dateISO = (data.dateISO || "").trim();
        const time = (data.time || "").trim();
        const datetimeLocal =
          (data.datetimeLocal || "").trim() ||
          ((dateISO && time) ? `${dateISO} ${time}` : "—");

        const profileUrl = (data.profileUrl || "").trim();
        const siteUrl = origin && origin !== "null" ? origin : "";

        const title = "✨ Нове бронювання (Beauty Booking)";
        const lines = [
          title,
          "",
          `👤 Імʼя: ${name}`,
          `📞 Телефон: ${phone}`,
          `✉️ Email: ${email}`,
          "",
          `💅 Послуга: ${serviceName} · ${priceFrom} · ${durationMin}`,
          `⏰ Час: ${datetimeLocal}`,
          "",
          `🏛️ Салон/Майстер: ${listingName}`,
          `📍 Адреса: ${address}`,
          "",
          profileUrl ? `🔗 Профіль: ${profileUrl}` : (siteUrl ? `🔗 Сайт: ${siteUrl}` : ""),
          notes !== "—" ? `📝 Коментар: ${notes}` : "",
        ].filter(Boolean);

        const text = lines.join("\n");

        const tgUrl = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`;
        const tgPayload = {
          chat_id: env.TG_CHAT_ID,
          text,
          disable_web_page_preview: false,
        };

        const tgRes = await fetch(tgUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tgPayload),
        });

        const tgText = await tgRes.text().catch(() => "");
        if (!tgRes.ok) {
          return new Response(`Telegram error: ${tgRes.status}\n${tgText}`, {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(origin) },
          });
        }

        return new Response("ok", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(origin) },
        });
      } catch (e) {
        return new Response(`Error: ${e?.message || e}`, {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(request.headers.get("Origin")) },
        });
      }
    }

    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders(request.headers.get("Origin")) },
    });
  },
};

