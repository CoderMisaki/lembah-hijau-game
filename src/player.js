// player.js — karakter ANIME third-person (Bima / Sari) + gerak fisika kustom.
// Overhaul anime 25 Nov 2026 (PRODUCT.md § Karakter): wajah anime (mata
// besar ekspresif, blush, alis, mulut senyum), rambut anime prosedural
// (Bima spiky, Sari twin-tail/panjang), outfit toon + outline tegas.
// Semua material MeshToonMaterial + gradientMap 3-step (cel shading,
// selaras Lane A). Rig jalan/lompat/idle + slot kustomisasi TIDAK berubah.
// Lane F (anti-kayu, 27 Nov 2026): squash & stretch berpegas, antisipasi
// + follow-through (condong/kepala berpegas), kedip, transisi ekspresi
// halus (+ 'surprised'), idle hidup (napas dada, toleh kepala, pindah
// berat), secondary motion rambut/syal (pegas per helai), grup kepala
// (headG) supaya kepala bisa menoleh tanpa melepas wajah. Proporsi chibi
// DIPERTAHANKAN; buildCharacter() API tidak berubah.
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

// --- Lane F (anti-kayu, 27 Nov 2026): util animasi hidup ---
// HEAD_Y: pusat kepala dalam ruang `upper` — grup kepala (headG) duduk di
// sini; semua bagian kepala/rambut/topi/wajah diposisikan relatif ke titik
// ini supaya kepala bisa menoleh/mengangguk tanpa melepas wajah dari kepala.
// Posisi dunia TIDAK berubah: tiap bagian digeser -HEAD_Y di
// addHair/addHat/addGlasses/addAnimeFace (angka asli dipertahankan).
const HEAD_Y = 1.85;
// dampF(rate, dt): faktor lerp independen frame-rate (1 - exp(-rate*dt)).
const dampF = (rate, dt) => 1 - Math.exp(-rate * dt);
// springStep(s, target, k, c, dt): pegas underdamped (Euler semi-implisit).
// s = {x, v}; k = kekakuan, c = redaman. dt dijepit 1/30 supaya stabil saat
// frame tersendat. Mengembalikan x baru (dengan overshoot halus, bukan snap).
function springStep(s, target, k, c, dt) {
  const h = Math.min(dt, 1 / 30);
  s.v += ((target - s.x) * k - s.v * c) * h;
  s.x += s.v * h;
  return s.x;
}

// Warna iris anime per gender — COZY-A: kedua ref bermata cokelat besar,
// jadi iris cokelat hangat untuk Bima maupun Sari (dulu biru/pink).
const IRIS_COLOR = { male: 0x7a4a21, female: 0x7a4a21 };
const BLUSH_COLOR = 0xff9fb2;
const MOUTH_COLOR = 0x9c4a3c;

