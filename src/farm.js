// farm.js — petak kebun grid + tanaman 3 tahap tumbuh.
// 3 tanaman: Wortel (2 hari, benih 4, jual 12), Tomat (3 hari, 8, 20),
// Labu (4 hari, 14, 32). Tahap visual 0-3 berbeda tiap tahap.
import * as THREE from 'three';
import { terrainHeight } from './physics.js';
import { FARM_ORIGIN, FARM_COLS, FARM_ROWS, FARM_SPACING, toonMat, addOutline } from './world.js';

export const CROPS = {
  carrot:  { id: 'carrot',  name: 'Wortel', icon: 'carrot', days: 2, seed: 4,  sell: 12, color: 0xe87a2a, seedKey: 'carrotSeed' },
  tomato:  { id: 'tomato',  name: 'Tomat',  icon: 'tomato', days: 3, seed: 8,  sell: 20, color: 0xd9382b, seedKey: 'tomatoSeed' },
  pumpkin: { id: 'pumpkin', name: 'Labu',   icon: 'pumpkin', days: 4, seed: 14, sell: 32, color: 0xe8912a, seedKey: 'pumpkinSeed' },
};

export function plotPos(ix, iz) {
  return { x: FARM_ORIGIN.x + ix * FARM_SPACING, z: FARM_ORIGIN.z + iz * FARM_SPACING };
}
export function plotIndex(ix, iz) { return iz * FARM_COLS + ix; }
export function isValidPlot(ix, iz) { return ix >= 0 && ix < FARM_COLS && iz >= 0 && iz < FARM_ROWS; }

function mat(color, opts = {}) { return toonMat(color, opts); }

