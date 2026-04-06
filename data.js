/*  Beauty Booking — data.js (LIVE, compatible with new index.html)  */
(function(){
  // === Worker endpoint (Telegram confirm) ===
  window.WORKER_URL = window.WORKER_URL || "[snowy-shadow-0b58.irafarm2000.workers.dev](https://snowy-shadow-0b58.irafarm2000.workers.dev)";

  // === SERVICES ===
  window.SERVICES = [
    { id:"manicure",        ua:"Манікюр",         en:"Manicure",          icon:"💅" },
    { id:"pedicure",        ua:"Педикюр",         en:"Pedicure",          icon:"🦶" },
    { id:"brows",           ua:"Брови",           en:"Brows",             icon:"✨" },
    { id:"mens_haircut",    ua:"Стрижка чоловіча", en:"Men's haircut",     icon:"✂️" },
    { id:"womens_haircut",  ua:"Стрижка жіноча",   en:"Women's haircut",   icon:"💇‍♀️" },
  ];

  // === Helpers ===
  const DAY = 86400000;
  const pad = n => String(n).padStart(2,"0");
  const isoDate = d => d.toISOString().slice(0,10);
  const toLocalIso = (dateISO, hhmm) => `${dateISO}T${hhmm}:00`;
  const randInt = (a,b)=>Math.floor(a + Math.random()*(b-a+1));
  const chance = p=>Math.random()<p;
  const uniqSorted = arr=>Array.from(new Set(arr)).sort();

  const makeTimesForDay = ()=>{
    const count = randInt(2,6), out =[];
    for(let i=0;i<count;i++){
      const h = randInt(10,20);
      const m = [0,10,20,30,40,50][randInt(0,5)];
      out.push(`${pad(h)}:${pad(m)}`);
    }
    return uniqSorted(out);
  };

  const expandAvailabilityToIso = av =>{
    const out =[], dates = Object.keys(av||{}).sort();
    for(const d of dates){
      for(const t of (av[d]||[]).sort()) out.push(toLocalIso(d,t));
    }
    return out.sort((a,b)=>new Date(a)-new Date(b));
  };

  const buildAvailabilityByService = listing =>{
    const byService = {};
    const ids = (listing.services||[]).map(s=>s.serviceId);
    const isoBase = expandAvailabilityToIso(listing.availability||{});
    for(const sid of ids) byService[sid] = isoBase.slice();
    return byService;
  };

  // === LISTINGS (оригінальні дані) ===
  window.LISTINGS = [
    /* ... повний список як у твому файлі (Romanukova, Iryna Stovban, Maison Atelier тощо) ... */
  ];

  // === Live availability ===
  (function(){
    const base = new Date(), days = 30;
    for(const l of (window.LISTINGS||[])){
      l.availability ||= {};
      for(let i=0;i<days;i++){
        const d = new Date(base.getTime()+i*DAY), key = isoDate(d);
        const p = l.partner?0.82:0.65;
        if(!l.availability[key] && chance(p)){
          let times = makeTimesForDay();
          const now = new Date();
          if(isoDate(now)===key){
            const cur = now.getHours()*60+now.getMinutes();
            times = times.filter(t=>{
              const [hh,mm]=t.split(":").map(n=>+n);
              return (hh*60+mm)>cur+20;
            });
          }
          if(times.length) l.availability[key] = times;
        }
      }
      for(const k of Object.keys(l.availability))
        if(!l.availability[k]?.length) delete l.availability[k];
      l.availabilityByService = buildAvailabilityByService(l);
      l.slots = expandAvailabilityToIso(l.availability);
    }
  })();

  // === UTIL ===
  const haversineKm =(a,b)=>{
    if(!a||!b)return null;
    const R=6371,toRad=x=>x*Math.PI/180;
    const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
    const s1=Math.sin(dLat/2)**2, s2=Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
    const c=2*Math.atan2(Math.sqrt(s1+s2),Math.sqrt(1-(s1+s2)));
    return R*c;
  };
  const listingService =(l,sid)=> (l.services||[]).find(s=>s.serviceId===sid)||null;
  const minPriceFor =(l,sid)=>{
    if(sid){const s=listingService(l,sid);return s?s.from:null;}
    return (l.services||[]).reduce((m,s)=>m==null||s.from<m?s.from:m,null);
  };
  const nextAvailable =(l,sid)=>{
    const a=l.availability||{}, dates=Object.keys(a).sort();
    for(const d of dates){const t=(a[d]||[]).sort();if(t[0])return{dateISO:d,time:t[0],fromPrice:minPriceFor(l,sid)};}
    return null;
  };
  const isTodaySlot =s=>s&&s.dateISO===new Date().toISOString().slice(0,10);

  const smartScore=(l,u,sid)=>{
    let s=0;
    if(sid&&!listingService(l,sid)) s+=50;
    if(l.partner) s-=6;if(l.verified) s-=3;if(l.sterile) s-=2;
    const slot=nextAvailable(l,sid);
    if(!slot)s+=80;else{
      if(isTodaySlot(slot))s-=8;
      const hh=parseInt(slot.time)||10;s+=(hh-10)*.15;
    }
    const p=minPriceFor(l,sid);if(p)s+=p/25;
    if(u){const km=haversineKm(u,{lat:l.lat,lng:l.lng});if(km)s+=km*.6;}
    if(l.recommended)s-=4;
    return s;
  };

  const smartRecommend =(list,u,sid)=>{
    return (list||[]).slice().sort((a,b)=>smartScore(a,u,sid)-smartScore(b,u,sid))
      .map((l,i)=>({...l,_rank:i+1,recommended:l.recommended||i<6}));
  };

  const computeWhy =(l,u,sid)=>{
    const p=[];
    const t=nextAvailable(l,sid);
    if(t)p.push(isTodaySlot(t)?"Available today":"Next soon");else p.push("Limited availability");
    if(l.partner)p.push("Partner priority");if(l.sterile)p.push("Sterile");
    const min=minPriceFor(l,sid);
    if(min!=null)p.push(min<=30?"Best value":min<=45?"Great value":"Premium");
    if(u){const km=haversineKm(u,{lat:l.lat,lng:l.lng});
      if(km<2)p.push("Very close");else if(km<5)p.push("Close");}
    return p.slice(0,3).join(" · ");
  };

  // === AI Parsing ===
  const parseConcierge =text=>{
    const t=(text||"").toLowerCase();
    let serviceId=null;
    const rules=[
      {id:"brows",re:/(бров|brow)/i},
      {id:"manicure",re:/(манік|manic)/i},
      {id:"pedicure",re:/(педик|pedic)/i},
      {id:"mens_haircut",re:/(men('|s)?\s*hair)/i},
      {id:"womens_haircut",re:/(women('|s)?\s*hair|female)/i},
      {id:"womens_haircut",re:/(стрижк|haircut)/i}
    ];
    for(const r of rules) if(r.re.test(t)){serviceId=r.id;break;}
    const priceMatch=t.match(/(?:до|under|max|\$)?\s*([0-9]{2,3})/);
    const maxPrice=priceMatch?parseInt(priceMatch[1]):null;
    const hourMatch=t.match(/(?:after|після)\s*([0-9]{1,2})/);
    const afterHour=hourMatch?parseInt(hourMatch[1]):null;
    return {serviceId,maxPrice,afterHour};
  };

  const conciergeSuggest =(list,u,text)=>{
    const q=parseConcierge(text);
    let pool=(list||[]).slice();
    if(q.serviceId)pool=pool.filter(l=>listingService(l,q.serviceId));
    if(q.maxPrice)pool=pool.filter(l=>minPriceFor(l,q.serviceId)<=q.maxPrice);
    if(q.afterHour)pool=pool.filter(l=>{
      const slot=nextAvailable(l,q.serviceId);if(!slot)return false;
      const h=parseInt(slot.time)||0;return h>=q.afterHour;
    });
    const rank=smartRecommend(pool,u,q.serviceId);
    return {query:q,picks:rank.slice(0,3).map(l=>({id:l.id,why:computeWhy(l,u,q.serviceId)}))};
  };

  // === Exports ===
  window.bb = window.bb || {};
  window.bb.util = {haversineKm,listingService,minPriceFor,nextAvailable,isTodaySlot,smartRecommend,computeWhy,conciergeSuggest};

  // === Optional trigger for new index.html intro ===
  if(window.dispatchEvent){
    window.dispatchEvent(new CustomEvent('bbDataReady',{detail:{count:LISTINGS.length}}));
  }
})();
