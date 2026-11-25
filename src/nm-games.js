// nm-games.js — Lane G: 8 game berhadiah pasar malam ("Lembah Hijau").
//
// Restyle visual Lane D (anime overhaul, 25 Nov 2026): semua permukaan
// MeshToonMaterial + gradientMap 4-step (cel), palet langit/sakura/
// matahari PRODUCT.md, papan nama + angka roda display rounded, SFX khas
// lembah ("YEAY!"/"DUAR!") + burst kelopak saat menang. Logika, ekonomi,
// peluang, teks, koordinat TIDAK berubah.
//
// Antarmuka (koordinator wiring ke main.js — lihat LANE-G-REPORT.md):
//   NM_GAMES: [{ id, x, z, cost, labelKey }] — 8 stan, anchor terkunci.
//   buildNightMarketGames(scene, THREE, ctx) -> {
//     colliders,            // AABB stan (gabung ke world.colliders)
//     interactables,        // [{ id, x, z, r, labelKey }] (cek di updateInteraction)
//     update(dt, t, game),  // panggil tiap frame dari loop utama
//     onUse(id, game),      // panggil dari doAction saat ctx.type === 'nmGame'
//   }
//   playGameRound(id, rng, skill=0.5) — logika murni satu ronde, tanpa DOM/THREE,
//     bisa dites headless (node/browser). rng: () => [0,1). skill: 0..1.
//   playThrow(id, rng, skill, st) — satu lemparan/putaran/koin dalam ronde.
//   roundBonus(id, throws, st) — bonus akhir ronde (dipakai playGameRound +
//     panel interaktif supaya keduanya konsisten).
//
// ctx yang dipakai: { t(key, lang, vars), lang, toast(msg), sfx: { play(name) },
//                     broadcast?(type, data) }.
// Yang dipanggil dari `game` (bila tersedia; fallback ke ctx bila tidak):
//   game.state.coins (baca), game.state.lang (baca), game.addCoins(n),
//   game.save(), game.ui.toast(msg), game.sfx.play(name).
// Koin TIDAK PERNAH minus: biaya dicek sebelum dipotong; addCoins clamp >= 0.
//
// Ekonomi (skill rata-rata 0.5, diverifikasi simulasi 1000 ronde/game):
//   house edge >= 20% per game. Lihat tabel di LANE-G-REPORT.md.
import { terrainHeight, clamp } from './physics.js';
import { t as i18nT } from './i18n.js';

export const NM_GAMES = [
  { id: 'ring',   x: 66, z: -12, cost: 10, labelKey: 'gameRing' },
  { id: 'dart',   x: 74, z: -12, cost: 10, labelKey: 'gameDart' },
  { id: 'duck',   x: 82, z: -12, cost: 5,  labelKey: 'gameDuck' },
  { id: 'basket', x: 90, z: -12, cost: 10, labelKey: 'gameBasket' },
  { id: 'shoot',  x: 66, z: 12,  cost: 10, labelKey: 'gameShoot' },
  { id: 'cans',   x: 74, z: 12,  cost: 10, labelKey: 'gameCans' },
  { id: 'wheel',  x: 82, z: 12,  cost: 20, labelKey: 'gameWheel' },
  { id: 'pusher', x: 90, z: 12,  cost: 5,  labelKey: 'gamePusher' },
];

export const NM_DEF = Object.fromEntries(NM_GAMES.map((g) => [g.id, g]));

// Skor rival BOT per game (deterministik — nilai tetap, bukan acak tiap
// buka): skor menengah-atas pemain terampil (skill 0.8), dihitung dari
// distribusi hadiah playGameRound. Simulasi 200.000 ronde/game, skill 0.8:
// peluang menyamai/mengalahkan skor ini 9-25% (ring 13%, dart 21%, duck
// 19%, basket 17%, shoot 9%, wheel 25%, pusher 13%). Pengecualian cans:
// hadiah maksimum 14 (6 kaleng + bonus 8), rival 13 hanya dikalahkan ronde
// sempurna 14 — peluang 61% di skill 0.8, 34% di skill 0.5. Bukan mustahil,
// bukan hadiah maksimum.
export const NM_RIVAL = {
  ring: 24, dart: 20, duck: 8, basket: 22,
  shoot: 24, cans: 13, wheel: 25, pusher: 8,
};

// ---- Konfigurasi ekonomi + peluang (skill 0..1) ---------------------------
// pHit(skill) = pMin + (pMax - pMin) * skill. Nilai p(0.5) = peluang pemain
// rata-rata; EV dihitung pada skill 0.5 (lihat verify-nm-G.mjs).
const CFG = {
  ring:   { throws: 3, pMin: 0.10, pMax: 0.26, prize: 12, bonusAll: 15 },
  dart:   { throws: 3, pMin: 0.12, pMax: 0.32, prize: 10, goldChance: 0.05, goldPrize: 25 },
  duck:   { throws: 1, pMin: 0.30, pMax: 0.72,
            prizes: { normal: 5, striped: 8, gold: 25 },
            typeW: { normal: 0.70, striped: 0.25, gold: 0.05 } },
  basket: { throws: 3, pMin: 0.11, pMax: 0.30, prize: 11 },
  shoot:  { throws: 5, pMin: 0.12, pMax: 0.48, prize: 4, bonus3: 8, bonus5: 15 },
  cans:   { throws: 3, pMin: 0.25, pMax: 0.65, perCan: 1, cans: 6, bonusAll: 8 },
  wheel:  { throws: 1, segments: [0, 0, 5, 10, 10, 15, 25, 50] },
  pusher: { throws: 3, qMin: 0.34, qMax: 0.50, split: [0.74, 0.21, 0.05], winPer: 2 },
};

export const NM_CFG = CFG;

function pHit(cfg, skill) {
  const s = clamp(skill ?? 0.5, 0, 1);
  return cfg.pMin + (cfg.pMax - cfg.pMin) * s;
}

// ---- Logika murni (tanpa DOM/THREE) --------------------------------------
// Satu lemparan/putaran/koin. `st` = state ronde yang bisa berubah
// (dipakai cans: kaleng yang sudah jatuh). Mengembalikan hasil lemparan.
export function playThrow(id, rng, skill = 0.5, st = {}) {
  const cfg = CFG[id];
  if (!cfg) throw new Error('unknown night-market game: ' + id);
  const r = rng;
  switch (id) {
    case 'ring':
    case 'basket': {
      const hit = r() < pHit(cfg, skill);
      return { hit, prize: hit ? cfg.prize : 0 };
    }
    case 'dart': {
      const hit = r() < pHit(cfg, skill);
      const gold = hit && r() < cfg.goldChance;
      return { hit, gold, prize: hit ? (gold ? cfg.goldPrize : cfg.prize) : 0 };
    }
    case 'duck': {
      const caught = r() < pHit(cfg, skill);
      if (!caught) return { caught: false, type: null, prize: 0 };
      const w = r();
      const type = w < cfg.typeW.normal ? 'normal'
        : w < cfg.typeW.normal + cfg.typeW.striped ? 'striped' : 'gold';
      return { caught: true, type, prize: cfg.prizes[type] };
    }
    case 'shoot': {
      const hit = r() < pHit(cfg, skill);
      return { hit, prize: hit ? cfg.prize : 0 };
    }
    case 'cans': {
      if (!st.down) st.down = new Array(cfg.cans).fill(false);
      const newly = [];
      for (let i = 0; i < cfg.cans; i++) {
        if (!st.down[i] && r() < pHit(cfg, skill)) { st.down[i] = true; newly.push(i); }
      }
      return { newly, down: [...st.down], prize: newly.length * cfg.perCan };
    }
    case 'wheel': {
      const idx = Math.min(cfg.segments.length - 1, Math.floor(r() * cfg.segments.length));
      return { segment: idx, prize: cfg.segments[idx] };
    }
    case 'pusher': {
      const s = clamp(skill ?? 0.5, 0, 1);
      const q = cfg.qMin + (cfg.qMax - cfg.qMin) * s;
      const w = r();
      let fallen = 0;
      if (w < q * cfg.split[0]) fallen = 1;
      else if (w < q * (cfg.split[0] + cfg.split[1])) fallen = 2;
      else if (w < q) fallen = 5;
      return { fallen, prize: fallen * cfg.winPer };
    }
    default:
      throw new Error('unknown night-market game: ' + id);
  }
}

