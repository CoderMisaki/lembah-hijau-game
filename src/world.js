// world.js — lembah pastoral low-poly: terrain, pegunungan, sungai mengalir,
// jembatan kayu, rumah, kios toko, kandang, jalan tanah, pohon (instanced), pagar.
import * as THREE from 'three';
import { terrainHeight, riverCenterX, RIVER_HALF, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_RAMP_LEN,
         BRIDGE_DECK_MIN_X, BRIDGE_DECK_MAX_X, BRIDGE_WALK_HALF, WATER_Y, noise2, smoothstep,
         LAKE, WINDMILL, MEADOW, ORCHARD, SQUARE } from './physics.js';

export const FARM_ORIGIN = { x: 12, z: 4 };
export const FARM_COLS = 6, FARM_ROWS = 4, FARM_SPACING = 2.8;
export const PEN = { minX: -13, maxX: 1, minZ: 11, maxZ: 21 }; // kandang ternak
export const HOUSE = { minX: -3, maxX: 5, minZ: -26, maxZ: -19 }; // rumah pemain
export const SHOP = { minX: -12, maxX: -6, minZ: -26, maxZ: -20 }; // kios toko
export const CRATE_START = { x: 7, z: -15 };

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
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
  const cGrassA = new THREE.Color(0x4e8f3a), cGrassB = new THREE.Color(0x7fb84f);
  const cGrassC = new THREE.Color(0x9ccb5e); // rumput muda terang
  const cMeadow = new THREE.Color(0x6da344); // patch padang lebih gelap
  const cSand = new THREE.Color(0xc2a878), cRock = new THREE.Color(0x8d8578);
  const cSnow = new THREE.Color(0xf4f8ff), cDirt = new THREE.Color(0x9a7b4f);
  const cDirtEdge = new THREE.Color(0xa98d63);
  const cBloomPink = new THREE.Color(0xe8a0b8), cBloomYellow = new THREE.Color(0xf2d06b),
        cBloomWhite = new THREE.Color(0xf5f2e8), cBloomLav = new THREE.Color(0xb9a7e6);
  const pathBlend = (d) => 1 - smoothstep(1.1, 1.7, d);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
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
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.receiveShadow = true;
  group.add(terrain);

  // ---- Sky dome: gradient langit (top/horizon) yang berubah mengikuti waktu.
  // ShaderMaterial sederhana, BackSide, tanpa fog — gantikan background datar.
  // Radius 420 (dunia membesar) + gl_Position.z = w: depth di-pin ke far plane
  // supaya kubah tidak ter-clip camera.far 400 di main.js (trik skybox standar;
  // three.js default depthFunc LessEqual, jadi langit tetap kalah vs terrain).
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x6fb3ef) },
    horizonColor: { value: new THREE.Color(0xcfe8f5) },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, 24, 12),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: 'uniform vec3 topColor; uniform vec3 horizonColor; varying vec3 vP; void main(){ float h = normalize(vP).y; float k = pow(max(h, 0.0), 0.55); gl_FragColor = vec4(mix(horizonColor, topColor, k), 1.0); }',
    }),
  );
  scene.add(sky);

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
  const mtnGeo = new THREE.ConeGeometry(1, 1, 6);
  const mtns = new THREE.InstancedMesh(mtnGeo,
    new THREE.MeshLambertMaterial({ flatShading: true }), mtnSpots.length);
  const snowCaps = new THREE.InstancedMesh(mtnGeo,
    new THREE.MeshLambertMaterial({ color: 0xf4f8ff, flatShading: true }), mtnSpots.length);
  const cMtnNearA = new THREE.Color(0x6f7f66), cMtnNearB = new THREE.Color(0x8a938a);
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
  wc.fillStyle = '#56a8d0'; wc.fillRect(0, 0, 128, 128);
  wc.strokeStyle = 'rgba(255,255,255,0.75)'; wc.lineWidth = 2.5;
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
  // Phong: kilau specular matahari di permukaan + tekstur mengalir + riak vertex.
  // Opacity diturunkan (0.88 → 0.62): air jernih, dasar sungai terlihat.
  const water = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({
    map: waterTex, transparent: true, opacity: 0.62,
    shininess: 180, specular: 0xddf2ff,
  }));
  water.position.y = WATER_Y;
  group.add(water);
  const waterBase = waterGeo.attributes.position.array.slice(); // posisi dasar utk riak

  // ---- Buih arus: garis putih kecil yang hanyut mengikuti aliran (+Z,
  // searah offset tekstur) — air terlihat mengalir, bukan diam.
  const FOAM_N = 24;
  const foamGeo = new THREE.BoxGeometry(0.35, 0.03, 1.6);
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const foam = new THREE.InstancedMesh(foamGeo, foamMat, FOAM_N);
  const foamData = [];
  for (let i = 0; i < FOAM_N; i++) {
    const z = -130 + rnd() * 260;
    foamData.push({ z, x: riverCenterX(z) + (rnd() * 5 - 2.5), s: 0.7 + rnd() * 0.8 });
  }
  group.add(foam);

  // ---- Jembatan kayu (papan + tiang + tali + tanjakan)
  // Deck 0.65 (0.2 di atas air 0.45) + tanjakan landai di kedua ujung yang
  // menyambung ke terrain tepi — sinkron dengan bridgeHeight() di physics.js
  // (pijakan pemain = permukaan papan). Dulu deck y=1.0 tanpa tanjakan.
  const bridge = new THREE.Group();
  const plankMat = mat(0x9a6b3f), postMat = mat(0x6e4a26);
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
  const wallMat = mat(0xf3e3c0, { side: THREE.DoubleSide });
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
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.6, 4), mat(0x9a4a2f));
  roof.position.set(hx, hy + 4.7, hz); roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  house.add(roof);
  // Bagian depan (dinding depan + pintu + jendela + tangga): satu grup supaya
  // show() kamar bisa menyembunyikannya sekaligus saat interior tampil.
  const houseFront = new THREE.Group();
  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(8, WALL_H, WALL_T), wallMat);
  frontWall.position.set(hx, hy + WALL_H / 2, hz + 3 - WALL_T / 2);
  frontWall.castShadow = true; frontWall.receiveShadow = true;
  houseFront.add(frontWall);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.2), mat(0x6e4a26));
  door.position.set(hx, hy + 1.1, hz + 3.05); houseFront.add(door);
  // Jendela menyala hangat — emissive dinaikkan saat senja/malam di update().
  // winMat dipakai bersama semua rumah desa + kincir, jadi ikut menyala juga.
  const winMat = new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0xff9a3c, emissiveIntensity: 0.25 });
  for (const wx of [hx - 2.4, hx + 2.4]) {
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
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 0.9), mat(0x8d8578));
  step.position.set(hx, hy + 0.12, hz + 3.4); step.receiveShadow = true; houseFront.add(step);
  house.add(houseFront);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), mat(0x8d8578));
  chimney.position.set(hx + 2.2, hy + 5.2, hz - 1); house.add(chimney);
  // Lampu teras (menyala saat malam)
  const lamp = new THREE.PointLight(0xffc46b, 0, 14, 1.6);
  lamp.position.set(hx, hy + 2.6, hz + 3.6);
  house.add(lamp);
  const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0xffb340 }));
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
      new THREE.MeshLambertMaterial({ color: 0xffd27a, emissive: 0xff9a3c, emissiveIntensity: 1.5 }));
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
  const stall = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 4), mat(0xd8b36a));
  stall.position.set(sx, sy + 1.2, sz); stall.castShadow = true; shop.add(stall);
  const shopRoof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.8, 4), mat(0xb03a2e));
  shopRoof.position.set(sx, sy + 3.3, sz); shopRoof.rotation.y = Math.PI / 4; shop.add(shopRoof);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 0.8), mat(0x6e4a26));
  counter.position.set(sx, sy + 0.5, sz + 2.4); shop.add(counter);
  // Papan nama toko (tekstur canvas prosedural "TOKO") di depan, di bawah atap.
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256; signCanvas.height = 64;
  const sg = signCanvas.getContext('2d');
  sg.fillStyle = '#8a6b3f'; sg.fillRect(0, 0, 256, 64);
  sg.strokeStyle = '#fff8dc'; sg.lineWidth = 4; sg.strokeRect(4, 4, 248, 56);
  sg.fillStyle = '#fff8dc'; sg.font = 'bold 40px Georgia, serif';
  sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillText('TOKO', 128, 34);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 0.12),
    new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(signCanvas) }));
  sign.position.set(sx, sy + 2.55, sz + 2.12); shop.add(sign);
  // Keranjang hasil panen di depan kios (di luar collider SHOP, tanpa collider).
  for (const [bx, cols] of [[sx - 2.4, [0xe87a2a, 0xd9382b]], [sx + 2.4, [0x9ccb5e, 0xe8912a]]]) {
    const bz = sz + 3.4;
    const by = terrainHeight(bx, bz);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.5, 8), mat(0xa97c50));
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
    const walls = new THREE.Mesh(new THREE.BoxGeometry(h.w, wallH, h.d), mat(h.wall));
    walls.position.set(0, y + wallH / 2, 0); walls.castShadow = true; walls.receiveShadow = true;
    g.add(walls);
    if (h.roofType === 'pyramid') {
      const r = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(h.w, h.d) / 2 * 0.95, 2.2, 4), mat(h.roof));
      r.position.set(0, y + wallH + 1.1, 0); r.rotation.y = Math.PI / 4; r.castShadow = true; g.add(r);
    } else if (h.roofType === 'cone') {
      const r = new THREE.Mesh(new THREE.ConeGeometry(h.w * 0.62, 2.4, 8), mat(h.roof));
      r.position.set(0, y + wallH + 1.2, 0); r.castShadow = true; g.add(r);
    } else { // gable (pelana): dua papan miring bertemu di bubungan
      const rise = h.d * 0.3;
      const half = h.d / 2 + 0.3;
      const slabLen = Math.hypot(half, rise) + 0.3;
      const ang = Math.atan2(rise, half);
      for (const s of [1, -1]) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(h.w + 0.8, 0.15, slabLen), mat(h.roof));
        slab.position.set(0, y + wallH + rise / 2, s * (h.d / 4 + 0.12));
        slab.rotation.x = s * ang; slab.castShadow = true; g.add(slab);
      }
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.15), mat(0x6e4a26));
    door.position.set(0, y + 1.05, h.d / 2 + 0.05); g.add(door);
    for (const wx of [-h.w / 4, h.w / 4]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.12), winMat);
      win.position.set(wx, y + 1.8, h.d / 2 + 0.05); g.add(win);
    }
    if (h.chimney) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7), mat(0x8d8578));
      ch.position.set(h.w / 4, y + wallH + 1.5, -h.d / 4); g.add(ch);
    }
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 0.8), mat(0x8d8578));
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
  const wellBase = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.1, 1.0, 8), mat(0x8d8578));
  wellBase.position.y = 0.5; wellBase.castShadow = true; well.add(wellBase);
  const wellDark = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.12, 8), mat(0x2b2118));
  wellDark.position.y = 1.02; well.add(wellDark);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.4, 6), mat(0x6e4a26));
    post.position.set(s * 0.95, 1.2, 0); well.add(post);
  }
  const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.0, 4), mat(0x8a4a2f));
  wellRoof.position.y = 2.9; wellRoof.rotation.y = Math.PI / 4; wellRoof.castShadow = true; well.add(wellRoof);
  well.position.set(SQUARE.x, wellY, SQUARE.z);
  group.add(well);
  colliders.push({ minX: SQUARE.x - 1.2, maxX: SQUARE.x + 1.2, minZ: SQUARE.z - 1.2, maxZ: SQUARE.z + 1.2 });
  for (const [bx, bz, ry] of [[12.5, -27.5, Math.PI * 0.75], [19.5, -34.5, -Math.PI * 0.25]]) {
    const by = terrainHeight(bx, bz);
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.5), mat(0x8a6b3f));
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
  const lakeWater = new THREE.Mesh(new THREE.CircleGeometry(1, 28),
    new THREE.MeshPhongMaterial({ color: 0x56a8d0, transparent: true, opacity: 0.7,
      shininess: 120, specular: 0xddf2ff }));
  lakeWater.geometry.rotateX(-Math.PI / 2);
  lakeWater.scale.set(LAKE.rx, 1, LAKE.rz);
  lakeWater.position.set(LAKE.x, 0.05, LAKE.z);
  group.add(lakeWater);
  const pier = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 1.6), mat(0x9a6b3f));
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
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 9, 8), mat(0xd8c9a8));
  tower.position.y = 4.5; tower.castShadow = true; windmill.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.0, 8), mat(0x8a4a2f));
  cap.position.y = 10; cap.castShadow = true; windmill.add(cap);
  const wmDoor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.15), mat(0x6e4a26));
  wmDoor.position.set(0, 1.0, 2.1); windmill.add(wmDoor);
  const wmWin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.12), winMat);
  wmWin.position.set(0, 6.5, 1.6); windmill.add(wmWin);
  const windmillRotor = new THREE.Group();
  windmillRotor.position.set(0, 8.6, 2.0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 8), mat(0x6e4a26));
  hub.rotation.x = Math.PI / 2; windmillRotor.add(hub);
  for (let k = 0; k < 4; k++) {
    const pivot = new THREE.Object3D();
    pivot.rotation.z = k * Math.PI / 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.2, 0.07), mat(0xf3e3c0));
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
  const fenceMat = mat(0x8a6b3f);
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
  const hayBase = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.9, 8), mat(0xd9a441));
  hayBase.position.y = 0.45; hayBase.castShadow = true; hay.add(hayBase);
  const hayTop = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.4, 8), mat(0xe8b84a));
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

  // ---- Pohon realistis (instanced): batang bercorak + cabang + tajuk
  // bergerombol + buah. 4 jenis: pinus (kerucut berlapis, tanpa buah), apel
  // (buah merah), jeruk (buah oranye), rindang (tajuk bulat, tanpa buah).
  // Semua penempatan pakai rnd() ber-seed — stabil antar load.
  const TREE_TYPES = ['pine', 'apple', 'orange', 'leafy'];
  const treeSpots = [];
  // Kebun buah: petak 4x4 di (48,48), apel/jeruk berselang.
  for (let gx = 0; gx < 4; gx++) for (let gz = 0; gz < 4; gz++) {
    const x = ORCHARD.x + (gx - 1.5) * 5.5 + (rnd() - 0.5) * 1.6;
    const z = ORCHARD.z + (gz - 1.5) * 5.5 + (rnd() - 0.5) * 1.6;
    treeSpots.push({ x, z, s: 0.9 + rnd() * 0.35, type: (gx + gz) % 2 === 0 ? 'apple' : 'orange' });
  }
  let guard = 0;
  while (treeSpots.length < 72 && guard++ < 1500) {
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
    if (treeSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    treeSpots.push({ x, z, s: 0.8 + rnd() * 0.6, type: TREE_TYPES[Math.floor(rnd() * 4)] });
  }
  // Susun daftar instans: batang, cabang (1-3/pohon), gumpalan tajuk (2-4/pohon
  // daun; pinus 2 kerucut), buah (4-7/pohon buah, menempel di tajuk).
  const barkCols = [0x5a3d24, 0x6e4a26, 0x7d5a33, 0x4a3419].map((c) => new THREE.Color(c));
  const crownA = new THREE.Color(0x35873a), crownB = new THREE.Color(0x7fb84f);
  const pineA = new THREE.Color(0x2e6b34), pineB = new THREE.Color(0x4a8f3c);
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
      coneList.push({ x: p.x, y: topY + 0.8 * p.s, z: p.z, rad: 1.7 * p.s, h: 2.6 * p.s });
      coneList.push({ x: p.x, y: topY + 2.0 * p.s, z: p.z, rad: 1.2 * p.s, h: 2.2 * p.s });
    } else {
      const nBl = 2 + Math.floor(rnd() * 3);
      const blobs = [];
      for (let b = 0; b < nBl; b++) {
        const a = rnd() * Math.PI * 2, rr = rnd() * 0.9 * p.s;
        const bl = { x: p.x + Math.cos(a) * rr, y: topY + 0.7 * p.s + (rnd() - 0.5) * 0.8 * p.s,
          z: p.z + Math.sin(a) * rr, s: (1.1 + rnd() * 0.6) * p.s };
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
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0xffffff), treeSpots.length);
  const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.09, 1, 5),
    mat(0xffffff), branchList.length);
  const crownBlobs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
    mat(0xffffff), blobList.length);
  const pineCones = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7),
    mat(0xffffff), coneList.length);
  const fruits = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 6, 5),
    mat(0xffffff), Math.max(1, fruitList.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  treeSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    m4.compose(new THREE.Vector3(p.x, y + 1.1 * p.s, p.z), q,
      new THREE.Vector3(p.thick * p.s, p.s, p.thick * p.s));
    trunks.setMatrixAt(i, m4);
    trunks.setColorAt(i, barkCols[p.bark]);
    colliders.push({ minX: p.x - 0.4, maxX: p.x + 0.4, minZ: p.z - 0.4, maxZ: p.z + 0.4 });
  });
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
  blobList.forEach((bl, i) => {
    m4.compose(new THREE.Vector3(bl.x, bl.y, bl.z), q, new THREE.Vector3(bl.s, bl.s * 0.85, bl.s));
    crownBlobs.setMatrixAt(i, m4);
    crownBlobs.setColorAt(i, crownA.clone().lerp(crownB, rnd()));
  });
  crownBlobs.instanceColor.needsUpdate = true;
  coneList.forEach((cn, i) => {
    m4.compose(new THREE.Vector3(cn.x, cn.y, cn.z), q, new THREE.Vector3(cn.rad, cn.h, cn.rad));
    pineCones.setMatrixAt(i, m4);
    pineCones.setColorAt(i, pineA.clone().lerp(pineB, rnd()));
  });
  pineCones.instanceColor.needsUpdate = true;
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
    if (Math.hypot(x - SQUARE.x, z - SQUARE.z) < 8) continue;
    if (rockSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 6)) continue;
    rockSpots.push({ x, z, s: 0.5 + rnd() * 0.9 });
  }
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(0x8d8578), rockSpots.length);
  rockSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    m4.compose(new THREE.Vector3(p.x, y + 0.3 * p.s, p.z), q, new THREE.Vector3(p.s, p.s * 0.7, p.s));
    rocks.setMatrixAt(i, m4);
    colliders.push({ minX: p.x - 0.7 * p.s, maxX: p.x + 0.7 * p.s, minZ: p.z - 0.7 * p.s, maxZ: p.z + 0.7 * p.s });
  });
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
    if (bushSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    bushSpots.push({ x, z, s: 0.5 + rnd() * 0.7 });
  }
  // Semak tambahan di padang bunga.
  for (let i = 0; i < 6; i++) {
    bushSpots.push({ x: MEADOW.x + (rnd() - 0.5) * 30, z: MEADOW.z + (rnd() - 0.5) * 22, s: 0.6 + rnd() * 0.6 });
  }
  const bushes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), mat(0x4a8f3c), bushSpots.length);
  const cBushA = new THREE.Color(0x3e7d32), cBushB = new THREE.Color(0x7fb84f);
  bushSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    m4.compose(new THREE.Vector3(p.x, y + 0.35 * p.s, p.z), q, new THREE.Vector3(p.s, p.s * 0.65, p.s));
    bushes.setMatrixAt(i, m4);
    bushes.setColorAt(i, cBushA.clone().lerp(cBushB, rnd()));
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
    if (rock2Spots.some((p) => Math.hypot(p.x - x, p.z - z) < 7)) continue;
    rock2Spots.push({ x, z, s: 0.4 + rnd() * 0.8, rot: rnd() * Math.PI });
  }
  const rocks2 = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat(0x8d8578), rock2Spots.length);
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
    flowerSpots.push({ x, z });
  }
  // Padang bunga luas: 120 bunga padat di sekitar (-50,-55).
  guard = 0;
  while (flowerSpots.length < 210 && guard++ < 1200) {
    const x = MEADOW.x + (rnd() - 0.5) * (MEADOW.rx * 2);
    const z = MEADOW.z + (rnd() - 0.5) * (MEADOW.rz * 2);
    if (Math.abs(x - riverCenterX(z)) < 5.5) continue;
    if (distToPaths(x, z) < 2) continue;
    flowerSpots.push({ x, z });
  }
  const flowerStems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.03, 0.35, 4),
    mat(0x4a7d2e), flowerSpots.length);
  const flowerHeads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5),
    mat(0xffffff), flowerSpots.length);
  const flowerPalette = [0xe8a0b8, 0xf2d06b, 0xf5f2e8, 0xb9a7e6, 0xf0a35e].map((c) => new THREE.Color(c));
  flowerSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    m4.compose(new THREE.Vector3(p.x, y + 0.17, p.z), q, new THREE.Vector3(1, 1, 1));
    flowerStems.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(p.x, y + 0.38, p.z), q, new THREE.Vector3(1, 1, 1));
    flowerHeads.setMatrixAt(i, m4);
    flowerHeads.setColorAt(i, flowerPalette[Math.floor(rnd() * flowerPalette.length)]);
  });
  flowerHeads.instanceColor.needsUpdate = true;
  group.add(flowerStems); group.add(flowerHeads);

  // ---- Rumput bergoyang (instanced, 420 tuft; goyang di update(), mati di low)
  const grassData = [];
  guard = 0;
  while (grassData.length < 420 && guard++ < 4000) {
    const x = (rnd() - 0.5) * 224, z = (rnd() - 0.5) * 224;
    const r = Math.hypot(x, z);
    if (r < 6 || r > 112) continue;
    if (Math.abs(x - riverCenterX(z)) < 5) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (x > PEN.minX - 2 && x < PEN.maxX + 2 && z > PEN.minZ - 2 && z < PEN.maxZ + 2) continue;
    if (Math.abs(z + 17) < 2.2 && x > -12 && x < 12) continue;
    if (distToPaths(x, z) < 1.8) continue;
    if (insideHouseFootprints(x, z, 1.5)) continue;
    grassData.push({ x, z, y: terrainHeight(x, z), s: 0.7 + rnd() * 0.9, ph: rnd() * Math.PI * 2 });
  }
  const grassTufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.09, 0.55, 4),
    mat(0x6da344), grassData.length);
  grassTufts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const cGrassTuftA = new THREE.Color(0x5da244), cGrassTuftB = new THREE.Color(0x9ccb5e);
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

  // ---- Peti kayu yang bisa didorong
  const crate = new THREE.Group();
  const crateMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat(0xa97c50));
  crateMesh.castShadow = true; crateMesh.receiveShadow = true;
  crate.add(crateMesh);
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.25, 1.46), mat(0x6e4a26));
  crate.add(band);
  crate.position.set(CRATE_START.x, terrainHeight(CRATE_START.x, CRATE_START.z) + 0.7, CRATE_START.z);
  group.add(crate);

  // ---- Awan bergerak: gumpalan low-poly (1 InstancedMesh, drift pelan, wrap)
  const cloudPuffs = [];
  for (let c = 0; c < 7; c++) {
    const cx = rnd() * 260 - 130, cy = 30 + rnd() * 10, cz = rnd() * 220 - 110;
    const n = 3 + Math.floor(rnd() * 3);
    const drift = 0.6 + rnd() * 0.7;
    for (let k = 0; k < n; k++) {
      cloudPuffs.push({ x: cx + (rnd() - 0.5) * 7, y: cy + (rnd() - 0.5) * 1.6,
        z: cz + (rnd() - 0.5) * 3, s: 2.2 + rnd() * 2.4, drift });
    }
  }
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false });
  const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), cloudMat, cloudPuffs.length);
  clouds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cloudPuffs.forEach((p, i) => {
    _dummy.position.set(p.x, p.y, p.z);
    _dummy.rotation.set(0, 0, 0);
    _dummy.scale.set(p.s, p.s * 0.55, p.s * 0.8);
    _dummy.updateMatrix();
    clouds.setMatrixAt(i, _dummy.matrix);
  });
  group.add(clouds);

  // ---- Partikel halus: serbuk sari (siang) + kunang-kunang (malam).
  // THREE.Points, jumlah kecil; visibilitas diatur update() + setQuality().
  function makePoints(n, color, size) {
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (rnd() - 0.5) * 70;
      arr[i * 3 + 1] = 1 + rnd() * 4;
      arr[i * 3 + 2] = (rnd() - 0.5) * 70;
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
  group.add(pollen); group.add(fireflies);

  // ---- Kupu-kupu: 4 ekor, sayap mengepak (2 pivot + 2 plane per ekor).
  const butterflies = [];
  const butterflyCols = [0xf0a35e, 0xf5f2e8, 0x9ab8e8, 0xf2d06b];
  for (let b = 0; b < 4; b++) {
    const bg = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mat(0x2b2118));
    body.rotation.x = Math.PI / 2; bg.add(body);
    const wings = [];
    const wmat = new THREE.MeshLambertMaterial({ color: butterflyCols[b], side: THREE.DoubleSide });
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

  // ---- Matahari + cahaya
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
  sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
  sun.shadow.camera.far = 300; sun.shadow.bias = -0.0005;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x6a8f4f, 0.9);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffe0b3, 0.35);
  scene.add(amb);
  scene.fog = new THREE.Fog(0xf6c98a, 90, 320);

  // Palet waktu (keyframe menit -> warna langit, matahari, kabut, awan).
  // Diinterpolasi linear; malam = cahaya bulan biru redup.
  const SKY_STOPS = [
    { m: 360,  top: 0x8fb8dd, hor: 0xffc98a, fog: 0xf2c184, sun: 0xffb36b, sunI: 1.6, hemiSky: 0xaac4e0, hemiI: 0.7, ambI: 0.3, cloud: 0xffe3c2 },
    { m: 540,  top: 0x6fb3ef, hor: 0xcfe8f5, fog: 0xd8e8ee, sun: 0xffe3b3, sunI: 2.2, hemiSky: 0xbfd9ff, hemiI: 0.9, ambI: 0.35, cloud: 0xffffff },
    { m: 720,  top: 0x4f9fe8, hor: 0xbfe3f2, fog: 0xd6e6ea, sun: 0xfff2cc, sunI: 2.4, hemiSky: 0xcfe4ff, hemiI: 1.0, ambI: 0.4, cloud: 0xffffff },
    { m: 960,  top: 0x6aa8e0, hor: 0xffe0ae, fog: 0xf0d9ac, sun: 0xffd9a0, sunI: 2.2, hemiSky: 0xbfd9ff, hemiI: 0.9, ambI: 0.35, cloud: 0xfff2d8 },
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
  };
  const view = { fogNear: 90, fogFar: 320, camFar: 600 };

  return {
    group, colliders, water, waterTex, foam, sun, hemi, amb, lamp, crate, crateMesh,
    doorPos, shopPos, penGate, bedroom, minimapData, view,
    counts: { trees: treeSpots.length, fruitTrees, fruits: fruitList.length, houses: 1 + NEW_HOUSES.length },
    setQuality(q) {
      quality = q || 'medium';
      grassSway = quality !== 'low';
      // Partikel + kupu-kupu mati total di low; update() mengatur sisanya per waktu.
      if (quality === 'low') {
        pollen.visible = false; fireflies.visible = false;
        for (const bf of butterflies) bf.group.visible = false;
      } else {
        for (const bf of butterflies) bf.group.visible = true;
      }
    },
    update(dt, minutes) {
      elapsed += dt;
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
      // Awan drift pelan ke timur, wrap di tepi.
      for (let i = 0; i < cloudPuffs.length; i++) {
        const p = cloudPuffs[i];
        p.x += p.drift * dt;
        if (p.x > 140) p.x = -140;
        _dummy.position.set(p.x, p.y, p.z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(p.s, p.s * 0.55, p.s * 0.8);
        _dummy.updateMatrix();
        clouds.setMatrixAt(i, _dummy.matrix);
      }
      clouds.instanceMatrix.needsUpdate = true;
      // Rumput bergoyang (hanya medium/high).
      if (grassSway) {
        for (let i = 0; i < grassData.length; i++) {
          const g = grassData[i];
          _dummy.position.set(g.x, g.y + 0.25 * g.s, g.z);
          _dummy.rotation.set(Math.cos(elapsed * 1.3 + g.ph) * 0.08, 0, Math.sin(elapsed * 1.4 + g.ph) * 0.12);
          _dummy.scale.set(g.s, g.s, g.s);
          _dummy.updateMatrix();
          grassTufts.setMatrixAt(i, _dummy.matrix);
        }
        grassTufts.instanceMatrix.needsUpdate = true;
      }
      // Kincir angin berputar pelan (baling-baling menghadap selatan/desa).
      windmillRotor.rotation.z += dt * 0.6;
      // Partikel: serbuk sari siang (06:00–18:00), kunang-kunang senja/malam.
      const rich = quality !== 'low';
      const isDay = minutes >= 360 && minutes < 1080;
      const isNight = minutes >= 1020 || minutes < 360;
      pollen.visible = rich && isDay;
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
      // Kupu-kupu: siang saja, melayang di sekitar kebun, sayap mengepak.
      const bfOn = rich && minutes >= 420 && minutes < 1020;
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
      skyUniforms.topColor.value.copy(pal.top);
      skyUniforms.horizonColor.value.copy(pal.hor);
      scene.fog.color.copy(pal.fog);
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
    },
  };
}
