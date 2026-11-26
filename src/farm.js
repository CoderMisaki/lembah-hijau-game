// farm.js — petak kebun grid + tanaman 3 tahap tumbuh.
// COZY-C: 5 tanaman (Wortel, Tomat, Labu + Gandum, Stroberi), kualitas
// panen (normal/bagus/langka, roll dipengaruhi tanah + pupuk), pupuk +
// kualitas tanah per petak, dan 4 pohon buah perennial (apel/jeruk) di
// sekitar kebun buah (48,48) — ditanam dari bibit, berbuah tiap hari.
// Harga jual tanaman dibaca economy.js dari CROPS ini (single source).
import * as THREE from 'three';
import { terrainHeight } from './physics.js';
import { FARM_ORIGIN, FARM_COLS, FARM_ROWS, FARM_SPACING, toonMat, addOutline } from './world.js';
import {
  SOIL_DEFAULT, SOIL_FERTILISE_GAIN, SOIL_HARVEST_COST,
  TREE_SPOTS, TREE_DEFS, TREE_MATURE_DAYS, TREE_FRUIT_MAX,
  rollQuality, addQuality,
} from './economy.js';

export const CROPS = {
  carrot:  { id: 'carrot',  name: 'Wortel', icon: 'carrot', days: 2, seed: 4,  color: 0xe87a2a, seedKey: 'carrotSeed' },
  tomato:  { id: 'tomato',  name: 'Tomat',  icon: 'tomato', days: 3, seed: 8,  color: 0xd9382b, seedKey: 'tomatoSeed' },
  pumpkin: { id: 'pumpkin', name: 'Labu',   icon: 'pumpkin', days: 4, seed: 14, color: 0xe8912a, seedKey: 'pumpkinSeed' },
  // COZY-C: Gandum (bahan tepung) + Stroberi (tanaman ke-5).
  // Harga JUAL tidak di sini — satu-satunya sumber harga jual adalah
  // BASE_SELL di economy.js (F2: field `sell` dihapus supaya tak drift).
  wheat:      { id: 'wheat',      name: 'Gandum',    icon: 'wheat',    days: 3, seed: 6,  color: 0xd9b64a, seedKey: 'wheatSeed' },
  strawberry: { id: 'strawberry', name: 'Stroberi',  icon: 'tomato',   days: 4, seed: 12, color: 0xe84a6f, seedKey: 'strawberrySeed' },
};

export function plotPos(ix, iz) {
  return { x: FARM_ORIGIN.x + ix * FARM_SPACING, z: FARM_ORIGIN.z + iz * FARM_SPACING };
}
export function plotIndex(ix, iz) { return iz * FARM_COLS + ix; }
export function isValidPlot(ix, iz) { return ix >= 0 && ix < FARM_COLS && iz >= 0 && iz < FARM_ROWS; }

function mat(color, opts = {}) { return toonMat(color, opts); }

