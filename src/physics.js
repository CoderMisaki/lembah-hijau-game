// physics.js — fisika kustom deterministik (tanpa engine fisika eksternal).
// Gravitasi ~22 m/s^2, lompat v0 ~8 m/s, gerak akselerasi + friksi + momentum.

export const GRAVITY = 22;
export const JUMP_VELOCITY = 8;
export const MAX_SPEED = 6;
export const ACCEL = 30;
export const FRICTION = 10;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, k) => a + (b - a) * k;
// Batas jalan pemain (dipakai player.js teleport/update + DynamicBox).
export const PLAY_BOUND = 120;
// Zona baru (Lane W): danau kedua, bukit kincir, padang bunga, kebun buah, alun-alun.
export const LAKE = { x: 58, z: -58, rx: 14, rz: 10 };      // danau (timur laut)
export const WINDMILL = { x: -58, z: 55 };                  // bukit kincir angin (barat daya)
export const MEADOW = { x: -50, z: -55, rx: 18, rz: 14 };   // padang bunga (barat laut)
export const ORCHARD = { x: 48, z: 48 };                    // kebun buah (tenggara)
export const SQUARE = { x: 16, z: -31 };                    // alun-alun desa (utara)
export const smoothstep = (a, b, x) => {
  const k = clamp((x - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

// Noise halus deterministik (sinus bertumpuk) untuk variasi terrain.
export function noise2(x, z) {
  return Math.sin(x * 0.13 + z * 0.07) * 0.6
    + Math.sin(x * 0.031 - z * 0.043) * 1.0
    + Math.sin((x + z) * 0.021) * 0.5;
}

// Sungai mengalir utara–selatan, pusat x bergelombang terhadap z.
export function riverCenterX(z) { return -24 + 4 * Math.sin(z * 0.05); }
export const RIVER_HALF = 3.4;
export const BRIDGE_Z = 6;      // jembatan kayu di z = 6
export const BRIDGE_HALF = 2.4; // lebar jembatan (sumbu z)
export const BRIDGE_DECK_Y = 0.65; // permukaan jalan papan jembatan (di atas air 0.45)
export const BRIDGE_RAMP_LEN = 3.3; // panjang tanjakan tiap ujung jembatan (sumbu x)
export const BRIDGE_DECK_MIN_X = -30.2, BRIDGE_DECK_MAX_X = -17.8; // bentang papan
export const BRIDGE_WALK_HALF = 0.9; // setengah lebar jalan kaki di atas papan (papan 1.5 + margin 0.15)

// Tinggi pijakan di koridor jembatan: tanjakan landai -> deck -> tanjakan.
// Di luar koridor mengembalikan terrainHeight, jadi sambungan ke daratan
// kontinu (tanpa lompatan): di ujung tanjakan tingginya persis terrain.
// (Deck lama y=1.0 tanpa tanjakan: pemain melompat ~1.7 m dari tepi ke deck.)
export function bridgeHeight(x, z) {
  if (Math.abs(z - BRIDGE_Z) >= BRIDGE_WALK_HALF) return terrainHeight(x, z);
  if (x >= BRIDGE_DECK_MIN_X && x <= BRIDGE_DECK_MAX_X) return BRIDGE_DECK_Y;
  if (x > BRIDGE_DECK_MAX_X && x <= BRIDGE_DECK_MAX_X + BRIDGE_RAMP_LEN) {
    const t = (x - BRIDGE_DECK_MAX_X) / BRIDGE_RAMP_LEN; // 0 deck -> 1 tepi
    return BRIDGE_DECK_Y + (terrainHeight(BRIDGE_DECK_MAX_X + BRIDGE_RAMP_LEN, z) - BRIDGE_DECK_Y) * t;
  }
  if (x < BRIDGE_DECK_MIN_X && x >= BRIDGE_DECK_MIN_X - BRIDGE_RAMP_LEN) {
    const t = (BRIDGE_DECK_MIN_X - x) / BRIDGE_RAMP_LEN;
    return BRIDGE_DECK_Y + (terrainHeight(BRIDGE_DECK_MIN_X - BRIDGE_RAMP_LEN, z) - BRIDGE_DECK_Y) * t;
  }
  return terrainHeight(x, z);
}

export const WATER_Y = 0.45; // permukaan air sungai (sinkron dengan world.js)
export function waterDepth(x, z) { return WATER_Y - terrainHeight(x, z); }
export function riverDistance(x, z) { return Math.max(0, Math.abs(x - riverCenterX(z)) - RIVER_HALF); }

export function isOnBridge(x, z) {
  return Math.abs(z - BRIDGE_Z) < BRIDGE_HALF && x > -32 && x < -16;
}
export function isInRiver(x, z) {
  return Math.abs(x - riverCenterX(z)) < RIVER_HALF && !isOnBridge(x, z);
}

// Tinggi terrain h(x,z): lembah landai di tengah, pegunungan di tepi,
// cekungan dangkal di sepanjang sungai + danau, bukit kincir di barat daya.
// Cincin pegunungan digeser ke luar (mulai r~95) supaya area playable r<~110 tetap landai.
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = noise2(x, z) * 0.55;
  h += smoothstep(95, 140, r) * 20;                   // cincin pegunungan
  h += smoothstep(115, 150, r) * 14;
  const dRiver = Math.abs(x - riverCenterX(z));
  h -= Math.max(0, 1 - dRiver / 7) * 1.6;             // lembah sungai
  // Cekungan danau (elips): dasar ~-0,9 m, air dangkal untuk berendam kaki.
  const le = ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2;
  h -= (1 - smoothstep(0.6, 1, le)) * 0.9;
  // Bukit kincir: gundukan gauss lembut (puncak +4,2 m, sigma 20 m).
  const hd = Math.hypot(x - WINDMILL.x, z - WINDMILL.z);
  h += 4.2 * Math.exp(-(hd * hd) / (2 * 20 * 20));
  return h;
}

// Resolve lingkaran (pemain/hewan) vs daftar AABB statis {minX,maxX,minZ,maxZ}.
// Mengembalikan posisi terkoreksi (dorong-keluar).
export function resolveCircleVsAABBs(x, z, radius, colliders) {
  for (const c of colliders) {
    const cx = clamp(x, c.minX, c.maxX);
    const cz = clamp(z, c.minZ, c.maxZ);
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * radius;
        z = cz + (dz / d) * radius;
      } else {
        // Pusat tepat di dalam kotak: dorong keluar lewat sisi terdekat.
        const pushL = x - c.minX + radius, pushR = c.maxX - x + radius;
        const pushT = z - c.minZ + radius, pushB = c.maxZ - z + radius;
        const m = Math.min(pushL, pushR, pushT, pushB);
        if (m === pushL) x = c.minX - radius;
        else if (m === pushR) x = c.maxX + radius;
        else if (m === pushT) z = c.minZ - radius;
        else z = c.maxZ + radius;
      }
    }
  }
  return { x, z };
}

