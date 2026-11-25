// nm-rides.js — Wahana + hiburan pasar malam (Lane R, 2026-11-23).
// Restyle visual Lane D (anime overhaul, 25 Nov 2026): semua permukaan
// MeshToonMaterial + gradientMap 4-step (cel), outline tinta inverted-hull
// di wahana hero, palet langit/sakura/matahari PRODUCT.md, papan neon
// display rounded, SFX khas lembah ("DUAR!"/"PANEN!"/"TING!") + burst
// kelopak di momen perayaan. Perilaku, biaya, teks, koordinat TIDAK berubah.
//
// Semua wahana + hiburan pasar malam di rect x 58..102, z -50..44, prosedural
// dari kode (primitif Three.js + material flat, lampu emissive warna-warni).
// Modul ini TIDAK menyentuh main.js / world.js / physics.js: koordinator
// yang mewiring-nya (lihat LANE-R-REPORT.md untuk kontrak wiring persis).
//
// Kontrak:
//   NM_RIDES — array def {id, x, z, kind:'ride'|'attraction'|'npc', labelKey, cost}
//   buildNightMarketRides(scene, THREE, ctx) -> {
//     colliders,                       // AABB statis {minX,maxX,minZ,maxZ}
//     interactables,                   // [{id, x, z, r, labelKey}] (titik NAIK)
//     update(dt, t, game),             // dipanggil tiap frame dari loop game
//     onUse(id, game),                 // aksi kontekstual (tombol Aksi)
//     getRiderTransform(),             // {x,y,z,ry} kursi/kabin saat naik, null bila tidak naik
//     isRiding(), stopRide(),
//     debug: { state(), setTimeScale(v), forceBite() },
//   }
//   ctx: { t(key), lang, toast(msg), sfx:{ play(name) } }
//   game (saat update/onUse): game.player {x,z,yOff,vy,vx,vz,group,teleport},
//     game.input {moveVector()} (input TIDAK dikunci saat naik supaya
//     tombol Aksi "Turun" tetap bisa ditekan), game.state.coins,
//     game.ui?.toast, game.camera.
//
// Aturan main:
//   - Biaya naik: GRATIS semua (cost 0). Memancing: dapat ikan = +2 koin.
//   - Wahana NAIK: board -> riding (tanpa batas waktu — jalan terus
//     sampai pemain menekan Turun) -> exit. Tidak ada panel tengah layar;
//     satu-satunya kontrol keluar = tombol Aksi ("Turun") di touch controls
//     / tombol E di desktop (input TIDAK dikunci saat naik supaya tombol
//     Aksi tetap bisa ditekan; gerak pemain tetap mati karena player.update
//     dilewati selama naik, lihat wiring di main.js).
//     Selama riding: input TIDAK dikunci (supaya tombol Aksi "Turun" tetap
//     bisa ditekan); fisika jalan dinonaktifkan oleh wiring (player.update
//     di-skip saat isRiding()), posisi pemain ditempel ke getRiderTransform()
//     tiap frame. Wahana KENDARAI (bom-bom & becak): input menggerakkan
//     kendaraan.
//   - Tanah: tiap struktur mengambil terrainHeight() di anchornya sendiri,
//     jadi tetap duduk benar baik di worktree ini (belum di-flatten) maupun
//     setelah Lane P meratakan zona ke h~0.6.
import { terrainHeight } from './physics.js';
import { buildCharacter } from './player.js';

// ---------- Definisi wahana (anchor TERKUNCI — jangan pindah) ----------
export const NM_RIDES = [
  { id: 'ferris', x: 70, z: -40, kind: 'ride', labelKey: 'rideFerris', cost: 0 },
  { id: 'pirate', x: 84, z: -40, kind: 'ride', labelKey: 'ridePirate', cost: 0 },
  { id: 'carousel', x: 94, z: -40, kind: 'ride', labelKey: 'rideCarousel', cost: 0 },
  { id: 'chairs', x: 82, z: -48, kind: 'ride', labelKey: 'rideChairs', cost: 0 },
  { id: 'bumper', x: 93, z: -48.25, kind: 'ride', labelKey: 'rideBumper', cost: 0 },
  { id: 'tagada', x: 70, z: -32, kind: 'ride', labelKey: 'rideTagada', cost: 0 },
  { id: 'coaster', x: 64, z: -39, kind: 'ride', labelKey: 'rideCoaster', cost: 0 },
  { id: 'haunted', x: 71, z: 35, kind: 'attraction', labelKey: 'rideHaunted', cost: 0 },
  { id: 'motorwall', x: 98, z: -32, kind: 'attraction', labelKey: 'rideMotorwall', cost: 0 },
  { id: 'magic', x: 77, z: -6, kind: 'attraction', labelKey: 'rideMagic', cost: 0 },
  { id: 'clown', x: 77, z: 0, kind: 'npc', labelKey: 'rideClown', cost: 0 },
  { id: 'mirror', x: 88, z: 41, kind: 'attraction', labelKey: 'rideMirror', cost: 0 },
  { id: 'balloon', x: 84, z: 33, kind: 'attraction', labelKey: 'rideBalloon', cost: 0 },
  { id: 'ballpit', x: 95, z: 33, kind: 'attraction', labelKey: 'rideBallpit', cost: 0 },
  { id: 'trampoline', x: 64, z: 28, kind: 'attraction', labelKey: 'rideTrampoline', cost: 0 },
  { id: 'train', x: 62, z: 18, kind: 'ride', labelKey: 'rideTrain', cost: 0 },
  { id: 'odong', x: 62, z: 18, kind: 'ride', labelKey: 'rideOdong', cost: 0 },
  { id: 'becak', x: 64, z: 20, kind: 'ride', labelKey: 'rideBecak', cost: 0 },
  { id: 'fishing', x: 98, z: 10, kind: 'attraction', labelKey: 'rideFishing', cost: 0 },
  { id: 'animalshow', x: 98, z: -12, kind: 'attraction', labelKey: 'rideAnimalShow', cost: 0 },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const TAU = Math.PI * 2;

// ---------- Helper geometri (THREE diisi saat build) ----------
// Cel/toon anime (Lane D restyle, PRODUCT.md § Dunia 3D): semua permukaan
// MeshToonMaterial + gradientMap 4-step. MeshBasicMaterial dipertahankan
// hanya untuk sumber cahaya (bola lampu, neon, percikan).
let T = null;
const INK = 0x1d2b53; // --lh-ink
let _toonGrad = null;
function toonGrad() {
  if (_toonGrad) return _toonGrad;
  const tex = new T.DataTexture(new Uint8Array([90, 150, 210, 255]), 4, 1, T.RedFormat);
  tex.minFilter = T.NearestFilter;
  tex.magFilter = T.NearestFilter;
  tex.needsUpdate = true;
  _toonGrad = tex;
  return tex;
}
// toon(): seperti lam() lama, tapi cel. Kunci yang hanya dikenal
// Standard/Phong (roughness/metalness/shininess/specular) dibuang supaya
// tidak ada warning "not a property" dari three.
function toon(color, extra = {}) {
  const { shininess, specular, metalness, roughness, ...rest } = extra;
  return new T.MeshToonMaterial({ color, gradientMap: toonGrad(), ...rest });
}
function lam(color, extra = {}) {
  return toon(color, extra);
}
function emi(color, intensity = 1) {
  return new T.MeshToonMaterial({ color, emissive: color, emissiveIntensity: intensity, gradientMap: toonGrad() });
}
function phong(color, extra = {}) {
  return toon(color, extra);
}
// Outline tinta inverted-hull (PRODUCT.md): salinan geometri yang sama,
// BackSide warna tinta, skala sedikit lebih besar — ditempel sebagai anak
// mesh hero supaya ikut semua transform. Hanya untuk objek hero (bukan
// instanced / objek kecil).
function outline(mesh, s = 1.05) {
  const o = new T.Mesh(mesh.geometry, new T.MeshBasicMaterial({ color: INK, side: T.BackSide }));
  o.scale.setScalar(s);
  o.raycast = () => {};
  mesh.add(o);
  return o;
}

// ---- SFX onomatopoeia + burst kelopak (Lane D; PRODUCT.md § Motion) ----
// Teks SFX khas lembah ("DUAR!"/"PANEN!"/"TING!"), partikel = kelopak
// sakura + daun + bintang — BUKAN asap/shard Sakuga. Satu momen perayaan
// per fitur (bukan tiap klik). Mati bila prefers-reduced-motion.
const LH_REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
function lhFxCss() {
  if (typeof document === 'undefined' || document.getElementById('lh-fx-style-rides')) return;
  const st = document.createElement('style');
  st.id = 'lh-fx-style-rides';
  st.textContent = '.lh-sfx-nm{position:fixed;left:50%;top:38%;z-index:60;pointer-events:none;font-family:"Arial Rounded MT Bold","Hiragino Maru Gothic ProN","Hiragino Sans","Trebuchet MS",system-ui,sans-serif;font-weight:800;font-style:italic;font-size:clamp(34px,6vw,52px);letter-spacing:.02em;color:#ffc93c;-webkit-text-stroke:2px #1d2b53;text-shadow:4px 4px 0 rgba(29,43,83,.9);transform:translate(-50%,-50%) rotate(-6deg);animation:lh-sfx-nm-pop .9s cubic-bezier(.34,1.56,.64,1) forwards}'
    + '@keyframes lh-sfx-nm-pop{0%{transform:translate(-50%,-50%) scale(.35) rotate(-12deg);opacity:0}25%{opacity:1;transform:translate(-50%,-50%) scale(1.18) rotate(-3deg)}55%{transform:translate(-50%,-50%) scale(1) rotate(-6deg);opacity:1}100%{transform:translate(-50%,-62%) scale(1.04) rotate(-6deg);opacity:0}}'
    + '.lh-petal{position:fixed;z-index:60;pointer-events:none;animation:lh-petal-fly .9s ease-out forwards}'
    + '@keyframes lh-petal-fly{to{transform:translate(var(--dx,0px),var(--dy,-60px)) rotate(var(--rot,180deg)) scale(.55);opacity:0}}'
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
function mesh(geo, material, x = 0, y = 0, z = 0, cast = false) {
  const m = new T.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  return m;
}
function box(w, h, d, material, x = 0, y = 0, z = 0, cast = false) {
  return mesh(new T.BoxGeometry(w, h, d), material, x, y, z, cast);
}
function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, seg = 10, cast = false) {
  return mesh(new T.CylinderGeometry(rt, rb, h, seg), material, x, y, z, cast);
}
function sph(r, material, x = 0, y = 0, z = 0, ws = 8, hs = 6) {
  return mesh(new T.SphereGeometry(r, ws, hs), material, x, y, z);
}
function cone(r, h, material, x = 0, y = 0, z = 0, seg = 8) {
  return mesh(new T.ConeGeometry(r, h, seg), material, x, y, z);
}
// Balok yang menghubungkan dua titik (dipakai rel, pagar, kaki penyangga).
function beam(x1, y1, z1, x2, y2, z2, thick, material) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const len = Math.hypot(dx, dy, dz);
  const m = box(thick, len, thick, material);
  m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
  m.quaternion.setFromUnitVectors(
    new T.Vector3(0, 1, 0),
    new T.Vector3(dx / len, dy / len, dz / len),
  );
  return m;
}
const ground = (x, z) => terrainHeight(x, z);

// Palet pasar malam — token anime PRODUCT.md (langit/sakura/matahari/
// daun di atas rumput lembah). Kayu dipakai hemat; tanpa ungu-biru.
const C = {
  wood: 0x8a6b3f, woodDark: 0x6b4e2a, woodLight: 0xb08d57,
  red: 0xff5c8a, pink: 0xff8fb3, yellow: 0xffc93c, gold: 0xff9f1c,
  teal: 0x3fa9f5, blue: 0x1e6fd9, purple: 0xff8fb3, cream: 0xfff3d6,
  white: 0xf5f2ea, black: 0x241d1a, green: 0x2fbf4a, orange: 0xff9f1c,
  haunted: 0x3a2b4d, hauntedRoof: 0x241a30, mirror: 0xdfe9f2, sky: 0x9fc8e8,
};

// ---------- Jalur loop persegi (kereta + odong) ----------
// Urutan: stasiun (62,18) -> utara (62,-22) -> timur (94,-22) -> selatan
// (94,22) -> barat (62,22) -> kembali ke stasiun. Total 152 m.
const TRAIN_LOOP = { x0: 62, x1: 94, z0: -22, z1: 22 };
function rectLoopPoint(s) {
  const { x0, x1, z0, z1 } = TRAIN_LOOP;
  const segs = [
    { len: 40, from: [x0, 18], to: [x0, z0] },
    { len: 32, from: [x0, z0], to: [x1, z0] },
    { len: 44, from: [x1, z0], to: [x1, z1] },
    { len: 32, from: [x1, z1], to: [x0, z1] },
    { len: 4, from: [x0, z1], to: [x0, 18] },
  ];
  const per = 152;
  s = ((s % per) + per) % per;
  for (const sg of segs) {
    if (s <= sg.len) {
      const k = sg.len === 0 ? 0 : s / sg.len;
      const x = lerp(sg.from[0], sg.to[0], k);
      const z = lerp(sg.from[1], sg.to[1], k);
      const dx = sg.to[0] - sg.from[0], dz = sg.to[1] - sg.from[1];
      const dl = Math.hypot(dx, dz) || 1;
      return { x, z, dx: dx / dl, dz: dz / dl, s };
    }
    s -= sg.len;
  }
  return { x: x0, z: 18, dx: 0, dz: -1, s: 0 };
}

// ---------- Jalur oval roller coaster ----------
// Lurus utara z=-50 & selatan z=-28 (x 75..87) + setengah lingkaran r=11
// di (75,-39) & (87,-39). s=0 di stasiun (64,-39), arah: utara dulu.
const COASTER = { y: 8, per: 24 + TAU * 11 };
function ovalPoint(s) {
  const R = 11, per = COASTER.per;
  s = ((s % per) + per) % per;
  const semi = Math.PI * R; // 34.56
  if (s < semi) { // setengah lingkaran barat: (64,-39) -> (75,-50)
    const a = Math.PI + (s / R); // PI -> 3PI/2
    return { x: 75 + R * Math.cos(a), z: -39 + R * Math.sin(a),
             dx: -Math.sin(a), dz: Math.cos(a), s };
  }
  s -= semi;
  if (s < 12) return { x: 75 + s, z: -50, dx: 1, dz: 0, s }; // lurus utara
  s -= 12;
  if (s < semi) { // setengah lingkaran timur: (87,-50) -> (87,-28)
    const a = -Math.PI / 2 + (s / R); // -PI/2 -> PI/2
    return { x: 87 + R * Math.cos(a), z: -39 + R * Math.sin(a),
             dx: -Math.sin(a), dz: Math.cos(a), s };
  }
  s -= semi;
  if (s < 12) return { x: 87 - s, z: -28, dx: -1, dz: 0, s }; // lurus selatan
  s -= 12; // setengah lingkaran barat selatan: (75,-28) -> (64,-39)
  const a = Math.PI / 2 + (s / R); // PI/2 -> PI
  return { x: 75 + R * Math.cos(a), z: -39 + R * Math.sin(a),
           dx: -Math.sin(a), dz: Math.cos(a), s };
}

