// physics.js — fisika kustom deterministik (tanpa engine fisika eksternal).
// Gravitasi ~22 m/s^2, lompat v0 ~8 m/s, gerak akselerasi + friksi + momentum.

export const GRAVITY = 22;
export const JUMP_VELOCITY = 8;
export const MAX_SPEED = 6;
export const ACCEL = 30;
export const FRICTION = 10;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, k) => a + (b - a) * k;
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

export function isOnBridge(x, z) {
  return Math.abs(z - BRIDGE_Z) < BRIDGE_HALF && x > -32 && x < -16;
}
export function isInRiver(x, z) {
  return Math.abs(x - riverCenterX(z)) < RIVER_HALF && !isOnBridge(x, z);
}

// Tinggi terrain h(x,z): lembah landai di tengah, pegunungan di tepi,
// cekungan dangkal di sepanjang sungai.
export function terrainHeight(x, z) {
  const r = Math.hypot(x, z);
  let h = noise2(x, z) * 0.55;
  h += smoothstep(52, 88, r) * 20;                    // cincin pegunungan
  h += smoothstep(70, 95, r) * 14;
  const dRiver = Math.abs(x - riverCenterX(z));
  h -= Math.max(0, 1 - dRiver / 7) * 1.6;             // lembah sungai
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
    this.x = clamp(r.x, -78, 78);
    this.z = clamp(r.z, -78, 78);
  }
}
