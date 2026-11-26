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
//   (COZY-E) /api/mp/* — ekonomi multiplayer, lihat seksi COZY-E di bawah:
//   garden, trade propose/accept/decline, visit, minigame
//   submit/results/claim, leaderboard. Semua butuh sesi Bearer.
//   (COZY-F2) POST /api/auth/recover {username, code, pin} — pulihkan akun
//   dengan kode pemulihan (diterbitkan sekali saat register, single-use,
//   disimpan hanya sebagai hash; lihat seksi COZY-F2 di bawah).
//   POST /api/auth/recovery-code (Bearer) — terbitkan kode pemulihan baru
//   (untuk akun lama pra-v3 / kode hilang; menggantikan kode lama).
//   Save v3 (F2): validateSave menerima v2/v3, clean selalu v:3, semua
//   field baru Wave-1/2 masuk allowlist (lihat validateSave).
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
  // COZY-F2: 'braids' (Lane A, Sari) + 'visor' (Lane A) — sebelumnya save
  // cloud dengan tampilan baru DITOLAK server (custom tidak valid).
  hairStyle: ["short", "spiky", "long", "bun", "ponytail", "braids"],
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
  hatModel: ["none", "straw", "cap", "beanie", "bandana", "visor"],
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
// COZY-F2 — save v3: semua kunci inv (lama + Lane C + goldenEgg Lane D).
// Kunci yang ABSEN di payload diterima sebagai 0 (klien lama / save lama);
// kunci yang HADIR tapi di luar rentang tetap ditolak.
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
  "wheatSeed",
  "strawberrySeed",
  "wheat",
  "strawberry",
  "apple",
  "orange",
  "cheese",
  "sauce",
  "flour",
  "fertiliser",
  "appleSapling",
  "orangeSapling",
  "goldenEgg",
];
// Barang yang bisa dijual (subset inv untuk validasi invQ).
const SELLABLES = [
  "carrot",
  "tomato",
  "pumpkin",
  "wheat",
  "strawberry",
  "apple",
  "orange",
  "egg",
  "milk",
  "cheese",
  "sauce",
  "flour",
];
const CROPS = ["carrot", "tomato", "pumpkin", "wheat", "strawberry"];
const HIDDEN_SPOT_IDS = [
  "sakura-grove",
  "lake-shore",
  "mountain-nook",
  "old-well",
  "windmill-back",
];
const NPC_IDS = ["darman", "ratna", "udin", "lestari", "joyo", "raka"];
const QUEST_IDS = ["d-carrot", "d-harvest", "d-feed", "w-harvest", "w-gifts"];
const SEASONS = ["spring", "summer", "autumn", "winter"];

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
    // COZY-F2: kunci absen = 0 (save v2 / klien lama); kunci hadir tapi
    // bukan int 0..99999 = tolak. Tanpa ini, PUT dari tab lama gagal total.
    if (input.inv[k] === undefined || input.inv[k] === null) {
      inv[k] = 0;
      continue;
    }
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
    // COZY-F2 — v3 (Lane C): tanah + pupuk per petak. Absen di save lama =
    // default (80 / false); hadir tapi di luar rentang = default juga
    // (field aditif, bukan inti — jangan gagalkan seluruh save karenanya).
    plots.push({
      crop: p.crop,
      growth: p.growth,
      watered: p.watered,
      hoed: p.hoed,
      soil: isInt(p.soil, 0, 100) ? p.soil : 80,
      fert: typeof p.fert === "boolean" ? p.fert : false,
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
  // ---------- COZY-F2 — save v3: semua field baru Wave-1 + Wave-2 ----------
  // Aturan: v 2 (klien/save lama) atau 3 diterima; clean SELALU ditulis
  // v:3. Field aditif yang absen = default (jangan gagalkan save lama);
  // field yang hadir tapi malformed = tolak (kecuali soil/fert di atas).
  if (
    input.v !== undefined && input.v !== null && input.v !== 2 &&
    input.v !== 3
  ) {
    return { ok: false, error: "versi save tidak valid" };
  }
  const season = typeof input.season === "string" &&
      SEASONS.includes(input.season)
    ? input.season
    : "spring";
  const discoveredSpots: string[] = Array.isArray(input.discoveredSpots)
    ? (input.discoveredSpots as unknown[])
      .filter((s): s is string =>
        typeof s === "string" && HIDDEN_SPOT_IDS.includes(s)
      ).slice(0, 32)
    : [];
  // invQ: {item: {good, rare}} — subset dari inv (good+rare <= total).
  const invQ: Record<string, { good: number; rare: number }> = {};
  if (
    input.invQ && typeof input.invQ === "object" &&
    !Array.isArray(input.invQ)
  ) {
    for (const [item, q] of Object.entries(input.invQ)) {
      if (!SELLABLES.includes(item)) continue;
      if (!q || typeof q !== "object") continue;
      const total = inv[item] || 0;
      const rare = Math.max(
        0,
        Math.min(total, Math.floor((q as { rare?: unknown }).rare as number) || 0),
      );
      const good = Math.max(
        0,
        Math.min(total - rare, Math.floor((q as { good?: unknown }).good as number) || 0),
      );
      if (good > 0 || rare > 0) invQ[item] = { good, rare };
    }
  }
  // trees: 4 x {kind null|apple|orange, growth 0..2, fruit 0..3}.
  const trees: { kind: string | null; growth: number; fruit: number }[] = [];
  if (Array.isArray(input.trees) && input.trees.length === 4) {
    for (const tr of input.trees) {
      if (!tr || typeof tr !== "object") {
        return { ok: false, error: "trees tidak valid" };
      }
      const t = tr as { kind?: unknown; growth?: unknown; fruit?: unknown };
      if (!(t.kind === null || t.kind === "apple" || t.kind === "orange")) {
        return { ok: false, error: "trees.kind tidak valid" };
      }
      if (!isInt(t.growth, 0, 2) || !isInt(t.fruit, 0, 3)) {
        return { ok: false, error: "trees di luar rentang" };
      }
      trees.push({
        kind: t.kind as string | null,
        growth: t.growth as number,
        fruit: t.fruit as number,
      });
    }
  } else {
    for (let i = 0; i < 4; i++) trees.push({ kind: null, growth: 0, fruit: 0 });
  }
  const machineCooldown = isInt(input.machineCooldown, 0, 9007199254740991)
    ? input.machineCooldown
    : 0;
  // NPC (Lane D): pertemanan 0..999, hari hadiah/obrolan 1..10000,
  // npcMet hanya true (termasuk penanda `${id}:lvl2paid`).
  const npcMap = (
    src: unknown,
    max: number,
  ): { ok: true; map: Record<string, number> } | { ok: false; error: string } => {
    const out: Record<string, number> = {};
    if (!src || typeof src !== "object") return { ok: true, map: out };
    for (const [k, v] of Object.entries(src)) {
      if (!NPC_IDS.includes(k) || !isInt(v, 0, max)) {
        return { ok: false, error: "field NPC tidak valid" };
      }
      out[k] = v as number;
    }
    return { ok: true, map: out };
  };
  const _nf = npcMap(input.npcFriendship, 999);
  if (!_nf.ok) return _nf;
  const npcFriendship = _nf.map;
  const _ng = npcMap(input.npcGiftedDay, 10000);
  if (!_ng.ok) return _ng;
  const npcGiftedDay = _ng.map;
  const _nc = npcMap(input.npcChatDay, 10000);
  if (!_nc.ok) return _nc;
  const npcChatDay = _nc.map;
  const npcMet: Record<string, boolean> = {};
  if (input.npcMet && typeof input.npcMet === "object") {
    for (const [k, v] of Object.entries(input.npcMet)) {
      const base = k.replace(/:lvl2paid$/, "");
      if (!NPC_IDS.includes(base) || v !== true) {
        return { ok: false, error: "npcMet tidak valid" };
      }
      npcMet[k] = true;
    }
  }
  // npcQuests: {day, week, daily[3], weekly[2], weekGiftNpcs[]}.
  let npcQuests: unknown = null;
  if (input.npcQuests !== undefined && input.npcQuests !== null) {
    const q = input.npcQuests as {
      day?: unknown;
      week?: unknown;
      daily?: unknown;
      weekly?: unknown;
      weekGiftNpcs?: unknown;
    };
    if (
      !q || typeof q !== "object" || !isInt(q.day, 1, 10000) ||
      !isInt(q.week, 0, 10000) || !Array.isArray(q.daily) ||
      q.daily.length > 8 || !Array.isArray(q.weekly) || q.weekly.length > 8
    ) {
      return { ok: false, error: "npcQuests tidak valid" };
    }
    const cleanQuestList = (list: unknown[]) => {
      const out: { id: string; progress: number; done: boolean }[] = [];
      for (const e of list) {
        const en = e as { id?: unknown; progress?: unknown; done?: unknown };
        if (
          !en || typeof en !== "object" ||
          typeof en.id !== "string" || !QUEST_IDS.includes(en.id) ||
          !isInt(en.progress, 0, 15) || typeof en.done !== "boolean"
        ) {
          return null;
        }
        out.push({
          id: en.id,
          progress: en.progress as number,
          done: en.done as boolean,
        });
      }
      return out;
    };
    const daily = cleanQuestList(q.daily);
    const weekly = cleanQuestList(q.weekly);
    if (!daily || !weekly) return { ok: false, error: "npcQuests tidak valid" };
    if (
      !Array.isArray(q.weekGiftNpcs) || q.weekGiftNpcs.length > 5 ||
      (q.weekGiftNpcs as unknown[]).some((s) =>
        typeof s !== "string" || !NPC_IDS.includes(s)
      )
    ) {
      return { ok: false, error: "npcQuests.weekGiftNpcs tidak valid" };
    }
    npcQuests = {
      day: q.day,
      week: q.week,
      daily,
      weekly,
      weekGiftNpcs: q.weekGiftNpcs,
    };
  }
  // npcFestival: {day, talked{}, harvested 0..99, rewarded}.
  let npcFestival: unknown = null;
  if (input.npcFestival !== undefined && input.npcFestival !== null) {
    const f = input.npcFestival as {
      day?: unknown;
      talked?: unknown;
      harvested?: unknown;
      rewarded?: unknown;
    };
    if (
      !f || typeof f !== "object" || !isInt(f.day, 1, 10000) ||
      !isInt(f.harvested, 0, 99) || typeof f.rewarded !== "boolean"
    ) {
      return { ok: false, error: "npcFestival tidak valid" };
    }
    const talked: Record<string, boolean> = {};
    if (f.talked && typeof f.talked === "object") {
      for (const [k, v] of Object.entries(f.talked)) {
        if (!NPC_IDS.includes(k) || v !== true) {
          return { ok: false, error: "npcFestival.talked tidak valid" };
        }
        talked[k] = true;
      }
    }
    npcFestival = {
      day: f.day,
      talked,
      harvested: f.harvested,
      rewarded: f.rewarded,
    };
  }
  // Multiplayer (Lane E): cermin lokal; server (visit/trade ledger) yang
  // berwenang atas angkanya — di sini hanya bentuk + rentang.
  const mpVisits: Record<string, string> = {};
  if (input.mpVisits && typeof input.mpVisits === "object") {
    const entries = Object.entries(input.mpVisits);
    if (entries.length > 64) {
      return { ok: false, error: "mpVisits terlalu banyak" };
    }
    for (const [k, v] of entries) {
      if (
        !USERNAME_RE.test(k) || typeof v !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(v)
      ) {
        return { ok: false, error: "mpVisits tidak valid" };
      }
      mpVisits[k] = v;
    }
  }
  const mpTrades: unknown[] = [];
  if (input.mpTrades !== undefined && input.mpTrades !== null) {
    if (!Array.isArray(input.mpTrades) || input.mpTrades.length > 20) {
      return { ok: false, error: "mpTrades tidak valid" };
    }
    for (const e of input.mpTrades) {
      const en = e as {
        id?: unknown;
        with?: unknown;
        give?: { item?: unknown; qty?: unknown };
        get?: { item?: unknown; qty?: unknown };
        at?: unknown;
      };
      const legOk = (leg: { item?: unknown; qty?: unknown } | undefined) =>
        !!leg && typeof leg === "object" &&
        typeof leg.item === "string" && INV_KEYS.includes(leg.item) &&
        isInt(leg.qty, 1, 99);
      if (
        !en || typeof en !== "object" ||
        typeof en.with !== "string" || !USERNAME_RE.test(en.with) ||
        !legOk(en.give) || !legOk(en.get) || !isInt(en.at, 0, 9007199254740991)
      ) {
        return { ok: false, error: "mpTrades tidak valid" };
      }
      mpTrades.push({
        id: typeof en.id === "string" ? en.id : "",
        with: en.with,
        give: en.give,
        get: en.get,
        at: en.at,
      });
    }
  }
  const mpMinigameBest = isInt(input.mpMinigameBest, 0, 200)
    ? input.mpMinigameBest
    : 0;
  return {
    ok: true,
    clean: {
      v: 3,
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
      // COZY-F2 — v3 (sebelumnya field-field ini DIBUANG clean, jadi
      // round-trip cloud menghapus progres Wave-1/2).
      season,
      discoveredSpots,
      invQ,
      trees,
      machineCooldown,
      npcFriendship,
      npcGiftedDay,
      npcChatDay,
      npcMet,
      npcQuests,
      npcFestival,
      mpVisits,
      mpTrades,
      mpMinigameBest,
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
  // COZY-F2 — kode pemulihan: diterbitkan SEKALI saat register, ditampilkan
  // SEKALI ke pemain (client wajib menampilkannya + menyuruh menyimpan).
  // Server hanya menyimpan hash SHA-256 (bocornya DB tidak memberikan kode).
  const recoveryCode = await issueRecoveryCode(db, username);
  console.log(`[auth] register ok username=${username}`);
  return json({ ...session, recoveryCode }, 201, cors);
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

// ---------- COZY-F2 — Pemulihan akun (kode pemulihan) ----------
// Desain (inferensi F2, dicatat di laporan): tidak ada email di game ini,
// jadi pemulihan memakai KODE yang diterbitkan server sekali saat register
// dan ditampilkan sekali ke pemain ("simpan kode ini — satu-satunya jalan
// bila PIN lupa"). Sifat keamanan:
//   - Kode 12 karakter dari alfabet 32 huruf/angka tanpa ambiguitas
//     (tanpa 0/O/1/I/L) = ~60 bit entropi; ditampilkan sebagai XXXX-XXXX-XXXX.
//   - Server HANYA menyimpan hash SHA-256 kode (seperti token sesi) —
//     bocornya DB tidak memberikan kode; kode TIDAK PERNAH ditulis ke log.
//   - Single-use: sekali dipakai, baris dihapus + kode BARU diterbitkan
//     (rotasi — respons recover mengembalikan kode pengganti).
//   - Sesi: recover yang sukses menghapus SEMUA sesi lama (bila kode dicuri,
//     pemilik sah yang memulihkan langsung menendang penyerang) + membuka
//     lockout login; sesi baru dibuat untuk pemulih.
//   - Rate limit 5 percobaan / 15 menit per username (+ 10/menit per IP);
//     pesan gagal GENERIK (tidak membedakan user ada / kode salah / PIN
//     baru tak valid) supaya tidak bisa enumerasi akun.
//   - Akun lama (register pra-v3, tanpa kode) memakai POST
//     /api/auth/recovery-code saat login untuk menerbitkan kode pertama.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/;

function generateRecoveryCode(): string {
  const bytes = randomBytes(12);
  let out = "";
  // PERHATIAN: RECOVERY_ALPHABET panjangnya 31, BUKAN 32 (I, L, O, 0, 1
  // dibuang agar tak ambigu). Modulus HARUS alphabet.length — memakai
  // % 32 pernah membuat indeks 31 -> undefined -> kode berisi string
  // "undefined" (~31,7% kode!) yang lalu tak bisa dipakai pulih
  // (RECOVERY_CODE_RE menolaknya). Ditemukan Lane F2, 26 Nov 2026.
  for (let i = 0; i < 12; i++) out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

function normalizeRecoveryCode(code: unknown): string {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function issueRecoveryCode(db: Db, username: string): Promise<string> {
  const code = generateRecoveryCode();
  const codeHash = await sha256Hex(normalizeRecoveryCode(code));
  const { error } = await db.from("recovery_codes").upsert(
    { username, code_hash: codeHash, created_at: Date.now() },
    { onConflict: "username" },
  );
  if (error) throw error;
  return code;
}

async function handleRecover(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const ip = clientIp(request);
  if (!(await checkRateLimit(db, `recover:ip:${ip}`, 10, 60 * 1000))) {
    return json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429, cors);
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const username = normalizeUsername(data.username);
  if (!(await checkRateLimit(db, `recover:user:${username}`, 5, 15 * 60 * 1000))) {
    return json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429, cors);
  }
  const code = normalizeRecoveryCode(data.code);
  // Pesan generik untuk SEMUA kegagalan di bawah (anti-enumerasi).
  const genericFail = () =>
    json({ error: "Username atau kode pemulihan salah." }, 401, cors);
  if (!USERNAME_RE.test(username) || !RECOVERY_CODE_RE.test(code)) {
    return genericFail();
  }
  if (!PIN_RE.test(String(data.pin || ""))) return genericFail();
  const { data: user, error: userErr } = await db.from("users").select("username")
    .eq("username", username).maybeSingle();
  if (userErr) throw userErr;
  if (!user) return genericFail();
  const { data: row, error: rowErr } = await db.from("recovery_codes")
    .select("code_hash").eq("username", username).maybeSingle();
  if (rowErr) throw rowErr;
  if (!row) return genericFail();
  const expect = (row as { code_hash: string }).code_hash;
  if (!timingSafeEqual(await sha256Hex(code), expect)) return genericFail();
  // Sukses: konsumsi kode (single-use) + ganti PIN + tendang semua sesi.
  const { error: delErr } = await db.from("recovery_codes").delete()
    .eq("username", username);
  if (delErr) throw delErr;
  const salt = b64url(randomBytes(16));
  const pinHash = await hashPin(String(data.pin), salt);
  const { error: updErr } = await db.from("users").update({
    pin_hash: pinHash,
    salt,
  }).eq("username", username);
  if (updErr) throw updErr;
  await db.from("sessions").delete().eq("username", username);
  await db.from("login_attempts").delete().eq("username", username);
  const session = await createSession(db, username);
  const recoveryCode = await issueRecoveryCode(db, username);
  console.log(`[auth] recover ok username=${username}`);
  return json({ ...session, recoveryCode }, 200, cors);
}

async function handleIssueRecoveryCode(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) {
    return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  }
  if (!(await checkRateLimit(db, `reccode:user:${username}`, 5, 60 * 1000))) {
    return json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, 429, cors);
  }
  const recoveryCode = await issueRecoveryCode(db, username);
  return json({ recoveryCode }, 200, cors);
}
// ---------- /COZY-F2 pemulihan akun ----------

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

// ---------- COZY-E — Multiplayer economy (server-validated) ----------
// Prinsip (keputusan Izka): ekonomi multiplayer WAJIB divalidasi server.
// Client HANYA mengusulkan (offer id, item, lawan); server membaca save
// KEDUA pihak dari tabel `saves` MILIKNYA, memvalidasi ulang, lalu
// menerapkan swap + mencatat ke ledger. Delta koin/inventory kiriman
// client TIDAK PERNAH dipercaya. Endpoint di bawah butuh sesi Bearer yang
// sama seperti /api/save. Tabel: lihat migration 002.
//   GET  /api/mp/garden/:username   snapshot kebun publik (tanpa koin/inv)
//   POST /api/mp/trade/propose      {to, offer:{item,qty}, want:{item,qty}}
//   POST /api/mp/trade/accept       {offerId}
//   POST /api/mp/trade/decline      {offerId}
//   POST /api/mp/visit              {garden} -> hadiah 1x/hari (server)
//   POST /api/mp/minigame/submit    {room, score}
//   GET  /api/mp/minigame/results?room=XXXXXX
//   POST /api/mp/minigame/claim     {room} -> hadiah pemenang (server)
//   GET  /api/mp/leaderboard        peringkat dari save tersimpan + ledger
// COZY-E — start
const MP_TRADEABLE = INV_KEYS; // item yang boleh ditukar (benih + hasil)
const MP_TRADE_TTL_MS = 10 * 60 * 1000; // penawaran kedaluwarsa 10 menit
const MP_VISIT_REWARD = 10; // koin per kunjungan, 1x/pengunjung/kebun/hari
const MP_MINIGAME_REWARD = 20; // koin pemenang minigame bersama
const MP_MINIGAME_WINDOW_MS = 10 * 60 * 1000; // satu ronde = 10 menit
const MP_MINIGAME_MAX_SCORE = 200; // 20 detik x 10 ketuk/detik (plausibility cap)
const MP_COIN_CAP = 999999;

function mpDayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function mpWindowBucket(now = Date.now()): number {
  return Math.floor(now / MP_MINIGAME_WINDOW_MS);
}
function mpValidItemQty(item: unknown, qty: unknown): boolean {
  return typeof item === "string" && MP_TRADEABLE.includes(item) &&
    Number.isInteger(qty) && (qty as number) >= 1 && (qty as number) <= 99;
}

// Baca save tersimpan milik username dari tabel saves (sumber kebenaran
// server — BUKAN payload client). Kembalikan objek save terurai atau null.
// deno-lint-ignore no-explicit-any -- JSON save dari DB
async function mpLoadSave(db: Db, username: string): Promise<any | null> {
  const { data: row, error } = await db.from("saves").select("data")
    .eq("username", username).maybeSingle();
  if (error) throw error;
  if (!row) return null;
  try {
    const parsed = JSON.parse((row as { data: string }).data);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_e) {
    return null;
  }
}

// Tulis kembali save (objek penuh) ke tabel saves. updatedAt di-set ke kini
// supaya sinkronisasi last-write-wins tetap konsisten.
// deno-lint-ignore no-explicit-any -- JSON save ke DB
async function mpStoreSave(db: Db, username: string, save: any): Promise<void> {
  save.updatedAt = Date.now();
  const { error } = await db.from("saves").upsert(
    { username, data: JSON.stringify(save), updated_at: save.updatedAt },
    { onConflict: "username" },
  );
  if (error) throw error;
}

// Validasi bentuk minimal save yang dibaca dari DB (plots/animals/inv).
// Save yang lolos validateSave() saat PUT sudah berbentuk ini; cek ulang di
// sini supaya save korup tidak dipakai sebagai dasar trade/kunjungan.
// deno-lint-ignore no-explicit-any -- JSON save dari DB
function mpSaveShapeOk(save: any): boolean {
  if (!save || typeof save !== "object") return false;
  if (!save.inv || typeof save.inv !== "object") return false;
  for (const k of INV_KEYS) {
    // COZY-F2: kunci absen = 0 (save tersimpan pra-v3 tidak punya kunci
    // baru Lane C/D — tanpa toleransi ini, garden/trade/visit rusak untuk
    // semua akun lama sampai mereka menyimpan ulang).
    const v = save.inv[k] === undefined || save.inv[k] === null ? 0 : save.inv[k];
    if (!isInt(v, 0, 99999)) return false;
  }
  if (!Number.isInteger(save.coins) || save.coins < 0 || save.coins > MP_COIN_CAP) return false;
  if (!Array.isArray(save.plots) || save.plots.length !== 24) return false;
  for (const p of save.plots) {
    if (!p || typeof p !== "object") return false;
    if (!(p.crop === null || CROPS.includes(p.crop))) return false;
    if (!isInt(p.growth, 0, 4)) return false;
    if (!isBool(p.watered) || !isBool(p.hoed)) return false;
  }
  if (!Array.isArray(save.animals) || save.animals.length !== 5) return false;
  for (const a of save.animals) {
    if (!a || typeof a !== "object") return false;
    if (a.kind !== "ayam" && a.kind !== "sapi") return false;
    if (!isInt(a.ready, 0, 99) || !isBool(a.fed)) return false;
  }
  return true;
}

async function handleMpGarden(
  request: Request,
  db: Db,
  cors: Record<string, string>,
  targetRaw: string,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  const target = normalizeUsername(decodeURIComponent(targetRaw));
  if (!USERNAME_RE.test(target)) {
    return json({ error: "Username kebun tidak valid." }, 400, cors);
  }
  if (!(await checkRateLimit(db, `mp-read:user:${username}`, 60, 60 * 1000))) {
    return json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, 429, cors);
  }
  const save = await mpLoadSave(db, target);
  if (!save || !mpSaveShapeOk(save)) {
    return json({ error: "Kebun tidak ditemukan." }, 404, cors);
  }
  // Snapshot PUBLIK: hanya yang perlu dilihat saat berkunjung. Koin dan
  // inventory TIDAK PERNAH keluar dari endpoint ini.
  const custom: Record<string, string> = {};
  for (const [k, allowed] of Object.entries(CUSTOM_ALLOW)) {
    custom[k] = allowed.includes(save.custom?.[k]) ? save.custom[k] : allowed[0];
  }
  return json({
    ok: true,
    garden: {
      username: target,
      day: save.day,
      gender: save.gender === "female" ? "female" : "male",
      custom,
      plots: save.plots.map((p: { crop: string | null; growth: number; watered: boolean; hoed: boolean }) => ({
        crop: p.crop, growth: p.growth, watered: p.watered, hoed: p.hoed,
      })),
      animals: save.animals.map((a: { kind: string; ready: number; fed: boolean }) => ({
        kind: a.kind, ready: a.ready, fed: a.fed,
      })),
    },
  }, 200, cors);
}

async function handleMpTradePropose(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  if (!(await checkRateLimit(db, `mp-trade:user:${username}`, 10, 60 * 1000))) {
    return json({ error: "Terlalu banyak penawaran. Coba lagi nanti." }, 429, cors);
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const to = normalizeUsername(data.to);
  if (!USERNAME_RE.test(to) || to === username) {
    return json({ error: "Lawan tukar tidak valid." }, 400, cors);
  }
  const offer = data.offer || {};
  const want = data.want || {};
  if (!mpValidItemQty(offer.item, offer.qty) || !mpValidItemQty(want.item, want.qty)) {
    return json({ error: "Item/jumlah tukar tidak valid." }, 400, cors);
  }
  // Gate 1 (saat propose): pengusul BENAR-BENAR punya barangnya di save
  // server. Gate 2 yang menentukan ada di accept (baca ulang kedua save).
  const mySave = await mpLoadSave(db, username);
  if (!mySave || !mpSaveShapeOk(mySave)) {
    return json({ error: "Save kamu tidak ditemukan." }, 400, cors);
  }
  if ((mySave.inv[offer.item] || 0) < offer.qty) {
    return json({ error: "Kamu tidak punya cukup item itu." }, 400, cors);
  }
  const theirSave = await mpLoadSave(db, to);
  if (!theirSave || !mpSaveShapeOk(theirSave)) {
    return json({ error: "Lawan belum punya save di server." }, 400, cors);
  }
  const offerId = b64url(randomBytes(16));
  const now = Date.now();
  const { error: insErr } = await db.from("trade_offers").insert({
    id: offerId,
    from_username: username,
    to_username: to,
    offer_item: offer.item,
    offer_qty: offer.qty,
    want_item: want.item,
    want_qty: want.qty,
    status: "pending",
    created_at: now,
    expires_at: now + MP_TRADE_TTL_MS,
  });
  if (insErr) throw insErr;
  return json({ ok: true, offerId, expiresAt: now + MP_TRADE_TTL_MS }, 201, cors);
}

async function handleMpTradeAccept(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  if (!(await checkRateLimit(db, `mp-trade:user:${username}`, 10, 60 * 1000))) {
    return json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, 429, cors);
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const offerId = String(data.offerId || "");
  if (!offerId) return json({ error: "offerId wajib diisi." }, 400, cors);
  const { data: offerRow, error: selErr } = await db.from("trade_offers")
    .select("*").eq("id", offerId).maybeSingle();
  if (selErr) throw selErr;
  const offer = offerRow as {
    id: string; from_username: string; to_username: string;
    offer_item: string; offer_qty: number; want_item: string; want_qty: number;
    status: string; expires_at: number;
  } | null;
  if (!offer) return json({ error: "Penawaran tidak ditemukan." }, 404, cors);
  if (offer.to_username !== username) {
    return json({ error: "Penawaran ini bukan untukmu." }, 403, cors);
  }
  if (offer.status !== "pending") {
    return json({ error: `Penawaran sudah ${offer.status}.` }, 409, cors);
  }
  if (offer.expires_at < Date.now()) {
    await db.from("trade_offers").update({ status: "expired" }).eq("id", offerId);
    return json({ error: "Penawaran sudah kedaluwarsa." }, 410, cors);
  }
  // Klaim atomik: hanya SATU accept yang bisa mengubah pending -> accepted.
  // Bila baris tidak berubah (sudah diklaim pihak lain), tolak. `.select()`
  // di akhir memaksa supabase-js mengembalikan baris yang ter-update
  // (tanpa itu update bisa mengembalikan data null dan klaim tak terdeteksi).
  const { data: claimed, error: claimErr } = await db.from("trade_offers")
    .update({ status: "accepted" }).eq("id", offerId).eq("status", "pending").select();
  if (claimErr) throw claimErr;
  if (!claimed || (Array.isArray(claimed) && claimed.length === 0)) {
    return json({ error: "Penawaran sudah diproses pihak lain." }, 409, cors);
  }
  // Gate penentu — baca ulang KEDUA save dari server (bukan dari client):
  // penawaran palsu (pengusul sebenarnya tidak punya barang / lawan tidak
  // punya barang yang diminta) GUGUR di sini, walau propose lolos.
  const fromSave = await mpLoadSave(db, offer.from_username);
  const toSave = await mpLoadSave(db, username);
  if (!fromSave || !mpSaveShapeOk(fromSave) || !toSave || !mpSaveShapeOk(toSave)) {
    await db.from("trade_offers").update({ status: "failed" }).eq("id", offerId);
    return json({ error: "Save salah satu pihak tidak valid." }, 400, cors);
  }
  if ((fromSave.inv[offer.offer_item] || 0) < offer.offer_qty ||
    (toSave.inv[offer.want_item] || 0) < offer.want_qty) {
    await db.from("trade_offers").update({ status: "failed" }).eq("id", offerId);
    return json({ error: "Salah satu pihak tidak lagi punya item yang ditukar." }, 409, cors);
  }
  fromSave.inv[offer.offer_item] -= offer.offer_qty;
  fromSave.inv[offer.want_item] = (fromSave.inv[offer.want_item] || 0) + offer.want_qty;
  toSave.inv[offer.want_item] -= offer.want_qty;
  toSave.inv[offer.offer_item] = (toSave.inv[offer.offer_item] || 0) + offer.offer_qty;
  try {
    await mpStoreSave(db, offer.from_username, fromSave);
    await mpStoreSave(db, username, toSave);
  } catch (e) {
    // Save kedua gagal setelah save pertama tertulis: tandai failed supaya
    // ledger tidak mencatat trade setengah jalan. (Batasan dicatat: tanpa
    // transaksi Postgres multi-tabel, pemulihan penuh butuh intervensi
    // manual — lihat LANE-E-REPORT.)
    await db.from("trade_offers").update({ status: "failed" }).eq("id", offerId);
    throw e;
  }
  const { error: ledErr } = await db.from("trade_ledger").insert({
    offer_id: offerId,
    from_username: offer.from_username,
    to_username: username,
    offer_item: offer.offer_item,
    offer_qty: offer.offer_qty,
    want_item: offer.want_item,
    want_qty: offer.want_qty,
    created_at: Date.now(),
  });
  if (ledErr) throw ledErr;
  return json({
    ok: true,
    offerId,
    // Kembalikan save PIHAK PEMANGGIL sesudah swap supaya client-nya bisa
    // refresh inv/koin tanpa fetch save lagi. Pihak pengusul refresh lewat
    // GET /api/save saat menerima broadcast trade_done.
    inv: toSave.inv,
    coins: toSave.coins,
    // + save PENGUSUL sesudah swap (server-computed). Disampaikan ke
    // pengusul lewat broadcast trade_done supaya ia menerapkan inv baru
    // SEGERA — menutup balapan autosave-vs-refresh: tanpa ini, PUT autosave
    // pengusul (state lama) bisa menimpa swap di server sebelum GET refresh
    // selesai. Broadcast hanya merelay nilai hasil server; GET sesudahnya
    // tetap mengonfirmasi dari server, dan client memvalidasi bentuknya
    // (kunci inv dikenal + integer dalam range) sebelum menerapkan.
    peerInv: fromSave.inv,
    peerCoins: fromSave.coins,
  }, 200, cors);
}

async function handleMpTradeDecline(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const offerId = String(data.offerId || "");
  if (!offerId) return json({ error: "offerId wajib diisi." }, 400, cors);
  const { data: offerRow, error: selErr } = await db.from("trade_offers")
    .select("to_username, status").eq("id", offerId).maybeSingle();
  if (selErr) throw selErr;
  const offer = offerRow as { to_username: string; status: string } | null;
  if (!offer) return json({ error: "Penawaran tidak ditemukan." }, 404, cors);
  if (offer.to_username !== username) {
    return json({ error: "Penawaran ini bukan untukmu." }, 403, cors);
  }
  if (offer.status !== "pending") {
    return json({ error: `Penawaran sudah ${offer.status}.` }, 409, cors);
  }
  const { error: updErr } = await db.from("trade_offers")
    .update({ status: "declined" }).eq("id", offerId).eq("status", "pending");
  if (updErr) throw updErr;
  return json({ ok: true, offerId }, 200, cors);
}

async function handleMpVisit(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  if (!(await checkRateLimit(db, `mp-visit:user:${username}`, 30, 60 * 1000))) {
    return json({ error: "Terlalu banyak kunjungan. Coba lagi nanti." }, 429, cors);
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const garden = normalizeUsername(data.garden);
  if (!USERNAME_RE.test(garden) || garden === username) {
    return json({ error: "Kebun yang dikunjungi tidak valid." }, 400, cors);
  }
  const targetSave = await mpLoadSave(db, garden);
  if (!targetSave || !mpSaveShapeOk(targetSave)) {
    return json({ error: "Kebun tidak ditemukan." }, 404, cors);
  }
  const dayKey = mpDayKey();
  const { data: seen, error: selErr } = await db.from("visit_ledger")
    .select("id").eq("visitor", username).eq("garden", garden)
    .eq("day_key", dayKey).maybeSingle();
  if (selErr) throw selErr;
  // Aturan sekali-sehari ditegakkan SERVER (ledger), bukan client: panggil
  // ulang di hari yang sama -> sudah diklaim, hadiah 0, tanpa dobel koin.
  if (seen) return json({ ok: true, already: true, reward: 0 }, 200, cors);
  const mySave = await mpLoadSave(db, username);
  if (!mySave || !mpSaveShapeOk(mySave)) {
    return json({ error: "Save kamu tidak ditemukan." }, 400, cors);
  }
  const granted = Math.min(MP_VISIT_REWARD, MP_COIN_CAP - mySave.coins);
  mySave.coins += granted;
  await mpStoreSave(db, username, mySave);
  const { error: insErr } = await db.from("visit_ledger").insert({
    visitor: username,
    garden,
    day_key: dayKey,
    reward: granted,
    created_at: Date.now(),
  });
  if (insErr) throw insErr;
  return json({ ok: true, already: false, reward: granted, coins: mySave.coins }, 200, cors);
}

async function handleMpMinigameSubmit(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  if (!(await checkRateLimit(db, `mp-game:user:${username}`, 30, 60 * 1000))) {
    return json({ error: "Terlalu banyak pengiriman skor. Coba lagi nanti." }, 429, cors);
  }
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const room = String(data.room || "").trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(room)) {
    return json({ error: "Kode room tidak valid." }, 400, cors);
  }
  // Skor dilaporkan client (jumlah ketukan) — server hanya menerima yang
  // masuk akal (cap plausibility) dan YANG MENENTUKAN pemenang/hadiah
  // adalah server (lihat claim). Anti-autoclick penuh di luar scope lane.
  if (!Number.isInteger(data.score) || data.score < 0 || data.score > MP_MINIGAME_MAX_SCORE) {
    return json({ error: "Skor tidak valid." }, 400, cors);
  }
  const bucket = mpWindowBucket();
  const { data: prev, error: selErr } = await db.from("minigame_scores")
    .select("score").eq("room", room).eq("username", username)
    .eq("window_bucket", bucket).maybeSingle();
  if (selErr) throw selErr;
  const best = Math.max(data.score, (prev as { score: number } | null)?.score || 0);
  if (prev) {
    const { error: updErr } = await db.from("minigame_scores")
      .update({ score: best, created_at: Date.now() })
      .eq("room", room).eq("username", username).eq("window_bucket", bucket);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await db.from("minigame_scores").insert({
      room, username, score: best, window_bucket: bucket,
      rewarded: false, created_at: Date.now(),
    });
    if (insErr) throw insErr;
  }
  return json({ ok: true, score: best, room, windowBucket: bucket }, 200, cors);
}

async function handleMpMinigameResults(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  const url = new URL(request.url);
  const room = (url.searchParams.get("room") || "").trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(room)) {
    return json({ error: "Kode room tidak valid." }, 400, cors);
  }
  const bucket = mpWindowBucket();
  const { data: rows, error } = await db.from("minigame_scores")
    .select("username, score, rewarded").eq("room", room)
    .eq("window_bucket", bucket);
  if (error) throw error;
  const list = ((rows || []) as { username: string; score: number; rewarded: boolean }[])
    .sort((a, b) => b.score - a.score).slice(0, 10);
  return json({
    ok: true, room, windowBucket: bucket,
    winner: list.length > 0 ? list[0].username : null,
    rewarded: list.length > 0 ? list[0].rewarded : false,
    scores: list,
  }, 200, cors);
}

async function handleMpMinigameClaim(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  const { data, error } = await readBody(request);
  if (error) return json({ error }, 400, cors);
  const room = String(data.room || "").trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(room)) {
    return json({ error: "Kode room tidak valid." }, 400, cors);
  }
  const bucket = mpWindowBucket();
  const { data: rows, error: selErr } = await db.from("minigame_scores")
    .select("username, score, rewarded").eq("room", room)
    .eq("window_bucket", bucket);
  if (selErr) throw selErr;
  const list = ((rows || []) as { username: string; score: number; rewarded: boolean }[])
    .sort((a, b) => b.score - a.score);
  if (list.length === 0) return json({ error: "Belum ada skor di ronde ini." }, 404, cors);
  const win = list[0];
  if (win.username !== username) {
    return json({ error: "Kamu bukan pemenang ronde ini.", winner: win.username }, 403, cors);
  }
  if (win.rewarded) return json({ ok: true, already: true, reward: 0 }, 200, cors);
  // Tandai rewarded DULU (klaim atomik per ronde), baru beri koin — klaim
  // ganda dari dua request bersamaan tidak bisa dobel hadiah.
  const { data: claimed, error: claimErr } = await db.from("minigame_scores")
    .update({ rewarded: true }).eq("room", room).eq("username", username)
    .eq("window_bucket", bucket).eq("rewarded", false).select();
  if (claimErr) throw claimErr;
  if (!claimed || (Array.isArray(claimed) && claimed.length === 0)) {
    return json({ ok: true, already: true, reward: 0 }, 200, cors);
  }
  const mySave = await mpLoadSave(db, username);
  if (!mySave || !mpSaveShapeOk(mySave)) {
    return json({ error: "Save kamu tidak ditemukan." }, 400, cors);
  }
  const granted = Math.min(MP_MINIGAME_REWARD, MP_COIN_CAP - mySave.coins);
  mySave.coins += granted;
  await mpStoreSave(db, username, mySave);
  return json({ ok: true, already: false, reward: granted, coins: mySave.coins }, 200, cors);
}

async function handleMpLeaderboard(
  request: Request,
  db: Db,
  cors: Record<string, string>,
): Promise<Response> {
  const username = await authUsername(request, db);
  if (!username) return json({ error: "Sesi tidak valid. Login lagi." }, 401, cors);
  if (!(await checkRateLimit(db, `mp-read:user:${username}`, 60, 60 * 1000))) {
    return json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, 429, cors);
  }
  // Peringkat dihitung SERVER dari save tersimpan (koin + hari) dan volume
  // trade dari ledger. Client hanya menampilkan. BATASAN JUJUR: peringkat
  // ini se-tepercaya save tersimpan — save PUT saat ini hanya range-check
  // (lihat ARCHITECTURE §7); konsistensi koin penuh adalah item F2.
  const { data: saves, error: savesErr } = await db.from("saves")
    .select("username, data, updated_at");
  if (savesErr) throw savesErr;
  const { data: trades, error: tradesErr } = await db.from("trade_ledger")
    .select("from_username, to_username");
  if (tradesErr) throw tradesErr;
  const tradeCount: Record<string, number> = {};
  for (const tr of (trades || []) as { from_username: string; to_username: string }[]) {
    tradeCount[tr.from_username] = (tradeCount[tr.from_username] || 0) + 1;
    tradeCount[tr.to_username] = (tradeCount[tr.to_username] || 0) + 1;
  }
  const board: { username: string; coins: number; day: number; trades: number }[] = [];
  for (const row of (saves || []) as { username: string; data: string }[]) {
    let parsed: { coins?: number; day?: number } | null = null;
    try { parsed = JSON.parse(row.data); } catch (_e) { parsed = null; }
    if (!parsed || !Number.isInteger(parsed.coins) || !Number.isInteger(parsed.day)) continue;
    board.push({
      username: row.username,
      coins: parsed.coins as number,
      day: parsed.day as number,
      trades: tradeCount[row.username] || 0,
    });
  }
  board.sort((a, b) => b.coins - a.coins || b.day - a.day);
  return json({ ok: true, board: board.slice(0, 10) }, 200, cors);
}
// COZY-E — end

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
    // COZY-F2 — pemulihan akun (lihat seksi COZY-F2).
    if (path === "/api/auth/recover" && req.method === "POST") {
      return await handleRecover(req, db, cors);
    }
    if (path === "/api/auth/recovery-code" && req.method === "POST") {
      return await handleIssueRecoveryCode(req, db, cors);
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
    // COZY-E — start: endpoint ekonomi multiplayer (server-validated).
    if (path.startsWith("/api/mp/garden/") && req.method === "GET") {
      return await handleMpGarden(req, db, cors, path.slice("/api/mp/garden/".length));
    }
    if (path === "/api/mp/trade/propose" && req.method === "POST") {
      return await handleMpTradePropose(req, db, cors);
    }
    if (path === "/api/mp/trade/accept" && req.method === "POST") {
      return await handleMpTradeAccept(req, db, cors);
    }
    if (path === "/api/mp/trade/decline" && req.method === "POST") {
      return await handleMpTradeDecline(req, db, cors);
    }
    if (path === "/api/mp/visit" && req.method === "POST") {
      return await handleMpVisit(req, db, cors);
    }
    if (path === "/api/mp/minigame/submit" && req.method === "POST") {
      return await handleMpMinigameSubmit(req, db, cors);
    }
    if (path === "/api/mp/minigame/results" && req.method === "GET") {
      return await handleMpMinigameResults(req, db, cors);
    }
    if (path === "/api/mp/minigame/claim" && req.method === "POST") {
      return await handleMpMinigameClaim(req, db, cors);
    }
    if (path === "/api/mp/leaderboard" && req.method === "GET") {
      return await handleMpLeaderboard(req, db, cors);
    }
    // COZY-E — end
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
