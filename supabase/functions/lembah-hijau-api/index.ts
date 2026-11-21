// functions/lembah-hijau-api/index.ts — Backend Lembah Hijau: Supabase Edge Function.
// Dipetakan 1:1 dari worker/src/index.js (Cloudflare Workers + D1).
//
// Auth: username + PIN 6 digit. PIN TIDAK PERNAH disimpan plaintext:
// PBKDF2-HMAC-SHA256 (WebCrypto Deno, salt acak 16 byte per user, 120.000
// iterasi, output 32 byte). Token sesi acak 32 byte, disimpan sebagai hash
// SHA-256 di DB (bocornya DB tidak memberikan sesi aktif), kedaluwarsa
// 30 hari. PIN hanya dikirim saat register/login (HTTPS) dan TIDAK PERNAH
// ditulis ke log.
//
// JANGAN PERCAYA CLIENT: semua field divalidasi server (tipe, rentang,
// allowlist, ukuran payload maks 64 KB), query builder supabase-js dengan
// parameter binding di semua query (anti SQL injection), rate limit +
// lockout login, CORS hanya origin game, tanpa secret di kode (service_role
// key hanya via env SUPABASE_SERVICE_ROLE_KEY yang disediakan otomatis oleh
// runtime Edge Function).
//
// Endpoint (path dihitung dari akhir URL, awalan /functions/v1/<nama-fungsi>
// diabaikan supaya sama saat serve lokal maupun deploy):
//   GET  /api/health
//   POST /api/auth/register  {username, pin}
//   POST /api/auth/login     {username, pin}
//   POST /api/auth/logout    (Bearer)
//   GET  /api/save           (Bearer)
//   PUT  /api/save           (Bearer) {save}
//   DELETE /api/save         (Bearer)
//
// PENTING — verifikasi JWT HARUS MATI untuk fungsi ini (config.toml:
// [functions.lembah-hijau-api] verify_jwt = false). API ini memakai token
// sesi sendiri (Bearer), bukan JWT Supabase Auth; bila verify_jwt aktif,
// gateway menolak semua request sebelum sampai ke kode ini. Client juga
// WAJIB mengirim header `apikey` (anon key) di setiap request agar gateway
// Supabase me-routing-nya; token sesi dikirim terpisah di `Authorization`.

import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.45.4";

const MAX_BODY_BYTES = 65536;
const PBKDF2_ITERATIONS = 120000;
const SESSION_DAYS = 30;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

type Db = SupabaseClient;

// ---------- util ----------
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str: string): Uint8Array<ArrayBuffer> {
  const norm = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

async function hashPin(pin: string, saltB64: string): Promise<string> {
  const salt = b64urlToBytes(saltB64);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return b64url(new Uint8Array(bits));
}

function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

// ---------- CORS ----------
// ALLOWED_ORIGINS (secret Edge Function, dipisah koma) = daftar origin
// persis yang diizinkan. Bila secret kosong/tidak diset: izinkan localhost
// + *.pages.dev saja (mode dev) — SAMA seperti versi Workers.
// PRODUKSI WAJIB set secret ini, minimal origin game di GitHub Pages:
//   ALLOWED_ORIGINS = "https://codermisaki.github.io,https://lembah-hijau.pages.dev"
// (origin GitHub Pages TIDAK termasuk *.pages.dev, jadi tanpa secret ini
// game live akan ditolak CORS 403.)
function allowedOrigin(
  request: Request,
  env: Record<string, string | undefined>,
): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null; // same-origin / curl: tanpa Origin, tidak perlu CORS
  const configured = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured.includes(origin) ? origin : null;
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return origin;
    if (u.hostname.endsWith(".pages.dev")) return origin;
  } catch (_e) {
    return null;
  }
  return null;
}
function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      "Vary": "Origin",
    }
    : {};
}

// ---------- Rate limit (Postgres-backed, per key + window) ----------
// Perilaku identik dengan versi D1 (read-modify-write non-atomik; race
// window yang sama seperti sebelumnya).
async function checkRateLimit(
  db: Db,
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now();
  const { data: row, error } = await db.from("rate_limits").select(
    "count, window_start",
  ).eq("key", key).maybeSingle();
  if (error) throw error;
  if (!row) {
    const { error: insErr } = await db.from("rate_limits").insert({
      key,
      count: 1,
      window_start: now,
    });
    if (insErr) throw insErr;
    return true;
  }
  if (now - (row as { window_start: number }).window_start > windowMs) {
    const { error: updErr } = await db.from("rate_limits").update({
      count: 1,
      window_start: now,
    }).eq("key", key);
    if (updErr) throw updErr;
    return true;
  }
  if ((row as { count: number }).count >= max) return false;
  const { error: incErr } = await db.from("rate_limits").update({
    count: (row as { count: number }).count + 1,
  }).eq("key", key);
  if (incErr) throw incErr;
  return true;
}

