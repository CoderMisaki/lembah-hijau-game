// player.js — karakter ANIME third-person (Bima / Sari) + gerak fisika kustom.
// Overhaul anime 25 Nov 2026 (PRODUCT.md § Karakter): wajah anime (mata
// besar ekspresif, blush, alis, mulut senyum), rambut anime prosedural
// (Bima spiky, Sari twin-tail/panjang), outfit toon + outline tegas.
// Semua material MeshToonMaterial + gradientMap 3-step (cel shading,
// selaras Lane A). Rig jalan/lompat/idle + slot kustomisasi TIDAK berubah.
// Gerak: akselerasi + friksi + momentum, maks ~6 m/s; lompat v0 ~8 m/s,
// gravitasi ~22 m/s^2; menempel terrain; tabrakan lingkaran vs AABB + sungai.
// Penampilan dibentuk dari state kustomisasi (src/customization.js):
// model + warna per kategori — semua geometri prosedural Three.js.
import * as THREE from 'three';
import { GRAVITY, JUMP_VELOCITY, MAX_SPEED, ACCEL, FRICTION, clamp, PLAY_BOUND,
         terrainHeight, resolveCircleVsAABBs, isInRiver, isOnBridge, waterDepth, WATER_Y, bridgeHeight } from './physics.js';
import { defaultCustom, sanitizeCustom, hexOf,
         SKIN_TONES, HAIR_COLORS, PALETTE, FRAME_COLORS } from './customization.js';

export const PLAYER_RADIUS = 0.55;

// --- Cel shading: gradientMap 3-step bersama untuk semua material toon
// karakter (0.59 / 0.80 / 1.0 — bayangan keras khas anime, tanpa blur).
// DataTexture RGBA (bukan RedFormat: sampling .rgb harus netral, bukan merah).
const TOON_STEPS = new THREE.DataTexture(
  new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]),
  3, 1, THREE.RGBAFormat);
TOON_STEPS.minFilter = THREE.NearestFilter;
TOON_STEPS.magFilter = THREE.NearestFilter;
TOON_STEPS.generateMipmaps = false;
TOON_STEPS.needsUpdate = true;

function mat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: TOON_STEPS, ...opts });
}
// Material datar (tidak kena cahaya): iris, pupil, highlight, blush, mulut.
function flatMat(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

// Outline tegas anime (inverted hull, warna --lh-ink #1d2b53): mesh anak
// BackSide yang diskala sedikit lebih besar, jadi ikut transform induknya.
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x1d2b53, side: THREE.BackSide });
function addOutline(mesh, s = 1.05) {
  const o = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  o.scale.setScalar(s);
  o.castShadow = false;
  mesh.add(o);
  return o;
}

// Warna iris anime per gender (tetap, bukan dari kustomisasi — ciri khas).
const IRIS_COLOR = { male: 0x2f6fd0, female: 0xe75480 };
const BLUSH_COLOR = 0xff9fb2;
const MOUTH_COLOR = 0x9c4a3c;

