// player.js — karakter low-poly third-person (Bima / Sari) + gerak fisika kustom.
// Gerak: akselerasi + friksi + momentum, maks ~6 m/s; lompat v0 ~8 m/s,
// gravitasi ~22 m/s^2; menempel terrain; tabrakan lingkaran vs AABB + sungai.
import * as THREE from 'three';
import { GRAVITY, JUMP_VELOCITY, MAX_SPEED, ACCEL, FRICTION, clamp,
         terrainHeight, resolveCircleVsAABBs, isInRiver, isOnBridge } from './physics.js';

export const PLAYER_RADIUS = 0.55;

function mat(color) { return new THREE.MeshLambertMaterial({ color }); }

// Membangun model low-poly. Perbedaan gender: rambut, warna baju, rok/celana.
export function buildCharacter(gender) {
  const g = new THREE.Group();
  const female = gender === 'female';
  const shirt = female ? 0xd94f70 : 0x3f7d3a;
  const pants = female ? 0x7d5ba6 : 0x4a5d8a;
  const skin = 0xe8b88a;
  const hairC = female ? 0x2b1a12 : 0x1e130c;

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.85, 8), mat(shirt));
  body.position.y = 1.05; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), mat(skin));
  head.position.y = 1.85; head.castShadow = true; g.add(head);
  // Topi jerami petani (ciri khas, bukan aset game lain).
  const hatTop = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 10), mat(0xd8b36a));
  hatTop.position.y = 2.18; g.add(hatTop);
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 12), mat(0xd8b36a));
  hatBrim.position.y = 2.04; g.add(hatBrim);
  // Rambut.
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hairC));
  hair.position.y = 1.9; hair.rotation.x = -0.35; g.add(hair);
  if (female) {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), mat(hairC));
    bun.position.set(0, 2.05, -0.32); g.add(bun);
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.7, 8), mat(pants));
    skirt.position.y = 0.5; g.add(skirt);
  }
  // Mata.
  const eyeMat = mat(0x1a1a1a);
  for (const ex of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat);
    eye.position.set(ex, 1.88, 0.3); g.add(eye);
  }
  // Lengan + kaki (dianimasikan saat berjalan).
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.62, 6), mat(shirt));
  armL.position.set(-0.48, 1.05, 0); armL.castShadow = true; g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.48; g.add(armR);
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.11, 0.6, 6), mat(pants));
  legL.position.set(-0.18, 0.32, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.18; g.add(legR);
  g.userData = { armL, armR, legL, legR, body };
  return g;
}

export class Player {
  constructor(scene, gender = 'male', x = 0, z = 0) {
    this.gender = gender;
    this.x = x; this.z = z;
    this.yOff = 0;      // tinggi lompat di atas terrain
    this.vy = 0;
    this.vx = 0; this.vz = 0;
    this.facing = 0;
    this.moving = false;
    this.walkPhase = 0;
    this.group = buildCharacter(gender);
    this.group.position.set(x, terrainHeight(x, z), z);
    scene.add(this.group);
  }
  // Tanah di bawah kaki: papan jembatan (y=1.0) saat di atas jembatan, terrain biasa jika tidak.
  groundAt(x, z) { return isOnBridge(x, z) ? 1.0 : terrainHeight(x, z); }
  get y() { return this.groundAt(this.x, this.z) + this.yOff; }
  setGender(scene, gender) {
    if (gender === this.gender) return;
    this.gender = gender;
    scene.remove(this.group);
    this.group = buildCharacter(gender);
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