// IP client: gateway Supabase mengisi x-forwarded-for (client bisa
// memalsukan entri awal, jadi ambil entri TERAKHIR = IP yang benar-benar
// terhubung ke gateway). Versi Workers memakai CF-Connecting-IP yang
// tidak ada di sini; fallback ke header itu bila ada, lalu 'unknown'.
// Dipakai HANYA sebagai kunci rate limit, bukan autentikasi.
function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return request.headers.get("cf-connecting-ip") || "unknown";
}

// ---------- Validasi input ----------
const USERNAME_RE = /^[a-z0-9_]{3,16}$/;
const PIN_RE = /^\d{6}$/;
function normalizeUsername(u: unknown): string {
  return String(u || "").trim().toLowerCase();
}

const CUSTOM_ALLOW: Record<string, string[]> = {
  skin: ["fair", "medium", "tan", "brown", "deep"],
  hairStyle: ["short", "spiky", "long", "bun", "ponytail"],
  hairColor: ["black", "brown", "auburn", "blond", "grey"],
  shirtModel: ["tee", "long", "overall", "vest"],
  shirtColor: [
    "green",
    "pink",
    "blue",
    "purple",
    "red",
    "orange",
    "yellow",
    "teal",
    "brown",
    "white",
    "black",
    "straw",
  ],
  pantsModel: ["pants", "shorts", "skirt"],
  pantsColor: [
    "green",
    "pink",
    "blue",
    "purple",
    "red",
    "orange",
    "yellow",
    "teal",
    "brown",
    "white",
    "black",
    "straw",
  ],
  hatModel: ["none", "straw", "cap", "beanie", "bandana"],
  hatColor: [
    "green",
    "pink",
    "blue",
    "purple",
    "red",
    "orange",
    "yellow",
    "teal",
    "brown",
    "white",
    "black",
    "straw",
  ],
  glassesModel: ["none", "round", "square", "shades"],
  glassesColor: ["black", "brown", "red", "teal"],
  shoesModel: ["boots", "sneakers", "sandals"],
  shoesColor: [
    "green",
    "pink",
    "blue",
    "purple",
    "red",
    "orange",
    "yellow",
    "teal",
    "brown",
    "white",
    "black",
    "straw",
  ],
};
const INV_KEYS = [
  "carrotSeed",
  "tomatoSeed",
  "pumpkinSeed",
  "feed",
  "carrot",
  "tomato",
  "pumpkin",
  "egg",
  "milk",
];
const CROPS = ["carrot", "tomato", "pumpkin"];

function isInt(v: unknown, min: number, max: number): v is number {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}
function isNum(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}
function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

