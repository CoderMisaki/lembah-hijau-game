// cloud.js — client API backend Lembah Hijau (Supabase Edge Function).
// DRAF untuk migrasi dari Cloudflare Workers + D1. JANGAN timpa
// src/cloud.js yang lama sebelum migrasi ini lolos verifikasi live.
// Setelah lolos: ganti src/cloud.js dengan file ini + isi meta
// lh-supabase-anon-key di index.html (lihat DEPLOY-SUPABASE.md).
//
// Perbedaan dari versi Workers (semua perilaku lain IDENTIK):
//  - Base URL default = Edge Function lembah-hijau-api di project Supabase
//    (bisa di-override via window.LH_API_BASE atau meta lh-api-base).
//  - Setiap request WAJIB membawa header `apikey` (anon key) agar gateway
//    Supabase me-routing request ke Edge Function. Anon key BUKAN secret
//    (publishable), tapi JANGAN tulis nilainya di repo: isi lewat
//    window.LH_SUPABASE_ANON_KEY atau <meta name="lh-supabase-anon-key">.
//  - Token sesi tetap dikirim di `Authorization: Bearer <token>` seperti
//    sebelumnya; jangan kirim anon key sebagai Authorization.
//
// Auth: username + PIN 6 digit. PIN HANYA dikirim saat register/login (HTTPS),
// TIDAK PERNAH disimpan di perangkat dan TIDAK PERNAH dikirim di request
// save/load — request itu memakai token sesi acak dari server.
//
// Aturan sinkronisasi (lihat juga README):
//  - localStorage = cache/fallback offline; backend = sumber kebenaran.
//  - Login/mulai: ambil save server. Bila server lebih baru (updatedAt lebih
//    besar) -> pakai server. Bila lokal lebih baru (main offline) -> upload
//    lokal ke server. Bila updatedAt sama -> server menang (tie-break).
//  - Gagal jaringan saat save -> tandai pending, coba lagi di save berikut /
//    saat event 'online'. Progress lokal TIDAK PERNAH hilang karena offline.
//  - Tombol Muat (manual) SELALU mengambil dari server (server menang).

export const SESSION_KEY = 'lembahHijauSessionV1';
export const PENDING_KEY = 'lembahHijauPendingSyncV1';
export const API_BASE_META = 'lh-api-base';
export const ANON_KEY_META = 'lh-supabase-anon-key';

// URL default Edge Function (bukan secret — alamat publik project).
export const DEFAULT_API_BASE = 'https://ajsliyqjucgdtbimvdtd.supabase.co/functions/v1/lembah-hijau-api';

export function getApiBase() {
  // Urutan: window.LH_API_BASE -> <meta name="lh-api-base"> -> Edge Function
  // default -> localhost dev (supabase functions serve :54321).
  if (typeof window !== 'undefined' && window.LH_API_BASE) return String(window.LH_API_BASE).replace(/\/$/, '');
  const meta = document.querySelector('meta[name="lh-api-base"]');
  const fromMeta = meta ? (meta.getAttribute('content') || '').trim() : '';
  if (fromMeta) return fromMeta.replace(/\/$/, '');
  if (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    return 'http://localhost:54321/functions/v1/lembah-hijau-api';
  }
  return DEFAULT_API_BASE;
}

export function getAnonKey() {
  // Urutan: window.LH_SUPABASE_ANON_KEY -> <meta name="lh-supabase-anon-key">.
  // Anon key adalah publishable key; nilainya diisi di index.html saat
  // deploy (dari ~/.config/supabase-lembah-hijau/keys), BUKAN di file ini.
  if (typeof window !== 'undefined' && window.LH_SUPABASE_ANON_KEY) return String(window.LH_SUPABASE_ANON_KEY).trim();
  const meta = document.querySelector('meta[name="lh-supabase-anon-key"]');
  const fromMeta = meta ? (meta.getAttribute('content') || '').trim() : '';
  return fromMeta;
}

function apiUrl(path) {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
}

async function fetchJson(path, { method = 'GET', body = null, token = null, timeoutMs = 10000 } = {}) {
  const anonKey = getAnonKey();
  if (!anonKey) throw new Error('missing_anon_key');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json', 'apikey': anonKey };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(apiUrl(path), {
      method, headers, signal: ctrl.signal,
      body: body ? JSON.stringify(body) : null,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Sesi (token saja; PIN tidak pernah disimpan) ----------
export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.token || !s.username) return null;
    if (s.expiresAt && s.expiresAt < Date.now()) { clearSession(); return null; }
    return s;
  } catch (e) { return null; }
}

export function setSession({ token, username, expiresAt }) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, username, expiresAt }));
  } catch (e) { /* abaikan */ }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* abaikan */ }
}

export function markPending() {
  try { localStorage.setItem(PENDING_KEY, '1'); } catch (e) { /* abaikan */ }
}
export function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch (e) { /* abaikan */ }
}
export function hasPending() {
  try { return localStorage.getItem(PENDING_KEY) === '1'; } catch (e) { return false; }
}

// ---------- Validasi client (server tetap memvalidasi ulang) ----------
export function validateUsername(username) {
  if (typeof username !== 'string') return false;
  return /^[a-z0-9_]{3,16}$/.test(username.trim().toLowerCase());
}
export function validatePin(pin) {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}
export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

// ---------- Auth ----------
export async function register(username, pin) {
  const u = normalizeUsername(username);
  if (!validateUsername(u)) throw new Error('invalid_username');
  if (!validatePin(pin)) throw new Error('invalid_pin');
  const data = await fetchJson('/api/auth/register', { method: 'POST', body: { username: u, pin } });
  if (data.token) setSession(data);
  return data;
}

export async function login(username, pin) {
  const u = normalizeUsername(username);
  if (!validateUsername(u)) throw new Error('invalid_username');
  if (!validatePin(pin)) throw new Error('invalid_pin');
  const data = await fetchJson('/api/auth/login', { method: 'POST', body: { username: u, pin } });
  if (data.token) setSession(data);
  return data;
}

export async function logout() {
  const s = getSession();
  if (s) {
    try { await fetchJson('/api/auth/logout', { method: 'POST', token: s.token }); } catch (e) { /* abaikan */ }
  }
  clearSession();
}

// ---------- Save / Load ----------
export async function cloudGetSave() {
  const s = getSession();
  if (!s) throw new Error('no_session');
  return fetchJson('/api/save', { token: s.token });
}

export async function cloudPutSave(saveData) {
  const s = getSession();
  if (!s) throw new Error('no_session');
  return fetchJson('/api/save', { method: 'PUT', body: { save: saveData }, token: s.token });
}

export async function cloudDeleteSave() {
  const s = getSession();
  if (!s) throw new Error('no_session');
  return fetchJson('/api/save', { method: 'DELETE', token: s.token });
}

export async function cloudHealth() {
  try {
    const data = await fetchJson('/api/health', { timeoutMs: 5000 });
    return data && data.ok === true;
  } catch (e) { return false; }
}
