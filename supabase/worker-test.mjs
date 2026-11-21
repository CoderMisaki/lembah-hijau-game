// worker-test.mjs — uji independen API Lembah Hijau versi Supabase Edge Function.
// Adaptasi 1:1 dari ~/workspace/lembah-hijau-game-verify/worker-test.mjs
// (29 skenario yang sama, perilaku yang diuji sama persis).
//
// Perbedaan dari versi Workers:
//  - BASE default = URL Edge Function ter-deploy (bukan localhost:8787).
//  - Setiap request membawa header `apikey` (anon key) — WAJIB agar gateway
//    Supabase me-routing request ke Edge Function.
//  - Token sesi tetap di `Authorization: Bearer <token>` seperti sebelumnya.
//
// Cara pakai:
//   # Lawan Edge Function ter-deploy (default; baca anon key dari keys file):
//   node worker-test.mjs
//   # Lawan serve lokal (supabase functions serve):
//   LH_TEST_BASE=http://localhost:54321/functions/v1/lembah-hijau-api node worker-test.mjs
//   # Override eksplisit:
//   LH_TEST_BASE=<url> SUPABASE_ANON_KEY=<anon-key> node worker-test.mjs
//
// Keluar 0 bila semua PASS.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_BASE = 'https://ajsliyqjucgdtbimvdtd.supabase.co/functions/v1/lembah-hijau-api';
const BASE = (process.env.LH_TEST_BASE || DEFAULT_BASE).replace(/\/$/, '');

function anonKeyFromFile() {
  try {
    const text = readFileSync(join(homedir(), '.config', 'supabase-lembah-hijau', 'keys'), 'utf8');
    for (const line of text.split('\n')) {
      const m = /^ANON_KEY=(.+)$/.exec(line.trim());
      if (m) return m[1].trim();
    }
  } catch { /* abaikan */ }
  return '';
}
const ANON_KEY = process.env.SUPABASE_ANON_KEY || anonKeyFromFile();
if (!ANON_KEY) {
  console.error('ANON_KEY tidak ditemukan: set env SUPABASE_ANON_KEY atau isi ~/.config/supabase-lembah-hijau/keys');
  process.exit(2);
}

