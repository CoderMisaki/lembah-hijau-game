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

  // ---- Terrain: plane 170x170, warna per-vertex (rumput / pasir sungai / batu gunung)
  const SIZE = 170, SEG = 110;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cGrassA = new THREE.Color(0x5da244), cGrassB = new THREE.Color(0x7fb84f);
  const cSand = new THREE.Color(0xc2a878), cRock = new THREE.Color(0x8d8578);
  const cSnow = new THREE.Color(0xf4f8ff), cDirt = new THREE.Color(0x9a7b4f);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const r = Math.hypot(x, z);
    const n = noise2(x * 0.7, z * 0.7) * 0.5 + 0.5;
    let c = cGrassA.clone().lerp(cGrassB, n);
    const dRiver = Math.abs(x - riverCenterX(z));
    if (dRiver < 4.5) c = cSand.clone();
    if (r > 60) c = c.lerp(cRock, smoothstep(60, 80, r));
    if (h > 16) c = c.lerp(cSnow, smoothstep(16, 22, h));
    // Jalan tanah: jalur rumah -> kebun -> kandang -> jembatan.
    if (Math.abs(z + 17) < 1.6 && x > -12 && x < 12) c = cDirt.clone();
    if (Math.abs(x - 9) < 1.6 && z > -17 && z < 12) c = cDirt.clone();
    if (Math.abs(z - BRIDGE_Z) < 1.6 && x > -28 && x < 9) c = cDirt.clone();
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.receiveShadow = true;
  group.add(terrain);

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
  const water = new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({
    map: waterTex, transparent: true, opacity: 0.85,
  }));
  water.position.y = 0.45;
  group.add(water);

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
  const winMatFixed = new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0x664411 });
  for (const wx of [hx - 2.4, hx + 2.4]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.15), winMatFixed);
    win.position.set(wx, hy + 1.9, hz + 3.05); house.add(win);
  }
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
    if (Math.abs(x - riverCenterX(z)) < 7) continue;
    if (x > 8 && x < 32 && z > 0 && z < 16) continue;             // kebun
    if (x > PEN.minX - 3 && x < PEN.maxX + 3 && z > PEN.minZ - 3 && z < PEN.maxZ + 3) continue;
    if (x > -14 && x < 8 && z > -28 && z < -16) continue;        // rumah + toko
    if (Math.abs(z + 17) < 3 && x > -12 && x < 12) continue;     // jalan
    if (treeSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
    treeSpots.push({ x, z, s: 0.8 + Math.random() * 0.9 });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.2, 6);
  const crownGeo = new THREE.ConeGeometry(1.7, 3.4, 7);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x6e4a26), treeSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, mat(0x3e7d32), treeSpots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  treeSpots.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    m4.compose(new THREE.Vector3(p.x, y + 1.1 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
    trunks.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(p.x, y + (2.2 + 1.5) * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
    crowns.setMatrixAt(i, m4);
    colliders.push({ minX: p.x - 0.4, maxX: p.x + 0.4, minZ: p.z - 0.4, maxZ: p.z + 0.4 });
  });
  trunks.castShadow = true; crowns.castShadow = true;
  group.add(trunks); group.add(crowns);

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

  // ---- Peti kayu yang bisa didorong
  const crate = new THREE.Group();
  const crateMesh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat(0xa97c50));
  crateMesh.castShadow = true; crateMesh.receiveShadow = true;
  crate.add(crateMesh);
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.25, 1.46), mat(0x6e4a26));
  crate.add(band);
  crate.position.set(CRATE_START.x, terrainHeight(CRATE_START.x, CRATE_START.z) + 0.7, CRATE_START.z);
  group.add(crate);

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
  scene.fog = new THREE.Fog(0xf6c98a, 70, 160);

  return {
    group, colliders, water, waterTex, sun, hemi, amb, lamp, crate, crateMesh,
    doorPos, shopPos, penGate,
    update(dt, minutes) {
      // Air mengalir (offset tekstur).
      waterTex.offset.y -= dt * 0.12;
      waterTex.offset.x += dt * 0.015;
      // Matahari bergerak 06:00 (timur, rendah) -> 12:00 (tinggi) -> 22:00 (terbenam).
      const dayFrac = THREE.MathUtils.clamp((minutes - 360) / 960, 0, 1);
      const ang = Math.PI * (0.08 + dayFrac * 0.84);
      const elev = Math.sin(ang);
      sun.position.set(Math.cos(ang) * 70, Math.max(8, elev * 70), 30);
      const night = minutes >= 1140 || minutes < 360; // >=19:00 gelap
      const dusk = THREE.MathUtils.clamp((minutes - 1020) / 120, 0, 1); // 17:00-19:00 senja
      sun.intensity = 2.2 - dusk * 1.7;
      sun.color.setHSL(0.09 - dusk * 0.04, 0.75, 0.62 - dusk * 0.08);
      hemi.intensity = 0.9 - dusk * 0.55;
      amb.intensity = 0.35 - dusk * 0.2;
      scene.fog.color.setHSL(0.08, 0.6, 0.75 - dusk * 0.35);
      lamp.intensity = night || dusk > 0.5 ? 30 : 0;
    },
  };
}