// Validasi save: kembalikan {ok, clean} atau {ok:false, error}.
// Field tak dikenal DIBUANG (bukan disimpan mentah).
// Identik dengan versi Workers (termasuk floor minutes float dari client).
export function validateSave(
  // deno-lint-ignore no-explicit-any -- input adalah JSON tak tervalidasi dari client
  input: any,
  ownerUsername: string,
): { ok: true; clean: Record<string, unknown> } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "save harus objek" };
  }
  if (!isInt(input.coins, 0, 999999)) {
    return { ok: false, error: "coins di luar rentang" };
  }
  if (!isInt(input.day, 1, 10000)) {
    return { ok: false, error: "day di luar rentang" };
  }
  // minutes boleh datang sebagai float dari client (game loop) -> floor.
  if (typeof input.minutes === "number" && Number.isFinite(input.minutes)) {
    input.minutes = Math.floor(input.minutes);
  }
  if (!isInt(input.minutes, 0, 1439)) {
    return { ok: false, error: "minutes di luar rentang" };
  }
  if (input.lang !== "id" && input.lang !== "en") {
    return { ok: false, error: "lang tidak valid" };
  }
  if (input.gender !== "male" && input.gender !== "female") {
    return { ok: false, error: "gender tidak valid" };
  }
  if (!isBool(input.sound)) return { ok: false, error: "sound harus boolean" };
  if (!["low", "medium", "high"].includes(input.quality)) {
    return { ok: false, error: "quality tidak valid" };
  }
  if (!isInt(input.updatedAt, 0, 9007199254740991)) {
    return { ok: false, error: "updatedAt tidak valid" };
  }
  if (
    input.username !== null && input.username !== undefined &&
    input.username !== ownerUsername
  ) {
    return { ok: false, error: "username save tidak cocok dengan sesi" };
  }
  if (!input.inv || typeof input.inv !== "object") {
    return { ok: false, error: "inv tidak valid" };
  }
  const inv: Record<string, number> = {};
  for (const k of INV_KEYS) {
    if (!isInt(input.inv[k], 0, 99999)) {
      return { ok: false, error: `inv.${k} di luar rentang` };
    }
    inv[k] = input.inv[k];
  }
  if (!Array.isArray(input.plots) || input.plots.length !== 24) {
    return { ok: false, error: "plots harus 24 petak" };
  }
  const plots = [];
  for (const p of input.plots) {
    if (!p || typeof p !== "object") {
      return { ok: false, error: "plot tidak valid" };
    }
    if (!(p.crop === null || CROPS.includes(p.crop))) {
      return { ok: false, error: "plot.crop tidak valid" };
    }
    if (!isInt(p.growth, 0, 4)) {
      return { ok: false, error: "plot.growth di luar rentang" };
    }
    if (!isBool(p.watered) || !isBool(p.hoed)) {
      return { ok: false, error: "plot.watered/hoed harus boolean" };
    }
    plots.push({
      crop: p.crop,
      growth: p.growth,
      watered: p.watered,
      hoed: p.hoed,
    });
  }
  if (!Array.isArray(input.animals) || input.animals.length !== 5) {
    return { ok: false, error: "animals harus 5 ekor" };
  }
  const animals = [];
  for (const a of input.animals) {
    if (!a || typeof a !== "object") {
      return { ok: false, error: "animal tidak valid" };
    }
    if (a.kind !== "ayam" && a.kind !== "sapi") {
      return { ok: false, error: "animal.kind tidak valid" };
    }
    if (!isNum(a.x, -78, 78) || !isNum(a.z, -78, 78)) {
      return { ok: false, error: "animal.x/z di luar rentang" };
    }
    if (!isBool(a.fed)) return { ok: false, error: "animal.fed harus boolean" };
    if (!isInt(a.ready, 0, 99)) {
      return { ok: false, error: "animal.ready di luar rentang" };
    }
    animals.push({ kind: a.kind, x: a.x, z: a.z, fed: a.fed, ready: a.ready });
  }
  if (!input.player || typeof input.player !== "object") {
    return { ok: false, error: "player tidak valid" };
  }
  if (!isNum(input.player.x, -78, 78) || !isNum(input.player.z, -78, 78)) {
    return { ok: false, error: "player.x/z di luar rentang" };
  }
  if (!input.custom || typeof input.custom !== "object") {
    return { ok: false, error: "custom tidak valid" };
  }
  const custom: Record<string, string> = {};
  for (const [k, allowed] of Object.entries(CUSTOM_ALLOW)) {
    if (!allowed.includes(input.custom[k])) {
      return { ok: false, error: `custom.${k} tidak valid` };
    }
    custom[k] = input.custom[k];
  }
  return {
    ok: true,
    clean: {
      v: 2,
      savedAt: Date.now(),
      updatedAt: input.updatedAt,
      username: ownerUsername,
      coins: input.coins,
      day: input.day,
      minutes: input.minutes,
      lang: input.lang,
      gender: input.gender,
      sound: input.sound,
      quality: input.quality,
      custom,
      inv,
      plots,
      animals,
      player: { x: input.player.x, z: input.player.z },
    },
  };
}

// ---------- Sesi ----------
async function createSession(
  db: Db,
  username: string,
): Promise<{ token: string; username: string; expiresAt: number }> {
  const token = b64url(randomBytes(32));
  const tokenHash = await sha256Hex(token);
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const { error } = await db.from("sessions").insert({
    token_hash: tokenHash,
    username,
    expires_at: expiresAt,
    created_at: Date.now(),
  });
  if (error) throw error;
  return { token, username, expiresAt };
}

async function authUsername(request: Request, db: Db): Promise<string | null> {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) return null;
  const tokenHash = await sha256Hex(m[1].trim());
  const { data: row, error } = await db.from("sessions").select(
    "username, expires_at",
  ).eq("token_hash", tokenHash).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  if ((row as { expires_at: number }).expires_at < Date.now()) {
    await db.from("sessions").delete().eq("token_hash", tokenHash);
    return null;
  }
  return (row as { username: string }).username;
}

// deno-lint-ignore no-explicit-any -- body JSON tak tervalidasi dari client
async function readBody(
  request: Request,
): Promise<{ data?: any; error?: string }> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { error: "payload terlalu besar" };
  try {
    return { data: JSON.parse(text) };
  } catch (_e) {
    return { error: "JSON tidak valid" };
  }
}