// --- Rambut anime prosedural ---
// Semua gaya: topi rambut (cap) + poni anime (3 jambul kerucut pipih di
// dahi, ujung mengarah ke bawah-depan) + varian gaya. 'long' untuk Sari
// = twin-tail (dua ekor samping + ikat sakura); untuk Bima = rambut
// panjang ke belakang. Mengembalikan { tails } — pivot ekor rambut yang
// digoyang update() (jalan/idle), atau null bila tidak ada ekor.
function addHair(g, style, hairC, skinMat, gender = 'male') {
  const hm = mat(hairC);
  const female = gender === 'female';
  const tails = [];
  const add = (mesh) => { mesh.castShadow = true; g.add(mesh); return mesh; };
  // Topi rambut (cap) — satu bentuk dasar semua gaya, + outline tegas.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hm);
  cap.position.y = 1.9; cap.rotation.x = -0.35; add(cap); addOutline(cap, 1.04);
  // Poni anime: 3 jambul pipih di dahi.
  for (const bx of [-0.17, 0, 0.17]) {
    const bang = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 5), hm);
    bang.scale.z = 0.45;
    bang.position.set(bx, 2.06, 0.3);
    bang.rotation.x = Math.PI - 0.35; // ujung ke bawah, sedikit ke depan
    bang.rotation.z = -bx * 0.9;      // jambul luar miring ke samping
    add(bang);
  }
  // Untaian samping depan (temple strands) — semua gaya kecuali spiky
  // (spiky sudah ramai di atas); jatuh dari pelipis ke pipi.
  if (style !== 'spiky') {
    for (const sx of [-1, 1]) {
      const strand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.07), hm);
      strand.position.set(sx * 0.31, 1.72, 0.16);
      strand.rotation.z = sx * 0.12;
      add(strand);
    }
  }
  if (style === 'short') {
    // Pendek rapi: cap + poni + untaian sudah cukup.
  } else if (style === 'spiky') {
    // Bima: spike tinggi di sekeliling + 2 spike depan paling tinggi.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const tall = i % 2 === 0;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, tall ? 0.38 : 0.28, 5), hm);
      spike.position.set(Math.cos(a) * 0.2, 2.2, Math.sin(a) * 0.2 - 0.05);
      spike.rotation.z = -Math.cos(a) * 0.55; spike.rotation.x = Math.sin(a) * 0.55;
      add(spike);
    }
    const front = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 5), hm);
    front.position.set(0, 2.24, 0.22);
    front.rotation.x = -0.55; // spike depan menjulang ke depan-atas
    add(front);
  } else if (style === 'long') {
    // Panel panjang ke belakang (punggung).
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.16), hm);
    back.position.set(0, 1.45, -0.3); add(back);
    if (female) {
      // Sari: twin-tail — ekor samping diikat pita sakura.
      const tieMat = mat(0xff8fb3);
      for (const sx of [-1, 1]) {
        const pivotT = new THREE.Group();
        pivotT.position.set(sx * 0.34, 1.94, -0.14);
        pivotT.rotation.z = sx * 0.5; // ekor jatuh miring ke luar
        pivotT.userData.baseX = 0;
        pivotT.userData.baseZ = sx * 0.5;
        const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.8, 6), hm);
        tail.position.y = -0.4; tail.castShadow = true;
        pivotT.add(tail);
        const tie = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), tieMat);
        tie.scale.set(1, 0.7, 1); pivotT.add(tie);
        g.add(pivotT);
        tails.push(pivotT);
      }
    }
  } else if (style === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), hm);
    bun.position.set(0, 2.08, -0.3); add(bun); addOutline(bun, 1.06);
  } else if (style === 'ponytail') {
    // Kuncir tinggi di belakang-atas, digoyang update().
    const pivotT = new THREE.Group();
    pivotT.position.set(0, 2.06, -0.3);
    pivotT.rotation.x = 0.5; // ekor mengarah ke belakang-atas
    pivotT.userData.baseX = 0.5;
    pivotT.userData.baseZ = 0;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.55, 6), hm);
    tail.position.y = 0.28; tail.castShadow = true;
    pivotT.add(tail);
    g.add(pivotT);
    tails.push(pivotT);
  }
  void skinMat;
  return tails.length ? { tails } : null;
}

function addHat(g, model, hatC) {
  if (model === 'none') return null;
  const hg = new THREE.Group(); // grup sendiri supaya bisa disembunyikan (mis. dilepas saat tidur)
  const hm = mat(hatC);
  if (model === 'straw') {
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 10), hm);
    top.position.y = 2.18; hg.add(top);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 12), hm);
    brim.position.y = 2.04; hg.add(brim);
  } else if (model === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hm);
    dome.position.y = 1.98; hg.add(dome);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.3), hm);
    visor.position.set(0, 2.0, 0.42); hg.add(visor);
  } else if (model === 'beanie') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.37, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hm);
    dome.position.y = 1.96; hg.add(dome);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.38, 0.12, 10), hm);
    band.position.y = 1.94; hg.add(band);
  } else if (model === 'bandana') {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.37, 0.16, 10), hm);
    band.position.y = 2.0; hg.add(band);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), hm);
    knot.position.set(0, 2.02, -0.36); hg.add(knot);
  }
  g.add(hg);
  return hg;
}

function addGlasses(g, model, frameC) {
  if (model === 'none') return;
  const fm = mat(frameC);
  const lensMat = model === 'shades'
    ? mat(0x111111)
    : mat(0xcfe8ff, { transparent: true, opacity: 0.55 });
  // z digeser maju (0.36) supaya bingkai/lensa duduk DI DEPAN mata anime
  // (iris di z ~0.35) — bukan menembus bola mata.
  for (const ex of [-0.14, 0.14]) {
    const lens = model === 'round'
      ? new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 12), fm)
      : new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.04), fm);
    lens.position.set(ex, 1.88, 0.36);
    g.add(lens);
    if (model !== 'shades') {
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), lensMat);
      glass.position.set(ex, 1.88, 0.365);
      g.add(glass);
    } else {
      const dark = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.02), lensMat);
      dark.position.set(ex, 1.88, 0.365);
      g.add(dark);
    }
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), fm);
  bridge.position.set(0, 1.9, 0.36); g.add(bridge);
}