// ---------- NPC dari primitif + rig karakter game ----------
function makeNpc(custom, extra = null) {
  const g = buildCharacter('male', custom);
  if (extra) extra(g);
  return g;
}
function waveArm(npc, t, amp = 0.35) {
  const u = npc.userData;
  if (!u || !u.armR) return;
  u.armR.rotation.x = -2.1 + Math.sin(t * 3) * amp;
  u.armL.rotation.x = 0.15;
}

// ================= WAHANA NAIK (duduk) =================

// --- Bianglala (70,-40) r6 ---
// Roda di bidang Z-Y (menghadap selatan, ke arah pasar), kabin 0 = kabin naik.
function makeFerris() {
  const gy = ground(70, -40);
  const AXLE = 6.8, R = 5.2;
  const g = new T.Group();
  g.position.set(70, gy, -40);
  const wood = lam(C.woodDark), red = lam(C.red), cream = lam(C.cream);
  // Kaki A di x=+-1.1 (dua sisi roda).
  for (const sx of [-1.1, 1.1]) {
    g.add(beam(sx, 0, -3.2, sx, AXLE, 0, 0.28, wood));
    g.add(beam(sx, 0, 3.2, sx, AXLE, 0, 0.28, wood));
    g.add(box(0.3, 0.3, 7.2, wood, sx, 0.15, 0));
  }
  // Poros + hub.
  const axle = cyl(0.22, 0.22, 3.0, lam(C.gold), 0, AXLE, 0, 8);
  axle.rotation.z = Math.PI / 2;
  g.add(axle);
  g.add(sph(0.5, lam(C.gold), 0, AXLE, 0));
  // Roda: pelek + jari-jari (berputar mengelilingi sumbu X).
  const wheel = new T.Group();
  wheel.position.set(0, AXLE, 0);
  const rim = mesh(new T.TorusGeometry(R, 0.14, 6, 28), red, 0, 0, 0);
  rim.rotation.y = Math.PI / 2;
  outline(rim, 1.04);
  wheel.add(rim);
  for (let i = 0; i < 4; i++) {
    const spoke = box(0.12, R * 2, 0.12, cream, 0, 0, 0);
    spoke.rotation.x = (i * Math.PI) / 4;
    wheel.add(spoke);
  }
  // Lampu warna-warni di pelek.
  const bulbCols = [C.red, C.yellow, C.teal, C.pink, C.gold, C.green];
  const bulbs = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const b = sph(0.16, emi(bulbCols[i % bulbCols.length], 1.6),
      0, R * Math.cos(a), R * Math.sin(a), 6, 6);
    wheel.add(b);
    bulbs.push(b);
  }
  g.add(wheel);
  // Kabin: 8 bak terbuka (tanpa atap — pemain berdiri di dalamnya,
  // setinggi pinggang terlihat di atas bibir bak), diposisikan tiap frame.
  const cabins = [];
  for (let i = 0; i < 8; i++) {
    const cab = new T.Group();
    const body = box(1.0, 0.7, 0.9, i % 2 ? lam(C.teal) : lam(C.red), 0, 0, 0, true);
    outline(body, 1.08);
    const rim = box(1.1, 0.1, 1.0, lam(C.cream), 0, 0.38, 0);
    const bench = box(0.9, 0.12, 0.5, lam(C.woodLight), 0, -0.1, -0.15);
    cab.add(body, rim, bench);
    g.add(cab);
    cabins.push(cab);
  }
  const st = { angle: Math.PI, speed: TAU / 60, fast: false, laps: 0 };
  function placeCabins() {
    for (let i = 0; i < 8; i++) {
      const a = st.angle + (i * TAU) / 8;
      cabins[i].position.set(0, AXLE + R * Math.cos(a), R * Math.sin(a));
    }
  }
  placeCabins();
  return {
    id: 'ferris', group: g,
    colliders: [{ minX: 69, maxX: 71, minZ: -46, maxZ: -34 }],
    // Board/exit di sisi TIMUR (76,-33), BUKAN di selatan (70,-33): titik selatan
    // jatuh di dalam collider tagada (65.6..74.4 x -36.4..-27.6) sehingga pemain
    // tidak pernah bisa berdiri di sana (fisika mendorong keluar ke z=-36.9)
    // dan exit pun terdorong keluar. (76,-33) bersih dari semua collider.
    board: { x: 76, z: -33, r: 3 }, exit: { x: 76, z: -33 },
    boardFn() { st.angle = Math.PI; st.fast = true; return true; },
    update(dt) {
      const target = st.fast ? TAU / 30 : TAU / 60;
      st.speed += (target - st.speed) * Math.min(1, dt * 1.5);
      st.angle += st.speed * dt;
      wheel.rotation.x = -st.angle;
      placeCabins();
      const k = Math.floor(st.angle / TAU);
      if (k !== st.laps) st.laps = k;
      bulbs.forEach((b, i) => {
        b.material.emissiveIntensity = 1.2 + Math.sin(st.angle * 4 + i) * 0.8;
      });
    },
    rider() {
      const a = st.angle;
      return { x: 70, y: gy + AXLE + R * Math.cos(a) - 0.3,
               z: -40 + R * Math.sin(a), ry: 0 };
    },
    unboard() { st.fast = false; },
    debug() { return { angle: st.angle, speed: st.speed }; },
  };
}

// --- Kora-kora (84,-40) ---
// Kapal mengayun di bidang X-Y (timur-barat), poros di atas.
function makePirate() {
  const gy = ground(84, -40);
  const PIV = 6.2, ARM = 4.6;
  const g = new T.Group();
  g.position.set(84, gy, -40);
  const wood = lam(C.woodDark);
  for (const sz of [-1.3, 1.3]) {
    g.add(beam(0, PIV, sz, -2.4, 0, sz, 0.3, wood));
    g.add(beam(0, PIV, sz, 2.4, 0, sz, 0.3, wood));
  }
  const axle = cyl(0.2, 0.2, 3.4, lam(C.gold), 0, PIV, 0, 8);
  axle.rotation.x = Math.PI / 2;
  g.add(axle);
  const swing = new T.Group();
  swing.position.set(0, PIV, 0);
  swing.add(box(0.24, ARM, 0.24, wood, 0, -ARM / 2, 0));
  const hull = new T.Group();
  hull.position.set(0, -ARM, 0);
  const hullBody = box(3.6, 0.7, 1.3, lam(C.red), 0, 0, 0, true);
  outline(hullBody, 1.05);
  hull.add(hullBody);
  hull.add(box(3.9, 0.25, 1.45, lam(C.woodLight), 0, 0.45, 0));
  const bow = cone(0.65, 1.1, lam(C.gold), -2.1, 0.3, 0);
  bow.rotation.z = Math.PI / 2;
  const stern = cone(0.65, 1.1, lam(C.gold), 2.1, 0.3, 0);
  stern.rotation.z = -Math.PI / 2;
  hull.add(bow, stern);
  for (const sx of [-1.1, 0, 1.1]) hull.add(box(0.5, 0.5, 0.9, lam(C.cream), sx, 0.6, 0));
  swing.add(hull);
  g.add(swing);
  const st = { phase: 0, amp: 0.1, riding: false };
  return {
    id: 'pirate', group: g,
    colliders: [{ minX: 81, maxX: 87, minZ: -41.5, maxZ: -38.5 }],
    board: { x: 84, z: -35.5, r: 3 }, exit: { x: 84, z: -35.5 },
    boardFn() { st.phase = 0; st.riding = true; return true; },
    update(dt) {
      const target = st.riding ? 0.62 : 0.08;
      st.amp += (target - st.amp) * Math.min(1, dt * 0.8);
      st.phase += dt * (TAU / 6);
      swing.rotation.z = st.amp * Math.sin(st.phase);
    },
    rider() {
      const a = st.amp * Math.sin(st.phase);
      return { x: 84 + ARM * Math.sin(a), y: gy + PIV - ARM * Math.cos(a) + 0.6,
               z: -40, ry: 0 };
    },
    unboard() { st.riding = false; },
    debug() { return { amp: st.amp, angle: st.amp * Math.sin(st.phase) }; },
  };
}

// --- Komidi putar (94,-40) r4 ---
function makeCarousel() {
  const gy = ground(94, -40);
  const g = new T.Group();
  g.position.set(94, gy, -40);
  g.add(cyl(3.8, 4.0, 0.35, lam(C.woodDark), 0, 0.18, 0, 20, true));
  g.add(cyl(3.9, 3.9, 0.12, lam(C.gold), 0, 0.4, 0, 20));
  const spin = new T.Group();
  spin.position.set(0, 0, 0);
  spin.add(cyl(3.4, 3.4, 0.25, lam(C.cream), 0, 0.55, 0, 20));
  spin.add(cyl(0.18, 0.18, 4.0, lam(C.gold), 0, 2.4, 0, 8));
  const roofCone = cone(4.3, 1.3, lam(C.pink), 0, 4.9, 0, 16);
  outline(roofCone, 1.04);
  spin.add(roofCone);
  spin.add(sph(0.3, emi(C.gold, 1.5), 0, 5.7, 0));
  const horseCols = [C.white, 0xd8b36a, C.pink, C.teal, 0x8a6b3f, C.red];
  const horses = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const h = new T.Group();
    h.position.set(2.5 * Math.cos(a), 0.68, 2.5 * Math.sin(a));
    h.rotation.y = -a + Math.PI / 2;
    const col = lam(horseCols[i]);
    h.add(box(1.0, 0.42, 0.4, col, 0, 0.35, 0));
    const head = box(0.42, 0.42, 0.34, col, 0.62, 0.72, 0);
    head.rotation.z = -0.5;
    h.add(head);
    h.add(box(0.5, 0.18, 0.42, lam(C.red), 0, 0.6, 0)); // pelana
    h.add(cyl(0.05, 0.05, 1.5, lam(C.gold), 0, 0.3, 0, 6)); // tiang
    spin.add(h);
    horses.push({ g: h, phase: (i / 6) * TAU });
  }
  // Lampu keliling atap.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    spin.add(sph(0.11, emi(i % 2 ? C.yellow : C.pink, 1.6),
      4.0 * Math.cos(a), 4.35, 4.0 * Math.sin(a), 6, 6));
  }
  g.add(spin);
  const st = { angle: -Math.PI / 2, speed: TAU / 24 };
  return {
    id: 'carousel', group: g,
    colliders: [{ minX: 90.2, maxX: 97.8, minZ: -43.8, maxZ: -36.2 }],
    board: { x: 94, z: -35, r: 3 }, exit: { x: 94, z: -35 },
    boardFn() { st.angle = -Math.PI / 2; return true; },
    update(dt) {
      st.angle += st.speed * dt;
      spin.rotation.y = st.angle;
      for (const h of horses) {
        h.g.position.y = 0.68 + 0.22 * Math.sin(st.angle * 2 + h.phase);
      }
    },
    rider() {
      const th = st.angle;
      return { x: 94 + 2.5 * Math.cos(th), y: gy + 0.75 + 0.22 * Math.sin(th * 2),
               z: -40 - 2.5 * Math.sin(th),
               ry: Math.atan2(-Math.sin(th), -Math.cos(th)) };
    },
    unboard() {},
    debug() { return { angle: st.angle }; },
  };
}

// --- Kursi terbang (82,-48) r4.5 ---
function makeChairs() {
  const gy = ground(82, -48);
  const HUB = 6.9, CHAIN = 2.6;
  const g = new T.Group();
  g.position.set(82, gy, -48);
  g.add(cyl(0.55, 0.8, 7.2, lam(C.teal), 0, 3.6, 0, 10, true));
  g.add(cone(1.1, 0.9, lam(C.red), 0, 7.6, 0, 10));
  g.add(sph(0.25, emi(C.gold, 1.5), 0, 8.2, 0));
  const hub = new T.Group();
  hub.position.set(0, HUB, 0);
  hub.add(cyl(1.05, 1.05, 0.45, lam(C.gold), 0, 0, 0, 12));
  const chairCols = [C.red, C.yellow, C.pink, C.teal, C.green, C.orange];
  const chairs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const pivot = new T.Group();
    pivot.position.set(1.0 * Math.cos(a), 0, 1.0 * Math.sin(a));
    pivot.rotation.y = -a;
    const swing = new T.Group(); // mengayun keluar (rotasi X lokal)
    swing.add(cyl(0.03, 0.03, CHAIN, lam(C.black), -0.22, -CHAIN / 2, 0, 4));
    swing.add(cyl(0.03, 0.03, CHAIN, lam(C.black), 0.22, -CHAIN / 2, 0, 4));
    swing.add(box(0.62, 0.14, 0.55, lam(chairCols[i]), 0, -CHAIN, 0));
    swing.add(box(0.62, 0.55, 0.12, lam(chairCols[i]), 0, -CHAIN + 0.3, -0.26));
    pivot.add(swing);
    hub.add(pivot);
    chairs.push({ pivot, swing });
  }
  g.add(hub);
  const st = { angle: 0, omega: TAU / 40, riding: false };
  return {
    id: 'chairs', group: g,
    colliders: [{ minX: 79.2, maxX: 84.8, minZ: -50.8, maxZ: -45.2 }],
    board: { x: 82, z: -42.5, r: 3 }, exit: { x: 82, z: -42.5 },
    boardFn() { st.riding = true; return true; },
    update(dt) {
      const target = st.riding ? TAU / 8 : TAU / 40;
      st.omega += (target - st.omega) * Math.min(1, dt * 0.7);
      st.angle += st.omega * dt;
      hub.rotation.y = st.angle;
      const tilt = 0.62 * (st.omega / (TAU / 8)) ** 2;
      for (const c of chairs) c.swing.rotation.x = tilt;
    },
    rider() {
      const th = st.angle;
      const tilt = 0.62 * (st.omega / (TAU / 8)) ** 2;
      const r = 1.0 + CHAIN * Math.sin(tilt);
      return { x: 82 + r * Math.cos(th), y: gy + HUB - CHAIN * Math.cos(tilt) + 0.1,
               z: -48 - r * Math.sin(th),
               ry: Math.atan2(-Math.sin(th), -Math.cos(th)) };
    },
    unboard() { st.riding = false; },
    debug() { return { angle: st.angle, omega: st.omega }; },
  };
}