let PASS = 0, FAIL = 0;
function ck(name, ok, detail = '') {
  if (ok) { PASS++; console.log(`PASS  ${name}`); }
  else { FAIL++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
async function req(method, path, { body = null, token = null, origin = null } = {}) {
  const headers = { 'Content-Type': 'application/json', 'apikey': ANON_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : null });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}
const SUF = String(Date.now()).slice(-6);
const UA = `wtesta${SUF}`, UB = `wtestb${SUF}`, UC = `wtestc${SUF}`, UD = `wteste${SUF}`, UE = `wtestf${SUF}`;
const PIN = '123456', WRONG = '999999';

// 1. health
let r = await req('GET', '/api/health');
ck('health 200 + ok', r.status === 200 && r.json?.ok === true, `status=${r.status} body=${r.text.slice(0,80)}`);

// 2. register A
r = await req('POST', '/api/auth/register', { body: { username: UA, pin: PIN } });
ck('register A 201', r.status === 201, `status=${r.status} body=${r.text.slice(0,120)}`);
ck('register A ada token', !!r.json?.token);
ck('register A: PIN tidak ada di response', !r.text.includes(PIN));
const tokenA = r.json?.token;

// 3. duplikat
r = await req('POST', '/api/auth/register', { body: { username: UA, pin: PIN } });
ck('register duplikat 409', r.status === 409, `status=${r.status}`);

// 4. validasi register
r = await req('POST', '/api/auth/register', { body: { username: 'ab', pin: PIN } });
ck('register username pendek 400', r.status === 400, `status=${r.status}`);
r = await req('POST', '/api/auth/register', { body: { username: `wtestx${SUF}`, pin: '12345' } });
ck('register PIN 5 digit 400', r.status === 400, `status=${r.status}`);
r = await req('POST', '/api/auth/register', { body: { username: `wtesty${SUF}`, pin: 'abcdef' } });
ck('register PIN huruf 400', r.status === 400, `status=${r.status}`);

// 5. login benar
r = await req('POST', '/api/auth/login', { body: { username: UA, pin: PIN } });
ck('login benar 200', r.status === 200, `status=${r.status} body=${r.text.slice(0,120)}`);
ck('login benar: PIN tidak ada di response', !r.text.includes(PIN));

// 6. login user tidak ada -> 401 generik
r = await req('POST', '/api/auth/login', { body: { username: `tidakada${SUF}`, pin: WRONG } });
ck('login user tidak ada 401 generik', r.status === 401 && r.json?.error === 'Username atau PIN salah.', `status=${r.status} body=${r.text.slice(0,100)}`);

// 7. lockout user B
await req('POST', '/api/auth/register', { body: { username: UB, pin: PIN } });
const seq = [];
for (let i = 0; i < 5; i++) { const x = await req('POST', '/api/auth/login', { body: { username: UB, pin: WRONG } }); seq.push(x.status); }
ck('lockout 5x salah = 401 401 401 401 429', seq.join(',') === '401,401,401,401,429', `seq=${seq.join(',')}`);
r = await req('POST', '/api/auth/login', { body: { username: UB, pin: PIN } });
ck('PIN benar saat terkunci tetap 429', r.status === 429, `status=${r.status}`);

// 8. GET save tanpa/palsu token
r = await req('GET', '/api/save');
ck('GET save tanpa token 401', r.status === 401, `status=${r.status}`);
r = await req('GET', '/api/save', { token: 'palsu123' });
ck('GET save token palsu 401', r.status === 401, `status=${r.status}`);

// 9. PUT save valid -> 200; GET kembali utuh
const plots = Array.from({ length: 24 }, () => ({ crop: null, growth: 0, watered: false, hoed: false }));
plots[0] = { crop: 'carrot', growth: 2, watered: true, hoed: true };
const animals = [
  { kind: 'ayam', x: 1, z: 2, fed: true, ready: 1 }, { kind: 'ayam', x: 2, z: 3, fed: false, ready: 0 },
  { kind: 'ayam', x: 3, z: 4, fed: true, ready: 2 }, { kind: 'sapi', x: 5, z: 6, fed: false, ready: 0 },
  { kind: 'sapi', x: 7, z: 8, fed: true, ready: 1 }];
const validSave = { coins: 100, day: 3, minutes: 500, lang: 'id', gender: 'male', sound: true, quality: 'medium',
  updatedAt: 1795262500000, username: UA,
  inv: { carrotSeed: 1, tomatoSeed: 2, pumpkinSeed: 0, feed: 3, carrot: 4, tomato: 0, pumpkin: 0, egg: 1, milk: 0 },
  plots, animals, player: { x: 6, z: 20 },
  custom: { skin: 'medium', hairStyle: 'short', hairColor: 'black', shirtModel: 'tee', shirtColor: 'green',
    pantsModel: 'pants', pantsColor: 'blue', hatModel: 'cap', hatColor: 'red', glassesModel: 'none',
    glassesColor: 'black', shoesModel: 'boots', shoesColor: 'brown' } };
r = await req('PUT', '/api/save', { body: { save: validSave }, token: tokenA });
ck('PUT save valid 200', r.status === 200, `status=${r.status} body=${r.text.slice(0,120)}`);
r = await req('GET', '/api/save', { token: tokenA });
ck('GET save coins=100', r.json?.save?.coins === 100, `body=${r.text.slice(0,120)}`);
ck('GET save hatModel=cap', r.json?.save?.custom?.hatModel === 'cap');
ck('GET save plot0 carrot growth2', r.json?.save?.plots?.[0]?.crop === 'carrot' && r.json?.save?.plots?.[0]?.growth === 2);

// 10. PUT tidak valid -> 400
const bad = (mut) => { const s = JSON.parse(JSON.stringify(validSave)); mut(s); return { save: s }; };
r = await req('PUT', '/api/save', { body: bad((s) => { s.coins = 1000000; }), token: tokenA });
ck('PUT save invalid (coins) 400', r.status === 400, `status=${r.status}`);
r = await req('PUT', '/api/save', { body: bad((s) => { s.plots = s.plots.slice(0, 23); }), token: tokenA });
ck('PUT save invalid (plots 23) 400', r.status === 400, `status=${r.status}`);
r = await req('PUT', '/api/save', { body: bad((s) => { s.custom.hatModel = 'topi-ajaib'; }), token: tokenA });
ck("PUT save invalid (custom) 400", r.status === 400, `status=${r.status}`);
r = await req('PUT', '/api/save', { body: bad((s) => { s.username = 'oranglain'; }), token: tokenA });
ck('PUT save invalid (username mismatch) 400', r.status === 400, `status=${r.status}`);
r = await req('PUT', '/api/save', { body: bad((s) => { s.hacked = true; }), token: tokenA });
const gx = await req('GET', '/api/save', { token: tokenA });
ck('PUT extra field 200 tapi dibuang', r.status === 200 && !('hacked' in (gx.json?.save ?? {})), `put=${r.status} hacked_in_get=${'hacked' in (gx.json?.save ?? {})}`);

// 11. CORS
r = await req('POST', '/api/auth/register', { body: { username: UC, pin: PIN }, origin: 'https://evil.example.com' });
ck('CORS origin asing 403', r.status === 403, `status=${r.status}`);
r = await req('POST', '/api/auth/register', { body: { username: UD, pin: PIN }, origin: 'https://lembah-hijau.pages.dev' });
ck('CORS origin pages.dev terdaftar diizinkan', r.status === 201, `status=${r.status}`);
r = await req('POST', '/api/auth/register', { body: { username: UE, pin: PIN }, origin: 'https://foo.pages.dev' });
ck('CORS origin pages.dev tak terdaftar 403 (mode produksi: ALLOWED_ORIGINS terisi menggantikan allowance dev *.pages.dev)', r.status === 403, `status=${r.status}`);

// 12. Payload >64KB
r = await req('PUT', '/api/save', { body: { save: { x: 'A'.repeat(70000) } }, token: tokenA });
ck('payload >64KB 400', r.status === 400, `status=${r.status}`);

// 13. logout -> token mati
r = await req('POST', '/api/auth/logout', { token: tokenA });
ck('logout 200', r.status === 200, `status=${r.status}`);
r = await req('GET', '/api/save', { token: tokenA });
ck('GET save setelah logout 401', r.status === 401, `status=${r.status}`);

console.log('----');
console.log(`BASE=${BASE}`);
console.log(`PASS=${PASS} FAIL=${FAIL}`);
process.exit(FAIL === 0 ? 0 : 1);
