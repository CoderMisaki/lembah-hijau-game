// player.js — karakter low-poly third-person (Bima / Sari) + gerak fisika kustom.
// Gerak: akselerasi + friksi + momentum, maks ~6 m/s; lompat v0 ~8 m/s,
// gravitasi ~22 m/s^2; menempel terrain; tabrakan lingkaran vs AABB + sungai.
// Penampilan dibentuk dari state kustomisasi (src/customization.js):
// model + warna per kategori — semua geometri prosedural Three.js, low-poly.
import * as THREE from 'three';
import { GRAVITY, JUMP_VELOCITY, MAX_SPEED, ACCEL, FRICTION, clamp,
         terrainHeight, resolveCircleVsAABBs, isInRiver, isOnBridge } from './physics.js';
import { defaultCustom, sanitizeCustom, hexOf,
         SKIN_TONES, HAIR_COLORS, PALETTE, FRAME_COLORS } from './customization.js';

export const PLAYER_RADIUS = 0.55;

function mat(color) { return new THREE.MeshLambertMaterial({ color }); }

function addHair(g, style, hairC, skinMat) {
  const hm = mat(hairC);
  const add = (mesh) => { mesh.castShadow = true; g.add(mesh); return mesh; };
  if (style === 'short') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hm);
    hair.position.y = 1.9; hair.rotation.x = -0.35; add(hair);
  } else if (style === 'spiky') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), hm);
    hair.position.y = 1.92; hair.rotation.x = -0.3; add(hair);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 5), hm);
      spike.position.set(Math.cos(a) * 0.2, 2.18, Math.sin(a) * 0.2 - 0.05);
      spike.rotation.z = -Math.cos(a) * 0.5; spike.rotation.x = Math.sin(a) * 0.5;
      add(spike);
    }
  } else if (style === 'long') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), hm);
    hair.position.y = 1.88; hair.rotation.x = -0.3; add(hair);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.16), hm);
    back.position.set(0, 1.55, -0.3); add(back);
  } else if (style === 'bun') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hm);
    hair.position.y = 1.9; hair.rotation.x = -0.35; add(hair);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), hm);
    bun.position.set(0, 2.08, -0.3); add(bun);
  } else if (style === 'ponytail') {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hm);
    hair.position.y = 1.9; hair.rotation.x = -0.35; add(hair);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.55, 6), hm);
    tail.position.set(0, 1.75, -0.42); tail.rotation.x = 0.35; add(tail);
  }
  void skinMat;
}

function addHat(g, model, hatC) {
  if (model === 'none') return;
  const hm = mat(hatC);
  if (model === 'straw') {
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 10), hm);
    top.position.y = 2.18; g.add(top);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 12), hm);
    brim.position.y = 2.04; g.add(brim);
  } else if (model === 'cap') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hm);
    dome.position.y = 1.98; g.add(dome);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.3), hm);
    visor.position.set(0, 2.0, 0.42); g.add(visor);
  } else if (model === 'beanie') {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.37, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), hm);
    dome.position.y = 1.96; g.add(dome);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.38, 0.12, 10), hm);
    band.position.y = 1.94; g.add(band);
  } else if (model === 'bandana') {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.37, 0.16, 10), hm);
    band.position.y = 2.0; g.add(band);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), hm);
    knot.position.set(0, 2.02, -0.36); g.add(knot);
  }
}

function addGlasses(g, model, frameC) {
  if (model === 'none') return;
  const fm = mat(frameC);
  const lensMat = model === 'shades'
    ? new THREE.MeshLambertMaterial({ color: 0x111111 })
    : new THREE.MeshLambertMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.55 });
  for (const ex of [-0.14, 0.14]) {
    const lens = model === 'round'
      ? new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 12), fm)
      : new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.04), fm);
    lens.position.set(ex, 1.88, 0.32);
    g.add(lens);
    if (model !== 'shades') {
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), lensMat);
      glass.position.set(ex, 1.88, 0.33);
      g.add(glass);
    } else {
      const dark = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.02), lensMat);
      dark.position.set(ex, 1.88, 0.33);
      g.add(dark);
    }
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.03), fm);
  bridge.position.set(0, 1.9, 0.32); g.add(bridge);
}