// --- Tong setan / tagada (70,-32) r4.5 ---
// Piringan berputar + miring (wobble). Naik = berdiri di atas piringan.
function makeTagada() {
  const gy = ground(70, -32);
  const g = new T.Group();
  g.position.set(70, gy, -32);
  g.add(cyl(4.5, 4.7, 0.5, lam(C.woodDark), 0, 0.25, 0, 20, true));
  const disc = new T.Group();
  disc.position.set(0, 0.75, 0);
  const discTop = cyl(4.0, 4.0, 0.35, lam(C.purple), 0, 0, 0, 20);
  outline(discTop, 1.03);
  disc.add(discTop);
  disc.add(mesh(new T.TorusGeometry(4.0, 0.12, 6, 28), emi(C.yellow, 1.2), 0, 0.18, 0));
  disc.children[1].rotation.x = Math.PI / 2;
  disc.add(cone(0.8, 0.9, lam(C.gold), 0, 0.6, 0, 10));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    disc.add(sph(0.14, emi(i % 2 ? C.pink : C.teal, 1.6),
      3.6 * Math.cos(a), 0.2, 3.6 * Math.sin(a), 6, 6));
  }
  g.add(disc);
  // Pagar pengaman rendah di sekeliling (visual; collider AABB di bawah).
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    if (Math.abs(a - Math.PI / 2) < 0.4) continue; // celah masuk (selatan)
    g.add(box(0.08, 0.9, 0.08, lam(C.wood), 4.6 * Math.cos(a), 0.95, 4.6 * Math.sin(a)));
  }
  const st = { angle: 0, wob: 0, riding: false };
  const _v = new T.Vector3();
  return {
    id: 'tagada', group: g,
    colliders: [{ minX: 65.6, maxX: 74.4, minZ: -36.4, maxZ: -27.6 }],
    board: { x: 70, z: -26.5, r: 3 }, exit: { x: 70, z: -26.5 },
    boardFn() { st.riding = true; return true; },
    update(dt) {
      st.angle += dt * (TAU / 6);
      st.wob += dt * 0.9;
      disc.rotation.y = st.angle;
      disc.rotation.x = 0.16 * Math.sin(st.wob);
      disc.rotation.z = 0.16 * Math.cos(st.wob);
    },
    rider() {
      disc.updateMatrixWorld(true);
      _v.set(3.0, 0.2, 0);
      disc.localToWorld(_v);
      const a = st.angle;
      return { x: _v.x, y: _v.y, z: _v.z,
               ry: Math.atan2(Math.cos(a), -Math.sin(a)) };
    },
    unboard() { st.riding = false; },
    debug() { return { angle: st.angle }; },
  };
}

// --- Bom-bom car (93,-48.25) arena 14x7,5 — KENDARAI ---
// Arena BARU (Lane A, 2026-11-23): 14 x 7,5 m = 105 m2, ~1,6x luas arena
// lama (8x8 = 64 m2). Rect dipilih dari survei sudut timur-laut zona
// (x besar, z kecil — penamaan ikut physics.js: danau (58,-58) = timur laut):
//   NM_RECT utama x 58..103, z -50..44 + annex x 74..104, z -55..-45.
//   Batas DATAR-PENUH (mask terrain = 1; butuh jarak >= 3 m dari tepi rect):
//   utara z >= -52 (annex), timur x <= 100 (rect utama), selatan z <= -44,5
//   (0,7 m sebelum collider komidi putar z=-43,8), barat x >= 86 (1,2 m
//   dari collider kursi terbang x=84,8). -> x 86..100, z -52..-44,5.
//   Tetangga: komidi putar (94,-40) di selatan, kursi terbang (82,-48) di
//   barat, tagada (70,-32) jauh di barat-daya, tong motor (98,-32) di selatan.
//   Gerbang di pagar selatan (celah x 97,5..99,5); board/exit (98,5,-42,8)
//   di koridor timur komidi — bisa dijangkau pejalan kaki dari selatan.
//   Rel coaster oval lewat DI ATAS (y=8) — truss arena 4,4 m aman di bawahnya.
//   Titik minimap nm-zone.js (96,-48) tetap berada DI DALAM arena baru,
//   jadi file itu tidak perlu diubah.
const ARENA_CX = 93, ARENA_CZ = -48.25, ARENA_HW = 7, ARENA_HD = 3.75;
function makeBumper() {
  const gy = ground(ARENA_CX, ARENA_CZ);
  const g = new T.Group();
  g.position.set(ARENA_CX, gy, ARENA_CZ);
  const LIM_X = ARENA_HW - 0.8; // 6,2 — setengah lebar dikurangi setengah mobil
  const LIM_Z = ARENA_HD - 0.8; // 2,95
  const _dummy = new T.Object3D();

  // --- Lantai licin mengkilap (Phong shininess tinggi, warna terang) ---
  const floor = box(14, 0.15, 7.5,
    phong(0xdfe9f2, { shininess: 140, specular: 0xffffff }), 0, 0.08, 0);
  g.add(floor);
  g.add(cyl(1.6, 1.6, 0.03, lam(C.gold), 0, 0.17, 0, 20));
  g.add(cyl(0.55, 0.55, 0.032, lam(C.red), 0, 0.175, 0, 16));

  // --- Pagar keliling (rel merah + tiang krem), celah gerbang selatan ---
  const GATE = { min: 4.5, max: 6.5 }; // X lokal, di pagar selatan
  const railMat = lam(C.red);
  const rail = (w, d, x, y, z) => g.add(box(w, 0.1, d, railMat, x, y, z));
  for (const y of [0.95, 0.5]) { // rel atas + tengah
    rail(14, 0.12, 0, y, -ARENA_HD); // utara penuh
    rail(11.5, 0.12, -1.25, y, ARENA_HD); // selatan kiri (-7..4,5)
    rail(0.5, 0.12, 6.75, y, ARENA_HD); // selatan kanan (6,5..7)
    rail(0.12, 7.5, -ARENA_HW, y, 0); // barat
    rail(0.12, 7.5, ARENA_HW, y, 0); // timur
  }
  const postPos = [];
  for (let x = -ARENA_HW; x <= ARENA_HW + 0.01; x += 1.15) {
    postPos.push([x, -ARENA_HD]);
    if (x < GATE.min || x > GATE.max) postPos.push([x, ARENA_HD]);
  }
  for (let z = -ARENA_HD + 1.15; z <= ARENA_HD - 1.15 + 0.01; z += 1.15) {
    postPos.push([-ARENA_HW, z]);
    postPos.push([ARENA_HW, z]);
  }
  const posts = new T.InstancedMesh(
    new T.BoxGeometry(0.12, 0.95, 0.12), lam(C.cream), postPos.length);
  postPos.forEach(([px, pz], i) => {
    _dummy.position.set(px, 0.48, pz);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    posts.setMatrixAt(i, _dummy.matrix);
  });
  posts.instanceMatrix.needsUpdate = true;
  g.add(posts);

  // --- Papan neon "BOMBOM CAR" + skor (canvas texture, digambar kode) ---
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512; signCanvas.height = 160;
  const signCtx = signCanvas.getContext('2d');
  const signTex = new T.CanvasTexture(signCanvas);
  if (T.SRGBColorSpace) signTex.colorSpace = T.SRGBColorSpace;
  function drawSign(score) {
    const c = signCtx;
    c.clearRect(0, 0, 512, 160);
    c.fillStyle = '#1d2b53'; c.fillRect(0, 0, 512, 160); // --lh-ink
    c.strokeStyle = '#ff9f1c'; c.lineWidth = 8; c.strokeRect(6, 6, 500, 148);
    c.strokeStyle = '#ff8fb3'; c.lineWidth = 3; c.strokeRect(16, 16, 480, 128);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '800 58px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Trebuchet MS", system-ui, sans-serif';
    c.shadowColor = '#ff5c8a'; c.shadowBlur = 18;
    c.fillStyle = '#fff3d6';
    c.fillText('BOMBOM CAR', 256, 58);
    c.shadowBlur = 0;
    c.font = '800 40px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Trebuchet MS", system-ui, sans-serif';
    c.shadowColor = '#2fbf4a'; c.shadowBlur = 12;
    c.fillStyle = '#8dff9e';
    c.fillText('SKOR  ' + score, 256, 122);
    c.shadowBlur = 0;
    signTex.needsUpdate = true;
  }
  drawSign(0);
  // Dua sisi (selatan menghadap pasar, utara menghadap ke dalam arena —
  // pengemudi yang menghadap utara tetap bisa membaca skornya).
  const signMat = new T.MeshBasicMaterial({ map: signTex });
  const signGeo = new T.PlaneGeometry(6.4, 2.0);
  const signBackMat = emi(C.gold, 1.2);
  for (const sz of [1, -1]) {
    g.add(box(6.7, 2.3, 0.08, signBackMat, 0, 3.3, sz * (ARENA_HD + 0.12)));
    const plane = mesh(signGeo, signMat, 0, 3.3, sz * (ARENA_HD + 0.17));
    if (sz < 0) plane.rotation.y = Math.PI;
    g.add(plane);
  }

  // --- Truss neon di atas (tiang sudut + balok atas + bola warna-warni) ---
  // TANPA PointLight baru (aturan performa: lampu zona ikut culling; lampu
  // baru tidak ikut) — semua cahaya dari material emissive/basic saja.
  const trussMat = lam(C.woodDark);
  for (const [sx, sz] of [[-6.6, -3.4], [6.6, -3.4], [-6.6, 3.4], [6.6, 3.4]]) {
    g.add(cyl(0.09, 0.09, 4.4, trussMat, sx, 2.2, sz, 6));
  }
  const beam = (w, d, x, z) => g.add(box(w, 0.14, d, trussMat, x, 4.4, z));
  beam(13.2, 0.14, 0, -3.4);
  beam(13.2, 0.14, 0, 3.4);
  beam(0.14, 6.8, -6.6, 0);
  beam(0.14, 6.8, 6.6, 0);
  beam(13.2, 0.12, 0, 0); // balok tengah
  const bulbPos = [];
  for (let x = -6.6; x <= 6.61; x += 1.2) {
    bulbPos.push([x, 4.4, -3.4]); bulbPos.push([x, 4.4, 3.4]); bulbPos.push([x, 4.55, 0]);
  }
  for (let z = -2.2; z <= 2.21; z += 1.1) {
    bulbPos.push([-6.6, 4.4, z]); bulbPos.push([6.6, 4.4, z]);
  }
  const bulbCols = [C.red, C.yellow, C.teal, C.pink, C.green, C.gold];
  const bulbs = new T.InstancedMesh(
    new T.SphereGeometry(0.14, 8, 6),
    new T.MeshBasicMaterial({ color: 0xffffff }), bulbPos.length);
  bulbPos.forEach(([bx, by, bz], i) => {
    _dummy.position.set(bx, by, bz);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.setScalar(1);
    _dummy.updateMatrix();
    bulbs.setMatrixAt(i, _dummy.matrix);
    bulbs.setColorAt(i, new T.Color(bulbCols[i % bulbCols.length]));
  });
  bulbs.instanceMatrix.needsUpdate = true;
  if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
  g.add(bulbs);

  // --- Penonton siluet di balik pagar (6 figur gelap; 2 melambai pelan) ---
  // Berdiri di tanah masing-masing (ground() sendiri) — strip utara tidak
  // sepenuhnya rata, jadi tidak ditempel ke gy arena.
  const specCols = [0x241d1a, 0x2e2a26, 0x3a2b4d, 0x1d2b1a, 0x33241d, 0x26262e];
  const specSpots = [
    { x: -4.5, z: -4.6, s: 1.0, wave: false },
    { x: -1.5, z: -4.6, s: 1.08, wave: true },
    { x: 1.5, z: -4.6, s: 0.95, wave: false },
    { x: 4.5, z: -4.6, s: 1.04, wave: false },
    { x: 7.7, z: -2.0, s: 1.0, wave: true },
    { x: 7.7, z: 0.5, s: 0.92, wave: false },
  ];
  const wavers = [];
  for (const [i, sp] of specSpots.entries()) {
    const fig = new T.Group();
    const mat = lam(specCols[i % specCols.length]);
    fig.add(box(0.46, 1.1, 0.3, mat, 0, 0.55, 0));
    fig.add(sph(0.17, mat, 0, 1.28, 0, 8, 6));
    if (sp.wave) {
      const pivot = new T.Group();
      pivot.position.set(0.28, 1.02, 0);
      pivot.add(box(0.1, 0.55, 0.1, mat, 0, 0.22, 0));
      fig.add(pivot);
      wavers.push({ pivot, phase: i * 1.3 });
    }
    fig.scale.setScalar(sp.s);
    fig.position.set(sp.x, ground(ARENA_CX + sp.x, ARENA_CZ + sp.z) - gy, sp.z);
    g.add(fig);
  }

  // --- Mobil (1 pemain + 3 bot) — visual sama seperti arena lama ---
  const carCols = [C.red, C.yellow, C.teal, C.pink];
  const cars = [];
  const starts = [[0, 2], [-4, -1.5], [4, -1.5], [0, -2.5]];
  for (let i = 0; i < 4; i++) {
    const cg = new T.Group();
    const carBody = box(1.15, 0.45, 1.6, lam(carCols[i]), 0, 0.45, 0, true);
    outline(carBody, 1.08);
    cg.add(carBody);
    cg.add(box(0.95, 0.5, 0.8, lam(C.cream), 0, 0.85, -0.15));
    cg.add(cyl(0.04, 0.04, 1.9, lam(C.black), 0, 1.4, -0.6, 4));
    cg.add(sph(0.09, emi(C.yellow, 1.5), 0, 2.4, -0.6, 6, 6));
    g.add(cg);
    cars.push({
      g: cg, x: starts[i][0], z: starts[i][1], heading: (i * Math.PI) / 2,
      vx: 0, vz: 0, target: null, retarget: 0,
      botIndex: i === 0 ? -1 : i - 1, driver: null,
    });
  }

  // --- Skor tabrakan (pemain + tiap bot) ---
  const scores = { player: 0, bots: [0, 0, 0] };

  // --- Percikan tabrakan: pool 48 partikel (6 burst x 8), tanpa alokasi ---
  const SPARK_N = 48;
  const sparks = new T.InstancedMesh(
    new T.SphereGeometry(0.12, 6, 5),
    new T.MeshBasicMaterial({ color: 0xffc93c }), SPARK_N);
  const sparkP = [];
  for (let i = 0; i < SPARK_N; i++) {
    sparkP.push({ life: 0, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0 });
  }
  for (let i = 0; i < SPARK_N; i++) {
    _dummy.position.set(0, -10, 0);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.setScalar(0);
    _dummy.updateMatrix();
    sparks.setMatrixAt(i, _dummy.matrix);
  }
  sparks.instanceMatrix.needsUpdate = true;
  g.add(sparks);
  let sparksActive = 0, sparksTotal = 0;
  let lastHit = null; // {t, x, z} tabrakan terakhir (koordinat lokal)
  function spawnBurst(x, z) {
    let spawned = 0;
    for (let i = 0; i < SPARK_N && spawned < 8; i++) {
      const p = sparkP[i];
      if (p.life > 0) continue;
      const a = Math.random() * TAU;
      const sp = 1.5 + Math.random() * 2;
      p.life = 0.5; p.x = x; p.y = 0.5; p.z = z;
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 1 + Math.random() * 1.5;
      spawned++;
    }
    if (spawned > 0) { sparksActive += spawned; sparksTotal++; }
  }
  function updateSparks(dt) {
    if (sparksActive === 0) return;
    let alive = 0;
    for (let i = 0; i < SPARK_N; i++) {
      const p = sparkP[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.y = -10;
        _dummy.position.set(0, -10, 0);
        _dummy.scale.setScalar(0);
      } else {
        p.vy -= 6 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.2) { p.y = 0.2; p.vy = Math.abs(p.vy) * 0.4; }
        _dummy.position.set(p.x, p.y, p.z);
        _dummy.scale.setScalar(Math.min(1, p.life / 0.15));
        alive++;
      }
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      sparks.setMatrixAt(i, _dummy.matrix);
    }
    sparksActive = alive;
    sparks.instanceMatrix.needsUpdate = true;
  }

  // --- Driver bot (SEAM Lane B): fn(car, dt, api) -> {fwd, steer} ---
  // car = {x, z, heading, vx, vz, ...} (koordinat lokal arena);
  // api = {cars, playerCar, bounds:{minX,maxX,minZ,maxZ}} (bounds lokal).
  // Default = AI lama (kejar titik acak). setBotDriver(botIndex 0..2,
  // fn|null): botIndex 0 = cars[1]; null = kembali ke default.
  const bounds = { minX: -LIM_X, maxX: LIM_X, minZ: -LIM_Z, maxZ: LIM_Z };
  const driverApi = { cars, playerCar: cars[0], bounds };
  function defaultBotDriver(car, dt) {
    car.retarget -= dt;
    if (!car.target || car.retarget <= 0
      || Math.hypot(car.target[0] - car.x, car.target[1] - car.z) < 0.8) {
      car.target = [(Math.random() * 2 - 1) * LIM_X * 0.8,
        (Math.random() * 2 - 1) * LIM_Z * 0.8];
      car.retarget = 4;
    }
    const dx = car.target[0] - car.x, dz = car.target[1] - car.z;
    const want = Math.atan2(dx, dz);
    let dh = want - car.heading;
    while (dh > Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    return { fwd: 1, steer: clamp(dh * 1.5, -1, 1) };
  }
  function setBotDriver(botIndex, fn) {
    const car = cars[(botIndex | 0) + 1];
    if (!car || (fn !== null && typeof fn !== 'function')) return false;
    car.driver = fn;
    return true;
  }

  const st = { driving: false, t: 0 };
  function stepCar(c, dt, input) {
    let ax = 0, az = 0;
    if (input) {
      const mv = input.moveVector ? input.moveVector() : { x: 0, y: 0, mag: 0 };
      const fwd = -mv.y; // y=-1 = maju
      const steer = mv.x;
      c.heading += steer * 1.9 * dt * (fwd >= 0 ? 1 : -1);
      ax = Math.sin(c.heading) * fwd * 9;
      az = Math.cos(c.heading) * fwd * 9;
    } else {
      // AI: kejar titik acak, ganti tiap 4 dtk / saat sampai.
      // (Mobil pemain saat belum dinaiki ikut berkeliling seperti bot —
      // perilaku arena lama dipertahankan.)
      c.retarget -= dt;
      if (!c.target || c.retarget <= 0
        || Math.hypot(c.target[0] - c.x, c.target[1] - c.z) < 0.8) {
        c.target = [(Math.random() * 2 - 1) * LIM_X * 0.8,
          (Math.random() * 2 - 1) * LIM_Z * 0.8];
        c.retarget = 4;
      }
      const dx = c.target[0] - c.x, dz = c.target[1] - c.z;
      const want = Math.atan2(dx, dz);
      let dh = want - c.heading;
      while (dh > Math.PI) dh -= TAU;
      while (dh < -Math.PI) dh += TAU;
      c.heading += clamp(dh, -1.6 * dt, 1.6 * dt);
      ax = Math.sin(c.heading) * 6;
      az = Math.cos(c.heading) * 6;
    }
    // Integrator eksponensial eksak untuk dv/dt = a - 1.6*v: benar untuk dt
    // berapa pun (Euler v+=a*dt lalu *=exp(-k*dt) meremehkan kecepatan
    // parah saat dt besar — mobil nyaris diam di frame lambat).
    const damp = Math.exp(-1.6 * dt);
    c.vx = c.vx * damp + ax * (1 - damp) / 1.6;
    c.vz = c.vz * damp + az * (1 - damp) / 1.6;
    const sp = Math.hypot(c.vx, c.vz);
    const max = input ? 4.2 : 2.6;
    if (sp > max) { c.vx *= max / sp; c.vz *= max / sp; }
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    if (c.x < -LIM_X) { c.x = -LIM_X; c.vx = Math.abs(c.vx) * 0.5; }
    if (c.x > LIM_X) { c.x = LIM_X; c.vx = -Math.abs(c.vx) * 0.5; }
    if (c.z < -LIM_Z) { c.z = -LIM_Z; c.vz = Math.abs(c.vz) * 0.5; }
    if (c.z > LIM_Z) { c.z = LIM_Z; c.vz = -Math.abs(c.vz) * 0.5; }
    c.g.position.set(c.x, 0.15, c.z);
    c.g.rotation.y = c.heading;
  }
  function stepBot(c, dt) {
    let out = null;
    try { out = c.driver ? c.driver(c, dt, driverApi) : defaultBotDriver(c, dt); }
    catch (e) { out = null; }
    const fwd = clamp(out && typeof out.fwd === 'number' ? out.fwd : 0, -1, 1);
    const steer = clamp(out && typeof out.steer === 'number' ? out.steer : 0, -1, 1);
    c.heading += steer * 1.9 * dt * (fwd >= 0 ? 1 : -1);
    const ax = Math.sin(c.heading) * fwd * 6;
    const az = Math.cos(c.heading) * fwd * 6;
    const damp = Math.exp(-1.6 * dt);
    c.vx = c.vx * damp + ax * (1 - damp) / 1.6;
    c.vz = c.vz * damp + az * (1 - damp) / 1.6;
    const sp = Math.hypot(c.vx, c.vz);
    if (sp > 2.6) { c.vx *= 2.6 / sp; c.vz *= 2.6 / sp; }
    c.x += c.vx * dt;
    c.z += c.vz * dt;
    if (c.x < -LIM_X) { c.x = -LIM_X; c.vx = Math.abs(c.vx) * 0.5; }
    if (c.x > LIM_X) { c.x = LIM_X; c.vx = -Math.abs(c.vx) * 0.5; }
    if (c.z < -LIM_Z) { c.z = -LIM_Z; c.vz = Math.abs(c.vz) * 0.5; }
    if (c.z > LIM_Z) { c.z = LIM_Z; c.vz = -Math.abs(c.vz) * 0.5; }
    c.g.position.set(c.x, 0.15, c.z);
    c.g.rotation.y = c.heading;
  }
  const lastHitAt = {}; // "i-j" -> st.t terakhir (cooldown 0,6 dtk/pasangan)
  function collideCars(now, h) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.7 && d > 0.01) {
          const push = (1.7 - d) / 2;
          const nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
          // Kecepatan relatif sepanjang normal (sebelum tukar velocity).
          const relN = Math.abs((b.vx - a.vx) * nx + (b.vz - a.vz) * nz);
          const tvx = a.vx; a.vx = b.vx * 0.6; b.vx = tvx * 0.6;
          const tvz = a.vz; a.vz = b.vz * 0.6; b.vz = tvz * 0.6;
          // Tabrakan "nyata": benturan cukup keras + cooldown per pasangan
          // 0,6 dtk (kontak menempel tidak menaikkan skor berulang).
          const key = i + '-' + j;
          if (relN > 1.2 && now - (lastHitAt[key] ?? -99) > 0.6) {
            lastHitAt[key] = now;
            lastHit = { t: +now.toFixed(2), x: +((a.x + b.x) / 2).toFixed(2), z: +((a.z + b.z) / 2).toFixed(2) };
            spawnBurst(lastHit.x, lastHit.z);
            if (i > 0) scores.bots[i - 1] += 1;
            if (j > 0) scores.bots[j - 1] += 1;
            // Skor pemain HANYA saat sedang mengemudi (st.driving): saat
            // belum naik, cars[0] hanya mobil AI keempat — tabrakannya
            // bukan skor pemain (skor di-reset tiap boardFn).
            if (st.driving && (i === 0 || j === 0)) {
              scores.player += 1;
              drawSign(scores.player);
              lhSfx('DUAR!'); // momen perayaan: skor pemain bertambah
              // 'eat' = 2 nada triangle rendah — sfx tabrakan ('bump') belum
              // ada di audio.js; ini yang paling dekat dengan bunyi benturan
              // (lihat REPORT lane A — usulan follow-up di luar file ini).
              h?.sfx?.play?.('eat');
            }
          }
        }
      }
    }
  }
  return {
    id: 'bumper', group: g,
    colliders: [
      { minX: 86, maxX: 100, minZ: -52.3, maxZ: -51.7 }, // utara
      { minX: 86, maxX: 97.5, minZ: -44.8, maxZ: -44.2 }, // selatan kiri
      { minX: 99.5, maxX: 100, minZ: -44.8, maxZ: -44.2 }, // selatan kanan
      { minX: 85.7, maxX: 86.3, minZ: -52, maxZ: -44.5 }, // barat
      { minX: 99.7, maxX: 100.3, minZ: -52, maxZ: -44.5 }, // timur
    ],
    board: { x: 98.5, z: -42.8, r: 3 }, exit: { x: 98.5, z: -42.8 },
    boardFn() {
      st.driving = true;
      scores.player = 0; scores.bots = [0, 0, 0];
      drawSign(0);
      return true;
    },
    update(dt, game, h) {
      st.t += dt;
      stepCar(cars[0], dt, st.driving ? game?.input : null);
      for (let i = 1; i < 4; i++) stepBot(cars[i], dt);
      collideCars(st.t, h);
      updateSparks(dt);
      // Penonton melambai + bola truss berdenyut (pakai st.t = waktu game).
      for (const w of wavers) {
        w.pivot.rotation.z = -2.2 + Math.sin(st.t * 2.2 + w.phase) * 0.35;
      }
      for (let i = 0; i < bulbPos.length; i++) {
        const s = 0.85 + 0.25 * Math.sin(st.t * 3 + i * 0.7);
        _dummy.position.set(bulbPos[i][0], bulbPos[i][1], bulbPos[i][2]);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.setScalar(s);
        _dummy.updateMatrix();
        bulbs.setMatrixAt(i, _dummy.matrix);
      }
      bulbs.instanceMatrix.needsUpdate = true;
    },
    rider() {
      const c = cars[0];
      return { x: ARENA_CX + c.x, y: gy + 0.4, z: ARENA_CZ + c.z, ry: c.heading };
    },
    unboard() {
      st.driving = false;
      const c = cars[0];
      c.vx = 0; c.vz = 0; c.x = 0; c.z = 2;
      c.g.position.set(0, 0.15, 2);
    },
    debug() {
      return {
        car0: { x: cars[0].x, z: cars[0].z, heading: cars[0].heading },
        cars: cars.map((c, i) => ({
          x: +c.x.toFixed(2), z: +c.z.toFixed(2),
          heading: +c.heading.toFixed(2),
          vx: +c.vx.toFixed(2), vz: +c.vz.toFixed(2),
          score: i === 0 ? scores.player : scores.bots[i - 1],
        })),
        scores: { player: scores.player, bots: [...scores.bots] },
        sparksActive, sparksTotal, lastHit,
      };
    },
    // SEAM BOT (Lane B): {cars, scores:{player, bots[]}, setBotDriver(i, fn)}.
    // cars = array live mobil (cars[0] pemain); setBotDriver(botIndex 0..2,
    // fn|null) — botIndex 0 = cars[1]; fn(car, dt, api) -> {fwd, steer}.
    arena: { cars, scores, setBotDriver },
  };
}

