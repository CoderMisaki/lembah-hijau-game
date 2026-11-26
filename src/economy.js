// economy.js — COZY-C: satu-satunya sumber harga untuk ekonomi baru.
// Semua harga jual baru (tanaman, buah, olahan) + permintaan pasar harian
// + resep olah + kualitas panen mengalir dari sini. Harga dasar tanaman
// dibaca dari CROPS / ANIMAL_DEFS (bukan disalin) supaya tidak ada tabel
// kedua; harga olahan + bibit pohon + pupuk didefinisikan di sini.
// Permintaan harian = fungsi murni dari nomor hari + seed tetap —
// deterministik, jadi bisa dihitung ulang server-side nanti (F2/E lane),
// bukan dipilih client.
// Kualitas panen (normal/bagus/langka) di-roll client saat panen;
// server kelak hanya bisa memvalidasi rentang jumlah (lihat laporan lane C).
import { CROPS } from './farm.js';
import { ANIMAL_DEFS } from './animals.js';

export const ECONOMY_SEED = 20261126;

// ---- Kualitas panen ----
export const QUALITY = {
  normal: { id: 'normal', mult: 1 },
  good: { id: 'good', mult: 1.5 },
  rare: { id: 'rare', mult: 2.5 },
};
export const QUALITY_ORDER = ['normal', 'good', 'rare'];

// Peluang roll kualitas dari satu angka acak r in [0,1):
//   langka:  5% + 5% * (soil/100) + 5% bila dipupuk        (maks 15%)
//   bagus:  20% + 15% * (soil/100) + 10% bila dipupuk      (maks 45%)
//   sisanya normal. Tanah subur + pupuk = peluang naik, bukan jaminan.
export function rollQuality(r, soil = 80, fertilised = false) {
  const s = Math.max(0, Math.min(100, soil)) / 100;
  const rareP = 0.05 + 0.05 * s + (fertilised ? 0.05 : 0);
  const goodP = 0.20 + 0.15 * s + (fertilised ? 0.10 : 0);
  if (r < rareP) return 'rare';
  if (r < rareP + goodP) return 'good';
  return 'normal';
}
export function qualityMult(q) { return (QUALITY[q] || QUALITY.normal).mult; }

// ---- Barang olahan (hasil mesin pengolah) ----
export const PROCESSED = {
  cheese: { id: 'cheese', name: 'Keju', nameEn: 'Cheese', icon: 'milk', sell: 45 },
  sauce: { id: 'sauce', name: 'Saus Tomat', nameEn: 'Tomato Sauce', icon: 'tomato', sell: 55 },
  flour: { id: 'flour', name: 'Tepung', nameEn: 'Flour', icon: 'wheat', sell: 40 },
};

// ---- Resep mesin pengolah (satu mesin: Pengolah / mill-kitchen) ----
// Bonus kualitas: tiap bahan langka yang dipakai +1 hasil, tiap 2 bahan
// bagus +1 hasil. Contoh: 2 susu langka -> keju 1 + 2 = 3.
export const RECIPES = [
  { id: 'cheese', name: 'Keju', nameEn: 'Cheese', inputs: { milk: 2 }, output: { cheese: 1 } },
  { id: 'sauce', name: 'Saus Tomat', nameEn: 'Tomato Sauce', inputs: { tomato: 2 }, output: { sauce: 1 } },
  { id: 'flour', name: 'Tepung', nameEn: 'Flour', inputs: { wheat: 2 }, output: { flour: 1 } },
];
export function craftBonus(usedQuality) {
  // usedQuality: { good: n, rare: n } — jumlah unit bahan per kualitas.
  const good = (usedQuality && usedQuality.good) || 0;
  const rare = (usedQuality && usedQuality.rare) || 0;
  return rare + Math.floor(good / 2);
}