export function circleHitsAABB(x, z, radius, c) {
  const cx = clamp(x, c.minX, c.maxX);
  const cz = clamp(z, c.minZ, c.maxZ);
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < radius * radius;
}

// Kotak dinamis yang bisa didorong (peti/bola): kecepatan + friksi +
// gravitasi (menempel terrain) + tabrakan vs AABB statis + dorongan pemain.
export class DynamicBox {
  constructor(x, z, half = 0.7) {
    this.x = x; this.z = z; this.half = half;
    this.vx = 0; this.vz = 0;
  }
  aabb() {
    return { minX: this.x - this.half, maxX: this.x + this.half,
             minZ: this.z - this.half, maxZ: this.z + this.half };
  }
  get y() { return terrainHeight(this.x, this.z); }
  // Dorongan dari pemain: pindahkan sebagian momentum pemain ke kotak.
  pushFrom(px, pz, pvx, pvz) {
    const dx = this.x - px, dz = this.z - pz;
    const d = Math.hypot(dx, dz) || 1;
    const toward = (pvx * dx + pvz * dz) / d;
    if (toward > 0.5) {
      this.vx += (dx / d) * toward * 0.9;
      this.vz += (dz / d) * toward * 0.9;
    }
  }
  update(dt, colliders) {
    this.vx -= this.vx * Math.min(1, 4 * dt);
    this.vz -= this.vz * Math.min(1, 4 * dt);
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 7) { this.vx *= 7 / sp; this.vz *= 7 / sp; }
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    // Sungai memblokir peti juga (tidak hanyut ke air).
    if (isInRiver(nx, nz)) { nx = this.x; nz = this.z; this.vx = 0; this.vz = 0; }
    const r = resolveCircleVsAABBs(nx, nz, this.half, colliders);
    // Bila resolve mengubah posisi drastis, redam kecepatan.
    if (Math.abs(r.x - nx) > 0.01 || Math.abs(r.z - nz) > 0.01) { this.vx *= 0.3; this.vz *= 0.3; }
    this.x = clamp(r.x, -PLAY_BOUND, PLAY_BOUND);
    this.z = clamp(r.z, -PLAY_BOUND, PLAY_BOUND);
  }
}