// ---------- Handlers ----------
async function handleRegister(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const ip = clientIp(request);
  if (!(await checkRateLimit(db, `reg:ip:${ip}`, 10, 60 * 1000))) {
    return json(
      { error: "Terlalu banyak percobaan. Coba lagi nanti." },
      429,
      cors,
    );
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const username = normalizeUsername(data.username);
  if (!USERNAME_RE.test(username)) {
    return json(
      { error: "Username 3-16 karakter: huruf kecil, angka, underscore." },
      400,
      cors,
    );
  }
  if (!PIN_RE.test(String(data.pin || ""))) {
    return json({ error: "PIN harus tepat 6 digit angka." }, 400, cors);
  }
  const { data: existing, error: selErr } = await db.from("users").select(
    "username",
  ).eq("username", username).maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    return json(
      { error: "Username sudah dipakai. Pilih username lain." },
      409,
      cors,
    );
  }
  const salt = b64url(randomBytes(16));
  const pinHash = await hashPin(String(data.pin), salt);
  const { error: insErr } = await db.from("users").insert({
    username,
    pin_hash: pinHash,
    salt,
    created_at: Date.now(),
  });
  if (insErr) throw insErr;
  const session = await createSession(db, username);
  console.log(`[auth] register ok username=${username}`);
  return json(session, 201, cors);
}

async function handleLogin(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const ip = clientIp(request);
  if (!(await checkRateLimit(db, `login:ip:${ip}`, 20, 60 * 1000))) {
    return json(
      { error: "Terlalu banyak percobaan. Coba lagi nanti." },
      429,
      cors,
    );
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const username = normalizeUsername(data.username);
  if (!USERNAME_RE.test(username) || !PIN_RE.test(String(data.pin || ""))) {
    // Pesan GENERIK: jangan bocorkan apakah username ada / PIN salah.
    return json({ error: "Username atau PIN salah." }, 401, cors);
  }
  const now = Date.now();
  const { data: att, error: attErr } = await db.from("login_attempts")
    .select("failed, first_failed_at, locked_until").eq("username", username)
    .maybeSingle();
  if (attErr) throw attErr;
  const a = att as {
    failed: number;
    first_failed_at: number;
    locked_until: number;
  } | null;
  if (a && a.locked_until > now) {
    return json(
      {
        error:
          "Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi nanti.",
      },
      429,
      cors,
    );
  }
  const { data: user, error: userErr } = await db.from("users").select(
    "pin_hash, salt",
  ).eq("username", username).maybeSingle();
  if (userErr) throw userErr;
  let ok = false;
  if (user) {
    const u = user as { pin_hash: string; salt: string };
    const candidate = await hashPin(String(data.pin), u.salt);
    ok = timingSafeEqual(candidate, u.pin_hash);
  }
  if (!ok) {
    // Catat kegagalan (tanpa membedakan user ada/tidak — anti enumerasi).
    const inWindow = a && (now - a.first_failed_at < LOGIN_WINDOW_MS);
    const windowStart = inWindow ? a!.first_failed_at : now;
    const failed = inWindow ? a!.failed + 1 : 1;
    const lockedUntil = failed >= LOGIN_MAX_FAILS ? now + LOGIN_LOCK_MS : 0;
    const { error: upErr } = await db.from("login_attempts").upsert(
      {
        username,
        failed,
        first_failed_at: windowStart,
        last_failed_at: now,
        locked_until: lockedUntil,
      },
      { onConflict: "username" },
    );
    if (upErr) throw upErr;
    console.log(`[auth] login gagal username=${username} failed=${failed}`);
    if (lockedUntil > now) {
      return json(
        {
          error:
            "Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi nanti.",
        },
        429,
        cors,
      );
    }
    return json({ error: "Username atau PIN salah." }, 401, cors);
  }
  // Sukses: hapus catatan gagal.
  await db.from("login_attempts").delete().eq("username", username);
  const session = await createSession(db, username);
  console.log(`[auth] login ok username=${username}`);
  return json(session, 200, cors);
}

async function handleLogout(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (m) {
    const tokenHash = await sha256Hex(m[1].trim());
    await db.from("sessions").delete().eq("token_hash", tokenHash);
  }
  return json({ ok: true }, 200, cors);
}

async function handleGetSave(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) {
    return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  }
  const { data: row, error } = await db.from("saves").select("data, updated_at")
    .eq("username", username).maybeSingle();
  if (error) throw error;
  if (!row) return json({ save: null }, 200, cors);
  let parsed = null;
  try {
    parsed = JSON.parse((row as { data: string }).data);
  } catch (_e) {
    parsed = null;
  }
  return json(
    { save: parsed, updatedAt: (row as { updated_at: number }).updated_at },
    200,
    cors,
  );
}

