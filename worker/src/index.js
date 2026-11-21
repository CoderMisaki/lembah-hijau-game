// worker/src/index.js — Backend Lembah Hijau: Cloudflare Workers + D1.
// Auth: username + PIN 6 digit. PIN TIDAK PERNAH disimpan plaintext:
// PBKDF2-HMAC-SHA256 (WebCrypto, salt acak 16 byte per user, 120.000 iterasi,
// output 32 byte) — bukan MD5/SHA1 polos. Token sesi acak 32 byte, disimpan
// sebagai hash SHA-256 di DB (bocornya DB tidak memberikan sesi aktif),
// kedaluwarsa 30 hari. PIN hanya dikirim saat register/login (HTTPS) dan
// TIDAK PERNAH ditulis ke log.
//
// JANGAN PERCAYA CLIENT: semua field divalidasi server (tipe, rentang,
// allowlist, ukuran payload maks 64 KB), prepared statements / parameter
// binding di semua query (anti SQL injection), rate limit + lockout login,
// CORS hanya origin game, tanpa secret di kode (secret hanya via env).
//
// Endpoint:
//   GET  /api/health
//   POST /api/auth/register  {username, pin}
//   POST /api/auth/login     {username, pin}
//   POST /api/auth/logout    (Bearer)
//   GET  /api/save           (Bearer)
//   PUT  /api/save           (Bearer) {save}
//   DELETE /api/save         (Bearer)

const MAX_BODY_BYTES = 65536;
const PBKDF2_ITERATIONS = 120000;
const SESSION_DAYS = 30;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// ---------- util ----------
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(str) {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

async function hashPin(pin, saltB64) {
  const salt = b64urlToBytes(saltB64);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256,
  );
  return b64url(new Uint8Array(bits));
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

// ---------- CORS ----------
// ALLOWED_ORIGINS (env, dipisah koma) = daftar origin persis yang diizinkan.
// Bila env kosong (dev): izinkan localhost + *.pages.dev saja.
function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return null; // same-origin / curl: tanpa Origin, tidak perlu CORS
  const configured = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (configured.length > 0) return configured.includes(origin) ? origin : null;
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return origin;
    if (u.hostname.endsWith('.pages.dev')) return origin;
  } catch (e) { return null; }
  return null;
}
function corsHeaders(origin) {
  return origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Vary': 'Origin' }
    : {};
}