// --- Roller coaster mini (oval x 64..98, z -50..-28, tinggi ~8 m) ---
// Rel 8 m (melewati kursi terbang 7 m) + stasiun di ujung barat (64,-39).
function makeCoaster() {
  const gy = ground(64, -39);
  const TY = gy + 8; // tinggi rel
  const g = new T.Group();
  const trackMat = lam(C.red), supMat = lam(C.wood);
  const per = COASTER.per;
  // Rel: segmen tiap 3 m + bantalan.
  for (let s = 0; s < per; s += 3) {
    const p = ovalPoint(s);
    const seg = box(3.1, 0.18, 0.55, trackMat, p.x, TY, p.z);
    seg.rotation.y = Math.atan2(p.dx, p.dz);
    g.add(seg);
    const tie = box(0.5, 0.1, 1.0, supMat, p.x, TY - 0.14, p.z);
    tie.rotation.y = Math.atan2(p.dx, p.dz);
    g.add(tie);
  }
  // Penyangga: tiap ~7.8 m, dari tanah masing-masing ke rel.
  for (let s = 1.5; s < per; s += 7.8) {
    const p = ovalPoint(s);
    const gy2 = ground(p.x, p.z);
    g.add(cyl(0.14, 0.18, TY - gy2, supMat, p.x, (TY + gy2) / 2, p.z, 6));
  }
  // Stasiun: peron setinggi rel + atap + loket.
  g.add(box(5, 0.5, 3, lam(C.woodLight), 64, gy + 7.4, -36.2, true));
  for (const [px, pz] of [[62, -37.4], [66, -37.4], [62, -35], [66, -35]]) {
    g.add(cyl(0.09, 0.09, 7.4, supMat, px, gy + 3.7, pz, 6));
  }
  g.add(box(5.4, 0.18, 3.4, lam(C.teal), 64, gy + 9.9, -36.2));
  g.add(box(2.2, 2.2, 1.6, lam(C.cream), 61, gy + 1.1, -39, true));
  g.add(box(2.4, 0.16, 1.8, lam(C.red), 61, gy + 2.3, -39));
  // Kereta: 3 gerbong.
  const cars = [];
  for (let i = 0; i < 3; i++) {
    const cg = new T.Group();
    const carBody = box(1.1, 0.6, 1.9, lam(i === 0 ? C.red : C.yellow), 0, 0.45, 0, true);
    outline(carBody, 1.07);
    cg.add(carBody);
    cg.add(box(0.9, 0.5, 1.2, lam(C.cream), 0, 0.95, -0.1));
    g.add(cg);
    cars.push(cg);
  }
  const st = { s: 0, dwell: 4, laps: 0 };
  function placeCars() {
    for (let i = 0; i < 3; i++) {
      const p = ovalPoint(st.s - i * 2.4);
      cars[i].position.set(p.x, TY + 0.15, p.z);
      cars[i].rotation.y = Math.atan2(p.dx, p.dz);
    }
  }
  placeCars();
  return {
    id: 'coaster', group: g,
    colliders: [{ minX: 60, maxX: 62, minZ: -40, maxZ: -38 }],
    board: { x: 64, z: -36, r: 3 }, exit: { x: 64, z: -36 },
    boardFn() {
      if (st.dwell <= 0) return false; // kereta sedang jalan
      return true;
    },
    update(dt) {
      if (st.dwell > 0) {
        st.dwell -= dt;
      } else {
        st.s += 6 * dt;
        if (st.s >= per) {
          st.s -= per;
          st.dwell = 4;
          st.laps += 1;
        }
      }
      placeCars();
    },
    rider() {
      const p = ovalPoint(st.s);
      return { x: p.x, y: TY + 0.45, z: p.z, ry: Math.atan2(p.dx, p.dz) };
    },
    unboard() {},
    debug() { return { s: st.s, dwell: st.dwell, laps: st.laps }; },
  };
}