// --- Rambut anime prosedural ---
// Semua gaya: topi rambut (cap) + poni anime (3 jambul kerucut pipih di
// dahi, ujung mengarah ke bawah-depan) + varian gaya. 'long' untuk Sari
// = twin-tail (dua ekor samping + ikat sakura); untuk Bima = rambut
// panjang ke belakang. 'braids' (COZY-A) = dua kepang samping + ikat
// sakura, default Sari mengikuti ref-cewe. Mengembalikan
// { tails, springs } — pivot ekor rambut yang digoyang update()
// (jalan/idle) + pegas secondary motion (spike/panel/ekor), atau null
// bila tidak ada ekor maupun pegas. Semua posisi Y relatif ke pusat
// kepala (HEAD_Y) karena g = headG.
//
// COZY-A — perbaikan clip rambut×topi (struktural): addHair menerima
// hatModel. Topi yang MENUTUP puncak kepala ('straw'/'cap'/'beanie'/
// 'bandana') memipihkan cap rambut (scale.y 0.55, y 1.86 → puncak
// ≈2.05, di bawah permukaan atas brim 2.07), memendekkan poni, dan
// menyembunyikan spike/bun/ponytail tinggi (diganti untaian samping
// rendah / posisi lebih rendah) — jadi tidak ada lagi geometri rambut
// yang menembus permukaan atas topi. 'visor' tidak menutup puncak
// (hanya band + brim depan), jadi rambut dibiarkan penuh. 'none'
// juga tanpa perubahan. Lihat verifikasi di LANE-A-REPORT.md §4.
function addHair(g, style, hairC, skinMat, gender = 'male', hatModel = 'none') {
  const hm = mat(hairC);
  const female = gender === 'female';
  const tails = [];
  // Lane F: pegas secondary motion — tiap spike/panel/ekor punya 2 entri
  // (sumbu x dan z): { obj, axis, base, kind, stiff, damp, x, v }.
  const springs = [];
  const add = (mesh) => { mesh.castShadow = true; g.add(mesh); return mesh; };
  // Topi yang menutup puncak kepala → rambut di bawahnya harus pipih.
  const coversTop = ['straw', 'cap', 'beanie', 'bandana'].includes(hatModel);
  // Topi rambut (cap) — satu bentuk dasar semua gaya, + outline tegas.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hm);
  cap.position.y = (coversTop ? 1.86 : 1.9) - HEAD_Y;
  if (coversTop) cap.scale.y = 0.55; // pipih di bawah topi (puncak ≈2.05)
  cap.rotation.x = -0.35; add(cap); addOutline(cap, 1.04);
  // Poni anime: 3 jambul pipih di dahi.
  for (const bx of [-0.17, 0, 0.17]) {
    const bang = new THREE.Mesh(new THREE.ConeGeometry(0.1, coversTop ? 0.15 : 0.24, 5), hm);
    bang.scale.z = 0.45;
    // Di bawah topi penutup: poni lebih pendek + lebih rendah (puncak
    // ≈1.98 — di bawah permukaan dome beanie 2.01 di tepi, di bawah
    // brim straw 2.07 dan bandana 2.08).
    bang.position.set(bx, (coversTop ? 1.91 : 2.06) - HEAD_Y, 0.3);
    bang.rotation.x = Math.PI - 0.35; // ujung ke bawah, sedikit ke depan
    bang.rotation.z = -bx * 0.9;      // jambul luar miring ke samping
    add(bang);
  }
  // Untaian samping depan (temple strands) — semua gaya kecuali spiky
  // tanpa topi (spiky sudah ramai di atas); jatuh dari pelipis ke pipi.
  // Saat topi menutup puncak, spiky pun dapat untaian rendah ini sebagai
  // pengganti spike yang disembunyikan (tetap di bawah brim, aman).
  if (style !== 'spiky' || coversTop) {
    for (const sx of [-1, 1]) {
      const strand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.07), hm);
      strand.position.set(sx * 0.31, 1.72 - HEAD_Y, 0.16);
      strand.rotation.z = sx * 0.12;
      add(strand);
    }
  }
  if (style === 'short') {
    // Pendek rapi: cap + poni + untaian sudah cukup.
  } else if (style === 'spiky') {
    // Bima: spike tinggi di sekeliling + 2 spike depan paling tinggi.
    // Di bawah topi penutup puncak spike disembunyikan total (ujungnya
    // sampai 2.44 — menembus dome/brim apa pun); untaian samping di atas
    // yang menggantikannya.
    if (!coversTop) {
      // Lane F: tiap spike dibungkus pivot di posisinya (mesh anak di
      // 0,0,0, rotasi bawaan dipertahankan) supaya secondary motion bisa
      // menggoyang spike tanpa menggeser geometrinya.
      const wrapSpike = (mesh) => {
        const pv = new THREE.Group();
        pv.position.copy(mesh.position);
        mesh.position.set(0, 0, 0);
        mesh.castShadow = true;
        pv.add(mesh); g.add(pv);
        springs.push(
          { obj: pv, axis: 'x', base: 0, kind: 'spike', stiff: 120, damp: 10, x: 0, v: 0 },
          { obj: pv, axis: 'z', base: 0, kind: 'spike', stiff: 120, damp: 10, x: 0, v: 0 },
        );
      };
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const tall = i % 2 === 0;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, tall ? 0.38 : 0.28, 5), hm);
        spike.position.set(Math.cos(a) * 0.2, 2.2 - HEAD_Y, Math.sin(a) * 0.2 - 0.05);
        spike.rotation.z = -Math.cos(a) * 0.55; spike.rotation.x = Math.sin(a) * 0.55;
        wrapSpike(spike);
      }
      const front = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 5), hm);
      front.position.set(0, 2.24 - HEAD_Y, 0.22);
      front.rotation.x = -0.55; // spike depan menjulang ke depan-atas
      wrapSpike(front);
    }
  } else if (style === 'long') {
    // Panel panjang ke belakang (punggung).
    // Lane F: dibungkus pivot di tepi atasnya (y 1.87) supaya panel bisa
    // bergoyang mengikuti langkah; mesh anak di (0,-0.42,0).
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.16), hm);
    back.castShadow = true;
    const backPv = new THREE.Group();
    backPv.position.set(0, 1.87 - HEAD_Y, -0.3);
    back.position.set(0, -0.42, 0);
    backPv.add(back); g.add(backPv);
    springs.push(
      { obj: backPv, axis: 'x', base: 0, kind: 'back', stiff: 80, damp: 9, x: 0, v: 0 },
      { obj: backPv, axis: 'z', base: 0, kind: 'back', stiff: 80, damp: 9, x: 0, v: 0 },
    );
    if (female) {
      // Sari: twin-tail — ekor samping diikat pita sakura.
      const tieMat = mat(0xff8fb3);
      for (const sx of [-1, 1]) {
        const pivotT = new THREE.Group();
        pivotT.position.set(sx * 0.34, 1.94 - HEAD_Y, -0.14);
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
        springs.push(
          { obj: pivotT, axis: 'x', base: pivotT.userData.baseX, kind: 'tail', stiff: 90, damp: 9, x: 0, v: 0 },
          { obj: pivotT, axis: 'z', base: pivotT.userData.baseZ, kind: 'tail', stiff: 90, damp: 9, x: 0, v: 0 },
        );
      }
    }
  } else if (style === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), hm);
    // Di bawah topi penutup: sanggul turun ke tengkuk + pipih (puncak
    // 1.81) — sanggul atas (y 2.08) menembus rim belakang beanie.
    bun.position.set(0, (coversTop ? 1.7 : 2.08) - HEAD_Y, -0.3);
    if (coversTop) bun.scale.y = 0.65;
    add(bun); addOutline(bun, 1.06);
  } else if (style === 'ponytail') {
    // Kuncir tinggi di belakang-atas, digoyang update().
    const pivotT = new THREE.Group();
    // Di bawah topi penutup: pivot turun + ekor miring ke belakang-BAWAH
    // (rotation.x negatif — positif malah mengarah ke depan, menembus
    // topi), supaya ekor keluar di BAWAH brim/band, bukan menembusnya.
    pivotT.position.set(0, (coversTop ? 1.8 : 2.06) - HEAD_Y, -0.3);
    pivotT.rotation.x = coversTop ? -1.35 : 0.5; // ekor mengarah ke belakang-atas
    pivotT.userData.baseX = coversTop ? -1.35 : 0.5;
    pivotT.userData.baseZ = 0;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.55, 6), hm);
    tail.position.y = 0.28; tail.castShadow = true;
    pivotT.add(tail);
    g.add(pivotT);
    tails.push(pivotT);
    springs.push(
      { obj: pivotT, axis: 'x', base: pivotT.userData.baseX, kind: 'tail', stiff: 90, damp: 9, x: 0, v: 0 },
      { obj: pivotT, axis: 'z', base: pivotT.userData.baseZ, kind: 'tail', stiff: 90, damp: 9, x: 0, v: 0 },
    );
  } else if (style === 'braids') {
    // COZY-A: dua kepang (ref-cewe) — tiap kepang 3 ruas membesar ke
    // bawah + ujung runcing, diikat pita sakura di pangkalnya. Rambut
    // belakang dibulatkan (silinder pipih, bukan kotak) supaya dari
    // belakang terbaca sebagai jatuhan rambut, bukan papan.
    // Lane F: dibungkus pivot di tepi atasnya (y 1.8) supaya bisa bergoyang.
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 6), hm);
    back.scale.z = 0.45;
    back.castShadow = true;
    const backPv = new THREE.Group();
    backPv.position.set(0, 1.8 - HEAD_Y, -0.28);
    back.position.set(0, -0.25, 0);
    backPv.add(back); g.add(backPv);
    springs.push(
      { obj: backPv, axis: 'x', base: 0, kind: 'back', stiff: 80, damp: 9, x: 0, v: 0 },
      { obj: backPv, axis: 'z', base: 0, kind: 'back', stiff: 80, damp: 9, x: 0, v: 0 },
    );
    const tieMat = mat(0xff8fb3);
    for (const sx of [-1, 1]) {
      const pivotT = new THREE.Group();
      pivotT.position.set(sx * 0.36, 1.92 - HEAD_Y, -0.05);
      pivotT.rotation.z = sx * 0.35; // kepang jatuh miring ke luar
      pivotT.userData.baseX = 0;
      pivotT.userData.baseZ = sx * 0.35;
      // Inti kepang (silinder tipis) + ruas bola yang bertumpuk rapat —
      // tanpa inti, ruasnya terbaca seperti manik-manik berderet.
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.52, 6), hm);
      core.position.y = -0.28; core.castShadow = true;
      pivotT.add(core);
      // Ruas kepang: bola-bola berselang-seling (anyaman) + ujung kerucut.
      const segR = [0.095, 0.085, 0.075];
      const segY = [-0.09, -0.24, -0.38];
      for (let i = 0; i < 3; i++) {
        const segB = new THREE.Mesh(new THREE.SphereGeometry(segR[i], 8, 6), hm);
        segB.position.set(i % 2 === 0 ? 0.02 : -0.02, segY[i], 0);
        segB.scale.set(1, 0.85, 0.9);
        segB.castShadow = true;
        pivotT.add(segB);
      }
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), hm);
      tip.position.y = -0.55; tip.rotation.x = Math.PI;
      pivotT.add(tip);
      const tie = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), tieMat);
      tie.scale.set(1, 0.7, 1); pivotT.add(tie);
      g.add(pivotT);
      tails.push(pivotT);
      springs.push(
        { obj: pivotT, axis: 'x', base: pivotT.userData.baseX, kind: 'tail', stiff: 90, damp: 9, x: 0, v: 0 },
        { obj: pivotT, axis: 'z', base: pivotT.userData.baseZ, kind: 'tail', stiff: 90, damp: 9, x: 0, v: 0 },
      );
    }
  }
  void skinMat;
  if (!tails.length && !springs.length) return null;
  return { tails: tails.length ? tails : null, springs: springs.length ? springs : null };
}