// ---------- Rate limit (D1-backed, per key + window) ----------
async function checkRateLimit(db, key, max, windowMs) {
  const now = Date.now();
  const row = await db.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first();
  if (!row) {
    await db.prepare('INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)').bind(key, now).run();
    return true;
  }
  if (now - row.window_start > windowMs) {
    await db.prepare('UPDATE rate_limits SET count = 1, window_start = ? WHERE key = ?').bind(now, key).run();
    return true;
  }
  if (row.count >= max) return false;
  await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
  return true;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// ---------- Validasi input ----------
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
const PIN_RE = /^\d{6}$/;
function normalizeUsername(u) { return String(u || '').trim().toLowerCase(); }

const CUSTOM_ALLOW = {
  skin: ['fair', 'medium', 'tan', 'brown', 'deep'],
  hairStyle: ['short', 'spiky', 'long', 'bun', 'ponytail'],
  hairColor: ['black', 'brown', 'auburn', 'blond', 'grey'],
  shirtModel: ['tee', 'long', 'overall', 'vest'],
  shirtColor: ['green', 'pink', 'blue', 'purple', 'red', 'orange', 'yellow', 'teal', 'brown', 'white', 'black', 'straw'],
  pantsModel: ['pants', 'shorts', 'skirt'],
  pantsColor: ['green', 'pink', 'blue', 'purple', 'red', 'orange', 'yellow', 'teal', 'brown', 'white', 'black', 'straw'],
  hatModel: ['none', 'straw', 'cap', 'beanie', 'bandana'],
  hatColor: ['green', 'pink', 'blue', 'purple', 'red', 'orange', 'yellow', 'teal', 'brown', 'white', 'black', 'straw'],
  glassesModel: ['none', 'round', 'square', 'shades'],
  glassesColor: ['black', 'brown', 'red', 'teal'],
  shoesModel: ['boots', 'sneakers', 'sandals'],
  shoesColor: ['green', 'pink', 'blue', 'purple', 'red', 'orange', 'yellow', 'teal', 'brown', 'white', 'black', 'straw'],
};
const INV_KEYS = ['carrotSeed', 'tomatoSeed', 'pumpkinSeed', 'feed', 'carrot', 'tomato', 'pumpkin', 'egg', 'milk'];
const CROPS = ['carrot', 'tomato', 'pumpkin'];

function isInt(v, min, max) { return Number.isInteger(v) && v >= min && v <= max; }
function isNum(v, min, max) { return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max; }
function isBool(v) { return typeof v === 'boolean'; }

// Validasi save: kembalikan {ok, clean} atau {ok:false, error}.
// Field tak dikenal DIBUANG (bukan disimpan mentah).
export function validateSave(input, ownerUsername) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'save harus objek' };
  if (!isInt(input.coins, 0, 999999)) return { ok: false, error: 'coins di luar rentang' };
  if (!isInt(input.day, 1, 10000)) return { ok: false, error: 'day di luar rentang' };
  // minutes boleh datang sebagai float dari client (game loop) -> floor.
  if (typeof input.minutes === 'number' && Number.isFinite(input.minutes)) input.minutes = Math.floor(input.minutes);
  if (!isInt(input.minutes, 0, 1439)) return { ok: false, error: 'minutes di luar rentang' };
  if (input.lang !== 'id' && input.lang !== 'en') return { ok: false, error: 'lang tidak valid' };
  if (input.gender !== 'male' && input.gender !== 'female') return { ok: false, error: 'gender tidak valid' };
  if (!isBool(input.sound)) return { ok: false, error: 'sound harus boolean' };
  if (!['low', 'medium', 'high'].includes(input.quality)) return { ok: false, error: 'quality tidak valid' };
  if (!isInt(input.updatedAt, 0, 9007199254740991)) return { ok: false, error: 'updatedAt tidak valid' };
  if (input.username !== null && input.username !== undefined && input.username !== ownerUsername) {
    return { ok: false, error: 'username save tidak cocok dengan sesi' };
  }
  if (!input.inv || typeof input.inv !== 'object') return { ok: false, error: 'inv tidak valid' };
  const inv = {};
  for (const k of INV_KEYS) {
    if (!isInt(input.inv[k], 0, 99999)) return { ok: false, error: `inv.${k} di luar rentang` };
    inv[k] = input.inv[k];
  }
  if (!Array.isArray(input.plots) || input.plots.length !== 24) return { ok: false, error: 'plots harus 24 petak' };
  const plots = [];
  for (const p of input.plots) {
    if (!p || typeof p !== 'object') return { ok: false, error: 'plot tidak valid' };
    if (!(p.crop === null || CROPS.includes(p.crop))) return { ok: false, error: 'plot.crop tidak valid' };
    if (!isInt(p.growth, 0, 4)) return { ok: false, error: 'plot.growth di luar rentang' };
    if (!isBool(p.watered) || !isBool(p.hoed)) return { ok: false, error: 'plot.watered/hoed harus boolean' };
    plots.push({ crop: p.crop, growth: p.growth, watered: p.watered, hoed: p.hoed });
  }
  if (!Array.isArray(input.animals) || input.animals.length !== 5) return { ok: false, error: 'animals harus 5 ekor' };
  const animals = [];
  for (const a of input.animals) {
    if (!a || typeof a !== 'object') return { ok: false, error: 'animal tidak valid' };
    if (a.kind !== 'ayam' && a.kind !== 'sapi') return { ok: false, error: 'animal.kind tidak valid' };
    if (!isNum(a.x, -78, 78) || !isNum(a.z, -78, 78)) return { ok: false, error: 'animal.x/z di luar rentang' };
    if (!isBool(a.fed)) return { ok: false, error: 'animal.fed harus boolean' };
    if (!isInt(a.ready, 0, 99)) return { ok: false, error: 'animal.ready di luar rentang' };
    animals.push({ kind: a.kind, x: a.x, z: a.z, fed: a.fed, ready: a.ready });
  }
  if (!input.player || typeof input.player !== 'object') return { ok: false, error: 'player tidak valid' };
  if (!isNum(input.player.x, -78, 78) || !isNum(input.player.z, -78, 78)) return { ok: false, error: 'player.x/z di luar rentang' };
  if (!input.custom || typeof input.custom !== 'object') return { ok: false, error: 'custom tidak valid' };
  const custom = {};
  for (const [k, allowed] of Object.entries(CUSTOM_ALLOW)) {
    if (!allowed.includes(input.custom[k])) return { ok: false, error: `custom.${k} tidak valid` };
    custom[k] = input.custom[k];
  }
  return {
    ok: true,
    clean: {
      v: 2, savedAt: Date.now(), updatedAt: input.updatedAt, username: ownerUsername,
      coins: input.coins, day: input.day, minutes: input.minutes,
      lang: input.lang, gender: input.gender, sound: input.sound, quality: input.quality,
      custom, inv, plots, animals, player: { x: input.player.x, z: input.player.z },
    },
  };
}