// ---- Pupuk + bibit pohon ----
export const FERTILISER = { id: 'fertiliser', name: 'Pupuk', nameEn: 'Fertiliser', icon: 'leaf', price: 5 };
export const SOIL_FERTILISE_GAIN = 25; // tanah +25 saat dipupuk (maks 100)
export const SOIL_HARVEST_COST = 15; // tanah -15 tiap panen (min 0)
export const SOIL_DEFAULT = 80;
export const SAPLINGS = {
  apple: { id: 'apple', kind: 'apple', name: 'Bibit Apel', nameEn: 'Apple Sapling', icon: 'tomato', price: 25, seedKey: 'appleSapling' },
  orange: { id: 'orange', kind: 'orange', name: 'Bibit Jeruk', nameEn: 'Orange Sapling', icon: 'pumpkin', price: 30, seedKey: 'orangeSapling' },
};

// ---- Pohon buah (perennial): 4 titik tetap di sekitar kebun buah (48,48) ----
export const TREE_SPOTS = [
  { x: 38, z: 48 },
  { x: 58, z: 48 },
  { x: 48, z: 38 },
  { x: 48, z: 58 },
];
export const TREE_DEFS = {
  apple: { id: 'apple', name: 'Apel', nameEn: 'Apple', icon: 'tomato', sell: 18, color: 0xd9382b, fruitColor: 0xd9382b, leafColor: 0x2e7d32 },
  orange: { id: 'orange', name: 'Jeruk', nameEn: 'Orange', icon: 'pumpkin', sell: 22, color: 0xe87a2a, fruitColor: 0xe87a2a, leafColor: 0x2e7d32 },
};
export const TREE_MATURE_DAYS = 2; // bibit -> pohon berbuah dalam 2 hari
export const TREE_FRUIT_MAX = 3; // buah maks per pohon; +1/hari bila sudah dewasa
export const TREE_GROW_DAYS = TREE_MATURE_DAYS;

// ---- Mesin pengolah: posisi + cooldown ----
// Posisi (30,6): timur kebun, di luar rect petak (x maks 28) dan rect pasar
// malam (z 48 di luar). Olah = instan, cooldown 15 detik nyata per mesin.
export const MACHINE_POS = { x: 30, z: 6 };
export const MACHINE_COOLDOWN_MS = 15000;

// Mesh mesin pengolah (kincir giling kecil: alas batu + badan kayu + roda
// giling + cerobong). Dibangun di sini supaya main.js cukup memanggil satu
// fungsi; collider AABB dikembalikan untuk world.colliders.
export function buildMachine(scene, THREE, helpers) {
  const { toonMat, addOutline } = helpers;
  const { terrainHeight } = helpers;
  const g = new THREE.Group();
  const y = terrainHeight(MACHINE_POS.x, MACHINE_POS.z);
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 2.0), toonMat(0x8a8a9a));
  base.position.y = 0.5; addOutline(base); g.add(base);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.5), toonMat(0x8a6b3f));
  body.position.y = 1.7; addOutline(body); g.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.9, 4), toonMat(0xd9382b));
  roof.position.y = 2.85; roof.rotation.y = Math.PI / 4; addOutline(roof); g.add(roof);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.12, 6, 16), toonMat(0x6e4a26));
  wheel.position.set(0, 1.7, 0.85); g.add(wheel);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.08), toonMat(0x6e4a26));
    spoke.position.set(0, 1.7, 0.85);
    spoke.rotation.z = (i * Math.PI) / 4;
    g.add(spoke);
  }
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.9, 6), toonMat(0x8a8a9a));
  chimney.position.set(0.6, 3.1, -0.3); g.add(chimney);
  g.position.set(MACHINE_POS.x, y, MACHINE_POS.z);
  scene.add(g);
  return {
    group: g,
    pos: { ...MACHINE_POS },
    collider: { minX: MACHINE_POS.x - 1.3, maxX: MACHINE_POS.x + 1.3, minZ: MACHINE_POS.z - 1.1, maxZ: MACHINE_POS.z + 1.1 },
  };
}