// --- Wajah anime ---
// Mata besar ekspresif: sklera putih (bola pipih) + iris berwarna datar +
// pupil + highlight putih + bulu mata atas; alis warna rambut; pipi merona
// (blush pink transparan, sedikit diputar mengikuti lengkung pipi); mulut
// senyum (busur torus). Semua menempel di grup `upper` (koordinat dunia
// karakter: kepala pusat y=1.85, r=0.34 — permukaan wajah di y=1.88 ada
// di z≈0.34, di y=1.72 di z≈0.31).
// Mengembalikan grup mata (untuk animasi kedip di Player.update): grup
// berpusat di (0, 1.88, 0) supaya scale.y mengedip di tempat.
function addAnimeFace(upper, gender, hairC) {
  const irisC = IRIS_COLOR[gender] || IRIS_COLOR.male;
  const scleraMat = mat(0xffffff);
  const irisMat = flatMat(irisC);
  const pupilMat = flatMat(0x1d2b53);
  const shineMat = flatMat(0xffffff);
  const lashMat = flatMat(0x1d2b53);
  const eyes = new THREE.Group();
  eyes.position.set(0, 1.88, 0);
  upper.add(eyes);
  for (const sx of [-1, 1]) {
    const ex = sx * 0.13;
    // Sklera: bola pipih menonjol sedikit dari permukaan wajah.
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), scleraMat);
    sclera.scale.set(1, 1.25, 0.5);
    sclera.position.set(ex, 0, 0.3);
    eyes.add(sclera);
    // Iris + pupil + highlight: lingkaran datar di depan sklera.
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.058, 16), irisMat);
    iris.position.set(ex, -0.01, 0.352); eyes.add(iris);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.028, 12), pupilMat);
    pupil.position.set(ex, -0.01, 0.356); eyes.add(pupil);
    const shine = new THREE.Mesh(new THREE.CircleGeometry(0.018, 10), shineMat);
    shine.position.set(ex - 0.02, 0.025, 0.359); eyes.add(shine);
    // Bulu mata atas: garis tebal miring di atas mata.
    const lash = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.028, 0.02), lashMat);
    lash.position.set(ex, 0.125, 0.325);
    lash.rotation.z = -sx * 0.14;
    eyes.add(lash);
  }
  // Alis (warna rambut, di luar grup mata supaya tidak ikut mengedip).
  const browMat = mat(hairC);
  for (const sx of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.032, 0.02), browMat);
    brow.position.set(sx * 0.13, 2.03, 0.3);
    brow.rotation.z = -sx * 0.12;
    upper.add(brow);
  }
  // Pipi merona.
  const blushMat = flatMat(BLUSH_COLOR, { transparent: true, opacity: 0.75 });
  for (const sx of [-1, 1]) {
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), blushMat);
    blush.position.set(sx * 0.215, 1.76, 0.26);
    blush.rotation.y = sx * 0.55;
    upper.add(blush);
  }
  // Mulut senyum (busur ∪).
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 12, Math.PI), flatMat(MOUTH_COLOR));
  mouth.position.set(0, 1.72, 0.315);
  mouth.rotation.z = Math.PI;
  upper.add(mouth);
  return eyes;
}

// --- Rig berartikulasi ---
// Hierarki (semua pose di update() memutar PIVOT, bukan mesh — inilah yang
// memperbaiki kaki "melayang/berputar" di titik tengahnya):
//   g (root: posisi dunia + hadap)
//   ├─ upper (Group: badan+kepala+lengan+rok; bob/napas/condong di sini,
//   │         kaki TIDAK ikut, supaya telapak tetap menapak di tanah)
//   │   ├─ body, head, hair, hat, glasses, eyes, overall/vest, skirt
//   │   └─ armL/armR (pivot bahu, y=1.38)
//   │        ├─ upperArm (pusat y=-0.16, panjang 0.32)
//   │        └─ elbowL/elbowR (pivot siku, y=-0.32)
//   │             ├─ forearm (pusat y=-0.15, panjang 0.30)
//   │             └─ hand (y=-0.32)
//   └─ legL/legR (pivot pinggul, y=0.62)
//        ├─ thigh (pusat y=-0.16, panjang 0.32)
//        └─ kneeL/kneeR (pivot lutut, y=-0.32 → dunia y=0.30)
//             ├─ shin (pusat y=-0.15, panjang 0.30)
//             └─ shoe (child lutut: menempel ujung betis, ikut ayun+tekuk)
// Konvensi rotation.x (maju lokal = +Z): negatif = ayun ke depan,
// positif = ayun ke belakang; lutut positif = betis menekuk ke belakang.
const HIP_Y = 0.62, THIGH_LEN = 0.32, SHIN_LEN = 0.30;
const SHOULDER_Y = 1.38, UPPER_ARM_LEN = 0.32, FOREARM_LEN = 0.30;

function pivot(x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  return p;
}

