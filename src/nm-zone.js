// nm-zone.js: Zona Pasar Malam (Lane P).
// Restyle visual Lane D (anime overhaul, 25 Nov 2026): semua permukaan
// MeshToonMaterial + gradientMap 4-step (cel), palet langit/sakura/
// matahari PRODUCT.md, papan nama display rounded, lampion + lampu
// hangat warna anime. Koordinat, collider, perilaku, teks TIDAK berubah.
// Struktur zona saja: tanah padat + jalan, gapura + papan nama bilingual,
// tiang lampu + string lights, obor, pagar tali, panggung sulap, kubah
// malam lokal + bintang + lampu hangat. Stan jajanan / wahana / game
// dibangun lane G/R/F di koordinat terkunci yang sama; file ini TIDAK
// menyentuh mereka (hanya menyediakan tanah datar + collider struktur).
// API (wiring oleh koordinator di main.js; file ini tidak menyentuh main.js):
//   const nm = buildNightMarketZone(scene, THREE, { lang: 'id' });
//   scene sudah berisi nm.group; gabung nm.colliders ke world.colliders;
//   panggil nm.update(dt, t, { x: player.x, z: player.z }) tiap frame;
//   nm.minimap -> data minimap zona (rect + titik wahana terkunci).
//   nm.interactables = [] (belum ada interaksi di lane ini).
import * as THREEImpl from 'three';
import { terrainHeight, NIGHTMARKET, NM_FLAT_Y, smoothstep } from './physics.js';
import { t } from './i18n.js';

// Layout terkunci (koordinator 23 Nov 2026; JANGAN ubah koordinat).
export const NM_RECT = { ...NIGHTMARKET };
export const NM_GATE = { x: 60, z: 0 };
export const NM_STAGE = { x: 77, z: -6 };
export const NM_RIDES = [
  { x: 70, z: -40, kind: 'bianglala' }, { x: 84, z: -40, kind: 'kora-kora' },
  { x: 94, z: -40, kind: 'komidi' }, { x: 82, z: -48, kind: 'kursi-terbang' },
  { x: 96, z: -48, kind: 'bom-bom' }, { x: 70, z: -32, kind: 'tagada' },
  { x: 98, z: -32, kind: 'tong-motor' }, { x: 64, z: -39, kind: 'coaster' },
  { x: 71, z: 35, kind: 'rumah-hantu' }, { x: 84, z: 33, kind: 'istana-balon' },
  { x: 95, z: 33, kind: 'mandi-bola' }, { x: 88, z: 42, kind: 'rumah-kaca' },
  { x: 64, z: 28, kind: 'trampolin' }, { x: 62, z: 18, kind: 'odong' },
  { x: 64, z: 20, kind: 'becak' }, { x: 98, z: 10, kind: 'kolam-pancing' },
  { x: 98, z: -12, kind: 'pen-hewan' }, { x: 77, z: 0, kind: 'badut' },
];
export const NM_GAMES_N = [66, 74, 82, 90].map((x) => ({ x, z: -12, kind: 'game' }));
export const NM_GAMES_S = [66, 74, 82, 90].map((x) => ({ x, z: 12, kind: 'game' }));

const WOOD = 0x8a6b3f, WOOD_DARK = 0x6e4a26, BARK = 0x4a3419;
const DIRT = 0x9a7b4f, DIRT_LIGHT = 0xb59a6e, STONE = 0x8d8578;
// Palet anime PRODUCT.md (dipakai zona): sakura / matahari / daun.
const SAKURA = 0xff8fb3, SAKURA_DEEP = 0xff5c8a, SUN = 0xffc93c, LEAF = 0x2fbf4a;
const INK = 0x1d2b53;

