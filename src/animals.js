// animals.js — ayam + sapi di kandang berpagar.
// Beri makan (2 koin/ekor/hari, via pakan atau potong koin langsung);
// yang diberi makan menghasilkan keesokan paginya: Ayam -> Telur (jual 8),
// Sapi -> Susu (jual 15). Hewan berkeliaran di kandang + hindari pagar.
import * as THREE from 'three';
import { terrainHeight, clamp } from './physics.js';
import { PEN } from './world.js';

export const ANIMAL_DEFS = {
  ayam: { name: 'Ayam', icon: 'chicken', produce: 'egg', produceName: 'Telur', sell: 8, count: 3 },
  sapi: { name: 'Sapi', icon: 'cow', produce: 'milk', produceName: 'Susu', sell: 15, count: 2 },
};

function mat(color) { return new THREE.MeshLambertMaterial({ color }); }

function buildChicken() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), mat(0xf5f0e6));
  body.scale.y = 0.85; body.position.y = 0.42; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), mat(0xf5f0e6));
  head.position.set(0, 0.78, 0.22); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), mat(0xe8912a));
  beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.76, 0.44); g.add(beak);
  const comb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.18), mat(0xd9382b));
  comb.position.set(0, 0.98, 0.22); g.add(comb);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat(0xe8e0d0));
    wing.scale.set(0.4, 0.8, 1); wing.position.set(s * 0.3, 0.45, 0); g.add(wing);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.35, 5), mat(0xd8d0c0));
  tail.rotation.x = -0.9; tail.position.set(0, 0.6, -0.36); g.add(tail);
  return g;
}

function buildCow() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.7), mat(0x8a5a3b));
  body.position.y = 0.85; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.5), mat(0x8a5a3b));
  head.position.set(0.85, 1.05, 0); g.add(head);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.35, 0.42), mat(0xe8c9a8));
  muzzle.position.set(1.15, 0.9, 0); g.add(muzzle);
  // Bercak coklat gelap di badan + ambing + lonceng leher.
  for (const [px, pz] of [[-0.2, 0.36], [0.3, -0.36]]) {
    const spot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.05), mat(0x4a2f1a));
    spot.position.set(px, 0.95, pz); g.add(spot);
  }
  const udder = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat(0xe8a0a8));
  udder.position.set(0, 0.45, 0); udder.scale.y = 0.7; g.add(udder);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat(0xf2d06b));
  bell.position.set(0.85, 0.62, 0); g.add(bell);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 6), mat(0xf5f0e6));
    horn.position.set(0.8, 1.4, s * 0.22); horn.rotation.z = -0.5; g.add(horn);
  }
  for (const [lx, lz] of [[-0.45, -0.25], [-0.45, 0.25], [0.45, -0.25], [0.45, 0.25]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 6), mat(0x5a3a22));
    leg.position.set(lx, 0.25, lz); g.add(leg);
  }
  return g;
}

export class Animals {
  // stateAnimals: [{kind:'ayam'|'sapi', fed:false, ready:0, x, z}, ...]
  constructor(scene, stateAnimals) {
    this.scene = scene;
    this.list = stateAnimals;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.meshes = [];
    this.targets = [];
    this.speeds = [];
    this.phase = [];
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      const mesh = a.kind === 'ayam' ? buildChicken() : buildCow();
      mesh.position.set(a.x, terrainHeight(a.x, a.z), a.z);
      this.group.add(mesh);
      this.meshes[i] = mesh;
      this.targets[i] = { x: a.x, z: a.z };
      this.speeds[i] = a.kind === 'ayam' ? 1.1 : 0.7;
      this.phase[i] = Math.random() * 10;
    }
  }
  _pickTarget(i) {
    const m = 1.2;
    this.targets[i] = {
      x: PEN.minX + m + Math.random() * (PEN.maxX - PEN.minX - 2 * m),
      z: PEN.minZ + m + Math.random() * (PEN.maxZ - PEN.minZ - 2 * m),
    };
  }
  update(dt, t) {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      const mesh = this.meshes[i];
      const tgt = this.targets[i];
      const dx = tgt.x - a.x, dz = tgt.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) { this._pickTarget(i); continue; }
      const sp = this.speeds[i];
      a.x += (dx / d) * sp * dt;
      a.z += (dz / d) * sp * dt;
      // Tetap di dalam pagar (hindari pagar).
      a.x = clamp(a.x, PEN.minX + 0.8, PEN.maxX - 0.8);
      a.z = clamp(a.z, PEN.minZ + 0.8, PEN.maxZ - 0.8);
      mesh.position.set(a.x, terrainHeight(a.x, a.z), a.z);
      mesh.rotation.y = Math.atan2(dx, dz);
      // Idle: ayam mematuk (angguk), sapi mengangguk pelan.
      this.phase[i] += dt;
      mesh.rotation.x = a.kind === 'ayam'
        ? Math.max(0, Math.sin(this.phase[i] * 2.2)) * 0.25
        : Math.sin(this.phase[i] * 0.8) * 0.05;
      mesh.position.y = terrainHeight(a.x, a.z) + (a.kind === 'ayam' ? Math.abs(Math.sin(this.phase[i] * 3)) * 0.03 : 0);
    }
  }
  nearest(x, z, maxDist = 2.4) {
    let best = -1, bestD = maxDist;
    for (let i = 0; i < this.list.length; i++) {
      const d = Math.hypot(this.list[i].x - x, this.list[i].z - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  // Beri makan 1 ekor pertama yang belum makan hari ini (jenis tertentu).
  // Biaya: 1 pakan dari inventaris, atau potong 2 koin bila pakan habis.
  feedAnimal(kind, state) {
    const a = this.list.find((an) => an.kind === kind && !an.fed);
    if (!a) return { ok: false, reason: 'already' };
    if ((state.inv.feed || 0) > 0) state.inv.feed -= 1;
    else if (state.coins >= 2) state.coins -= 2;
    else return { ok: false, reason: 'coins' };
    a.fed = true;
    return { ok: true };
  }
  feedAll(state) {
    let fed = 0;
    for (const a of this.list) {
      if (a.fed) continue;
      const r = this.feedAnimal(a.kind, state);
      if (r.ok) fed += 1; else break;
    }
    return fed;
  }
  // Pagi hari: hewan yang diberi makan kemarin menghasilkan 1 hasil.
  produceMorning() {
    let eggs = 0, milk = 0;
    for (const a of this.list) {
      if (a.fed) {
        a.ready = (a.ready || 0) + 1;
        if (a.kind === 'ayam') eggs += 1; else milk += 1;
      }
      a.fed = false;
    }
    return { eggs, milk };
  }
  // Ambil semua hasil siap dari satu jenis hewan ke inventaris.
  collectAnimal(kind, inv) {
    const def = ANIMAL_DEFS[kind];
    let n = 0;
    for (const a of this.list) {
      if (a.kind === kind && a.ready > 0) { n += a.ready; a.ready = 0; }
    }
    if (n > 0) inv[def.produce] = (inv[def.produce] || 0) + n;
    return n;
  }
  readyCount(kind) {
    return this.list.filter((a) => a.kind === kind).reduce((s, a) => s + (a.ready || 0), 0);
  }
  fedCount() { return this.list.filter((a) => a.fed).length; }
}