// Bonus akhir ronde (di luar hadiah per lemparan).
export function roundBonus(id, throws, st = {}) {
  const cfg = CFG[id];
  if (!cfg) return 0;
  if (id === 'ring' && throws.length >= cfg.throws && throws.every((x) => x.hit)) return cfg.bonusAll;
  if (id === 'shoot') {
    const hits = throws.filter((x) => x.hit).length;
    return (hits >= 3 ? cfg.bonus3 : 0) + (hits === 5 ? cfg.bonus5 : 0);
  }
  if (id === 'cans' && st.down && st.down.every(Boolean)) return cfg.bonusAll;
  return 0;
}

// Satu ronde penuh: N lemparan + bonus. Hasil: { win, prize, throws, detail }.
export function playGameRound(id, rng, skill = 0.5) {
  const cfg = CFG[id];
  if (!cfg) throw new Error('unknown night-market game: ' + id);
  const st = {};
  const throws = [];
  let prize = 0;
  for (let i = 0; i < cfg.throws; i++) {
    const res = playThrow(id, rng, skill, st);
    throws.push(res);
    prize += res.prize;
  }
  prize += roundBonus(id, throws, st);
  return { win: prize > 0, prize, throws, detail: st };
}

// Skill dari posisi penanda bidik (0..100) terhadap target.
// mode 'center': target di tengah (50). mode 'dots': target = titik terdekat.
export function skillFromAim(pos, mode, dots = []) {
  if (mode === 'dots' && dots.length) {
    const d = Math.min(...dots.map((x) => Math.abs(pos - x)));
    return clamp(1 - d / 28, 0, 1);
  }
  return clamp(1 - Math.abs(pos - 50) / 50, 0, 1);
}

// ---- Tekstur canvas (prosedural, tanpa aset eksternal) ---------------------
function canvasTex(THREE, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tx = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

// Papan nama stan: nama ID besar + EN kecil, di atas kertas krem berbingkai kayu.
function signTexture(THREE, ctx, def) {
  const idName = ctx.t(def.labelKey, 'id');
  const enName = ctx.t(def.labelKey, 'en');
  return canvasTex(THREE, 512, 128, (g, w, h) => {
    g.fillStyle = '#fff6e5'; g.fillRect(0, 0, w, h); // --lh-paper
    g.strokeStyle = '#1d2b53'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); // outline tinta
    g.fillStyle = '#1d2b53'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 52px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Trebuchet MS", system-ui, sans-serif';
    g.fillText(idName, w / 2, 48);
    g.fillStyle = '#ff5c8a'; // --lh-sakura-deep
    g.font = '800 26px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Trebuchet MS", system-ui, sans-serif';
    g.fillText(enName, w / 2, 96);
  });
}

// Kain atap bergaris: warna stan + kertas krem.
function canopyTexture(THREE, accent) {
  return canvasTex(THREE, 256, 128, (g, w, h) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 === 0 ? accent : '#fff8dc';
      g.fillRect((w / n) * i, 0, w / n + 1, h);
    }
  });
}

