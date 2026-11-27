// world.js — lembah pastoral low-poly: terrain, pegunungan, sungai mengalir,
// jembatan kayu, rumah, kios toko, kandang, jalan tanah, pohon (instanced), pagar.
import * as THREE from 'three';
import { terrainHeight, riverCenterX, RIVER_HALF, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_RAMP_LEN,
         BRIDGE_DECK_MIN_X, BRIDGE_DECK_MAX_X, BRIDGE_WALK_HALF, WATER_Y, noise2, smoothstep,
         LAKE, WINDMILL, MEADOW, ORCHARD, SQUARE, inNightMarket } from './physics.js';

export const FARM_ORIGIN = { x: 12, z: 4 };
export const FARM_COLS = 6, FARM_ROWS = 4, FARM_SPACING = 2.8;
export const PEN = { minX: -13, maxX: 1, minZ: 11, maxZ: 21 }; // kandang ternak
export const HOUSE = { minX: -3, maxX: 5, minZ: -26, maxZ: -19 }; // rumah pemain
export const SHOP = { minX: -12, maxX: -6, minZ: -26, maxZ: -20 }; // kios toko
export const CRATE_START = { x: 7, z: -15 };

// ---- Material dunia: PBR (Lane A, 27 Nov 2026): MeshStandardMaterial.
// Dulu MeshToonMaterial + gradientMap 4-step (cel anime). Nama helper
// toonMat()/mat() DIPERTAHANKAN supaya call site di world.js, farm.js,
// animals.js, economy.js (via main.js) tidak pecah — yang berubah hanya
// implementasinya. Default PBR dunia: roughness 0.85, metalness 0 (tanah,
// kayu, daun, batu); air/kaca/window meng-override roughness lewat opts.
// TOON_GRADIENT dipertahankan sebagai ekspor (deprecated, tidak lagi dipakai
// material mana pun) supaya import lama di luar lane ini tidak pecah.
// Token PRODUCT.md: ink #1d2b53, sky #3fa9f5, sakura #ff8fb3, sun #ffc93c,
// leaf #2fbf4a, valley #4fc94f, cream #fff1c4.
export const INK = 0x1d2b53;
export const TOON_GRADIENT = (() => {
  const data = new Uint8Array([90, 150, 210, 255]); // 4 step cel (legacy, tidak dipakai lagi)
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();
export function toonMat(color, opts = {}) {
  const { roughness = 0.85, metalness = 0, ...rest } = opts;
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...rest });
}
// Outline tegas anime: inverted hull (BackSide, warna ink) sebagai anak mesh.
// LANE A: TIDAK LAGI dipakai di world.js (semua 32 call site dihapus —
// terrain/bangunan/props realistis tanpa outline). Fungsi tetap diekspor
// karena farm.js / animals.js / economy.js masih mengimpornya (file di luar
// lane ini); outline karakter (player.js) punya helper sendiri dan tidak
// disentuh.
export function addOutline(mesh, s = 1.035) {
  const o = new THREE.Mesh(mesh.geometry,
    new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  o.scale.setScalar(s);
  o.castShadow = false; o.receiveShadow = false;
  mesh.add(o);
  return o;
}

function mat(color, opts = {}) {
  return toonMat(color, opts);
}

export function buildWorld(scene) {
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  // RNG ber-seed: tata letak dekorasi stabil antar load (bukan Math.random).
  let _seed = 20261122;
  const rnd = () => (_seed = (_seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let elapsed = 0;
  let quality = 'medium'; // diubah lewat setQuality(); 'low' mematikan partikel + goyangan
  let grassSway = true;
  // ---- COZY-B: cuaca + musim + angin (state RUNTIME saja — TIDAK masuk
  // save v2; lihat LANE-B-REPORT.md §6 untuk field yang harus dimigrasi F2).
  let season = 'spring'; // 'spring' | 'summer' | 'autumn' | 'winter'
  let weather = 'sunny'; // 'sunny' | 'rain' | 'cloudy' | 'storm'
  let weatherTimer = 0; // auto-cycle cuaca tiap ~50 dtk nyata
  // weatherMix = parameter tampil yang di-lerp menuju preset target
  // (transisi cuaca ~3 dtk, bukan lompat). setWeather() men-snap langsung.
  const WEATHER_PRESETS = {
    sunny:  { sunMul: 1,    tintK: 0,    fogMul: 1,    rain: 0 },
    cloudy: { sunMul: 0.55, tintK: 0.55, fogMul: 0.75, rain: 0 },
    rain:   { sunMul: 0.45, tintK: 0.7,  fogMul: 0.6,  rain: 0.6 },
    storm:  { sunMul: 0.3,  tintK: 0.85, fogMul: 0.45, rain: 1 },
  };
  let weatherMix = { ...WEATHER_PRESETS.sunny };
  let windTime = 0;
  // SATU envelope angin per frame (ARCHITECTURE.md §13.7): dihitung sekali
  // di update(), lalu dipakai rumput + tajuk + rotor kincir + awan + kelopak.
  const wind = { speed: 1, dir: 0.6, gust: 0.5, x: 0.82, z: 0.57 };
  let flashT = 0, flashNext = 5; // petir (storm): timer + durasi kilat
  // Lokasi tersembunyi (COZY-B): penanda halus di dunia; masuk ke salah
  // satunya = +koin SEKALI per save (state.discoveredSpots, lihat §6 laporan).
  const HIDDEN_SPOTS = [
    { id: 'sakura-grove',  x: -34, z: -44, r: 2.5, reward: 30, name: 'Rumpun Sakura',    nameEn: 'Sakura Grove' },
    { id: 'lake-shore',    x: 70,  z: -66, r: 2.5, reward: 40, name: 'Tepi Danau',       nameEn: 'Lake Shore' },
    { id: 'mountain-nook', x: -96, z: 28,  r: 2.5, reward: 50, name: 'Ceruk Gunung',     nameEn: 'Mountain Nook' },
    { id: 'old-well',      x: -60, z: -40, r: 2.5, reward: 35, name: 'Sumur Tua',        nameEn: 'Old Well' },
    { id: 'windmill-back', x: -68, z: 62,  r: 2.5, reward: 30, name: 'Belakang Kincir',  nameEn: 'Behind the Windmill' },
  ];
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
  const _dummy = new THREE.Object3D();

  // ---- Jalur jalan tanah (poliline): dipakai pewarnaan terrain + minimapData.
  // 3 jalur lama dipertahankan; sisanya menghubungkan alun-alun, danau,
  // kincir, kebun buah, dan padang bunga.
  const PATHS = [
    [{ x: -12, z: -17 }, { x: 12, z: -17 }],              // rumah -> kebun (lama)
    [{ x: 9, z: -17 }, { x: 9, z: 12 }],                  // kebun -> kandang (lama)
    [{ x: -28, z: BRIDGE_Z }, { x: 9, z: BRIDGE_Z }],     // ke jembatan (lama)
    [{ x: 9, z: -17 }, { x: 14, z: -24 }, { x: 16, z: -31 }], // ke alun-alun
    [{ x: 10, z: -31 }, { x: 22, z: -31 }],               // alun-alun timur-barat
    [{ x: 16, z: -37 }, { x: 16, z: -25 }],               // alun-alun utara-selatan
    [{ x: 16, z: -31 }, { x: 24, z: -28 }, { x: 34, z: -34 }, { x: 44, z: -42 }, { x: 52, z: -50 }], // ke danau
    [{ x: -28, z: 6 }, { x: -40, z: 20 }, { x: -50, z: 38 }, { x: -58, z: 50 }], // ke kincir
    [{ x: 9, z: 12 }, { x: 24, z: 26 }, { x: 40, z: 40 }, { x: 48, z: 44 }],     // ke kebun buah
    [{ x: -28, z: 6 }, { x: -36, z: -14 }, { x: -44, z: -34 }, { x: -50, z: -48 }], // ke padang bunga
    // Lane P: pasar malam, jalan baru dari kebun ke gapura (mengelilingi
    // petak kebun dari selatan, BUKAN menembusnya), jalan utama + silang,
    // dan keliling batas zona (garis tanah pembatas, ikut tampil di minimap).
    [{ x: 12, z: 12 }, { x: 18, z: 17 }, { x: 36, z: 15 }, { x: 50, z: 8 }, { x: 60, z: 0 }], // kebun -> gapura
    [{ x: 62, z: 0 }, { x: 92, z: 0 }],                  // jalan utama pasar malam
    [{ x: 77, z: -22 }, { x: 77, z: 22 }],               // jalan silang pasar malam
    [{ x: 58, z: -50 }, { x: 74, z: -50 }, { x: 74, z: -55 }, { x: 102, z: -55 }, { x: 102, z: 44 }, { x: 58, z: 44 }, { x: 58, z: -50 }], // batas zona (jog annex utara, koordinator)
  ];
  const PATH_SEGS = [];
  for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) {
    PATH_SEGS.push([p[i].x, p[i].z, p[i + 1].x, p[i + 1].z]);
  }
  function distToSeg(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((px - ax) * dx + (pz - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }
  function distToPaths(x, z) {
    let d = 1e9;
    for (const s of PATH_SEGS) d = Math.min(d, distToSeg(x, z, s[0], s[1], s[2], s[3]));
    return d;
  }
  // ---- Rumah desa baru (w/d = ukuran LOKAL; pintu di sisi +Z lokal,
  // rotY memutar menghadap alun-alun/jalan). w/d dunia = tukar bila rotY ±90°.
  const NEW_HOUSES = [
    { x: 27, z: -35, w: 7, d: 6, wall: 0xe8d9b0, roof: 0x8a4a2f, roofType: 'pyramid', chimney: true, rotY: -Math.PI / 2, garden: false },
    { x: 29, z: -21, w: 6, d: 5.5, wall: 0xf0e0c0, roof: 0x7a5a3a, roofType: 'gable', chimney: false, rotY: -Math.PI / 2, garden: true },
    { x: 16, z: -43, w: 7.5, d: 6, wall: 0xe3cfa0, roof: 0x9a4a2f, roofType: 'pyramid', chimney: true, rotY: 0, garden: false },
    { x: 3, z: -41, w: 6, d: 5, wall: 0xead9b8, roof: 0xb03a2e, roofType: 'cone', chimney: false, rotY: Math.PI / 2, garden: true },
    { x: -5, z: -46, w: 6, d: 5, wall: 0xf3e3c0, roof: 0x6e4a26, roofType: 'gable', chimney: true, rotY: 0, garden: false },
    { x: 35, z: -29, w: 6, d: 5, wall: 0xe8d9b0, roof: 0x8a4a2f, roofType: 'pyramid', chimney: false, rotY: -Math.PI / 2, garden: true },
    // COZY-B: 4 rumah lagi supaya alun-alun terasa "rame" (sisi barat + utara
    // yang tadinya kosong). Atap bervariasi: genting biru gelap (aksen sakura-
    // village map-2), plum, hijau daun, merah. Posisi di luar PATHS + di luar
    // footprint rumah lama (cek manual vs houseFootprint + distToPaths).
    { x: -2, z: -33, w: 6.5, d: 5.5, wall: 0xf0d8b0, roof: 0x2f5d8a, roofType: 'gable', chimney: true, rotY: Math.PI / 2, garden: true },
    { x: 38, z: -42, w: 6, d: 5, wall: 0xe8d9b0, roof: 0x7a3a5a, roofType: 'pyramid', chimney: false, rotY: 0, garden: false },
    { x: -14, z: -38, w: 6, d: 5, wall: 0xf3e3c0, roof: 0x3a7a5c, roofType: 'gable', chimney: true, rotY: 0, garden: true },
    { x: 24, z: -46, w: 5.5, d: 5, wall: 0xead9b8, roof: 0xb03a2e, roofType: 'cone', chimney: false, rotY: -Math.PI / 2, garden: false },
  ];
  // Footprint dunia (AABB) satu rumah baru — dipakai eksklusi pohon/dekor + collider.
  function houseFootprint(h) {
    const rot90 = Math.abs(Math.abs(h.rotY) - Math.PI / 2) < 0.01;
    const ww = rot90 ? h.d : h.w, dd = rot90 ? h.w : h.d;
    return { minX: h.x - ww / 2, maxX: h.x + ww / 2, minZ: h.z - dd / 2, maxZ: h.z + dd / 2, w: ww, d: dd };
  }
  function insideHouseFootprints(x, z, pad) {
    for (const h of NEW_HOUSES) {
      const f = houseFootprint(h);
      if (x > f.minX - pad && x < f.maxX + pad && z > f.minZ - pad && z < f.maxZ + pad) return true;
    }
    return false;
  }

  // ---- Terrain: plane 260x260, warna per-vertex (rumput / pasir sungai / batu gunung)
  const SIZE = 260, SEG = 170;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  // LANE B (27 Nov 2026): palet NATURAL — hijau rumput tanah (olive, bukan
  // neon 0x3fae4a/0x6fd35a), coklat tanah, pasir hangat, batu abu-coklat.
  // Satu register tanah yang konsisten di semua zona terrain + tint musim.
  const cGrassA = new THREE.Color(0x5d7a38), cGrassB = new THREE.Color(0x7d9b4a);
  const cGrassC = new THREE.Color(0x9aa75e); // rumput kering pucat (kuning-zaitun)
  const cMeadow = new THREE.Color(0x4c6b31); // patch padang lebih gelap
  const cSand = new THREE.Color(0xc4ab7d), cRock = new THREE.Color(0x7a7268);
  const cSnow = new THREE.Color(0xf4f8ff), cDirt = new THREE.Color(0x8a6a42);
  const cDirtEdge = new THREE.Color(0x9d7f56);
  const cBloomPink = new THREE.Color(0xe89aae), cBloomYellow = new THREE.Color(0xe3c268),
        cBloomWhite = new THREE.Color(0xf5f2e8), cBloomLav = new THREE.Color(0xb3a1cc);
  const pathBlend = (d) => 1 - smoothstep(1.1, 1.7, d);
  // COZY-B: warna satu vertex terrain sebagai FUNGSI (x, z, h, musim) —
  // dipakai saat build DAN saat setSeason() mewarnai ulang terrain tanpa
  // mengubah tinggi (normal tidak dihitung ulang). Tint musim: semi segar,
  // panas pekat, gugur keemasan, dingin pucat bersalju.
  const cSeasonSpring = new THREE.Color(0x8aa864), cSeasonSummer = new THREE.Color(0x4a7d38),
        cSeasonAutumn = new THREE.Color(0xc08a35), cSeasonWinter = new THREE.Color(0xe8eef7);
  function vertexColor(x, z, h, sn) {
    const r = Math.hypot(x, z);
    const dRiver = Math.abs(x - riverCenterX(z));
    const n = noise2(x * 0.7, z * 0.7) * 0.5 + 0.5;
    const n2 = noise2(x * 0.23 + 40, z * 0.23 - 17) * 0.5 + 0.5; // patch padang besar
    let c = cGrassA.clone().lerp(cGrassB, n).lerp(cGrassC, smoothstep(0.55, 0.85, n) * 0.4);
    c.lerp(cMeadow, smoothstep(0.62, 0.8, n2) * 0.55);
    // Bunga liar: bintik warna lembut di patch padang (1 vertex ~1,5 m, halus).
    const f = noise2(x * 2.1 + 7, z * 2.1 - 3) * 0.5 + 0.5;
    if (f > 0.86 && r < 110 && dRiver > 5) {
      const pick = noise2(x * 3.7, z * 3.7);
      const bc = pick > 0.33 ? cBloomPink : pick > 0 ? cBloomYellow
        : pick > -0.33 ? cBloomWhite : cBloomLav;
      c.lerp(bc, 0.35);
    }
    if (dRiver < 4.5) c = cSand.clone().lerp(cGrassA, smoothstep(3.6, 4.5, dRiver) * 0.3);
    // Tepi danau: cincin pasir di sekeliling cekungan.
    const le = ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2;
    if (le < 1.35) c = cSand.clone().lerp(cGrassA, smoothstep(1.05, 1.35, le) * 0.5);
    if (r > 95) c = c.lerp(cRock, smoothstep(95, 125, r));
    if (h > 16) c = c.lerp(cSnow, smoothstep(16, 22, h));
    // Tanah alun-alun: petak tanah padat di sekitar sumur.
    const dSq = Math.hypot(x - SQUARE.x, z - SQUARE.z);
    if (dSq < 7) c = c.lerp(cDirtEdge, (1 - smoothstep(4, 7, dSq)) * 0.7);
    // Jalan tanah: semua poliline PATHS, tepi lembut (jarak titik-ke-segmen).
    const pb = pathBlend(distToPaths(x, z));
    if (pb > 0) c = c.lerp(pb > 0.85 ? cDirt : cDirtEdge, pb);
    // Tint musim (di atas segalanya, supaya gugur/dingin terasa di seluruh map).
    if (sn === 'autumn') c.lerp(cSeasonAutumn, 0.32);
    else if (sn === 'winter') c.lerp(cSeasonWinter, 0.5);
    else if (sn === 'summer') c.lerp(cSeasonSummer, 0.12);
    else c.lerp(cSeasonSpring, 0.08);
    return c;
  }
  function applySeasonTerrain() {
    for (let i = 0; i < pos.count; i++) {
      const c = vertexColor(pos.getX(i), pos.getZ(i), pos.getY(i), season);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.attributes.color.needsUpdate = true;
  }
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const c = vertexColor(x, z, h, season);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // LANE B: tekstur prosedural tanah (canvas 256x256, SEKALI saat build).
  // Grain halus tanah/rumput: dasar nyaris putih (supaya map x vertexColor
  // ≈ warna vertex) + bintik + bercak lembut. Satu tekstur, repeat 48x48
  // (ubin ~5,4 m), dipakai sebagai map + bumpMap — 0 draw call tambahan,
  // 0 tekstur per zona (ringan untuk HP low-end). RNG ber-seed sendiri
  // (mulberry32) supaya TIDAK menggeser rnd() tata letak dekorasi.
  function makeTerrainTexture() {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const g = cv.getContext('2d');
    let s = 20261127;
    const srnd = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    g.fillStyle = '#f4f3ef'; g.fillRect(0, 0, S, S);
    // Bercak lembut (patch tanah/rumput skala kecil).
    const blotchCols = ['#8a7d5a', '#6f7a4a', '#9a8a6a', '#7d7468', '#a8a078'];
    for (let i = 0; i < 130; i++) {
      const x = srnd() * S, y = srnd() * S, r = 5 + srnd() * 16;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const col = blotchCols[Math.floor(srnd() * blotchCols.length)];
      gr.addColorStop(0, col + '14'); // alpha ~0.08
      gr.addColorStop(1, col + '00');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Bintik grain 1–2 px (butir tanah / helai rumput kering).
    const speckCols = ['#5a5240', '#7a6a42', '#8a8a7a', '#6b5a38', '#a89a72', '#4a5238'];
    for (let i = 0; i < 9000; i++) {
      const a = 0.05 + srnd() * 0.13;
      g.fillStyle = speckCols[Math.floor(srnd() * speckCols.length)]
        + Math.round(a * 255).toString(16).padStart(2, '0');
      const sz = srnd() < 0.75 ? 1 : 2;
      g.fillRect(Math.floor(srnd() * S), Math.floor(srnd() * S), sz, sz);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(48, 48);
    tex.anisotropy = 4;
    if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const terrainTex = makeTerrainTexture();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, map: terrainTex, bumpMap: terrainTex, bumpScale: 0.2,
    roughness: 0.95, metalness: 0,
  }));
  terrain.receiveShadow = true;
  group.add(terrain);

  // ---- Sky dome (Lane C, 27 Nov 2026): gradient natural 3-stop + glow
  // matahari di shader + haze horizon + bintang malam. Tetap mengikuti
  // SKY_STOPS lewat skyUniforms (top/horizon/fog) — sistem waktu tidak diubah.
  // Radius 420 + gl_Position.z = w: depth di-pin ke far plane supaya kubah
  // tidak ter-clip camera.far 400 di main.js (trik skybox standar;
  // three.js default depthFunc LessEqual, jadi langit tetap kalah vs terrain).
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x6fb3ef) },
    horizonColor: { value: new THREE.Color(0xcfe8f5) },
    sunColor: { value: new THREE.Color(0xffc93c) },
    fogColor: { value: new THREE.Color(0xd6ecff) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    starK: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, 24, 12),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: [
        'uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunColor;',
        'uniform vec3 fogColor; uniform vec3 sunDir; uniform float starK;',
        'varying vec3 vP;',
        'float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }',
        'void main(){',
        '  vec3 d = normalize(vP);',
        '  float h = d.y;',
        '  float k = pow(max(h, 0.0), 0.55);',
        '  vec3 col = mix(horizonColor, topColor, k);',
        '  col = mix(fogColor, col, smoothstep(-0.08, 0.02, h));', // bawah horizon -> kabut
        '  float haze = 1.0 - smoothstep(0.0, 0.22, abs(h));', // pita haze di horizon
        '  col = mix(col, fogColor, haze * 0.45);',
        '  float s = max(dot(d, normalize(sunDir)), 0.0);', // glow matahari
        '  col += sunColor * (pow(s, 350.0) * 1.2 + pow(s, 24.0) * 0.35 + pow(s, 6.0) * 0.12);',
        '  if (starK > 0.01 && h > 0.05) {', // bintang malam, hash per sel arah
        '    float hs = hash13(floor(d * 220.0));',
        '    float star = step(0.997, hs) * smoothstep(0.05, 0.25, h);',
        '    col += vec3(0.9, 0.95, 1.0) * star * starK;',
        '  }',
        '  gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
    }),
  );
  scene.add(sky);

  // ---- Matahari realistis (Lane C): disc kecil + glow radial lembut
  // (sprite additive, tekstur canvas) — menggantikan 8 sinar garis anime.
  // Bulan pucat + glow redup. Posisi diatur update().
  function makeGlowTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }
  const glowTex = makeGlowTexture();
  const sunDiscMat = new THREE.MeshBasicMaterial({ color: 0xffc93c, fog: false, transparent: true, opacity: 1 });
  const sunGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffd94d, fog: false, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  const sunGroup = new THREE.Group();
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(12, 24), sunDiscMat);
  sunGroup.add(sunDisc);
  const sunGlow = new THREE.Sprite(sunGlowMat);
  sunGlow.scale.set(150, 150, 1);
  sunGroup.add(sunGlow);
  scene.add(sunGroup);
  const moonGroup = new THREE.Group();
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(10, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }));
  moonGroup.add(moonDisc);
  const moonGlowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xcfd8ff, fog: false, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const moonGlow = new THREE.Sprite(moonGlowMat);
  moonGlow.scale.set(60, 60, 1);
  moonGroup.add(moonGlow);
  for (const [mx, my, mr] of [[-3, 2, 2.2], [3, -3, 1.6], [2, 4, 1.2]]) {
    const crater = new THREE.Mesh(new THREE.CircleGeometry(mr, 12),
      new THREE.MeshBasicMaterial({ color: 0xe8dcb8, fog: false }));
    crater.position.set(mx, my, 0.1);
    moonGroup.add(crater);
  }
  moonGroup.position.set(-240, 200, -180);
  moonGroup.lookAt(0, 10, 0);
  moonGroup.visible = false;
  scene.add(moonGroup);

  // ---- Pegunungan berlapis di kejauhan: 2 cincin kerucut low-poly + salju.
  // Duduk di luar terrain (r 150–210); kabut (fog far 320) yang menyatukannya.
  const mtnSpots = [];
  for (let i = 0; i < 16; i++) { // cincin dekat: hijau-abu
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
    const r = 150 + rnd() * 25;
    mtnSpots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r,
      h: 30 + rnd() * 22, rad: 18 + rnd() * 12, near: true });
  }
  for (let i = 0; i < 12; i++) { // cincin jauh: biru-abu, lebih tinggi
    const a = (i / 12) * Math.PI * 2 + 0.26 + rnd() * 0.3;
    const r = 182 + rnd() * 28;
    mtnSpots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r,
      h: 48 + rnd() * 22, rad: 26 + rnd() * 14, near: false });
  }
  // Kerucut non-indexed + computeVertexNormals = faset datar
  // (MeshStandardMaterial juga mendukung flatShading, tapi normal per-faset
  // dari geometri non-indexed sudah memberi hasil yang sama).
  const mtnGeo = new THREE.ConeGeometry(1, 1, 6).toNonIndexed();
  mtnGeo.computeVertexNormals();
  const mtns = new THREE.InstancedMesh(mtnGeo,
    new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }), mtnSpots.length);
  const snowCaps = new THREE.InstancedMesh(mtnGeo,
    new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.9, metalness: 0 }), mtnSpots.length);
  const cMtnNearA = new THREE.Color(0x6fae7d), cMtnNearB = new THREE.Color(0x8fd0a0);
  const cMtnFarA = new THREE.Color(0x7d8aa0), cMtnFarB = new THREE.Color(0x9aa7bd);
  mtnSpots.forEach((m, i) => {
    const baseY = terrainHeight(m.x, m.z) - 3;
    m.baseY = baseY;
    _m4.compose(new THREE.Vector3(m.x, baseY + m.h / 2, m.z),
      _q, new THREE.Vector3(m.rad, m.h, m.rad));
    mtns.setMatrixAt(i, _m4);
    mtns.setColorAt(i, (m.near ? cMtnNearA.clone().lerp(cMtnNearB, rnd())
      : cMtnFarA.clone().lerp(cMtnFarB, rnd())));
    _m4.compose(new THREE.Vector3(m.x, baseY + m.h * 0.85, m.z),
      _q, new THREE.Vector3(m.rad * 0.38, m.h * 0.3, m.rad * 0.38));
    snowCaps.setMatrixAt(i, _m4);
  });
  mtns.instanceColor.needsUpdate = true;
  group.add(mtns); group.add(snowCaps);

  // ---- Sungai: bidang air dengan tekstur canvas yang di-offset (terlihat mengalir)
  // Jernih: biru lebih terang + transparan supaya dasar pasir terlihat.
  const waterCanvas = document.createElement('canvas');
  waterCanvas.width = 128; waterCanvas.height = 128;
  const wc = waterCanvas.getContext('2d');
  wc.fillStyle = '#3fa9f5'; wc.fillRect(0, 0, 128, 128);
  wc.strokeStyle = 'rgba(255,255,255,0.55)'; wc.lineWidth = 2.5; // Lane C: garis
  // lebih redup supaya tint langit (bukan garis putih) yang mendominasi air.
  for (let i = 0; i < 10; i++) {
    wc.beginPath();
    wc.moveTo(0, i * 13 + 4);
    wc.bezierCurveTo(40, i * 13, 80, i * 13 + 8, 128, i * 13 + 2);
    wc.stroke();
  }
  // Kilau jernih: titik-titik putih kecil (cahaya di permukaan).
  wc.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 26; i++) {
    wc.beginPath();
    wc.arc((i * 47) % 128, (i * 31) % 128, 1.2, 0, Math.PI * 2);
    wc.fill();
  }
  const waterTex = new THREE.CanvasTexture(waterCanvas);
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(1, 22);
  const waterGeo = new THREE.PlaneGeometry(RIVER_HALF * 2 + 1, SIZE, 1, 40);
  waterGeo.rotateX(-Math.PI / 2);
  const wpos = waterGeo.attributes.position;
  for (let i = 0; i < wpos.count; i++) {
    const z = wpos.getZ(i);
    wpos.setX(i, riverCenterX(z) + wpos.getX(i));
  }
  waterGeo.computeVertexNormals();
  // PBR: air agak mengkilap (roughness rendah) + transparan supaya dasar
  // pasir terlihat; tekstur mengalir + riak vertex + buih tetap seperti dulu.
  // Lane C: roughness 0.08 -> kilau specular matahari tajam (pantulan murah,
  // tanpa planar reflection); warna di-tint tiap frame mengikuti langit
  // (update(): horizon + biru dalam) supaya air "memantulkan" langit.
  const waterMat = new THREE.MeshStandardMaterial({
    map: waterTex, transparent: true, opacity: 0.62, roughness: 0.08, metalness: 0,
  });
  const _waterTint = new THREE.Color();
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WATER_Y;
  group.add(water);
  const waterBase = waterGeo.attributes.position.array.slice(); // posisi dasar utk riak

  // ---- Buih arus: garis putih kecil yang hanyut mengikuti aliran (+Z,
  // searah offset tekstur) — air terlihat mengalir, bukan diam.
  const FOAM_N = 24;
  const foamGeo = new THREE.BoxGeometry(0.35, 0.03, 1.6);
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.65 });
  const foam = new THREE.InstancedMesh(foamGeo, foamMat, FOAM_N);
  const foamData = [];
  for (let i = 0; i < FOAM_N; i++) {
    const z = -130 + rnd() * 260;
    foamData.push({ z, x: riverCenterX(z) + (rnd() * 5 - 2.5), s: 0.7 + rnd() * 0.8 });
  }
  group.add(foam);

  // ---- Tekstur prosedural bangunan (Lane E, 27 Nov 2026): detail via
  // tekstur canvas, BUKAN geometri berat — tekstur sendiri 0 draw call
  // tambahan. Semua digambar terang (mendekati putih) supaya warna material
  // mat(color) tetap menentukan hue lewat perkalian map. RNG sendiri
  // (trnd) supaya aliran rnd() tata letak dunia TIDAK bergeser.
  let _tseed = 20261127;
  const trnd = () => (_tseed = (_tseed * 1664525 + 1013904223) >>> 0) / 4294967296;
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  // Plester dinding: krem terang + bintik halus + retak tipis samar.
  const texPlaster = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#fbf4e4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = trnd();
      g.fillStyle = v > 0.5 ? 'rgba(190,170,140,0.16)' : 'rgba(255,255,255,0.20)';
      g.fillRect(trnd() * w, trnd() * h, 1 + trnd() * 2, 1 + trnd() * 2);
    }
    g.strokeStyle = 'rgba(150,130,105,0.18)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      let x = trnd() * w, y = trnd() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (trnd() - 0.5) * 40; y += (trnd() - 0.5) * 40; g.lineTo(x, y); }
      g.stroke();
    }
  });
  // Kayu papan: papan vertikal + serat + sambungan.
  const texWood = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#efe0c0'; g.fillRect(0, 0, w, h);
    for (let p = 0; p < 8; p++) {
      const x0 = p * 32;
      g.fillStyle = `rgba(120,90,50,${0.05 + trnd() * 0.08})`;
      g.fillRect(x0, 0, 32, h);
      g.fillStyle = 'rgba(90,60,30,0.55)'; g.fillRect(x0, 0, 2, h);
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = `rgba(120,85,45,${0.12 + trnd() * 0.15})`; g.lineWidth = 1;
        g.beginPath();
        const gx = x0 + 4 + trnd() * 24;
        g.moveTo(gx, 0);
        g.bezierCurveTo(gx + (trnd() - 0.5) * 8, h * 0.33, gx + (trnd() - 0.5) * 8, h * 0.66, gx, h);
        g.stroke();
      }
    }
  });
  // Genteng: baris-baris genteng melengkung (bayangan bawah tiap baris).
  const texRoofTile = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#fdf6ee'; g.fillRect(0, 0, w, h);
    const rows = 8, cols = 8, rh = h / rows, cw = w / cols;
    for (let r = 0; r < rows; r++) {
      for (let cix = 0; cix < cols; cix++) {
        const x = cix * cw + (r % 2 ? cw / 2 : 0), y = r * rh;
        const shade = 0.82 + trnd() * 0.16;
        g.fillStyle = `rgb(${Math.round(255 * shade)},${Math.round(240 * shade)},${Math.round(225 * shade)})`;
        g.beginPath();
        g.arc(x + cw / 2, y + rh * 0.4, cw * 0.52, Math.PI, 0);
        g.fill();
        g.fillStyle = 'rgba(120,70,40,0.35)';
        g.fillRect(x, y + rh - 3, cw, 3);
      }
    }
  });
  // Bata: susunan bata + mortar.
  const texBrick = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ddd5c4'; g.fillRect(0, 0, w, h);
    const rows = 8, bh = h / rows, bw = 64;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw / 2;
      for (let x = -bw; x < w + bw; x += bw) {
        const shade = 0.78 + trnd() * 0.2;
        g.fillStyle = `rgb(${Math.round(250 * shade)},${Math.round(238 * shade)},${Math.round(222 * shade)})`;
        g.fillRect(x + off + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
  });
  // Batu: blok batu tak beraturan + mortar gelap.
  const texStone = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b9b2a2'; g.fillRect(0, 0, w, h);
    const rows = 5, bh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * -20;
      while (x < w) {
        const bw = 40 + trnd() * 40;
        const shade = 0.8 + trnd() * 0.18;
        g.fillStyle = `rgb(${Math.round(235 * shade)},${Math.round(228 * shade)},${Math.round(212 * shade)})`;
        g.beginPath();
        g.roundRect(x + 2, r * bh + 2, bw - 4, bh - 4, 6);
        g.fill();
        x += bw;
      }
    }
  });
  // Jerami: serat vertikal kuning.
  const texStraw = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f2d878'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      g.strokeStyle = trnd() > 0.5 ? 'rgba(180,140,50,0.35)' : 'rgba(255,240,170,0.4)';
      g.lineWidth = 1;
      const x = trnd() * w;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (trnd() - 0.5) * 10, h); g.stroke();
    }
  });
  // Awning lapak: garis-garis warna + putih (dibuat per warna lapak).
  function texAwning(colorHex) {
    return canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#fff8ec'; g.fillRect(0, 0, w, h);
      g.fillStyle = colorHex;
      for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 16, h);
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, h - 10, w, 10);
    });
  }

  // ---- Jembatan kayu (papan + tiang + tali + tanjakan)
  // Deck 0.65 (0.2 di atas air 0.45) + tanjakan landai di kedua ujung yang
  // menyambung ke terrain tepi — sinkron dengan bridgeHeight() di physics.js
  // (pijakan pemain = permukaan papan). Dulu deck y=1.0 tanpa tanjakan.
  const bridge = new THREE.Group();
  const plankMat = mat(0x9a6b3f, { map: texWood }), postMat = mat(0x6e4a26, { map: texWood });
  for (let i = 0; i < 9; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 1.5), plankMat);
    plank.position.set(-24 + (i - 4) * 1.55, BRIDGE_DECK_Y - 0.09, BRIDGE_Z);
    plank.castShadow = true; bridge.add(plank);
  }
  // Tanjakan: papan miring dari deck ke terrain tepi (kemiringan ~0.2).
  const bankW = terrainHeight(BRIDGE_DECK_MIN_X - BRIDGE_RAMP_LEN, BRIDGE_Z);
  const bankE = terrainHeight(BRIDGE_DECK_MAX_X + BRIDGE_RAMP_LEN, BRIDGE_Z);
  const rampLen = Math.hypot(BRIDGE_RAMP_LEN, BRIDGE_DECK_Y - bankW) + 0.3;
  for (const [cx, bank, sgn] of [
    [BRIDGE_DECK_MIN_X - BRIDGE_RAMP_LEN / 2, bankW, 1],   // barat, naik ke timur
    [BRIDGE_DECK_MAX_X + BRIDGE_RAMP_LEN / 2, bankE, -1],  // timur, naik ke barat
  ]) {
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.12, BRIDGE_WALK_HALF * 2 + 0.2), plankMat);
    ramp.position.set(cx, (bank + BRIDGE_DECK_Y) / 2, BRIDGE_Z);
    ramp.rotation.z = sgn * Math.atan2(BRIDGE_DECK_Y - bank, BRIDGE_RAMP_LEN);
    ramp.castShadow = true; bridge.add(ramp);
  }
  // Tiang + tali di tepi papan (z = BRIDGE_Z ± 1.0, tepat di luar papan 1.5).
  for (const [px, pz] of [[-30.5, BRIDGE_Z - 1], [-30.5, BRIDGE_Z + 1], [-17.5, BRIDGE_Z - 1], [-17.5, BRIDGE_Z + 1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.6, 6), postMat);
    post.position.set(px, BRIDGE_DECK_Y + 0.8, pz); bridge.add(post);
  }
  for (const pz of [BRIDGE_Z - 1, BRIDGE_Z + 1]) {
    for (const py of [BRIDGE_DECK_Y + 0.5, BRIDGE_DECK_Y + 0.9]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 13, 5), postMat);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(-24, py, pz); bridge.add(rail);
    }
  }
  group.add(bridge);

  // ---- Rumah pemain (dinding krem, atap limas coklat, pintu, jendela, cerobong)
  // Dinding dibangun 4 panel terpisah (bukan 1 box) supaya show() kamar bisa
  // menyembunyikan dinding depan saja; DoubleSide agar interior terlihat.
  const house = new THREE.Group();
  const hx = (HOUSE.minX + HOUSE.maxX) / 2, hz = (HOUSE.minZ + HOUSE.maxZ) / 2;
  const hy = terrainHeight(hx, hz);
  const wallMat = mat(0xf3e3c0, { side: THREE.DoubleSide, map: texPlaster });
  const WALL_H = 3.4, WALL_T = 0.3;
  function wallPanel(w, d, px, pz) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
    m.position.set(px, hy + WALL_H / 2, pz);
    m.castShadow = true; m.receiveShadow = true;

    house.add(m);
    return m;
  }
  wallPanel(8, WALL_T, hx, hz - 3 + WALL_T / 2);            // belakang
  wallPanel(WALL_T, 6 - 2 * WALL_T, hx - 4 + WALL_T / 2, hz); // kiri
  wallPanel(WALL_T, 6 - 2 * WALL_T, hx + 4 - WALL_T / 2, hz); // kanan
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.6, 4), mat(0x9a4a2f, { map: texRoofTile }));
  roof.position.set(hx, hy + 4.7, hz); roof.rotation.y = Math.PI / 4; roof.castShadow = true;

  house.add(roof);
  // Bagian depan (dinding depan + pintu + jendela + tangga): satu grup supaya
  // show() kamar bisa menyembunyikannya sekaligus saat interior tampil.
  const houseFront = new THREE.Group();
  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(8, WALL_H, WALL_T), wallMat);
  frontWall.position.set(hx, hy + WALL_H / 2, hz + 3 - WALL_T / 2);
  frontWall.castShadow = true; frontWall.receiveShadow = true;

  houseFront.add(frontWall);
  // Kusen pintu + daun pintu berpanel + gagang kuningan (posisi/ukuran pintu tetap).
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.45, 0.1), mat(0x4a3419, { map: texWood }));
  doorFrame.position.set(hx, hy + 1.22, hz + 3.02); houseFront.add(doorFrame);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.2), mat(0x6e4a26, { map: texWood }));
  door.position.set(hx, hy + 1.1, hz + 3.05); houseFront.add(door);
  for (const py of [hy + 0.75, hy + 1.55]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.04), mat(0x5a3d24));
    panel.position.set(hx, py, hz + 3.17); houseFront.add(panel);
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(0xd9a441, { roughness: 0.35, metalness: 0.6 }));
  knob.position.set(hx + 0.45, hy + 1.05, hz + 3.18); houseFront.add(knob);
  // Jendela menyala hangat — emissive dinaikkan saat senja/malam di update().
  // winMat dipakai bersama semua rumah desa + kincir, jadi ikut menyala juga.
  const winMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xff9a3c, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0 });
  for (const wx of [hx - 2.4, hx + 2.4]) {
    // Kusen jendela kayu di belakang kaca (winMat tetap — ikut menyala malam).
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.35, 0.08), mat(0x4a3419, { map: texWood }));
    winFrame.position.set(wx, hy + 1.9, hz + 3.02); houseFront.add(winFrame);
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.15), winMat);
    win.position.set(wx, hy + 1.9, hz + 3.05); houseFront.add(win);
    // Daun jendela kayu + palang tengah.
    for (const s of [-1, 1]) {
      const shut = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.08), mat(0x6e4a26));
      shut.position.set(wx + s * 0.8, hy + 1.9, hz + 3.05); houseFront.add(shut);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.05), mat(0x6e4a26));
    cross.position.set(wx, hy + 1.9, hz + 3.14); houseFront.add(cross);
  }
  // Anak tangga batu di depan pintu.
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 0.9), mat(0x8d8578, { map: texStone }));
  step.position.set(hx, hy + 0.12, hz + 3.4); step.receiveShadow = true; houseFront.add(step);
  house.add(houseFront);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), mat(0x8d8578, { map: texBrick }));
  chimney.position.set(hx + 2.2, hy + 5.2, hz - 1); house.add(chimney);
  // Lampu teras (menyala saat malam)
  const lamp = new THREE.PointLight(0xffc46b, 0, 14, 1.6);
  lamp.position.set(hx, hy + 2.6, hz + 3.6);
  house.add(lamp);
  const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
    mat(0xffe9a8, { emissive: 0xffb340 }));
  lampBulb.position.copy(lamp.position); house.add(lampBulb);
  group.add(house);
  colliders.push({ ...HOUSE });
  const doorPos = { x: hx, z: hz + 3.6 };

  // ---- Interior kamar tidur (kontrak lane tidur gelombang 2): grup terpisah,
  // hidden secara default; show(true) menampilkan interior + menyembunyikan
  // atap & dinding depan supaya kamera tidak terhalang.
  const bedroomGroup = new THREE.Group();
  bedroomGroup.visible = false;
  const BED_POS = { x: -1.6, z: -24.3 };
  const DOOR_IN_POS = { x: 1, z: -20.3 };
  {
    const fl = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.15, 5.4), mat(0x9a6b3f));
    fl.position.set(hx, hy + 0.08, hz); fl.receiveShadow = true; bedroomGroup.add(fl);
    const rug = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.04, 1.8), mat(0xb03a2e));
    rug.position.set(hx + 0.8, hy + 0.18, hz + 0.8); bedroomGroup.add(rug);
    // Kasur: rangka kayu + matras krem + bantal + selimut hijau daun.
    const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 2.3), mat(0x6e4a26));
    bedFrame.position.set(BED_POS.x, hy + 0.33, BED_POS.z); bedFrame.castShadow = true; bedroomGroup.add(bedFrame);
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 2.2), mat(0xfff8dc));
    mattress.position.set(BED_POS.x, hy + 0.6, BED_POS.z); bedroomGroup.add(mattress);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.5), mat(0xf5f2e8));
    pillow.position.set(BED_POS.x, hy + 0.75, BED_POS.z - 0.85); bedroomGroup.add(pillow);
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.12, 1.4), mat(0x2e7d32));
    blanket.position.set(BED_POS.x, hy + 0.72, BED_POS.z + 0.35); bedroomGroup.add(blanket);
    // Meja kecil + lilin menyala di atasnya.
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.8), mat(0x8a6b3f));
    tableTop.position.set(3.2, hy + 0.75, -24.5); tableTop.castShadow = true; bedroomGroup.add(tableTop);
    for (const [lx, lz] of [[2.7, -24.8], [3.7, -24.8], [2.7, -24.2], [3.7, -24.2]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), mat(0x6e4a26));
      leg.position.set(lx, hy + 0.45, lz); bedroomGroup.add(leg);
    }
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.25, 6), mat(0xf5f2e8));
    candle.position.set(3.0, hy + 0.92, -24.6); bedroomGroup.add(candle);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6),
      mat(0xffd27a, { emissive: 0xff9a3c, emissiveIntensity: 1.5 }));
    flame.position.set(3.0, hy + 1.08, -24.6); bedroomGroup.add(flame);
    // Jendela interior (dinding belakang, pakai winMat yang sama — ikut menyala malam).
    const winIn = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.08), winMat);
    winIn.position.set(2.5, hy + 1.9, hz - 2.66); bedroomGroup.add(winIn);
    // Lukisan berbingkai di dinding barat — dinding itu yang memenuhi frame
    // kamera tidur, jadi butuh satu titik fokus selain kasur.
    const framePic = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 1.5), mat(0x6e4a26));
    framePic.position.set(-2.6, hy + 1.9, -23.5); bedroomGroup.add(framePic);
    const canvasPic = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 1.3), mat(0xfff8dc));
    canvasPic.position.set(-2.55, hy + 1.9, -23.5); bedroomGroup.add(canvasPic);
    const sunPic = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), mat(0xffb340));
    sunPic.position.set(-2.52, hy + 2.05, -23.5); sunPic.rotation.y = Math.PI / 2; bedroomGroup.add(sunPic);
    // Peti kayu di dekat pintu.
    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.7), mat(0x8a6b3f));
    chest.position.set(3.4, hy + 0.5, -20.5); chest.castShadow = true; bedroomGroup.add(chest);
    const chestLid = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.15, 0.74), mat(0x6e4a26));
    chestLid.position.set(3.4, hy + 0.9, -20.5); bedroomGroup.add(chestLid);
  }
  group.add(bedroomGroup);
  const bedroom = {
    group: bedroomGroup,
    bed: { ...BED_POS },
    doorIn: { ...DOOR_IN_POS },
    show(v) {
      bedroomGroup.visible = !!v;
      roof.visible = !v;
      houseFront.visible = !v;
    },
  };

  // ---- Kios toko (atap merah, meja, papan nama)
  const shop = new THREE.Group();
  const sx = (SHOP.minX + SHOP.maxX) / 2, sz = (SHOP.minZ + SHOP.maxZ) / 2;
  const sy = terrainHeight(sx, sz);
  const stall = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 4), mat(0xd8b36a, { map: texWood }));
  stall.position.set(sx, sy + 1.2, sz); stall.castShadow = true; shop.add(stall);
  const shopRoof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.8, 4), mat(0xb03a2e, { map: texRoofTile }));
  shopRoof.position.set(sx, sy + 3.3, sz); shopRoof.rotation.y = Math.PI / 4; shop.add(shopRoof);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 0.8), mat(0x6e4a26, { map: texWood }));
  counter.position.set(sx, sy + 0.5, sz + 2.4); shop.add(counter);
  // Papan nama toko (tekstur canvas prosedural "TOKO") di depan, di bawah atap.
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256; signCanvas.height = 64;
  const sg = signCanvas.getContext('2d');
  sg.fillStyle = '#8a6b3f'; sg.fillRect(0, 0, 256, 64);
  sg.strokeStyle = '#fff8dc'; sg.lineWidth = 4; sg.strokeRect(4, 4, 248, 56);
  sg.fillStyle = '#fff8dc'; sg.font = 'bold 40px "Trebuchet MS", "Arial Rounded MT Bold", sans-serif';
  sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillText('TOKO', 128, 34);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 0.12),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(signCanvas), roughness: 0.85, metalness: 0 }));
  sign.position.set(sx, sy + 2.55, sz + 2.12); shop.add(sign);
  // Keranjang hasil panen di depan kios (di luar collider SHOP, tanpa collider).
  for (const [bx, cols] of [[sx - 2.4, [0xe87a2a, 0xd9382b]], [sx + 2.4, [0x9ccb5e, 0xe8912a]]]) {
    const bz = sz + 3.4;
    const by = terrainHeight(bx, bz);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.5, 8), mat(0xa97c50, { map: texWood }));
    basket.position.set(bx, by + 0.25, bz); basket.castShadow = true; shop.add(basket);
    cols.forEach((cc, k) => {
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat(cc));
      fruit.position.set(bx + (k - 0.5) * 0.35, by + 0.55, bz + (k ? 0.15 : -0.15));
      shop.add(fruit);
    });
  }
  group.add(shop);
  colliders.push({ ...SHOP });
  const shopPos = { x: sx, z: sz + 3.6 };

  // ---- Desa kecil: 6 rumah lagi di sekitar alun-alun (variasi dinding/atap/
  // ukuran/cerobong/taman; jendela pakai winMat yang sama -> ikut menyala malam).
  // Rumah pemain tetap satu-satunya yang bisa dimasuki; pintu rumah ini dekoratif.
  function makeHouse(h) {
    const g = new THREE.Group();
    const y = terrainHeight(h.x, h.z);
    const wallH = 3.0 + (h.w - 5) * 0.2;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(h.w, wallH, h.d), mat(h.wall, { map: texPlaster }));
    walls.position.set(0, y + wallH / 2, 0); walls.castShadow = true; walls.receiveShadow = true;

    g.add(walls);
    if (h.roofType === 'pyramid') {
      const r = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(h.w, h.d) / 2 * 0.95, 2.2, 4), mat(h.roof, { map: texRoofTile }));
      r.position.set(0, y + wallH + 1.1, 0); r.rotation.y = Math.PI / 4; r.castShadow = true; g.add(r);
    } else if (h.roofType === 'cone') {
      const r = new THREE.Mesh(new THREE.ConeGeometry(h.w * 0.62, 2.4, 8), mat(h.roof, { map: texRoofTile }));
      r.position.set(0, y + wallH + 1.2, 0); r.castShadow = true; g.add(r);
    } else { // gable (pelana): dua papan miring bertemu di bubungan
      const rise = h.d * 0.3;
      const half = h.d / 2 + 0.3;
      const slabLen = Math.hypot(half, rise) + 0.3;
      const ang = Math.atan2(rise, half);
      for (const s of [1, -1]) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(h.w + 0.8, 0.15, slabLen), mat(h.roof, { map: texRoofTile }));
        slab.position.set(0, y + wallH + rise / 2, s * (h.d / 4 + 0.12));
        slab.rotation.x = s * ang; slab.castShadow = true; g.add(slab);
      }
    }
    // Kusen pintu + daun pintu berpanel (posisi/ukuran pintu tetap).
    const dFrame = new THREE.Mesh(new THREE.BoxGeometry(1.55, 2.3, 0.08), mat(0x4a3419, { map: texWood }));
    dFrame.position.set(0, y + 1.15, h.d / 2 + 0.03); g.add(dFrame);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.15), mat(0x6e4a26, { map: texWood }));
    door.position.set(0, y + 1.05, h.d / 2 + 0.05); g.add(door);
    const dPanel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.04), mat(0x5a3d24));
    dPanel.position.set(0, y + 1.45, h.d / 2 + 0.14); g.add(dPanel);
    for (const wx of [-h.w / 4, h.w / 4]) {
      // Kusen jendela kayu (winMat tetap — ikut menyala malam).
      const wFrame = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.15, 0.07), mat(0x4a3419, { map: texWood }));
      wFrame.position.set(wx, y + 1.8, h.d / 2 + 0.03); g.add(wFrame);
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.12), winMat);
      win.position.set(wx, y + 1.8, h.d / 2 + 0.05); g.add(win);
    }
    if (h.chimney) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7), mat(0x8d8578, { map: texBrick }));
      ch.position.set(h.w / 4, y + wallH + 1.5, -h.d / 4); g.add(ch);
    }
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 0.8), mat(0x8d8578, { map: texStone }));
    step.position.set(0, y + 0.11, h.d / 2 + 0.45); step.receiveShadow = true; g.add(step);
    if (h.garden) { // taman depan: 2 semak + 2 bunga di depan pintu
      for (const bx of [-1.4, 1.4]) {
        const bush = new THREE.Mesh(new THREE.SphereGeometry(0.5, 7, 5), mat(0x4a8f3c));
        bush.position.set(bx, y + 0.3, h.d / 2 + 1.8); bush.castShadow = true; g.add(bush);
      }
      for (const [fx, fc] of [[-0.5, 0xe8a0b8], [0.7, 0xf2d06b]]) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), mat(fc));
        fl.position.set(fx, y + 0.35, h.d / 2 + 1.4); g.add(fl);
      }
    }
    g.rotation.y = h.rotY;
    g.position.set(h.x, 0, h.z);
    group.add(g);
    colliders.push(houseFootprint(h));
  }
  for (const h of NEW_HOUSES) makeHouse(h);

  // ---- Alun-alun desa: sumur batu beratap + 2 bangku kayu menghadap sumur.
  const wellY = terrainHeight(SQUARE.x, SQUARE.z);
  const well = new THREE.Group();
  const wellBase = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 1.0, 8), mat(0x8d8578, { map: texStone }));
  wellBase.position.y = 0.5; wellBase.castShadow = true; well.add(wellBase);
  const wellDark = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.12, 8), mat(0x2b2118));
  wellDark.position.y = 1.02; well.add(wellDark);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.4, 6), mat(0x6e4a26, { map: texWood }));
    post.position.set(s * 0.95, 1.2, 0); well.add(post);
  }
  // Palang kayu + tali + ember (detail hidup; collider sumur tidak berubah).
  const wellBar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.0, 6), mat(0x6e4a26, { map: texWood }));
  wellBar.rotation.z = Math.PI / 2; wellBar.position.y = 2.3; well.add(wellBar);
  const wellRope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5), mat(0xb59a6e));
  wellRope.position.y = 1.85; well.add(wellRope);
  const wellBucket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.3, 8), mat(0x8a6b3f, { map: texWood }));
  wellBucket.position.y = 1.3; wellBucket.castShadow = true; well.add(wellBucket);
  const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.0, 4), mat(0x8a4a2f, { map: texRoofTile }));
  wellRoof.position.y = 2.9; wellRoof.rotation.y = Math.PI / 4; wellRoof.castShadow = true; well.add(wellRoof);
  well.position.set(SQUARE.x, wellY, SQUARE.z);
  group.add(well);
  colliders.push({ minX: SQUARE.x - 1.2, maxX: SQUARE.x + 1.2, minZ: SQUARE.z - 1.2, maxZ: SQUARE.z + 1.2 });
  for (const [bx, bz, ry] of [[12.5, -27.5, Math.PI * 0.75], [19.5, -34.5, -Math.PI * 0.25]]) {
    const by = terrainHeight(bx, bz);
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.5), mat(0x8a6b3f, { map: texWood }));
    seat.position.y = 0.55; seat.castShadow = true; bench.add(seat);
    for (const s of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.45), mat(0x6e4a26));
      leg.position.set(s, 0.25, 0); bench.add(leg);
    }
    bench.position.set(bx, by, bz); bench.rotation.y = ry;
    group.add(bench);
    colliders.push({ minX: bx - 1, maxX: bx + 1, minZ: bz - 0.4, maxZ: bz + 0.4 });
  }

  // ---- Danau kedua + dermaga kayu (timur laut). Air dangkal, dasar pasir terlihat.
  // Lane C: material diekstrak (lakeWaterMat) supaya tint langit bisa
  // di-update per frame seperti sungai; roughness 0.08 = kilau matahari.
  const lakeWaterMat = new THREE.MeshStandardMaterial({ color: 0x3fa9f5, transparent: true, opacity: 0.7,
    roughness: 0.08, metalness: 0 });
  const lakeWater = new THREE.Mesh(new THREE.CircleGeometry(1, 28), lakeWaterMat);
  lakeWater.geometry.rotateX(-Math.PI / 2);
  lakeWater.scale.set(LAKE.rx, 1, LAKE.rz);
  lakeWater.position.set(LAKE.x, 0.05, LAKE.z);
  group.add(lakeWater);
  const pier = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 1.6), mat(0x9a6b3f, { map: texWood }));
    plank.position.set(45.5 + i * 1.35, 0.62, -58); plank.castShadow = true; pier.add(plank);
  }
  for (const [px, pz] of [[45.5, -58.75], [45.5, -57.25], [52.25, -58.75], [52.25, -57.25]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.3, 6), mat(0x6e4a26));
    post.position.set(px, 0.35, pz); pier.add(post);
  }
  group.add(pier);
  colliders.push({ minX: 44.8, maxX: 53, minZ: -59, maxZ: -57 });

  // ---- Bukit kincir angin (barat daya): menara batu + baling-baling berputar.
  const windmillY = terrainHeight(WINDMILL.x, WINDMILL.z);
  const windmill = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 9, 8), mat(0xd8c9a8, { map: texStone }));
  tower.position.y = 4.5; tower.castShadow = true; windmill.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.0, 8), mat(0x8a4a2f, { map: texRoofTile }));
  cap.position.y = 10; cap.castShadow = true; windmill.add(cap);
  const wmDoorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.25, 0.08), mat(0x4a3419, { map: texWood }));
  wmDoorFrame.position.set(0, 1.12, 2.06); windmill.add(wmDoorFrame);
  const wmDoor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.15), mat(0x6e4a26, { map: texWood }));
  wmDoor.position.set(0, 1.0, 2.1); windmill.add(wmDoor);
  const wmWinFrame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 0.07), mat(0x4a3419, { map: texWood }));
  wmWinFrame.position.set(0, 6.5, 1.56); windmill.add(wmWinFrame);
  const wmWin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.12), winMat);
  wmWin.position.set(0, 6.5, 1.6); windmill.add(wmWin);
  const windmillRotor = new THREE.Group();
  windmillRotor.position.set(0, 8.6, 2.0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 8), mat(0x6e4a26));
  hub.rotation.x = Math.PI / 2; windmillRotor.add(hub);
  for (let k = 0; k < 4; k++) {
    const pivot = new THREE.Object3D();
    pivot.rotation.z = k * Math.PI / 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.2, 0.07), mat(0xf3e3c0, { map: texWood }));
    blade.position.y = 2.35; blade.castShadow = true; pivot.add(blade);
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.07), mat(0x8a6b3f));
    slat.position.y = 2.35; pivot.add(slat);
    windmillRotor.add(pivot);
  }
  windmill.add(windmillRotor);
  windmill.position.set(WINDMILL.x, windmillY, WINDMILL.z);
  group.add(windmill);
  colliders.push({ minX: WINDMILL.x - 2.5, maxX: WINDMILL.x + 2.5, minZ: WINDMILL.z - 2.5, maxZ: WINDMILL.z + 2.5 });

  // ---- Kandang ternak berpagar (tiang + rel, ada celah pintu di sisi timur)
  const penGroup = new THREE.Group();
  const fenceMat = mat(0x8a6b3f, { map: texWood });
  function fenceRun(x1, z1, x2, z2, gapAt = null) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(2, Math.round(len / 2));
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const px = x1 + (x2 - x1) * k, pz = z1 + (z2 - z1) * k;
      if (gapAt && Math.abs(px - gapAt.x) < 1.4 && Math.abs(pz - gapAt.z) < 1.4) continue;
      const py = terrainHeight(px, pz);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.3, 6), fenceMat);
      post.position.set(px, py + 0.65, pz); post.castShadow = true; penGroup.add(post);
    }
    // Dua rel memanjang.
    const midX = (x1 + x2) / 2, midZ = (z1 + z2) / 2;
    const ang = Math.atan2(x2 - x1, z2 - z1);
    for (const ry of [0.5, 1.0]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), fenceMat);
      rail.position.set(midX, terrainHeight(midX, midZ) + ry, midZ);
      rail.rotation.y = ang; penGroup.add(rail);
    }
    colliders.push({ minX: Math.min(x1, x2) - 0.25, maxX: Math.max(x1, x2) + 0.25,
                     minZ: Math.min(z1, z2) - 0.25, maxZ: Math.max(z1, z2) + 0.25 });
  }
  // Sisi utara/selatan/barat penuh; sisi timur bercelah pintu (gap di tengah).
  fenceRun(PEN.minX, PEN.minZ, PEN.maxX, PEN.minZ);
  fenceRun(PEN.minX, PEN.maxZ, PEN.maxX, PEN.maxZ);
  fenceRun(PEN.minX, PEN.minZ, PEN.minX, PEN.maxZ);
  fenceRun(PEN.maxX, PEN.minZ, PEN.maxX, (PEN.minZ + PEN.maxZ) / 2 - 1.2);
  fenceRun(PEN.maxX, (PEN.minZ + PEN.maxZ) / 2 + 1.2, PEN.maxX, PEN.maxZ);
  group.add(penGroup);
  const penGate = { x: PEN.maxX, z: (PEN.minZ + PEN.maxZ) / 2 };
  // Tumpukan jerami di luar pagar kandang (barat-daya, tanpa collider).
  const hay = new THREE.Group();
  const hayX = PEN.minX - 2.2, hayZ = PEN.maxZ + 1.6;
  const hayY = terrainHeight(hayX, hayZ);
  const hayBase = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.9, 8), mat(0xd9a441, { map: texStraw }));
  hayBase.position.y = 0.45; hayBase.castShadow = true; hay.add(hayBase);
  const hayTop = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.4, 8), mat(0xe8b84a, { map: texStraw }));
  hayTop.position.y = 1.55; hayTop.castShadow = true; hay.add(hayTop);
  hay.position.set(hayX, hayY, hayZ);
  group.add(hay);

  // ---- Pagar kebun (pembatas petak, rendah)
  const farmFence = new THREE.Group();
  const fx0 = FARM_ORIGIN.x - 2, fx1 = FARM_ORIGIN.x + (FARM_COLS - 1) * FARM_SPACING + 2;
  const fz0 = FARM_ORIGIN.z - 2, fz1 = FARM_ORIGIN.z + (FARM_ROWS - 1) * FARM_SPACING + 2;
  for (const [ax, az, bx, bz] of [[fx0, fz0, fx1, fz0], [fx0, fz1, fx1, fz1], [fx0, fz0, fx0, fz1]]) {
    const len = Math.hypot(bx - ax, bz - az);
    const midX = (ax + bx) / 2, midZ = (az + bz) / 2;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len), fenceMat);
    rail.position.set(midX, terrainHeight(midX, midZ) + 0.45, midZ);
    rail.rotation.y = Math.atan2(bx - ax, bz - az); farmFence.add(rail);
    colliders.push({ minX: Math.min(ax, bx) - 0.2, maxX: Math.max(ax, bx) + 0.2,
                     minZ: Math.min(az, bz) - 0.2, maxZ: Math.max(az, bz) + 0.2 });
  }
  group.add(farmFence);

  // ---- Lane D (27 Nov 2026): helper vegetasi realistis.
  // hash01() = variasi deterministik dari indeks (BUKAN rnd()) supaya
  // bentuk tajuk/batang bervariasi TANPA menggeser aliran rnd() — posisi
  // pohon/batu/semak/bunga/rumput tetap IDENTIK dengan Wave 1.
  function hash01(n) { const h = Math.sin(n * 12.9898) * 43758.5453; return h - Math.floor(h); }
  // jitterGeo() berbasis HASH posisi (bukan indeks vertex) supaya vertex
  // duplikat pada geometri non-indexed (PolyhedronGeometry) tetap menempel
  // — tanpa retak. Dipakai untuk batang/batu/semak/tajuk (siluet tak
  // beraturan). mergeGeoms() menggabung geometri kecil (bunga, rumput)
  // menjadi SATU geometri = tetap 1 draw call per InstancedMesh.
  function jitterGeo(geo, amt) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
      const k = 1 + (h - Math.floor(h) - 0.5) * 2 * amt;
      p.setXYZ(i, x * k, y * k, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  }
  function mergeGeoms(list) {
    let vCount = 0;
    const parts = list.map((g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      vCount += ng.attributes.position.count;
      return ng;
    });
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
      o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return out;
  }
  // Rumpun rumput: 3 helai menyilang (bukan kerucut kartun). Tiap helai =
  // strip meruncing 3 segitiga dengan tekuk ringan; 9 segitiga/tuft
  // (vs 8 kerucut lama — nyaris imbang). Material DoubleSide (lihat bawah).
  function makeTuftGeometry() {
    const pos = [];
    const tri = (a, b, c) => { pos.push(...a, ...b, ...c); };
    for (let b = 0; b < 3; b++) {
      const w = 0.085, h = 0.55, bend = 0.05;
      const a = b * Math.PI / 3 + (b % 2 ? 0.22 : -0.14);
      const ca = Math.cos(a), sa = Math.sin(a);
      // Titik lokal (x = lebar, y = tinggi, z = tekuk), lalu putar sumbu Y.
      const L = (x, y, z) => [x * ca + z * sa, y, -x * sa + z * ca];
      const A = L(-w, 0, 0), B = L(w, 0, 0);
      const C = L(-w * 0.5, 0.30, bend), D = L(w * 0.5, 0.30, bend);
      const E = L(0, h, bend * 1.8);
      tri(A, B, C); tri(B, D, C); tri(C, D, E);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.computeVertexNormals();
    return g;
  }
  // Kepala bunga: pusat kecil + 5 kelopak kerucut pipih mengarah ke luar
  // (70 segitiga vs 60 bola lama — delta ~+2.6k segitiga total).
  function makeFlowerHeadGeometry() {
    const parts = [xlate(new THREE.IcosahedronGeometry(0.05, 0), 0, 0.02, 0)];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const petal = new THREE.ConeGeometry(0.055, 0.13, 5);
      petal.rotateZ(-Math.PI / 2 + 0.35); // ujung kerucut -> +X, miring naik
      petal.rotateY(a);
      petal.scale(1, 0.5, 1); // pipihkan vertikal
      const dx = Math.cos(a) * 0.94, dz = -Math.sin(a) * 0.94;
      petal.translate(dx * 0.075, 0.343 * 0.075 + 0.01, dz * 0.075);
      parts.push(petal);
    }
    return mergeGeoms(parts);
    function xlate(geo, x, y, z) { geo.translate(x, y, z); return geo; }
  }

  // ---- Pohon realistis (instanced): batang bercorak + cabang + tajuk
  // bergerombol + buah. 4 jenis: pinus (kerucut berlapis, tanpa buah), apel
  // (buah merah), jeruk (buah oranye), rindang (tajuk bulat, tanpa buah).
  // Semua penempatan pakai rnd() ber-seed — stabil antar load.
  const TREE_TYPES = ['pine', 'apple', 'orange', 'leafy', 'sakura'];
  const treeSpots = [];
  // Kebun buah: petak 4x4 di (48,48), apel/jeruk berselang.
  for (let gx = 0; gx < 4; gx++) for (let gz = 0; gz < 4; gz++) {
    const x = ORCHARD.x + (gx - 1.5) * 5.5 + (rnd() - 0.5) * 1.6;
    const z = ORCHARD.z + (gz - 1.5) * 5.5 + (rnd() - 0.5) * 1.6;
    treeSpots.push({ x, z, s: 0.9 + rnd() * 0.35, type: (gx + gz) % 2 === 0 ? 'apple' : 'orange' });
  }
  let guard = 0;
  while (treeSpots.length < 84 && guard++ < 1500) { // COZY-B: 72 -> 84, lebih rimbun
    const x = (rnd() - 0.5) * 230, z = (rnd() - 0.5) * 230;
    const r = Math.hypot(x, z);
    if (r > 112 || r < 8) continue;
    if (Math.hypot(x - 6, z - 20) < 10) continue;               // area spawn pembuka — kamera awal harus bersih
    if (x > -6 && x < 18 && z > 20 && z < 36) continue;         // koridor kamera selatan spawn — pohon di sini menutupi pemain
    if (Math.abs(x - riverCenterX(z)) < 7) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;             // kebun
    if (x > PEN.minX - 3 && x < PEN.maxX + 3 && z > PEN.minZ - 3 && z < PEN.maxZ + 3) continue;
    if (x > -14 && x < 8 && z > -28 && z < -16) continue;        // rumah + toko
    if (Math.abs(z + 17) < 3 && x > -12 && x < 12) continue;     // jalan
    if (distToPaths(x, z) < 2.6) continue;                       // jalan baru
    const le = ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2;
    if (le < 1.25) continue;                                     // danau
    const me = ((x - MEADOW.x) / MEADOW.rx) ** 2 + ((z - MEADOW.z) / MEADOW.rz) ** 2;
    if (me < 1) continue;                                        // padang bunga tetap terbuka
    if (Math.hypot(x - SQUARE.x, z - SQUARE.z) < 9) continue;    // alun-alun
    if (Math.hypot(x - WINDMILL.x, z - WINDMILL.z) < 7) continue;// bukit kincir
    if (x > ORCHARD.x - 14 && x < ORCHARD.x + 14 && z > ORCHARD.z - 14 && z < ORCHARD.z + 14) continue;
    if (insideHouseFootprints(x, z, 3)) continue;                // rumah desa
    if (inNightMarket(x, z, 2)) continue;                          // pasar malam (Lane P)
    if (treeSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    treeSpots.push({ x, z, s: 0.8 + rnd() * 0.6, type: TREE_TYPES[Math.floor(rnd() * 5)] }); // COZY-B: *5 — sakura ikut tersebar (dulu *4, sakura tidak pernah muncul)
  }
  // COZY-B: rumpun sakura (5 pohon, posisi tetap) di (-34,-44) — juga lokasi
  // tersembunyi 'sakura-grove'. Di luar PATHS + jalur padang bunga (cek manual).
  for (const [gx, gz, gs] of [[0, 0, 1.2], [6, 2, 1.0], [-5, 4, 1.1], [3, -5, 1.05], [-6, -4, 0.95]]) {
    treeSpots.push({ x: -34 + gx, z: -44 + gz, s: gs, type: 'sakura' });
  }
  // Susun daftar instans: batang, cabang (1-3/pohon), gumpalan tajuk (2-4/pohon
  // daun; pinus 2 kerucut), buah (4-7/pohon buah, menempel di tajuk).
  // Lane D: palet natural (dulu hijau neon kartun 0x2fbf4a/0x8fe388) —
  // hijau daun dalam + kuning-hijau, pinus lebih gelap, sakura lebih lembut.
  const barkCols = [0x5a3d24, 0x6e4a26, 0x7d5a33, 0x4a3419].map((c) => new THREE.Color(c));
  const crownA = new THREE.Color(0x3d7a2e), crownB = new THREE.Color(0x7fae4a);
  const pineA = new THREE.Color(0x2c6b34), pineB = new THREE.Color(0x4d8f4a);
  const sakuraCols = [0xf2a0bd, 0xf7c3d4, 0xe87f9f].map((c) => new THREE.Color(c));
  const branchList = [], blobList = [], coneList = [], fruitList = [];
  const UP = new THREE.Vector3(0, 1, 0);
  let fruitTrees = 0;
  treeSpots.forEach((p) => {
    const y = terrainHeight(p.x, p.z);
    p.bark = Math.floor(rnd() * barkCols.length);
    p.thick = 0.85 + rnd() * 0.5;
    const nBr = 1 + Math.floor(rnd() * 3);
    for (let b = 0; b < nBr; b++) {
      branchList.push({ x: p.x, y, s: p.s, thick: p.thick, bark: p.bark,
        h: 1.5 + rnd() * 0.9, az: rnd() * Math.PI * 2, tilt: 0.6 + rnd() * 0.5, len: 0.7 + rnd() * 0.5 });
    }
    const topY = y + 2.2 * p.s;
    if (p.type === 'pine') {
      // Lane D: 3 tingkat kerucut (dulu 2) + offset kecil tiap tingkat
      // supaya siluet pinus tidak simetris sempurna. Offset pakai hash01
      // (bukan rnd) supaya aliran rnd() layout tetap identik Wave 1.
      const cIdx = coneList.length;
      coneList.push({ x: p.x + (hash01(cIdx * 7 + 1) - 0.5) * 0.24 * p.s, y: topY + 0.8 * p.s, z: p.z + (hash01(cIdx * 7 + 2) - 0.5) * 0.24 * p.s, rad: 1.7 * p.s, h: 2.6 * p.s,
        seed: ((coneList.length * 2654435761) >>> 0) / 4294967296, ph: ((coneList.length * 40503) % 628) / 100 });
      coneList.push({ x: p.x + (hash01(cIdx * 7 + 3) - 0.5) * 0.2 * p.s, y: topY + 2.0 * p.s, z: p.z + (hash01(cIdx * 7 + 4) - 0.5) * 0.2 * p.s, rad: 1.2 * p.s, h: 2.2 * p.s,
        seed: ((coneList.length * 2654435761) >>> 0) / 4294967296, ph: ((coneList.length * 40503) % 628) / 100 });
      coneList.push({ x: p.x + (hash01(cIdx * 7 + 5) - 0.5) * 0.16 * p.s, y: topY + 3.0 * p.s, z: p.z + (hash01(cIdx * 7 + 6) - 0.5) * 0.16 * p.s, rad: 0.8 * p.s, h: 1.8 * p.s,
        seed: ((coneList.length * 2654435761) >>> 0) / 4294967296, ph: ((coneList.length * 40503) % 628) / 100 });
    } else {
      // Lane D: tajuk BERLAPIS — blob ke-0 = mahkota atas (lebih kecil,
      // lebih tinggi), sisanya cincin bawah yang lebih lebar; tiap blob
      // punya pipih (sy) + lebar (sx/sz) + rotasi sendiri, jadi tidak ada
      // dua pohon yang tajuknya identik.
      const nBl = 2 + Math.floor(rnd() * 3);
      const blobs = [];
      for (let b = 0; b < nBl; b++) {
        const a = rnd() * Math.PI * 2;
        const isTop = b === 0;
        const rr = isTop ? rnd() * 0.4 * p.s : (0.5 + rnd() * 0.5) * p.s;
        const bIdx = blobList.length; // hash01: variasi bentuk tanpa geser rnd()
        const bl = { x: p.x + Math.cos(a) * rr,
          y: isTop ? topY + 1.15 * p.s + (rnd() - 0.5) * 0.3 * p.s : topY + 0.45 * p.s + (rnd() - 0.5) * 0.8 * p.s,
          z: p.z + Math.sin(a) * rr, s: (isTop ? 0.95 + rnd() * 0.4 : 1.1 + rnd() * 0.6) * p.s,
          sx: 0.9 + hash01(bIdx * 5 + 1) * 0.3, sy: 0.7 + hash01(bIdx * 5 + 2) * 0.25, sz: 0.9 + hash01(bIdx * 5 + 3) * 0.3,
          rotY: hash01(bIdx * 5 + 4) * Math.PI * 2,
          type: p.type,
          // COZY-B: seed + fase deterministik (hash indeks, BUKAN rnd() —
          // dipakai recolor musim + goyang tajuk tanpa menggeser layout).
          seed: ((blobList.length * 2654435761) >>> 0) / 4294967296,
          ph: ((blobList.length * 40503) % 628) / 100,
          // Sakura: kanopi pink berlapis (3 tone); lainnya hijau terang.
          c: p.type === 'sakura'
            ? sakuraCols[Math.floor(rnd() * sakuraCols.length)].clone()
            : crownA.clone().lerp(crownB, rnd()) };
        blobs.push(bl); blobList.push(bl);
      }
      if (p.type === 'apple' || p.type === 'orange') {
        fruitTrees += 1;
        const fc = p.type === 'apple' ? 0xd9382b : 0xe87a2a;
        const nFr = 4 + Math.floor(rnd() * 4);
        for (let k = 0; k < nFr; k++) {
          const bl = blobs[Math.floor(rnd() * blobs.length)];
          const a = rnd() * Math.PI * 2;
          fruitList.push({ x: bl.x + Math.cos(a) * bl.s * 0.75,
            y: bl.y + (rnd() - 0.6) * bl.s * 0.5,
            z: bl.z + Math.sin(a) * bl.s * 0.75, c: fc });
        }
      }
    }
  });
  // Lane D: batang bertekstur (jitter permukaan silinder) + tajuk/batang
  // flatShading (faset natural, bukan bola halus kartun). Jumlah
  // InstancedMesh TETAP 5 — tidak ada draw call baru.
  const trunkGeo = jitterGeo(new THREE.CylinderGeometry(0.22, 0.34, 2.2, 6), 0.12);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0xffffff), treeSpots.length);
  const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.09, 1, 5),
    mat(0xffffff), branchList.length);
  const crownBlobs = new THREE.InstancedMesh(jitterGeo(new THREE.IcosahedronGeometry(1, 0), 0.18),
    mat(0xffffff, { flatShading: true }), blobList.length);
  const pineCones = new THREE.InstancedMesh(jitterGeo(new THREE.ConeGeometry(1, 1, 7), 0.1),
    mat(0xffffff, { flatShading: true }), coneList.length);
  const fruits = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 6, 5),
    mat(0xffffff), Math.max(1, fruitList.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  const _fr = (v) => v - Math.floor(v); // fract deterministik
  treeSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    // Lane D: batang sedikit miring acak (alami) — dari hash indeks supaya
    // stabil antar load dan tidak menggeser rnd() layout.
    _q.setFromEuler(new THREE.Euler((_fr(Math.sin(i * 12.9898) * 43758.5453) - 0.5) * 0.09,
      0, (_fr(Math.sin(i * 78.233) * 12543.21) - 0.5) * 0.09));
    m4.compose(new THREE.Vector3(p.x, y + 1.1 * p.s, p.z), _q,
      new THREE.Vector3(p.thick * p.s, p.s, p.thick * p.s));
    trunks.setMatrixAt(i, m4);
    trunks.setColorAt(i, barkCols[p.bark]);
    colliders.push({ minX: p.x - 0.4, maxX: p.x + 0.4, minZ: p.z - 0.4, maxZ: p.z + 0.4 });
  });
  _q.identity();
  trunks.instanceColor.needsUpdate = true;
  branchList.forEach((b, i) => {
    const dir = new THREE.Vector3(Math.sin(b.tilt) * Math.cos(b.az), Math.cos(b.tilt), Math.sin(b.tilt) * Math.sin(b.az));
    _q.setFromUnitVectors(UP, dir);
    const bx = b.x + dir.x * b.len * 0.45, by = b.y + b.h * b.s + dir.y * b.len * 0.45, bz = b.z + dir.z * b.len * 0.45;
    m4.compose(new THREE.Vector3(bx, by, bz), _q, new THREE.Vector3(b.thick * b.s, b.len * b.s, b.thick * b.s));
    branches.setMatrixAt(i, m4);
    branches.setColorAt(i, barkCols[b.bark]);
  });
  _q.identity();
  branches.instanceColor.needsUpdate = true;
  // COZY-B: tulis ulang matriks tajuk (dipakai saat build + tiap frame saat
  // grassSway, supaya tajuk bergoyang mengikuti angin; musim dingin tajuk
  // mengecil 0.55x = "gundul bersalju").
  function writeCrownMatrices() {
    const leanAmp = grassSway ? 0.06 * wind.speed : 0;
    blobList.forEach((bl, i) => {
      const lean = leanAmp * Math.sin(elapsed * 1.1 + bl.ph);
      const sc = bl.s * (season === 'winter' ? 0.55 : 1);
      _dummy.position.set(bl.x + wind.x * lean, bl.y, bl.z + wind.z * lean);
      _dummy.rotation.set(0, bl.rotY || 0, lean * 0.5);
      _dummy.scale.set(sc * bl.sx, sc * bl.sy, sc * bl.sz);
      _dummy.updateMatrix();
      crownBlobs.setMatrixAt(i, _dummy.matrix);
    });
    crownBlobs.instanceMatrix.needsUpdate = true;
    coneList.forEach((cn, i) => {
      const lean = leanAmp * 0.5 * Math.sin(elapsed * 1.0 + cn.ph);
      _dummy.position.set(cn.x + wind.x * lean, cn.y, cn.z + wind.z * lean);
      _dummy.rotation.set(0, 0, lean * 0.4);
      _dummy.scale.set(cn.rad, cn.h, cn.rad);
      _dummy.updateMatrix();
      pineCones.setMatrixAt(i, _dummy.matrix);
    });
    pineCones.instanceMatrix.needsUpdate = true;
  }
  // COZY-B: warna tajuk per musim. Semi = sakura pink + hijau segar; panas =
  // semua hijau pekat (sakura pun berdaun di musim panas); gugur = emas/merah;
  // dingin = salju pucat.
  const cAutumnPick = [0xe8a33d, 0xd9382b, 0xf2d06b, 0xc96a2e].map((c) => new THREE.Color(c));
  function seasonCrownColor(type, seed01) {
    if (season === 'spring') {
      return type === 'sakura'
        ? sakuraCols[Math.floor(seed01 * sakuraCols.length)].clone()
        : crownA.clone().lerp(crownB, seed01);
    }
    if (season === 'summer') return new THREE.Color(0x2f7d33).lerp(new THREE.Color(0x5aa843), seed01);
    if (season === 'autumn') return cAutumnPick[Math.floor(seed01 * cAutumnPick.length)].clone();
    return new THREE.Color(0xe8eef7).lerp(new THREE.Color(0xcfd8e8), seed01);
  }
  function applySeasonCrowns() {
    blobList.forEach((bl, i) => crownBlobs.setColorAt(i, seasonCrownColor(bl.type, bl.seed)));
    crownBlobs.instanceColor.needsUpdate = true;
    // Sakura hero (non-instanced): warnai ulang material kanopinya juga.
    for (const { mesh, k } of heroSakuraBlobs) {
      mesh.material.color.copy(seasonCrownColor('sakura', (k + 0.5) / 3));
    }
    coneList.forEach((cn, i) => {
      const c = season === 'winter' ? new THREE.Color(0x9fb8a8)
        : season === 'autumn' ? new THREE.Color(0x7a6a2e)
        : pineA.clone().lerp(pineB, cn.seed);
      pineCones.setColorAt(i, c);
    });
    pineCones.instanceColor.needsUpdate = true;
    writeCrownMatrices(); // musim dingin mengubah skala tajuk
  }
  blobList.forEach((bl, i) => crownBlobs.setColorAt(i, bl.c));
  crownBlobs.instanceColor.needsUpdate = true;
  // Lane D: 3 kerucut/pinus (dulu 2) — tapi warna tetap memakai rnd()
  // HANYA untuk 2 kerucut pertama tiap pinus; kerucut ke-3 memakai cn.seed
  // (hash deterministik). Kerucut tersusun 3-per-pinus di coneList, jadi
  // jumlah rnd() per pinus tetap 2 dan aliran rnd() layout (batu/semak/
  // bunga/rumput) tetap IDENTIK dengan Wave 1 (grassX0 -16.06107).
  coneList.forEach((cn, i) => pineCones.setColorAt(i,
    pineA.clone().lerp(pineB, i % 3 === 2 ? cn.seed : rnd())));
  pineCones.instanceColor.needsUpdate = true;
  writeCrownMatrices();
  fruitList.forEach((fr, i) => {
    m4.compose(new THREE.Vector3(fr.x, fr.y, fr.z), q, new THREE.Vector3(1, 1, 1));
    fruits.setMatrixAt(i, m4);
    fruits.setColorAt(i, new THREE.Color(fr.c));
  });
  fruits.instanceColor.needsUpdate = true;
  for (const cm of [trunks, branches, crownBlobs, pineCones, fruits]) {
    cm.castShadow = true;
    group.add(cm);
  }

  // ---- Sakura hero (3 pohon biasa, bukan instanced — dapat outline tegas):
  // kanopi pink berlapis 3 tone di tepi alun-alun + dekat rumah/toko.
  // Posisi dipilih di luar jalur (cek PATHS) + luar footprint rumah.
  // COZY-B: hero sakura dikumpulkan supaya update() bisa menggoyangnya pelan
  // mengikuti angin (rotasi kecil, bukan matriks per-frame), dan supaya
  // applySeasonCrowns() bisa mewarnai ulang kanopinya per musim (kalau tidak,
  // sakura hero tetap pink di musim dingin — terlihat di screenshot winter).
  const heroSakura = [];
  const heroSakuraBlobs = []; // {mesh, k} — kanopi per pohon hero
  for (const [sx2, sz2, ss] of [[10, -27, 1.15], [24, -27, 1.0], [-6, -14, 1.25]]) {
    const sy2 = terrainHeight(sx2, sz2);
    const sak = new THREE.Group();
    const strunk = new THREE.Mesh(jitterGeo(new THREE.CylinderGeometry(0.22, 0.36, 2.4, 6), 0.12), mat(0x5a3d24));
    strunk.position.y = 1.2; strunk.castShadow = true; sak.add(strunk);
    // Lane D: pink lebih lembut/natural + kanopi dijitter (siluet tak
    // beraturan, bukan bola halus) + flatShading.
    const sakCols = [0xf2a0bd, 0xf7c3d4, 0xe87f9f];
    for (let k = 0; k < 3; k++) {
      const blob = new THREE.Mesh(jitterGeo(new THREE.SphereGeometry(1.35 - k * 0.25, 10, 8), 0.14),
        mat(sakCols[k], { flatShading: true }));
      blob.position.set((k - 1) * 0.9, 2.9 + k * 0.55, (k % 2 ? -0.4 : 0.35));
      blob.scale.set(1, 0.8, 0.92);
      blob.rotation.y = (k * 1.3 + sx2 * 0.1) % Math.PI;
      blob.castShadow = true; sak.add(blob);
      heroSakuraBlobs.push({ mesh: blob, k });
    }
    sak.position.set(sx2, sy2, sz2);
    sak.scale.setScalar(ss);
    group.add(sak);
    heroSakura.push(sak);
    colliders.push({ minX: sx2 - 0.5, maxX: sx2 + 0.5, minZ: sz2 - 0.5, maxZ: sz2 + 0.5 });
  }

  // ---- Batu-batu (instanced dodecahedron)
  const rockSpots = [];
  guard = 0;
  while (rockSpots.length < 20 && guard++ < 600) {
    const x = (rnd() - 0.5) * 220, z = (rnd() - 0.5) * 220;
    if (Math.hypot(x, z) < 10 || Math.hypot(x, z) > 112) continue;
    if (Math.abs(x - riverCenterX(z)) < 6) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (distToPaths(x, z) < 2.2) continue;
    if (insideHouseFootprints(x, z, 2)) continue;
    if (inNightMarket(x, z, 2)) continue;                          // pasar malam (Lane P)
    if (Math.hypot(x - SQUARE.x, z - SQUARE.z) < 8) continue;
    if (rockSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 6)) continue;
    rockSpots.push({ x, z, s: 0.5 + rnd() * 0.9 });
  }
  // Lane D: batu tak beraturan (jitter + rotasi/tilt + skala non-seragam)
  // + variasi warna per instans (dulu satu warna datar 0x8d8578).
  const rocks = new THREE.InstancedMesh(jitterGeo(new THREE.DodecahedronGeometry(1, 0), 0.22),
    mat(0x8d8578, { flatShading: true }), rockSpots.length);
  const cRock0A = new THREE.Color(0x8d8578), cRock0B = new THREE.Color(0x6e6258);
  rockSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    _q.setFromEuler(new THREE.Euler((_fr(Math.sin(i * 3.7) * 91.7) - 0.5) * 0.25,
      _fr(Math.sin(i * 9.1) * 47.3) * Math.PI * 2, (_fr(Math.sin(i * 5.3) * 33.1) - 0.5) * 0.25));
    m4.compose(new THREE.Vector3(p.x, y + 0.3 * p.s, p.z), _q,
      new THREE.Vector3(p.s * (0.85 + _fr(Math.sin(i * 7.7) * 61.1) * 0.4), p.s * 0.7, p.s * (0.85 + _fr(Math.sin(i * 11.3) * 23.9) * 0.4)));
    rocks.setMatrixAt(i, m4);
    rocks.setColorAt(i, cRock0A.clone().lerp(cRock0B, _fr(Math.sin(i * 13.7) * 17.3)));
    colliders.push({ minX: p.x - 0.7 * p.s, maxX: p.x + 0.7 * p.s, minZ: p.z - 0.7 * p.s, maxZ: p.z + 0.7 * p.s });
  });
  _q.identity();
  rocks.instanceColor.needsUpdate = true;
  rocks.castShadow = true;
  group.add(rocks);

  // ---- Semak (instanced, bulat pipih, tanpa collider) + bebatuan variasi
  const bushSpots = [];
  guard = 0;
  while (bushSpots.length < 30 && guard++ < 700) {
    const x = (rnd() - 0.5) * 224, z = (rnd() - 0.5) * 224;
    const r = Math.hypot(x, z);
    if (r < 10 || r > 112) continue;
    if (Math.abs(x - riverCenterX(z)) < 6) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (x > PEN.minX - 3 && x < PEN.maxX + 3 && z > PEN.minZ - 3 && z < PEN.maxZ + 3) continue;
    if (distToPaths(x, z) < 2.2) continue;
    if (insideHouseFootprints(x, z, 2)) continue;
    if (inNightMarket(x, z, 2)) continue;                          // pasar malam (Lane P)
    if (bushSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    bushSpots.push({ x, z, s: 0.5 + rnd() * 0.7 });
  }
  // Semak tambahan di padang bunga.
  for (let i = 0; i < 6; i++) {
    bushSpots.push({ x: MEADOW.x + (rnd() - 0.5) * 30, z: MEADOW.z + (rnd() - 0.5) * 22, s: 0.6 + rnd() * 0.6 });
  }
  // Lane D: semak bergelombang (jitter + skala non-seragam) + hijau natural.
  const bushes = new THREE.InstancedMesh(jitterGeo(new THREE.SphereGeometry(1, 7, 5), 0.25),
    mat(0xffffff, { flatShading: true }), bushSpots.length); // COZY-B: putih — warna murni dari instanceColor (musim terlihat)
  const cBushA = new THREE.Color(0x3d7a2e), cBushB = new THREE.Color(0x79a848);
  bushSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    m4.compose(new THREE.Vector3(p.x, y + 0.35 * p.s, p.z), q,
      new THREE.Vector3(p.s * (0.9 + _fr(Math.sin(i * 4.9) * 71.7) * 0.4), p.s * 0.65, p.s * (0.9 + _fr(Math.sin(i * 8.3) * 53.3) * 0.4)));
    bushes.setMatrixAt(i, m4);
    bushes.setColorAt(i, cBushA.clone().lerp(cBushB, rnd())); // rnd() dipertahankan: aliran layout identik Wave 1
  });
  bushes.instanceColor.needsUpdate = true;
  group.add(bushes);

  // Bebatuan variasi kedua: icosahedron gepeng, warna abu-coklat (dengan collider).
  const rock2Spots = [];
  guard = 0;
  while (rock2Spots.length < 16 && guard++ < 600) {
    const x = (rnd() - 0.5) * 220, z = (rnd() - 0.5) * 220;
    if (Math.hypot(x, z) < 25 || Math.hypot(x, z) > 110) continue;
    if (Math.abs(x - riverCenterX(z)) < 6) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (x > PEN.minX - 3 && x < PEN.maxX + 3 && z > PEN.minZ - 3 && z < PEN.maxZ + 3) continue;
    if (distToPaths(x, z) < 2.2) continue;
    if (insideHouseFootprints(x, z, 2)) continue;
    if (inNightMarket(x, z, 2)) continue;                          // pasar malam (Lane P)
    if (rock2Spots.some((p) => Math.hypot(p.x - x, p.z - z) < 7)) continue;
    rock2Spots.push({ x, z, s: 0.4 + rnd() * 0.8, rot: rnd() * Math.PI });
  }
  // Lane D: jitter + flatShading (batu kedua ikut tak beraturan).
  const rocks2 = new THREE.InstancedMesh(jitterGeo(new THREE.IcosahedronGeometry(1, 0), 0.18),
    mat(0x8d8578, { flatShading: true }), rock2Spots.length);
  const cRockA = new THREE.Color(0x8d8578), cRockB = new THREE.Color(0x6e6258);
  rock2Spots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
    m4.compose(new THREE.Vector3(p.x, y + 0.25 * p.s, p.z), _q, new THREE.Vector3(p.s, p.s * 0.55, p.s * 0.8));
    rocks2.setMatrixAt(i, m4);
    rocks2.setColorAt(i, cRockA.clone().lerp(cRockB, rnd()));
    colliders.push({ minX: p.x - 0.7 * p.s, maxX: p.x + 0.7 * p.s, minZ: p.z - 0.7 * p.s, maxZ: p.z + 0.7 * p.s });
  });
  _q.identity();
  rocks2.instanceColor.needsUpdate = true;
  rocks2.castShadow = true;
  group.add(rocks2);

  // ---- Bunga liar (instanced: batang + kepala warna-warni lembut, tanpa collider)
  const flowerSpots = [];
  guard = 0;
  while (flowerSpots.length < 90 && guard++ < 900) {
    const x = (rnd() - 0.5) * 220, z = (rnd() - 0.5) * 220;
    const r = Math.hypot(x, z);
    if (r < 8 || r > 110) continue;
    if (Math.abs(x - riverCenterX(z)) < 5.5) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (x > PEN.minX - 2 && x < PEN.maxX + 2 && z > PEN.minZ - 2 && z < PEN.maxZ + 2) continue;
    if (x > -14 && x < 8 && z > -28 && z < -16) continue;
    if (Math.abs(z + 17) < 2.5 && x > -12 && x < 12) continue;
    if (distToPaths(x, z) < 2) continue;
    if (insideHouseFootprints(x, z, 2)) continue;
    if (inNightMarket(x, z, 2)) continue;                          // pasar malam (Lane P)
    flowerSpots.push({ x, z });
  }
  // Padang bunga luas: 170 bunga padat di sekitar (-50,-55). // COZY-B: 120 -> 170
  guard = 0;
  while (flowerSpots.length < 260 && guard++ < 1200) { // COZY-B: 210 -> 260
    const x = MEADOW.x + (rnd() - 0.5) * (MEADOW.rx * 2);
    const z = MEADOW.z + (rnd() - 0.5) * (MEADOW.rz * 2);
    if (Math.abs(x - riverCenterX(z)) < 5.5) continue;
    if (distToPaths(x, z) < 2) continue;
    flowerSpots.push({ x, z });
  }
  // Lane D: kepala bunga 5 kelopak (bukan bola) + batang/tinggi bervariasi.
  const flowerStems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.03, 0.35, 4),
    mat(0x4a7d2e), flowerSpots.length);
  const flowerHeads = new THREE.InstancedMesh(makeFlowerHeadGeometry(),
    mat(0xffffff, { flatShading: true }), flowerSpots.length);
  const flowerPalette = [0xf2a0bd, 0xf2c14e, 0xffffff, 0xb39ddb, 0xe8873a].map((c) => new THREE.Color(c));
  flowerSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    const hs = 0.8 + _fr(Math.sin(i * 2.7) * 83.7) * 0.5; // tinggi batang bervariasi
    m4.compose(new THREE.Vector3(p.x, y + 0.175 * hs, p.z), q, new THREE.Vector3(1, hs, 1));
    flowerStems.setMatrixAt(i, m4);
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), _fr(Math.sin(i * 5.9) * 41.3) * Math.PI * 2);
    m4.compose(new THREE.Vector3(p.x, y + 0.35 * hs + 0.03, p.z), _q,
      new THREE.Vector3(1, 1, 1).multiplyScalar(0.85 + _fr(Math.sin(i * 7.1) * 29.7) * 0.4));
    flowerHeads.setMatrixAt(i, m4);
    flowerHeads.setColorAt(i, flowerPalette[Math.floor(rnd() * flowerPalette.length)]);
  });
  _q.identity();
  flowerHeads.instanceColor.needsUpdate = true;
  group.add(flowerStems); group.add(flowerHeads);

  // ---- Rumput bergoyang (instanced, 420 tuft; goyang di update(), mati di low)
  const grassData = [];
  guard = 0;
  while (grassData.length < 520 && guard++ < 4000) { // COZY-B: 420 -> 520
    const x = (rnd() - 0.5) * 224, z = (rnd() - 0.5) * 224;
    const r = Math.hypot(x, z);
    if (r < 6 || r > 112) continue;
    if (Math.abs(x - riverCenterX(z)) < 5) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (x > PEN.minX - 2 && x < PEN.maxX + 2 && z > PEN.minZ - 2 && z < PEN.maxZ + 2) continue;
    if (Math.abs(z + 17) < 2.2 && x > -12 && x < 12) continue;
    if (distToPaths(x, z) < 1.8) continue;
    if (insideHouseFootprints(x, z, 1.5)) continue;
    if (inNightMarket(x, z, 2)) continue;                          // pasar malam (Lane P)
    grassData.push({ x, z, y: terrainHeight(x, z), s: 0.7 + rnd() * 0.9, ph: rnd() * Math.PI * 2,
      v: ((grassData.length * 2654435761) >>> 0) / 4294967296 }); // COZY-B: v = hash variasi warna
  }
  // Lane D: rumpun 3 helai menyilang (bukan kerucut kartun); DoubleSide
  // supaya helai tipis terlihat dari semua arah. Jumlah instans tetap 520.
  const grassTufts = new THREE.InstancedMesh(makeTuftGeometry(),
    mat(0xffffff, { flatShading: true, side: THREE.DoubleSide }), grassData.length); // COZY-B: putih — warna murni dari instanceColor (musim terlihat; material hijau lama mengalikan tint musim jadi tetap hijau di winter)
  grassTufts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cGrassTuftA = new THREE.Color(0x5d8f3e), cGrassTuftB = new THREE.Color(0x9ab54e);
  grassData.forEach((g, i) => {
    _dummy.position.set(g.x, g.y + 0.25 * g.s, g.z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(g.s, g.s, g.s);
    _dummy.updateMatrix();
    grassTufts.setMatrixAt(i, _dummy.matrix);
    grassTufts.setColorAt(i, cGrassTuftA.clone().lerp(cGrassTuftB, rnd()));
  });
  grassTufts.instanceColor.needsUpdate = true;
  group.add(grassTufts);

  // COZY-B: warna rumput + semak per musim (dipanggil setSeason; bunga dan
  // buah hilang di musim dingin). Semak memakai hash indeks (deterministik).
  function applySeasonVegetation() {
    // Lane D: palet rumput natural per musim (dulu neon 0x4fc94f/0xa8e063).
    const pal = season === 'spring' ? [0x5d8f3e, 0x9ab54e]
      : season === 'summer' ? [0x3f7d33, 0x6fa843]
      : season === 'autumn' ? [0xd9a441, 0xe8c96a]
      : [0xdde8f0, 0xf4f8ff];
    const gA = new THREE.Color(pal[0]), gB = new THREE.Color(pal[1]);
    grassData.forEach((g, i) => grassTufts.setColorAt(i, gA.clone().lerp(gB, g.v)));
    grassTufts.instanceColor.needsUpdate = true;
    const bA = new THREE.Color(0x3d7a2e), bB = new THREE.Color(0x79a848);
    if (season === 'autumn') { bA.setHex(0xc96a2e); bB.setHex(0xe8a33d); }
    if (season === 'winter') { bA.setHex(0xc9d4de); bB.setHex(0xe8eef7); }
    bushSpots.forEach((p, i) => bushes.setColorAt(i, bA.clone().lerp(bB, ((i * 2654435761) >>> 0) / 4294967296)));
    bushes.instanceColor.needsUpdate = true;
    flowerHeads.visible = season !== 'winter';
    flowerStems.visible = season !== 'winter';
    fruits.visible = season !== 'winter';
  }

  // ---- Peti kayu yang bisa didorong
  const crate = new THREE.Group();
  const crateMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat(0xa97c50, { map: texWood }));
  crateMesh.castShadow = true; crateMesh.receiveShadow = true;

  crate.add(crateMesh);
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.25, 1.46), mat(0x6e4a26));
  crate.add(band);
  crate.position.set(CRATE_START.x, terrainHeight(CRATE_START.x, CRATE_START.z) + 0.7, CRATE_START.z);
  group.add(crate);

  // ---- Awan bergerak (Lane C): gumpalan natural — tiap puff pipih
  // (squash vertikal 0.32–0.5, bukan bola) + lebar bervariasi, bob pelan,
  // warna per-instance sedikit berbeda (putih -> abu muda). Tetap 1
  // InstancedMesh, jumlah puff sama (0 draw call baru), drift pelan + wrap.
  const cloudPuffs = [];
  for (let c = 0; c < 7; c++) {
    const cx = rnd() * 260 - 130, cy = 30 + rnd() * 10, cz = rnd() * 220 - 110;
    const n = 3 + Math.floor(rnd() * 3);
    const drift = 0.6 + rnd() * 0.7;
    for (let k = 0; k < n; k++) {
      cloudPuffs.push({ x: cx + (rnd() - 0.5) * 7, y: cy + (rnd() - 0.5) * 1.6,
        z: cz + (rnd() - 0.5) * 3, s: 2.2 + rnd() * 2.4, drift,
        sq: 0.32 + rnd() * 0.18, ph: rnd() * Math.PI * 2,
        shade: 0.88 + rnd() * 0.12 });
    }
  }
  const cloudMat = mat(0xffffff, { transparent: true, opacity: 0.92, fog: false });
  const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), cloudMat, cloudPuffs.length);
  clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cloudPuffs.forEach((p, i) => {
    _dummy.position.set(p.x, p.y, p.z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(p.s, p.s * p.sq, p.s * 0.8);
    _dummy.updateMatrix();
    clouds.setMatrixAt(i, _dummy.matrix);
    clouds.setColorAt(i, new THREE.Color(p.shade, p.shade, p.shade));
  });
  if (clouds.instanceColor) clouds.instanceColor.needsUpdate = true;
  group.add(clouds);

  // ---- Partikel halus: serbuk sari (siang) + kunang-kunang (malam).
  // THREE.Points, jumlah kecil; visibilitas diatur update() + setQuality().
  function makePoints(n, color, size, cx = 0, cz = 0, spread = 70, yMin = 1, yMax = 5) {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = cx + (rnd() - 0.5) * spread;
      arr[i * 3 + 1] = yMin + rnd() * (yMax - yMin);
      arr[i * 3 + 2] = cz + (rnd() - 0.5) * spread;
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      color, size, transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false,
    }));
    pts.frustumCulled = false;
    return pts;
  }
  const pollen = makePoints(60, 0xffe9a8, 0.12);
  const pollenBase = pollen.geometry.attributes.position.array.slice();
  const fireflies = makePoints(40, 0xcfff8a, 0.22);
  const fireflyBase = fireflies.geometry.attributes.position.array.slice();
  // Kelopak sakura beterbangan di sekitar pohon sakura hero (alun-alun + rumah).
  const petals = makePoints(50, 0xff8fb3, 0.16, 8, -22, 46, 2, 7);
  petals.material.opacity = 0.85;
  // COZY-B: hujan + salju + daun gugur (Points; mati di low seperti partikel lain).
  const rain = makePoints(500, 0x9fc8e8, 0.3, 0, 0, 170, 0, 30);
  rain.material.opacity = 0.7; rain.visible = false;
  const snow = makePoints(150, 0xffffff, 0.25, 0, 0, 120, 0, 25);
  snow.material.opacity = 0.9; snow.visible = false;
  const leaves = makePoints(60, 0xe8a33d, 0.18, 8, -22, 46, 1, 7);
  leaves.material.opacity = 0.9; leaves.visible = false;
  group.add(pollen); group.add(fireflies); group.add(petals);
  group.add(rain); group.add(snow); group.add(leaves);
  // COZY-B: kelopak/daun hanyut di permukaan sungai (Points, ikut arus +Z +
  // angin; posisi x selalu mengikuti riverCenterX(z) supaya tetap di air).
  const driftBase = [];
  const driftGeo = new THREE.BufferGeometry();
  {
    const arr = new Float32Array(40 * 3);
    for (let i = 0; i < 40; i++) {
      const z = -120 + i * 6 + ((i * 37) % 5);
      const off = ((i * 53) % 7) - 3;
      driftBase.push({ z, off, s: 0.5 + ((i * 29) % 10) / 10 });
      arr[i * 3] = riverCenterX(z) + off;
      arr[i * 3 + 1] = WATER_Y + 0.06;
      arr[i * 3 + 2] = z;
    }
    driftGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  }
  const drift = new THREE.Points(driftGeo, new THREE.PointsMaterial({
    color: 0xffb3c9, size: 0.16, transparent: true, opacity: 0.85, sizeAttenuation: true, depthWrite: false,
  }));
  drift.frustumCulled = false;
  group.add(drift);

  // ---- Kupu-kupu: 4 ekor, sayap mengepak (2 pivot + 2 plane per ekor).
  const butterflies = [];
  const butterflyCols = [0xf0a35e, 0xf5f2e8, 0x9ab8e8, 0xf2d06b];
  for (let b = 0; b < 4; b++) {
    const bg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mat(0x2b2118));
    body.rotation.x = Math.PI / 2; bg.add(body);
    const wings = [];
    const wmat = mat(butterflyCols[b], { side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const pivot = new THREE.Object3D();
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.18), wmat);
      wing.rotation.x = -Math.PI / 2;
      wing.position.x = s * 0.12;
      pivot.add(wing);
      bg.add(pivot);
      wings.push(pivot);
    }
    bg.position.set(14 + b * 3, 2, 8 + (b % 2) * 3);
    group.add(bg);
    butterflies.push({ group: bg, wings, cx: 14 + b * 3, cz: 8 + (b % 2) * 3, ph: rnd() * Math.PI * 2 });
  }

  // ---- COZY-B: kepadatan desa (campuran tapi singkron: basis chibi lokal,
  // aksen sakura/torii dibatasi satu palet). Semua posisi TETAP (tanpa rnd)
  // supaya tidak menggeser layout scatter ber-seed di atas. InstancedMesh
  // dipakai untuk semua yang berulang (lampion, lempeng batu, alang-alang,
  // batu sungai, pagar kincir, semak pagar, batu penanda, barang lapak).
  // Lapak pasar di sekitar alun-alun (counter + atap + tiang; barang = 1 InstancedMesh).
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xff9a3c, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0 });
  function makeStall(x, z, rotY, awningColor) {
    const g = new THREE.Group();
    const cy = terrainHeight(x, z);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 1.0), mat(0x8a6b3f, { map: texWood }));
    counter.position.y = 0.5; counter.castShadow = true; g.add(counter);
    // Awning garis-garis kain (tekstur per warna lapak; posisi/ukuran tetap).
    const awning = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 1.6),
      mat(0xffffff, { map: texAwning('#' + awningColor.toString(16).padStart(6, '0')) }));
    awning.position.set(0, 2.2, 0.1); awning.rotation.x = 0.12; awning.castShadow = true; g.add(awning);
    for (const s of [-1.2, 1.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.2, 6), mat(0x6e4a26, { map: texWood }));
      post.position.set(s, 1.1, 0.75); g.add(post);
    }
    g.position.set(x, cy, z); g.rotation.y = rotY;
    group.add(g);
    // AABB dilebihkan sedikit (rotasi membuat footprint diagonal lebih lebar).
    colliders.push({ minX: x - 1.5, maxX: x + 1.5, minZ: z - 1.1, maxZ: z + 1.1 });
  }
  const stallDefs = [[8, -27, 2.03, 0xff8fb3], [24, -25, -2.21, 0xffc93c], [12, -38, 0.52, 0x2fbf4a]];
  for (const [sx3, sz3, srot, acol] of stallDefs) makeStall(sx3, sz3, srot, acol);
  const stallGoods = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 5), mat(0xffffff), 9);
  const goodsCols = [0xe87a2a, 0xd9382b, 0x9ccb5e, 0xffd94d, 0xff8fb3, 0xe8912a, 0xd9382b, 0x9ccb5e, 0xffd94d].map((c) => new THREE.Color(c));
  stallDefs.forEach(([sx3, sz3, srot], si) => {
    const sy3 = terrainHeight(sx3, sz3);
    for (let k = 0; k < 3; k++) {
      const lx = (k - 1) * 0.7, lz = 0.1; // lokal di atas counter, diputar rotY
      _dummy.position.set(sx3 + lx * Math.cos(srot) + lz * Math.sin(srot), sy3 + 1.12,
        sz3 - lx * Math.sin(srot) + lz * Math.cos(srot));
      _dummy.rotation.set(0, 0, 0); _dummy.scale.set(1, 1, 1); _dummy.updateMatrix();
      stallGoods.setMatrixAt(si * 3 + k, _dummy.matrix);
      stallGoods.setColorAt(si * 3 + k, goodsCols[si * 3 + k]);
    }
  });
  stallGoods.instanceColor.needsUpdate = true;
  group.add(stallGoods);
  // Lampion jalan (8 titik di sekitar alun-alun, di luar tepi jalan tanah):
  // tiang + kotak lampu (menyala senja/malam via lanternMat) + atap kerucut.
  const lanternSpots = [[10, -33.5], [22, -33.5], [13.5, -25], [18.5, -37], [12, -27], [20, -35], [28, -34.5], [4, -31]];
  const lanternPosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 1.6, 6), mat(0x6e4a26, { map: texWood }), lanternSpots.length);
  const lanternBoxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), lanternMat, lanternSpots.length);
  const lanternRoofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 0.35, 4), mat(0x8a4a2f, { map: texRoofTile }), lanternSpots.length);
  lanternSpots.forEach(([lx, lz], i) => {
    const ly = terrainHeight(lx, lz);
    _dummy.rotation.set(0, 0, 0); _dummy.scale.set(1, 1, 1);
    _dummy.position.set(lx, ly + 0.8, lz); _dummy.updateMatrix(); lanternPosts.setMatrixAt(i, _dummy.matrix);
    _dummy.position.set(lx, ly + 1.75, lz); _dummy.updateMatrix(); lanternBoxes.setMatrixAt(i, _dummy.matrix);
    _dummy.position.set(lx, ly + 2.1, lz); _dummy.rotation.set(0, Math.PI / 4, 0); _dummy.updateMatrix(); lanternRoofs.setMatrixAt(i, _dummy.matrix);
    colliders.push({ minX: lx - 0.25, maxX: lx + 0.25, minZ: lz - 0.25, maxZ: lz + 0.25 });
  });
  _dummy.rotation.set(0, 0, 0);
  group.add(lanternPosts); group.add(lanternBoxes); group.add(lanternRoofs);
  // Jalan batu: cincin lempeng di sekeliling sumur + anak tangga batu ke utara.
  const slabSpots = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    slabSpots.push({ x: SQUARE.x + Math.cos(a) * 4.5, z: SQUARE.z + Math.sin(a) * 4.5, rot: a });
  }
  for (let k = 0; k < 6; k++) slabSpots.push({ x: 16, z: -26 - k * 1.4, rot: 0.2 * k });
  const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.08, 1.2), mat(0xffffff), slabSpots.length);
  const cSlabA = new THREE.Color(0xb8b0a0), cSlabB = new THREE.Color(0x8d8578);
  slabSpots.forEach((p, i) => {
    _dummy.position.set(p.x, terrainHeight(p.x, p.z) + 0.04, p.z);
    _dummy.rotation.set(0, p.rot, 0); _dummy.scale.set(1, 1, 1); _dummy.updateMatrix();
    slabs.setMatrixAt(i, _dummy.matrix);
    slabs.setColorAt(i, cSlabA.clone().lerp(cSlabB, ((i * 2654435761) >>> 0) / 4294967296));
  });
  _dummy.rotation.set(0, 0, 0);
  slabs.instanceColor.needsUpdate = true;
  group.add(slabs);
  // Bangku tambahan (2): satu menghadap jalan danau, satu menghadap jalan kincir.
  for (const [bx, bz, ry] of [[30, -36.5, 0.52], [-30, 30, -2.36]]) {
    const by = terrainHeight(bx, bz);
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.5), mat(0x8a6b3f, { map: texWood }));
    seat.position.y = 0.55; seat.castShadow = true; bench.add(seat);
    for (const s of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.45), mat(0x6e4a26));
      leg.position.set(s, 0.25, 0); bench.add(leg);
    }
    bench.position.set(bx, by, bz); bench.rotation.y = ry;
    group.add(bench);
    colliders.push({ minX: bx - 1, maxX: bx + 1, minZ: bz - 0.4, maxZ: bz + 0.4 });
  }
  // Alang-alang di tepi sungai (36) + batu-batu di dalam sungai (10).
  const reedSpots = [];
  for (let i = 0; i < 36; i++) {
    const z = -120 + i * 6.9;
    reedSpots.push({ x: riverCenterX(z) + (i % 2 ? 1 : -1) * (3.8 + (i % 3) * 0.5), z });
  }
  const reeds = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 1.3, 4), mat(0x4a7d2e), reedSpots.length);
  reedSpots.forEach((p, i) => {
    _dummy.position.set(p.x, terrainHeight(p.x, p.z) + 0.6, p.z);
    _dummy.rotation.set(0, 0, 0); _dummy.scale.set(1, 1, 1); _dummy.updateMatrix();
    reeds.setMatrixAt(i, _dummy.matrix);
  });
  group.add(reeds);
  const riverStones = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat(0x8d8578), 10);
  for (let i = 0; i < 10; i++) {
    const z = -100 + i * 22;
    const x = riverCenterX(z) + ((i * 37) % 7) - 3;
    _dummy.position.set(x, WATER_Y - 0.08, z);
    _dummy.rotation.set(0, ((i * 2654435761) >>> 0) / 4294967296 * Math.PI, 0);
    _dummy.scale.set(0.9, 0.25, 0.7); _dummy.updateMatrix();
    riverStones.setMatrixAt(i, _dummy.matrix);
  }
  _dummy.rotation.set(0, 0, 0);
  group.add(riverStones);
  // Kincir sebagai landmark: bendera sakura berkibar (goyang di update) +
  // 2 tumpukan jerami + cincin tiang penanda di bukit.
  const wmFlagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 6), mat(0x6e4a26));
  wmFlagPole.position.set(-54, terrainHeight(-54, 49) + 3, 49); wmFlagPole.castShadow = true; group.add(wmFlagPole);
  const wmFlag = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0), mat(0xff8fb3, { side: THREE.DoubleSide }));
  wmFlag.position.set(-53.1, terrainHeight(-54, 49) + 5.4, 49); group.add(wmFlag);
  for (const [hx2, hz2] of [[-52, 58], [-64, 50]]) {
    const hy2 = terrainHeight(hx2, hz2);
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 0.8, 8), mat(0xd9a441, { map: texStraw }));
    hb.position.set(hx2, hy2 + 0.4, hz2); hb.castShadow = true; group.add(hb);
    const ht = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1.3, 8), mat(0xe8b84a, { map: texStraw }));
    ht.position.set(hx2, hy2 + 1.4, hz2); ht.castShadow = true; group.add(ht);
  }
  const wmPosts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.14, 1.3, 6), mat(0x8a6b3f), 10);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const px = WINDMILL.x + Math.cos(a) * 8, pz = WINDMILL.z + Math.sin(a) * 8;
    _dummy.position.set(px, terrainHeight(px, pz) + 0.65, pz);
    _dummy.rotation.set(0, 0, 0); _dummy.scale.set(1, 1, 1); _dummy.updateMatrix();
    wmPosts.setMatrixAt(i, _dummy.matrix);
  }
  group.add(wmPosts);
  // Semak pagar (hedge) di tepi barat alun-alun — tanpa collider (seperti
  // semak biasa: bisa dilewati, menandai batas, bukan tembok).
  const hedgeSpots = [[4, -34], [4, -32], [4, -30], [4, -28]];
  const hedges = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.6, 0.7), mat(0xffffff), hedgeSpots.length);
  const cHedgeA = new THREE.Color(0x2fbf4a), cHedgeB = new THREE.Color(0x4a8f3c);
  hedgeSpots.forEach((p, i) => {
    _dummy.position.set(p[0], terrainHeight(p[0], p[1]) + 0.3, p[1]);
    _dummy.rotation.set(0, 0, 0); _dummy.scale.set(1, 1, 1); _dummy.updateMatrix();
    hedges.setMatrixAt(i, _dummy.matrix);
    hedges.setColorAt(i, cHedgeA.clone().lerp(cHedgeB, ((i * 2654435761) >>> 0) / 4294967296));
  });
  hedges.instanceColor.needsUpdate = true;
  group.add(hedges);
  // Torii merah (aksen sakura, map-5) mengangkangi jalan ke danau di (29,-31);
  // rotY -1.03 supaya tiang tegak lurus arah jalan — pemain bisa lewat di bawahnya.
  const torii = new THREE.Group();
  // Kayu vermilion dipernis (roughness lebih rendah — kilau lacquer).
  const toriiMat = mat(0xc0392b, { roughness: 0.55, map: texWood });
  for (const s of [-1.3, 1.3]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 3.4, 8), toriiMat);
    pillar.position.set(s, 1.7, 0); pillar.castShadow = true; torii.add(pillar);
    const wx = 29 + s * 0.514, wz = -31 + s * 0.857;
    colliders.push({ minX: wx - 0.3, maxX: wx + 0.3, minZ: wz - 0.3, maxZ: wz + 0.3 });
  }
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.28, 0.3), toriiMat);
  kasagi.position.y = 3.5; kasagi.castShadow = true; torii.add(kasagi);
  // Lis hitam di puncak kasagi (aksen torii klasik).
  const kasagiTop = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.08, 0.34), mat(0x2b2118));
  kasagiTop.position.y = 3.68; torii.add(kasagiTop);
  const shimaki = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.2, 0.24), toriiMat);
  shimaki.position.y = 3.1; torii.add(shimaki);
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.1), mat(0x6e4a26));
  plaque.position.y = 3.3; torii.add(plaque);
  torii.position.set(29, terrainHeight(29, -31), -31);
  torii.rotation.y = -1.03;
  group.add(torii);
  // Penanda lokasi tersembunyi (halus: batu + kelopak, tanpa papan besar).
  const spotStonePos = [
    [-34, -44], [-32.5, -42.5], [-35.5, -42.8],
    [70, -66], [71.5, -64.8], [68.8, -64.5],
    [-96, 28], [-94.5, 29.2], [-97.2, 29.5],
    [-60, -40], [-58.6, -41.2], [-61.2, -38.8],
    [-68, 62], [-66.5, 63.2], [-69.3, 60.8],
  ];
  const spotStones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), mat(0x8d8578), spotStonePos.length);
  spotStonePos.forEach((p, i) => {
    const sc = 0.6 + ((i * 2654435761) >>> 0) / 4294967296 * 0.5;
    _dummy.position.set(p[0], terrainHeight(p[0], p[1]) + 0.15 * sc, p[1]);
    _dummy.rotation.set(0, ((i * 40503) % 628) / 100, 0);
    _dummy.scale.set(sc, sc * 0.55, sc); _dummy.updateMatrix();
    spotStones.setMatrixAt(i, _dummy.matrix);
  });
  _dummy.rotation.set(0, 0, 0);
  group.add(spotStones);
  const spotPetals = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 6, 5), mat(0xff8fb3), 5);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const px = -34 + Math.cos(a) * 1.8, pz = -44 + Math.sin(a) * 1.8;
    _dummy.position.set(px, terrainHeight(px, pz) + 0.35, pz);
    _dummy.rotation.set(0, 0, 0); _dummy.scale.set(1, 1, 1); _dummy.updateMatrix();
    spotPetals.setMatrixAt(k, _dummy.matrix);
  }
  group.add(spotPetals);
  // Sumur tua (lokasi tersembunyi 'old-well', di (-60,-40)): batu + atap.
  const oldWell = new THREE.Group();
  const owBase = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.8, 8), mat(0x8d8578, { map: texStone }));
  owBase.position.y = 0.4; owBase.castShadow = true; oldWell.add(owBase);
  const owDark = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 8), mat(0x2b2118));
  owDark.position.y = 0.82; oldWell.add(owDark);
  for (const s of [-0.65, 0.65]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.7, 6), mat(0x6e4a26, { map: texWood }));
    post.position.set(s, 0.85, 0); oldWell.add(post);
  }
  const owRoof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.7, 4), mat(0x8a4a2f, { map: texRoofTile }));
  owRoof.position.y = 2.0; owRoof.rotation.y = Math.PI / 4; oldWell.add(owRoof);
  oldWell.position.set(-60, terrainHeight(-60, -40), -40);
  group.add(oldWell);
  colliders.push({ minX: -60.9, maxX: -59.1, minZ: -40.9, maxZ: -39.1 });
  // Jerami mini di belakang kincir (lokasi 'windmill-back').
  const wbHay = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.7, 8), mat(0xd9a441, { map: texStraw }));
  wbHay.position.set(-68, terrainHeight(-68, 62) + 0.35, 62); wbHay.castShadow = true; group.add(wbHay);
  const wbHayTop = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.2, 8), mat(0xe8b84a, { map: texStraw }));
  wbHayTop.position.set(-68, terrainHeight(-68, 62) + 1.25, 62); wbHayTop.castShadow = true; group.add(wbHayTop);

  // ---- Matahari + cahaya (anime: matahari emas hangat, hemisphere biru/krem)
  const sun = new THREE.DirectionalLight(0xffc93c, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
  sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
  sun.shadow.camera.far = 300; sun.shadow.bias = -0.0005;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0x9fd4ff, 0xffe9b8, 0.9);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffe0b3, 0.35);
  scene.add(amb);
  scene.fog = new THREE.Fog(0xd6ecff, 70, 300); // Lane C: haze atmosferik
  // lebih terasa (dulu 90/320) — horizon + pegunungan memudar, gameplay di
  // jarak main (<70) tetap jernih; cuaca mengalikan via fogMul di update().

  // Palet waktu (keyframe menit -> warna langit, matahari, kabut, awan).
  // Diinterpolasi linear; malam = cahaya bulan biru redup.
  // Siang memakai token anime: top #3fa9f5, horizon krem #fff1c4, fog #d6ecff.
  const SKY_STOPS = [
    { m: 360,  top: 0x7ec8f7, hor: 0xffe9b8, fog: 0xf6e3c2, sun: 0xffb340, sunI: 1.6, hemiSky: 0x9fd4ff, hemiI: 0.7, ambI: 0.3, cloud: 0xffe3c2 },
    { m: 540,  top: 0x3fa9f5, hor: 0xfff1c4, fog: 0xd6ecff, sun: 0xffc93c, sunI: 2.2, hemiSky: 0x9fd4ff, hemiI: 0.9, ambI: 0.35, cloud: 0xffffff },
    { m: 720,  top: 0x2f9df2, hor: 0xcfeeff, fog: 0xd6ecff, sun: 0xffd94d, sunI: 2.4, hemiSky: 0xbfe3ff, hemiI: 1.0, ambI: 0.4, cloud: 0xffffff },
    { m: 960,  top: 0x3fa9f5, hor: 0xffe9b8, fog: 0xdcefff, sun: 0xffc93c, sunI: 2.2, hemiSky: 0x9fd4ff, hemiI: 0.9, ambI: 0.35, cloud: 0xfff2d8 },
    { m: 1080, top: 0x5a6aa8, hor: 0xff9a5c, fog: 0xe8a06a, sun: 0xff8a4d, sunI: 1.2, hemiSky: 0x8a7aa8, hemiI: 0.55, ambI: 0.2, cloud: 0xffd9c2 },
    { m: 1200, top: 0x1c2a4a, hor: 0x3a4a6a, fog: 0x2c3a52, sun: 0x8aa8d8, sunI: 0.35, hemiSky: 0x2a3a5a, hemiI: 0.3, ambI: 0.08, cloud: 0x5a6a8a },
    { m: 1320, top: 0x141f38, hor: 0x2c3a55, fog: 0x232f45, sun: 0x8aa8d8, sunI: 0.3, hemiSky: 0x22304e, hemiI: 0.25, ambI: 0.06, cloud: 0x4a5a78 },
  ];
  const _cA = new THREE.Color(), _cB = new THREE.Color();
  function skyAt(minutes) {
    let a = SKY_STOPS[0], b = SKY_STOPS[SKY_STOPS.length - 1];
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
      if (minutes >= SKY_STOPS[i].m && minutes <= SKY_STOPS[i + 1].m) { a = SKY_STOPS[i]; b = SKY_STOPS[i + 1]; break; }
    }
    const k = THREE.MathUtils.clamp((minutes - a.m) / Math.max(1, b.m - a.m), 0, 1);
    const col = (ka, kb) => _cA.setHex(ka).lerp(_cB.setHex(kb), k).clone();
    const num = (na, nb) => na + (nb - na) * k;
    return {
      top: col(a.top, b.top), hor: col(a.hor, b.hor), fog: col(a.fog, b.fog),
      sun: col(a.sun, b.sun), sunI: num(a.sunI, b.sunI),
      hemiSky: col(a.hemiSky, b.hemiSky), hemiI: num(a.hemiI, b.hemiI),
      ambI: num(a.ambI, b.ambI), cloud: col(a.cloud, b.cloud),
    };
  }

  // ---- Data kontrak minimap + view (lane minimap + lane kamera gelombang 2).
  const riverLine = [];
  for (let z = -130; z <= 130; z += 4) riverLine.push({ x: riverCenterX(z), z });
  const houseMinimap = [{ x: hx, z: hz, w: 8, d: 6, player: true }];
  for (const h of NEW_HOUSES) {
    const f = houseFootprint(h);
    houseMinimap.push({ x: h.x, z: h.z, w: f.w, d: f.d, player: false });
  }
  const minimapData = {
    bounds: { min: -130, max: 130 },
    river: riverLine,
    lake: { x: LAKE.x, z: LAKE.z, rx: LAKE.rx, rz: LAKE.rz },
    houses: houseMinimap,
    shop: { x: sx, z: sz, w: 6, d: 4 },
    farm: { x: (fx0 + fx1) / 2, z: (fz0 + fz1) / 2, w: fx1 - fx0, d: fz1 - fz0 },
    pen: { x: (PEN.minX + PEN.maxX) / 2, z: (PEN.minZ + PEN.maxZ) / 2, w: PEN.maxX - PEN.minX, d: PEN.maxZ - PEN.minZ },
    paths: PATHS,
    windmill: { x: WINDMILL.x, z: WINDMILL.z },
    well: { x: SQUARE.x, z: SQUARE.z },
    // Lane P: pasar malam, rect zona + titik wahana/game terkunci.
    // CATATAN: ui.js (_normalizeMinimapData) saat ini hanya menggambar field
    // yang sudah dikenal: rect zona tampil lewat PATHS keliling batas +
    // jalan utama/silang di atas; gambar rect berwarna + label butuh
    // penambahan kecil di ui.js saat merge (lihat LANE-P-REPORT.md).
    nightmarket: {
      rect: { minX: 58, maxX: 103, minZ: -50, maxZ: 44 },
      gate: { x: 60, z: 0 },
      stage: { x: 77, z: -6 },
      rides: [
        { x: 70, z: -40, kind: 'bianglala' }, { x: 84, z: -40, kind: 'kora-kora' },
        { x: 94, z: -40, kind: 'komidi' }, { x: 82, z: -48, kind: 'kursi-terbang' },
        { x: 96, z: -48, kind: 'bom-bom' }, { x: 70, z: -32, kind: 'tagada' },
        { x: 98, z: -32, kind: 'tong-motor' }, { x: 64, z: -39, kind: 'coaster' },
        { x: 71, z: 35, kind: 'rumah-hantu' }, { x: 84, z: 33, kind: 'istana-balon' },
        { x: 95, z: 33, kind: 'mandi-bola' }, { x: 88, z: 42, kind: 'rumah-kaca' },
        { x: 64, z: 28, kind: 'trampolin' }, { x: 62, z: 18, kind: 'odong' },
        { x: 64, z: 20, kind: 'becak' }, { x: 98, z: 10, kind: 'kolam-pancing' },
        { x: 98, z: -12, kind: 'pen-hewan' }, { x: 77, z: 0, kind: 'badut' },
        { x: 66, z: -12, kind: 'game' }, { x: 74, z: -12, kind: 'game' },
        { x: 82, z: -12, kind: 'game' }, { x: 90, z: -12, kind: 'game' },
        { x: 66, z: 12, kind: 'game' }, { x: 74, z: 12, kind: 'game' },
        { x: 82, z: 12, kind: 'game' }, { x: 90, z: 12, kind: 'game' },
      ],
      stalls: { x: 92, zFrom: -20, zTo: 20, step: 4 },
    },
  };
  const view = { fogNear: 70, fogFar: 300, camFar: 600 }; // Lane C: selaras fog baru

  return {
    group, colliders, water, waterTex, foam, sun, hemi, amb, lamp, crate, crateMesh,
    doorPos, shopPos, penGate, bedroom, minimapData, view,
    counts: { trees: treeSpots.length, fruitTrees, fruits: fruitList.length, houses: 1 + NEW_HOUSES.length },
    // ---- COZY-B: API cuaca/musim/angin + lokasi tersembunyi (untuk probe
    // headless via window.__LH_GAME.world.* dan untuk lane F2/migrasi).
    hiddenSpots: HIDDEN_SPOTS.map((s) => ({ ...s })),
    get weather() { return weather; },
    get season() { return season; },
    get wind() { return { ...wind }; },
    get rotorSpeed() { return 0.25 + wind.speed * 0.35; },
    getWeather() { return { weather, season, windSpeed: wind.speed, gust: wind.gust, rain: weatherMix.rain, sunMul: weatherMix.sunMul }; },
    getSeason() { return season; },
    // Snapshot lingkungan untuk probe headless (bukan API gameplay).
    getEnvDebug() {
      const hex3 = (arr) => {
        if (!arr) return null;
        const r = Math.round(arr[0] * 255), g = Math.round(arr[1] * 255), b = Math.round(arr[2] * 255);
        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
      };
      return {
        weather, season,
        windSpeed: wind.speed, gust: wind.gust, rainMix: weatherMix.rain,
        sunI: sun.intensity, fogNear: scene.fog.near, fogFar: scene.fog.far,
        skyTop: `#${skyUniforms.topColor.value.getHexString()}`,
        skyStarK: skyUniforms.starK.value, // Lane C: bintang malam (0 siang)
        waterColor: `#${waterMat.color.getHexString()}`, // Lane C: tint langit di air
        lakeColor: `#${lakeWaterMat.color.getHexString()}`,
        cloudCount: cloudPuffs.length, // Lane C: 1 InstancedMesh, puff tetap
        rainVisible: rain.visible, snowVisible: snow.visible,
        leavesVisible: leaves.visible, petalsVisible: petals.visible,
        driftVisible: drift.visible,
        crown0: hex3(crownBlobs.instanceColor?.array.subarray(0, 3)),
        heroSakura0: heroSakuraBlobs.length ? `#${heroSakuraBlobs[0].mesh.material.color.getHexString()}` : null,
        terrainCenter: hex3(geo.attributes.color.array.subarray(14620 * 3, 14620 * 3 + 3)),
        grass0: hex3(grassTufts.instanceColor?.array.subarray(0, 3)),
        flowersVisible: flowerHeads.visible, fruitsVisible: fruits.visible,
        rotorAngle: windmillRotor.rotation.z, rotorSpeed: 0.25 + wind.speed * 0.35,
        flashT, flashNext, // COZY-B: petir (storm) — untuk probe kilat
        grassX0: grassTufts.instanceMatrix.array[12],
        counts: { trees: treeSpots.length, houses: 1 + NEW_HOUSES.length },
      };
    },
    setWeather(w) {
      if (!WEATHER_PRESETS[w]) return weather;
      weather = w;
      weatherMix = { ...WEATHER_PRESETS[w] }; // snap — probe/screenshot langsung terlihat
      weatherTimer = 0;
      return weather;
    },
    setSeason(s) {
      if (!['spring', 'summer', 'autumn', 'winter'].includes(s)) return season;
      season = s;
      applySeasonTerrain();
      applySeasonCrowns();
      applySeasonVegetation();
      return season;
    },
    // Cek murni (tanpa efek samping): spot mana yang kena radius dari (px, pz).
    checkSpots(px, pz, discovered = []) {
      return HIDDEN_SPOTS.filter((sp) => !discovered.includes(sp.id)
        && Math.hypot(px - sp.x, pz - sp.z) < sp.r).map((sp) => sp.id);
    },
    setQuality(q) {
      quality = q || 'medium';
      grassSway = quality !== 'low';
      // Lane G (27 Nov 2026): bumpMap terrain (map 256 repeat 48 + anisotropy 4)
      // adalah biaya fragment terbesar di headless (0,46 -> 0,81 FPS saat
      // dimatikan, calls/triangles tidak berubah). Di low, matikan bump saja
      // (map grain tetap); medium/high tidak berubah.
      const tm = terrain.material;
      if (quality === 'low') {
        if (tm.bumpMap) { tm.bumpMap = null; tm.needsUpdate = true; }
      } else if (!tm.bumpMap) {
        tm.bumpMap = terrainTex; tm.needsUpdate = true;
      }
      // Partikel + kupu-kupu mati total di low; update() mengatur sisanya per waktu.
      if (quality === 'low') {
        pollen.visible = false; fireflies.visible = false; petals.visible = false;
        rain.visible = false; snow.visible = false; leaves.visible = false; drift.visible = false;
        for (const bf of butterflies) bf.group.visible = false;
      } else {
        for (const bf of butterflies) bf.group.visible = true;
      }
    },
    update(dt, minutes) {
      elapsed += dt;
      windTime += dt;
      // ---- COZY-B: angin — SATU envelope per frame (ARCHITECTURE.md §13.7).
      // Basis cuaca (badai kuat) x hembusan sinus ganda; arah berayun pelan.
      const wPreset = WEATHER_PRESETS[weather];
      const kMix = 1 - Math.exp(-dt / 1.2); // transisi cuaca ~3 dtk
      for (const key of ['sunMul', 'tintK', 'fogMul', 'rain']) {
        weatherMix[key] += (wPreset[key] - weatherMix[key]) * kMix;
      }
      weatherTimer += dt;
      if (weatherTimer > 50) { // auto-cycle cuaca (setWeather() me-reset timer)
        weatherTimer = 0;
        const r = Math.random();
        weather = r < 0.45 ? 'sunny' : r < 0.7 ? 'cloudy' : r < 0.9 ? 'rain' : 'storm';
      }
      wind.gust = 0.5 + 0.5 * Math.sin(windTime * 0.5) * Math.sin(windTime * 0.23 + 1.7);
      const windBase = weather === 'storm' ? 4.0 : weather === 'rain' ? 2.2 : weather === 'cloudy' ? 1.4 : 1.0;
      wind.speed = windBase * (0.6 + 0.8 * wind.gust);
      wind.dir = 0.6 + 0.3 * Math.sin(windTime * 0.07);
      wind.x = Math.cos(wind.dir); wind.z = Math.sin(wind.dir);
      // Air mengalir (offset tekstur lebih cepat) + riak per-vertex lebih kuat.
      waterTex.offset.y -= dt * 0.3;
      waterTex.offset.x += dt * 0.015;
      const wp = water.geometry.attributes.position;
      for (let i = 0; i < wp.count; i++) {
        wp.setY(i, Math.sin(waterBase[i * 3 + 2] * 0.9 + elapsed * 2.6 + waterBase[i * 3] * 0.6) * 0.1);
      }
      wp.needsUpdate = true;
      // Buih hanyut ke +Z (searah arus), wrap di ujung.
      for (let i = 0; i < FOAM_N; i++) {
        const f = foamData[i];
        f.z += dt * 1.8;
        if (f.z > 130) { f.z = -130; f.x = riverCenterX(f.z) + (rnd() * 5 - 2.5); }
        _dummy.position.set(f.x, WATER_Y + 0.05, f.z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(f.s, 1, f.s);
        _dummy.updateMatrix();
        foam.setMatrixAt(i, _dummy.matrix);
      }
      foam.instanceMatrix.needsUpdate = true;
      // Awan drift ke timur, didorong angin; mendung = awan membesar/menutupi.
      // Lane C: bob vertikal pelan + squash natural per puff (p.sq).
      const cloudScale = 1 + weatherMix.tintK * 0.35;
      for (let i = 0; i < cloudPuffs.length; i++) {
        const p = cloudPuffs[i];
        p.x += (p.drift + wind.speed * 0.35) * dt;
        if (p.x > 140) p.x = -140;
        _dummy.position.set(p.x, p.y + Math.sin(elapsed * 0.25 + p.ph) * 0.7, p.z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(p.s * cloudScale, p.s * p.sq * cloudScale, p.s * 0.8 * cloudScale);
        _dummy.updateMatrix();
        clouds.setMatrixAt(i, _dummy.matrix);
      }
      clouds.instanceMatrix.needsUpdate = true;
      // Rumput bergoyang mengikuti ANGIN (bukan sinus murni): amplitudo +
      // frekuensi naik dengan wind.speed, arah condong mengikuti wind.x/z.
      if (grassSway) {
        const swayAmp = 0.05 + 0.025 * wind.speed;
        const swayFreq = 1.2 + wind.speed * 0.25;
        for (let i = 0; i < grassData.length; i++) {
          const g = grassData[i];
          const sway = swayAmp * Math.sin(elapsed * swayFreq + g.ph);
          _dummy.position.set(g.x, g.y + 0.25 * g.s, g.z);
          _dummy.rotation.set(sway * wind.z, 0, sway * wind.x);
          _dummy.scale.set(g.s, g.s, g.s);
          _dummy.updateMatrix();
          grassTufts.setMatrixAt(i, _dummy.matrix);
        }
        grassTufts.instanceMatrix.needsUpdate = true;
        // Tajuk pohon bergoyang halus (matriks blob/kerucut ditulis ulang).
        writeCrownMatrices();
        for (let h = 0; h < heroSakura.length; h++) {
          heroSakura[h].rotation.z = Math.sin(elapsed * 1.1 + h * 1.7) * 0.015 * wind.speed;
        }
      }
      // Kincir angin: rotor DIDORONG ANGIN (dulu tetap dt*0.6) — tenang ~0.6,
      // badai ~1.65 rad/dtk. Bendera kincir berkibar mengikuti angin juga.
      windmillRotor.rotation.z += dt * (0.25 + wind.speed * 0.35);
      wmFlag.rotation.y = Math.sin(elapsed * 2.2) * 0.3 * (0.4 + wind.speed * 0.3);
      // Partikel: serbuk sari siang (06:00–18:00, bukan musim dingin),
      // kunang-kunang senja/malam.
      const rich = quality !== 'low';
      const isDay = minutes >= 360 && minutes < 1080;
      const isNight = minutes >= 1020 || minutes < 360;
      pollen.visible = rich && isDay && season !== 'winter';
      if (pollen.visible) {
        const pp = pollen.geometry.attributes.position;
        for (let i = 0; i < pp.count; i++) {
          pp.setY(i, pollenBase[i * 3 + 1] + Math.sin(elapsed * 0.7 + i) * 0.5);
          pp.setX(i, pollenBase[i * 3] + Math.sin(elapsed * 0.25 + i * 1.7) * 1.2);
        }
        pp.needsUpdate = true;
      }
      fireflies.visible = rich && isNight;
      if (fireflies.visible) {
        const fp = fireflies.geometry.attributes.position;
        for (let i = 0; i < fp.count; i++) {
          fp.setY(i, fireflyBase[i * 3 + 1] + Math.sin(elapsed * 1.1 + i * 2.3) * 0.6);
          fp.setX(i, fireflyBase[i * 3] + Math.sin(elapsed * 0.4 + i) * 1.5);
        }
        fp.needsUpdate = true;
        fireflies.material.opacity = 0.45 + 0.4 * Math.sin(elapsed * 2.0);
      }
      // Kelopak sakura: jatuh pelan + melayang ke samping, siang saja,
      // musim semi/panas saja (gugur = daun, dingin = salju). Didorong angin.
      petals.visible = rich && isDay && (season === 'spring' || season === 'summer');
      if (petals.visible) {
        const pt = petals.geometry.attributes.position;
        for (let i = 0; i < pt.count; i++) {
          let y = pt.getY(i) - dt * (0.35 + (i % 5) * 0.08);
          if (y < 0.4) y = 6.5;
          pt.setY(i, y);
          pt.setX(i, pt.getX(i) + Math.sin(elapsed * 0.8 + i * 1.3) * dt * 0.4 + wind.x * dt * 0.6);
        }
        pt.needsUpdate = true;
      }
      // COZY-B: daun gugur (musim gugur, siang) — jatuh + hanyut ikut angin.
      leaves.visible = rich && isDay && season === 'autumn';
      if (leaves.visible) {
        const lp = leaves.geometry.attributes.position;
        for (let i = 0; i < lp.count; i++) {
          let y = lp.getY(i) - dt * (0.3 + (i % 4) * 0.07);
          if (y < 0.4) y = 6.5;
          lp.setY(i, y);
          lp.setX(i, lp.getX(i) + wind.x * dt * 0.9 + Math.sin(elapsed * 0.7 + i) * dt * 0.3);
        }
        lp.needsUpdate = true;
      }
      // COZY-B: salju (musim dingin, siang-malam) — jatuh pelan, bergoyang.
      snow.visible = rich && season === 'winter';
      if (snow.visible) {
        const sp = snow.geometry.attributes.position;
        for (let i = 0; i < sp.count; i++) {
          let y = sp.getY(i) - dt * (1.0 + (i % 5) * 0.15);
          if (y < 0.2) y = 24;
          sp.setY(i, y);
          sp.setX(i, sp.getX(i) + Math.sin(elapsed * 0.9 + i * 1.1) * dt * 0.5 + wind.x * dt * 0.4);
        }
        sp.needsUpdate = true;
      }
      // COZY-B: hujan (Points miring terbawa angin; intensitas = weatherMix.rain).
      rain.visible = rich && weatherMix.rain > 0.05;
      if (rain.visible) {
        const rp = rain.geometry.attributes.position;
        rain.material.opacity = 0.3 + 0.5 * weatherMix.rain;
        for (let i = 0; i < rp.count; i++) {
          let y = rp.getY(i) - dt * (18 + weatherMix.rain * 10);
          if (y < 0) y = 30;
          rp.setY(i, y);
          let x = rp.getX(i) + wind.x * dt * 3;
          if (x > 85) x = -85; if (x < -85) x = 85;
          rp.setX(i, x);
        }
        rp.needsUpdate = true;
      }
      // COZY-B: kelopak/daun hanyut di sungai — ikut arus +Z + angin, x selalu
      // mengikuti riverCenterX(z) supaya tetap di air.
      drift.visible = rich && isDay && season !== 'winter';
      if (drift.visible) {
        const dp = drift.geometry.attributes.position;
        for (let i = 0; i < dp.count; i++) {
          const d = driftBase[i];
          d.z += dt * (0.5 + wind.speed * 0.15) * d.s;
          if (d.z > 130) d.z = -130;
          dp.setZ(i, d.z);
          dp.setX(i, riverCenterX(d.z) + d.off + wind.x * 0.4);
        }
        dp.needsUpdate = true;
      }
      // Kupu-kupu: siang saja, melayang di sekitar kebun, sayap mengepak.
      // Musim dingin tidak ada kupu-kupu.
      const bfOn = rich && minutes >= 420 && minutes < 1020 && season !== 'winter';
      for (const bf of butterflies) {
        bf.group.visible = bfOn;
        if (!bfOn) continue;
        const t = elapsed * 0.3 + bf.ph;
        bf.group.position.set(
          bf.cx + Math.sin(t) * 3,
          1.4 + Math.sin(elapsed * 0.9 + bf.ph) * 0.5,
          bf.cz + Math.cos(t * 0.8) * 3);
        bf.group.rotation.y = Math.atan2(Math.cos(t) * 3, -Math.sin(t * 0.8) * 2.4);
        const flap = Math.sin(elapsed * 18 + bf.ph) * 0.9;
        bf.wings[0].rotation.z = flap;
        bf.wings[1].rotation.z = -flap;
      }
      // Matahari bergerak 06:00 (timur, rendah) -> 12:00 (tinggi) -> 22:00 (terbenam).
      const dayFrac = THREE.MathUtils.clamp((minutes - 360) / 960, 0, 1);
      const ang = Math.PI * (0.08 + dayFrac * 0.84);
      const elev = Math.sin(ang);
      sun.position.set(Math.cos(ang) * 70, Math.max(8, elev * 70), 30);
      // Palet waktu: langit, kabut, cahaya, awan.
      const pal = skyAt(minutes);
      // COZY-B: cuaca menggelapkan + mengabukan palet; musim menggeser langit.
      pal.top.lerp(_cA.setHex(0x8a94a8), weatherMix.tintK * 0.6);
      pal.hor.lerp(_cB.setHex(0x8a94a8), weatherMix.tintK * 0.45);
      pal.fog.lerp(_cA.setHex(0x8a94a8), weatherMix.tintK * 0.4);
      pal.sunI *= weatherMix.sunMul;
      if (season === 'winter') { pal.top.lerp(_cA.setHex(0x9fc4e8), 0.3); pal.hor.lerp(_cB.setHex(0xe8eef7), 0.3); }
      else if (season === 'autumn') pal.hor.lerp(_cA.setHex(0xffd9a0), 0.25);
      else if (season === 'spring') pal.hor.lerp(_cA.setHex(0xffe3ee), 0.12);
      scene.fog.near = 70 * weatherMix.fogMul; // Lane C: base 70/300 (dulu 90/320)
      scene.fog.far = 300 * weatherMix.fogMul;
      skyUniforms.topColor.value.copy(pal.top);
      skyUniforms.horizonColor.value.copy(pal.hor);
      scene.fog.color.copy(pal.fog);
      // Lane C: uniform langit baru — arah + warna matahari (glow shader),
      // warna kabut (pita haze horizon), + tint air mengikuti langit.
      skyUniforms.sunDir.value.copy(sun.position).normalize();
      skyUniforms.sunColor.value.copy(pal.sun);
      skyUniforms.fogColor.value.copy(pal.fog);
      _waterTint.copy(pal.hor).lerp(_cA.setHex(0x1e6fa8), 0.68); // Lane C: 0.68
      // (dulu 0.55) — air lebih biru-dalam, pantulan langit tetap kebaca.
      waterMat.color.copy(_waterTint);
      lakeWaterMat.color.copy(_waterTint).lerp(_cB.setHex(0xffffff), 0.12);
      sun.intensity = pal.sunI;
      sun.color.copy(pal.sun);
      hemi.color.copy(pal.hemiSky);
      hemi.intensity = pal.hemiI;
      amb.intensity = pal.ambI;
      cloudMat.color.copy(pal.cloud);
      const night = minutes >= 1140 || minutes < 360; // >=19:00 gelap
      const dusk = THREE.MathUtils.clamp((minutes - 1020) / 120, 0, 1); // 17:00-19:00 senja
      lamp.intensity = night ? 30 : dusk > 0.5 ? 15 : 0;
      winMat.emissiveIntensity = night ? 1.6 : dusk > 0 ? 1.0 : 0.25;
      lanternMat.emissiveIntensity = night ? 1.6 : dusk > 0 ? 1.0 : 0.25; // COZY-B: lampion ikut menyala
      // COZY-B: petir (storm) — sambaran ganda acak tiap 4–10 dtk: langit +
      // cahaya memutih sesaat. flashT > 0 = sedang kilat.
      if (weatherMix.rain > 0.8) {
        flashNext -= dt;
        if (flashNext <= 0) { flashT = 0.22; flashNext = 4 + Math.random() * 6; }
      }
      if (flashT > 0) {
        flashT -= dt;
        const flashK = flashT > 0.11 ? 1 : 0.35; // dua denyut per sambaran
        skyUniforms.topColor.value.lerp(_cA.setHex(0xffffff), flashK * 0.7);
        hemi.intensity = pal.hemiI + flashK * 2.2;
        amb.intensity = pal.ambI + flashK * 0.8;
      }
      // Matahari realistis (Lane C): disc + glow mengikuti arah directional
      // light (di kubah langit, radius 380); malam ganti bulan pucat + bintang.
      sunGroup.visible = !night;
      moonGroup.visible = night;
      skyUniforms.starK.value = night ? 0.85 : dusk * 0.25;
      if (sunGroup.visible) {
        _v.copy(sun.position).normalize().multiplyScalar(380);
        sunGroup.position.copy(_v);
        sunGroup.lookAt(0, 10, 0);
        sunDiscMat.color.copy(pal.sun);
        sunGlowMat.color.copy(pal.sun);
        sunGlowMat.opacity = 0.45 + 0.25 * Math.min(1, pal.sunI / 2.4);
      }
      // COZY-B: lokasi tersembunyi — dicek tiap frame dari window.__LH_GAME
      // (world.js tidak menerima referensi game; main.js di luar batas lane
      // kecuali blok kamera). Hanya saat game berjalan (started).
      if (typeof window !== 'undefined' && window.__LH_GAME) {
        const g = window.__LH_GAME;
        if (g.started && g.state && g.player) {
          if (!Array.isArray(g.state.discoveredSpots)) g.state.discoveredSpots = [];
          for (const s of HIDDEN_SPOTS) {
            if (g.state.discoveredSpots.includes(s.id)) continue;
            if (Math.hypot(g.player.x - s.x, g.player.z - s.z) < s.r) {
              g.state.discoveredSpots.push(s.id);
              if (typeof g.addCoins === 'function') g.addCoins(s.reward);
              if (g.ui && typeof g.ui.toast === 'function') {
                g.ui.toast(g.state.lang === 'en'
                  ? `Hidden spot: ${s.nameEn}  +${s.reward} coins!`
                  : `Lokasi tersembunyi: ${s.name}  +${s.reward} koin!`);
              }
            }
          }
        }
      }
    },
  };
}