export class Farm {
  constructor(scene, plotsState, treesState = null) {
    this.scene = scene;
    this.plots = plotsState; // [{crop, growth, watered, hoed, soil, fert}]
    // COZY-C: petak dari save lama tidak punya soil/fert -> default di sini
    // (save v2 lama tetap bisa dimuat; buildSaveData menulis keduanya).
    for (const p of this.plots) {
      if (typeof p.soil !== 'number') p.soil = SOIL_DEFAULT;
      if (typeof p.fert !== 'boolean') p.fert = false;
    }
    // COZY-C: pohon buah — state milik Game (state.trees), mesh milik Farm.
    this.trees = treesState;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.soilMat = mat(0x6e4a26);
    this.soilHoedMat = mat(0x4a2f16);
    this.wetMat = mat(0x3a2410);
    // COZY-C: warna tanah per petak mengikuti kualitas tanah (0 = pucat
    // kehabisan unsur, 100 = cokelat gelap subur) — perlu material per
    // petak, bukan satu material bersama.
    this.soilMats = [];
    this.plotMeshes = [];
    this.cropMeshes = [];
    for (let iz = 0; iz < FARM_ROWS; iz++) {
      for (let ix = 0; ix < FARM_COLS; ix++) {
        const idx = plotIndex(ix, iz);
        const p = plotPos(ix, iz);
        const y = terrainHeight(p.x, p.z);
        const soilMat = this.soilMat.clone();
        const soil = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.3, 2.3), soilMat);
        soil.position.set(p.x, y + 0.12, p.z);
        soil.receiveShadow = true;
        this.group.add(soil);
        this.soilMats[idx] = soilMat;
        this.plotMeshes[idx] = soil;
        // Visual tanaman per petak (dibangun ulang tiap perubahan state).
        const cropGroup = new THREE.Group();
        cropGroup.position.set(p.x, y + 0.28, p.z);
        this.group.add(cropGroup);
        this.cropMeshes[idx] = cropGroup;
      }
    }
    this.refreshAll();
    // COZY-C: pohon buah — 4 titik tetap di sekitar kebun buah. Collider
    // batang (AABB) diekspos sebagai this.treeColliders untuk main.js.
    this.treeGroups = [];
    this.treeColliders = [];
    for (let i = 0; i < TREE_SPOTS.length; i++) {
      const s = TREE_SPOTS[i];
      const y = terrainHeight(s.x, s.z);
      const g = new THREE.Group();
      g.position.set(s.x, y, s.z);
      this.group.add(g);
      this.treeGroups[i] = g;
      this.treeColliders.push({ minX: s.x - 0.6, maxX: s.x + 0.6, minZ: s.z - 0.6, maxZ: s.z + 0.6 });
      this.refreshTree(i);
    }
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
    // COZY-C: warna tanah = lerp pucat (soil 0) -> subur (soil 100);
    // disiram = tetap gelap basah. Pupuk = penanda kerucut emas di sudut.
    if (plot.watered) soil.material = this.wetMat;
    else {
      soil.material = this.soilMats[idx];
      const k = Math.max(0, Math.min(100, plot.soil ?? SOIL_DEFAULT)) / 100;
      soil.material.color.setHex(0x8a6a44).lerp(new THREE.Color(0x4a2f16), k);
    }
    const cg = this.cropMeshes[idx];
    while (cg.children.length) cg.remove(cg.children[0]);
    if (plot.fert) {
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 6), mat(0xffd54f, { emissive: 0x664411 }));
      flag.position.set(0.95, 0.2, 0.95);
      cg.add(flag);
    }
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
      } else if (plot.crop === 'wheat') {
        // COZY-C: gandum — 5 batang emas ramping, tanpa buah bulat.
        for (let i = 0; i < 5; i++) {
          const stalk = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.85 * s, 5), mat(crop.color));
          const a = (i / 5) * Math.PI * 2;
          stalk.position.set(Math.cos(a) * 0.22, 0.45 * s, Math.sin(a) * 0.22);
          cg.add(stalk);
        }
      } else if (plot.crop === 'strawberry') {
        // COZY-C: stroberi — 4 buah kecil merah muda di antara daun.
        for (let i = 0; i < 4; i++) {
          const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 8, 8), mat(crop.color));
          fruit.position.set(Math.cos(i * 1.57) * 0.28, 0.22 * s, Math.sin(i * 1.57) * 0.28);
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
  // COZY-C: pupuk 1 petak. Butuh 1 pupuk di inventaris. Tanah +25 (maks
  // 100); bila ada tanaman, petak jadi 'fert' untuk siklus ini (tumbuh
  // lebih cepat + peluang kualitas naik). Petak kosong pun bisa dipupuk
  // (memulihkan tanah). Kembalikan false bila tidak ada pupuk / petak
  // tidak dicangkul.
  fertiliseAt(ix, iz, inv) {
    if (!isValidPlot(ix, iz)) return false;
    const p = this.plots[plotIndex(ix, iz)];
    if (!p.hoed) return false;
    if ((inv.fertiliser || 0) < 1) return false;
    inv.fertiliser -= 1;
    p.soil = Math.min(100, (p.soil ?? SOIL_DEFAULT) + SOIL_FERTILISE_GAIN);
    if (p.crop) p.fert = true;
    this.refreshPlot(plotIndex(ix, iz)); return true;
  }
  harvestAt(ix, iz, inv, invQ) {
    if (!isValidPlot(ix, iz)) return false;
    const idx = plotIndex(ix, iz);
    const p = this.plots[idx];
    if (!p.crop || !this.isReady(p)) return false;
    // COZY-C: roll kualitas dari tanah + pupuk; tanah terkuras -15 tiap panen.
    const quality = rollQuality(Math.random(), p.soil ?? SOIL_DEFAULT, !!p.fert);
    inv[p.crop] = (inv[p.crop] || 0) + 1;
    if (invQ) addQuality(invQ, p.crop, quality, 1);
    const harvested = { crop: p.crop, quality };
    p.crop = null; p.growth = 0; p.watered = false; p.hoed = false; p.fert = false;
    p.soil = Math.max(0, (p.soil ?? SOIL_DEFAULT) - SOIL_HARVEST_COST);
    this.refreshPlot(idx); return harvested;
  }
  // ---- Pohon buah (COZY-C) ----
  // refreshTree(i): bangun ulang mesh pohon dari state.trees[i].
  // kind null = titik kosong (tanda tanah kecil saja); growth 0-1 = bibit/
  // muda; growth >= 2 = dewasa + buah (fruit bola di tajuk).
  refreshTree(i) {
    if (!this.trees) return;
    const g = this.treeGroups[i];
    if (!g) return;
    while (g.children.length) g.remove(g.children[0]);
    const tr = this.trees[i];
    const spot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.25, 8), mat(0x6e4a26));
    spot.position.y = 0.12; g.add(spot);
    if (!tr || !tr.kind) return;
    const def = TREE_DEFS[tr.kind];
    if (tr.growth < 1) {
      // Bibit: 3 kecambah kecil.
      for (let k = 0; k < 3; k++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 5), mat(0x66bb6a));
        const a = (k / 3) * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.2, 0.4, Math.sin(a) * 0.2);
        g.add(leaf);
      }
      return;
    }
    const s = tr.growth < TREE_MATURE_DAYS ? 0.6 : 1;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 1.4 * s, 6), mat(0x6e4a26));
    trunk.position.y = 0.7 * s; addOutline(trunk); g.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.05 * s, 10, 8), mat(def.leafColor));
    crown.position.y = 1.9 * s; crown.scale.y = 0.85; addOutline(crown); g.add(crown);
    for (let f = 0; f < (tr.fruit || 0); f++) {
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mat(def.fruitColor));
      const a = (f / Math.max(1, tr.fruit)) * Math.PI * 2;
      fruit.position.set(Math.cos(a) * 0.8 * s, (1.6 + (f % 2) * 0.4) * s, Math.sin(a) * 0.8 * s);
      g.add(fruit);
    }
  }
  refreshTrees() { for (let i = 0; i < TREE_SPOTS.length; i++) this.refreshTree(i); }
  nearestTree(x, z, maxDist = 2.6) {
    let best = -1, bestD = maxDist;
    for (let i = 0; i < TREE_SPOTS.length; i++) {
      const d = Math.hypot(TREE_SPOTS[i].x - x, TREE_SPOTS[i].z - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  // Tanam bibit di titik kosong. Bibit dibeli di toko (appleSapling /
  // orangeSapling). Pohon tumbuh +1/hari otomatis (tanpa siram).
  plantTree(i, kind, inv) {
    if (!this.trees || i < 0 || i >= TREE_SPOTS.length) return false;
    const tr = this.trees[i];
    if (tr.kind) return false;
    if (kind !== 'apple' && kind !== 'orange') return false;
    const key = kind === 'apple' ? 'appleSapling' : 'orangeSapling';
    if ((inv[key] || 0) < 1) return false;
    inv[key] -= 1;
    tr.kind = kind; tr.growth = 0; tr.fruit = 0;
    this.refreshTree(i); return true;
  }
  // Panen semua buah matang di satu pohon (tiap buah roll kualitas sendiri).
  harvestTree(i, inv, invQ) {
    if (!this.trees || i < 0 || i >= TREE_SPOTS.length) return 0;
    const tr = this.trees[i];
    if (!tr.kind || tr.growth < TREE_MATURE_DAYS || (tr.fruit || 0) < 1) return 0;
    const n = tr.fruit;
    const qualities = [];
    for (let f = 0; f < n; f++) {
      // Pohon tidak dipupuk: roll dari tanah subur tetap (soil 80).
      const q = rollQuality(Math.random(), SOIL_DEFAULT, false);
      qualities.push(q);
      if (invQ) addQuality(invQ, tr.kind, q, 1);
    }
    inv[tr.kind] = (inv[tr.kind] || 0) + n;
    tr.fruit = 0;
    this.refreshTree(i);
    return { kind: tr.kind, count: n, qualities };
  }
  treeIsReady(i) {
    if (!this.trees || i < 0 || i >= TREE_SPOTS.length) return false;
    const tr = this.trees[i];
    return !!tr.kind && tr.growth >= TREE_MATURE_DAYS && (tr.fruit || 0) > 0;
  }
  // Dipanggil saat tidur / ganti hari: tanaman yang disiram tumbuh 1 hari
  // (dipupuk + disiram = 2 hari); pohon tumbuh +1 dan berbuah +1/hari.
  growDay() {
    for (let i = 0; i < this.plots.length; i++) {
      const p = this.plots[i];
      if (p.crop && p.watered && p.growth < CROPS[p.crop].days) {
        p.growth = Math.min(CROPS[p.crop].days, p.growth + (p.fert ? 2 : 1));
      }
      p.watered = false;
      this.refreshPlot(i);
    }
    if (this.trees) {
      for (let i = 0; i < this.trees.length; i++) {
        const tr = this.trees[i];
        if (!tr.kind) continue;
        if (tr.growth < TREE_MATURE_DAYS) tr.growth += 1;
        else if ((tr.fruit || 0) < TREE_FRUIT_MAX) tr.fruit += 1;
        this.refreshTree(i);
      }
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