function seg(geo, material, y) {
  const m = new THREE.Mesh(geo, material);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

// Sepatu sebagai child pivot lutut: sol selalu di ujung betis, apa pun
// ayunan paha / tekukan lututnya. Bentuk per model tetap dipertahankan.
function addShoe(knee, model, shoesMat) {
  const shoe = new THREE.Group();
  shoe.position.z = 0.06; // ujung kaki mengarah ke depan (+Z)
  if (model === 'boots') {
    shoe.add(seg(new THREE.BoxGeometry(0.22, 0.14, 0.44), shoesMat, -0.23));
    // Batang bot menutupi pergelangan / betis bawah.
    shoe.add(seg(new THREE.CylinderGeometry(0.13, 0.14, 0.2, 6), shoesMat, -0.2));
  } else if (model === 'sandals') {
    shoe.add(seg(new THREE.BoxGeometry(0.2, 0.08, 0.42), shoesMat, -0.26));
    const strap = seg(new THREE.BoxGeometry(0.2, 0.03, 0.09), shoesMat, -0.21);
    strap.position.z = 0.1;
    shoe.add(strap);
  } else { // sneakers
    shoe.add(seg(new THREE.BoxGeometry(0.22, 0.14, 0.44), shoesMat, -0.23));
  }
  knee.add(shoe);
  return shoe;
}

function buildLeg(side, pantsModel, pantsMat, skinMat, shoesModel, shoesMat) {
  const hip = pivot(side * 0.18, HIP_Y, 0);
  if (pantsModel === 'shorts') {
    // Celana pendek: paha atas warna celana, sisanya kulit sampai lutut.
    hip.add(seg(new THREE.CylinderGeometry(0.125, 0.12, 0.2, 6), pantsMat, -0.1));
    hip.add(seg(new THREE.CylinderGeometry(0.11, 0.105, 0.12, 6), skinMat, -0.26));
  } else {
    hip.add(seg(new THREE.CylinderGeometry(0.12, 0.11, THIGH_LEN, 6), pantsMat, -THIGH_LEN / 2));
  }
  const knee = pivot(0, -THIGH_LEN, 0);
  hip.add(knee);
  // Betis: kulit bila shorts, warna celana bila pants/skirt (seperti semula).
  const shinMat = pantsModel === 'shorts' ? skinMat : pantsMat;
  knee.add(seg(new THREE.CylinderGeometry(0.11, 0.1, SHIN_LEN, 6), shinMat, -SHIN_LEN / 2));
  const shoe = addShoe(knee, shoesModel, shoesMat);
  return { hip, knee, shoe };
}

function buildArm(side, shirtModel, shirtMat, skinMat, armX = 0.48) {
  const shoulder = pivot(side * armX, SHOULDER_Y, 0);
  shoulder.rotation.z = side * 0.07; // lengan sedikit menjauh dari badan
  shoulder.add(seg(new THREE.CylinderGeometry(0.1, 0.09, UPPER_ARM_LEN, 6), shirtMat, -UPPER_ARM_LEN / 2));
  const elbow = pivot(0, -UPPER_ARM_LEN, 0);
  shoulder.add(elbow);
  // Lengan panjang = baju sampai tangan; kaos/overall/vest = lengan bawah kulit.
  const foreMat = shirtModel === 'long' ? shirtMat : skinMat;
  elbow.add(seg(new THREE.CylinderGeometry(0.09, 0.08, FOREARM_LEN, 6), foreMat, -FOREARM_LEN / 2));
  elbow.add(seg(new THREE.SphereGeometry(0.09, 8, 6), skinMat, -FOREARM_LEN - 0.02));
  return { shoulder, elbow };
}

// Membangun model low-poly dari gender + kustomisasi (model + warna).
export function buildCharacter(gender, customInput) {
  const g = new THREE.Group();
  const c = sanitizeCustom(customInput, gender);
  const skin = hexOf(SKIN_TONES, c.skin, '#e8b88a');
  const shirt = hexOf(PALETTE, c.shirtColor, '#3f7d3a');
  const pants = hexOf(PALETTE, c.pantsColor, '#4a5d8a');
  const hairC = hexOf(HAIR_COLORS, c.hairColor, '#1e130c');
  const hatC = hexOf(PALETTE, c.hatColor, '#d8b36a');
  const frameC = hexOf(FRAME_COLORS, c.glassesColor, '#1a1a1a');
  const shoesC = hexOf(PALETTE, c.shoesColor, '#6e4a26');
  const skinMat = mat(skin), shirtMat = mat(shirt), pantsMat = mat(pants);

  // Badan + kepala + aksesori: satu grup "upper" supaya bob/napas/condong
  // menggerakkan torso utuh (dulu body saja yang naik-turun, kepala diam).
  const upper = new THREE.Group();
  g.add(upper);
  // Sari sedikit lebih ramping dari Bima (bahu/siluet); rig TIDAK berubah.
  const female = gender === 'female';
  const bodyR = female ? 0.3 : 0.34, bodyR2 = female ? 0.38 : 0.42;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(bodyR, bodyR2, 0.85, 8), shirtMat);
  body.position.y = 1.05; body.castShadow = true; upper.add(body); addOutline(body, 1.04);
  if (c.shirtModel === 'overall') {
    // Overall: tali bahu + dada warna celana.
    for (const sx of [-0.16, 0.16]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.05), pantsMat);
      strap.position.set(sx, 1.35, 0.36); upper.add(strap);
    }
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.35, 0.06), pantsMat);
    bib.position.set(0, 1.2, 0.36); upper.add(bib);
  } else if (c.shirtModel === 'vest') {
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.6, 0.1), pantsMat);
    vest.position.set(0, 1.1, 0.36); upper.add(vest);
  }
  // Aksen outfit khas per gender (toon, warna token PRODUCT.md).
  if (female) {
    // Pita sakura di leher Sari (dua sayap + simpul).
    const bowMat = mat(0xff8fb3);
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.17, 4), bowMat);
      wing.scale.z = 0.4;
      wing.position.set(sx * 0.1, 1.52, 0.36);
      wing.rotation.z = sx * Math.PI / 2;
      upper.add(wing);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bowMat);
    knot.position.set(0, 1.52, 0.37); upper.add(knot);
  } else {
    // Kerah putih Bima.
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.09, 8), mat(0xfff6e5));
    collar.position.y = 1.48; upper.add(collar);
  }
  // Kepala + rambut + topi + kacamata + wajah anime.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), skinMat);
  head.position.y = 1.85; head.castShadow = true; upper.add(head); addOutline(head, 1.04);
  const hair = addHair(upper, c.hairStyle, hairC, skinMat, gender);
  const hatGroup = addHat(upper, c.hatModel, hatC);
  addGlasses(upper, c.glassesModel, frameC);
  // Wajah anime: mata besar + alis + blush + senyum (ganti mata titik lama).
  const eyes = addAnimeFace(upper, gender, hairC);
  // Lengan berartikulasi (bahu + siku).
  const armX = female ? 0.44 : 0.48;
  const armL = buildArm(-1, c.shirtModel, shirtMat, skinMat, armX);
  const armR = buildArm(1, c.shirtModel, shirtMat, skinMat, armX);
  upper.add(armL.shoulder); upper.add(armR.shoulder);
  // Kaki berartikulasi (pinggul + lutut + sepatu menempel betis).
  const shoesMat = mat(shoesC);
  const legL = buildLeg(-1, c.pantsModel, pantsMat, skinMat, c.shoesModel, shoesMat);
  const legR = buildLeg(1, c.pantsModel, pantsMat, skinMat, c.shoesModel, shoesMat);
  g.add(legL.hip); g.add(legR.hip);
  if (c.pantsModel === 'skirt') {
    // Rok menempel torso (ikut bob), kaki tetap berayun di bawahnya.
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.7, 8), pantsMat);
    skirt.position.y = 0.5; upper.add(skirt);
  }
  g.userData = {
    armL: armL.shoulder, armR: armR.shoulder,
    legL: legL.hip, legR: legR.hip,
    body, head, upper, hat: hatGroup,
    elbowL: armL.elbow, elbowR: armR.elbow,
    kneeL: legL.knee, kneeR: legR.knee,
    shoeL: legL.shoe, shoeR: legR.shoe,
    eyes, tails: hair ? hair.tails : null, // anime: kedip + goyang ekor rambut
  };
  g.userData.custom = c;
  return g;
}

