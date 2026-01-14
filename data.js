window.WORKER_URL = "https://snowy-shadow-0b58.irafarm2000.workers.dev/book";
/* data.js — Beauty Booking (FINAL STABLE)
   Provides: window.SERVICES, window.LISTINGS, window.bb.util
*/
(function () {
  "use strict";

  /* ================= SERVICES ================= */
  const SERVICES = [
    { id: "manicure",   ua: "Манікюр",            en: "Manicure",        icon:"💅" },
    { id: "pedicure",   ua: "Педикюр",            en: "Pedicure",        icon:"🦶" },
    { id: "brows",      ua: "Брови",              en: "Brows",           icon:"✨" },
    { id: "haircut_m",  ua: "Чоловіча стрижка",   en: "Men's haircut",   icon:"✂️" },
    { id: "haircut_w",  ua: "Жіноча стрижка",     en: "Women's haircut", icon:"💇‍♀️" }
  ];

  /* ================= HELPERS ================= */
  const pad = (n) => String(n).padStart(2,"0");
  const isoLocal = (d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const daysFromToday = (n)=>{
    const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+n); return isoLocal(d);
  };
  const mkSlots=(d,t)=>t.map(x=>`${d} ${x}`);

  function buildAvailability(serviceIds, patterns){
    const out={};
    serviceIds.forEach(id=>out[id]=[]);
    for(let i=0;i<7;i++){
      const d=daysFromToday(i);
      serviceIds.forEach(id=>{
        (patterns[id]?.[i]||[]).forEach(t=>out[id].push(`${d} ${t}`));
      });
    }
    Object.values(out).forEach(a=>a.sort());
    return out;
  }

  function flatten(bySvc){
    const map={};
    Object.values(bySvc).flat().forEach(s=>{
      const d=s.slice(0,10), t=s.slice(11,16);
      (map[d]=map[d]||[]).push(t);
    });
    Object.keys(map).forEach(d=>map[d]=[...new Set(map[d])].sort());
    return map;
  }

  /* ================= LISTINGS ================= */
  const LISTINGS = [
    {
      id:"romanukova",
      name:"Romanukova Nail Studio",
      subtitle:"Premium nails • gel • clean shape",
      city:"Montréal",
      address:"4810 Rue Jean-Talon O #221, Montreal, QC H4P 2N5",
      lat:45.4997,lng:-73.6239,
      photo:"https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1400&q=80",
      partner:true,recommended:true,verified:true,sterile:true,rating:4.9,
      instagram:"https://instagram.com/",
      services:[
        {serviceId:"manicure",from:60,durMin:75},
        {serviceId:"pedicure",from:70,durMin:90}
      ]
    },
    {
      id:"irynastovban",
      name:"Iryna Stovban — Home Master",
      subtitle:"Models welcome • стерильно та акуратно",
      city:"Montréal",
      address:"6740 Bd Décarie, Montréal, QC H3X 0A7",
      lat:45.4949,lng:-73.6496,
      photo:"https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=1400&q=80",
      partner:false,recommended:true,verified:true,sterile:true,rating:4.6,
      instagram:"https://share.google/eQ0wgkzDtTdM8v4Y0",
      services:[
        {serviceId:"manicure",from:20,durMin:60}
      ]
    },
    {
      id:"browbar_mtl",
      name:"BrowBar Montréal",
      subtitle:"Lamination • tint • shaping",
      city:"Montréal",
      address:"Rue Saint-Denis, Montreal, QC",
      lat:45.5152,lng:-73.5659,
      photo:"https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1400&q=80",
      partner:true,recommended:false,verified:true,sterile:true,rating:4.8,
      instagram:"https://instagram.com/",
      services:[
        {serviceId:"brows",from:35,durMin:45}
      ]
    },
    {
      id:"barber_mtl",
      name:"Old-Money Barber",
      subtitle:"Fade • classic • beard tidy",
      city:"Montréal",
      address:"Boulevard Saint-Laurent, Montreal, QC",
      lat:45.5216,lng:-73.5865,
      photo:"https://images.unsplash.com/photo-1521497615361-1b1fd9f5b78b?auto=format&fit=crop&w=1400&q=80",
      partner:false,recommended:true,verified:true,sterile:true,rating:4.7,
      instagram:"https://instagram.com/",
      services:[
        {serviceId:"haircut_m",from:35,durMin:45}
      ]
    },
    {
      id:"velvet_hair",
      name:"Velvet Hair Studio",
      subtitle:"Women’s cut • blowout • care",
      city:"Montréal",
      address:"Rue Sherbrooke O, Montreal, QC",
      lat:45.499,lng:-73.5908,
      photo:"https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=1400&q=80",
      partner:false,recommended:false,verified:true,sterile:true,rating:4.5,
      instagram:"https://instagram.com/",
      services:[
        {serviceId:"haircut_w",from:55,durMin:60}
      ]
    },
    {
      id:"golden_spa",
      name:"Golden Aura Spa",
      subtitle:"Luxury manicure & pedicure",
      city:"Montréal",
      address:"Avenue du Parc, Montreal, QC",
      lat:45.5169,lng:-73.5791,
      photo:"https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1400&q=80",
      partner:true,recommended:true,verified:true,sterile:true,rating:4.8,
      instagram:"https://instagram.com/",
      services:[
        {serviceId:"manicure",from:55,durMin:60},
        {serviceId:"pedicure",from:65,durMin:75}
      ]
    }
  ];

  /* ================= AVAILABILITY ================= */
  function attachAvailability(l){
    const sids=l.services.map(s=>s.serviceId);
    const pat={}; sids.forEach(id=>pat[id]=Array(7).fill(0).map(()=>[]));

    sids.forEach(id=>{
      for(let i=0;i<7;i++){
        const base=["11:00","14:00","17:00"];
        if(Math.random()>.5) base.push("19:00");
        pat[id][i]=base.slice(0,2+Math.floor(Math.random()*2));
      }
    });

    l.availabilityByService=buildAvailability(sids,pat);
    l.availability=flatten(l.availabilityByService);
  }
  LISTINGS.forEach(attachAvailability);

  /* ================= UTIL ================= */
  const bb=window.bb=window.bb||{};
  bb.util={};

  bb.util.listingService=(l,id)=>l.services.find(s=>s.serviceId===id)||null;
  bb.util.minPriceFor=(l,id)=>{
    let m=null; l.services.forEach(s=>{
      if(id&&s.serviceId!==id)return;
      if(m==null||s.from<m)m=s.from;
    }); return m;
  };
  bb.util.nextAvailable=(l,id)=>{
    const by=l.availabilityByService||{};
    if(id&&by[id]?.length){
      const s=by[id][0]; return{dateISO:s.slice(0,10),time:s.slice(11,16)};
    }
    for(const d of Object.keys(l.availability||{}).sort()){
      const t=l.availability[d][0]; if(t)return{dateISO:d,time:t};
    }
    return null;
  };

  window.SERVICES=SERVICES;
  window.LISTINGS=LISTINGS;
})();