// --- Kereta mini + odong-odong: loop rel tanah (x 62..94, z -22..22) ---
// Satu loop, dua kendaraan, kecepatan sama, fase beda setengah loop —
// keduanya berhenti 5 dtk di stasiun (62,18) tiap putaran.
function makeLoopTrain(kind) {
  const isTrain = kind === 'train';
  const gy = ground(62, 18);
  const g = new T.Group();
  const railMat = lam(0x3a3a3a);
  // Rel: 4 sisi lurus + bantalan tiap 4 m.
  const rails = [
    { w: 0.5, d: 44, x: 62, z: 0 }, { w: 0.5, d: 44, x: 94, z: 0 },
    { w: 32, d: 0.5, x: 78, z: -22 }, { w: 32, d: 0.5, x: 78, z: 22 },
  ];
  for (const r of rails) g.add(box(r.w, 0.12, r.d, railMat, r.x, gy + 0.08, r.z));
  for (let z = -22; z <= 22; z += 4) {
    g.add(box(1.3, 0.07, 0.32, lam(C.woodDark), 62, gy + 0.05, z));
    g.add(box(1.3, 0.07, 0.32, lam(C.woodDark), 94, gy + 0.05, z));
  }
  for (let x = 62; x <= 94; x += 4) {
    g.add(box(0.32, 0.07, 1.3, lam(C.woodDark), x, gy + 0.05, -22));
    g.add(box(0.32, 0.07, 1.3, lam(C.woodDark), x, gy + 0.05, 22));
  }
  if (isTrain) {
    // Stasiun: peron + atap + bangku (hanya sekali — di kendaraan kereta).
    g.add(box(3, 0.4, 7, lam(C.woodLight), 60, gy + 0.2, 18, true));
    for (const [px, pz] of [[58.8, 15], [58.8, 21], [61.2, 15], [61.2, 21]]) {
      g.add(cyl(0.08, 0.08, 2.4, lam(C.woodDark), px, gy + 1.6, pz, 6));
    }
    g.add(box(3.6, 0.16, 7.4, lam(C.teal), 60, gy + 2.9, 18));
    g.add(box(1.6, 0.5, 0.6, lam(C.wood), 60, gy + 0.75, 18));
  }
  // Kendaraan.
  const veh = new T.Group();
  if (isTrain) {
    const loco = new T.Group();
    const locoBody = box(1.3, 0.9, 2.2, lam(C.red), 0, 0.75, 0, true);
    outline(locoBody, 1.06);
    loco.add(locoBody);
    loco.add(box(0.9, 0.7, 0.9, lam(C.cream), 0, 1.5, -0.3));
    loco.add(cyl(0.14, 0.18, 0.7, lam(C.black), 0, 1.5, 0.85, 6));
    veh.add(loco);
    for (let i = 1; i <= 2; i++) {
      const car = new T.Group();
      car.add(box(1.2, 0.7, 1.7, lam(C.green), 0, 0.65, 0, true));
      car.add(box(1.0, 0.4, 1.2, lam(C.cream), 0, 1.15, 0));
      car.position.z = -i * 2.4;
      veh.add(car);
    }
  } else {
    const car = new T.Group();
    const odongBody = box(1.3, 0.7, 2.1, lam(C.yellow), 0, 0.7, 0, true);
    outline(odongBody, 1.06);
    car.add(odongBody);
    car.add(box(1.35, 0.14, 2.2, lam(C.pink), 0, 1.35, 0));
    for (const [sx, sz] of [[-0.5, -0.9], [0.5, -0.9], [-0.5, 0.9], [0.5, 0.9]]) {
      car.add(cyl(0.05, 0.05, 0.6, lam(C.woodDark), sx, 1.05, sz, 4));
    }
    car.add(box(1.4, 0.16, 2.3, lam(C.pink), 0, 1.4, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      car.add(sph(0.09, emi(i % 2 ? C.yellow : C.teal, 1.8),
        0.7 * Math.cos(a), 1.5, 0.7 * Math.sin(a) * 1.4, 6, 6));
    }
    veh.add(car);
  }
  g.add(veh);
  const st = { s: isTrain ? 0 : 76, dwell: isTrain ? 5 : 0, laps: 0 };
  function place() {
    const p = rectLoopPoint(st.s);
    veh.position.set(p.x, gy + 0.15, p.z);
    veh.rotation.y = Math.atan2(p.dx, p.dz);
  }
  place();
  return {
    id: kind, group: g,
    colliders: isTrain ? [{ minX: 59.3, maxX: 60.7, minZ: 17, maxZ: 19 }] : [],
    board: isTrain ? { x: 62, z: 16.5, r: 3 } : { x: 62, z: 19.5, r: 3 },
    exit: { x: 62, z: 18 },
    boardFn() {
      if (st.dwell <= 0) return false;
      return true;
    },
    update(dt) {
      if (st.dwell > 0) {
        st.dwell -= dt;
      } else {
        st.s += 4.5 * dt;
        if (st.s >= 152) {
          st.s -= 152;
          st.dwell = 5;
          st.laps += 1;
        }
      }
      place();
    },
    rider() {
      const p = rectLoopPoint(st.s);
      return { x: p.x, y: gy + 0.5, z: p.z, ry: Math.atan2(p.dx, p.dz) };
    },
    unboard() {},
    debug() { return { s: st.s, dwell: st.dwell, laps: st.laps }; },
  };
}

// --- Becak mini (64,20) — KENDARAI bebas di zona ---
function makeBecak() {
  const gy = ground(64, 20);
  const g = new T.Group();
  const veh = new T.Group();
  veh.add(box(1.0, 0.22, 1.9, lam(C.teal), 0, 0.45, 0, true));
  veh.add(box(0.95, 0.5, 0.7, lam(C.yellow), 0, 0.8, 0.55)); // bangku penumpang
  veh.add(box(0.95, 0.4, 0.5, lam(C.cream), 0, 0.75, -0.55)); // sadel pengemudi
  // Kanopi.
  veh.add(box(1.1, 0.08, 1.1, lam(C.pink), 0, 1.7, 0.4));
  for (const [sx, sz] of [[-0.5, -0.05], [0.5, -0.05], [-0.5, 0.85], [0.5, 0.85]]) {
    veh.add(cyl(0.04, 0.04, 0.9, lam(C.woodDark), sx, 1.25, sz, 4));
  }
  // Roda: 2 belakang + 1 depan.
  for (const [wx, wz, r] of [[-0.55, -0.7, 0.36], [0.55, -0.7, 0.36], [0, 0.85, 0.3]]) {
    const w = mesh(new T.TorusGeometry(r, 0.05, 6, 14), lam(C.black), wx, r, wz);
    w.rotation.y = Math.PI / 2;
    veh.add(w);
  }
  veh.add(box(0.5, 0.06, 0.06, lam(C.woodDark), 0, 1.05, -0.85)); // setang
  g.add(veh);
  const st = { x: 64, z: 20, heading: 0, speed: 0, driving: false };
  function place() {
    const y = ground(st.x, st.z);
    veh.position.set(st.x, y + 0.1, st.z);
    veh.rotation.y = st.heading;
  }
  place();
  return {
    id: 'becak', group: g,
    colliders: [],
    board: { x: 64, z: 20, r: 3 }, exit: { x: 64, z: 20 },
    boardFn() { st.driving = true; return true; },
    update(dt, game) {
      if (!st.driving) return;
      const mv = game?.input?.moveVector ? game.input.moveVector() : { x: 0, y: 0, mag: 0 };
      const fwd = -mv.y;
      st.heading += mv.x * 1.7 * dt * (st.speed >= 0 ? 1 : -1);
      // Integrator eksponensial eksak untuk dv/dt = a - 1.2*v (a = fwd*6):
      // benar untuk dt berapa pun; Euler meremehkan kecepatan saat dt besar.
      const dampBk = Math.exp(-1.2 * dt);
      st.speed = st.speed * dampBk + (fwd * 6 / 1.2) * (1 - dampBk);
      st.speed = clamp(st.speed, -2, 5);
      st.x += Math.sin(st.heading) * st.speed * dt;
      st.z += Math.cos(st.heading) * st.speed * dt;
      // Tetap di dalam zona pasar malam.
      if (st.x < 59) { st.x = 59; st.speed *= 0.4; }
      if (st.x > 101) { st.x = 101; st.speed *= 0.4; }
      if (st.z < -49) { st.z = -49; st.speed *= 0.4; }
      if (st.z > 43) { st.z = 43; st.speed *= 0.4; }
      place();
    },
    rider() {
      const y = ground(st.x, st.z);
      return { x: st.x + Math.sin(st.heading) * 0.3,
               y: y + 0.65,
               z: st.z + Math.cos(st.heading) * 0.3, ry: st.heading };
    },
    unboard() {
      // Becak kembali ke pangkalan; pemain turun di sana.
      st.driving = false;
      st.x = 64; st.z = 20; st.heading = 0; st.speed = 0;
      place();
    },
    debug() { return { x: st.x, z: st.z, speed: st.speed, heading: st.heading }; },
  };
}

// --- Rumah hantu (71,35) 16x10 — jalan masuk, gelap + kejutan ringan ---
function makeHaunted() {
  const gy = ground(71, 35);
  const g = new T.Group();
  g.position.set(71, gy, 35);
  const wall = lam(C.haunted), roof = lam(C.hauntedRoof);
  const mkWall = (w, h, d, x, y, z) => g.add(box(w, h, d, wall, x, y, z, true));
  mkWall(16, 3.2, 0.3, 0, 1.6, -5);   // utara
  mkWall(16, 3.2, 0.3, 0, 1.6, 5);    // selatan
  mkWall(0.3, 3.2, 10, 8, 1.6, 0);    // timur
  mkWall(0.3, 3.2, 3, -8, 1.6, -3.5); // barat utara (celah z 33..37)
  mkWall(0.3, 3.2, 3, -8, 1.6, 3.5);  // barat selatan
  // Atap pelana + cerobong miring + papan nama.
  const r1 = box(16.6, 0.16, 5.8, roof, 0, 4.1, -2.4);
  r1.rotation.x = 0.5;
  const r2 = box(16.6, 0.16, 5.8, roof, 0, 4.1, 2.4);
  r2.rotation.x = -0.5;
  g.add(r1, r2);
  const chim = box(0.8, 1.6, 0.8, wall, 5, 4.6, 1.5);
  chim.rotation.z = 0.12;
  g.add(chim);
  g.add(box(0.2, 1.1, 2.6, lam(C.red), -8.15, 3.6, 0));
  g.add(box(15.4, 0.12, 9.4, lam(0x1d1426), 0, 0.07, 0)); // lantai dalam
  // Lampu merah redup di dalam.
  const light = new T.PointLight(0xff2a1a, 5, 10, 1.5);
  light.position.set(0, 2.2, 0);
  g.add(light);
  // Kejutan 1: hantu kain putih (67,33) — muncul saat pemain x<68.
  const ghost = new T.Group();
  ghost.add(cone(0.55, 1.4, lam(C.white), 0, 0.7, 0, 8));
  ghost.add(sph(0.09, lam(C.black), -0.18, 1.25, 0.42, 6, 6));
  ghost.add(sph(0.09, lam(C.black), 0.18, 1.25, 0.42, 6, 6));
  ghost.position.set(-4, 0, -2);
  ghost.visible = false;
  g.add(ghost);
  // Kejutan 2: kelelawar (74,38) — mengepak saat pemain z>37.5.
  const bats = new T.Group();
  for (let i = 0; i < 3; i++) {
    const b = new T.Group();
    b.add(box(0.5, 0.06, 0.2, lam(C.black), -0.28, 0, 0));
    b.add(box(0.5, 0.06, 0.2, lam(C.black), 0.28, 0, 0));
    b.add(sph(0.14, lam(C.black), 0, 0, 0, 6, 6));
    b.position.set(-1 + i, 0.3 * (i % 2), 0.4 * i);
    bats.add(b);
  }
  bats.position.set(3, 2.6, 3);
  bats.visible = false;
  g.add(bats);
  // Kejutan 3: wajah hijau (77,32) — menyala saat pemain x>75.5.
  const face = new T.Group();
  face.add(sph(0.55, lam(0x4a8a3a), 0, 0, 0, 10, 8));
  face.add(sph(0.11, emi(C.red, 2), -0.2, 0.15, 0.45, 6, 6));
  face.add(sph(0.11, emi(C.red, 2), 0.2, 0.15, 0.45, 6, 6));
  face.position.set(6, 1.3, -3);
  face.visible = false;
  g.add(face);
  const st = { show1: 0, show2: 0, show3: 0, done1: false, done2: false, done3: false };
  function inside(p) {
    return p && p.x > 63 && p.x < 79 && p.z > 30 && p.z < 40;
  }
  return {
    id: 'haunted', group: g,
    colliders: [
      { minX: 63, maxX: 79, minZ: 29.7, maxZ: 30.3 },
      { minX: 63, maxX: 79, minZ: 39.7, maxZ: 40.3 },
      { minX: 78.7, maxX: 79.3, minZ: 30, maxZ: 40 },
      { minX: 62.7, maxX: 63.3, minZ: 30, maxZ: 33 },
      { minX: 62.7, maxX: 63.3, minZ: 37, maxZ: 40 },
    ],
    board: { x: 62, z: 35, r: 3 }, exit: { x: 61, z: 35 },
    isInside: (game) => inside(game?.player),
    update(dt, game, H) {
      const p = game?.player;
      const inn = inside(p);
      if (!inn) {
        st.done1 = st.done2 = st.done3 = false;
        ghost.visible = false; bats.visible = false; face.visible = false;
        st.show1 = st.show2 = st.show3 = 0;
        return;
      }
      if (p.x < 68 && !st.done1) {
        st.done1 = true; st.show1 = 2.5;
        H?.toast?.(H.t('rideGhost'));
        H?.sfx?.play?.('animal');
      }
      if (p.z > 37.5 && !st.done2) {
        st.done2 = true; st.show2 = 3;
        H?.toast?.(H.t('rideBats'));
        H?.sfx?.play?.('jump');
      }
      if (p.x > 75.5 && !st.done3) {
        st.done3 = true; st.show3 = 2.5;
        H?.toast?.(H.t('rideMonster'));
        H?.sfx?.play?.('error');
      }
      if (st.show1 > 0) {
        st.show1 -= dt;
        ghost.visible = true;
        ghost.position.y = Math.sin(st.show1 * 4) * 0.15 + 0.15;
      } else ghost.visible = false;
      if (st.show2 > 0) {
        st.show2 -= dt;
        bats.visible = true;
        bats.rotation.z = Math.sin(st.show2 * 10) * 0.2;
        bats.position.y = 2.6 + Math.sin(st.show2 * 6) * 0.3;
      } else bats.visible = false;
      if (st.show3 > 0) {
        st.show3 -= dt;
        face.visible = true;
        face.scale.setScalar(1 + Math.sin(st.show3 * 8) * 0.08);
      } else face.visible = false;
    },
    onUse(game, H) {
      const p = game?.player;
      if (!p) return;
      if (inside(p)) {
        p.teleport(61, 35);
        H?.toast?.(H.t('rideHauntedOut'));
      } else {
        p.teleport(65, 35);
        H?.toast?.(H.t('rideHauntedIn'));
      }
    },
    rider: null,
    debug() { return { show1: st.show1, show2: st.show2, show3: st.show3, done1: st.done1, done2: st.done2, done3: st.done3 }; },
  };
}

// ================= HIBURAN AMBIENT =================

// --- Pertunjukan tong stand motor (98,-32) r3 ---
// Motor keliling dinding silinder (miring ke dinding), satu motor parkir.
function makeMotorwall() {
  const gy = ground(98, -32);
  const g = new T.Group();
  g.position.set(98, gy, -32);
  const wallMat = toon(C.wood, { side: T.DoubleSide });
  const wall = mesh(new T.CylinderGeometry(3, 3, 4, 18, 1, true), wallMat, 0, 2, 0, true);
  g.add(wall);
  g.add(mesh(new T.TorusGeometry(3, 0.1, 6, 24), lam(C.red), 0, 4, 0));
  g.children[g.children.length - 1].rotation.x = Math.PI / 2;
  g.add(cyl(3.4, 3.6, 0.3, lam(C.woodDark), 0, 0.15, 0, 18));
  // Motor keliling: badan + 2 roda + pengendara mungil.
  const bike = new T.Group();
  bike.add(box(1.1, 0.3, 0.35, lam(C.red), 0, 0.25, 0));
  for (const sx of [-0.45, 0.45]) {
    const w = mesh(new T.TorusGeometry(0.22, 0.06, 6, 12), lam(C.black), sx, 0.22, 0);
    bike.add(w);
  }
  const riderB = new T.Group();
  riderB.add(box(0.3, 0.55, 0.3, lam(C.teal), 0, 0.65, 0));
  riderB.add(sph(0.18, lam(0xe8b88a), 0, 1.05, 0, 8, 6));
  riderB.add(sph(0.2, lam(C.red), 0, 1.08, 0, 8, 6)); // helm
  bike.add(riderB);
  const lean = new T.Group();
  lean.add(bike);
  lean.rotation.z = 0.85; // miring ke dinding
  g.add(lean);
  // Motor parkir di luar.
  const parked = bike.clone();
  parked.position.set(0, 0.3, 4.6);
  parked.rotation.y = 0.6;
  parked.rotation.z = 0;
  g.add(parked);
  const st = { angle: 0, boost: 0 };
  return {
    id: 'motorwall', group: g,
    colliders: [{ minX: 94.8, maxX: 101.2, minZ: -35.2, maxZ: -28.8 }],
    board: { x: 98, z: -28, r: 3 },
    onUse(game, H) {
      st.boost = 3;
      H?.toast?.(H.t('rideMotorBoost'));
      H?.sfx?.play?.('jump');
    },
    update(dt, game, H) {
      const speed = TAU / 3.5 * (st.boost > 0 ? 1.6 : 1);
      if (st.boost > 0) st.boost -= dt;
      st.angle += speed * dt;
      const a = st.angle;
      lean.position.set(2.2 * Math.cos(a), 2.4, 2.2 * Math.sin(a));
      lean.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI / 2;
    },
    rider: null,
    debug() { return { angle: st.angle, boost: st.boost }; },
  };
}

// --- Sulap: panggung (77,-6) + pesulap + kartu/kelinci/asap ---
function makeMagic() {
  const gy = ground(77, -6);
  const g = new T.Group();
  g.position.set(77, gy, -6);
  g.add(box(6, 0.5, 4, lam(C.wood), 0, 0.25, 0, true));
  g.add(box(6, 3.0, 0.2, lam(C.red), 0, 2.0, -1.9)); // tirai belakang
  g.add(box(0.5, 3.0, 0.4, lam(C.pink), -2.8, 2.0, -1.7));
  g.add(box(0.5, 3.0, 0.4, lam(C.pink), 2.8, 2.0, -1.7));
  for (let i = 0; i < 5; i++) {
    g.add(sph(0.12, emi(C.gold, 1.8), -2 + i, 3.1 + (i % 2) * 0.25, -1.75, 6, 6));
  }
  // Meja + topi + kelinci.
  g.add(box(1.1, 0.8, 0.7, lam(C.woodDark), 1.5, 0.9, -0.5));
  g.add(cyl(0.3, 0.34, 0.35, lam(C.black), 1.5, 1.45, -0.5, 10));
  const rabbit = new T.Group();
  rabbit.add(box(0.34, 0.3, 0.3, lam(C.white), 0, 0.15, 0));
  rabbit.add(cone(0.06, 0.3, lam(C.white), -0.08, 0.45, 0, 6));
  rabbit.add(cone(0.06, 0.3, lam(C.white), 0.08, 0.45, 0, 6));
  rabbit.position.set(1.5, 1.6, -0.5);
  g.add(rabbit);
  // Asap.
  const smoke = sph(0.5, toon(0xfff6e5, {
    transparent: true, opacity: 0 }), 1.5, 1.9, -0.5, 10, 8);
  g.add(smoke);
  // Kartu melayang.
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const c = box(0.28, 0.4, 0.02, lam(C.white), 0, 0, 0);
    g.add(c);
    cards.push(c);
  }
  // Pesulap NPC di atas panggung.
  const magician = makeNpc({
    skin: 'medium', hairStyle: 'short', hairColor: 'grey',
    shirtModel: 'vest', shirtColor: 'black', pantsModel: 'pants', pantsColor: 'black',
    hatModel: 'cap', hatColor: 'black', glassesModel: 'none', glassesColor: 'black',
    shoesModel: 'boots', shoesColor: 'black',
  });
  magician.position.set(-1.2, 0.5, -0.6);
  magician.rotation.y = 0;
  g.add(magician);
  const st = { trick: 0, next: 6 };
  return {
    id: 'magic', group: g, npc: magician,
    colliders: [{ minX: 74, maxX: 80, minZ: -8, maxZ: -4 }],
    board: { x: 77, z: -2.5, r: 3 },
    onUse(game, H) {
      st.trick = 2.2;
      H?.toast?.(H.t('rideMagicTrick'));
      lhSfx('TING!'); // momen perayaan: trik sulap keluar
      H?.sfx?.play?.('harvest');
    },
    update(dt, game, H) {
      st.next -= dt;
      if (st.next <= 0) { st.next = 12; st.trick = 2.2; }
      waveArm(magician, H?.now ?? 0, 0.25);
      for (let i = 0; i < 3; i++) {
        const a = (H?.now ?? 0) * 0.9 + (i * TAU) / 3;
        cards[i].position.set(-1.2 + 0.8 * Math.cos(a), 2.3 + 0.15 * Math.sin((H?.now ?? 0) * 2 + i), -0.6 + 0.8 * Math.sin(a));
        cards[i].rotation.y = a;
      }
      if (st.trick > 0) {
        st.trick -= dt;
        const k = 1 - Math.max(0, st.trick) / 2.2;
        rabbit.position.y = 1.6 + Math.sin(Math.min(1, k * 1.4) * Math.PI) * 0.55;
        smoke.scale.setScalar(0.2 + k * 1.6);
        smoke.material.opacity = 0.6 * (1 - k);
      } else {
        rabbit.position.y = 1.6;
        smoke.material.opacity = 0;
        smoke.scale.setScalar(0.2);
      }
    },
    rider: null,
    debug() { return { trick: st.trick, next: st.next, card0x: cards[0].position.x }; },
  };
}

