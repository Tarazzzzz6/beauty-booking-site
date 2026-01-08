* Beauty Booking — data.js (global, LIVE + backward compatible) */
(function(){
  // ===== Worker endpoint (fallback used by profile booking) =====
  window.WORKER_URL = window.WORKER_URL || "https://snowy-shadow-0b58.irafarm2000.workers.dev";
  // Demo slots generator: keep true while проект у тесті (можна вимкнути пізніше)
  window.BB_DEMO_SLOTS = (window.BB_DEMO_SLOTS !== false);

/
  // ---- SERVICES ----
  window.SERVICES = [
    { id:"manicure", ua:"Манікюр", en:"Manicure", icon:"💅" },
    { id:"pedicure", ua:"Педикюр", en:"Pedicure", icon:"🦶" },
    { id:"brows", ua:"Брови", en:"Brows", icon:"✨" },
    { id:"mens_haircut", ua:"Стрижка чоловіча", en:"Men's haircut", icon:"✂️" },
    { id:"womens_haircut", ua:"Стрижка жіноча", en:"Women's haircut", icon:"💇‍♀️" },
  ];
  // ---- PAYMENTS (demo config) ----
  window.PAYMENTS = window.PAYMENTS || {
    mode: "demo",
    depositEnabled: true,
    depositAmount: 10,
    applePay: true,
    googlePay: false
  };


  // ===== Demo metrics (stable per listing) =====
  function hashCode(str){
    let h = 0;
    for(let i=0;i<str.length;i++){
      h = ((h<<5)-h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }
  function stableRand01(seed){
    // simple LCG
    let x = (seed % 2147483647);
    x = (x * 48271) % 2147483647;
    return x / 2147483647;
  }



  // ===== Helpers =====
  const pad = (n)=> String(n).padStart(2,"0");

  // ✅ LOCAL ISO date (YYYY-MM-DD) — no UTC shift
  const isoLocal = (d) => {
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    return `${y}-${m}-${day}`;
  };

  // ✅ create a local date at "day precision" (stable across DST)
  const addDaysLocal = (base, add) =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + add);

  // Create local-ish ISO datetime string
  // NOTE: "YYYY-MM-DDTHH:mm:00" is parsed as local time in most engines.
  const toLocalIso = (dateISO, hhmm) => `${dateISO}T${hhmm}:00`;

  function randInt(a,b){ return Math.floor(a + Math.random()*(b-a+1)); }
  function uniqSorted(arr){ return Array.from(new Set(arr)).sort(); }

  // Expand date->["11:00"] into ISO datetime list
  function expandAvailabilityToIso(avByDate){
    const out = [];
    const dates = Object.keys(avByDate||{}).sort();
    for(const d of dates){
      const times = (avByDate[d]||[]).slice().sort();
      for(const t of times){
        out.push(toLocalIso(d,t));
      }
    }
    out.sort((a,b)=> new Date(a) - new Date(b));
    return out;
  }

  // Build per-service ISO slots (same schedule for each service of that listing)
  function buildAvailabilityByService(listing){
    const byService = {};
    const serviceIds = (listing.services||[]).map(s=>s.serviceId);
    const baseIsoSlots = expandAvailabilityToIso(listing.availability || {});
    for(const sid of serviceIds){
      byService[sid] = baseIsoSlots.slice();
    }
    return byService;
  }

  // ===== LISTINGS =====
  window.LISTINGS = [
    {
      id:"romanukova-nails",
      name:"Romanukova Nail Studio",
      brand:"Romanukova",
      city:"Montréal",
      address:"4810 Rue Jean-Talon O #221, Montreal, QC H4P 2N5",
      lat:45.5027, lng:-73.6601,
      partner:true, recommended:true,
      verified:true, sterile:true,
      phone:"+1 (438) 000-0000",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1519415510236-718bdfcd89c8?auto=format&fit=crop&w=1400&q=80",
        "https://images.unsplash.com/photo-1522338140262-f46f5913618a?auto=format&fit=crop&w=1400&q=80"
      ],
      services:[
        { serviceId:"manicure", from:30, to:55, durationMin:60 },
        { serviceId:"pedicure", from:45, to:75, durationMin:75 },
        { serviceId:"brows", from:25, to:45, durationMin:45 },
      ],
      availability:{} // date -> ["HH:MM"]
    },

    {
      id:"iryna-stovban-home",
      name:"Iryna Stovban · Home master",
      brand:"Iryna Stovban",
      city:"Montréal",
      address:"6740 Bd Décarie, Montréal, QC H3X 0A7, Canada",
      lat:45.4929, lng:-73.6545,
      partner:false, recommended:true,
      verified:true, sterile:true,
      phone:"+1 (438) 233-3457",
      instagram:"https://share.google/eQ0wgWkzDtTdM8v4Y0",
      images:[
        "https://images.unsplash.com/photo-1604654894610-df63bc536371?auto=format&fit=crop&w=1400&q=80",
        "https://images.unsplash.com/photo-1556228724-4b3c5c0ea90c?auto=format&fit=crop&w=1400&q=80"
      ],
      bio_ua:
`Привіт 🌸
Я початківець у сфері манікюру та зараз активно набираю моделей для відпрацювання навичок.

Працюю акуратно, уважно до деталей, з дотриманням гігієни та стерильності інструментів.
Для мене важлива якість роботи та комфорт клієнта 🤍

💅 Що пропоную:
• класичний / комбінований манікюр
• покриття гель-лаком
• акуратна форма та чиста кутикула

💰 Оплата — тільки за матеріали`,
      services:[
        { serviceId:"manicure", from:20, to:25, durationMin:60 },
      ],
      availability:{} // date -> ["HH:MM"]
    },

    {
      id:"maison-atelier",
      name:"Maison Atelier",
      brand:"Maison Atelier",
      city:"Montréal",
      address:"Rue Saint-Denis, Montréal, QC",
      lat:45.5212, lng:-73.5717,
      partner:true, recommended:true,
      verified:true, sterile:true,
      phone:"+1 (514) 000-0000",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1526045478516-99145907023c?auto=format&fit=crop&w=1400&q=80"
      ],
      services:[
        { serviceId:"womens_haircut", from:70, to:120, durationMin:75 },
        { serviceId:"brows", from:35, to:60, durationMin:45 },
      ],
      availability:{}
    },

    {
      id:"golden-hour-brows",
      name:"Golden Hour Brows",
      brand:"Golden Hour",
      city:"Montréal",
      address:"Avenue Laurier O, Montréal, QC",
      lat:45.5127, lng:-73.5967,
      partner:false, recommended:true,
      verified:true, sterile:true,
      phone:"+1 (514) 000-0000",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1400&q=80"
      ],
      services:[
        { serviceId:"brows", from:30, to:55, durationMin:45 },
        { serviceId:"manicure", from:35, to:60, durationMin:60 },
      ],
      availability:{}
    },

    {
      id:"atelier-nail-bar",
      name:"Atelier Nail Bar",
      brand:"Atelier",
      city:"Montréal",
      address:"Boulevard Saint-Laurent, Montréal, QC",
      lat:45.5171, lng:-73.5796,
      partner:false, recommended:false,
      verified:true, sterile:true,
      phone:"+1 (514) 000-0000",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=1400&q=80"
      ],
      services:[
        { serviceId:"manicure", from:35, to:65, durationMin:60 },
        { serviceId:"pedicure", from:50, to:85, durationMin:75 },
      ],
      availability:{}
    },

    {
      id:"gentlemen-atelier",
      name:"Gentlemen Atelier",
      brand:"Gentlemen Atelier",
      city:"Montréal",
      address:"Rue Sherbrooke O, Montréal, QC",
      lat:45.5009, lng:-73.5744,
      partner:true, recommended:true,
      verified:true, sterile:true,
      phone:"+1 (514) 000-0000",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1521498542256-5aeb47ba2d16?auto=format&fit=crop&w=1400&q=80"
      ],
      services:[
        { serviceId:"mens_haircut", from:40, to:70, durationMin:45 },
        { serviceId:"brows", from:25, to:45, durationMin:35 },
      ],
      availability:{}
    },

    {
      id:"rose-quartz-studio",
      name:"Rose Quartz Studio",
      brand:"Rose Quartz",
      city:"Montréal",
      address:"Rue Wellington, Montréal, QC",
      lat:45.4814, lng:-73.5673,
      partner:false, recommended:false,
      verified:true, sterile:false,
      phone:"+1 (514) 000-0000",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1400&q=80"
      ],
      services:[
        { serviceId:"womens_haircut", from:60, to:105, durationMin:70 },
        { serviceId:"manicure", from:35, to:60, durationMin:60 },
      ],
      availability:{}
    },

    {
      id:"violet-room",
      name:"The Violet Room",
      brand:"Violet Room",
      city:"Montréal",
      address:"Rue Peel, Montréal, QC",
      lat:45.4984, lng:-73.5749,
      partner:false, recommended:true,
      verified:true, sterile:true,
      phone:"+1 (514) 000-0000",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1527799820374-dcf8a3ff9c40?auto=format&fit=crop&w=1400&q=80"
      ],
      services:[
        { serviceId:"pedicure", from:55, to:95, durationMin:80 },
        { serviceId:"brows", from:35, to:60, durationMin:45 },
      ],
      availability:{}
    }
  ];

  // Attach demo rating + weekly bookings (stable) if not provided
  for(const l of (window.LISTINGS||[])){
    const seed = hashCode(l.id || l.name || "listing");
    if(l.rating==null){
      // 4.3 - 5.0
      l.rating = 4.3 + stableRand01(seed)*0.7;
    }
    if(l.reviewsCount==null){
      l.reviewsCount = 20 + Math.floor(stableRand01(seed+7)*380);
    }
    if(l._weeklyBookings==null){
      // 30 - 260
      l._weeklyBookings = 30 + Math.floor(stableRand01(seed+19)*230);
    }
  }



  // ===== LIVE Availability generator (TEST MODE: always has slots for demo) =====
  (function generateLiveAvailability(){
    const base = new Date();
    const days = 45; // більше днів для демо

    for(const l of (window.LISTINGS||[])){
      l.availability = {}; // ✅ перегенеровуємо завжди, щоб демо було стабільне

      for(let i=0;i<days;i++){
        const d = addDaysLocal(base, i);
        const key = isoLocal(d);

        // ✅ Гарантовано 3–7 слотів щодня (партнери трішки більше)
        const min = l.partner ? 4 : 3;
        const max = l.partner ? 8 : 7;

        let times = [];
        const target = randInt(min, max);
        for(let k=0;k<target;k++){
          const h = randInt(10, 20);
          const m = [0,10,20,30,40,50][randInt(0,5)];
          times.push(`${pad(h)}:${pad(m)}`);
        }
        times = uniqSorted(times);

        // ✅ Якщо today і після фільтра 0 — додаємо найближчі 2 години вручну
        const now = new Date();
        if (isoLocal(now) === key){
          const cur = now.getHours()*60 + now.getMinutes();
          times = times.filter(t=>{
            const hh = parseInt(t.slice(0,2),10);
            const mm = parseInt(t.slice(3),10);
            return (hh*60 + mm) > (cur + 20);
          });

          if(!times.length){
            const hh1 = Math.min(20, now.getHours() + 1);
            const hh2 = Math.min(20, now.getHours() + 2);
            times = uniqSorted([`${pad(hh1)}:00`, `${pad(hh2)}:30`]);
          }
        }

        l.availability[key] = times;
      }

      // For profile calendar (service-filtered)
      l.availabilityByService = buildAvailabilityByService(l);
      l.slots = expandAvailabilityToIso(l.availability);
    }
  })();

  // ===== UTIL =====
  function haversineKm(a,b){
    if(!a||!b) return null;
    const R=6371;
    const toRad=(x)=>x*Math.PI/180;
    const dLat=toRad(b.lat-a.lat);
    const dLng=toRad(b.lng-a.lng);
    const s1=Math.sin(dLat/2)**2;
    const s2=Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
    const c=2*Math.atan2(Math.sqrt(s1+s2),Math.sqrt(1-(s1+s2)));
    return R*c;
  }

  function listingService(listing, serviceId){
    return (listing.services||[]).find(s=>s.serviceId===serviceId) || null;
  }

  function minPriceFor(listing, serviceId){
    if(serviceId){
      const s=listingService(listing, serviceId);
      return s? s.from : null;
    }
    let m=null;
    for(const s of (listing.services||[])){
      if(m==null || s.from<m) m=s.from;
    }
    return m;
  }

  // old-style: looks at listing.availability (date -> times)
  function nextAvailable(listing, serviceId){
    const av = listing.availability || {};
    const dates = Object.keys(av).sort();
    for(const d of dates){
      const times = (av[d]||[]).slice().sort();
      if(!times.length) continue;
      const time = times[0];
      const price = minPriceFor(listing, serviceId);
      return { dateISO:d, time, fromPrice: price };
    }
    return null;
  }

  function isTodaySlot(slot){
    if(!slot) return false;
    const t = isoLocal(new Date());
    return slot.dateISO === t;
  }

  function smartScore(listing, userLoc, serviceId){
    let score = 0;

    if(serviceId && !listingService(listing, serviceId)) score += 50;
    if(listing.partner) score -= 6;
    if(listing.verified) score -= 3;
    if(listing.sterile) score -= 2;

    const slot = nextAvailable(listing, serviceId);
    if(!slot) score += 80;
    else{
      if(isTodaySlot(slot)) score -= 8;
      const hh = parseInt(slot.time.split(":")[0]||"12",10);
      score += Math.max(0, (hh-10))*0.15;
    }

    const p = minPriceFor(listing, serviceId);
    if(p != null) score += (p/25);

    if(userLoc && listing.lat && listing.lng){
      const km = haversineKm(userLoc, {lat:listing.lat,lng:listing.lng});
      if(km!=null) score += km*0.6;
    }

    if(listing.recommended) score -= 4;
    return score;
  }

  function smartRecommend(list, userLoc, serviceId){
    const out = (list||[]).slice().sort((a,b)=> smartScore(a,userLoc,serviceId) - smartScore(b,userLoc,serviceId));
    out.forEach((l,i)=>{
      l._rank = i+1;
      l._score = smartScore(l,userLoc,serviceId);
      l.recommended = !!l.recommended || i<6;
    });
    return out;
  }

  function computeWhy(listing, userLoc, serviceId){
    const parts = [];
    const slot = nextAvailable(listing, serviceId);
    if(slot){
      parts.push(isTodaySlot(slot) ? "Available today" : "Next soon");
    } else {
      parts.push("Limited availability");
    }

    if(listing.partner) parts.push("Partner priority");
    if(listing.sterile) parts.push("Sterile");

    const p = minPriceFor(listing, serviceId);
    if(p!=null){
      if(p<=30) parts.push("Best value");
      else if(p<=45) parts.push("Great value");
      else parts.push("Premium");
    }

    if(userLoc && listing.lat && listing.lng){
      const km = haversineKm(userLoc,{lat:listing.lat,lng:listing.lng});
      if(km!=null){
        if(km<2.0) parts.push("Very close");
        else if(km<5.0) parts.push("Close");
      }
    }
    return parts.slice(0,3).join(" · ");
  }

  // ---- AI parser (STRICT BY SERVICE) ----
  function parseConcierge(text){
    const t = (text||"").toLowerCase();
    let serviceId = null;

    const hasMen = /(чолов(іча|іч|і|ік)|men)/i.test(t);
    const hasWomen = /(жін(оча|іча|к|ка)|women|female)/i.test(t);
    if(hasMen) serviceId = "mens_haircut";
    else if(hasWomen) serviceId = "womens_haircut";
    else{
      const rules = [
        { id:"brows", re: /(бров|brow)/i },
        { id:"manicure", re: /(манік|manic)/i },
        { id:"pedicure", re: /(педик|pedic)/i },
        { id:"mens_haircut", re: /(men('|s)?\s*hair|mens?\s*hair)/i },
        { id:"womens_haircut", re: /(women('|s)?\s*hair|female\s*hair)/i },
        { id:"womens_haircut", re: /(стрижк|haircut|hair\s*cut)/i },
      ];
      for(const r of rules){
        if(r.re.test(t)){ serviceId = r.id; break; }
      }
    }

    let maxPrice = null;
    const m = t.match(/(?:\$|\bдо\b|\bunder\b|\bmax\b)?\s*([0-9]{2,3})\s*\$?/i);
    if(m) maxPrice = parseInt(m[1],10);

    let afterHour = null;
    const mh = t.match(/(?:after|після)\s*([0-9]{1,2})/i);
    if(mh) afterHour = parseInt(mh[1],10);

    return { serviceId, maxPrice, afterHour };
  }

  function conciergeSuggest(listings, userLoc, text){
    const q = parseConcierge(text);
    let pool = (listings||[]).slice();

    if(q.serviceId){
      pool = pool.filter(l=> !!listingService(l,q.serviceId));
    }

    if(q.maxPrice != null){
      pool = pool.filter(l=>{
        const p = minPriceFor(l, q.serviceId);
        return p!=null ? p <= q.maxPrice : true;
      });
    }

    if(q.afterHour != null){
      pool = pool.filter(l=>{
        const slot = nextAvailable(l, q.serviceId);
        if(!slot) return false;
        const hh = parseInt(slot.time.split(":")[0]||"0",10);
        return hh >= q.afterHour;
      });
    }

    const ranked = smartRecommend(pool, userLoc, q.serviceId);
    return {
      query:q,
      picks: ranked.slice(0,3).map(l=>({
        id:l.id,
        why: computeWhy(l,userLoc,q.serviceId),
        serviceId: q.serviceId || (l.services?.[0]?.serviceId || null)
      }))
    };
  }

  window.bb = window.bb || {};
  window.bb.util = {
    isoLocal,
    haversineKm,
    listingService,
    minPriceFor,
    nextAvailable,
    isTodaySlot,
    smartRecommend,
    computeWhy,
    conciergeSuggest
  };
})();