// ---- Cel/toon anime (Lane D restyle, PRODUCT.md § Dunia 3D) ----
// Semua permukaan MeshToonMaterial + gradientMap 4-step. MeshBasicMaterial
// dipertahankan hanya untuk teks/angka di atas tekstur dan tracer.
let _toonGrad = null;
function toonGrad(THREE) {
  if (_toonGrad) return _toonGrad;
  const tex = new THREE.DataTexture(new Uint8Array([90, 150, 210, 255]), 4, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _toonGrad = tex;
  return tex;
}

// ---- SFX onomatopoeia + burst kelopak (Lane D; PRODUCT.md § Motion) ----
// Teks SFX khas lembah, partikel = kelopak sakura + daun + bintang — BUKAN
// asap/shard Sakuga. Hanya di momen menang (satu authored moment per
// ronde). Mati bila prefers-reduced-motion.
const LH_REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
function lhFxCss() {
  if (typeof document === 'undefined' || document.getElementById('lh-fx-style-games')) return;
  const st = document.createElement('style');
  st.id = 'lh-fx-style-games';
  st.textContent = '.lh-sfx-nm{position:fixed;left:50%;top:38%;z-index:60;pointer-events:none;font-family:"Arial Rounded MT Bold","Hiragino Maru Gothic ProN","Hiragino Sans","Trebuchet MS",system-ui,sans-serif;font-weight:800;font-style:italic;font-size:clamp(34px,6vw,52px);letter-spacing:.02em;color:#ffc93c;-webkit-text-stroke:2px #1d2b53;text-shadow:4px 4px 0 rgba(29,43,83,.9);transform:translate(-50%,-50%) rotate(-6deg);animation:lh-sfx-nm-pop .9s cubic-bezier(.34,1.56,.64,1) forwards}'
    + '@keyframes lh-sfx-nm-pop{0%{transform:translate(-50%,-50%) scale(.35) rotate(-12deg);opacity:0}25%{opacity:1;transform:translate(-50%,-50%) scale(1.18) rotate(-3deg)}55%{transform:translate(-50%,-50%) scale(1) rotate(-6deg);opacity:1}100%{transform:translate(-50%,-62%) scale(1.04) rotate(-6deg);opacity:0}}'
    + '.lh-petal{position:fixed;z-index:60;pointer-events:none;animation:lh-petal-fly .9s ease-out forwards}'
    + '@keyframes lh-petal-fly{to{transform:translate(var(--dx,0px),var(--dy,-60px)) rotate(var(--rot,180deg)) scale(.55);opacity:0}}'
    + '#nm-modal .primary-btn:active{transform:scale(.93)}'
    + '@media (prefers-reduced-motion:reduce){.lh-sfx-nm,.lh-petal{animation:none!important;display:none!important}}';
  document.head.appendChild(st);
}
function lhBurst(host) {
  const cols = ['#ff8fb3', '#ffc93c', '#2fbf4a', '#ff5c8a'];
  const shapes = ['50% 0 50% 50%', '50%', '0 50% 50% 50%']; // kelopak / bulat / daun
  for (let i = 0; i < 10; i++) {
    const p = document.createElement('span');
    p.className = 'lh-petal';
    p.setAttribute('aria-hidden', 'true');
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90;
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
    p.style.setProperty('--rot', `${(Math.random() * 360) | 0}deg`);
    p.style.left = '50%';
    p.style.top = '38%';
    p.style.background = cols[i % cols.length];
    p.style.borderRadius = shapes[i % shapes.length];
    const s = 9 + Math.random() * 7;
    p.style.width = `${s}px`;
    p.style.height = `${s * 0.8}px`;
    host.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }
}
function lhSfx(text) {
  if (LH_REDUCED || typeof document === 'undefined') return;
  lhFxCss();
  const host = document.getElementById('game-container') || document.body;
  const el = document.createElement('div');
  el.className = 'lh-sfx-nm';
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  host.appendChild(el);
  lhBurst(host);
  setTimeout(() => el.remove(), 950);
}

// Warna aksen tiap stan (kain atap + detail) — token anime PRODUCT.md.
const ACCENT = {
  ring: '#ff5c8a', dart: '#2fbf4a', duck: '#ffc93c', basket: '#ff9f1c',
  shoot: '#8a6b3f', cans: '#1e6fd9', wheel: '#ff8fb3', pusher: '#2fbf4a',
};
const WHEEL_COLORS = ['#ff5c8a', '#ffc93c', '#2fbf4a', '#ff9f1c',
  '#3fa9f5', '#ff8fb3', '#1e6fd9', '#8a6b3f'];

// ---- Pembangun stan 3D ----------------------------------------------------
function stdMat(THREE, color, opts = {}) {
  // Cel: kunci Standard (roughness/metalness) dibuang — toon tidak mengenalnya.
  const { roughness, metalness, ...rest } = opts;
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGrad(THREE), ...rest });
}
function box(THREE, parent, w, h, d, color, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stdMat(THREE, color, opts));
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cyl(THREE, parent, rTop, rBot, h, color, x, y, z, opts = {}, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), stdMat(THREE, color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// Cangkang stan: platform kayu + meja + 4 tiang + atap kain + papan nama + lampu.
// Frame lokal: +z = arah jalan (depan stan). Mengembalikan { group, refs }.
function buildStallShell(THREE, parent, ctx, def) {
  const groundY = terrainHeight(def.x, def.z);
  const g = new THREE.Group();
  g.position.set(def.x, groundY, def.z);
  // Utara (z=-12) menghadap selatan (+z, ke jalan); selatan (z=12) menghadap utara.
  g.rotation.y = def.z < 0 ? 0 : Math.PI;
  g.userData.nmStall = def.id;
  parent.add(g);
  // Platform kayu (rok memanjang 0,5 m ke bawah tanah — menutup selisih
  // tinggi bila Lane P meratakan zona ke h≈0,6).
  box(THREE, g, 3.6, 0.5, 2.6, 0x9a7b4f, 0, 0.05, 0);
  // Meja kayu.
  box(THREE, g, 3.0, 0.12, 1.2, 0x8a6b3f, 0, 0.95, 0.2);
  box(THREE, g, 0.12, 0.7, 0.12, 0x6b4e2a, -1.35, 0.55, 0.2);
  box(THREE, g, 0.12, 0.7, 0.12, 0x6b4e2a, 1.35, 0.55, 0.2);
  // Tiang + atap kain miring.
  for (const [px, pz] of [[-1.5, -0.6], [1.5, -0.6], [-1.5, 0.9], [1.5, 0.9]]) {
    cyl(THREE, g, 0.06, 0.06, 2.3, 0x6b4e2a, px, 1.45, pz);
  }
  const canopy = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 2.2),
    new THREE.MeshToonMaterial({ map: canopyTexture(THREE, ACCENT[def.id]), gradientMap: toonGrad(THREE), side: THREE.DoubleSide }),
  );
  canopy.position.set(0, 2.75, 0.15);
  canopy.rotation.x = -Math.PI / 2 + 0.35; // miring: depan lebih rendah
  canopy.castShadow = true;
  g.add(canopy);
  // Papan nama di depan atas.
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.65),
    new THREE.MeshToonMaterial({ map: signTexture(THREE, ctx, def), gradientMap: toonGrad(THREE) }),
  );
  sign.position.set(0, 2.55, 1.02);
  g.add(sign);
  // Lampu kecil (bola emissive hangat) di kedua ujung depan.
  const lamps = [];
  for (const lx of [-1.5, 1.5]) {
    const lampMat = new THREE.MeshToonMaterial({
      color: 0xffd27a, emissive: 0xffb340, emissiveIntensity: 1.4, gradientMap: toonGrad(THREE),
    });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), lampMat);
    lamp.position.set(lx, 2.42, 0.95);
    g.add(lamp);
    lamps.push(lamp);
  }
  return { group: g, groundY, lamps };
}

