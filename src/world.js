// world.js — lembah pastoral low-poly: terrain, pegunungan, sungai mengalir,
// jembatan kayu, rumah, kios toko, kandang, jalan tanah, pohon (instanced), pagar.
import * as THREE from 'three';
import { terrainHeight, riverCenterX, RIVER_HALF, BRIDGE_Z, noise2, smoothstep } from './physics.js';

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

  // ---- Terrain: plane 170x170, warna per-vertex (rumput / pasir sungai / batu gunung)
  const SIZE = 170, SEG = 110;
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
    if (f > 0.86 && r < 58 && dRiver > 5) {
      const pick = noise2(x * 3.7, z * 3.7);
      const bc = pick > 0.33 ? cBloomPink : pick > 0 ? cBloomYellow
        : pick > -0.33 ? cBloomWhite : cBloomLav;
      c.lerp(bc, 0.35);
    }
    if (dRiver < 4.5) c = cSand.clone().lerp(cGrassA, smoothstep(3.6, 4.5, dRiver) * 0.3);
    if (r > 60) c = c.lerp(cRock, smoothstep(60, 80, r));
    if (h > 16) c = c.lerp(cSnow, smoothstep(16, 22, h));
    // Jalan tanah: jalur rumah -> kebun -> kandang -> jembatan, tepi lembut.
    let pb = 0;
    if (x > -12 && x < 12) pb = Math.max(pb, pathBlend(Math.abs(z + 17)));
    if (z > -17 && z < 12) pb = Math.max(pb, pathBlend(Math.abs(x - 9)));
    if (x > -28 && x < 9) pb = Math.max(pb, pathBlend(Math.abs(z - BRIDGE_Z)));
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
  const skyUniforms = {
    topColor: { value: new THREE.Color(0x6fb3ef) },
    horizonColor: { value: new THREE.Color(0xcfe8f5) },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 24, 12),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 topColor; uniform vec3 horizonColor; varying vec3 vP; void main(){ float h = normalize(vP).y; float k = pow(max(h, 0.0), 0.55); gl_FragColor = vec4(mix(horizonColor, topColor, k), 1.0); }',
    }),
  );
  scene.add(sky);

  // ---- Pegunungan berlapis di kejauhan: 2 cincin kerucut low-poly + salju.
  // Duduk di luar terrain (r 98–150); kabut (fog far 230) yang menyatukannya.
  const mtnSpots = [];
  for (let i = 0; i < 16; i++) { // cincin dekat: hijau-abu
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
    const r = 98 + rnd() * 20;
    mtnSpots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r,
      h: 26 + rnd() * 18, rad: 16 + rnd() * 10, near: true });
  }
  for (let i = 0; i < 12; i++) { // cincin jauh: biru-abu, lebih tinggi
    const a = (i / 12) * Math.PI * 2 + 0.26 + rnd() * 0.3;
    const r = 128 + rnd() * 22;
    mtnSpots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r,
      h: 42 + rnd() * 20, rad: 24 + rnd() * 12, near: false });
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
  const waterCanvas = document.createElement('canvas');
  waterCanvas.width = 128; waterCanvas.height = 128;
  const wc = waterCanvas.getContext('2d');
  wc.fillStyle = '#3f8fbf'; wc.fillRect(0, 0, 128, 128);
  wc.strokeStyle = 'rgba(255,255,255,0.55)'; wc.lineWidth = 3;
  for (let i = 0; i < 10; i++) {
    wc.beginPath();
    wc.moveTo(0, i * 13 + 4);
    wc.bezierCurveTo(40, i * 13, 80, i * 13 + 8, 128, i * 13 + 2);
    wc.stroke();
  }
  const waterTex = new THREE.CanvasTexture(waterCanvas);
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(1, 14);
  const waterGeo = new THREE.PlaneGeometry(RIVER_HALF * 2 + 1, SIZE, 1, 40);
  waterGeo.rotateX(-Math.PI / 2);
  const wpos = waterGeo.attributes.position;
  for (let i = 0; i < wpos.count; i++) {
    const z = wpos.getZ(i);
    wpos.setX(i, riverCenterX(z) + wpos.getX(i));
  }
  waterGeo.computeVertexNormals();
  // Phong: kilau specular matahari di permukaan + tekstur mengalir + riak vertex.
  const water = new THREE.Mesh(waterGeo, new THREE.MeshPhongMaterial({
    map: waterTex, transparent: true, opacity: 0.88,
    shininess: 140, specular: 0xbbddff,
  }));
  water.position.y = 0.45;
  group.add(water);
  const waterBase = waterGeo.attributes.position.array.slice(); // posisi dasar utk riak

  // ---- Jembatan kayu (papan + tiang + tali)
  const bridge = new THREE.Group();
  const plankMat = mat(0x9a6b3f), postMat = mat(0x6e4a26);
  for (let i = 0; i < 9; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 1.5), plankMat);
    plank.position.set(-24 + (i - 4) * 1.55, 1.0, BRIDGE_Z);
    plank.castShadow = true; bridge.add(plank);
  }
  for (const [px, pz] of [[-30.5, BRIDGE_Z - 2], [-30.5, BRIDGE_Z + 2], [-17.5, BRIDGE_Z - 2], [-17.5, BRIDGE_Z + 2]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.6, 6), postMat);
    post.position.set(px, 1.4, pz); bridge.add(post);
  }
  group.add(bridge);

  // ---- Rumah pemain (dinding krem, atap limas coklat, pintu, jendela, cerobong)
  const house = new THREE.Group();
  const hx = (HOUSE.minX + HOUSE.maxX) / 2, hz = (HOUSE.minZ + HOUSE.maxZ) / 2;
  const hy = terrainHeight(hx, hz);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 6), mat(0xf3e3c0));
  walls.position.set(hx, hy + 1.7, hz); walls.castShadow = true; walls.receiveShadow = true;
  house.add(walls);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 2.6, 4), mat(0x9a4a2f));
  roof.position.set(hx, hy + 4.7, hz); roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  house.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.2), mat(0x6e4a26));
  door.position.set(hx, hy + 1.1, hz + 3.05); house.add(door);
  // Jendela menyala hangat — emissive dinaikkan saat senja/malam di update().
  const winMat = new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0xff9a3c, emissiveIntensity: 0.25 });
  for (const wx of [hx - 2.4, hx + 2.4]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.15), winMat);
    win.position.set(wx, hy + 1.9, hz + 3.05); house.add(win);
    // Daun jendela kayu + palang tengah.
    for (const s of [-1, 1]) {
      const shut = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.08), mat(0x6e4a26));
      shut.position.set(wx + s * 0.8, hy + 1.9, hz + 3.05); house.add(shut);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.05), mat(0x6e4a26));
    cross.position.set(wx, hy + 1.9, hz + 3.14); house.add(cross);
  }
  // Anak tangga batu di depan pintu.
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 0.9), mat(0x8d8578));
  step.position.set(hx, hy + 0.12, hz + 3.4); step.receiveShadow = true; house.add(step);
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

  // ---- Pohon (instanced: batang + tajuk), tersebar menghindari area penting
  const treeSpots = [];
  let guard = 0;
  while (treeSpots.length < 42 && guard++ < 600) {
    const x = (Math.random() - 0.5) * 130, z = (Math.random() - 0.5) * 130;
    const r = Math.hypot(x, z);
    if (r > 62 || r < 8) continue;
    if (Math.hypot(x - 6, z - 20) < 10) continue;               // area spawn pembuka — kamera awal harus bersih
    if (x > -6 && x < 18 && z > 20 && z < 36) continue;         // koridor kamera selatan spawn — pohon di sini menutupi pemain
    if (Math.abs(x - riverCenterX(z)) < 7) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;             // kebun
    if (x > PEN.minX - 3 && x < PEN.maxX + 3 && z > PEN.minZ - 3 && z < PEN.maxZ + 3) continue;
    if (x > -14 && x < 8 && z > -28 && z < -16) continue;        // rumah + toko
    if (Math.abs(z + 17) < 3 && x > -12 && x < 12) continue;     // jalan
    if (treeSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    treeSpots.push({ x, z, s: 0.8 + Math.random() * 0.6 });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 6);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6e4a26), treeSpots.length);
  // 3 bentuk tajuk: kerucut (pinus), bulat, berlapis (2 kerucut) — per pohon i % 3.
  const typeCount = [0, 0, 0];
  treeSpots.forEach((p, i) => { typeCount[i % 3] += 1; });
  const coneCrowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 3.4, 7), mat(0x4a8f3c), typeCount[0]);
  const roundCrowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 0), mat(0x5da244), typeCount[1]);
  const layerLow = new THREE.InstancedMesh(new THREE.ConeGeometry(1.9, 2.2, 7), mat(0x35873a), typeCount[2]);
  const layerHigh = new THREE.InstancedMesh(new THREE.ConeGeometry(1.3, 2.0, 7), mat(0x4a8f3c), typeCount[2]);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const cCrownA = new THREE.Color(0x35873a), cCrownB = new THREE.Color(0x7fb84f);
  const crownIdx = [0, 0, 0];
  treeSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    m4.compose(new THREE.Vector3(p.x, y + 1.1 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
    trunks.setMatrixAt(i, m4);
    const ty = i % 3;
    const tint = cCrownA.clone().lerp(cCrownB, rnd() * 0.7);
    if (ty === 0) {
      m4.compose(new THREE.Vector3(p.x, y + (2.2 + 1.5) * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      coneCrowns.setMatrixAt(crownIdx[0], m4);
      coneCrowns.setColorAt(crownIdx[0], tint); crownIdx[0] += 1;
    } else if (ty === 1) {
      m4.compose(new THREE.Vector3(p.x, y + 3.4 * p.s, p.z), q, new THREE.Vector3(p.s, p.s * 0.9, p.s));
      roundCrowns.setMatrixAt(crownIdx[1], m4);
      roundCrowns.setColorAt(crownIdx[1], tint); crownIdx[1] += 1;
    } else {
      m4.compose(new THREE.Vector3(p.x, y + 3.0 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      layerLow.setMatrixAt(crownIdx[2], m4);
      layerLow.setColorAt(crownIdx[2], tint);
      m4.compose(new THREE.Vector3(p.x, y + 4.3 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      layerHigh.setMatrixAt(crownIdx[2], m4);
      layerHigh.setColorAt(crownIdx[2], tint.clone().lerp(cCrownB, 0.3)); crownIdx[2] += 1;
    }
    colliders.push({ minX: p.x - 0.4, maxX: p.x + 0.4, minZ: p.z - 0.4, maxZ: p.z + 0.4 });
  });
  for (const cm of [coneCrowns, roundCrowns, layerLow, layerHigh]) {
    cm.instanceColor.needsUpdate = true;
    cm.castShadow = true;
    group.add(cm);
  }
  trunks.castShadow = true;
  group.add(trunks);

  // ---- Batu-batu (instanced dodecahedron)
  const rockSpots = [];
  guard = 0;
  while (rockSpots.length < 16 && guard++ < 400) {
    const x = (Math.random() - 0.5) * 110, z = (Math.random() - 0.5) * 110;
    if (Math.hypot(x, z) < 10 || Math.hypot(x, z) > 60) continue;
    if (Math.abs(x - riverCenterX(z)) < 6) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (rockSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 6)) continue;
    rockSpots.push({ x, z, s: 0.5 + Math.random() * 0.9 });
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
  while (bushSpots.length < 24 && guard++ < 500) {
    const x = (rnd() - 0.5) * 120, z = (rnd() - 0.5) * 120;
    const r = Math.hypot(x, z);
    if (r < 10 || r > 60) continue;
    if (Math.abs(x - riverCenterX(z)) < 6) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (x > PEN.minX - 3 && x < PEN.maxX + 3 && z > PEN.minZ - 3 && z < PEN.maxZ + 3) continue;
    if (bushSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    bushSpots.push({ x, z, s: 0.5 + rnd() * 0.7 });
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
  while (rock2Spots.length < 12 && guard++ < 400) {
    const x = (rnd() - 0.5) * 110, z = (rnd() - 0.5) * 110;
    if (Math.hypot(x, z) < 25 || Math.hypot(x, z) > 58) continue;
    if (Math.abs(x - riverCenterX(z)) < 6) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (x > PEN.minX - 3 && x < PEN.maxX + 3 && z > PEN.minZ - 3 && z < PEN.maxZ + 3) continue;
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
    const x = (rnd() - 0.5) * 110, z = (rnd() - 0.5) * 110;
    const r = Math.hypot(x, z);
    if (r < 8 || r > 55) continue;
    if (Math.abs(x - riverCenterX(z)) < 5.5) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (x > PEN.minX - 2 && x < PEN.maxX + 2 && z > PEN.minZ - 2 && z < PEN.maxZ + 2) continue;
    if (x > -14 && x < 8 && z > -28 && z < -16) continue;
    if (Math.abs(z + 17) < 2.5 && x > -12 && x < 12) continue;
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

  // ---- Rumput bergoyang (instanced, 320 tuft; goyang di update(), mati di low)
  const grassData = [];
  guard = 0;
  while (grassData.length < 320 && guard++ < 3000) {
    const x = (rnd() - 0.5) * 120, z = (rnd() - 0.5) * 120;
    const r = Math.hypot(x, z);
    if (r < 6 || r > 58) continue;
    if (Math.abs(x - riverCenterX(z)) < 5) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;
    if (x > PEN.minX - 2 && x < PEN.maxX + 2 && z > PEN.minZ - 2 && z < PEN.maxZ + 2) continue;
    if (Math.abs(z + 17) < 2.2 && x > -12 && x < 12) continue;
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
    const cx = rnd() * 160 - 80, cy = 30 + rnd() * 10, cz = rnd() * 140 - 70;
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
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  sun.shadow.camera.far = 220; sun.shadow.bias = -0.0005;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x6a8f4f, 0.9);
  scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffe0b3, 0.35);
  scene.add(amb);
  scene.fog = new THREE.Fog(0xf6c98a, 80, 230);

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

  return {
    group, colliders, water, waterTex, sun, hemi, amb, lamp, crate, crateMesh,
    doorPos, shopPos, penGate,
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
      // Air mengalir (offset tekstur) + riak halus per-vertex.
      waterTex.offset.y -= dt * 0.12;
      waterTex.offset.x += dt * 0.015;
      const wp = water.geometry.attributes.position;
      for (let i = 0; i < wp.count; i++) {
        wp.setY(i, Math.sin(waterBase[i * 3 + 2] * 0.9 + elapsed * 2.2 + waterBase[i * 3] * 0.6) * 0.06);
      }
      wp.needsUpdate = true;
      // Awan drift pelan ke timur, wrap di tepi.
      for (let i = 0; i < cloudPuffs.length; i++) {
        const p = cloudPuffs[i];
        p.x += p.drift * dt;
        if (p.x > 95) p.x = -95;
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
