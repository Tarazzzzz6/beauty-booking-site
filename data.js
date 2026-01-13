/* data.js — Beauty Booking (stable)
   Provides: window.SERVICES, window.LISTINGS, window.bb.util
*/
(function () {
  "use strict";

  // ===== Services (IDs must match everywhere) =====
  const SERVICES = [
    { id: "manicure",   ua: "Манікюр",            en: "Manicure",        icon:"💅" },
    { id: "pedicure",   ua: "Педикюр",            en: "Pedicure",        icon:"🦶" },
    { id: "brows",      ua: "Брови",              en: "Brows",           icon:"✨" },
    { id: "haircut_m",  ua: "Чоловіча стрижка",   en: "Men's haircut",   icon:"✂️" },
    { id: "haircut_w",  ua: "Жіноча стрижка",     en: "Women's haircut", icon:"💇‍♀️" }
  ];

  // ===== Helpers: deterministic demo availability =====
  const pad = (n) => String(n).padStart(2, "0");
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function daysFromToday(n) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + n);
    return isoLocal(d);
  }

  function mkSlots(dateISO, times) {
    return times.map((t) => `${dateISO} ${t}`);
  }

  function buildAvailabilityByService(serviceIds, patternTimesByService) {
    const bySvc = {};
    for (const sid of serviceIds) bySvc[sid] = [];

    for (let i = 0; i < 7; i++) {
      const d = daysFromToday(i);
      for (const sid of serviceIds) {
        const times = (patternTimesByService[sid] && patternTimesByService[sid][i]) || [];
        bySvc[sid].push(...mkSlots(d, times));
      }
    }
    for (const sid of Object.keys(bySvc)) bySvc[sid].sort();
    return bySvc;
  }

  function flattenAvailability(bySvc) {
    const map = {};
    for (const sid of Object.keys(bySvc)) {
      for (const slot of bySvc[sid]) {
        const dateISO = slot.slice(0, 10);
        const time = slot.slice(11, 16);
        if (!map[dateISO]) map[dateISO] = [];
        map[dateISO].push(time);
      }
    }
    for (const d of Object.keys(map)) map[d] = Array.from(new Set(map[d])).sort();
    return map;
  }

  // ===== Listings (Montréal demo curated) =====
  const LISTINGS = [
    {
      id: "romanukova",
      name: "Romanukova Nail Studio",
      subtitle: "Premium nails • Gel • Clean shape",
      city: "Montréal",
      address: "4810 Rue Jean-Talon O #221, Montreal, QC H4P 2N5",
      lat: 45.4997,
      lng: -73.6239,
      photo: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1400&q=80",
      tags: ["nails", "studio", "premium"],
      partner: true,
      recommended: true,
      verified: true,
      sterile: true,
      rating: 4.9,
      instagram: "https://instagram.com/",
      services: [
        { serviceId: "manicure", from: 60, durMin: 75 },
        { serviceId: "pedicure", from: 70, durMin: 90 }
      ]
    },
    {
      id: "irynastovban",
      name: "Iryna Stovban — Home Master",
      subtitle: "Models welcome • акуратно та стерильно",
      city: "Montréal",
      address: "6740 Bd Décarie, Montréal, QC H3X 0A7",
      lat: 45.4949,
      lng: -73.6496,
      photo: "https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=1400&q=80",
      tags: ["home", "nails", "budget"],
      partner: false,
      recommended: true,
      verified: true,
      sterile: true,
      rating: 4.6,
      instagram: "https://share.google/eQ0wgkzDtTdM8v4Y0",
      services: [
        { serviceId: "manicure", from: 20, durMin: 60 }
      ]
    },
    {
      id: "browbar_mtl",
      name: "BrowBar Montréal",
      subtitle: "Brow shaping • lamination • tint",
      city: "Montréal",
      address: "Rue Saint-Denis, Montreal, QC",
      lat: 45.5152,
      lng: -73.5659,
      photo: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1400&q=80",
      tags: ["brows", "lamination", "tint"],
      partner: true,
      recommended: false,
      verified: true,
      sterile: true,
      rating: 4.8,
      instagram: "https://instagram.com/",
      services: [
        { serviceId: "brows", from: 35, durMin: 45 }
      ]
    },
    {
      id: "barber_mtl",
      name: "Old-Money Barber",
      subtitle: "Fade • classic • beard tidy",
      city: "Montréal",
      address: "Boulevard Saint-Laurent, Montreal, QC",
      lat: 45.5216,
      lng: -73.5865,
      photo: "https://images.unsplash.com/photo-1521497615361-1b1fd9f5b78b?auto=format&fit=crop&w=1400&q=80",
      tags: ["barber", "mens", "classic"],
      partner: false,
      recommended: true,
      verified: true,
      sterile: true,
      rating: 4.7,
      instagram: "https://instagram.com/",
      services: [
        { serviceId: "haircut_m", from: 35, durMin: 45 }
      ]
    },
    {
      id: "hairstudio_mtl",
      name: "Velvet Hair Studio",
      subtitle: "Women’s cut • blowout • care",
      city: "Montréal",
      address: "Rue Sherbrooke O, Montreal, QC",
      lat: 45.4990,
      lng: -73.5908,
      photo: "https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=1400&q=80",
      tags: ["hair", "women", "studio"],
      partner: false,
      recommended: false,
      verified: true,
      sterile: true,
      rating: 4.5,
      instagram: "https://instagram.com/",
      services: [
        { serviceId: "haircut_w", from: 55, durMin: 60 }
      ]
    }
  ];

  function attachAvailability(listing) {
    const sids = (listing.services || []).map((s) => s.serviceId);
    const pat = {};
    for (const sid of sids) pat[sid] = new Array(7).fill(0).map(() => []);

    if (listing.id === "romanukova") {
      pat.manicure[0] = ["11:00", "14:30", "18:00"];
      pat.manicure[1] = ["10:30", "13:00", "17:30"];
      pat.manicure[2] = ["12:00", "16:00"];
      pat.manicure[3] = ["11:30", "15:00", "19:00"];
      pat.manicure[4] = ["10:00", "13:30", "18:30"];
      pat.manicure[5] = ["12:30", "16:30"];
      pat.manicure[6] = ["11:00", "14:00"];

      pat.pedicure[0] = ["12:00", "16:00"];
      pat.pedicure[1] = ["11:00", "15:30"];
      pat.pedicure[2] = ["13:30"];
      pat.pedicure[3] = ["12:30", "17:00"];
      pat.pedicure[4] = ["11:30", "16:30"];
      pat.pedicure[5] = ["13:00"];
      pat.pedicure[6] = ["12:00"];
    }

    if (listing.id === "irynastovban") {
      pat.manicure[0] = ["15:00", "18:00"];
      pat.manicure[1] = ["12:00", "16:00", "19:00"];
      pat.manicure[2] = ["11:00", "14:00"];
      pat.manicure[3] = ["13:00", "17:00"];
      pat.manicure[4] = ["12:30", "18:30"];
      pat.manicure[5] = ["11:30", "15:30"];
      pat.manicure[6] = ["12:00", "16:30"];
    }

    if (listing.id === "browbar_mtl") {
      pat.brows[0] = ["10:30", "12:30", "15:00", "17:30"];
      pat.brows[1] = ["11:00", "13:30", "16:00", "18:00"];
      pat.brows[2] = ["10:00", "12:00", "14:30"];
      pat.brows[3] = ["11:30", "13:00", "17:00"];
      pat.brows[4] = ["10:30", "12:30", "15:30"];
      pat.brows[5] = ["11:00", "14:00"];
      pat.brows[6] = ["12:00", "16:00"];
    }

    if (listing.id === "barber_mtl") {
      pat.haircut_m[0] = ["11:00", "13:00", "16:00", "18:00"];
      pat.haircut_m[1] = ["10:30", "12:30", "15:30", "17:30"];
      pat.haircut_m[2] = ["11:30", "14:30", "19:00"];
      pat.haircut_m[3] = ["12:00", "16:30"];
      pat.haircut_m[4] = ["10:00", "13:30", "18:30"];
      pat.haircut_m[5] = ["12:30", "15:00"];
      pat.haircut_m[6] = ["11:00", "14:00", "17:00"];
    }

    if (listing.id === "hairstudio_mtl") {
      pat.haircut_w[0] = ["12:00", "15:00", "18:00"];
      pat.haircut_w[1] = ["11:00", "14:00", "17:00"];
      pat.haircut_w[2] = ["12:30", "16:30"];
      pat.haircut_w[3] = ["10:30", "13:30", "19:00"];
      pat.haircut_w[4] = ["11:30", "15:30"];
      pat.haircut_w[5] = ["12:00", "16:00"];
      pat.haircut_w[6] = ["13:00", "17:30"];
    }

    const bySvc = buildAvailabilityByService(sids, pat);
    listing.availabilityByService = bySvc;
    listing.availability = flattenAvailability(bySvc);
  }

  for (const l of LISTINGS) attachAvailability(l);

  // ===== bb.util (used by index.html) =====
  const bb = (window.bb = window.bb || {});
  bb.util = bb.util || {};

  bb.util.listingService = function (listing, serviceId) {
    return (listing.services || []).find((s) => s.serviceId === serviceId) || null;
  };

  bb.util.minPriceFor = function (listing, serviceId) {
    let m = null;
    for (const s of listing.services || []) {
      if (serviceId && s.serviceId !== serviceId) continue;
      if (m == null || s.from < m) m = s.from;
    }
    return m;
  };

  bb.util.nextAvailable = function (listing, serviceId) {
    const bySvc = listing.availabilityByService || {};
    if (serviceId && bySvc[serviceId] && bySvc[serviceId].length) {
      const s = bySvc[serviceId].slice().sort()[0];
      return { dateISO: s.slice(0, 10), time: s.slice(11, 16) };
    }

    const av = listing.availability || {};
    const dates = Object.keys(av).sort();
    for (const d of dates) {
      const times = (av[d] || []).slice().sort();
      if (times.length) return { dateISO: d, time: times[0] };
    }

    if (!serviceId) {
      let best = null;
      for (const k of Object.keys(bySvc)) {
        const arr = bySvc[k] || [];
        if (!arr.length) continue;
        const s = arr.slice().sort()[0];
        if (!best || s < best.slot) best = { slot: s, serviceId: k };
      }
      if (best) return { dateISO: best.slot.slice(0, 10), time: best.slot.slice(11, 16), serviceId: best.serviceId };
    }
    return null;
  };

  window.SERVICES = SERVICES;
  window.LISTINGS = LISTINGS;
})();
