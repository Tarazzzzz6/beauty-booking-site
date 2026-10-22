/* Beauty Booking — data.js (global, LIVE + backward compatible) */
(function(){
  // ===== Worker endpoint (fallback used by profile booking) =====
  window.WORKER_URL = window.WORKER_URL || "https://snowy-shadow-0b58.irafarm2000.workers.dev";

  // ---- SERVICES ----
  window.SERVICES = [
    { id:"manicure", ua:"Манікюр", en:"Manicure", ru:"Маникюр", icon:"💅" },
    { id:"pedicure", ua:"Педикюр", en:"Pedicure", ru:"Педикюр", icon:"🦶" },
    { id:"brows", ua:"Брови", en:"Brows", ru:"Брови", icon:"✨" },
    { id:"lashes", ua:"Вії", en:"Lashes", ru:"Ресницы", icon:"👁️" },
    { id:"mens_haircut", ua:"Стрижка чоловіча", en:"Men's haircut", ru:"Стрижка мужская", icon:"✂️" },
    { id:"womens_haircut", ua:"Стрижка жіноча", en:"Women's haircut", ru:"Стрижка женская", icon:"💇‍♀️" },
    { id:"coloring", ua:"Фарбування", en:"Hair coloring", ru:"Окрашивание", icon:"🎨" },
    { id:"barber", ua:"Барбер", en:"Barber", ru:"Барбер", icon:"💈" },
    { id:"makeup", ua:"Макіяж", en:"Makeup", ru:"Макияж", icon:"💄" },
    { id:"massage", ua:"Масаж", en:"Massage", ru:"Массаж", icon:"💆‍♀️" },
    { id:"cosmetology", ua:"Косметолог", en:"Cosmetology", ru:"Косметолог", icon:"🌿" },
    { id:"depilation", ua:"Депіляція", en:"Depilation", ru:"Депиляция", icon:"🕯️" },
  ];

  // ===== Helpers =====
  const DAY = 86400000;
  const pad = (n)=> String(n).padStart(2,"0");
  const isoDate = (d)=> d.toISOString().slice(0,10);

  // Create local-ish ISO datetime string with offset, without heavy libs
  // NOTE: Browser Date will parse "YYYY-MM-DDTHH:mm:00" as local time in most engines.
  const toLocalIso = (dateISO, hhmm) => `${dateISO}T${hhmm}:00`;

  function randInt(a,b){ return Math.floor(a + Math.random()*(b-a+1)); }
  function chance(p){ return Math.random() < p; }
  function uniqSorted(arr){ return Array.from(new Set(arr)).sort(); }

  function makeTimesForDay(){
    // premium vibe: 2–6 slots/day, between 10:00–20:00
    const count = randInt(2,6);
    const out = [];
    for(let i=0;i<count;i++){
      const h = randInt(10,20);
      const m = [0,10,20,30,40,50][randInt(0,5)];
      out.push(`${pad(h)}:${pad(m)}`);
    }
    return uniqSorted(out);
  }

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
    // Sort by datetime
    out.sort((a,b)=> new Date(a) - new Date(b));
    return out;
  }

  // Build per-service ISO slots (same schedule for each service of that listing; clean & fast)
  function buildAvailabilityByService(listing){
    const byService = {};
    const serviceIds = (listing.services||[]).map(s=>s.serviceId);
    const baseIsoSlots = expandAvailabilityToIso(listing.availability || {});
    for(const sid of serviceIds){
      byService[sid] = baseIsoSlots.slice();
    }
    return byService;
  }

  // ===== LISTINGS (your originals, minimal changes) =====
  window.LISTINGS = [
    {
      id:"romanukova-nails",
      rating:4.9, reviews:214,
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
      rating:5.0, reviews:37,
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
        "https://images.unsplash.com/photo-1519415510236-718bdfcd89c8?auto=format&fit=crop&w=1400&q=80"
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
      rating:4.8, reviews:168,
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
      rating:4.9, reviews:122,
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
      rating:4.7, reviews:98,
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
      rating:4.8, reviews:186,
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
        "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1400&q=80"
      ],
      services:[
        { serviceId:"mens_haircut", from:40, to:70, durationMin:45 },
        { serviceId:"brows", from:25, to:45, durationMin:35 },
      ],
      availability:{}
    },

    {
      id:"rose-quartz-studio",
      rating:4.6, reviews:74,
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
      rating:4.7, reviews:89,
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
        "https://images.unsplash.com/photo-1519415943484-9fa1873496d4?auto=format&fit=crop&w=1400&q=80"
      ],
      services:[
        { serviceId:"pedicure", from:55, to:95, durationMin:80 },
        { serviceId:"brows", from:35, to:60, durationMin:45 },
      ],
      availability:{}
    },
    {
      id:"kalyna-beauty",
      rating:4.9, reviews:167,
      name:"Kalyna Beauty Studio · UA",
      brand:"Kalyna",
      city:"Montréal",
      address:"5425 Rue Saint-Hubert, Montréal, QC H2T 2X6",
      lat:45.5320, lng:-73.6025,
      partner:true, recommended:true,
      verified:true, sterile:true,
      phone:"+1 (514) 000-1001",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1522337660859-02fbefca4702?auto=format&fit=crop&w=1400&q=80",
        "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=1400&q=80"
      ],
      bio_ua:"Українська студія краси в Роземонті 💛💙 Вії, брови, макіяж і манікюр. Говоримо українською, російською, англійською і французькою.",
      services:[
        { serviceId:"lashes", from:60, to:120, durationMin:120 },
        { serviceId:"brows", from:30, to:55, durationMin:45 },
        { serviceId:"makeup", from:65, to:130, durationMin:60 },
        { serviceId:"manicure", from:40, to:70, durationMin:60 }
      ],
      availability:{}
    },
    {
      id:"mira-beauty-lab",
      rating:4.8, reviews:203,
      name:"Mira Beauty Lab · RU",
      brand:"Mira",
      city:"Montréal",
      address:"6789 Chemin de la Côte-des-Neiges, Montréal, QC H3S 2B2",
      lat:45.4920, lng:-73.6280,
      partner:false, recommended:true,
      verified:true, sterile:true,
      phone:"+1 (514) 000-1002",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=1400&q=80",
        "https://images.unsplash.com/photo-1519415943484-9fa1873496d4?auto=format&fit=crop&w=1400&q=80"
      ],
      bio_ua:"Косметологія, масаж і депіляція. Русскоязычный персонал, стерильно, запис онлайн.",
      services:[
        { serviceId:"cosmetology", from:70, to:160, durationMin:60 },
        { serviceId:"massage", from:60, to:120, durationMin:60 },
        { serviceId:"depilation", from:20, to:80, durationMin:35 },
        { serviceId:"brows", from:30, to:50, durationMin:40 }
      ],
      availability:{}
    },
    {
      id:"kozak-barbershop",
      rating:4.9, reviews:311,
      name:"Kozak Barbershop · UA",
      brand:"Kozak",
      city:"Montréal",
      address:"1215 Boulevard Saint-Laurent, Montréal, QC H2X 2S6",
      lat:45.5105, lng:-73.5622,
      partner:true, recommended:true,
      verified:true, sterile:true,
      phone:"+1 (514) 000-1003",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1400&q=80",
        "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1400&q=80"
      ],
      bio_ua:"Український барбершоп на Плато. Фейди, бороди, класика. Перша стрижка новим клієнтам — мінус 10%.",
      services:[
        { serviceId:"barber", from:35, to:65, durationMin:50 },
        { serviceId:"mens_haircut", from:30, to:55, durationMin:45 }
      ],
      availability:{}
    },
    {
      id:"atelier-color-lab",
      rating:4.8, reviews:142,
      name:"Atelier Color Lab · Westmount",
      brand:"Color Lab",
      city:"Montréal",
      address:"4845 Rue Sherbrooke O, Westmount, QC H3Y 1V5",
      lat:45.4868, lng:-73.6012,
      partner:false, recommended:true,
      verified:true, sterile:false,
      phone:"+1 (514) 000-1004",
      instagram:"https://instagram.com/",
      images:[
        "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1400&q=80",
        "https://images.unsplash.com/photo-1526045478516-99145907023c?auto=format&fit=crop&w=1400&q=80"
      ],
      bio_ua:"Premium hair color studio in Westmount. Balayage, airtouch, blond experts. EN/FR.",
      services:[
        { serviceId:"coloring", from:120, to:320, durationMin:150 },
        { serviceId:"womens_haircut", from:75, to:130, durationMin:75 },
        { serviceId:"makeup", from:70, to:140, durationMin:60 }
      ],
      availability:{}
    }
  ];

  // ===== SCHEDULE-BASED Availability (30 days) =====
  // Графік салону: робочі години за днями тижня (0 = неділя). Салон керує графіком
  // у кабінеті та через Telegram-бота командами /close та /open (див. worker.js v2).
  // Слоти стабільні між візитами (детермінований генератор за id салону + датою):
  // частина слотів "зайнята" — як у реальному розкладі.
  function seededRand(seedStr){
    let h = 2166136261;
    for(let i=0;i<seedStr.length;i++){ h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function(){
      h += 0x6D2B79F5;
      let x = h;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  const DEFAULT_WEEK = { 0:[11,18], 1:[10,20], 2:[10,20], 3:[10,20], 4:[10,20], 5:[10,20], 6:[10,19] };
  const WEEK_OVERRIDES = {
    "kozak-barbershop": { 1:null },                 // понеділок — вихідний
    "kalyna-beauty": { 0:null },                     // неділя — вихідний
    "iryna-stovban-home": { 1:null, 3:null, 0:null } // домашній майстер: вт/чт/сб/нд
  };

  (function generateLiveAvailability(){
    const base = new Date();
    const days = 30;

    for(const l of (window.LISTINGS||[])){
      if (l.telegramChatId === undefined) l.telegramChatId = "";
      const week = Object.assign({}, DEFAULT_WEEK, WEEK_OVERRIDES[l.id] || {}, l.schedule || {});
      l.schedule = week;
      l.availability = {};

      for(let i=0;i<days;i++){
        const d = new Date(base.getTime() + i*DAY);
        const key = isoDate(d);
        if (Array.isArray(l.closedDates) && l.closedDates.includes(key)) continue;
        const hours = week[new Date(key + "T12:00:00Z").getUTCDay()]; // weekday за ISO-датою (без зсуву часових поясів)
        if (!hours) continue;

        // слоти кожні 30 хв у робочі години (останній прийом за годину до закриття)
        const all = [];
        for(let mins = hours[0]*60; mins <= hours[1]*60 - 60; mins += 30){
          all.push(pad(Math.floor(mins/60)) + ":" + pad(mins % 60));
        }
        // детерміновано прибираємо "зайняті" слоти
        const rnd = seededRand(l.id + "|" + key);
        const keepP = l.partner ? 0.55 : 0.45;
        let times = all.filter(()=> rnd() < keepP + 0.25);
        if (times.length < 2) times = all.filter((_,idx)=> idx % 3 === 0).slice(0,3);

        // сьогодні: прибираємо минулий час (+20 хв буфер)
        if (isoDate(new Date()) === key){
          const now = new Date();
          const cur = now.getHours()*60 + now.getMinutes();
          times = times.filter(tt=>{
            const hh = parseInt(tt.slice(0,2),10), mm = parseInt(tt.slice(3,5),10);
            return (hh*60 + mm) > (cur + 20);
          });
        }
        if (times.length) l.availability[key] = times;
      }

      l.availabilityByService = buildAvailabilityByService(l);
      l.slots = expandAvailabilityToIso(l.availability);
    }
  })();

  // ===== UTIL (keeps your old behavior using date->times) =====
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
    const t = new Date().toISOString().slice(0,10);
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
    if(listing.rating) parts.push(`★ ${listing.rating} (${listing.reviews||0})`);

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
    const rules = [
      { id:"lashes", re: /(ві[їй]|ресниц|нарощ|наращив|ламінуван|lash)/i },
      { id:"coloring", re: /(фарбув|окраш|колор|балаяж|а[їи]ртач|color)/i },
      { id:"barber", re: /(барбер|бород|barber|beard)/i },
      { id:"brows", re: /(бров|brow)/i },
      { id:"manicure", re: /(манік|маник|нігт|ногт|manic)/i },
      { id:"pedicure", re: /(педик|pedic)/i },
      { id:"makeup", re: /(макіяж|макияж|мейк|makeup)/i },
      { id:"massage", re: /(масаж|массаж|massage)/i },
      { id:"cosmetology", re: /(космет|чистк|п[іи]л[іи]нг|обличч|лица)/i },
      { id:"depilation", re: /(депіляц|депиляц|шугаринг|шугар|епіляц|эпиляц)/i },
    ];
    for(const r of rules){ if(r.re.test(t)){ serviceId = r.id; break; } }
    if(!serviceId){
      if(/(чолов|муж|men)/i.test(t)) serviceId = "mens_haircut";
      else if(/(жін|женщ|женск|women|female)/i.test(t)) serviceId = "womens_haircut";
      else if(/(стрижк|haircut)/i.test(t)) serviceId = "womens_haircut";
    }
    let maxPrice = null;
    const mp = t.match(/(?:^|\s)(?:до|under|max)\s*\$?\s*([0-9]{2,3})/i) || t.match(/\$\s*([0-9]{2,3})/i) || t.match(/([0-9]{2,3})\s*\$/i);
    if(mp) maxPrice = parseInt(mp[1]||mp[2],10);
    let afterHour = null;
    const mh = t.match(/(?:after|після|после)\s*([0-9]{1,2})/i);
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
        const slots = (l.availabilityByService && q.serviceId && l.availabilityByService[q.serviceId]) || l.slots || [];
        return slots.some(iso=> parseInt(String(iso).slice(11,13)||"0",10) >= q.afterHour);
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


  // ===== REVIEWS (демо-відгуки; нові збираються автоматично після візитів) =====
  window.REVIEWS = {
    "romanukova-nails": [
      { name:"Олена", stars:5, text:"Найкращий манікюр у Монреалі, тримається 4 тижні без сколів!" },
      { name:"Marie", stars:5, text:"Super clean and very professional. My go-to nail studio." }
    ],
    "iryna-stovban-home": [
      { name:"Катя", stars:5, text:"Дуже делікатно і стерильно. Рекомендую!" }
    ],
    "maison-atelier": [
      { name:"Sophie", stars:5, text:"Best haircut in Montreal, period." }
    ],
    "kalyna-beauty": [
      { name:"Ірина", stars:5, text:"Вії — просто вау, саме як я хотіла 💛" },
      { name:"Anna", stars:5, text:"Делала брови — очень аккуратно и совсем не больно." }
    ],
    "mira-beauty-lab": [
      { name:"Ольга", stars:5, text:"Косметолог супер, кожа после чистки сияет." }
    ],
    "kozak-barbershop": [
      { name:"Дмитро", stars:5, text:"Фейд ідеальний. Тепер тільки сюди." },
      { name:"Alex", stars:4, text:"Great barbers. Book ahead — busy on weekends." }
    ],
    "atelier-color-lab": [
      { name:"Emma", stars:5, text:"Balayage came out exactly like my reference photo." }
    ],
    "gentlemen-atelier": [
      { name:"Максим", stars:5, text:"Лучший барбер в центре, запись за день." }
    ]
  };

  window.bb = window.bb || {};
  window.bb.util = {
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