// ---- Nama barang (ID + EN) untuk UI pasar/olah ----
export const ITEM_NAMES = {
  carrot: { id: 'Wortel', en: 'Carrot' },
  tomato: { id: 'Tomat', en: 'Tomato' },
  pumpkin: { id: 'Labu', en: 'Pumpkin' },
  wheat: { id: 'Gandum', en: 'Wheat' },
  strawberry: { id: 'Stroberi', en: 'Strawberry' },
  apple: { id: 'Apel', en: 'Apple' },
  orange: { id: 'Jeruk', en: 'Orange' },
  egg: { id: 'Telur', en: 'Egg' },
  milk: { id: 'Susu', en: 'Milk' },
  cheese: { id: 'Keju', en: 'Cheese' },
  sauce: { id: 'Saus Tomat', en: 'Tomato Sauce' },
  flour: { id: 'Tepung', en: 'Flour' },
};
export function itemName(itemId, lang = 'id') {
  const e = ITEM_NAMES[itemId];
  if (!e) return itemId;
  return lang === 'en' ? e.en : e.id;
}
export function itemIcon(itemId) {
  if (CROPS[itemId]) return CROPS[itemId].icon;
  if (TREE_DEFS[itemId]) return TREE_DEFS[itemId].icon;
  if (PROCESSED[itemId]) return PROCESSED[itemId].icon;
  if (itemId === 'egg') return 'egg';
  if (itemId === 'milk') return 'milk';
  return 'sprout';
}

// ---- Harga dasar (single source) ----
// Tanaman + telur/susu dibaca dari tabel asalnya; pohon + olahan dari sini.
export function basePrice(itemId) {
  if (CROPS[itemId]) return CROPS[itemId].sell;
  if (TREE_DEFS[itemId]) return TREE_DEFS[itemId].sell;
  if (PROCESSED[itemId]) return PROCESSED[itemId].sell;
  if (itemId === 'egg') return ANIMAL_DEFS.ayam.sell;
  if (itemId === 'milk') return ANIMAL_DEFS.sapi.sell;
  return 0;
}
export const SELLABLES = [
  'carrot', 'tomato', 'pumpkin', 'wheat', 'strawberry',
  'apple', 'orange', 'egg', 'milk', 'cheese', 'sauce', 'flour',
];

// ---- Permintaan pasar harian (deterministik dari hari) ----
// mulberry32: PRNG kecil yang sama hasilnya di client mana pun (dan di
// server, bila diimplementasi ulang dengan seed + rumus yang sama).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// 2 barang paling dicari hari itu (×1.5). Tanpa penyimpanan: dihitung dari
// `day` setiap kali dibutuhkan, jadi rotasi mengikuti pergantian hari.
export function demandFor(day) {
  const rng = mulberry32((ECONOMY_SEED ^ Math.imul(day, 0x9E3779B9)) >>> 0);
  const pool = [...SELLABLES];
  const wanted = [];
  while (wanted.length < 2 && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    wanted.push(pool.splice(i, 1)[0]);
  }
  const mult = {};
  for (const id of SELLABLES) mult[id] = wanted.includes(id) ? 1.5 : 1;
  return { day, wanted, mult };
}
export function demandMult(itemId, day) {
  return demandFor(day).mult[itemId] || 1;
}
// Harga jual 1 unit: dasar × kualitas × permintaan hari itu.
export function sellPrice(itemId, quality = 'normal', day = 1) {
  return Math.round(basePrice(itemId) * qualityMult(quality) * demandMult(itemId, day));
}

