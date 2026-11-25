// nm-food.js — Lane F: 11 jajanan pasar malam (kolom timur x=92, z -20..20).
// Restyle visual Lane D (anime overhaul, 25 Nov 2026): semua permukaan
// MeshToonMaterial + gradientMap 4-step (cel), palet langit/sakura/
// matahari PRODUCT.md, papan nama display rounded + outline tinta, pipi
// merona di penjual, SFX khas lembah ("HAP!") + burst kelopak saat makan.
// Harga, buff, teks, koordinat, perilaku TIDAK berubah.
// Stan berdiri di atas terrain per stan (terrainHeight — zona Lane P belum
// ada di branch ini, jadi TIDAK ada asumsi tanah datar). Semua prosedural
// dari kode (Three.js primitif + tekstur canvas papan nama), tanpa aset luar.
//
// Kontrak wiring (koordinator, main.js — file ini TIDAK menyentuh main.js):
//   import { buildNightMarketFood } from './nm-food.js';
//   const nm = buildNightMarketFood(scene, THREE, {
//     t, lang: state.lang, toast: (m) => ui.toast(m), sfx,
//   });
//   world.colliders.push(...nm.colliders);            // AABB tiap stan
//   // di updateInteraction: cari nm.interactables terdekat (r 2.8) ->
//   //   ctx = { type: 'food', id, label: t(food.labelKey, lang) }
//   // di doAction: case 'food': nm.onUse(ctx.id, game)
//   // di loop (tiap frame, saat started & tidak tidur): nm.update(dt, t, game)
//   // Buff dibaca dari game.buffs = { speedMul, jumpMul, swimMul } — modul
//   // ini yang menulisnya (applyFoodBuff + update saat expire); player.js
//   // tinggal mengalikan MAX_SPEED / JUMP_VELOCITY / kecepatan renang
//   // dengan nilai itu. Buff TRANSIENT: tidak masuk save (hilang saat reload).
// Yang modul ini panggil dari `game` (lihat laporan untuk daftar persis):
//   game.state.coins (baca + kurangi), game.state.lang, game.player.{x,y,z}
//   + game.player.group.position (target animasi makan), game.ui.toast,
//   game.ui.updateHUD(game.state), game.sfx.play(name), game.save() (opsional),
//   game.buffs (ditulis modul, dibaca wiring pemain).
import { terrainHeight } from './physics.js';
import { t as i18nT } from './i18n.js';

// ---- Katalog: harga 8–25 koin. Buff hanya untuk 7 dari 11 — sisanya
// kenyang saja (jajan = hiburan, bukan mesin buff murah). Lihat laporan
// untuk rasional tiap angka. buff: null = tanpa buff.
export const FOODS = [
  { id: 'gulali',      x: 92, z: -20, price: 8,  buff: null, labelKey: 'foodGulali',      descKey: 'foodGulaliDesc' },
  { id: 'rambutNenek', x: 92, z: -16, price: 10, buff: null, labelKey: 'foodRambutNenek', descKey: 'foodRambutNenekDesc' },
  { id: 'arumManis',   x: 92, z: -12, price: 10, buff: null, labelKey: 'foodArumManis',   descKey: 'foodArumManisDesc' },
  { id: 'telurGulung', x: 92, z: -8,  price: 12, buff: { speedMul: 1.05, durSec: 30 }, labelKey: 'foodTelurGulung', descKey: 'foodTelurGulungDesc' },
  { id: 'sosisBakar',  x: 92, z: -4,  price: 20, buff: { speedMul: 1.15, durSec: 60 }, labelKey: 'foodSosisBakar',  descKey: 'foodSosisBakarDesc' },
  { id: 'takoyaki',    x: 92, z: 0,   price: 18, buff: { swimMul: 1.30, durSec: 60 },  labelKey: 'foodTakoyaki',    descKey: 'foodTakoyakiDesc' },
  { id: 'martabakMini', x: 92, z: 4,  price: 15, buff: { speedMul: 1.05, durSec: 30 }, labelKey: 'foodMartabakMini', descKey: 'foodMartabakMiniDesc' },
  { id: 'jagungBakar', x: 92, z: 8,   price: 15, buff: { speedMul: 1.10, durSec: 90 }, labelKey: 'foodJagungBakar', descKey: 'foodJagungBakarDesc' },
  { id: 'sempolAyam',  x: 92, z: 12,  price: 15, buff: { jumpMul: 1.15, durSec: 60 },  labelKey: 'foodSempolAyam',  descKey: 'foodSempolAyamDesc' },
  { id: 'jasuke',      x: 92, z: 16,  price: 12, buff: { speedMul: 1.10, jumpMul: 1.10, durSec: 45 }, labelKey: 'foodJasuke', descKey: 'foodJasukeDesc' },
  { id: 'esKrim',      x: 92, z: 20,  price: 25, buff: { jumpMul: 1.25, durSec: 45 },  labelKey: 'foodEsKrim',      descKey: 'foodEsKrimDesc' },
];