// ---------- Sesi ----------
async function createSession(db, username) {
  const token = b64url(randomBytes(32));
  const tokenHash = await sha256Hex(token);
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await db.prepare('INSERT INTO sessions (token_hash, username, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, username, expiresAt, Date.now()).run();
  return { token, username, expiresAt };
}

async function authUsername(request, db) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) return null;
  const tokenHash = await sha256Hex(m[1].trim());
  const row = await db.prepare('SELECT username, expires_at FROM sessions WHERE token_hash = ?')
    .bind(tokenHash).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return row.username;
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: 'payload terlalu besar' };
  try { return { data: JSON.parse(text) }; }
  catch (e) { return { error: 'JSON tidak valid' }; }
}

// ---------- Handlers ----------
async function handleRegister(request, env, cors) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(env.DB, `reg:ip:${ip}`, 10, 60 * 1000))) {
    return json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' }, 429, cors);
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const username = normalizeUsername(data.username);
  if (!USERNAME_RE.test(username)) {
    return json({ error: 'Username 3-16 karakter: huruf kecil, angka, underscore.' }, 400, cors);
  }
  if (!PIN_RE.test(String(data.pin || ''))) {
    return json({ error: 'PIN harus tepat 6 digit angka.' }, 400, cors);
  }
  const existing = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
  if (existing) return json({ error: 'Username sudah dipakai. Pilih username lain.' }, 409, cors);
  const salt = b64url(randomBytes(16));
  const pinHash = await hashPin(String(data.pin), salt);
  await env.DB.prepare('INSERT INTO users (username, pin_hash, salt, created_at) VALUES (?, ?, ?, ?)')
    .bind(username, pinHash, salt, Date.now()).run();
  const session = await createSession(env.DB, username);
  console.log(`[auth] register ok username=${username}`);
  return json(session, 201, cors);
}

async function handleLogin(request, env, cors) {
  const ip = clientIp(request);
  if (!(await checkRateLimit(env.DB, `login:ip:${ip}`, 20, 60 * 1000))) {
    return json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' }, 429, cors);
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const username = normalizeUsername(data.username);
  if (!USERNAME_RE.test(username) || !PIN_RE.test(String(data.pin || ''))) {
    // Pesan GENERIK: jangan bocorkan apakah username ada / PIN salah.
    return json({ error: 'Username atau PIN salah.' }, 401, cors);
  }
  const now = Date.now();
  const att = await env.DB.prepare('SELECT failed, first_failed_at, locked_until FROM login_attempts WHERE username = ?')
    .bind(username).first();
  if (att && att.locked_until > now) {
    return json({ error: 'Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi nanti.' }, 429, cors);
  }
  const user = await env.DB.prepare('SELECT pin_hash, salt FROM users WHERE username = ?').bind(username).first();
  let ok = false;
  if (user) {
    const candidate = await hashPin(String(data.pin), user.salt);
    ok = timingSafeEqual(candidate, user.pin_hash);
  }
  if (!ok) {
    // Catat kegagalan (tanpa membedakan user ada/tidak — anti enumerasi).
    const windowStart = att && (now - att.first_failed_at < LOGIN_WINDOW_MS) ? att.first_failed_at : now;
    const failed = att && (now - att.first_failed_at < LOGIN_WINDOW_MS) ? att.failed + 1 : 1;
    const lockedUntil = failed >= LOGIN_MAX_FAILS ? now + LOGIN_LOCK_MS : 0;
    await env.DB.prepare(
      `INSERT INTO login_attempts (username, failed, first_failed_at, last_failed_at, locked_until)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET failed = excluded.failed,
         first_failed_at = excluded.first_failed_at, last_failed_at = excluded.last_failed_at,
         locked_until = excluded.locked_until`,
    ).bind(username, failed, windowStart, now, lockedUntil).run();
    console.log(`[auth] login gagal username=${username} failed=${failed}`);
    if (lockedUntil > now) {
      return json({ error: 'Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi nanti.' }, 429, cors);
    }
    return json({ error: 'Username atau PIN salah.' }, 401, cors);
  }
  // Sukses: hapus catatan gagal.
  await env.DB.prepare('DELETE FROM login_attempts WHERE username = ?').bind(username).run();
  const session = await createSession(env.DB, username);
  console.log(`[auth] login ok username=${username}`);
  return json(session, 200, cors);
}

async function handleLogout(request, env, cors) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (m) {
    const tokenHash = await sha256Hex(m[1].trim());
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
  }
  return json({ ok: true }, 200, cors);
}