// --- Badut NPC roaming (77,0) ---
function makeClown() {
  const g = new T.Group();
  const clown = makeNpc({
    skin: 'fair', hairStyle: 'spiky', hairColor: 'orange',
    shirtModel: 'tee', shirtColor: 'red', pantsModel: 'shorts', pantsColor: 'yellow',
    hatModel: 'beanie', hatColor: 'orange', glassesModel: 'round', glassesColor: 'red',
    shoesModel: 'sneakers', shoesColor: 'teal',
  });
  g.add(clown);
  // Hidung badut merah + topi kerucut pesta.
  clown.add(sph(0.09, lam(C.red), 0, 1.88, 0.34, 6, 6));
  const partyHat = cone(0.16, 0.4, lam(C.yellow), 0, 2.28, 0, 8);
  clown.add(partyHat);
  const st = { angle: 0, line: 0 };
  return {
    id: 'clown', group: g, npc: clown,
    colliders: [],
    board: { x: 77, z: 0, r: 3 },
    onUse(game, H) {
      const lines = ['rideClownSay1', 'rideClownSay2'];
      H?.toast?.(H.t(lines[st.line++ % lines.length]));
      H?.sfx?.play?.('animal');
    },
    update(dt, game, H) {
      st.angle += dt * 0.12;
      const a = st.angle;
      const x = 77 + 2.5 * Math.cos(a), z = 2.5 * Math.sin(a);
      g.position.set(x, ground(x, z), z);
      g.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
      waveArm(clown, H?.now ?? 0, 0.4);
    },
    rider: null,
    npcPos() { return { x: g.position.x, z: g.position.z }; },
    debug() { return { angle: st.angle, x: g.position.x, z: g.position.z }; },
  };
}

// --- Rumah kaca labirin (88,41) 10x6 — jalan masuk, panel cermin ---
function makeMirror() {
  const gy = ground(88, 41);
  const g = new T.Group();
  g.position.set(88, gy, 41);
  const wall = lam(C.cream), roofM = lam(C.purple);
  const mkWall = (w, h, d, x, y, z) => g.add(box(w, h, d, wall, x, y, z, true));
  mkWall(3.5, 2.8, 0.25, -3.25, 1.4, -3); // utara barat (celah x 86.5..89.5)
  mkWall(3.5, 2.8, 0.25, 3.25, 1.4, -3);  // utara timur
  mkWall(10, 2.8, 0.25, 0, 1.4, 3);       // selatan
  mkWall(0.25, 2.8, 6, -5, 1.4, 0);       // barat
  mkWall(0.25, 2.8, 6, 5, 1.4, 0);        // timur
  const r1 = box(10.6, 0.14, 3.6, roofM, 0, 3.3, -1.5);
  r1.rotation.x = 0.45;
  const r2 = box(10.6, 0.14, 3.6, roofM, 0, 3.3, 1.5);
  r2.rotation.x = -0.45;
  g.add(r1, r2);
  g.add(box(9.4, 0.1, 5.4, lam(0xe8e2d2), 0, 0.06, 0));
  // Panel cermin: phong mengilap + bingkai emas.
  const mirrorMat = phong(C.mirror, { shininess: 120 });
  const panels = [];
  const panel = (w, h, x, y, z, ry) => {
    const p = new T.Group();
    p.add(box(w, h, 0.08, mirrorMat, 0, 0, 0));
    p.add(box(w + 0.16, 0.1, 0.1, lam(C.gold), 0, h / 2, 0));
    p.add(box(w + 0.16, 0.1, 0.1, lam(C.gold), 0, -h / 2, 0));
    p.position.set(x, y, z);
    p.rotation.y = ry;
    g.add(p);
    panels.push(p);
    return p;
  };
  panel(1.4, 2.2, -3.8, 1.3, -2.7, 0.15);
  panel(1.4, 2.2, -1.2, 1.3, -2.7, -0.1);
  panel(1.4, 2.2, 1.4, 1.3, -2.7, 0.12);
  panel(1.2, 2.0, -4.7, 1.2, 0.5, Math.PI / 2);
  panel(1.2, 2.0, 4.7, 1.2, -0.5, Math.PI / 2);
  panel(1.3, 2.1, -1.5, 1.25, 1.2, 0.5); // bebas di tengah (miring)
  panel(1.3, 2.1, 2.0, 1.25, 0.8, -0.4);
  // Cahaya hangat + kilau.
  const light = new T.PointLight(0xffe0b0, 4, 9, 1.5);
  light.position.set(0, 2.2, 0);
  g.add(light);
  const sparkles = [];
  for (let i = 0; i < 6; i++) {
    const s = sph(0.09, emi(i % 2 ? C.gold : C.white, 2),
      -4 + i * 1.6, 1.2 + (i % 3) * 0.5, -2 + (i % 2) * 3.5, 6, 6);
    g.add(s);
    sparkles.push(s);
  }
  return {
    id: 'mirror', group: g,
    colliders: [
      { minX: 83, maxX: 86.5, minZ: 37.7, maxZ: 38.3 },
      { minX: 89.5, maxX: 93, minZ: 37.7, maxZ: 38.3 },
      { minX: 83, maxX: 93, minZ: 43.7, maxZ: 44.3 },
      { minX: 82.7, maxX: 83.3, minZ: 38, maxZ: 44 },
      { minX: 92.7, maxX: 93.3, minZ: 38, maxZ: 44 },
    ],
    board: { x: 88, z: 36.5, r: 3 },
    onUse(game, H) {
      const p = game?.player;
      if (!p) return;
      const inn = p.x > 83 && p.x < 93 && p.z > 38 && p.z < 44;
      if (inn) { p.teleport(88, 36.5); H?.toast?.(H.t('rideMirrorOut')); }
      else { p.teleport(88, 40); H?.toast?.(H.t('rideMirrorIn')); }
    },
    update(dt, game, H) {
      const n = H?.now ?? 0;
      sparkles.forEach((s, i) => {
        s.material.emissiveIntensity = 1.2 + Math.sin(n * 3 + i * 1.7) * 1.0;
      });
    },
    rider: null,
    debug() { return { spark0: sparkles[0].material.emissiveIntensity }; },
  };
}