// Membangun model low-poly dari gender + kustomisasi (model + warna).
export function buildCharacter(gender, customInput) {
  const g = new THREE.Group();
  const female = gender === 'female';
  const c = sanitizeCustom(customInput, gender);
  const skin = hexOf(SKIN_TONES, c.skin, '#e8b88a');
  const shirt = hexOf(PALETTE, c.shirtColor, '#3f7d3a');
  const pants = hexOf(PALETTE, c.pantsColor, '#4a5d8a');
  const hairC = hexOf(HAIR_COLORS, c.hairColor, '#1e130c');
  const hatC = hexOf(PALETTE, c.hatColor, '#d8b36a');
  const frameC = hexOf(FRAME_COLORS, c.glassesColor, '#1a1a1a');
  const shoesC = hexOf(PALETTE, c.shoesColor, '#6e4a26');

  // Badan — model atasan menentukan bentuk.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.85, 8), mat(shirt));
  body.position.y = 1.05; body.castShadow = true; g.add(body);
  if (c.shirtModel === 'overall') {
    // Overall: tali bahu + dada warna celana.
    for (const sx of [-0.16, 0.16]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.05), mat(pants));
      strap.position.set(sx, 1.35, 0.36); g.add(strap);
    }
    const bib = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.35, 0.06), mat(pants));
    bib.position.set(0, 1.2, 0.36); g.add(bib);
  } else if (c.shirtModel === 'vest') {
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.6, 0.1), mat(pants));
    vest.position.set(0, 1.1, 0.36); g.add(vest);
  }
  // Kepala + rambut + topi + kacamata.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), mat(skin));
  head.position.y = 1.85; head.castShadow = true; g.add(head);
  addHair(g, c.hairStyle, hairC, mat(skin));
  addHat(g, c.hatModel, hatC);
  addGlasses(g, c.glassesModel, frameC);
  // Mata.
  const eyeMat = mat(0x1a1a1a);
  for (const ex of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat);
    eye.position.set(ex, 1.88, 0.3); g.add(eye);
  }
  // Lengan (lengan panjang = warna baju sampai tangan; kaos = lengan kulit bawah).
  const armMat = c.shirtModel === 'long' ? mat(shirt) : mat(shirt);
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.62, 6), armMat);
  armL.position.set(-0.48, 1.05, 0); armL.castShadow = true; g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.48; g.add(armR);
  // Kaki — model celana menentukan bentuk.
  const legLen = c.pantsModel === 'shorts' ? 0.32 : 0.6;
  const legY = c.pantsModel === 'shorts' ? 0.46 : 0.32;
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.11, legLen, 6), mat(pants));
  legL.position.set(-0.18, legY, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.18; g.add(legR);
  if (c.pantsModel === 'shorts') {
    // Betis kulit di bawah celana pendek.
    for (const lx of [-0.18, 0.18]) {
      const calf = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.3, 6), mat(skin));
      calf.position.set(lx, 0.16, 0); g.add(calf);
    }
  }
  if (c.pantsModel === 'skirt' || (female && c.pantsModel === 'skirt')) {
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.7, 8), mat(pants));
    skirt.position.y = 0.5; g.add(skirt);
  }
  // Sepatu.
  const shoeGeo = c.shoesModel === 'sandals'
    ? new THREE.BoxGeometry(0.2, 0.08, 0.42)
    : new THREE.BoxGeometry(0.22, 0.14, 0.44);
  for (const lx of [-0.18, 0.18]) {
    const shoe = new THREE.Mesh(shoeGeo, mat(shoesC));
    shoe.position.set(lx, 0.07, 0.06); shoe.castShadow = true; g.add(shoe);
  }
  g.userData = { armL, armR, legL, legR, body };
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
    this.group = buildCharacter(gender, this.custom);
    this.group.position.set(x, terrainHeight(x, z), z);
    scene.add(this.group);
  }
  // Tanah di bawah kaki: papan jembatan (y=1.0) saat di atas jembatan, terrain biasa jika tidak.
  groundAt(x, z) { return isOnBridge(x, z) ? 1.0 : terrainHeight(x, z); }
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
    this.x = clamp(x, -78, 78); this.z = clamp(z, -78, 78);
    this.vx = 0; this.vz = 0; this.yOff = 0; this.vy = 0;
    this.group.position.set(this.x, this.y, this.z);
  }
  jump() {
    if (this.yOff <= 0.01) { this.vy = JUMP_VELOCITY; this.yOff = 0.01; return true; }
    return false;
  }
  // move: {x, y} di ruang kamera (y = maju). dt detik.
  update(dt, move, colliders) {
    // Kamera menghadap -Z dunia (dari belakang karakter, sedikit dari atas):
    // maju = -Z, kanan = +X.
    const mx = move.x, mz = -move.y;
    const mag = move.mag || 0;
    this.moving = mag > 0.05;
    if (this.moving) {
      this.vx += mx * ACCEL * dt;
      this.vz += mz * ACCEL * dt;
      const sp = Math.hypot(this.vx, this.vz);
      const max = MAX_SPEED * (0.4 + 0.6 * mag);
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
    this.x = clamp(nx, -78, 78);
    this.z = clamp(nz2, -78, 78);
    // Gravitasi + lompat.
    if (this.yOff > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.yOff += this.vy * dt;
      if (this.yOff <= 0) { this.yOff = 0; this.vy = 0; }
    }
    // Pose + animasi jalan.
    const sp = Math.hypot(this.vx, this.vz);
    this.walkPhase += dt * sp * 2.2;
    const s = Math.sin(this.walkPhase) * clamp(sp / MAX_SPEED, 0, 1) * 0.6;
    const u = this.group.userData;
    u.legL.rotation.x = s; u.legR.rotation.x = -s;
    u.armL.rotation.x = -s * 0.8; u.armR.rotation.x = s * 0.8;
    u.body.position.y = 1.05 + Math.abs(Math.sin(this.walkPhase)) * 0.05 * clamp(sp / MAX_SPEED, 0, 1);
    this.group.position.set(this.x, this.y, this.z);
    // Hadap arah gerak (lerp sudut).
    let df = this.facing - this.group.rotation.y;
    while (df > Math.PI) df -= Math.PI * 2;
    while (df < -Math.PI) df += Math.PI * 2;
    this.group.rotation.y += df * Math.min(1, dt * 12);
  }
}