async function handleGetSave(request, env, cors) {
  const username = await authUsername(request, env.DB);
  if (!username) return json({ error: 'Sesi tidak valid. Login lagi.' }, 401, cors);
  const row = await env.DB.prepare('SELECT data, updated_at FROM saves WHERE username = ?').bind(username).first();
  if (!row) return json({ save: null }, 200, cors);
  let parsed = null;
  try { parsed = JSON.parse(row.data); } catch (e) { parsed = null; }
  return json({ save: parsed, updatedAt: row.updated_at }, 200, cors);
}

async function handlePutSave(request, env, cors) {
  const username = await authUsername(request, env.DB);
  if (!username) return json({ error: 'Sesi tidak valid. Login lagi.' }, 401, cors);
  const ip = clientIp(request);
  if (!(await checkRateLimit(env.DB, `save:ip:${ip}`, 60, 60 * 1000))) {
    return json({ error: 'Terlalu banyak penyimpanan. Coba lagi nanti.' }, 429, cors);
  }
  if (!(await checkRateLimit(env.DB, `save:user:${username}`, 120, 60 * 1000))) {
    return json({ error: 'Terlalu banyak penyimpanan. Coba lagi nanti.' }, 429, cors);
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const checked = validateSave(data && data.save, username);
  if (!checked.ok) return json({ error: `Save tidak valid: ${checked.error}` }, 400, cors);
  const clean = checked.clean;
  await env.DB.prepare(
    `INSERT INTO saves (username, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).bind(username, JSON.stringify(clean), clean.updatedAt).run();
  return json({ ok: true, updatedAt: clean.updatedAt }, 200, cors);
}

async function handleDeleteSave(request, env, cors) {
  const username = await authUsername(request, env.DB);
  if (!username) return json({ error: 'Sesi tidak valid. Login lagi.' }, 401, cors);
  await env.DB.prepare('DELETE FROM saves WHERE username = ?').bind(username).run();
  return json({ ok: true }, 200, cors);
}

// ---------- Router ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(allowedOrigin(request, env));
    // Preflight.
    if (request.method === 'OPTIONS') {
      if (!request.headers.get('Origin')) return new Response(null, { status: 204 });
      if (!cors['Access-Control-Allow-Origin']) return json({ error: 'Origin tidak diizinkan.' }, 403);
      return new Response(null, { status: 204, headers: cors });
    }
    // Origin asing di request nyata -> tolak.
    if (request.headers.get('Origin') && !cors['Access-Control-Allow-Origin']) {
      return json({ error: 'Origin tidak diizinkan.' }, 403);
    }
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true, service: 'lembah-hijau', time: Date.now() }, 200, cors);
      }
      if (url.pathname === '/api/auth/register' && request.method === 'POST') return handleRegister(request, env, cors);
      if (url.pathname === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env, cors);
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') return handleLogout(request, env, cors);
      if (url.pathname === '/api/save' && request.method === 'GET') return handleGetSave(request, env, cors);
      if (url.pathname === '/api/save' && request.method === 'PUT') return handlePutSave(request, env, cors);
      if (url.pathname === '/api/save' && request.method === 'DELETE') return handleDeleteSave(request, env, cors);
      return json({ error: 'Tidak ditemukan.' }, 404, cors);
    } catch (e) {
      console.log(`[error] ${request.method} ${url.pathname}: ${e && e.message}`);
      return json({ error: 'Kesalahan server.' }, 500, cors);
    }
  },
};
