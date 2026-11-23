// nm-bots.js — Lane B (bot): driver arena bom-bom car + penumpang bot wahana.
//
// Modul ini TIDAK menyentuh main.js / nm-rides.js / nm-games.js. Koordinator
// yang mewiring-nya (lihat REPORT.md lane ini untuk snippet wiring persis):
//   import { createBots, attachArenaBots } from './nm-bots.js';
//   this.nmBots = createBots(this);            // sekali, setelah nmRides dibangun
//   attachArenaBots(this.nmRides);             // sekali, setelah nmRides dibangun
//   // di loop utama, setelah nmRides.update(...):
//   this.nmBots.update(dt);
//
// Dua bagian (keduanya TAHAN terhadap seam yang belum ada — bila koordinator
// me-rollback arena Lane A, modul degrade ke perilaku aman, tidak crash):
// driver arena tidak terdaftar, penumpang bot berdiri di dekat board point
// tanpa naik wahana. Alasan degrade selalu tercatat di debug().
//
//   1. Driver arena bom-bom car: createArenaDriver() -> fn(car, dt, api)
//      -> { fwd, steer }. Didaftarkan ke arena lewat attachArenaBots():
//      seam Lane A (mendarat 2026-11-23, arena BARU 14x7,5 di (93,-48.25)):
//      entry.arena = { cars, scores: { player, bots: [0,0,0] },
//                      setBotDriver(botIndex, fn) } — botIndex 0..2,
//      botIndex 0 = cars[1] (cars[0] pemain); driver fn(car, dt, api)
//      dengan api = { cars, playerCar, bounds: { minX, maxX, minZ, maxZ } }
//      (bounds LOKAL arena, persegi panjang hx=6,2 hz=2,95).
//      Akses entry: nmRides.getEntry(id) (Lane A) atau getRideEntry(id)
//      (nama spek) — modul ini menerima keduanya.
//   2. Penumpang bot: 2 karakter (buildCharacter) yang secara ambient naik
//      wahana lain sendiri — siklus: jalan ke board point -> berdiri menunggu
//      -> naik wahana acak 20-40 dtk -> turun -> pindah wahana lain. Akses
//      entry wahana via getEntry/getRideEntry di atas; bila accessor belum
//      ada, bot memakai nmRides.interactables (board point) + NM_RIDES
//      (anchor) dan TIDAK naik wahana apa pun. Bot tidak pernah naik wahana
//      yang sedang dinaiki pemain, dan tidak pernah naik bumper/becak
//      (rider() di sana adalah kursi pengemudi tunggal — tempat pemain).
//      Kedua bot tidak pernah menarget wahana yang sama: wahana pertama
//      dipilih berbeda saat spawn, target bot lain selalu dihitung sibuk
//      saat pilih wahana berikut, dan transisi wait->ride dibatalkan bila
//      bot lain sedang naik wahana yang sama.
import { buildCharacter } from './player.js';
import { terrainHeight } from './physics.js';
import { NM_RIDES } from './nm-rides.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// ================= 1. DRIVER ARENA BOM-BOM CAR =================
// Perilaku: kejar mobil terdekat (biasanya pemain) dan seruduk; bila dekat
// dinding arena, belok menjauh ke tengah; sesekali (tiap ~6-10 dtk) ganti
// mode kejar titik acak. Dua pengaman anti-diam: zona mati (target <0,7 m
// -> jalan lurus menembus, bukan spin di tempat) dan anti-macet (gas maju
// tapi posisi tidak berubah 2 dtk -> mundur 0,8 dtk untuk lepas dari
// tabrakan/dinding). Satu driver = satu state (jangan dipakai bersama
// untuk dua mobil).
export function createArenaDriver(opts = {}) {
  const st = {
    clock: 0,
    mode: 'chase', // 'chase' | 'wander'
    modeUntil: 0,
    wander: null, // [x, z] titik acak saat mode wander
    lx: null, lz: null, progressT: 0, // posisi terakhir saat cek kemajuan
    reverseUntil: 0, reverseSteer: 0, // jendela mundur anti-macet
  };
  const switchMin = opts.switchMin ?? 6;
  const switchMax = opts.switchMax ?? 10;
  const wallMargin = opts.wallMargin ?? 0.9;
  const wanderP = opts.wanderP ?? 0.3; // peluang ganti ke mode wander

  // Normalisasi bounds dari seam (Lane A, arena 14x7,5 — PERSEGI PANJANG):
  // { minX, maxX, minZ, maxZ } (bentuk aktual) | number (setengah sisi,
  // arena bujur sangkar lama) | { lim } | { half } | { limX, limZ }.
  // Default 3,2 = LIM arena lama. Kembalikan setengah lebar (hx) dan
  // setengah dalam (hz) TERPISAH — arena baru hx=6,2 hz=2,95, jadi satu
  // angka saja membuat cek dinding sumbu-z tidak pernah terpicu.
  function normBounds(bounds) {
    const DEF = { hx: 3.2, hz: 3.2 };
    if (typeof bounds === 'number' && Number.isFinite(bounds)) return { hx: bounds, hz: bounds };
    if (bounds && typeof bounds === 'object') {
      if (typeof bounds.lim === 'number') return { hx: bounds.lim, hz: bounds.lim };
      if (typeof bounds.half === 'number') return { hx: bounds.half, hz: bounds.half };
      if (typeof bounds.limX === 'number' || typeof bounds.limZ === 'number') {
        return { hx: bounds.limX ?? bounds.limZ, hz: bounds.limZ ?? bounds.limX };
      }
      if (typeof bounds.maxX === 'number' && typeof bounds.minX === 'number'
        && typeof bounds.maxZ === 'number' && typeof bounds.minZ === 'number') {
        return {
          hx: Math.max((bounds.maxX - bounds.minX) / 2, 0.5),
          hz: Math.max((bounds.maxZ - bounds.minZ) / 2, 0.5),
        };
      }
    }
    return DEF;
  }

  // Mobil lain terdekat; bila playerCar hampir sama dekatnya, pilih pemain.
  function nearestTarget(car, api) {
    const cars = Array.isArray(api?.cars) ? api.cars : [];
    let best = null;
    let bestD = Infinity;
    for (const c of cars) {
      if (!c || c === car) continue;
      const d = Math.hypot((c.x ?? 0) - car.x, (c.z ?? 0) - car.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    const pc = api?.playerCar;
    if (pc && pc !== car) {
      const dp = Math.hypot((pc.x ?? 0) - car.x, (pc.z ?? 0) - car.z);
      if (dp <= bestD + 0.5) { best = pc; bestD = dp; }
    }
    return best;
  }

  const botDriver = function (car, dt, api) {
    if (!car || !(dt > 0)) return { fwd: 0, steer: 0 };
    st.clock += dt;
    const b = normBounds(api?.bounds);
    // Anti-macet: bila sedang dalam jendela mundur, mundur dulu (belok
    // acak kiri/kanan supaya geometri tabrakan berubah).
    if (st.clock < st.reverseUntil) {
      return { fwd: -0.8, steer: st.reverseSteer };
    }
    // Ganti mode tiap 6-10 dtk: wanderP peluang jalan-jalan ke titik acak.
    if (st.clock >= st.modeUntil) {
      st.mode = Math.random() < wanderP ? 'wander' : 'chase';
      if (st.mode === 'wander') {
        st.wander = [(Math.random() * 2 - 1) * b.hx * 0.8, (Math.random() * 2 - 1) * b.hz * 0.8];
      }
      st.modeUntil = st.clock + switchMin + Math.random() * (switchMax - switchMin);
    }
    let tx = 0;
    let tz = 0;
    // Dinding dulu: dekat bounds (per sumbu — arena persegi panjang) ->
    // arahkan ke tengah arena (bukan ke target).
    if (Math.abs(car.x) > b.hx - wallMargin || Math.abs(car.z) > b.hz - wallMargin) {
      tx = 0; tz = 0;
    } else if (st.mode === 'wander' && st.wander) {
      [tx, tz] = st.wander;
      if (Math.hypot(tx - car.x, tz - car.z) < 0.8) { st.mode = 'chase'; st.modeUntil = st.clock; }
    } else {
      const tgt = nearestTarget(car, api);
      if (tgt) { tx = tgt.x ?? 0; tz = tgt.z ?? 0; }
    }
    // Heading 0 = +z (konvensi stepCar: ax=sin h, az=cos h).
    const dx = tx - car.x;
    const dz = tz - car.z;
    const dist = Math.hypot(dx, dz);
    let steer;
    let fwd;
    if (dist < 0.7) {
      // Zona mati: target menumpuk di bawah hidung (baru tabrakan /
      // titik wander dekat) — arah ke target tidak stabil, belok di tempat
      // hanya bikin spin. Jalan lurus menembus supaya ada jarak, baru
      // kejar lagi. (Run 7: 2 dari 3 bot nyaris diam 10 dtk karena ini.)
      steer = 0;
      fwd = 1;
    } else {
      const want = Math.atan2(dx, dz);
      const dh = wrapAngle(want - (car.heading ?? 0));
      steer = clamp(dh * 1.6, -1, 1);
      // Target jauh di belakang -> pelan supaya belok lebih tajam.
      fwd = Math.abs(dh) > 1.9 ? 0.35 : 1;
    }
    // Pantau kemajuan: bila gas maju tapi posisi nyaris tidak berubah
    // selama 2 dtk (hidung-ke-hidung dengan mobil lain / terjepit dinding),
    // jadwalkan mundur 0,8 dtk untuk lepas. (Run 9: 2 dari 3 bot maju
    // menghadap pemain tapi gerak <1 m dalam 10 dtk — macet tabrakan.)
    if (fwd > 0) {
      if (st.lx === null) {
        st.lx = car.x; st.lz = car.z; st.progressT = st.clock;
      } else if (st.clock - st.progressT >= 2) {
        if (Math.hypot(car.x - st.lx, car.z - st.lz) < 0.3) {
          st.reverseUntil = st.clock + 0.8;
          st.reverseSteer = Math.random() < 0.5 ? -0.7 : 0.7;
        }
        st.lx = car.x; st.lz = car.z; st.progressT = st.clock;
      }
    }
    return { fwd, steer };
  };
  // Introspeksi untuk debug/verifikasi (mode + titik wander saat ini).
  botDriver.debug = () => ({
    mode: st.mode, clock: +st.clock.toFixed(2),
    wander: st.wander ? [+st.wander[0].toFixed(2), +st.wander[1].toFixed(2)] : null,
    reversing: st.clock < st.reverseUntil,
  });
  return botDriver;
}

// Daftarkan driver bot ke SEMUA mobil non-pemain di arena bom-bom car.
// Mengembalikan { attached, drivers: [botIndex...], reason, accessor } —
// attached 0 + reason terisi bila seam belum ada (BUKAN error: panggil
// lagi setelah Lane A merge; panggil ulang aman — driver lama ditimpa
// driver baru).
// Bentuk seam (Lane A, mendarat 2026-11-23 — arena BARU 14x7,5):
//   entry.arena = { cars, scores: { player, bots: [0,0,0] },
//                   setBotDriver(botIndex, fn) } — botIndex 0..2,
//   botIndex 0 = cars[1] (cars[0] = pemain); setBotDriver mengembalikan
//   false bila indeks di luar jangkauan / fn bukan fungsi.
// Akses entry: nmRides.getRideEntry(id) bila ada, JATUH ke
// nmRides.getEntry(id) — Lane A menamainya getEntry, bukan getRideEntry.
export function attachArenaBots(nmRides) {
  const res = { attached: 0, drivers: [], reason: '', accessor: null };
  try {
    const getFn = (nmRides && typeof nmRides.getRideEntry === 'function')
      ? nmRides.getRideEntry
      : (nmRides && typeof nmRides.getEntry === 'function' ? nmRides.getEntry : null);
    if (!getFn) {
      res.reason = 'getRideEntry/getEntry belum ada di nmRides (koordinator: tambah accessor)';
      return res;
    }
    res.accessor = getFn === nmRides.getRideEntry ? 'getRideEntry' : 'getEntry';
    const entry = getFn.call(nmRides, 'bumper');
    if (!entry) {
      res.reason = 'entry bumper tidak ditemukan';
      return res;
    }
    const arena = entry.arena;
    if (!arena || typeof arena.setBotDriver !== 'function' || !Array.isArray(arena.cars)) {
      res.reason = 'seam entry.arena (Lane A) belum ada';
      return res;
    }
    const playerIdx = typeof arena.playerIndex === 'number' ? arena.playerIndex
      : (arena.playerCar ? arena.cars.indexOf(arena.playerCar) : 0);
    for (let i = 0; i < arena.cars.length; i++) {
      if (i === playerIdx) continue;
      // Lane A: setBotDriver memakai BOT index (0..2) -> cars[botIndex+1];
      // cars[0] selalu pemain, jadi botIndex = indeks mobil - 1.
      const botIndex = i - 1;
      if (botIndex < 0) continue;
      const ok = arena.setBotDriver(botIndex, createArenaDriver());
      if (ok === false) { res.reason = `setBotDriver menolak botIndex ${botIndex} (mobil ${i})`; continue; }
      res.drivers.push(botIndex);
      res.attached += 1;
    }
    if (res.attached === 0 && !res.reason) res.reason = 'tidak ada mobil non-pemain di arena';
    return res;
  } catch (e) {
    res.reason = 'error: ' + (e?.message || String(e));
    return res;
  }
}

// ================= 2. PENUMPANG BOT DI WAHANA LAIN =================
// Wahana yang boleh dinaiki bot: punya rider() multi-kursi. Bumper & becak
// DIKECUALIKAN — rider() di sana = kursi pengemudi tunggal (tempat pemain);
// bot di sana akan menumpuk dengan pemain.
const PASSENGER_RIDES = ['ferris', 'pirate', 'carousel', 'chairs', 'tagada', 'coaster', 'train', 'odong'];

// Dua karakter, kustomisasi beda dari pemain default (kaos hijau + topi
// jerami) dan beda satu sama lain; tanpa name sprite.
const BOT_DEFS = [
  {
    key: 'bimo', gender: 'male',
    custom: {
      skin: 'tan', hairStyle: 'spiky', hairColor: 'auburn',
      shirtModel: 'long', shirtColor: 'orange',
      pantsModel: 'pants', pantsColor: 'teal',
      hatModel: 'cap', hatColor: 'red',
      glassesModel: 'none', glassesColor: 'black',
      shoesModel: 'sandals', shoesColor: 'brown',
    },
  },
  {
    key: 'rani', gender: 'female',
    custom: {
      skin: 'fair', hairStyle: 'bun', hairColor: 'brown',
      shirtModel: 'vest', shirtColor: 'purple',
      pantsModel: 'shorts', pantsColor: 'yellow',
      hatModel: 'beanie', hatColor: 'teal',
      glassesModel: 'round', glassesColor: 'teal',
      shoesModel: 'sneakers', shoesColor: 'red',
    },
  },
];

const WALK_SPEED = 1.7; // m/dtk — jalan santai pengunjung pasar malam
const RIDE_MIN = 20; // dtk di wahana
const RIDE_MAX = 40;
const WAIT_MIN = 4; // dtk berdiri di dekat board point
const WAIT_MAX = 10;

function pick(arr, except = []) {
  const pool = arr.filter((x) => !except.includes(x));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function createBots(game) {
  const bots = [];
  const state = { reason: '', ridesReady: false, arena: null };
  const nmRides = game?.nmRides ?? null;
  const scene = game?.scene ?? null;

  // --- Akses entry wahana (dengan fallback berlapis) ---
  // 1) getRideEntry(id) / getEntry(id) — accessor koordinator/Lane A:
  //    Lane A menamainya getEntry (mendarat 2026-11-23); getRideEntry
  //    adalah nama di spek tugas. Modul ini menerima KEDUANYA (utamakan
  //    getRideEntry), supaya tidak pecah apa pun nama finalnya.
  //    entry = { board: {x,z,r}, rider(), def }.
  // 2) nmRides.interactables — SUDAH ADA: [{ id, x, z, r }] = board point.
  // 3) NM_RIDES — anchor wahana (def x,z).
  function getEntry(id) {
    try {
      const fn = (nmRides && typeof nmRides.getRideEntry === 'function')
        ? nmRides.getRideEntry
        : (nmRides && typeof nmRides.getEntry === 'function' ? nmRides.getEntry : null);
      if (fn) {
        const e = fn.call(nmRides, id);
        if (e) return e;
      }
    } catch (e) { /* accessor gagal -> fallback */ }
    return null;
  }
  function boardPoint(id) {
    const e = getEntry(id);
    if (e?.board) return { x: e.board.x, z: e.board.z };
    try {
      const it = nmRides?.interactables?.find((x) => x.id === id);
      if (it) return { x: it.x, z: it.z };
    } catch (err) { /* abaikan */ }
    const def = NM_RIDES.find((d) => d.id === id);
    return def ? { x: def.x, z: def.z } : { x: 70, z: -40 };
  }
  function canRide(id) {
    const e = getEntry(id);
    return !!e && typeof e.rider === 'function';
  }
  function riderTransform(id) {
    const e = getEntry(id);
    if (!e || typeof e.rider !== 'function') return null;
    try { return e.rider() ?? null; } catch (err) { return null; }
  }
  function playerRideId() {
    try {
      if (nmRides && typeof nmRides.isRiding === 'function' && nmRides.isRiding()) {
        return nmRides.debug?.state?.()?.riding ?? null;
      }
    } catch (e) { /* abaikan */ }
    return null;
  }

  // --- Bangun 2 karakter bot ---
  if (!scene || typeof scene.add !== 'function') {
    state.reason = 'game.scene tidak tersedia — bot tidak dibuat';
  } else {
    const firstRides = []; // wahana pertama tiap bot — harus beda (anti-numpuk)
    for (const def of BOT_DEFS) {
      let group = null;
      try {
        group = buildCharacter(def.gender, def.custom);
      } catch (e) {
        state.reason = 'buildCharacter gagal untuk ' + def.key + ': ' + (e?.message || e);
        continue;
      }
      group.name = 'nm-bot-' + def.key;
      scene.add(group);
      const firstRide = pick(PASSENGER_RIDES, firstRides);
      firstRides.push(firstRide);
      const bp = boardPoint(firstRide);
      // Mulai berdiri di dekat board point pertama (offset per bot supaya
      // tidak menumpuk di titik yang sama persis).
      const off = def.key === 'bimo' ? 1.2 : -1.2;
      const bx = bp.x + off;
      const bz = bp.z + 0.8;
      group.position.set(bx, terrainHeight(bx, bz), bz);
      bots.push({
        key: def.key, group,
        mode: 'wait', // 'walk' | 'wait' | 'ride'
        rideId: firstRide,
        tx: bx, tz: bz, // target jalan
        timer: WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN),
        phase: Math.random() * Math.PI * 2, // fase ayun kaki/napas
        standX: bx, standZ: bz,
      });
    }
    state.ridesReady = typeof nmRides?.getRideEntry === 'function'
      || typeof nmRides?.getEntry === 'function';
    if (!state.ridesReady) {
      state.reason = 'getRideEntry/getEntry belum ada — bot hanya berdiri/berjalan di dekat board point (tidak naik wahana)';
    }
  }

  // Wahana yang sedang dituju/ditunggu/dinaiki bot lain — selalu dianggap
  // sibuk supaya kedua bot tidak pernah menumpuk di kursi yang sama.
  function otherBotRide(me) {
    for (const b of bots) {
      if (b !== me) return b.rideId;
    }
    return null;
  }

  function otherRidingSame(me) {
    // true bila bot lain sedang NAIK wahana yang sama — jangan naik juga
    // (menumpuk di kursi yang sama). Dipakai di transisi wait->ride.
    for (const b of bots) {
      if (b !== me && b.mode === 'ride' && b.rideId === me.rideId) return true;
    }
    return false;
  }

  function chooseNextRide(me) {
    const busy = [playerRideId(), otherBotRide(me), me.rideId].filter(Boolean);
    const id = pick(PASSENGER_RIDES, busy) ?? pick(PASSENGER_RIDES, [playerRideId()].filter(Boolean));
    return id ?? PASSENGER_RIDES[0];
  }

  function startWalk(bot, rideId) {
    const bp = boardPoint(rideId);
    const off = bot.key === 'bimo' ? 1.2 : -1.2;
    bot.rideId = rideId;
    bot.tx = bp.x + off;
    bot.tz = bp.z + 0.8;
    bot.mode = 'walk';
  }

  function stepBot(bot, dt) {
    const g = bot.group;
    const u = g.userData || {};
    if (bot.mode === 'walk') {
      const dx = bot.tx - g.position.x;
      const dz = bot.tz - g.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) {
        bot.mode = 'wait';
        bot.timer = WAIT_MIN + Math.random() * (WAIT_MAX - WAIT_MIN);
        bot.standX = g.position.x;
        bot.standZ = g.position.z;
        if (u.legL) u.legL.rotation.x = 0;
        if (u.legR) u.legR.rotation.x = 0;
        return;
      }
      const sp = Math.min(WALK_SPEED * dt, d);
      const nx = g.position.x + (dx / d) * sp;
      const nz = g.position.z + (dz / d) * sp;
      g.position.set(nx, terrainHeight(nx, nz), nz);
      g.rotation.y = Math.atan2(dx, dz);
      // Ayun kaki + lengan selaras jalan (rig yang sama dengan pemain).
      bot.phase += dt * 7;
      const sw = Math.sin(bot.phase) * 0.5;
      if (u.legL) u.legL.rotation.x = sw;
      if (u.legR) u.legR.rotation.x = -sw;
      if (u.armL) u.armL.rotation.x = -sw * 0.6;
      if (u.armR) u.armR.rotation.x = sw * 0.6;
      return;
    }
    if (bot.mode === 'wait') {
      // Berdiri menghadap wahana, napas idle halus.
      const bp = boardPoint(bot.rideId);
      g.rotation.y = Math.atan2(bp.x - g.position.x, bp.z - g.position.z);
      bot.phase += dt * 1.6;
      if (u.upper) u.upper.position.y = Math.sin(bot.phase) * 0.02;
      bot.timer -= dt;
      if (bot.timer <= 0) {
        // Naik hanya bila accessor + rider() tersedia DAN wahana itu
        // bukan yang sedang dinaiki pemain DAN bukan yang sedang dinaiki
        // bot lain (anti-numpuk di kursi yang sama).
        if (canRide(bot.rideId) && playerRideId() !== bot.rideId && !otherRidingSame(bot)) {
          bot.mode = 'ride';
          bot.timer = RIDE_MIN + Math.random() * (RIDE_MAX - RIDE_MIN);
          if (u.upper) u.upper.position.y = 0;
          // Langsung tempel ke kursi (bukan frame berikutnya) supaya tidak
          // ada satu frame posisi basi di board point.
          const rt0 = riderTransform(bot.rideId);
          if (rt0) { g.position.set(rt0.x, rt0.y, rt0.z); g.rotation.y = rt0.ry ?? 0; }
        } else {
          // Belum bisa naik (seam belum ada / wahana dipakai pemain):
          // pindah ke wahana lain, tetap di darat.
          startWalk(bot, chooseNextRide(bot));
        }
      }
      return;
    }
    // mode === 'ride': tempel ke transform wahana tiap frame (sama seperti
    // pemain di main.js: group.position = rt, rotation.y = rt.ry).
    const pr = playerRideId();
    if (pr === bot.rideId) {
      // Pemain baru saja naik wahana yang sama — bot turun duluan supaya
      // tidak menumpuk di kursi yang sama.
      startWalk(bot, chooseNextRide(bot));
      return;
    }
    const rt = riderTransform(bot.rideId);
    if (rt) {
      g.position.set(rt.x, rt.y, rt.z);
      g.rotation.y = rt.ry ?? 0;
    }
    bot.timer -= dt;
    if (bot.timer <= 0 || !rt) {
      // Turun: jalan ke board point wahana berikutnya.
      startWalk(bot, chooseNextRide(bot));
    }
  }

  function update(dt) {
    if (!bots.length || !(dt > 0)) return;
    for (const bot of bots) {
      try { stepBot(bot, dt); } catch (e) { /* satu bot gagal tidak menjatuhkan yang lain */ }
    }
  }

  function debug() {
    return {
      reason: state.reason,
      ridesReady: state.ridesReady,
      arena: state.arena,
      bots: bots.map((b) => ({
        key: b.key, mode: b.mode, rideId: b.rideId,
        x: +b.group.position.x.toFixed(2),
        y: +b.group.position.y.toFixed(2),
        z: +b.group.position.z.toFixed(2),
        timer: +b.timer.toFixed(1),
      })),
    };
  }

  return {
    update,
    debug,
    bots,
    attachArena() {
      state.arena = attachArenaBots(nmRides);
      return state.arena;
    },
  };
}