// --- Istana balon (84,33) 12x10 — masuk, bola empuk bergoyang ---
function makeBalloon() {
  const gy = ground(84, 33);
  const g = new T.Group();
  g.position.set(84, gy, 33);
  const cols = [C.pink, C.yellow, C.teal, 0x9fc8e8];
  const wallAt = (w, h, d, x, y, z, col) => g.add(box(w, h, d, lam(col), x, y, z, true));
  wallAt(12, 2.6, 0.5, 0, 1.3, -5, cols[0]); // utara
  wallAt(12, 2.6, 0.5, 0, 1.3, 5, cols[1]);  // selatan
  wallAt(0.5, 2.6, 3, -6, 1.3, -3.5, cols[2]); // barat utara (celah z 31..35)
  wallAt(0.5, 2.6, 3, -6, 1.3, 3.5, cols[2]);  // barat selatan
  wallAt(0.5, 2.6, 10, 6, 1.3, 0, cols[3]);  // timur
  // Menara sudut + atap kerucut.
  const corners = [[-6, -5, cols[0]], [6, -5, cols[1]], [-6, 5, cols[2]], [6, 5, cols[3]]];
  for (const [cx, cz, col] of corners) {
    const tower = cyl(1.1, 1.2, 3.6, lam(col), cx, 1.8, cz, 10, true);
    outline(tower, 1.04);
    g.add(tower);
    g.add(cone(1.35, 1.4, lam(C.gold), cx, 4.3, cz, 10));
  }
  g.add(box(11.4, 0.1, 9.4, lam(0xfdf3d8), 0, 0.06, 0));
  // Bola-bola empuk di dalam.
  const balls = [];
  const ballCols = [C.pink, C.yellow, C.teal, C.orange, C.purple];
  for (let i = 0; i < 14; i++) {
    const b = sph(0.45, lam(ballCols[i % ballCols.length]),
      -4.5 + (i % 5) * 2.2, 0.5, -3.5 + Math.floor(i / 5) * 2.4, 8, 6);
    g.add(b);
    balls.push({ m: b, bx: b.position.x, bz: b.position.z, ph: i * 0.9 });
  }
  return {
    id: 'balloon', group: g,
    colliders: [
      { minX: 78, maxX: 90, minZ: 27.7, maxZ: 28.3 },
      { minX: 78, maxX: 90, minZ: 37.7, maxZ: 38.3 },
      { minX: 77.7, maxX: 78.3, minZ: 28, maxZ: 31 },
      { minX: 77.7, maxX: 78.3, minZ: 35, maxZ: 38 },
      { minX: 89.7, maxX: 90.3, minZ: 28, maxZ: 38 },
    ],
    board: { x: 77, z: 33, r: 3 },
    onUse(game, H) {
      const p = game?.player;
      if (!p) return;
      const inn = p.x > 78 && p.x < 90 && p.z > 28 && p.z < 38;
      if (inn) { p.teleport(77, 33); H?.toast?.(H.t('rideBalloonOut')); } // keluar = titik board (konsisten dgn mirror/ballpit)
      else { p.teleport(80, 33); H?.toast?.(H.t('rideBalloonIn')); }
    },
    update(dt, game, H) {
      const n = H?.now ?? 0;
      const p = game?.player;
      for (const b of balls) {
        let ox = 0, oz = 0;
        if (p) {
          const wx = 84 + b.bx, wz = 33 + b.bz;
          const dx = wx - p.x, dz = wz - p.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.3 && d > 0.01) {
            const push = (1.3 - d) * 0.6;
            ox = (dx / d) * push; oz = (dz / d) * push;
          }
        }
        b.m.position.set(b.bx + ox, 0.5 + Math.abs(Math.sin(n * 2 + b.ph)) * 0.1, b.bz + oz);
      }
    },
    rider: null,
    debug() { return { ball0y: balls[0].m.position.y }; },
  };
}

// --- Mandi bola (95,33) 8x10 — masuk, bola warna-warni ---
function makeBallpit() {
  const gy = ground(95, 33);
  const g = new T.Group();
  g.position.set(95, gy, 33);
  const wallM = lam(C.white);
  const mkWall = (w, h, d, x, y, z) => g.add(box(w, h, d, wallM, x, y, z, true));
  mkWall(8, 0.9, 0.3, 0, 0.45, -5);
  mkWall(8, 0.9, 0.3, 0, 0.45, 5);
  mkWall(0.3, 0.9, 3, -4, 0.45, -3.5);
  mkWall(0.3, 0.9, 3, -4, 0.45, 3.5);
  mkWall(0.3, 0.9, 10, 4, 0.45, 0);
  g.add(box(7.6, 0.1, 9.6, lam(0x9fc8e8), 0, 0.06, 0));
  const ballGeo = new T.SphereGeometry(0.28, 8, 6);
  const ballMat = toon(0xffffff);
  const COUNT = 64;
  const inst = new T.InstancedMesh(ballGeo, ballMat, COUNT);
  const dummy = new T.Object3D();
  let lastY0 = 0.32;
  const cols = [C.red, C.yellow, C.teal, C.pink, C.green, C.blue, C.orange];
  const base = [], phases = [];
  for (let i = 0; i < COUNT; i++) {
    const bx = -3.2 + (i % 8) * 0.85 + (Math.random() - 0.5) * 0.3;
    const bz = -4.2 + Math.floor(i / 8) * 1.1 + (Math.random() - 0.5) * 0.3;
    base.push([bx, bz]);
    phases.push(Math.random() * TAU);
    dummy.position.set(bx, 0.32, bz);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.setColorAt(i, new T.Color(cols[i % cols.length]));
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  g.add(inst);
  return {
    id: 'ballpit', group: g,
    colliders: [
      { minX: 91, maxX: 99, minZ: 27.7, maxZ: 28.3 },
      { minX: 91, maxX: 99, minZ: 37.7, maxZ: 38.3 },
      { minX: 90.7, maxX: 91.3, minZ: 28, maxZ: 31 },
      { minX: 90.7, maxX: 91.3, minZ: 35, maxZ: 38 },
      { minX: 98.7, maxX: 99.3, minZ: 28, maxZ: 38 },
    ],
    board: { x: 90, z: 33, r: 3 },
    onUse(game, H) {
      const p = game?.player;
      if (!p) return;
      const inn = p.x > 91 && p.x < 99 && p.z > 28 && p.z < 38;
      if (inn) { p.teleport(89.5, 33); H?.toast?.(H.t('rideBallpitOut')); }
      else { p.teleport(93, 33); H?.toast?.(H.t('rideBallpitIn')); }
    },
    update(dt, game, H) {
      const n = H?.now ?? 0;
      const p = game?.player;
      for (let i = 0; i < COUNT; i++) {
        const [bx, bz] = base[i];
        let ox = 0, oz = 0;
        if (p) {
          const wx = 95 + bx, wz = 33 + bz;
          const dx = wx - p.x, dz = wz - p.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.9 && d > 0.01) {
            const push = (0.9 - d) * 0.5;
            ox = (dx / d) * push; oz = (dz / d) * push;
          }
        }
        dummy.position.set(bx + ox, 0.32 + Math.abs(Math.sin(n * 2.2 + phases[i])) * 0.05, bz + oz);
        if (i === 0) lastY0 = dummy.position.y;
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
    },
    rider: null,
    debug() { return { ball0y: lastY0 }; },
  };
}

// --- Trampolin (64,28) 3x3 — lompat di atasnya memantul lebih tinggi ---
function makeTrampoline() {
  const gy = ground(64, 28);
  const g = new T.Group();
  g.position.set(64, gy, 28);
  const ring = mesh(new T.TorusGeometry(1.4, 0.09, 6, 20), lam(C.black), 0, 0.35, 0);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.add(cyl(1.35, 1.35, 0.06, lam(C.blue), 0, 0.32, 0, 18));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    g.add(cyl(0.05, 0.05, 0.35, lam(C.black), 1.2 * Math.cos(a), 0.17, 1.2 * Math.sin(a), 6));
  }
  return {
    id: 'trampoline', group: g,
    colliders: [],
    board: { x: 64, z: 28, r: 2.5 },
    onUse(game, H) { H?.toast?.(H.t('rideTrampolineTip')); },
    update() {},
    rider: null,
    debug() { return {}; },
  };
}

// --- Arena memancing ikan — kolam (98,10) 6x5 ---
function makeFishing() {
  const gy = ground(98, 10);
  const g = new T.Group();
  g.position.set(98, gy, 10);
  const water = box(6, 0.15, 5, toon(0x3fa9f5, {
    transparent: true, opacity: 0.6 }), 0, 0.12, 0);
  g.add(water);
  const rimM = lam(C.woodDark);
  g.add(box(6.6, 0.25, 0.4, rimM, 0, 0.12, -2.6));
  g.add(box(6.6, 0.25, 0.4, rimM, 0, 0.12, 2.6));
  g.add(box(0.4, 0.25, 5.6, rimM, -3.1, 0.12, 0));
  g.add(box(0.4, 0.25, 5.6, rimM, 3.1, 0.12, 0));
  g.add(box(2.2, 0.12, 1.0, lam(C.woodLight), 0, 0.2, -3.0)); // dermaga kecil
  for (const [rx, rz] of [[-2.8, -2.2], [2.7, 2.1], [-2.6, 2.2]]) {
    g.add(cone(0.18, 0.9, lam(C.green), rx, 0.6, rz, 6));
  }
  // Ikan berenang di bawah permukaan.
  const fishes = [];
  for (let i = 0; i < 4; i++) {
    const f = new T.Group();
    f.add(box(0.36, 0.14, 0.14, lam(i % 2 ? C.orange : 0xffd23c), 0, 0, 0));
    const tail = cone(0.09, 0.18, lam(C.orange), -0.26, 0, 0, 4);
    tail.rotation.z = Math.PI / 2;
    f.add(tail);
    g.add(f);
    fishes.push({ g: f, r: 1.1 + (i % 2) * 0.7, a: (i / 4) * TAU, sp: 0.5 + i * 0.12 });
  }
  // Pelampung + tali pancing (muncul saat memancing).
  const bobber = sph(0.12, lam(C.red), 0, 0.3, -0.5, 8, 6);
  bobber.visible = false;
  g.add(bobber);
  const line = cyl(0.015, 0.015, 1, lam(C.white), 0, 0, 0, 4);
  line.visible = false;
  g.add(line);
  const st = { state: 'idle', biteAt: 0, biteUntil: 0, caught: 0 };
  const _up = new T.Vector3(0, 1, 0);
  const _dir = new T.Vector3();
  function addCoins(game, n) {
    if (!game) return;
    if (typeof game.addCoins === 'function') { game.addCoins(n); return; }
    if (game.state) {
      game.state.coins = Math.max(0, (game.state.coins || 0) + n);
      if (typeof game.save === 'function') game.save();
    }
  }
  return {
    id: 'fishing', group: g,
    colliders: [{ minX: 95, maxX: 101, minZ: 7.5, maxZ: 12.5 }],
    board: { x: 98, z: 7, r: 2.5 },
    onUse(game, H) {
      const p = game?.player;
      if (!p) return;
      const now = H?.now ?? 0;
      if (st.state === 'idle') {
        st.state = 'waiting';
        st.biteAt = now + 3 + Math.random() * 4;
        bobber.visible = true;
        bobber.position.set(0, 0.3, -0.5);
        line.visible = true;
        H?.toast?.(H.t('rideFishCast'));
        H?.sfx?.play?.('water');
      } else if (st.state === 'waiting') {
        st.state = 'idle';
        bobber.visible = false;
        line.visible = false;
        H?.toast?.(H.t('rideFishEmpty'));
      } else if (st.state === 'bite') {
        st.state = 'idle';
        st.caught += 1;
        bobber.visible = false;
        line.visible = false;
        addCoins(game, 2);
        H?.toast?.(H.t('rideFishCaught', { n: 2 }));
        lhSfx('PANEN!'); // momen perayaan: ikan dapat
        H?.sfx?.play?.('coin');
      }
    },
    forceBite() {
      if (st.state === 'waiting') st.biteAt = 0;
    },
    update(dt, game, H) {
      const now = H?.now ?? 0;
      for (const f of fishes) {
        f.a += f.sp * dt;
        f.g.position.set(f.r * Math.cos(f.a), 0.02, f.r * Math.sin(f.a));
        f.g.rotation.y = Math.atan2(-Math.sin(f.a), Math.cos(f.a));
      }
      const p = game?.player;
      if (st.state === 'waiting' && now >= st.biteAt) {
        st.state = 'bite';
        st.biteUntil = now + 3;
        bobber.position.y = 0.16; // pelampung tenggelam sedikit
        H?.toast?.(H.t('rideFishBite'));
        H?.sfx?.play?.('animal');
      }
      if (st.state === 'bite' && now > st.biteUntil) {
        st.state = 'idle';
        bobber.visible = false;
        line.visible = false;
        H?.toast?.(H.t('rideFishEscape'));
      }
      if (st.state !== 'idle' && p) {
        if (Math.hypot(p.x - 98, p.z - 10) > 6) {
          st.state = 'idle';
          bobber.visible = false;
          line.visible = false;
        }
      }
      // Tali: dari tangan pemain ke pelampung.
      if (line.visible && p) {
        const bx = 98, by = gy + 0.3, bz = 9.5;
        const hx = p.x, hy = p.y + 1.3, hz = p.z;
        _dir.set(bx - hx, by - hy, bz - hz);
        const len = _dir.length() || 1;
        line.position.set((hx + bx) / 2, (hy + by) / 2, (hz + bz) / 2);
        line.scale.set(1, len, 1);
        line.quaternion.setFromUnitVectors(_up, _dir.normalize());
      }
    },
    rider: null,
    debug() { return { state: st.state, caught: st.caught, biteAt: st.biteAt, fish0: fishes[0].a }; },
  };
}