function addHat(g, model, hatC) {
  if (model === 'none') return null;
  const hg = new THREE.Group(); // grup sendiri supaya bisa disembunyikan (mis. dilepas saat tidur)
  const hm = mat(hatC);
  // Lane F: posisi Y relatif ke pusat kepala (HEAD_Y) karena g = headG.
  if (model === 'straw') {
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 10), hm);
    top.position.y = 2.18 - HEAD_Y; hg.add(top);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 12), hm);
    brim.position.y = 2.04 - HEAD_Y; hg.add(brim);
  } else if (model === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hm);
    dome.position.y = 1.98 - HEAD_Y; hg.add(dome);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.3), hm);
    visor.position.set(0, 2.0 - HEAD_Y, 0.42); hg.add(visor);
  } else if (model === 'beanie') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.37, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hm);
    dome.position.y = 1.96 - HEAD_Y; hg.add(dome);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.38, 0.12, 10), hm);
    band.position.y = 1.94 - HEAD_Y; hg.add(band);
  } else if (model === 'bandana') {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.37, 0.16, 10), hm);
    band.position.y = 2.0 - HEAD_Y; hg.add(band);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), hm);
    knot.position.set(0, 2.02 - HEAD_Y, -0.36); hg.add(knot);
  } else if (model === 'visor') {
    // COZY-A: visor putih ref-cewe — band melingkar + brim depan, TANPA
    // dome: puncak rambut tetap terlihat, jadi tidak ada yang bisa clip.
    // Band di y 2.10 (bukan 2.02): tepi bawahnya 2.04, di atas puncak
    // mata (2.005) — visor tidak boleh menutup mata seperti masker tidur.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.38, 0.12, 10), hm);
    band.position.y = 2.1 - HEAD_Y; hg.add(band);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.3), hm);
    brim.position.set(0, 2.08 - HEAD_Y, 0.42); hg.add(brim);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.05), hm);
    strap.position.set(0, 2.1 - HEAD_Y, -0.37); hg.add(strap);
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
  // (iris di z ~0.35) — bukan menembus bola mata. Y relatif ke pusat
  // kepala (HEAD_Y) karena g = headG.
  for (const ex of [-0.14, 0.14]) {
    const lens = model === 'round'
      ? new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 12), fm)
      : new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.04), fm);
    lens.position.set(ex, 1.88 - HEAD_Y, 0.36);
    g.add(lens);
    if (model !== 'shades') {
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), lensMat);
      glass.position.set(ex, 1.88 - HEAD_Y, 0.365);
      g.add(glass);
    } else {
      const dark = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.02), lensMat);
      dark.position.set(ex, 1.88 - HEAD_Y, 0.365);
      g.add(dark);
    }
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), fm);
  bridge.position.set(0, 1.9 - HEAD_Y, 0.36); g.add(bridge);
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
// COZY-A: mengembalikan objek wajah lengkap { eyes, mouths, brows,
// blushMat, eyeScale } — Player.update() mengganti ekspresi lewat
// applyFaceExpression() (lihat di bawah): neutral / happy / focused /
// tired. eyeScale dikali faktor kedip di update(), jadi ekspresi dan
// kedip tidak saling menimpa.
// Lane F: posisi Y relatif ke pusat kepala (HEAD_Y) karena upper di sini
// = headG. applyFaceExpression hanya menulis TARGET (tEyeScale, tBlush,
// tRotZ, mulut); nilai saat ini merayap ke target di Player.update —
// transisi ekspresi halus, bukan ganti instan.
function addAnimeFace(upper, gender, hairC) {
  const irisC = IRIS_COLOR[gender] || IRIS_COLOR.male;
  const scleraMat = mat(0xffffff);
  const irisMat = flatMat(irisC);
  const pupilMat = flatMat(0x1d2b53);
  const shineMat = flatMat(0xffffff);
  const lashMat = flatMat(0x1d2b53);
  const eyes = new THREE.Group();
  eyes.position.set(0, 1.88 - HEAD_Y, 0);
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
  const brows = [];
  for (const sx of [-1, 1]) {
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.032, 0.02), browMat);
    brow.position.set(sx * 0.13, 2.03 - HEAD_Y, 0.3);
    brow.rotation.z = -sx * 0.12;
    brow.userData.baseRotZ = -sx * 0.12;
    brow.userData.tRotZ = brow.userData.baseRotZ; // target (Lane F)
    upper.add(brow);
    brows.push(brow);
  }
  // Pipi merona.
  const blushMat = flatMat(BLUSH_COLOR, { transparent: true, opacity: 0.75 });
  for (const sx of [-1, 1]) {
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), blushMat);
    blush.position.set(sx * 0.215, 1.76 - HEAD_Y, 0.26);
    blush.rotation.y = sx * 0.55;
    upper.add(blush);
  }
  // Tiga varian mulut (hanya satu yang terlihat): senyum (busur ∪),
  // terbuka (mulut senang lebar), datar (fokus/lelah).
  const mouthSmile = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 12, Math.PI), flatMat(MOUTH_COLOR));
  mouthSmile.position.set(0, 1.72 - HEAD_Y, 0.315);
  mouthSmile.rotation.z = Math.PI;
  mouthSmile.userData.baseScale = mouthSmile.scale.clone();
  upper.add(mouthSmile);
  const mouthOpen = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), flatMat(MOUTH_COLOR));
  mouthOpen.scale.set(1, 0.75, 0.5);
  mouthOpen.position.set(0, 1.7 - HEAD_Y, 0.315);
  mouthOpen.visible = false;
  mouthOpen.userData.baseScale = mouthOpen.scale.clone();
  upper.add(mouthOpen);
  const mouthFlat = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.014, 0.02), flatMat(MOUTH_COLOR));
  mouthFlat.position.set(0, 1.72 - HEAD_Y, 0.315);
  mouthFlat.visible = false;
  mouthFlat.userData.baseScale = mouthFlat.scale.clone();
  upper.add(mouthFlat);
  return {
    eyes,
    mouths: { smile: mouthSmile, open: mouthOpen, flat: mouthFlat },
    brows,
    blushMat,
    eyeScale: 1, // dikali faktor kedip di Player.update()
    // Lane F — target transisi ekspresi (nilai saat ini merayap ke sini):
    tEyeScale: 1, tBlush: 0.75, _mouthPop: 1,
  };
}