export class Player {
  constructor(scene, gender = 'male', x = 0, z = 0, custom = null) {
    this.gender = gender;
    this.custom = sanitizeCustom(custom, gender);
    this.x = x; this.z = z;
    this.yOff = 0;      // tinggi lompat di atas terrain
    this.vy = 0;
    this.vx = 0; this.vz = 0;
    this.facing = 0;
    this.moving = false;
    this.walkPhase = 0;
    this.walkAmp = 0;    // amplitudo jalan terhaluskan: 0 diam → 1 lari
    this.airBlend = 0;   // 0 menapak → 1 melayang (pose lompat)
    this.breathPhase = 0;
    this.landDip = 0;    // crouch sesaat setelah mendarat (meluruh)
    this.swimming = false; // di air dalam: mengapung + berenang
    this.swimBlend = 0;    // 0 jalan ↔ 1 renang (dihaluskan)
    this.swimPhase = 0;    // fase tendangan/dayungan
    this.swimAmp = 0;      // amplitudo renang terhaluskan
    this._bobPhase = 0;    // naik-turun mengapung
    this._blinkNext = 2 + Math.random() * 2; // jeda sampai kedip anime berikutnya (detik)
    this._blinkT = 0;      // sisa durasi kedip yang sedang berjalan
    this._wasAir = false;
    // Berbaring (urutan tidur): group diputar -90° (kepala ke -Z, ke arah
    // bantal bila menghadap selatan) + diangkat ke atas kasur. Rig/kustomisasi
    // TIDAK diubah — hanya pose grup + lift yang di-blend halus.
    this.lying = false;
    this._lieBlend = 0;    // 0 berdiri ↔ 1 berbaring
    this._lieLift = 0.95;  // asal grup di atas tanah saat berbaring (kasur ~0.72 + setengah tebal badan)
    this.group = buildCharacter(gender, this.custom);
    this.group.position.set(x, terrainHeight(x, z), z);
    scene.add(this.group);
  }
  // Tanah di bawah kaki: papan jembatan (y=1.0) saat di atas jembatan, terrain biasa jika tidak.
  // Tanah di bawah kaki: tanjakan + deck jembatan bila di koridornya,
  // terrain biasa bila di luar (bridgeHeight mengembalikan terrain di luar
  // koridor, jadi sambungan ke daratan kontinu).
  groundAt(x, z) { return bridgeHeight(x, z); }
  get y() { return this.groundAt(this.x, this.z) + this.yOff; }
  setGender(scene, gender) {
    if (gender === this.gender) return;
    this.gender = gender;
    this.custom = sanitizeCustom(this.custom, gender);
    this.rebuild(scene);
  }
  // Terapkan kustomisasi baru (dipakai layar kustomisasi + load save).
  applyCustomization(scene, custom) {
    this.custom = sanitizeCustom(custom, this.gender);
    this.rebuild(scene);
  }
  rebuild(scene) {
    scene.remove(this.group);
    this.group = buildCharacter(this.gender, this.custom);
    this.group.position.set(this.x, this.y, this.z);
    scene.add(this.group);
  }
  teleport(x, z) {
    this.x = clamp(x, -PLAY_BOUND, PLAY_BOUND); this.z = clamp(z, -PLAY_BOUND, PLAY_BOUND);
    this.vx = 0; this.vz = 0; this.yOff = 0; this.vy = 0;
    this._wasAir = false; this.landDip = 0;
    this.group.position.set(this.x, this.y, this.z);
  }
  jump() {
    if (this.swimming) return false; // di air tidak bisa lompat — berenang saja
    // Buff jajanan (pasar malam): jumpMul dari game.buffs, disinkron main.js
    // tiap frame ke this.buffs (default 1 bila belum ada).
    if (this.yOff <= 0.01) { this.vy = JUMP_VELOCITY * (this.buffs?.jumpMul || 1); this.yOff = 0.01; return true; }
    return false;
  }
  // Pose berbaring untuk urutan tidur. Menghadap selatan (facing 0) supaya
  // kepala jatuh ke utara — ke arah bantal. Dipanggil main.js saat fase
  // 'lying'; update() yang menganimasikan transisinya via _lieBlend.
  setLying(v) {
    this.lying = !!v;
    // Topi dilepas saat tidur (tidak ikut rebah — kalau tidak, topi
    // melayang di atas kepala saat grup diputar -90 derajat).
    const hat = this.group.userData.hat;
    if (hat) hat.visible = !this.lying;
    if (this.lying) {
      this.vx = 0; this.vz = 0; this.vy = 0; this.yOff = 0;
      this.facing = 0;
      this.group.rotation.y = 0;
    }
  }
  // move: {x, y} di ruang kamera (y = maju). dt detik. running = sprint 1.6x.
  update(dt, move, colliders, running = false) {
    // --- Berbaring: tanpa fisika/gerak, pose diluruskan halus ke rebah. ---
    if (this.lying) {
      this._lieBlend += (1 - this._lieBlend) * Math.min(1, dt * 6);
      const k = Math.min(1, dt * 6);
      const u = this.group.userData;
      const ease = (obj, prop, target) => { obj[prop] += (target - obj[prop]) * k; };
      ease(u.legL.rotation, 'x', 0); ease(u.legR.rotation, 'x', 0);
      ease(u.kneeL.rotation, 'x', 0.05); ease(u.kneeR.rotation, 'x', 0.05);
      ease(u.armL.rotation, 'x', 0); ease(u.armR.rotation, 'x', 0);
      ease(u.elbowL.rotation, 'x', -0.1); ease(u.elbowR.rotation, 'x', -0.1);
      ease(u.upper.rotation, 'x', 0); ease(u.upper.rotation, 'z', 0);
      ease(u.upper.position, 'y', 0);
      this.group.rotation.x = -Math.PI / 2 * this._lieBlend;
      this.group.position.set(this.x, this.groundAt(this.x, this.z) + this._lieLift * this._lieBlend, this.z);
      return;
    }
    // Bangun dari berbaring: blend kembali ke 0 (diterapkan di akhir update).
    this._lieBlend += (0 - this._lieBlend) * Math.min(1, dt * 6);
    // Kamera menghadap -Z dunia (dari belakang karakter, sedikit dari atas):
    // maju = -Z, kanan = +X.
    const mx = move.x, mz = -move.y;
    const mag = move.mag || 0;
    // Berenang bila di sungai DAN air cukup dalam (di atas pinggang).
    this.swimming = isInRiver(this.x, this.z) && waterDepth(this.x, this.z) > 0.9;
    this.moving = mag > 0.05;
    if (this.moving) {
      this.vx += mx * ACCEL * dt;
      this.vz += mz * ACCEL * dt;
      const sp = Math.hypot(this.vx, this.vz);
      // Buff jajanan (pasar malam): speedMul hanya di DARAT, swimMul hanya
      // di AIR (kontrak merge: "renang x0,55 dengan swimMul"; "lari +15%"
      // tidak ikut berenang). Shift (running) tetap berlaku di air (5,28).
      const b = this.buffs || {};
      const max = MAX_SPEED * (0.4 + 0.6 * mag) * (running ? 1.6 : 1)
        * (this.swimming ? 0.55 * (b.swimMul || 1) : (b.speedMul || 1));
      if (sp > max) { this.vx *= max / sp; this.vz *= max / sp; }
      this.facing = Math.atan2(this.vx, this.vz);
    } else {
      // Friksi: melambat halus, bukan berhenti instan (momentum).
      const f = Math.max(0, 1 - FRICTION * dt);
      this.vx *= f; this.vz *= f;
      if (Math.hypot(this.vx, this.vz) < 0.05) { this.vx = 0; this.vz = 0; }
    }
    // Gerak per-sumbu agar bisa meluncur (slide) di sepanjang dinding/sungai.
    let nx = this.x + this.vx * dt;
    let nz = this.z;
    if (!isInRiver(nx, nz)) {
      const r1 = resolveCircleVsAABBs(nx, nz, PLAYER_RADIUS, colliders);
      nx = r1.x; nz = r1.z;
    }
    let nz2 = this.z + this.vz * dt;
    if (!isInRiver(nx, nz2)) {
      const r2 = resolveCircleVsAABBs(nx, nz2, PLAYER_RADIUS, colliders);
      nx = r2.x; nz2 = r2.z;
    }
    // Perenang tidak bisa lewat bawah jembatan (kepala mentok papan).
    if (this.swimming && isOnBridge(nx, nz2)) { nx = this.x; nz2 = this.z; }
    this.x = clamp(nx, -PLAY_BOUND, PLAY_BOUND);
    this.z = clamp(nz2, -PLAY_BOUND, PLAY_BOUND);
    // Gravitasi + lompat — di air: mengapung, bukan jatuh.
    const wasAir = this._wasAir;
    if (this.swimming) {
      this.vy = 0;
      this._wasAir = false;
      // Mengapung: permukaan air setinggi dada, naik-turun pelan.
      const targetYOff = (WATER_Y - 1.15) - this.groundAt(this.x, this.z) + Math.sin(this._bobPhase) * 0.05;
      this.yOff += (targetYOff - this.yOff) * Math.min(1, dt * 6);
      this._bobPhase += dt * 2.2;
    } else {
      // Keluar dari air: yOff negatif kembali ke 0 (naik ke darat).
      if (this.yOff < 0) this.yOff = Math.min(0, this.yOff + dt * 2.5);
      if (this.yOff > 0 || this.vy > 0) {
        this.vy -= GRAVITY * dt;
        this.yOff += this.vy * dt;
        if (this.yOff <= 0) { this.yOff = 0; this.vy = 0; }
      }
      // Baru mendarat (sebelumnya di udara, kini menapak): picu crouch.
      if (wasAir && this.yOff === 0 && this.vy === 0) this.landDip = 1;
      this._wasAir = this.yOff > 0.01 || this.vy > 0;
    }
    // Pose + animasi jalan (rig berartikulasi — lihat buildCharacter).
    // Konvensi rotation.x: negatif = ayun ke depan, positif = ke belakang;
    // lutut positif = betis menekuk ke belakang.
    const sp = Math.hypot(this.vx, this.vz);
    const speedF = clamp(sp / MAX_SPEED, 0, 1);
    const airborne = this.yOff > 0.01 || this.vy > 0;
    // Fase jalan berbasis JARAK tempuh, bukan waktu mentah: panjang
    // langkah tumbuh dengan kecepatan (0.45 m pelan → ~1.1 m saat lari);
    // satu siklus penuh (2π) = 2 langkah. Fase membeku saat melayang.
    if (!airborne && sp > 0.05) {
      const stepLen = 0.45 + 0.11 * sp;
      this.walkPhase += (sp * dt * Math.PI) / stepLen;
    }
    // Tendangan renang: irama tetap walau laju berubah.
    if (this.swimming && sp > 0.05) this.swimPhase += dt * (5 + sp * 1.5);
    this.swimAmp += ((this.swimming ? clamp(sp / 3.3, 0, 1) : 0) - this.swimAmp) * Math.min(1, dt * 6);
    this.swimBlend += ((this.swimming ? 1 : 0) - this.swimBlend) * Math.min(1, dt * 6);
    // Amplitudo jalan + blend udara dihaluskan → transisi jalan↔diam
    // dan tanah↔udara tanpa lompatan pose.
    this.walkAmp += ((airborne ? 0 : speedF) - this.walkAmp) * Math.min(1, dt * 8);
    this.airBlend += ((airborne ? 1 : 0) - this.airBlend) * Math.min(1, dt * 10);
    this.breathPhase += dt * 1.6; // napas: ~1 tarikan per 4 detik
    this.landDip *= Math.exp(-dt * 4);
    const amp = this.walkAmp, ab = this.airBlend;
    const ph = this.walkPhase;
    const sinP = Math.sin(ph), cosP = Math.cos(ph);
    const breath = Math.sin(this.breathPhase);
    // --- Pose menapak: jalan (diskala amp) + idle napas (diskala 1-amp).
    // Kaki ayun berlawanan fase; lutut menekuk saat kaki terangkat
    // (cos > 0: paha melewati vertikal ke depan) & lurus saat menapak.
    const legLxW = -0.55 * amp * sinP;
    const legRxW = 0.55 * amp * sinP;
    const kneeLxW = (0.08 + 0.95 * Math.max(0, cosP)) * amp;
    const kneeRxW = (0.08 + 0.95 * Math.max(0, -cosP)) * amp;
    const armLxW = 0.5 * amp * sinP;   // lengan lawan kaki se-sisi
    const armRxW = -0.5 * amp * sinP;
    const elbLxW = -(0.15 + 0.3 * amp * Math.max(0, -sinP));
    const elbRxW = -(0.15 + 0.3 * amp * Math.max(0, sinP));
    const bobW = 0.045 * amp * Math.abs(sinP); // bob 2x frekuensi langkah
    const leanW = 0.02 + 0.08 * speedF;        // condong ∝ kecepatan
    const swayW = 0.03 * amp * sinP;           // goyang berat badan
    // --- Pose berenang: badan condong ke depan, tangan mendayung bergantian,
    // kaki menendang kecil-cepat. Di-blend dari pose jalan via swimBlend.
    const sb = this.swimBlend;
    const kick = Math.sin(this.swimPhase), kick2 = Math.sin(this.swimPhase + Math.PI);
    const sAmp = 0.4 + 0.6 * this.swimAmp;
    const legLxS = -0.3 * sAmp * kick, legRxS = -0.3 * sAmp * kick2;
    const kneeLxS = 0.5 + 0.35 * Math.max(0, kick), kneeRxS = 0.5 + 0.35 * Math.max(0, kick2);
    const armLxS = -1.1 + 0.8 * kick, armRxS = -1.1 + 0.8 * kick2;
    const u = this.group.userData;
    // --- Kedip anime: tiap ~2.5–4.5 detik, mata mengecil selama 0.14 detik.
    this._blinkNext -= dt;
    if (this._blinkNext <= 0) { this._blinkNext = 2.5 + Math.random() * 2; this._blinkT = 0.14; }
    if (u.eyes) {
      if (this._blinkT > 0) {
        this._blinkT -= dt;
        const k = Math.min(1, Math.max(0, (0.14 - this._blinkT) / 0.14));
        u.eyes.scale.y = 1 - Math.sin(k * Math.PI) * 0.9;
      } else u.eyes.scale.y = 1;
    }
    // --- Goyang ekor rambut (twin-tail / ponytail): ikut langkah + napas.
    if (u.tails) {
      for (const t of u.tails) {
        t.rotation.x = t.userData.baseX + Math.sin(ph) * 0.08 * amp + Math.sin(this.breathPhase) * 0.02;
        t.rotation.z = t.userData.baseZ + Math.cos(ph) * 0.05 * amp;
      }
    }
    const L = (w, a) => (1 - ab) * w + ab * a; // blend menapak ↔ udara
    const B = (walk, swim) => walk * (1 - sb) + swim * sb; // blend jalan ↔ renang
    u.legL.rotation.x = B(L(legLxW, -0.35), legLxS);
    u.legR.rotation.x = B(L(legRxW, 0.25), legRxS);
    u.kneeL.rotation.x = B(L(kneeLxW, 0.55), kneeLxS) + 0.35 * this.landDip * (1 - ab) * (1 - sb);
    u.kneeR.rotation.x = B(L(kneeRxW, 0.85), kneeRxS) + 0.35 * this.landDip * (1 - ab) * (1 - sb);
    u.armL.rotation.x = B(L(armLxW + (1 - amp) * (0.04 + 0.02 * breath), -0.45), armLxS);
    u.armR.rotation.x = B(L(armRxW + (1 - amp) * (0.04 + 0.02 * breath), -0.45), armRxS);
    u.elbowL.rotation.x = B(L(elbLxW, -0.5), -0.6);
    u.elbowR.rotation.x = B(L(elbRxW, -0.5), -0.6);
    u.upper.position.y = (1 - sb) * (1 - ab) * (bobW + 0.012 * breath * (1 - amp) - 0.05 * this.landDip);
    u.upper.rotation.x = B(L(leanW, 0.06), 0.5);
    u.upper.rotation.z = (1 - ab) * swayW * (1 - sb);
    this.group.position.set(this.x, this.y + this._lieLift * this._lieBlend, this.z);
    // Sisa transisi bangun: grup kembali tegak seiring _lieBlend → 0.
    this.group.rotation.x = -Math.PI / 2 * this._lieBlend;
    // Hadap arah gerak (lerp sudut).
    let df = this.facing - this.group.rotation.y;
    while (df > Math.PI) df -= Math.PI * 2;
    while (df < -Math.PI) df += Math.PI * 2;
    this.group.rotation.y += df * Math.min(1, dt * 12);
  }
}