// ---- Cel/toon anime: MeshToonMaterial + gradientMap 4-step (pita warna
// tegas, bukan gradien halus Lambert). MeshBasicMaterial dipertahankan
// hanya untuk sumber cahaya (neon, bola lampu, api, bulan, bintang).
let _toonGrad = null;
function toonGrad() {
  if (_toonGrad) return _toonGrad;
  const tex = new THREEImpl.DataTexture(new Uint8Array([90, 150, 210, 255]), 4, 1, THREEImpl.RedFormat);
  tex.minFilter = THREEImpl.NearestFilter;
  tex.magFilter = THREEImpl.NearestFilter;
  tex.needsUpdate = true;
  _toonGrad = tex;
  return tex;
}
function lam(color, opts = {}) {
  return new THREEImpl.MeshToonMaterial({ color, gradientMap: toonGrad(), ...opts });
}
function basic(color, opts = {}) {
  return new THREEImpl.MeshBasicMaterial({ color, ...opts });
}
// RNG ber-seed (stabil antar load) untuk tekstur + penempatan dekor.
function seeded(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function dirtTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#a5824f'; g.fillRect(0, 0, 256, 256);
  const rnd = seeded(20261123);
  for (let i = 0; i < 900; i++) {
    const v = rnd();
    g.fillStyle = v > 0.66 ? 'rgba(198,168,116,0.5)' : v > 0.33 ? 'rgba(140,106,62,0.45)' : 'rgba(74,52,25,0.35)';
    g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  for (let i = 0; i < 24; i++) { // kerikil kecil
    g.fillStyle = 'rgba(141,133,120,0.8)';
    g.beginPath(); g.arc(rnd() * 256, rnd() * 256, 1.5 + rnd() * 2.5, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREEImpl.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREEImpl.RepeatWrapping;
  tex.repeat.set(6, 12);
  return tex;
}

function signTexture(lang) {
  const big = t('nmTitle', lang);
  const small = lang === 'en' ? 'PASAR MALAM' : 'NIGHT MARKET';
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#fff6e5'; g.fillRect(0, 0, 512, 160); // --lh-paper
  g.strokeStyle = '#1d2b53'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 144); // outline tinta
  g.fillStyle = '#1d2b53'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 62px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Trebuchet MS", system-ui, sans-serif';
  g.fillText(big, 256, 66);
  g.fillStyle = '#ff5c8a'; // --lh-sakura-deep
  g.font = '800 30px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Trebuchet MS", system-ui, sans-serif';
  g.fillText(small.split('').join(' '), 256, 124);
  return new THREEImpl.CanvasTexture(c);
}

export function buildNightMarketZone(scene, THREE, ctx = {}) {
  const T = THREE || THREEImpl;
  const lang = ctx.lang || 'id';
  const colliders = [];
  const group = new T.Group();
  scene.add(group);
  const Y = NM_FLAT_Y; // tanah inti zona persis 0.6 (physics.js)
  const dummy = new T.Object3D();
  const _m4 = new T.Matrix4();

  // ---- Tanah padat (inti rect, inset 4 m dari tepi supaya tidak menabrak
  // pita transisi terrain) + tepi batu + jalan utama/silang.
  const ground = new T.Mesh(
    new T.PlaneGeometry(36, 86),
    new T.MeshToonMaterial({ map: dirtTexture(), gradientMap: toonGrad() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(80, Y + 0.07, -3);
  ground.receiveShadow = true;
  group.add(ground);
  // Tepi batu: 4 balok rendah mengelilingi tanah padat.
  const stoneMat = lam(STONE);
  for (const [w, d, px, pz] of [
    [36.6, 0.6, 80, -46.3], [36.6, 0.6, 80, 40.3],
    [0.6, 86.6, 61.7, -3], [0.6, 86.6, 98.3, -3],
  ]) {
    const s = new T.Mesh(new T.BoxGeometry(w, 0.22, d), stoneMat);
    s.position.set(px, Y + 0.11, pz);
    s.receiveShadow = true;
    group.add(s);
  }
  // Tanah padat annex utara (koordinator, 23 Nov 2026): strip x 74..102,
  // z -55..-46 — menutup tanah rumput di bawah arena bom-bom + kursi
  // terbang supaya seragam dengan tanah padat utama (bersentuhan di z=-46,
  // tanpa overlap, tanpa z-fight).
  const groundAnnex = new T.Mesh(
    new T.PlaneGeometry(28, 9),
    new T.MeshToonMaterial({ map: dirtTexture(), gradientMap: toonGrad() }),
  );
  groundAnnex.rotation.x = -Math.PI / 2;
  groundAnnex.position.set(88, Y + 0.07, -50.5);
  groundAnnex.receiveShadow = true;
  group.add(groundAnnex);
  // Jalan utama (z=0, x 62..92) + jalan silang (x=77, z -22..22, dipotong
  // di persimpangan supaya tidak tumpang-tindih / z-fight dengan jalan utama).
  const roadMat = lam(DIRT_LIGHT);
  const roadMain = new T.Mesh(new T.PlaneGeometry(30, 3.2), roadMat);
  roadMain.rotation.x = -Math.PI / 2;
  roadMain.position.set(77, Y + 0.09, 0);
  roadMain.receiveShadow = true;
  group.add(roadMain);
  for (const [cz, len] of [[-11.8, 20.4], [11.8, 20.4]]) {
    const road = new T.Mesh(new T.PlaneGeometry(3.2, len), roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(77, Y + 0.09, cz);
    road.receiveShadow = true;
    group.add(road);
  }

  // ---- Gapura masuk (60,0): 2 tiang kayu + balok atas + papan nama +
  // neon hangat + 2 lampion kertas.
  const gate = new T.Group();
  const postMat = lam(WOOD_DARK);
  for (const pz of [-2.4, 2.4]) {
    const post = new T.Mesh(new T.BoxGeometry(0.55, 4.6, 0.55), postMat);
    post.position.set(0, Y + 2.3, pz);
    post.castShadow = true;
    gate.add(post);
    colliders.push({ minX: 60 - 0.35, maxX: 60 + 0.35, minZ: pz - 0.35, maxZ: pz + 0.35 });
  }
  const beam = new T.Mesh(new T.BoxGeometry(0.55, 0.55, 6.6), lam(WOOD));
  beam.position.set(0, Y + 4.7, 0);
  beam.castShadow = true;
  gate.add(beam);
  // Neon hangat di balok (sakura / matahari / daun, tanpa ungu-biru).
  const neonCols = [SAKURA_DEEP, SUN, LEAF];
  neonCols.forEach((cc, i) => {
    const strip = new T.Mesh(new T.BoxGeometry(0.6, 0.1, 1.9), basic(cc));
    strip.position.set(0, Y + 5.0, -2.1 + i * 2.1);
    gate.add(strip);
  });
  for (const pz of [-2.4, 2.4]) { // neon vertikal di tiang
    const strip = new T.Mesh(new T.BoxGeometry(0.6, 3.4, 0.1), basic(0xffc93c));
    strip.position.set(0, Y + 2.4, pz + (pz > 0 ? 0.3 : -0.3));
    gate.add(strip);
  }
  // Papan nama digeser ke barat (x -0.45) supaya lampion (bola r 0.34 di
  // x 0, tepi barat -0.34) TIDAK menembus bidang papan — sebelumnya papan
  // di -0.32 dan bola menembus 0.02 m, tampak sebagai berlian merah di
  // atas teks (terbukti raycast: bola #ff5c4a (60,4.4,-1.2) 0.03 m di
  // belakang bidang papan pada piksel berlian).
  const sign = new T.Mesh(
    new T.PlaneGeometry(3.8, 1.19),
    new T.MeshBasicMaterial({ map: signTexture(lang) }),
  );
  sign.position.set(-0.45, Y + 3.7, 0);
  sign.rotation.y = -Math.PI / 2; // menghadap barat (arah jalan masuk)
  gate.add(sign);
  const signBack = new T.Mesh(new T.BoxGeometry(0.08, 1.3, 4.0), lam(WOOD_DARK));
  signBack.position.set(-0.41, Y + 3.7, 0);
  gate.add(signBack);
  // Lampion kertas merah menggantung di balok.
  for (const pz of [-1.2, 1.2]) {
    const cord = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.5, 4), lam(BARK));
    cord.position.set(0, Y + 4.2, pz);
    gate.add(cord);
    const lamp = new T.Mesh(new T.SphereGeometry(0.34, 10, 8), basic(SAKURA_DEEP));
    lamp.scale.y = 1.15;
    lamp.position.set(0, Y + 3.8, pz);
    gate.add(lamp);
    const cap = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 0.12, 6), lam(0xffc93c));
    cap.position.set(0, Y + 4.22, pz);
    gate.add(cap);
  }
  gate.position.set(60, 0, 0);
  group.add(gate);

  // ---- Tiang lampu + string lights di jalan utama (x 66/76/86, z ±2.8).
  const poleXs = [66, 76, 86];
  const polePos = [];
  for (const px of poleXs) for (const pz of [-2.8, 2.8]) polePos.push({ x: px, z: pz });
  const poles = new T.InstancedMesh(
    new T.CylinderGeometry(0.09, 0.12, 3.6, 6), lam(BARK), polePos.length);
  polePos.forEach((p, i) => {
    dummy.position.set(p.x, Y + 1.8, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    colliders.push({ minX: p.x - 0.2, maxX: p.x + 0.2, minZ: p.z - 0.2, maxZ: p.z + 0.2 });
  });
  poles.castShadow = true;
  group.add(poles);
  // Kabel: 3 rentang melintang jalan + 2 sisi memanjang; garis lurus pendek
  // (sag) dalam satu LineSegments. Bola lampu: satu InstancedMesh.
  const cablePts = [];
  const bulbSpots = [];
  function addCable(ax, az, bx, bz, bulbs) {
    const SEG = 8;
    for (let i = 0; i < SEG; i++) {
      const k0 = i / SEG, k1 = (i + 1) / SEG;
      const sag = (k) => Math.sin(k * Math.PI) * 0.55;
      cablePts.push(
        ax + (bx - ax) * k0, Y + 3.55 - sag(k0), az + (bz - az) * k0,
        ax + (bx - ax) * k1, Y + 3.55 - sag(k1), az + (bz - az) * k1,
      );
    }
    for (let i = 1; i <= bulbs; i++) {
      const k = i / (bulbs + 1);
      bulbSpots.push({
        x: ax + (bx - ax) * k,
        y: Y + 3.55 - Math.sin(k * Math.PI) * 0.55 - 0.14,
        z: az + (bz - az) * k,
      });
    }
  }
  for (const px of poleXs) addCable(px, -2.8, px, 2.8, 5); // melintang
  for (const pz of [-2.8, 2.8]) { // memanjang tiap sisi
    addCable(66, pz, 76, pz, 7);
    addCable(76, pz, 86, pz, 7);
  }
  const cableGeo = new T.BufferGeometry();
  cableGeo.setAttribute('position', new T.Float32BufferAttribute(cablePts, 3));
  group.add(new T.LineSegments(cableGeo, new T.LineBasicMaterial({ color: 0x2b2118 })));
  for (const p of polePos) bulbSpots.push({ x: p.x, y: Y + 3.7, z: p.z }); // ujung tiang
  const bulbCols = [SUN, SAKURA, 0xfff6e5, SAKURA_DEEP].map((c) => new T.Color(c));
  const bulbs = new T.InstancedMesh(
    new T.SphereGeometry(0.1, 6, 5), basic(0xffffff), bulbSpots.length);
  bulbSpots.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bulbs.setMatrixAt(i, dummy.matrix);
    bulbs.setColorAt(i, bulbCols[i % bulbCols.length]);
  });
  bulbs.instanceColor.needsUpdate = true;
  group.add(bulbs);

  // ---- Obor api kecil di tepi jalan utama (nyala = animasi scale, tanpa partikel).
  const torchPos = [
    { x: 64, z: -2.2 }, { x: 70, z: 2.2 }, { x: 76, z: -2.2 },
    { x: 82, z: 2.2 }, { x: 88, z: -2.2 }, { x: 92, z: 2.2 },
  ];
  const torchPoles = new T.InstancedMesh(
    new T.CylinderGeometry(0.06, 0.08, 1.1, 5), lam(BARK), torchPos.length);
  const flames = new T.InstancedMesh(
    new T.ConeGeometry(0.16, 0.5, 6), basic(0xff9a3c), torchPos.length);
  torchPos.forEach((p, i) => {
    dummy.position.set(p.x, Y + 0.55, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    torchPoles.setMatrixAt(i, dummy.matrix);
    colliders.push({ minX: p.x - 0.18, maxX: p.x + 0.18, minZ: p.z - 0.18, maxZ: p.z + 0.18 });
  });
  group.add(torchPoles);
  group.add(flames);

  // ---- Panggung sulap (77,-6): platform kayu + backdrop + neon tepi.
  const stage = new T.Group();
  const platform = new T.Mesh(new T.BoxGeometry(6, 0.5, 4), lam(WOOD));
  platform.position.set(0, Y + 0.25, 0);
  platform.castShadow = true;
  platform.receiveShadow = true;
  stage.add(platform);
  const backdrop = new T.Mesh(new T.BoxGeometry(6, 2.6, 0.25), lam(WOOD_DARK));
  backdrop.position.set(0, Y + 1.8, -1.9);
  backdrop.castShadow = true;
  stage.add(backdrop);
  const curtain = new T.Mesh(new T.PlaneGeometry(5.4, 2.2), lam(0xb03a2e));
  curtain.position.set(0, Y + 1.7, -1.76);
  stage.add(curtain);
  const stageNeon = new T.Mesh(new T.BoxGeometry(6.1, 0.09, 0.09), basic(0xffc93c));
  stageNeon.position.set(0, Y + 0.52, 2.0);
  stage.add(stageNeon);
  stage.position.set(77, 0, -6);
  group.add(stage);
  colliders.push({ minX: 74, maxX: 80, minZ: -8, maxZ: -4 });

  // ---- Pagar tali pembatas zona: tiang instanced + tali (LineSegments).
  // Celah di sisi barat z -3..3 (gapura masuk). Utara ber-jog (koordinator):
  // z=-50 untuk x 58..74, z=-55 untuk x 74..102 (annex); penghubung x=74.
  // Timur x=102 diperpanjang ke utara sampai z=-55.
  const fencePosts = [];
  const step = 6;
  for (let z = -50; z <= 44; z += step) {
    if (z > -4 && z < 4) continue; // celah gapura
    fencePosts.push({ x: 58, z: Math.min(z, 44) });
  }
  for (let z = -55; z <= 44; z += step) fencePosts.push({ x: 102, z: Math.min(z, 44) });
  for (let x = 58; x <= 74; x += step) fencePosts.push({ x: Math.min(x, 74), z: -50 });
  for (let x = 74; x <= 102; x += step) fencePosts.push({ x: Math.min(x, 102), z: -55 });
  for (let x = 58; x <= 102; x += step) fencePosts.push({ x: Math.min(x, 102), z: 44 });
  const fenceMesh = new T.InstancedMesh(
    new T.CylinderGeometry(0.07, 0.09, 1.0, 5), lam(WOOD_DARK), fencePosts.length);
  fencePosts.forEach((p, i) => {
    dummy.position.set(p.x, terrainHeight(p.x, p.z) + 0.5, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    fenceMesh.setMatrixAt(i, dummy.matrix);
  });
  group.add(fenceMesh);
  // Tali: urutkan tiang per sisi, sambung berurutan (sag 0.15).
  const ropePts = [];
  function ropeRun(pts) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ya = terrainHeight(a.x, a.z) + 0.95, yb = terrainHeight(b.x, b.z) + 0.95;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (ya + yb) / 2 - 0.15;
      ropePts.push(a.x, ya, a.z, mx, my, mz, mx, my, mz, b.x, yb, b.z);
    }
  }
  const westN = fencePosts.filter((p) => p.x === 58 && p.z < 0).sort((a, b) => a.z - b.z);
  const westS = fencePosts.filter((p) => p.x === 58 && p.z > 0).sort((a, b) => a.z - b.z);
  const east = fencePosts.filter((p) => p.x === 102).sort((a, b) => a.z - b.z);
  const northW = fencePosts.filter((p) => p.z === -50).sort((a, b) => a.x - b.x);
  const northA = fencePosts.filter((p) => p.z === -55).sort((a, b) => a.x - b.x);
  const conn = fencePosts.filter((p) => p.x === 74 && p.z >= -55 && p.z <= -50).sort((a, b) => a.z - b.z);
  const south = fencePosts.filter((p) => p.z === 44).sort((a, b) => a.x - b.x);
  for (const run of [westN, westS, east, northW, northA, conn, south]) ropeRun(run);
  const ropeGeo = new T.BufferGeometry();
  ropeGeo.setAttribute('position', new T.Float32BufferAttribute(ropePts, 3));
  group.add(new T.LineSegments(ropeGeo, new T.LineBasicMaterial({ color: 0x6e4a26 })));
  // Collider pagar: 7 AABB (barat terbelah di celah gapura; utara ber-jog
  // mengikuti annex — koordinator). Timur diperpanjang ke z=-55.
  colliders.push(
    { minX: 57.7, maxX: 58.3, minZ: -50.3, maxZ: -3 },
    { minX: 57.7, maxX: 58.3, minZ: 3, maxZ: 44.3 },
    { minX: 101.7, maxX: 102.3, minZ: -55.3, maxZ: 44.3 },
    { minX: 57.7, maxX: 74.3, minZ: -50.3, maxZ: -49.7 },
    { minX: 73.7, maxX: 102.3, minZ: -55.3, maxZ: -54.7 },
    { minX: 73.7, maxX: 74.3, minZ: -55.3, maxZ: -49.7 },
    { minX: 57.7, maxX: 102.3, minZ: 43.7, maxZ: 44.3 },
  );

  // ---- Kubah malam lokal: setengah bola gelap (BackSide) + bintang +
  // bulan. Hanya terlihat saat pemain di dalam/dekat zona (update()).
  const domeMat = new T.MeshBasicMaterial({
    color: 0x141b3d, transparent: true, opacity: 0, // --lh-night
    side: T.BackSide, fog: false, depthWrite: false,
  });
  const dome = new T.Mesh(
    new T.SphereGeometry(60, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.set(80, Y, -3);
  dome.renderOrder = 10;
  dome.visible = false;
  group.add(dome);
  const starGeo = new T.BufferGeometry();
  {
    const rnd = seeded(777);
    const arr = new Float32Array(90 * 3);
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2;
      const e = Math.asin(rnd() * 0.95 + 0.05); // elevasi 3°..72°
      const r = 58;
      arr[i * 3] = 80 + Math.cos(a) * Math.cos(e) * r;
      arr[i * 3 + 1] = Y + Math.sin(e) * r;
      arr[i * 3 + 2] = -3 + Math.sin(a) * Math.cos(e) * r;
    }
    starGeo.setAttribute('position', new T.BufferAttribute(arr, 3));
  }
  const starMat = new T.PointsMaterial({
    color: 0xfff2c0, size: 2, sizeAttenuation: false,
    transparent: true, opacity: 0, fog: false, depthWrite: false,
  });
  const stars = new T.Points(starGeo, starMat);
  stars.renderOrder = 11;
  stars.visible = false;
  group.add(stars);
  const moonMat = basic(0xfff2c0, { transparent: true, opacity: 0, fog: false, depthWrite: false });
  const moon = new T.Mesh(new T.CircleGeometry(3, 20), moonMat);
  moon.position.set(80 + 26, Y + 38, -3 - 34);
  moon.lookAt(80, Y + 2, -3);
  moon.renderOrder = 11;
  moon.visible = false;
  group.add(moon);
  // Cincin outline tinta di sekeliling bulan (cel — bulan ikut bergaris
  // tegas seperti matahari bergaris di langit siang).
  const moonRingMat = basic(INK, { transparent: true, opacity: 0, fog: false, depthWrite: false });
  const moonRing = new T.Mesh(new T.RingGeometry(3.0, 3.4, 24), moonRingMat);
  moonRing.position.copy(moon.position);
  moonRing.lookAt(80, Y + 2, -3);
  moonRing.renderOrder = 11;
  moonRing.visible = false;
  group.add(moonRing);

  // ---- Lampu hangat di dalam zona (4–6 PointLight; sisanya emissive).
  const lightSpots = [
    { x: 60, z: 0 }, { x: 77, z: 0 }, { x: 84, z: -40 },
    { x: 84, z: 33 }, { x: 98, z: 10 },
  ];
  const lights = lightSpots.map((p) => {
    const li = new T.PointLight(0xffb36b, 0, 22, 1.6);
    li.position.set(p.x, Y + 4.5, p.z);
    group.add(li);
    return li;
  });

  // ---- State + update -------------------------------------------------
  let nightFactor = 0;
  const minimap = {
    rect: { ...NM_RECT },
    gate: { ...NM_GATE },
    stage: { ...NM_STAGE },
    rides: [...NM_RIDES, ...NM_GAMES_N, ...NM_GAMES_S],
    stalls: { x: 92, zFrom: -20, zTo: 20, step: 4 },
  };

  function update(dt, t, playerPos) {
    // Nyala obor: scale saja (material bersama, tanpa partikel).
    for (let i = 0; i < torchPos.length; i++) {
      const s = 1 + 0.22 * Math.sin(t * 9 + i * 1.7);
      dummy.position.set(torchPos[i].x, Y + 1.32, torchPos[i].z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, s, 1);
      dummy.updateMatrix();
      flames.setMatrixAt(i, dummy.matrix);
    }
    flames.instanceMatrix.needsUpdate = true;
    // Kubah malam: fade berdasarkan jarak pemain ke rect (0 di dalam,
    // penuh di 6 m dari tepi, hilang di 16 m). Dari desa, siang utuh.
    let k = 1;
    if (playerPos && typeof playerPos.x === 'number') {
      const dx = Math.max(NM_RECT.minX - playerPos.x, 0, playerPos.x - NM_RECT.maxX);
      const dz = Math.max(NM_RECT.minZ - playerPos.z, 0, playerPos.z - NM_RECT.maxZ);
      const d = Math.hypot(dx, dz);
      k = 1 - smoothstep(6, 16, d);
    }
    nightFactor = k;
    const on = k > 0.01;
    dome.visible = on;
    stars.visible = on;
    moon.visible = on;
    moonRing.visible = on;
    // Lampu: sembunyikan total saat jauh (intensitasnya memang 0 di sana).
    // Lampu yang tidak terlihat dikeluarkan three.js dari program shader,
    // menghemat biaya fragment di semua piksel — diukur headless di spawn:
    // frame 432 ms -> 292 ms. Visual sama persis.
    for (const li of lights) li.visible = on;
    if (on) {
      domeMat.opacity = 0.85 * k;
      starMat.opacity = 0.95 * k;
      moonMat.opacity = 0.95 * k;
      moonRingMat.opacity = 0.95 * k;
      for (const li of lights) li.intensity = 26 * k;
    } else {
      for (const li of lights) li.intensity = 0;
    }
  }

  return {
    group, colliders, minimap, update, interactables: [],
    dome, stars, moon, moonRing, lights,
    get nightFactor() { return nightFactor; },
  };
}