// Ekspresi wajah per aktivitas (COZY-A). 'happy' = mata menutup senang
// (eyeScale kecil) + mulut terbuka; 'focused' = alis menukik + mulut
// datar; 'tired' = mata setengah + mulut datar + blush lebih kuat;
// 'neutral' = bawaan (senyum, mata penuh). 'surprised' (Lane F) = mata
// membesar + mulut terbuka + alis terangkat.
// Lane F: fungsi ini HANYA menulis target (tEyeScale/tBlush/tRotZ +
// pergantian mulut); Player.update() merayapkan nilai saat ini ke target
// (~0.1 dtk) + menganimasikan pop skala mulut — jadi transisi ekspresi
// halus, bukan ganti instan. Kedip tetap jalan via eyeScale.
function applyFaceExpression(face, expr) {
  if (!face) return;
  const show = (key) => {
    for (const [k, m] of Object.entries(face.mouths)) m.visible = (k === key);
  };
  let mouth = 'smile';
  const browTarget = (fn) => face.brows.forEach((b, i) => { b.userData.tRotZ = fn(b, i); });
  if (expr === 'happy') {
    face.tEyeScale = 0.35; mouth = 'open';
    browTarget((b) => b.userData.baseRotZ);
    face.tBlush = 0.95;
  } else if (expr === 'focused') {
    face.tEyeScale = 1; mouth = 'flat';
    browTarget((b, i) => (i === 0 ? -1 : 1) * 0.38);
    face.tBlush = 0.6;
  } else if (expr === 'tired') {
    face.tEyeScale = 0.55; mouth = 'flat';
    browTarget(() => 0);
    face.tBlush = 0.85;
  } else if (expr === 'surprised') {
    face.tEyeScale = 1.15; mouth = 'open';
    browTarget((b, i) => (i === 0 ? 1 : -1) * 0.05);
    face.tBlush = 0.7;
  } else { // neutral
    face.tEyeScale = 1; mouth = 'smile';
    browTarget((b) => b.userData.baseRotZ);
    face.tBlush = 0.75;
  }
  // Ganti mulut hanya bila berubah; pop skala (0.8 → 1) dilembutkan di update().
  const cur = Object.entries(face.mouths).find(([, m]) => m.visible)?.[0];
  if (cur !== mouth) { show(mouth); face._mouthPop = 0; }
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
    // Celana pendek (ref-cowo: Bima bercelana biru sebetis paha):
    // biru menutupi SELURUH paha sampai lutut — segmen biru pendek
    // sebelumnya tersembunyi di balik hem baju dari kamera atas, jadi
    // celananya tidak terbaca. Betis di bawah lutut tetap kulit.
    hip.add(seg(new THREE.CylinderGeometry(0.125, 0.12, THIGH_LEN, 6), pantsMat, -THIGH_LEN / 2));
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

function buildArm(side, shirtModel, shirtMat, skinMat, armX = 0.48, handMat = null) {
  const shoulder = pivot(side * armX, SHOULDER_Y, 0);
  shoulder.rotation.z = side * 0.07; // lengan sedikit menjauh dari badan
  shoulder.add(seg(new THREE.CylinderGeometry(0.1, 0.09, UPPER_ARM_LEN, 6), shirtMat, -UPPER_ARM_LEN / 2));
  const elbow = pivot(0, -UPPER_ARM_LEN, 0);
  shoulder.add(elbow);
  // Lengan panjang = baju sampai tangan; kaos/overall/vest = lengan bawah kulit.
  const foreMat = shirtModel === 'long' ? shirtMat : skinMat;
  elbow.add(seg(new THREE.CylinderGeometry(0.09, 0.08, FOREARM_LEN, 6), foreMat, -FOREARM_LEN / 2));
  // Tangan: sarung tangan bila handMat diberikan (COZY-A: Bima bersarung
  // tangan merah seperti ref-cowo), kulit bila tidak.
  elbow.add(seg(new THREE.SphereGeometry(0.09, 8, 6), handMat || skinMat, -FOREARM_LEN - 0.02));
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
  // Lane F: `springs` menampung pegas secondary motion (syal + rambut).
  const upper = new THREE.Group();
  g.add(upper);
  const springs = [];
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
    // COZY-A: saku depan ala ref-cewe (kotak cokelat + cangkir kopi putih
    // kecil di atasnya) — detail denim overall Sari.
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.03), mat(0x6e4a26));
    pocket.position.set(-0.09, 1.06, 0.4); upper.add(pocket);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.05, 8), mat(0xfff6e5));
    cup.position.set(-0.09, 1.16, 0.415); upper.add(cup);
  } else if (c.shirtModel === 'vest') {
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.6, 0.1), pantsMat);
    vest.position.set(0, 1.1, 0.36); upper.add(vest);
  }
  // Aksen outfit khas per gender (toon, warna token PRODUCT.md).
  if (female) {
    // COZY-A: kerah putih kemeja Sari (ref-cewe) — pita sakura lama
    // diganti, supaya siluetnya sama dengan referensi.
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.09, 8), mat(0xfff6e5));
    collar.position.y = 1.48; upper.add(collar);
  } else {
    // COZY-A: syal merah Bima (ref-cowo) — cincin leher + simpul + ekor
    // menjuntai di dada, menggantikan kerah putih lama.
    const scarfMat = mat(0xb03a2e);
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.055, 8, 12), scarfMat);
    scarf.position.y = 1.48; scarf.rotation.x = Math.PI / 2; upper.add(scarf);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), scarfMat);
    knot.position.set(0, 1.44, 0.36); upper.add(knot);
    // Lane F: ekor syal dibungkus pivot di ujung atasnya (y 1.42) supaya
    // bisa berkibar mengikuti gerak; mesh anak di (0,-0.12,0).
    const scarfPv = new THREE.Group();
    scarfPv.position.set(0.07, 1.42, 0.36);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, 0.03), scarfMat);
    tail.position.set(0, -0.12, 0); tail.rotation.z = 0.15; tail.castShadow = true;
    scarfPv.add(tail); upper.add(scarfPv);
    springs.push(
      { obj: scarfPv, axis: 'x', base: 0, kind: 'scarf', stiff: 55, damp: 7, x: 0, v: 0 },
      { obj: scarfPv, axis: 'z', base: 0, kind: 'scarf', stiff: 55, damp: 7, x: 0, v: 0 },
    );
  }
  // Kepala + rambut + topi + kacamata + wajah anime — semuanya di dalam
  // grup kepala (headG, pusat y=HEAD_Y) supaya kepala bisa menoleh /
  // mengangguk / miring (Lane F: idle hidup + follow-through) tanpa
  // melepas wajah dari kepala. Posisi dunia TIDAK berubah: tiap bagian
  // digeser -HEAD_Y di addHair/addHat/addGlasses/addAnimeFace.
  const headG = new THREE.Group();
  headG.position.y = HEAD_Y;
  upper.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), skinMat);
  head.position.y = 0; head.castShadow = true; headG.add(head); addOutline(head, 1.04);
  // COZY-A: hatModel diteruskan ke addHair — perbaikan clip struktural.
  const hair = addHair(headG, c.hairStyle, hairC, skinMat, gender, c.hatModel);
  const hatGroup = addHat(headG, c.hatModel, hatC);
  addGlasses(headG, c.glassesModel, frameC);
  // Wajah anime: mata besar + alis + blush + senyum (ganti mata titik lama).
  const face = addAnimeFace(headG, gender, hairC);
  const eyes = face.eyes;
  // Lengan berartikulasi (bahu + siku). Bima bersarung tangan merah
  // (ref-cowo); Sari bertangan kulit.
  const armX = female ? 0.44 : 0.48;
  const gloveMat = female ? null : mat(0xb03a2e);
  const armL = buildArm(-1, c.shirtModel, shirtMat, skinMat, armX, gloveMat);
  const armR = buildArm(1, c.shirtModel, shirtMat, skinMat, armX, gloveMat);
  upper.add(armL.shoulder); upper.add(armR.shoulder);
  // COZY-A: garpu tanah (pitchfork) di tangan kanan Bima, menempel di
  // pivot siku kanan supaya ikut ayun lengan. Gagang kayu + 3 gigi logam.
  let tool = null;
  if (!female) {
    const fork = new THREE.Group();
    const woodMat = mat(0x8a6b3f);
    const steelMat = mat(0x9aa3ad);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6), woodMat);
    handle.position.set(0, -0.1, 0.02); handle.castShadow = true; fork.add(handle);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.04), steelMat);
    cross.position.set(0, 0.62, 0.02); fork.add(cross);
    for (const px of [-0.09, 0, 0.09]) {
      const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, px === 0 ? 0.32 : 0.28, 5), steelMat);
      prong.position.set(px, 0.78, 0.02); fork.add(prong);
    }
    armR.elbow.add(fork);
    tool = fork;
  }
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
  // Lane F: gabungkan pegas rambut (dari addHair) + syal ke satu daftar.
  if (hair && hair.springs) springs.push(...hair.springs);
  g.userData = {
    armL: armL.shoulder, armR: armR.shoulder,
    legL: legL.hip, legR: legR.hip,
    body, head, headG, upper, hat: hatGroup,
    elbowL: armL.elbow, elbowR: armR.elbow,
    kneeL: legL.knee, kneeR: legR.knee,
    shoeL: legL.shoe, shoeR: legR.shoe,
    eyes, face, tool, // anime: kedip + ekspresi + garpu tanah Bima
    tails: hair ? hair.tails : null, // anime: kedip + goyang ekor rambut
    springs: springs.length ? springs : null, // Lane F: secondary motion
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
    // Lane F (anti-kayu) — state animasi hidup. Semua pegas {x, v} di bawah
    // diintegrasi springStep() tiap frame (underdamped → overshoot halus).
    this._time = 0;        // jam animasi internal (angin idle, tolehan)
    this._sqS = { x: 1, v: 0 };   // squash & stretch (skala Y grup)
    this._jumpT = 0;       // waktu sejak takeoff (jendela crouch + stretch)
    this._jumped = false;  // airborne karena lompat (bukan jatuh dari tepi)
    this._leanS = { x: 0, v: 0 }; // condong badan (follow-through saat start/stop)
    this._headPitchS = { x: 0, v: 0 }; // angguk kepala (follow-through)
    this._lookT = 1.5;     // timer tolehan kepala berikutnya
    this._lookYaw = 0; this._lookPitch = 0; // target tolehan saat ini
    this._lookYawSm = 0; this._lookPitchSm = 0; // tolehan terhaluskan
    this._headTiltSm = 0;  // miring kepala (ekspresi) terhaluskan
    this._weightT = 0;     // fase pindah berat badan (idle)
    this._shiftSm = 0;     // geser lateral torso terhaluskan
    this._runK = 0;        // ritme lari (0 diam ↔ 1 lari, dihaluskan)
    // COZY-A — pose aksi + ekspresi. _action: null | 'plant' | 'water' |
    // 'harvest' | 'greet' | 'pet'; durasi detik, pose di-blend dengan
    // amplop sin(π·progress) di update(). Ekspresi mengikuti aksi yang
    // sedang jalan (lihat update): plant/water → focused, harvest/greet/
    // pet → happy, berenang / baru mendarat → tired, sisanya neutral.
    this._action = null;
    this._actionT = 0;
    this._actionDur = 1;
    this._expr = 'neutral';
    this._exprOverride = null;
    this._exprOverrideT = 0;
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
    // Wajah baru = target ekspresi netral; paksa re-apply ekspresi aktif
    // di frame berikutnya (banding _expr di update()).
    this._expr = 'neutral';
  }
  teleport(x, z) {
    this.x = clamp(x, -PLAY_BOUND, PLAY_BOUND); this.z = clamp(z, -PLAY_BOUND, PLAY_BOUND);
    this.vx = 0; this.vz = 0; this.yOff = 0; this.vy = 0;
    this._wasAir = false; this.landDip = 0;
    // Lane F: reset pegas pose supaya tidak ada sisa squash/condong beku.
    this._sqS = { x: 1, v: 0 }; this._leanS = { x: 0, v: 0 };
    this._headPitchS = { x: 0, v: 0 };
    this._lookYaw = 0; this._lookPitch = 0; this._lookYawSm = 0; this._lookPitchSm = 0;
    this._headTiltSm = 0; this._shiftSm = 0; this._runK = 0;
    this.group.position.set(this.x, this.y, this.z);
  }
  jump() {
    if (this.swimming) return false; // di air tidak bisa lompat — berenang saja
    // Buff jajanan (pasar malam): jumpMul dari game.buffs, disinkron main.js
    // tiap frame ke this.buffs (default 1 bila belum ada).
    if (this.yOff <= 0.01) {
      this.vy = JUMP_VELOCITY * (this.buffs?.jumpMul || 1); this.yOff = 0.01;
      // Lane F: picu jendela crouch (ancang-ancang) + stretch takeoff.
      this._jumped = true; this._jumpT = 0;
      return true;
    }
    return false;
  }
  // --- COZY-A: pose aksi + interaksi (dipanggil lane gameplay/NPC) ---
  // Semua pose hanya mengubah _action; update() yang menganimasikannya
  // (blend masuk-keluar halus) — tidak membekukan gerak/fisika.
  _startAction(name, dur) {
    this._action = name; this._actionDur = dur; this._actionT = dur;
  }
  plant() { this._startAction('plant', 1.2); }    // menanam: berlutut + raih
  water() { this._startAction('water', 1.4); }    // menyiram: condong + tuang
  harvest() { this._startAction('harvest', 1.0); } // memanen: raih + angkat
  greet() { this._startAction('greet', 1.6); }    // sapa NPC: lambaian tangan
  pet() { this._startAction('pet', 1.2); }        // elus hewan: raih ke bawah
  // Paksa satu ekspresi selama `dur` detik (untuk lane NPC/dialog).
  // Setelah habis, ekspresi kembali mengikuti aksi/keadaan.
  setExpression(expr, dur = 2) {
    // Lane F: 'surprised' ditambahkan (mata membesar + mulut terbuka).
    if (!['neutral', 'happy', 'focused', 'tired', 'surprised'].includes(expr)) return;
    this._exprOverride = expr; this._exprOverrideT = dur;
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
    this._time += dt; // Lane F: jam animasi internal (angin idle, tolehan)
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
      ease(u.upper.position, 'x', 0);
      // Lane F: kepala lurus + skala kembali 1 saat berbaring.
      if (u.headG) { ease(u.headG.rotation, 'x', 0); ease(u.headG.rotation, 'y', 0); ease(u.headG.rotation, 'z', 0); }
      const gs = this.group.scale;
      gs.x += (1 - gs.x) * k; gs.y += (1 - gs.y) * k; gs.z += (1 - gs.z) * k;
      this.group.rotation.x = -Math.PI / 2 * this._lieBlend;
      this.group.position.set(this.x, this.groundAt(this.x, this.z) + this._lieLift * this._lieBlend, this.z);
      return;
    }
    // Bangun dari berbaring: blend kembali ke 0 (diterapkan di akhir update).
    this._lieBlend += (0 - this._lieBlend) * Math.min(1, dt * 6);
    // COZY-A: hitung mundur pose aksi + ekspresi wajah per aktivitas.
    // Prioritas: override manual (lane NPC) > aksi yang sedang jalan >
    // lelah (baru mendarat / berenang) > netral.
    if (this._actionT > 0) {
      this._actionT -= dt;
      if (this._actionT <= 0) { this._action = null; this._actionT = 0; }
    }
    if (this._exprOverrideT > 0) this._exprOverrideT -= dt;
    else this._exprOverride = null;
    let expr = 'neutral';
    if (this._exprOverride) expr = this._exprOverride;
    else if (this._action === 'plant' || this._action === 'water') expr = 'focused';
    else if (this._action === 'harvest' || this._action === 'greet' || this._action === 'pet') expr = 'happy';
    else if (this.landDip > 0.5 || this.swimming) expr = 'tired';
    if (expr !== this._expr) {
      this._expr = expr;
      applyFaceExpression(this.group.userData.face, expr);
    }
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
    // --- Lane F: condong berpegas, tolehan idle, pindah berat, ekspresi halus.
    // Condong badan mengejar target lewat pegas (bukan nilai instan) —
    // saat start/stop lari badan mengayun melewati target lalu settle.
    springStep(this._leanS, leanW, 90, 12, dt);
    // Kepala menoleh sesekali HANYA saat idle (tidak jalan/renang/aksi):
    // pilih arah acak, tahan 0.8–2 detik, kembali ke tengah, jeda 2.5–6 dtk.
    const idleK = (1 - amp) * (1 - ab) * (1 - sb) * (this._action ? 0 : 1);
    this._lookT -= dt;
    if (this._lookT <= 0) {
      if (this._lookYaw !== 0 || this._lookPitch !== 0) {
        this._lookYaw = 0; this._lookPitch = 0;
        this._lookT = 2.5 + Math.random() * 3.5;
      } else {
        this._lookYaw = (Math.random() * 2 - 1) * 0.45;
        this._lookPitch = (Math.random() * 2 - 1) * 0.12;
        this._lookT = 0.8 + Math.random() * 1.2;
      }
    }
    this._lookYawSm += (this._lookYaw * idleK - this._lookYawSm) * dampF(3, dt);
    this._lookPitchSm += (this._lookPitch * idleK - this._lookPitchSm) * dampF(3, dt);
    // Pindah berat badan: torso bergeser kiri-kanan pelan saat idle.
    this._weightT += dt;
    const shiftT = (1 - amp) * (1 - ab) * (1 - sb) * 0.025 * Math.sin(this._weightT * 1.4);
    this._shiftSm += (shiftT - this._shiftSm) * dampF(2.5, dt);
    // Ekspresi wajah: nilai saat ini merayap ke target applyFaceExpression
    // (~0.1 dtk) — mata/alis/blush berubah halus, bukan ganti instan.
    // Mulut yang baru berganti ikut pop skala 0.8 → 1 (0.2 dtk).
    const face = u.face;
    if (face) {
      const fk = dampF(9, dt);
      face.eyeScale += (face.tEyeScale - face.eyeScale) * fk;
      face.blushMat.opacity += (face.tBlush - face.blushMat.opacity) * fk;
      for (const b of face.brows) {
        const t = b.userData.tRotZ ?? b.userData.baseRotZ;
        b.rotation.z += (t - b.rotation.z) * fk;
      }
      face._mouthPop = Math.min(1, (face._mouthPop ?? 1) + dt * 5);
      const pop = 0.8 + 0.2 * face._mouthPop;
      for (const m of Object.values(face.mouths)) {
        if (m.visible && m.userData.baseScale) m.scale.copy(m.userData.baseScale).multiplyScalar(pop);
      }
    }
    // --- Kedip anime: tiap ~2.5–4.5 detik, mata mengecil selama 0.14 detik.
    this._blinkNext -= dt;
    if (this._blinkNext <= 0) { this._blinkNext = 2.5 + Math.random() * 2; this._blinkT = 0.14; }
    if (u.eyes) {
      // Kedip dikali eyeScale ekspresi (mata 'happy' yang sudah setengah
      // menutup tetap mengedip tanpa membuka penuh).
      const eyeScale = u.face ? u.face.eyeScale : 1;
      if (this._blinkT > 0) {
        this._blinkT -= dt;
        const k = Math.min(1, Math.max(0, (0.14 - this._blinkT) / 0.14));
        u.eyes.scale.y = eyeScale * (1 - Math.sin(k * Math.PI) * 0.9);
      } else u.eyes.scale.y = eyeScale;
    }
    // --- Secondary motion (Lane F): rambut/syal/panel ikut gerak dengan lag
    // pegas — tiap helai/grup punya pegas sendiri (target dari langkah,
    // condong badan, dan angin idle), bukan simulasi penuh. Di air, ekor
    // hanyut ke belakang. NPC/bot tidak menjalankan ini (tetap pose dasar).
    if (u.springs) {
      const swX = Math.sin(ph) * amp;      // dorong maju-mundur dari langkah
      const swZ = Math.cos(ph) * amp;      // dorong samping dari langkah
      const breeze = Math.sin(this._time * 0.9) * 0.03
        + Math.sin(this._time * 0.53 + 1.7) * 0.02 + Math.sin(this.breathPhase) * 0.015;
      const leanD = this._leanS.x;
      for (const s of u.springs) {
        let d = 0;
        if (s.kind === 'tail') {
          d = s.axis === 'x' ? swX * 0.18 + leanD * 0.25 + breeze * 0.4 : swZ * 0.1 + breeze * 0.4;
        } else if (s.kind === 'spike') {
          d = s.axis === 'x' ? swX * 0.08 + this.landDip * 0.08 : swZ * 0.04;
        } else if (s.kind === 'scarf') {
          d = s.axis === 'x' ? leanD * 0.7 + swX * 0.2 + breeze : swZ * 0.08 + breeze * 0.5;
        } else { // 'back'
          d = s.axis === 'x' ? swX * 0.1 + leanD * 0.2 : swZ * 0.04;
        }
        if (sb > 0) d = d * (1 - sb) + (s.axis === 'x' ? 0.22 : 0) * sb;
        springStep(s, d, s.stiff, s.damp, dt);
        s.obj.rotation[s.axis] = s.base + Math.max(-0.3, Math.min(0.3, s.x));
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
    u.upper.position.x = this._shiftSm; // Lane F: pindah berat badan (idle)
    u.upper.rotation.x = B(L(this._leanS.x, 0.06), 0.5); // Lane F: condong berpegas
    u.upper.rotation.z = (1 - ab) * swayW * (1 - sb) - this._shiftSm * 0.8;
    // Lane F: dada mengembang halus saat napas (idle, bukan saat berenang).
    const br = 1 + 0.012 * breath * (1 - amp * 0.5) * (1 - sb);
    u.body.scale.set(br, 1, br);
    // COZY-A: lompat — lengan membuka ke samping saat melayang (polish
    // pose udara yang sudah ada; di tanah kembali ke 0.07 bawaan).
    u.armL.rotation.z = -0.07 - ab * 0.35;
    u.armR.rotation.z = 0.07 + ab * 0.35;
    // COZY-A: pose aksi — target pose per aksi di-blend dengan amplop
    // sin(π·progress): 0 di awal/akhir, 1 di tengah gerakan. Amplop ini
    // sekaligus antisipasi + settle aksi (masuk pelan, keluar pelan).
    // Lane F: tiap aksi juga menundukkan/mengangkat kepala (actHeadX).
    let actHeadX = 0;
    if (this._action) {
      const prog = 1 - this._actionT / this._actionDur;
      const env = Math.sin(Math.min(1, Math.max(0, prog)) * Math.PI) * 0.85;
      const mix = (o, p, t) => { o[p] += (t - o[p]) * env; };
      if (this._action === 'plant') {
        actHeadX = 0.28 * env;
        mix(u.legL.rotation, 'x', -0.95); mix(u.legR.rotation, 'x', 0.45);
        mix(u.kneeL.rotation, 'x', 1.25); mix(u.kneeR.rotation, 'x', 0.7);
        mix(u.upper.rotation, 'x', 0.55); mix(u.upper.position, 'y', -0.12);
        mix(u.armL.rotation, 'x', -0.95); mix(u.armR.rotation, 'x', -0.95);
        mix(u.elbowL.rotation, 'x', -0.5); mix(u.elbowR.rotation, 'x', -0.5);
      } else if (this._action === 'water') {
        actHeadX = 0.2 * env;
        mix(u.upper.rotation, 'x', 0.35);
        mix(u.armR.rotation, 'x', -1.25); mix(u.elbowR.rotation, 'x', -1.0);
        mix(u.armL.rotation, 'x', -0.35); mix(u.elbowL.rotation, 'x', -0.3);
        mix(u.legL.rotation, 'x', -0.15); mix(u.legR.rotation, 'x', 0.15);
        mix(u.kneeL.rotation, 'x', 0.25); mix(u.kneeR.rotation, 'x', 0.25);
      } else if (this._action === 'harvest') {
        actHeadX = -0.08 * env;
        mix(u.armL.rotation, 'x', -1.15); mix(u.armR.rotation, 'x', -1.15);
        mix(u.elbowL.rotation, 'x', -0.25); mix(u.elbowR.rotation, 'x', -0.25);
        mix(u.upper.rotation, 'x', 0.12);
        mix(u.kneeL.rotation, 'x', 0.3); mix(u.kneeR.rotation, 'x', 0.3);
      } else if (this._action === 'greet') {
        mix(u.armR.rotation, 'x', -2.5); mix(u.elbowR.rotation, 'x', -0.35);
        u.armR.rotation.z = 0.07 + (0.55 + Math.sin(this._actionT * 12) * 0.25) * env;
      } else if (this._action === 'pet') {
        actHeadX = 0.28 * env;
        mix(u.upper.rotation, 'x', 0.42);
        mix(u.armR.rotation, 'x', -1.05); mix(u.elbowR.rotation, 'x', -0.25);
        mix(u.armL.rotation, 'x', -0.2);
        mix(u.kneeL.rotation, 'x', 0.2); mix(u.kneeR.rotation, 'x', 0.2);
      }
    }
    // --- Lane F: kepala — tolehan idle + angguk follow-through + aksi +
    // ekspresi (menunduk saat lelah, miring saat senang, mendongak renang).
    if (u.headG) {
      const exprHeadX = this._expr === 'tired' ? 0.1 : this._expr === 'happy' ? -0.03
        : this._expr === 'surprised' ? -0.05 : this._expr === 'focused' ? 0.02 : 0;
      const exprHeadZT = this._expr === 'happy' ? 0.06 : 0;
      this._headTiltSm += (exprHeadZT - this._headTiltSm) * dampF(5, dt);
      const headPitchT = this._lookPitchSm - this._leanS.x * 0.5 - 0.25 * sb + actHeadX + exprHeadX;
      springStep(this._headPitchS, headPitchT, 60, 10, dt);
      u.headG.rotation.x = this._headPitchS.x;
      u.headG.rotation.y = this._lookYawSm;
      u.headG.rotation.z = this._headTiltSm;
    }
    // --- Lane F: squash & stretch — skala grup berpegas (volume dijaga:
    // X/Z melebar saat Y memendek). Urutan: crouch ancang-ancang 0.09 dtk
    // di awal lompat → regang saat melayang → gepeng saat mendarat
    // (landDip) → ritme halus saat lari. Pegas underdamped memberi
    // overshoot settle, bukan snap.
    if (airborne) this._jumpT += dt; else { this._jumpT = 0; this._jumped = false; }
    let sqT = 1;
    if (this._jumped && this._jumpT < 0.09) sqT = 0.86;       // ancang-ancang
    else if (airborne) sqT = this._jumpT < 0.3 ? 1.13 : 1.06; // regang
    else if (this.landDip > 0.08) sqT = 0.88;                 // gepeng mendarat
    springStep(this._sqS, sqT, 150, 11, dt);
    // Ritme lari: osilasi LANGSUNG di atas nilai pegas (bukan lewat pegas —
    // frekuensi langkah ~17 rad/s jauh di atas bandwidth pegas, jadi lewat
    // pegas akan terfilter habis). runK dihaluskan supaya masuk/keluar
    // ritme tidak snap.
    this._runK += ((amp > 0.6 && sb < 0.5 ? 1 : 0) - this._runK) * dampF(4, dt);
    const sq = Math.max(0.8, Math.min(1.18, this._sqS.x + 0.02 * Math.sin(ph * 2) * this._runK));
    const sxz = 1 + (1 - sq) * 0.7;
    const lieK = 1 - this._lieBlend;
    this.group.scale.set(1 + (sxz - 1) * lieK, 1 + (sq - 1) * lieK, 1 + (sxz - 1) * lieK);
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