// ---- Kualitas di inventaris (invQ) ----
// inv[item] = TOTAL unit; invQ[item] = { good, rare } = berapa unit dari
// total itu yang berkualitas bagus/langka (sisanya normal). Selalu dijaga:
// good + rare <= inv[item].
export function sanitizeInvQ(invQ, inv) {
  const out = {};
  if (!invQ || typeof invQ !== 'object') return out;
  for (const [item, q] of Object.entries(invQ)) {
    if (!q || typeof q !== 'object') continue;
    const total = Math.max(0, inv[item] || 0);
    const rare = Math.max(0, Math.min(total, Math.floor(q.rare) || 0));
    const good = Math.max(0, Math.min(total - rare, Math.floor(q.good) || 0));
    if (good > 0 || rare > 0) out[item] = { good, rare };
  }
  return out;
}
export function addQuality(invQ, item, quality, n = 1) {
  if (quality === 'normal' || n <= 0) return;
  if (!invQ[item]) invQ[item] = { good: 0, rare: 0 };
  invQ[item][quality] = (invQ[item][quality] || 0) + n;
}
// Unit terbaik yang dimiliki (dijual duluan): langka > bagus > normal.
export function bestUnit(inv, invQ, itemId) {
  const q = (invQ && invQ[itemId]) || { good: 0, rare: 0 };
  if ((q.rare || 0) > 0) return 'rare';
  if ((q.good || 0) > 0) return 'good';
  return 'normal';
}
export function takeUnit(inv, invQ, itemId, n = 1) {
  // Ambil n unit (terbaik dulu). Kembalikan { taken, quality: {good, rare, normal} }.
  const have = Math.max(0, inv[itemId] || 0);
  const take = Math.min(have, n);
  const used = { good: 0, rare: 0, normal: 0 };
  const q = (invQ && invQ[itemId]) || { good: 0, rare: 0 };
  let left = take;
  const rareTake = Math.min(q.rare || 0, left);
  used.rare = rareTake; left -= rareTake;
  const goodTake = Math.min(q.good || 0, left);
  used.good = goodTake; left -= goodTake;
  used.normal = left;
  inv[itemId] = have - take;
  if (invQ && invQ[itemId]) {
    invQ[itemId].rare = Math.max(0, (q.rare || 0) - rareTake);
    invQ[itemId].good = Math.max(0, (q.good || 0) - goodTake);
    if (invQ[itemId].rare === 0 && invQ[itemId].good === 0) delete invQ[itemId];
  }
  return { taken: take, quality: used };
}
// Nilai jual seluruh isi inventaris (dipakai sellAll): kembalikan rincian
// per barang per kualitas + total. TIDAK mengubah inv (main.js yang nol-kan).
export function computeSellAll(inv, invQ, day) {
  const d = demandFor(day);
  let earned = 0, count = 0;
  const lines = [];
  for (const id of SELLABLES) {
    const n = inv[id] || 0;
    if (n <= 0) continue;
    const q = (invQ && invQ[id]) || { good: 0, rare: 0 };
    const rare = Math.min(n, q.rare || 0);
    const good = Math.min(n - rare, q.good || 0);
    const normal = n - rare - good;
    const base = basePrice(id);
    const dm = d.mult[id] || 1;
    const sub = Math.round(normal * base * dm)
      + Math.round(good * base * 1.5 * dm)
      + Math.round(rare * base * 2.5 * dm);
    earned += sub; count += n;
    lines.push({ id, normal, good, rare, earned: sub });
  }
  return { earned, count, lines, wanted: d.wanted };
}

// ---- Pohon: sanitasi state save ----
export function defaultTrees() {
  return TREE_SPOTS.map(() => ({ kind: null, growth: 0, fruit: 0 }));
}
export function sanitizeTrees(trees) {
  const out = defaultTrees();
  if (!Array.isArray(trees)) return out;
  for (let i = 0; i < Math.min(trees.length, out.length); i++) {
    const tr = trees[i];
    if (!tr || typeof tr !== 'object') continue;
    const kind = tr.kind === 'apple' || tr.kind === 'orange' ? tr.kind : null;
    out[i] = {
      kind,
      growth: kind ? Math.max(0, Math.min(TREE_MATURE_DAYS, Math.floor(tr.growth) || 0)) : 0,
      fruit: kind ? Math.max(0, Math.min(TREE_FRUIT_MAX, Math.floor(tr.fruit) || 0)) : 0,
    };
  }
  return out;
}