// Objek permainan per stan (di atas/di depan meja). refs dipakai update()
// untuk animasi idle + reaksi hasil.
function buildGameProps(THREE, shell, def) {
  const g = shell.group;
  const refs = {};
  const tableY = 1.02; // permukaan meja
  switch (def.id) {
    case 'ring': {
      refs.pegs = [];
      for (const px of [-0.8, 0, 0.8]) {
        const peg = cyl(THREE, g, 0.05, 0.07, 0.55, 0x4a3419, px, tableY + 0.27, -0.1);
        refs.pegs.push(peg);
      }
      // Tumpukan gelang cadangan di sisi meja.
      refs.rings = [];
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 20),
          stdMat(THREE, [0xff5c8a, 0x2fbf4a, 0xff9f1c][i]));
        ring.position.set(1.25, tableY + 0.06 + i * 0.09, 0.35);
        ring.rotation.x = Math.PI / 2;
        ring.castShadow = true;
        g.add(ring);
        refs.rings.push(ring);
      }
      break;
    }
    case 'dart': {
      // Papan belakang + 5 balon warna-warni.
      box(THREE, g, 2.4, 1.7, 0.08, 0x6b4e2a, 0, 2.0, -0.55);
      refs.balloons = [];
      const cols = [0xff5c8a, 0x2fbf4a, 0x1e6fd9, 0xff9f1c, 0xff5c8a];
      const spots = [[-0.9, 1.75], [-0.45, 2.25], [0, 1.7], [0.45, 2.3], [0.9, 1.8]];
      spots.forEach(([bx, by], i) => {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10),
          stdMat(THREE, cols[i], { roughness: 0.35 }));
        b.position.set(bx, by, -0.42);
        b.scale.set(1, 1.15, 1);
        b.castShadow = true;
        b.userData.baseY = by;
        b.userData.phase = i * 1.3;
        g.add(b);
        refs.balloons.push(b);
      });
      // Dart cadangan menancap di sisi papan.
      for (let i = 0; i < 3; i++) {
        cyl(THREE, g, 0.02, 0.02, 0.5, 0xcccccc, -1.15, 1.5 + i * 0.22, -0.45, {}, 6)
          .rotation.z = Math.PI / 2;
      }
      break;
    }
    case 'duck': {
      // Kolam kecil di atas meja + 5 bebek yang berenang melingkar.
      const pond = cyl(THREE, g, 0.95, 0.95, 0.22, 0x3fa9f5, 0, tableY + 0.08, 0.1, { roughness: 0.25 }, 20);
      pond.receiveShadow = true;
      refs.pond = pond;
      refs.ducks = [];
      for (let i = 0; i < 5; i++) {
        const duck = new THREE.Group();
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
          stdMat(THREE, i === 4 ? 0xffd34d : 0xffe066, { roughness: 0.6 }));
        body.scale.set(1.25, 0.85, 1);
        body.castShadow = true;
        duck.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8),
          stdMat(THREE, i === 4 ? 0xffd34d : 0xffe066));
        head.position.set(0.16, 0.1, 0);
        duck.add(head);
        const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 6),
          stdMat(THREE, 0xff9f1c));
        beak.rotation.z = -Math.PI / 2;
        beak.position.set(0.27, 0.1, 0);
        duck.add(beak);
        duck.userData.angle = (i / 5) * Math.PI * 2;
        duck.userData.gold = i === 4;
        g.add(duck);
        refs.ducks.push(duck);
      }
      // Kait pancing (menggantung di atas kolam).
      const hook = new THREE.Group();
      const line = cyl(THREE, hook, 0.012, 0.012, 0.9, 0xdddddd, 0, 0.45, 0, {}, 6);
      line.castShadow = false;
      const claw = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 6, 12, Math.PI * 1.5),
        stdMat(THREE, 0x888888, { metalness: 0.6, roughness: 0.4 }));
      claw.position.set(0, 0, 0);
      hook.add(claw);
      hook.position.set(0, 2.3, 0.1);
      hook.userData.baseY = 2.3;
      g.add(hook);
      refs.hook = hook;
      break;
    }
    case 'basket': {
      // Tiang + papan + ring basket.
      cyl(THREE, g, 0.07, 0.07, 1.9, 0x4a3419, 0, 1.95, -0.55);
      box(THREE, g, 1.1, 0.9, 0.06, 0xfff8dc, 0, 2.7, -0.55);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 20),
        stdMat(THREE, 0xff5c8a, { metalness: 0.4, roughness: 0.4 }));
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(0, 2.32, -0.2);
      hoop.castShadow = true;
      g.add(hoop);
      refs.hoop = hoop;
      // Bola cadangan di meja.
      refs.balls = [];
      for (let i = 0; i < 3; i++) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10),
          stdMat(THREE, 0xff9f1c, { roughness: 0.5 }));
        ball.position.set(-0.9 + i * 0.35, tableY + 0.17, 0.45);
        ball.castShadow = true;
        g.add(ball);
        refs.balls.push(ball);
      }
      break;
    }
    case 'shoot': {
      // Rel + 3 sasaran bundar yang bergeser kiri-kanan.
      box(THREE, g, 2.5, 0.08, 0.08, 0x4a3419, 0, 2.0, -0.5);
      refs.targets = [];
      for (let i = 0; i < 3; i++) {
        const tgt = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 20),
          stdMat(THREE, 0xfff8dc));
        disc.rotation.x = Math.PI / 2;
        tgt.add(disc);
        const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.07, 16),
          stdMat(THREE, 0xff5c8a));
        inner.rotation.x = Math.PI / 2;
        tgt.add(inner);
        const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 12),
          stdMat(THREE, 0x2b2118));
        dot.rotation.x = Math.PI / 2;
        tgt.add(dot);
        tgt.position.set(-0.8 + i * 0.8, 2.0, -0.44);
        tgt.userData.baseX = -0.8 + i * 0.8;
        tgt.userData.phase = i * 2.1;
        g.add(tgt);
        refs.targets.push(tgt);
      }
      break;
    }
    case 'cans': {
      // Piramida 6 kaleng (3-2-1) di atas meja.
      refs.cans = [];
      const rows = [[-0.35, 0, 0.35], [-0.18, 0.18], [0]];
      rows.forEach((row, ri) => {
        row.forEach((cx) => {
          const can = cyl(THREE, g, 0.16, 0.16, 0.4, ri === 0 ? 0xfff6e5 : 0xff5c8a,
            cx, tableY + 0.2 + ri * 0.41, -0.1, { metalness: 0.5, roughness: 0.35 }, 14);
          can.userData.home = can.position.clone();
          can.userData.down = false;
          g.add(can);
          refs.cans.push(can);
        });
      });
      // Bola cadangan.
      refs.balls = [];
      for (let i = 0; i < 3; i++) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10),
          stdMat(THREE, 0x2fbf4a, { roughness: 0.5 }));
        ball.position.set(0.95 + i * 0.32, tableY + 0.15, 0.45);
        ball.castShadow = true;
        g.add(ball);
        refs.balls.push(ball);
      }
      break;
    }
    case 'wheel': {
      // Roda 8 segmen: irisan mesh (bukan tekstur) supaya segmen di bawah
      // penunjuk bisa dihitung dari rotation.z tanpa ambiguitas pemetaan UV.
      const wheel = new THREE.Group();
      wheel.position.set(0, 2.1, -0.35);
      const seg = CFG.wheel.segments;
      for (let k = 0; k < 8; k++) {
        const wedge = new THREE.Mesh(
          new THREE.CircleGeometry(1.0, 12, (k * Math.PI) / 4, Math.PI / 4),
          stdMat(THREE, WHEEL_COLORS[k], { roughness: 0.6 }),
        );
        wedge.position.z = 0.07;
        wheel.add(wedge);
        // Angka hadiah di tengah tiap irisan.
        const numTex = canvasTex(THREE, 128, 64, (cg) => {
          cg.fillStyle = '#ffffff'; cg.textAlign = 'center'; cg.textBaseline = 'middle';
          cg.font = '800 44px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Trebuchet MS", system-ui, sans-serif';
          cg.fillText(String(seg[k]), 64, 34);
        });
        const num = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21),
          new THREE.MeshBasicMaterial({ map: numTex, transparent: true }));
        const mid = ((k + 0.5) * Math.PI) / 4;
        num.position.set(Math.cos(mid) * 0.62, Math.sin(mid) * 0.62, 0.08);
        num.rotation.z = mid - Math.PI / 2;
        wheel.add(num);
      }
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 8, 32),
        stdMat(THREE, 0x6b4e2a));
      rim.position.z = 0.07;
      wheel.add(rim);
      const hub = cyl(THREE, wheel, 0.12, 0.12, 0.2, 0xffb340, 0, 0, 0.07, {}, 12);
      hub.rotation.x = Math.PI / 2;
      wheel.rotation.z = 0;
      g.add(wheel);
      refs.wheel = wheel;
      // Penunjuk segitiga di atas roda.
      const ptr = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 4),
        stdMat(THREE, 0x2b2118));
      ptr.rotation.x = Math.PI; // ujung ke bawah
      ptr.position.set(0, 3.35, -0.28);
      g.add(ptr);
      // Tiang penyangga roda.
      cyl(THREE, g, 0.07, 0.07, 1.1, 0x4a3419, 0, 1.55, -0.35);
      break;
    }
    case 'pusher': {
      // Platform pendorong: alas + balok pendorong yang meluncur + koin emas.
      box(THREE, g, 2.6, 0.4, 1.3, 0x8a6b3f, 0, tableY + 0.2, 0.1);
      const pusherBlock = box(THREE, g, 2.4, 0.45, 0.3, 0x6b4e2a, 0, tableY + 0.55, -0.35);
      pusherBlock.userData.baseZ = -0.35;
      refs.pusherBlock = pusherBlock;
      refs.coins = [];
      const coinSpots = [[-0.8, 0.45], [-0.3, 0.55], [0.2, 0.4], [0.7, 0.55], [-0.55, 0.15], [0.45, 0.1]];
      coinSpots.forEach(([cx, cz]) => {
        const coin = cyl(THREE, g, 0.22, 0.22, 0.06, 0xffb340, cx, tableY + 0.44, cz,
          { metalness: 0.6, roughness: 0.3 }, 16);
        coin.userData.home = coin.position.clone();
        g.add(coin);
        refs.coins.push(coin);
      });
      // Koin cadangan di sisi meja.
      refs.spareCoins = [];
      for (let i = 0; i < 3; i++) {
        const coin = cyl(THREE, g, 0.22, 0.22, 0.06, 0xffb340, 1.25, tableY + 0.05 + i * 0.07, 0.5,
          { metalness: 0.6, roughness: 0.3 }, 16);
        g.add(coin);
        refs.spareCoins.push(coin);
      }
      break;
    }
    default:
      break;
  }
  return refs;
}