async function handlePutSave(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) {
    return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  }
  const ip = clientIp(request);
  if (!(await checkRateLimit(db, `save:ip:${ip}`, 60, 60 * 1000))) {
    return json(
      { error: "Terlalu banyak penyimpanan. Coba lagi nanti." },
      429,
      cors,
    );
  }
  if (!(await checkRateLimit(db, `save:user:${username}`, 120, 60 * 1000))) {
    return json(
      { error: "Terlalu banyak penyimpanan. Coba lagi nanti." },
      429,
      cors,
    );
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const checked = validateSave(data && data.save, username);
  if (!checked.ok) {
    return json({ error: `Save tidak valid: ${checked.error}` }, 400, cors);
  }
  const clean = checked.clean;
  const { error: upErr } = await db.from("saves").upsert(
    {
      username,
      data: JSON.stringify(clean),
      updated_at: clean.updatedAt as number,
    },
    { onConflict: "username" },
  );
  if (upErr) throw upErr;
  return json({ ok: true, updatedAt: clean.updatedAt }, 200, cors);
}

async function handleDeleteSave(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) {
    return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  }
  await db.from("saves").delete().eq("username", username);
  return json({ ok: true }, 200, cors);
}

// ---------- Router ----------
// Path dihitung dari kemunculan '/api/' supaya awalan
// /functions/v1/<nama-fungsi> (deploy maupun serve lokal) diabaikan.
export async function handleRequest(
  req: Request,
  db: Db,
  env: Record<string, string | undefined>,
): Promise<Response> {
  const url = new URL(req.url);
  const cors = corsHeaders(allowedOrigin(req, env));
  // Preflight.
  if (req.method === "OPTIONS") {
    if (!req.headers.get("Origin")) return new Response(null, { status: 204 });
    if (!cors["Access-Control-Allow-Origin"]) {
      return json({ error: "Origin tidak diizinkan." }, 403);
    }
    return new Response(null, { status: 204, headers: cors });
  }
  // Origin asing di request nyata -> tolak.
  if (req.headers.get("Origin") && !cors["Access-Control-Allow-Origin"]) {
    return json({ error: "Origin tidak diizinkan." }, 403);
  }
  try {
    const idx = url.pathname.indexOf("/api/");
    const path = idx >= 0 ? url.pathname.slice(idx) : url.pathname;
    if (path === "/api/health" && req.method === "GET") {
      return json(
        { ok: true, service: "lembah-hijau", time: Date.now() },
        200,
        cors,
      );
    }
    // `await` di sini disengaja: tanpa await, rejection dari handler TIDAK
    // ditangkap catch di bawah (semantik return promise di async fn), dan
    // error DB akan jadi unhandled rejection, bukan JSON 500.
    if (path === "/api/auth/register" && req.method === "POST") {
      return await handleRegister(req, db, cors);
    }
    if (path === "/api/auth/login" && req.method === "POST") {
      return await handleLogin(req, db, cors);
    }
    if (path === "/api/auth/logout" && req.method === "POST") {
      return await handleLogout(req, db, cors);
    }
    if (path === "/api/save" && req.method === "GET") {
      return await handleGetSave(req, db, cors);
    }
    if (path === "/api/save" && req.method === "PUT") {
      return await handlePutSave(req, db, cors);
    }
    if (path === "/api/save" && req.method === "DELETE") {
      return await handleDeleteSave(req, db, cors);
    }
    return json({ error: "Tidak ditemukan." }, 404, cors);
  } catch (e) {
    console.log(
      `[error] ${req.method} ${url.pathname}: ${(e as Error)?.message}`,
    );
    return json({ error: "Kesalahan server." }, 500, cors);
  }
}

// ---------- Entry point (runtime Edge Function) ----------
// Dijaga import.meta.main supaya handleRequest bisa diimpor & diuji
// (mock DB) tanpa menyalakan server; di runtime Edge Function file ini
// adalah modul utama sehingga guard ini selalu benar di produksi.
let cachedDb: Db | null = null;
function getDb(): Db {
  if (cachedDb) return cachedDb;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset di environment Edge Function",
    );
  }
  cachedDb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedDb;
}

if (import.meta.main) {
  Deno.serve(async (req: Request) => {
    const env: Record<string, string | undefined> = {
      ALLOWED_ORIGINS: Deno.env.get("ALLOWED_ORIGINS"),
    };
    return await handleRequest(req, getDb(), env);
  });
}