// --- Pertunjukan hewan — pen (98,-12) 8x8 ---
function makeAnimalShow() {
  const gy = ground(98, -12);
  const g = new T.Group();
  g.position.set(98, gy, -12);
  // Pagar kayu rendah, gerbang di sisi barat (celah z -13.5..-10.5).
  const postM = lam(C.woodDark), railM = lam(C.wood);
  const posts = [];
  for (let i = 0; i <= 4; i++) {
    posts.push([-4, -4 + i * 2], [4, -4 + i * 2], [-4 + i * 2, -4], [-4 + i * 2, 4]);
  }
  // Sisi barat: lewati 2 tiang di sekitar gerbang.
  for (const [px, pz] of posts) {
    if (px === -4 && pz > -2 && pz < 2) continue;
    g.add(box(0.16, 1.0, 0.16, postM, px, 0.5, pz));
  }
  const rail = (w, d, x, z, y) => g.add(box(w, 0.1, d, railM, x, y, z));
  rail(8, 0.1, 0, 0.7, -4); rail(8, 0.1, 0, 0.45, -4);
  rail(8, 0.1, 0, 0.7, 4); rail(8, 0.1, 0, 0.45, 4);
  rail(0.1, 8, -4, 0.7, 0); rail(0.1, 8, -4, 0.45, 0);
  rail(0.1, 8, 4, 0.7, 0); rail(0.1, 8, 4, 0.45, 0);
  // Hewan: 2 kelinci, 3 ayam, 2 bebek — jalan acak di dalam pen.
  function animal(kind, x, z) {
    const a = new T.Group();
    if (kind === 'rabbit') {
      a.add(sph(0.32, lam(C.white), 0, 0.3, 0, 10, 8));
      a.add(sph(0.2, lam(C.white), 0.3, 0.5, 0, 8, 6));
      a.add(cone(0.06, 0.35, lam(C.white), 0.26, 0.85, -0.06, 6));
      a.add(cone(0.06, 0.35, lam(C.white), 0.34, 0.85, 0.06, 6));
    } else if (kind === 'chicken') {
      a.add(sph(0.26, lam(C.white), 0, 0.28, 0, 8, 6));
      a.add(sph(0.15, lam(C.white), 0.2, 0.5, 0, 8, 6));
      const beakC = cone(0.06, 0.16, lam(C.orange), 0.36, 0.5, 0, 6);
      beakC.rotation.z = -Math.PI / 2;
      a.add(beakC);
      a.add(cone(0.05, 0.12, lam(C.red), 0.2, 0.66, 0, 4));
    } else {
      a.add(sph(0.3, lam(0x8a6b3f), 0, 0.28, 0, 8, 6));
      a.add(sph(0.17, lam(0x8a6b3f), 0.26, 0.48, 0, 8, 6));
      const beak = cone(0.07, 0.2, lam(C.orange), 0.45, 0.48, 0, 4);
      beak.rotation.z = -Math.PI / 2;
      a.add(beak);
    }
    a.position.set(x, 0, z);
    g.add(a);
    return { g: a, kind, x, z, tx: x, tz: z, retarget: Math.random() * 4, hop: Math.random() * TAU };
  }
  const animals = [
    animal('rabbit', -2, -1), animal('rabbit', 1.5, 2),
    animal('chicken', -1, 1.5), animal('chicken', 2, -2), animal('chicken', 0, 0),
    animal('duck', -2.5, 2.5), animal('duck', 2.5, 1),
  ];
  // Penjaga di dekat gerbang.
  const keeper = makeNpc({
    skin: 'tan', hairStyle: 'short', hairColor: 'black',
    shirtModel: 'long', shirtColor: 'green', pantsModel: 'pants', pantsColor: 'brown',
    hatModel: 'straw', hatColor: 'straw', glassesModel: 'none', glassesColor: 'black',
    shoesModel: 'boots', shoesColor: 'brown',
  });
  keeper.position.set(-3, 0, 0);
  keeper.rotation.y = Math.PI / 2;
  g.add(keeper);
  // Pakan yang dilempar.
  const pellets = [];
  for (let i = 0; i < 3; i++) {
    const p = sph(0.09, lam(0x6e4a26), -3, 0.2, 0, 6, 6);
    p.visible = false;
    g.add(p);
    pellets.push(p);
  }
  const st = { feedIn: 18, feeding: 0, gatherUntil: 0 };
  function feed(H) {
    st.feeding = 1.2;
    st.gatherUntil = (H?.now ?? 0) + 4;
    pellets.forEach((p, i) => {
      p.visible = true;
      p.position.set(-2.4 + i * 0.5, 0.2, (i - 1) * 0.5);
    });
    H?.toast?.(H.t('rideKeeperFeed'));
    H?.sfx?.play?.('animal');
  }
  return {
    id: 'animalshow', group: g, npc: keeper,
    colliders: [
      { minX: 94, maxX: 102, minZ: -16.3, maxZ: -15.7 },
      { minX: 94, maxX: 102, minZ: -8.3, maxZ: -7.7 },
      { minX: 93.7, maxX: 94.3, minZ: -16, maxZ: -13.5 },
      { minX: 93.7, maxX: 94.3, minZ: -10.5, maxZ: -8 },
      { minX: 101.7, maxX: 102.3, minZ: -16, maxZ: -8 },
    ],
    board: { x: 93, z: -12, r: 3 },
    onUse(game, H) { feed(H); },
    update(dt, game, H) {
      const now = H?.now ?? 0;
      st.feedIn -= dt;
      if (st.feedIn <= 0) { st.feedIn = 18; feed(H); }
      if (st.feeding > 0) {
        st.feeding -= dt;
        const u = keeper.userData;
        if (u?.upper) u.upper.rotation.x = 0.5 * Math.sin(Math.min(1, (1.2 - st.feeding) / 1.2) * Math.PI);
        if (st.feeding <= 0) {
          if (u?.upper) u.upper.rotation.x = 0;
          pellets.forEach((p) => { p.visible = false; });
        }
      }
      const gathering = now < st.gatherUntil;
      for (const a of animals) {
        a.retarget -= dt;
        const tx = gathering ? -3 : a.tx, tz = gathering ? 0 : a.tz;
        const dx = tx - a.x, dz = tz - a.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3 || a.retarget <= 0) {
          a.tx = (Math.random() * 2 - 1) * 3.2;
          a.tz = (Math.random() * 2 - 1) * 3.2;
          a.retarget = 4 + Math.random() * 3;
        } else {
          const sp = a.kind === 'rabbit' ? 0.9 : 0.45;
          a.x += (dx / d) * sp * dt;
          a.z += (dz / d) * sp * dt;
          a.g.rotation.y = Math.atan2(dx, dz);
          a.hop += dt * 8;
        }
        const hopY = a.kind === 'rabbit' ? Math.abs(Math.sin(a.hop)) * 0.16
          : Math.abs(Math.sin(a.hop)) * 0.04;
        a.g.position.set(a.x, hopY, a.z);
      }
    },
    rider: null,
    debug() { return { feedIn: st.feedIn }; },
  };
}

// ---------- Operator wahana (NPC, tanpa interactable sendiri) ----------
function makeOperator() {
  const gy = ground(72, -33);
  const op = makeNpc({
    skin: 'medium', hairStyle: 'short', hairColor: 'black',
    shirtModel: 'tee', shirtColor: 'teal', pantsModel: 'pants', pantsColor: 'blue',
    hatModel: 'cap', hatColor: 'red', glassesModel: 'none', glassesColor: 'black',
    shoesModel: 'boots', shoesColor: 'brown',
  });
  op.position.set(72, gy, -33);
  op.rotation.y = Math.PI;
  return op;
}

// ================= PERAKITAN + API PUBLIK =================

const BUILDERS = {
  ferris: makeFerris, pirate: makePirate, carousel: makeCarousel,
  chairs: makeChairs, bumper: makeBumper, tagada: makeTagada,
  coaster: makeCoaster, train: () => makeLoopTrain('train'),
  odong: () => makeLoopTrain('odong'), becak: makeBecak,
  haunted: makeHaunted, motorwall: makeMotorwall, magic: makeMagic,
  clown: makeClown, mirror: makeMirror, balloon: makeBalloon,
  ballpit: makeBallpit, trampoline: makeTrampoline, fishing: makeFishing,
  animalshow: makeAnimalShow,
};

export function buildNightMarketRides(scene, THREE, ctx = {}) {
  T = THREE;
  const toast = (m) => { try { ctx.toast?.(m); } catch (e) { /* abaikan */ } };
  const sfx = { play: (n) => { try { ctx.sfx?.play?.(n); } catch (e) { /* abaikan */ } } };
  // ctx.t boleh 1-arg (koordinator: (k) => t(k, lang)) — ganti {var} sendiri
  // bila hasilnya masih mengandung placeholder.
  const tr = (key, vars = {}) => {
    let s = key;
    try { s = ctx.t ? ctx.t(key, vars) : key; } catch (e) { s = key; }
    if (typeof s !== 'string') s = key;
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };

  // ---------- DOM: overlay gelap rumah hantu ----------
  // Menempel di #game-container (bukan body): overlay gelap duduk di
  // z-index 4 — di atas kanvas, di bawah HUD (5) — jadi HUD/toast tetap
  // terbaca. (Dulu ada panel wahana tengah layar di sini — dihapus
  // 2026-11-23 atas permintaan Izka: menutupi layar saat naik wahana.
  // Keluar wahana hanya lewat tombol Aksi "Turun".)
  const host = document.getElementById('game-container') || document.body;

  const darkEl = document.createElement('div');
  darkEl.id = 'nm-dark';
  darkEl.setAttribute('aria-hidden', 'true');
  host.appendChild(darkEl);

  // ---------- Bangun semua wahana ----------
  // Grup induk: semua geometri wahana dalam satu grup supaya main.js bisa
  // meng-culling bayangannya saat pemain jauh dari zona.
  const group = new THREE.Group();
  group.name = 'night-market-rides';
  scene.add(group);

  const entries = [];
  const byId = {};
  for (const def of NM_RIDES) {
    const entry = BUILDERS[def.id]();
    entry.def = def;
    group.add(entry.group);
    entries.push(entry);
    byId[def.id] = entry;
  }
  const operator = makeOperator();
  group.add(operator);

  const colliders = entries.flatMap((e) => e.colliders || []);
  const interactables = entries.map((e) => ({
    id: e.id, x: e.board.x, z: e.board.z, r: e.board.r, labelKey: e.def.labelKey,
  }));

  // NPC yang menyapa saat didekati (dialog 1 kalimat, cooldown 20 dtk).
  const npcs = [
    { id: 'clown', lines: ['rideClownSay1', 'rideClownSay2'],
      pos: () => byId.clown.npcPos() },
    { id: 'magic', lines: ['rideMagicSay'],
      pos: () => ({ x: 77, z: -6 }) },
    { id: 'keeper', lines: ['rideKeeperSay'],
      pos: () => ({ x: 95, z: -12 }) },
    { id: 'operator', lines: ['rideOperatorSay'],
      pos: () => ({ x: 72, z: -33 }) },
  ];

  const S = {
    animT: 0, timeScale: 1, current: null, game: null,
    trampBoosted: false, darkCur: 0, npcCd: {}, clownLine: 0,
  };
  const H = () => ({ t: tr, toast, sfx, now: S.animT });

  function stopRide() {
    if (!S.current) return false;
    const { entry } = S.current;
    S.current = null;
    try { entry.unboard?.(); } catch (e) { /* abaikan */ }
    const g = S.game;
    if (g?.player?.teleport) g.player.teleport(entry.exit.x, entry.exit.z);
    toast(tr('rideExited'));
    sfx.play('click');
    return true;
  }

  function onUse(id, game) {
    if (game) S.game = game;
    const entry = byId[id];
    if (!entry) return false;
    if (S.current && S.current.entry.id === id) return stopRide();
    if (S.current) return false; // sedang naik wahana lain
    if (typeof entry.onUse === 'function') {
      entry.onUse(game, H());
      return true;
    }
    // Wahana NAIK: cek biaya (semua gratis saat ini) lalu board.
    if ((entry.def.cost || 0) > 0) {
      const coins = game?.state?.coins ?? 0;
      if (coins < entry.def.cost) {
        toast(tr('needCoins'));
        sfx.play('error');
        return false;
      }
      if (typeof game.addCoins === 'function') game.addCoins(-entry.def.cost);
      else if (game?.state) game.state.coins -= entry.def.cost;
    }
    let ok = false;
    try { ok = entry.boardFn ? entry.boardFn(game) : true; } catch (e) { ok = false; }
    if (!ok) {
      toast(tr('rideWait'));
      return false;
    }
    S.current = { entry };
    // Input TIDAK dikunci saat naik: tombol Aksi ("Turun") harus tetap bisa
    // ditekan untuk keluar — itu satu-satunya jalan keluar sekarang (tidak
    // ada lagi panel tengah layar). Gerak pemain tetap mati karena
    // player.update dilewati selama naik (wiring main.js).
    if (game?.player) { game.player.vx = 0; game.player.vz = 0; }
    toast(tr('rideBoard', { name: tr(entry.def.labelKey) }));
    sfx.play('click');
    return true;
  }

  function update(dt, t, game) {
    if (game) S.game = game;
    const sdt = dt * S.timeScale;
    S.animT += sdt;
    const h = H();
    for (const entry of entries) {
      try { entry.update?.(sdt, game, h); } catch (e) { /* satu wahana gagal tidak menjatuhkan yang lain */ }
    }
    // Operator melambai.
    waveArm(operator, S.animT, 0.35);

    // --- Trampolin: lompat di atasnya -> velocity x1.8 (sekali per lompatan) ---
    const p = game?.player;
    if (p) {
      const onTramp = p.x > 62.5 && p.x < 65.5 && p.z > 26.5 && p.z < 29.5;
      if (onTramp && p.yOff < 0.6 && p.vy > 0.5 && !S.trampBoosted) {
        p.vy *= 1.8;
        S.trampBoosted = true;
        sfx.play('jump');
      }
      if (p.yOff <= 0.01 && p.vy <= 0) S.trampBoosted = false;
    }

    // --- Rumah hantu: overlay gelap saat pemain di dalam ---
    const haunted = byId.haunted;
    let darkTarget = 0;
    try { if (haunted.isInside(game)) darkTarget = 0.78; } catch (e) { /* abaikan */ }
    S.darkCur += (darkTarget - S.darkCur) * Math.min(1, dt * 3);
    if (Math.abs(S.darkCur - (darkEl._v ?? -1)) > 0.004) {
      darkEl.style.opacity = S.darkCur.toFixed(3);
      darkEl._v = S.darkCur;
    }

    // --- NPC menyapa saat didekati ---
    if (p) {
      for (const n of npcs) {
        const pos = n.pos();
        const d = Math.hypot(p.x - pos.x, p.z - pos.z);
        if (d < 3 && S.animT - (S.npcCd[n.id] ?? -99) > 20) {
          S.npcCd[n.id] = S.animT;
          const line = n.id === 'clown'
            ? n.lines[S.clownLine++ % n.lines.length] : n.lines[0];
          toast(tr(line));
        }
      }
    }

    // Wahana jalan tanpa batas waktu — hanya tombol Turun yang mengakhiri.
    // (Dulu: auto-stop saat durasi habis / satu putaran selesai. Dihapus
    // 2026-11-23 atas permintaan Izka: nikmati wahana tanpa limit waktu.)
  }

  return {
    colliders,
    interactables,
    _group: group,
    update,
    onUse,
    getRiderTransform() {
      if (!S.current) return null;
      try { return S.current.entry.rider?.() ?? null; }
      catch (e) { return null; }
    },
    isRiding() { return !!S.current; },
    getEntry(id) { return byId[id] || null; }, // Lane A: akses entry (arena/seam bot) dari game/verify
    getRideEntry(id) { return byId[id] || null; }, // alias: nama di spek Lane B
    stopRide,
    debug: {
      state() {
        const rides = {};
        for (const e of entries) {
          try { rides[e.id] = e.debug?.() ?? null; } catch (err) { rides[e.id] = null; }
        }
        return {
          animT: S.animT, timeScale: S.timeScale,
          riding: S.current ? S.current.entry.id : null,
          dark: S.darkCur, trampBoosted: S.trampBoosted, rides,
        };
      },
      setTimeScale(v) { S.timeScale = clamp(Number(v) || 1, 0.25, 20); },
      forceBite() { try { byId.fishing.forceBite?.(); } catch (e) { /* abaikan */ } },
    },
  };
}