export class Farm {
  constructor(scene, plotsState) {
    this.scene = scene;
    this.plots = plotsState; // [{crop, growth, watered, hoed}]
    this.group = new THREE.Group();
    scene.add(this.group);
    this.soilMat = mat(0x6e4a26);
    this.soilHoedMat = mat(0x4a2f16);
    this.wetMat = mat(0x3a2410);
    this.plotMeshes = [];
    this.cropMeshes = [];
    for (let iz = 0; iz < FARM_ROWS; iz++) {
      for (let ix = 0; ix < FARM_COLS; ix++) {
        const idx = plotIndex(ix, iz);
        const p = plotPos(ix, iz);
        const y = terrainHeight(p.x, p.z);
        const soil = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, 2.3), this.soilMat.clone());
        soil.position.set(p.x, y + 0.12, p.z);
        soil.receiveShadow = true;
        this.group.add(soil);
        this.plotMeshes[idx] = soil;
        // Visual tanaman per petak (dibangun ulang tiap perubahan state).
        const cropGroup = new THREE.Group();
        cropGroup.position.set(p.x, y + 0.28, p.z);
        this.group.add(cropGroup);
        this.cropMeshes[idx] = cropGroup;
      }
    }
    this.refreshAll();
    // Orang-orangan sawah di sudut kebun (dekoratif, tanpa collider).
    const sc = new THREE.Group();
    const scX = FARM_ORIGIN.x + (FARM_COLS - 1) * FARM_SPACING + 1.4;
    const scZ = FARM_ORIGIN.z + (FARM_ROWS - 1) * FARM_SPACING + 1.4;
    const scY = terrainHeight(scX, scZ);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 5), mat(0x6e4a26));
    pole.position.y = 1.1; sc.add(pole);
    const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5), mat(0x6e4a26));
    cross.rotation.z = Math.PI / 2; cross.position.y = 1.7; sc.add(cross);
    const shirt = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.0, 6), mat(0xd9382b));
    shirt.position.y = 1.5; addOutline(shirt); sc.add(shirt);
    const shead = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), mat(0xe8c9a8));
    shead.position.y = 2.25; addOutline(shead); sc.add(shead);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.35, 8), mat(0xf2d06b));
    hat.position.y = 2.55; sc.add(hat);
    sc.position.set(scX, scY, scZ);
    sc.rotation.y = Math.PI * 0.25;
    this.group.add(sc);
  }
  stageOf(plot) {
    if (!plot.crop) return -1;
    const crop = CROPS[plot.crop];
    return Math.min(3, Math.floor((plot.growth / crop.days) * 4));
  }
  isReady(plot) { return plot.crop && plot.growth >= CROPS[plot.crop].days; }
  refreshPlot(idx) {
    const plot = this.plots[idx];
    const soil = this.plotMeshes[idx];
    soil.material = plot.watered ? this.wetMat : (plot.hoed ? this.soilHoedMat : this.soilMat);
    const cg = this.cropMeshes[idx];
    while (cg.children.length) cg.remove(cg.children[0]);
    if (!plot.crop) return;
    const stage = this.stageOf(plot);
    const crop = CROPS[plot.crop];
    const s = 0.35 + stage * 0.3;
    // Daun (tahap 0-1: kecambah kecil; 2-3: rimbun).
    const leafMat = mat(stage >= 2 ? 0x2e7d32 : 0x66bb6a);
    for (let i = 0; i < (stage === 0 ? 2 : 4); i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16 * s, 0.55 * s, 5), leafMat);
      const a = (i / 4) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.28 * s, 0.25 * s, Math.sin(a) * 0.28 * s);
      leaf.rotation.z = Math.cos(a) * 0.5; leaf.rotation.x = -Math.sin(a) * 0.5;
      cg.add(leaf);
    }
    if (stage >= 1) {
      // Batang.
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5 * s, 5), mat(0x4a7d2e));
      stem.position.y = 0.25 * s; cg.add(stem);
    }
    if (stage >= 2) {
      // Buah — bentuk khas per tanaman.
      if (plot.crop === 'carrot') {
        const top = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.3, 8), mat(crop.color));
        top.position.y = 0.08; top.rotation.x = Math.PI; cg.add(top);
      } else if (plot.crop === 'tomato') {
        for (let i = 0; i < 3; i++) {
          const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 8, 8), mat(crop.color));
          fruit.position.set(Math.cos(i * 2.1) * 0.25, 0.35 * s, Math.sin(i * 2.1) * 0.25);
          cg.add(fruit);
        }
      } else {
        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.42 * s, 10, 8), mat(crop.color));
        fruit.position.y = 0.18; fruit.scale.y = 0.8; cg.add(fruit);
      }
    }
    if (stage >= 3) {
      // Siap panen: kilau — cincin kuning kecil di sekeliling tanaman.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 20),
        mat(0xffd54f, { emissive: 0x664411 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; cg.add(ring);
    }
  }
  refreshAll() { for (let i = 0; i < this.plots.length; i++) this.refreshPlot(i); }
  hoeAt(ix, iz) {
    if (!isValidPlot(ix, iz)) return false;
    const p = this.plots[plotIndex(ix, iz)];
    if (p.crop || p.hoed) return false;
    p.hoed = true; this.refreshPlot(plotIndex(ix, iz)); return true;
  }
  plantAt(ix, iz, cropId, inv) {
    if (!isValidPlot(ix, iz) || !CROPS[cropId]) return false;
    const p = this.plots[plotIndex(ix, iz)];
    if (!p.hoed || p.crop) return false;
    const crop = CROPS[cropId];
    if ((inv[crop.seedKey] || 0) < 1) return false;
    inv[crop.seedKey] -= 1;
    p.crop = cropId; p.growth = 0; p.watered = false;
    this.refreshPlot(plotIndex(ix, iz)); return true;
  }
  waterAt(ix, iz) {
    if (!isValidPlot(ix, iz)) return false;
    const p = this.plots[plotIndex(ix, iz)];
    if (!p.crop || p.watered || this.isReady(p)) return false;
    p.watered = true; this.refreshPlot(plotIndex(ix, iz)); return true;
  }
  harvestAt(ix, iz, inv) {
    if (!isValidPlot(ix, iz)) return false;
    const idx = plotIndex(ix, iz);
    const p = this.plots[idx];
    if (!p.crop || !this.isReady(p)) return false;
    inv[p.crop] = (inv[p.crop] || 0) + 1;
    const harvested = p.crop;
    p.crop = null; p.growth = 0; p.watered = false; p.hoed = false;
    this.refreshPlot(idx); return harvested;
  }
  // Dipanggil saat tidur / ganti hari: tanaman yang disiram tumbuh 1 hari.
  growDay() {
    for (let i = 0; i < this.plots.length; i++) {
      const p = this.plots[i];
      if (p.crop && p.watered && p.growth < CROPS[p.crop].days) p.growth += 1;
      p.watered = false;
      this.refreshPlot(i);
    }
  }
  nearestPlot(x, z, maxDist = 2.6) {
    let best = null, bestD = maxDist;
    for (let iz = 0; iz < FARM_ROWS; iz++) {
      for (let ix = 0; ix < FARM_COLS; ix++) {
        const p = plotPos(ix, iz);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD) { bestD = d; best = { ix, iz }; }
      }
    }
    return best;
  }
}