// ---- buildNightMarketGames --------------------------------------------------
export function buildNightMarketGames(scene, THREE, ctx) {
  const S = {
    THREE, ctx, scene,
    stalls: new Map(), // id -> { def, shell, refs }
    anims: [],         // animasi 3D aktif
    open: null,        // sesi panel aktif
    aim: { pos: 50, mode: 'center', dots: [], dotsOverride: false, pausedUntil: 0 },
    busy: false,
    pendingEnd: null,
    game: null,
  };

  // Grup induk: semua geometri game dalam satu grup supaya main.js bisa
  // meng-culling bayangannya saat pemain jauh dari zona.
  const group = new THREE.Group();
  group.name = 'night-market-games';
  scene.add(group);

  for (const def of NM_GAMES) {
    const shell = buildStallShell(THREE, group, ctx, def);
    const refs = buildGameProps(THREE, shell, def);
    S.stalls.set(def.id, { def, shell, refs });
  }

  const colliders = NM_GAMES.map((def) => ({
    minX: def.x - 1.9, maxX: def.x + 1.9,
    minZ: def.z - 1.3, maxZ: def.z + 1.3,
  }));
  // Titik interaksi di sisi jalan (depan stan) supaya pemain tidak perlu
  // menempel meja: utara z+1.8, selatan z-1.8.
  const interactables = NM_GAMES.map((def) => ({
    id: def.id, x: def.x, z: def.z + (def.z < 0 ? 1.8 : -1.8), r: 3.2, labelKey: def.labelKey,
  }));

  // ---------- Helpers konteks (game diutamakan, ctx sebagai fallback) -------
  const lang = () => S.game?.state?.lang
    ?? (typeof ctx.lang === 'function' ? ctx.lang() : ctx.lang) ?? 'id';
  const T = (key, vars) => (ctx.t ? ctx.t(key, lang(), vars || {}) : i18nT(key, lang(), vars || {}));
  const toast = (msg) => {
    try {
      if (S.game?.ui?.toast) S.game.ui.toast(msg);
      else if (ctx.toast) ctx.toast(msg);
    } catch (e) { /* toast tidak boleh mematikan game */ }
  };
  const sfx = (name) => {
    try {
      if (S.game?.sfx?.play) S.game.sfx.play(name);
      else if (ctx.sfx?.play) ctx.sfx.play(name);
    } catch (e) { /* abaikan */ }
  };
  const coins = () => (S.game?.state ? S.game.state.coins : 0);
  const addCoins = (n) => {
    if (S.game?.addCoins) { S.game.addCoins(n); return; }
    if (S.game?.state) {
      S.game.state.coins = Math.max(0, S.game.state.coins + n);
      if (S.game.save) S.game.save();
    }
  };
  const broadcast = (type, data) => {
    try { if (ctx.broadcast) ctx.broadcast(type, data); } catch (e) { /* abaikan */ }
  };
  // Teks skor rival BOT — bilingual inline (tanpa key i18n baru: i18n.js
  // bukan file lane ini; koordinator boleh memindahkannya ke key
  // gameRival/gameRivalBeat/gameRivalTie bila mau).
  const rivalLine = (id) => (lang() === 'en'
    ? `Rival BOT score: ${NM_RIVAL[id]} — beat it!`
    : `Skor rival BOT: ${NM_RIVAL[id]} — kalahkan!`);
  const rivalBeatLine = (tie) => (lang() === 'en'
    ? (tie ? 'You tied the BOT rival score!' : 'You beat the BOT rival score!')
    : (tie ? 'Kamu menyamai skor rival BOT!' : 'Kamu mengalahkan skor rival BOT!'));

  // ---------- Animasi 3D ---------------------------------------------------
  function localPoint(stall, x, y, z) {
    return stall.shell.group.localToWorld(new THREE.Vector3(x, y, z));
  }
  function flyProjectile(mesh, p0, p1, peak, dur, onLand) {
    mesh.position.copy(p0);
    group.add(mesh);
    S.anims.push({ kind: 'proj', mesh, p0, p1, peak, t: 0, dur, onLand });
  }
  function ringMesh(color) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 20), stdMat(THREE, color));
    m.castShadow = true;
    return m;
  }
  function ballMesh(color, r = 0.17) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), stdMat(THREE, color, { roughness: 0.5 }));
    m.castShadow = true;
    return m;
  }
  function resetStallVisuals(stall) {
    const { refs } = stall;
    (refs.balloons || []).forEach((b) => { b.visible = true; b.scale.set(1, 1.15, 1); });
    (refs.cans || []).forEach((c) => {
      c.position.copy(c.userData.home);
      c.rotation.set(0, 0, 0);
      c.userData.down = false;
    });
    (refs.ducks || []).forEach((d) => { d.visible = true; d.scale.set(1, 1, 1); });
    (refs.coins || []).forEach((c) => { c.visible = true; c.scale.set(1, 1, 1); c.position.copy(c.userData.home); });
    (refs.landedRings || []).forEach((r) => { stall.shell.group.remove(r); });
    refs.landedRings = [];
    if (refs.hook) refs.hook.position.y = refs.hook.userData.baseY;
  }
  function reactToThrow(stall, id, res, skill) {
    const { refs } = stall;
    const aimX = ((S.aim.pos - 50) / 50) * 1.1; // -1.1..1.1, dari posisi bidik
    switch (id) {
      case 'ring': {
        const pegIdx = clamp(Math.round((aimX + 0.8) / 0.8), 0, 2);
        const peg = refs.pegs[pegIdx];
        const p0 = localPoint(stall, 0, 1.7, 1.9);
        if (res.hit) {
          const p1 = localPoint(stall, peg.position.x, 1.85, -0.1);
          flyProjectile(ringMesh(0xff5c8a), p0, p1, 1.1, 0.55, () => {
            const landed = ringMesh(0xff5c8a);
            landed.position.set(peg.position.x, 1.62, -0.1);
            landed.rotation.x = Math.PI / 2;
            stall.shell.group.add(landed);
            (refs.landedRings = refs.landedRings || []).push(landed);
          });
        } else {
          const p1 = localPoint(stall, aimX, 0.35, 1.4);
          flyProjectile(ringMesh(0xff5c8a), p0, p1, 1.1, 0.55, null);
        }
        break;
      }
      case 'dart': {
        const p0 = localPoint(stall, 0, 1.7, 1.9);
        const dart = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.4, 8), stdMat(THREE, 0xdddddd, { metalness: 0.5, roughness: 0.4 }));
        dart.rotation.x = Math.PI / 2;
        if (res.hit) {
          const bi = clamp(Math.round((aimX + 0.9) / 0.45), 0, refs.balloons.length - 1);
          const b = refs.balloons[bi];
          const p1 = localPoint(stall, b.position.x, b.position.y, b.position.z + 0.1);
          flyProjectile(dart, p0, p1, 0.4, 0.35, () => {
            S.anims.push({ kind: 'pop', mesh: b, t: 0, dur: 0.18 });
          });
        } else {
          const p1 = localPoint(stall, aimX, 2.0 + (Math.random() - 0.5) * 0.6, -0.5);
          flyProjectile(dart, p0, p1, 0.4, 0.35, null);
        }
        break;
      }
      case 'basket': {
        const p0 = localPoint(stall, 0, 1.7, 1.9);
        const ball = ballMesh(0xff9f1c);
        if (res.hit) {
          const p1 = localPoint(stall, 0, 2.45, -0.2);
          flyProjectile(ball, p0, p1, 1.6, 0.6, () => {
            S.anims.push({ kind: 'sink', mesh: ball, t: 0, dur: 0.35, fromY: ball.position.y });
          });
        } else {
          const p1 = localPoint(stall, aimX * 0.8, 0.35, 0.9);
          flyProjectile(ball, p0, p1, 1.6, 0.6, null);
        }
        break;
      }
      case 'shoot': {
        const p0 = localPoint(stall, 0, 1.7, 1.9);
        const tracer = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0xffb340 }));
        const tgt = refs.targets[clamp(Math.round((aimX + 0.8) / 0.8), 0, 2)];
        const p1 = res.hit
          ? localPoint(stall, tgt.position.x, tgt.position.y, tgt.position.z + 0.1)
          : localPoint(stall, tgt.position.x + 0.55, tgt.position.y + 0.2, -0.44);
        flyProjectile(tracer, p0, p1, 0.05, 0.16, () => {
          if (res.hit) S.anims.push({ kind: 'spinTarget', mesh: tgt, t: 0, dur: 0.45 });
        });
        break;
      }
      case 'cans': {
        const p0 = localPoint(stall, 0, 1.7, 1.9);
        const ball = ballMesh(0x2fbf4a, 0.15);
        const p1 = localPoint(stall, 0, 1.5, -0.1);
        flyProjectile(ball, p0, p1, 0.9, 0.45, () => {
          for (const i of res.newly || []) {
            const can = refs.cans[i];
            if (!can) continue;
            can.userData.down = true;
            S.anims.push({ kind: 'fallCan', mesh: can, t: 0, dur: 0.5, dir: (i % 2 === 0 ? 1 : -1) });
          }
        });
        break;
      }
      case 'duck': {
        const hook = refs.hook;
        if (!hook) break;
        S.anims.push({
          kind: 'hook', mesh: hook, t: 0, dur: 1.7, caught: res.caught, type: res.type,
          duck: res.caught ? refs.ducks.find((d) => (res.type === 'gold') === d.userData.gold)
            || refs.ducks[0] : null,
          stall,
        });
        if (res.caught) sfx('splash');
        break;
      }
      case 'wheel': {
        const wheel = refs.wheel;
        const targetDeg = 90 - (res.segment + 0.5) * 45;
        const target = (targetDeg * Math.PI) / 180;
        const cur = wheel.rotation.z;
        const twoPi = Math.PI * 2;
        const delta = (((target - cur) % twoPi) + twoPi) % twoPi;
        S.anims.push({
          kind: 'spin', mesh: wheel, t: 0, dur: 2.4,
          from: cur, to: cur + delta + twoPi * 3, onDone: () => endRound(),
        });
        break;
      }
      case 'pusher': {
        const p0 = localPoint(stall, 0, 2.6, 0.6);
        const coin = cyl(THREE, group, 0.22, 0.22, 0.06, 0xffb340, 0, 0, 0,
          { metalness: 0.6, roughness: 0.3 }, 16);
        const p1 = localPoint(stall, aimX * 0.7, 1.5, 0.3);
        flyProjectile(coin, p0, p1, 0.15, 0.5, () => {
          group.remove(coin);
          const falling = (refs.coins || []).filter((c) => c.visible).slice(0, res.fallen);
          falling.forEach((c, i) => {
            S.anims.push({ kind: 'coinFall', mesh: c, t: 0, dur: 0.6 + i * 0.12 });
          });
        });
        break;
      }
      default:
        break;
    }
  }

  // ---------- Panel DOM ----------------------------------------------------
  const panel = buildPanel();

  function buildPanel() {
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const overlay = el('div', 'nm-modal hidden');
    overlay.id = 'nm-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'nm-title');
    const boxEl = el('div', 'panel nm-panel');
    const title = el('h2'); title.id = 'nm-title';
    const cost = el('p', 'nm-cost'); cost.id = 'nm-cost';
    const how = el('p', 'nm-how'); how.id = 'nm-how';
    const rival = el('p', 'nm-how'); rival.id = 'nm-rival';
    const aim = el('div', 'nm-aim hidden'); aim.id = 'nm-aim';
    const track = el('div', 'nm-aim-track'); track.id = 'nm-aim-track';
    track.setAttribute('tabindex', '0');
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Bidik');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const band = el('div', 'nm-aim-band'); band.id = 'nm-aim-band';
    const dotsWrap = el('div', 'nm-aim-dots'); dotsWrap.id = 'nm-aim-dots';
    const marker = el('div', 'nm-aim-marker'); marker.id = 'nm-aim-marker';
    track.append(band, dotsWrap, marker);
    const aimHint = el('p', 'nm-aim-hint'); aimHint.id = 'nm-aim-hint';
    aim.append(track, aimHint);
    const status = el('p', 'nm-status'); status.id = 'nm-status';
    status.setAttribute('aria-live', 'polite');
    const result = el('p', 'nm-result'); result.id = 'nm-result';
    result.setAttribute('aria-live', 'polite');
    const btns = el('div', 'row-btns nm-btns');
    const playBtn = el('button', 'primary-btn'); playBtn.id = 'nm-play'; playBtn.type = 'button';
    const actionBtn = el('button', 'primary-btn nm-action-btn hidden');
    actionBtn.id = 'nm-action'; actionBtn.type = 'button';
    const closeBtn = el('button', 'primary-btn secondary'); closeBtn.id = 'nm-close'; closeBtn.type = 'button';
    btns.append(playBtn, actionBtn, closeBtn);
    boxEl.append(title, cost, how, rival, aim, status, result, btns);
    overlay.append(boxEl);
    document.body.appendChild(overlay);

    const $ = (id) => document.getElementById(id);
    playBtn.addEventListener('click', () => startRound());
    actionBtn.addEventListener('click', () => onActionPress());
    closeBtn.addEventListener('click', () => closePanel());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });

    // Bidik: seret penanda di trek (mouse/sentuh) atau tombol panah (keyboard).
    let dragging = false;
    const setFromEvent = (e) => {
      const r = track.getBoundingClientRect();
      S.aim.pos = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
      S.aim.pausedUntil = performance.now() + 2000;
      syncAimDom();
    };
    track.addEventListener('pointerdown', (e) => {
      dragging = true;
      track.setPointerCapture(e.pointerId);
      setFromEvent(e);
    });
    track.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
    track.addEventListener('pointerup', () => { dragging = false; });
    track.addEventListener('pointercancel', () => { dragging = false; });
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        S.aim.pos = clamp(S.aim.pos + (e.key === 'ArrowRight' ? 4 : -4), 0, 100);
        S.aim.pausedUntil = performance.now() + 2000;
        syncAimDom();
      }
    });
    return { overlay, title, cost, how, rival, aim, track, band, dotsWrap, marker, aimHint, status, result, playBtn, actionBtn, closeBtn, $ };
  }

  function syncAimDom() {
    const p = panel;
    p.marker.style.left = `${S.aim.pos}%`;
    p.track.setAttribute('aria-valuenow', String(Math.round(S.aim.pos)));
    const dots = p.dotsWrap.querySelectorAll('.nm-aim-dot');
    dots.forEach((d, i) => { d.style.left = `${S.aim.dots[i] ?? 50}%`; });
  }
  function aimModeFor(id) {
    if (id === 'duck' || id === 'shoot') return 'dots';
    if (id === 'wheel') return 'none';
    return 'center';
  }
  function actionLabelFor(id) {
    if (id === 'shoot') return T('gameShootBtn');
    if (id === 'duck') return T('gameFish');
    if (id === 'wheel') return T('gameSpin');
    if (id === 'pusher') return T('gameDrop');
    return T('gameThrow');
  }
  function updateStatus() {
    const o = S.open;
    if (!o) return;
    const hits = o.throws.filter((x) => x.hit || x.caught || (x.newly && x.newly.length)).length;
    panel.status.textContent = `${T('gameLeft', { n: o.throwsLeft })} • ${T('gameScore', { n: hits })} • ${T('gameCoinsNow', { n: coins() })}`;
  }

  function openPanel(id, game) {
    S.game = game;
    if (S.open && S.open.id === id) { closePanel(); return true; }
    if (S.open) closePanel();
    const def = NM_DEF[id];
    if (!def) return false;
    if (coins() < def.cost) {
      sfx('error');
      toast(T('needCoins'));
      return false;
    }
    S.open = { id, game, phase: 'idle', throwsLeft: 0, throws: [], st: {}, prize: 0, round: 0 };
    S.aim.pos = 50; S.aim.dots = []; S.aim.dotsOverride = false;
    panel.title.textContent = T(def.labelKey);
    panel.cost.textContent = T('gameCost', { n: def.cost });
    panel.how.textContent = T('gameHow' + id[0].toUpperCase() + id.slice(1));
    panel.rival.textContent = rivalLine(id);
    panel.status.textContent = '';
    panel.result.textContent = '';
    panel.aim.classList.add('hidden');
    panel.actionBtn.classList.add('hidden');
    panel.playBtn.classList.remove('hidden');
    panel.playBtn.textContent = T('gamePlay');
    panel.closeBtn.textContent = T('close');
    panel.overlay.classList.remove('hidden');
    return true;
  }

  function closePanel() {
    if (S.pendingEnd) { clearTimeout(S.pendingEnd); S.pendingEnd = null; }
    S.open = null;
    panel.overlay.classList.add('hidden');
  }

  function startRound() {
    const o = S.open;
    if (!o || o.phase === 'playing') return;
    const def = NM_DEF[o.id];
    if (coins() < def.cost) {
      sfx('error');
      toast(T('needCoins'));
      closePanel();
      return;
    }
    addCoins(-def.cost);
    sfx('click');
    o.phase = 'playing';
    o.round += 1;
    o.throwsLeft = CFG[o.id].throws;
    o.throws = [];
    o.st = {};
    o.prize = 0;
    S.aim.pos = 50; S.aim.dots = []; S.aim.dotsOverride = false;
    resetStallVisuals(S.stalls.get(o.id));
    const mode = aimModeFor(o.id);
    S.aim.mode = mode;
    if (mode === 'none') {
      panel.aim.classList.add('hidden');
    } else {
      panel.aim.classList.remove('hidden');
      panel.band.style.display = mode === 'center' ? 'block' : 'none';
      panel.aimHint.textContent = T('gameAimHint');
      // Titik sasaran (bebek/sasaran) — 1 titik untuk shoot, 3 untuk duck.
      panel.dotsWrap.textContent = '';
      if (mode === 'dots') {
        const n = o.id === 'duck' ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const d = document.createElement('div');
          d.className = 'nm-aim-dot';
          panel.dotsWrap.appendChild(d);
        }
        S.aim.dots = new Array(n).fill(50);
      }
      syncAimDom();
    }
    panel.result.textContent = '';
    panel.playBtn.classList.add('hidden');
    panel.actionBtn.classList.remove('hidden');
    panel.actionBtn.disabled = false;
    panel.actionBtn.textContent = actionLabelFor(o.id);
    updateStatus();
  }

  function onActionPress() {
    const o = S.open;
    if (!o || o.phase !== 'playing' || o.throwsLeft <= 0) return;
    const stall = S.stalls.get(o.id);
    const skill = skillFromAim(S.aim.pos, S.aim.mode, S.aim.dots);
    const res = playThrow(o.id, Math.random, skill, o.st);
    o.throws.push(res);
    o.prize += res.prize;
    o.throwsLeft -= 1;
    reactToThrow(stall, o.id, res, skill);
    if (res.prize > 0 || res.hit || res.caught) sfx('plant');
    else sfx('click');
    updateStatus();
    if (o.throwsLeft <= 0) {
      panel.actionBtn.disabled = true;
      if (o.id === 'wheel') return; // endRound dipanggil saat roda berhenti
      S.pendingEnd = setTimeout(() => { S.pendingEnd = null; endRound(); }, o.id === 'duck' ? 1900 : 900);
    }
  }

  function endRound() {
    const o = S.open;
    if (!o || o.phase !== 'playing') return;
    o.phase = 'done';
    o.prize += roundBonus(o.id, o.throws, o.st);
    const def = NM_DEF[o.id];
    const win = o.prize > 0;
    panel.actionBtn.classList.add('hidden');
    panel.playBtn.classList.remove('hidden');
    panel.playBtn.textContent = T('gamePlayAgain');
    if (win) {
      addCoins(o.prize);
      panel.result.textContent = T('gameWin', { n: o.prize });
      if (o.prize > NM_RIVAL[o.id]) panel.result.textContent += ' ' + rivalBeatLine(false);
      else if (o.prize === NM_RIVAL[o.id]) panel.result.textContent += ' ' + rivalBeatLine(true);
      sfx('coin');
      if (o.prize >= 25) sfx('harvest');
      lhSfx(o.prize >= 25 ? 'DUAR!' : 'YEAY!'); // momen perayaan: menang ronde
      toast(T('gameWin', { n: o.prize }));
    } else {
      panel.result.textContent = T('gameLose');
      sfx('click');
      toast(T('gameLose'));
    }
    updateStatus();
    broadcast('game_result', { game: o.id, win, prize: o.prize, cost: def.cost });
    handle.debug.lastResult = { id: o.id, win, prize: o.prize, cost: def.cost };
  }

  // ---------- update (dipanggil tiap frame dari loop utama) ----------------
  function update(dt, t, game) {
    if (game) S.game = game;
    const now = performance.now();
    // Animasi idle tiap stan.
    for (const stall of S.stalls.values()) {
      const { refs, shell } = stall;
      (refs.balloons || []).forEach((b) => {
        b.position.y = b.userData.baseY + 0.06 * Math.sin(t * 1.4 + b.userData.phase);
      });
      (refs.ducks || []).forEach((d) => {
        if (!d.visible) return;
        d.userData.angle += dt * 0.22;
        const a = d.userData.angle;
        d.position.set(Math.cos(a) * 0.55, 1.28, 0.1 + Math.sin(a) * 0.45);
        d.rotation.y = -a;
      });
      (refs.targets || []).forEach((tg) => {
        tg.position.x = tg.userData.baseX + 0.55 * Math.sin(t * 0.9 + tg.userData.phase);
      });
      if (refs.wheel && !S.anims.some((a) => a.kind === 'spin' && a.mesh === refs.wheel)) {
        refs.wheel.rotation.z += dt * 0.05;
      }
      if (refs.pusherBlock) {
        refs.pusherBlock.position.z = refs.pusherBlock.userData.baseZ + 0.22 * Math.sin(t * 1.1);
      }
      shell.lamps.forEach((lamp, i) => {
        lamp.material.emissiveIntensity = 1.3 + 0.25 * Math.sin(t * 6 + i * 2);
      });
    }
    // Animasi aktif.
    for (let i = S.anims.length - 1; i >= 0; i--) {
      const a = S.anims[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      switch (a.kind) {
        case 'proj': {
          const { p0, p1 } = a;
          const x = p0.x + (p1.x - p0.x) * k;
          const y = p0.y + (p1.y - p0.y) * k + a.peak * 4 * k * (1 - k);
          const z = p0.z + (p1.z - p0.z) * k;
          a.mesh.position.set(x, y, z);
          if (k >= 1) {
            group.remove(a.mesh);
            if (a.onLand) a.onLand();
            S.anims.splice(i, 1);
          }
          break;
        }
        case 'pop': {
          const s = Math.max(0.01, 1 - k);
          a.mesh.scale.set(s, s * 1.15, s);
          if (k >= 1) { a.mesh.visible = false; S.anims.splice(i, 1); }
          break;
        }
        case 'sink': {
          a.mesh.position.y = a.fromY - k * 0.9;
          if (k >= 1) { group.remove(a.mesh); S.anims.splice(i, 1); }
          break;
        }
        case 'spinTarget': {
          a.mesh.rotation.z = k * Math.PI * 2;
          if (k >= 1) { a.mesh.rotation.z = 0; S.anims.splice(i, 1); }
          break;
        }
        case 'fallCan': {
          a.mesh.rotation.z = k * (Math.PI / 2) * a.dir;
          a.mesh.position.x = a.mesh.userData.home.x + a.dir * k * 0.5;
          a.mesh.position.y = a.mesh.userData.home.y - k * 0.15;
          if (k >= 1) S.anims.splice(i, 1);
          break;
        }
        case 'hook': {
          // Turun (0-0.5) → jeda di air → naik (0.65-1). Bebek ikut naik bila kena.
          const baseY = a.mesh.userData.baseY;
          let y;
          if (k < 0.5) y = baseY - (k / 0.5) * 1.05;
          else if (k < 0.65) y = baseY - 1.05;
          else y = baseY - 1.05 + ((k - 0.65) / 0.35) * 1.05;
          a.mesh.position.y = y;
          if (a.caught && a.duck) {
            a.duck.visible = true;
            const lift = k < 0.5 ? 0 : Math.min(1, (k - 0.5) / 0.5);
            a.duck.position.set(0, 1.28 + lift * 1.1, 0.1);
            if (k >= 0.95) a.duck.scale.setScalar(Math.max(0.01, 1 - (k - 0.95) / 0.05));
          }
          if (k >= 1) {
            a.mesh.position.y = baseY;
            if (a.duck) { a.duck.visible = false; }
            S.anims.splice(i, 1);
          }
          break;
        }
        case 'spin': {
          const e = 1 - (1 - k) ** 3; // easeOutCubic
          a.mesh.rotation.z = a.from + (a.to - a.from) * e;
          if (k >= 1) { S.anims.splice(i, 1); if (a.onDone) a.onDone(); }
          break;
        }
        case 'coinFall': {
          a.mesh.position.z += dt * 1.4;
          a.mesh.position.y -= dt * 1.2;
          if (k >= 1) { a.mesh.visible = false; S.anims.splice(i, 1); }
          break;
        }
        default:
          S.anims.splice(i, 1);
          break;
      }
    }
    // Penanda bidik + titik sasaran (wall-clock — jalan dalam waktu nyata
    // walau frame lambat di headless).
    if (S.open && S.open.phase === 'playing' && S.aim.mode !== 'none') {
      if (now > S.aim.pausedUntil) {
        S.aim.pos = 50 + 42 * Math.sin(now * 0.0021);
      }
      if (S.aim.mode === 'dots' && !S.aim.dotsOverride) {
        S.aim.dots = S.aim.dots.map((_, i) => 50 + 36 * Math.sin(now * (S.open.id === 'duck' ? 0.0008 : 0.0012) + i * 2.1));
      }
      syncAimDom();
    }
  }

  function onUse(id, game) {
    return openPanel(id, game);
  }

  const handle = {
    colliders,
    interactables,
    _group: group,
    update,
    onUse,
    debug: {
      lastResult: null,
      setAim(v) { S.aim.pos = clamp(v, 0, 100); S.aim.pausedUntil = performance.now() + 5000; syncAimDom(); },
      setDots(arr) { S.aim.dots = [...arr]; S.aim.dotsOverride = true; syncAimDom(); },
      state() {
        return {
          open: S.open?.id ?? null,
          phase: S.open?.phase ?? null,
          throwsLeft: S.open?.throwsLeft ?? 0,
          prize: S.open?.prize ?? 0,
          aimPos: S.aim.pos,
          coins: coins(),
        };
      },
      stallCount: S.stalls.size,
    },
  };
  return handle;
}