// Visual per stan (di luar FOODS — bukan bagian kontrak data).
const VISUALS = {
  gulali:      { accent: 0xff5c8a, shirt: 0xff5c8a },
  rambutNenek: { accent: 0xfffdf2, shirt: 0x3fa9f5 },
  arumManis:   { accent: 0xff8fb3, shirt: 0xff8fb3 },
  telurGulung: { accent: 0xff9f1c, shirt: 0x2fbf4a },
  sosisBakar:  { accent: 0x8a4b2a, shirt: 0x8a4b2a },
  takoyaki:    { accent: 0xff5c8a, shirt: 0x2fbf4a },
  martabakMini: { accent: 0xff9f1c, shirt: 0xff9f1c },
  jagungBakar: { accent: 0xffc93c, shirt: 0xffc93c },
  sempolAyam:  { accent: 0xff9f1c, shirt: 0x6e4a26 },
  jasuke:      { accent: 0xffc93c, shirt: 0xffc93c },
  esKrim:      { accent: 0xff8fb3, shirt: 0xff8fb3 },
};

// ---- Cel/toon anime (Lane D restyle, PRODUCT.md § Dunia 3D) ----
// Semua permukaan MeshToonMaterial + gradientMap 4-step.
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
// asap/shard Sakuga. Hanya di momen makan (satu authored moment per beli).
// Mati bila prefers-reduced-motion.
const LH_REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
function lhFxCss() {
  if (typeof document === 'undefined' || document.getElementById('lh-fx-style-food')) return;
  const st = document.createElement('style');
  st.id = 'lh-fx-style-food';
  st.textContent = '.lh-sfx-nm{position:fixed;left:50%;top:38%;z-index:60;pointer-events:none;font-family:"Arial Rounded MT Bold","Hiragino Maru Gothic ProN","Hiragino Sans","Trebuchet MS",system-ui,sans-serif;font-weight:800;font-style:italic;font-size:clamp(34px,6vw,52px);letter-spacing:.02em;color:#ffc93c;-webkit-text-stroke:2px #1d2b53;text-shadow:4px 4px 0 rgba(29,43,83,.9);transform:translate(-50%,-50%) rotate(-6deg);animation:lh-sfx-nm-pop .9s cubic-bezier(.34,1.56,.64,1) forwards}'
    + '@keyframes lh-sfx-nm-pop{0%{transform:translate(-50%,-50%) scale(.35) rotate(-12deg);opacity:0}25%{opacity:1;transform:translate(-50%,-50%) scale(1.18) rotate(-3deg)}55%{transform:translate(-50%,-50%) scale(1) rotate(-6deg);opacity:1}100%{transform:translate(-50%,-62%) scale(1.04) rotate(-6deg);opacity:0}}'
    + '.lh-petal{position:fixed;z-index:60;pointer-events:none;animation:lh-petal-fly .9s ease-out forwards}'
    + '@keyframes lh-petal-fly{to{transform:translate(var(--dx,0px),var(--dy,-60px)) rotate(var(--rot,180deg)) scale(.55);opacity:0}}'
    + '#nm-food-modal .primary-btn:active{transform:scale(.93)}'
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

// ---- State buff (transient, module-level: satu game per halaman; TIDAK
// pernah ditulis ke save, hilang saat reload — sesuai spek).
const _active = new Map(); // id -> { food, remain }
let _buffsDirty = true;

export function getBuffMultipliers() {
  let speedMul = 1, jumpMul = 1, swimMul = 1;
  for (const { food } of _active.values()) {
    const b = food.buff;
    if (!b) continue;
    if (b.speedMul) speedMul = Math.max(speedMul, b.speedMul);
    if (b.jumpMul) jumpMul = Math.max(jumpMul, b.jumpMul);
    if (b.swimMul) swimMul = Math.max(swimMul, b.swimMul);
  }
  return { speedMul, jumpMul, swimMul };
}

export function getActiveBuffs() {
  const out = [];
  for (const [id, { food, remain }] of _active) {
    out.push({
      id, labelKey: food.labelKey,
      speedMul: food.buff?.speedMul ?? 1,
      jumpMul: food.buff?.jumpMul ?? 1,
      swimMul: food.buff?.swimMul ?? 1,
      remainSec: Math.max(0, Math.ceil(remain)),
    });
  }
  out.sort((a, b) => a.remainSec - b.remainSec);
  return out;
}

// Terapkan/refresh buff sejenis (tidak stack berlipat: makan ulang jenis
// yang sama hanya me-refresh durasi; beda jenis se-kanal ambil nilai max).
export function applyFoodBuff(game, foodId) {
  const food = FOODS.find((f) => f.id === foodId);
  if (!food || !food.buff) return false;
  _active.set(foodId, { food, remain: food.buff.durSec });
  _buffsDirty = true;
  if (game) game.buffs = getBuffMultipliers();
  return true;
}

function _tickBuffs(dt, game) {
  if (_active.size === 0) {
    if (_buffsDirty && game) { game.buffs = getBuffMultipliers(); _buffsDirty = false; }
    return;
  }
  let changed = false;
  for (const [id, e] of _active) {
    e.remain -= dt;
    if (e.remain <= 0) { _active.delete(id); changed = true; }
  }
  if (changed || _buffsDirty) {
    _buffsDirty = false;
    if (game) game.buffs = getBuffMultipliers();
  }
}

export function buildNightMarketFood(scene, THREE, ctx = {}) {
  const tt = (k, lang, vars) => (ctx.t ? ctx.t(k, lang, vars) : i18nT(k, lang, vars));
  const langOf = (game) => (game && game.state && game.state.lang) || ctx.lang || 'id';
  const say = (game, msg) => {
    if (game && game.ui && typeof game.ui.toast === 'function') game.ui.toast(msg);
    else if (typeof ctx.toast === 'function') ctx.toast(msg);
  };
  const sfx = (game, name) => {
    if (game && game.sfx && typeof game.sfx.play === 'function') game.sfx.play(name);
    else if (ctx.sfx && typeof ctx.sfx.play === 'function') ctx.sfx.play(name);
  };
  const lam = (color) => new THREE.MeshToonMaterial({ color, gradientMap: toonGrad(THREE) });
  const mesh = (geo, color) => new THREE.Mesh(geo, lam(color));

  const group = new THREE.Group();
  group.name = 'night-market-food';
  const colliders = [];
  const interactables = [];
  const smokes = []; // { mesh, baseY, phase }
  let time = 0;
  let eating = null; // { food, mesh, t, from: Vector3, game }
  let panel = null; // { root, title, desc, effect, price, coins, buy, cancel }
  let panelFood = null;
  let panelGame = null;
  let buffBar = null;
  let buffBarTimer = 0;
  let lastBuffBarText = '';

  // ---------- Model makanan prosedural (di atas meja stan) ----------
  function foodDisplay(id) {
    const g = new THREE.Group();
    const stick = () => mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), 0xd8c08d);
    switch (id) {
      case 'gulali': {
        const s = stick(); s.rotation.z = Math.PI / 2; s.position.y = 0.05; g.add(s);
        const puff = mesh(new THREE.SphereGeometry(0.22, 10, 8), 0xff5c8a);
        puff.position.set(0.28, 0.12, 0); puff.scale.y = 0.85; g.add(puff);
        const puff2 = mesh(new THREE.SphereGeometry(0.14, 8, 6), 0xff8fb3);
        puff2.position.set(0.14, 0.24, 0.08); g.add(puff2);
        break;
      }
      case 'rambutNenek': {
        const tray = mesh(new THREE.BoxGeometry(0.6, 0.06, 0.4), 0xfffdf2);
        tray.position.y = 0.03; g.add(tray);
        for (const [dx, dz, r] of [[-0.14, 0, 0.16], [0.12, 0.08, 0.15], [0.05, -0.1, 0.13]]) {
          const b = mesh(new THREE.SphereGeometry(r, 8, 6), 0xffffff);
          b.position.set(dx, 0.14, dz); b.scale.y = 0.7; g.add(b);
        }
        break;
      }
      case 'arumManis': {
        const s = stick(); s.position.y = -0.12; g.add(s);
        const cone = mesh(new THREE.ConeGeometry(0.2, 0.45, 10), 0xff8fb3);
        cone.position.y = 0.28; g.add(cone);
        const tip = mesh(new THREE.SphereGeometry(0.09, 8, 6), 0xf2c4d4);
        tip.position.y = 0.5; g.add(tip);
        break;
      }
      case 'telurGulung': {
        const s = stick(); s.rotation.z = Math.PI / 2; s.position.set(-0.1, 0.05, 0); g.add(s);
        const roll = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10), 0xffc93c);
        roll.rotation.z = Math.PI / 2; roll.position.set(0.2, 0.1, 0); g.add(roll);
        const roll2 = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.42, 10), 0xff9f1c);
        roll2.rotation.z = Math.PI / 2; roll2.position.set(0.2, 0.1, 0.14); g.add(roll2);
        break;
      }
      case 'sosisBakar': {
        const grill = mesh(new THREE.BoxGeometry(0.7, 0.08, 0.42), 0x3a2e22);
        grill.position.y = 0.04; g.add(grill);
        for (let i = -1; i <= 1; i++) {
          const ssg = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8), 0x8a4b2a);
          ssg.rotation.z = Math.PI / 2; ssg.position.set(0, 0.12, i * 0.13); g.add(ssg);
        }
        // Asap: 3 gumpalan, dianimasikan di update().
        for (let i = 0; i < 3; i++) {
          const p = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5),
            new THREE.MeshToonMaterial({ color: 0xfff6e5, transparent: true, opacity: 0.6, gradientMap: toonGrad(THREE) }));
          p.position.set(-0.15 + i * 0.15, 0.3, 0);
          g.add(p);
          smokes.push({ mesh: p, baseY: 0.3, phase: i / 3 });
        }
        break;
      }
      case 'takoyaki': {
        const tray = mesh(new THREE.BoxGeometry(0.62, 0.08, 0.42), 0x8a6b3f);
        tray.position.y = 0.04; g.add(tray);
        for (const [dx, dz] of [[-0.16, -0.09], [0.16, -0.09], [-0.16, 0.09], [0.16, 0.09]]) {
          const b = mesh(new THREE.SphereGeometry(0.11, 8, 6), 0xa0662e);
          b.position.set(dx, 0.15, dz); g.add(b);
        }
        break;
      }
      case 'martabakMini': {
        for (let i = 0; i < 3; i++) {
          const d = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 10), 0xff9f1c);
          d.position.set(-0.2 + i * 0.2, 0.05 + (i % 2) * 0.02, (i - 1) * 0.06); g.add(d);
          const fill = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 10), 0x6e4a26);
          fill.position.copy(d.position); fill.position.y += 0.04; g.add(fill);
        }
        break;
      }
      case 'jagungBakar': {
        const s = stick(); s.rotation.z = Math.PI / 2; s.position.set(-0.15, 0.05, 0); g.add(s);
        const corn = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 10), 0xffc93c);
        corn.rotation.z = Math.PI / 2; corn.position.set(0.18, 0.1, 0); g.add(corn);
        for (const dz of [-0.06, 0.06]) {
          const stripe = mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.08, 10), 0x8a5a1a);
          stripe.rotation.z = Math.PI / 2; stripe.position.set(0.05, 0.1, dz); g.add(stripe);
        }
        break;
      }
      case 'sempolAyam': {
        const cup = mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.24, 10), 0xfffdf2);
        cup.position.y = 0.12; g.add(cup);
        for (let i = -1; i <= 1; i++) {
          const s = stick(); s.position.set(i * 0.09, 0.32, 0); g.add(s);
          const bite = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8), 0xff9f1c);
          bite.position.set(i * 0.09, 0.32, 0); g.add(bite);
        }
        break;
      }
      case 'jasuke': {
        const cup = mesh(new THREE.CylinderGeometry(0.19, 0.15, 0.28, 10), 0xffc93c);
        cup.position.y = 0.14; g.add(cup);
        const top = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 10), 0xf7e08a);
        top.position.y = 0.3; g.add(top);
        for (let i = 0; i < 5; i++) {
          const k = mesh(new THREE.SphereGeometry(0.04, 6, 5), 0xffc93c);
          k.position.set(-0.09 + (i % 3) * 0.09, 0.33, i < 3 ? -0.05 : 0.06); g.add(k);
        }
        break;
      }
      case 'esKrim': {
        const cone = mesh(new THREE.ConeGeometry(0.14, 0.38, 10), 0xd8a05a);
        cone.rotation.x = Math.PI; cone.position.y = 0.12; g.add(cone);
        const scoop = mesh(new THREE.SphereGeometry(0.16, 10, 8), 0xff8fb3);
        scoop.position.y = 0.38; g.add(scoop);
        const cherry = mesh(new THREE.SphereGeometry(0.045, 6, 5), 0xff5c8a);
        cherry.position.y = 0.53; g.add(cherry);
        break;
      }
      default: break;
    }
    return g;
  }

  // ---------- Penjual NPC sederhana (1 model, variasi warna baju) ----------
  function makeVendor(shirt) {
    const v = new THREE.Group();
    const legs = mesh(new THREE.BoxGeometry(0.34, 0.5, 0.22), 0x4a3419);
    legs.position.y = 0.25; v.add(legs);
    const body = mesh(new THREE.BoxGeometry(0.55, 0.62, 0.34), shirt);
    body.position.y = 0.81; body.castShadow = true; v.add(body);
    for (const sx of [-0.34, 0.34]) {
      const arm = mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), shirt);
      arm.position.set(sx, 0.85, 0); v.add(arm);
    }
    const head = mesh(new THREE.SphereGeometry(0.21, 10, 8), 0xe8b98a);
    head.position.y = 1.32; head.castShadow = true; v.add(head);
    // Pipi merona anime (blush pink, dua titik di depan wajah).
    for (const sx of [-0.09, 0.09]) {
      const blush = mesh(new THREE.SphereGeometry(0.035, 6, 5), 0xff8fb3);
      blush.position.set(sx, 1.28, 0.19); v.add(blush);
    }
    const hat = mesh(new THREE.ConeGeometry(0.26, 0.22, 10), 0x8a6b3f);
    hat.position.y = 1.52; v.add(hat);
    v.rotation.y = -Math.PI / 2; // menghadap barat, ke jalan
    return v;
  }

  // ---------- Papan nama: tekstur canvas prosedural (pola papan TOKO) ----------
  function makeSign(text, accentHex) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g2 = c.getContext('2d');
    g2.fillStyle = accentHex; g2.fillRect(0, 0, 256, 64);
    g2.strokeStyle = '#1d2b53'; g2.lineWidth = 4; g2.strokeRect(4, 4, 248, 56); // outline tinta
    g2.font = '800 34px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Trebuchet MS", system-ui, sans-serif';
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.lineWidth = 5; g2.strokeStyle = '#1d2b53';
    g2.strokeText(text, 128, 34);
    g2.fillStyle = '#fff6e5';
    g2.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 0.08),
      new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGrad(THREE) }));
  }

  // ---------- Bangun 11 stan ----------
  for (const food of FOODS) {
    const vis = VISUALS[food.id];
    const y = terrainHeight(food.x, food.z);
    const stall = new THREE.Group();
    stall.position.set(food.x, y, food.z);
    // Badan gerobak kayu + meja + roda.
    const body = mesh(new THREE.BoxGeometry(1.5, 1.0, 2.2), 0x8a6b3f);
    body.position.y = 0.5; body.castShadow = true; body.receiveShadow = true; stall.add(body);
    const counter = mesh(new THREE.BoxGeometry(1.7, 0.12, 2.4), 0x6e4a26);
    counter.position.y = 1.06; counter.castShadow = true; stall.add(counter);
    for (const wz of [-1.0, 1.0]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10), 0x4a3419);
      wheel.rotation.x = Math.PI / 2; wheel.position.set(0, 0.3, wz); stall.add(wheel);
    }
    // Kanopi: 4 tiang + atap warna aksen + lis krem di sisi jalan (barat).
    for (const [px, pz] of [[-0.9, -1.15], [0.9, -1.15], [-0.9, 1.15], [0.9, 1.15]]) {
      const pole = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.25, 6), 0x6e4a26);
      pole.position.set(px, 1.72, pz); stall.add(pole);
    }
    const roof = mesh(new THREE.BoxGeometry(2.1, 0.1, 2.7), vis.accent);
    roof.position.y = 2.38; roof.castShadow = true; stall.add(roof);
    const valance = mesh(new THREE.BoxGeometry(0.06, 0.3, 2.7), 0xfff8dc);
    valance.position.set(-1.05, 2.2, 0); stall.add(valance);
    // Papan nama (teks ID — papan jalanan memang berbahasa Indonesia).
    const accentCss = `#${vis.accent.toString(16).padStart(6, '0')}`;
    const sign = makeSign(tt(food.labelKey, 'id'), accentCss);
    sign.position.set(-0.82, 1.95, 0); stall.add(sign);
    // Makanan di atas meja, agak ke sisi jalan supaya terlihat.
    const disp = foodDisplay(food.id);
    disp.position.set(-0.35, 1.14, 0);
    stall.add(disp);
    group.add(stall);
    // Penjual di belakang meja (timur), di luar collider.
    const vendor = makeVendor(vis.shirt);
    vendor.position.set(food.x + 1.15, terrainHeight(food.x + 1.15, food.z), food.z);
    group.add(vendor);
    colliders.push({
      minX: food.x - 0.8, maxX: food.x + 0.8,
      minZ: food.z - 1.15, maxZ: food.z + 1.15,
    });
    interactables.push({ id: food.id, x: food.x, z: food.z, r: 2.8, labelKey: food.labelKey });
  }
  scene.add(group);

  // ---------- Panel beli (JS-created DOM, token PRODUCT.md) ----------
  function ensurePanel() {
    if (panel) return panel;
    const root = document.createElement('div');
    root.id = 'nm-food-modal';
    root.className = 'modal hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const box = document.createElement('div');
    box.className = 'panel modal-panel nm-food-panel';
    const title = document.createElement('h2');
    const desc = document.createElement('p');
    desc.className = 'nm-food-desc';
    const effect = document.createElement('p');
    effect.className = 'nm-food-effect';
    const price = document.createElement('p');
    price.className = 'nm-food-price';
    const coins = document.createElement('p');
    coins.className = 'nm-food-coins';
    const row = document.createElement('div');
    row.className = 'row-btns';
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'primary-btn';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'primary-btn secondary';
    buy.addEventListener('click', () => { if (panelFood && panelGame) buyAndEat(panelFood, panelGame); });
    cancel.addEventListener('click', () => closePanel());
    root.addEventListener('click', (e) => { if (e.target === root) closePanel(); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
    row.append(buy, cancel);
    box.append(title, desc, effect, price, coins, row);
    root.appendChild(box);
    (document.getElementById('game-container') || document.body).appendChild(root);
    panel = { root, title, desc, effect, price, coins, buy, cancel };
    return panel;
  }
  function effectText(food, lang) {
    if (!food.buff) return tt('foodEffectNone', lang);
    const b = food.buff;
    const parts = [];
    if (b.speedMul) parts.push(tt('foodFxSpeed', lang, { n: Math.round((b.speedMul - 1) * 100) }));
    if (b.jumpMul) parts.push(tt('foodFxJump', lang, { n: Math.round((b.jumpMul - 1) * 100) }));
    if (b.swimMul) parts.push(tt('foodFxSwim', lang, { n: Math.round((b.swimMul - 1) * 100) }));
    return `${parts.join(' • ')} — ${tt('foodFxDur', lang, { s: b.durSec })}`;
  }
  function openPanel(food, game) {
    const p = ensurePanel();
    const lang = langOf(game);
    panelFood = food;
    panelGame = game;
    p.title.textContent = tt(food.labelKey, lang);
    p.desc.textContent = tt(food.descKey, lang);
    p.effect.textContent = effectText(food, lang);
    p.effect.classList.toggle('none', !food.buff);
    p.price.textContent = tt('foodPrice', lang, { n: food.price });
    p.coins.textContent = tt('foodCoins', lang, { n: game?.state?.coins ?? 0 });
    p.buy.textContent = tt('foodBuyEat', lang);
    p.cancel.textContent = tt('cancel', lang);
    p.root.classList.remove('hidden');
    p.buy.focus();
  }
  function closePanel() {
    if (!panel) return;
    panel.root.classList.add('hidden');
    panelFood = null;
    panelGame = null;
  }

  // ---------- Chip buff di HUD (ditempel ke #hud-left, ikut flow) ----------
  function ensureBuffBar() {
    if (buffBar) return buffBar;
    const bar = document.createElement('div');
    bar.id = 'nm-buff-bar';
    bar.setAttribute('aria-live', 'polite');
    const host = document.getElementById('hud-left') || document.getElementById('hud') || document.body;
    host.appendChild(bar);
    buffBar = bar;
    return bar;
  }
  function refreshBuffBar(lang) {
    const bar = ensureBuffBar();
    const list = getActiveBuffs();
    const text = list.map((b) => `${tt(b.labelKey, lang)} ${tt('foodSec', lang, { s: b.remainSec })}`).join('|');
    if (text === lastBuffBarText) return;
    lastBuffBarText = text;
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    for (const b of list) {
      const chip = document.createElement('span');
      chip.className = 'nm-buff-chip';
      chip.textContent = `${tt(b.labelKey, lang)} ${tt('foodSec', lang, { s: b.remainSec })}`;
      bar.appendChild(chip);
    }
  }

  // ---------- Beli + makan ----------
  function buyAndEat(food, game) {
    const lang = langOf(game);
    const coins = game?.state?.coins ?? 0;
    if (coins < food.price) {
      sfx(game, 'error');
      say(game, tt('needCoins', lang));
      return false;
    }
    game.state.coins -= food.price;
    sfx(game, 'coin');
    closePanel();
    if (game.ui && typeof game.ui.updateHUD === 'function') game.ui.updateHUD(game.state);
    if (typeof game.save === 'function') game.save();
    // Animasi makan 1 dtk: makanan melayang dari stan ke wajah pemain,
    // lalu buff diterapkan + toast. Tanpa pemain (stub) langsung terapkan.
    const hasPlayer = game && game.player
      && typeof game.player.x === 'number' && typeof game.player.z === 'number';
    if (!hasPlayer) {
      finishEating(food, game);
      return true;
    }
    const bite = foodDisplay(food.id);
    bite.scale.setScalar(0.9);
    const gy = terrainHeight(food.x, food.z);
    bite.position.set(food.x - 1.2, gy + 1.35, food.z);
    scene.add(bite);
    eating = { food, mesh: bite, t: 0, from: bite.position.clone(), game };
    return true;
  }
  function finishEating(food, game) {
    const lang = langOf(game);
    lhSfx('HAP!'); // momen perayaan: makanan habis dimakan
    if (food.buff) {
      applyFoodBuff(game, food.id);
      sfx(game, 'eat'); // kunyah (koordinator: case 'eat' baru di audio.js)
      say(game, tt('foodAte', lang, { item: tt(food.labelKey, lang), e: effectText(food, lang) }));
    } else {
      sfx(game, 'eat');
      say(game, tt('foodAtePlain', lang, { item: tt(food.labelKey, lang) }));
    }
    refreshBuffBar(lang);
  }

  // ---------- API instance ----------
  function onUse(id, game) {
    const food = FOODS.find((f) => f.id === id);
    if (!food) return false;
    sfx(game, 'click');
    openPanel(food, game);
    return true;
  }

  function update(dt, t, game) {
    time += dt;
    _tickBuffs(dt, game);
    // Asap sosis bakar: naik + memudar, loop.
    for (const s of smokes) {
      const k = (time * 0.45 + s.phase) % 1;
      s.mesh.position.y = s.baseY + k * 0.9;
      s.mesh.material.opacity = 0.65 * (1 - k);
      const sc = 1 + k * 0.8;
      s.mesh.scale.setScalar(sc);
    }
    // Animasi makan.
    if (eating) {
      eating.t += dt;
      const k = Math.min(1, eating.t / 1.0);
      const p = eating.game.player;
      const head = {
        x: p.x,
        y: (typeof p.y === 'number' ? p.y : terrainHeight(p.x, p.z)) + 1.45,
        z: p.z,
      };
      eating.mesh.position.set(
        eating.from.x + (head.x - eating.from.x) * k,
        eating.from.y + (head.y - eating.from.y) * k + Math.sin(k * Math.PI) * 0.25,
        eating.from.z + (head.z - eating.from.z) * k,
      );
      eating.mesh.scale.setScalar(0.9 * (1 - k * 0.35));
      if (k >= 1) {
        scene.remove(eating.mesh);
        const { food, game: g } = eating;
        eating = null;
        finishEating(food, g);
      }
    }
    // Chip buff HUD, ~4 Hz.
    buffBarTimer += dt;
    if (buffBarTimer >= 0.25) {
      buffBarTimer = 0;
      refreshBuffBar(langOf(game));
    }
  }

  return {
    colliders,
    interactables,
    update,
    onUse,
    applyFoodBuff,
    getActiveBuffs,
    getBuffMultipliers,
    // Diekspos untuk verifikasi headless (bukan bagian kontrak wiring):
    _panel: () => panel,
    _eating: () => eating,
    _group: group,
  };
}
