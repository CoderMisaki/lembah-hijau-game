# DEPLOY — Lembah Hijau (GitHub Pages + Supabase)

Status saat ini: **LIVE.** Game statis di GitHub Pages (branch
**master**, `.nojekyll`) + backend Supabase (Edge Function
`lembah-hijau-api`, project `lembah-hijau`
`ajsliyqjucgdtbimvdtd`). Client (`src/cloud.js`) + `index.html` sudah
menunjuk ke Edge Function, dan backend menjawab `GET /api/health`
dengan `{"ok":true}` (terverifikasi live 26 Nov 2026). Yang sudah
**teruji**: game di headless Chrome (29/29 landscape, 25/25 portrait)
dan harness API Supabase 29 skenario (`supabase/worker-test.mjs`).

> Catatan: backend lama Cloudflare Workers/D1 sudah TIDAK dipakai.
> Langkah-langkah lamanya TIDAK dihapus — dipindah ke bagian
> **HISTORIS** di bawah sebagai referensi/rollback. Jangan deploy
> dari bagian itu. Detail legacy: `worker/DEPRECATED.md`.

## 0. Gambaran deploy saat ini

| Bagian | Di mana | Cara deploy |
|---|---|---|
| Game statis (HTML/CSS/JS) | GitHub Pages — https://codermisaki.github.io/lembah-hijau-game/ | Push ke branch `master` (repo `CoderMisaki/lembah-hijau-game`); Pages deploy otomatis, tunggu ±1 menit |
| Backend API + auth + save | Supabase Edge Function `lembah-hijau-api` — https://ajsliyqjucgdtbimvdtd.supabase.co/functions/v1/lembah-hijau-api | Dashboard Supabase / CLI, lihat `supabase/DEPLOY-SUPABASE.md` |
| Database | Postgres Supabase (10 tabel: `users`, `sessions`, `saves`, `login_attempts`, `rate_limits` + `trade_offers`, `trade_ledger`, `visit_ledger`, `minigame_scores` [migrasi 002, ekonomi multiplayer] + `recovery_codes` [migrasi 003, kode pemulihan akun]) | SQL Editor, lihat `supabase/DEPLOY-SUPABASE.md` langkah 1 |

## 1. Deploy game statis (GitHub Pages)

```bash
cd ~/workspace/lembah-hijau-game
git push origin master
# GitHub Pages mengambil branch master (terverifikasi via gh api:
# pages source.branch=master, default_branch=master).
# Tunggu ±1 menit, lalu buka https://codermisaki.github.io/lembah-hijau-game/
```

Tidak ada build step, tidak ada CI. `.nojekyll` di root wajib ada agar
Pages menyajikan file apa adanya (termasuk path berawalan `_`).

## 2. Deploy / redeploy backend (Supabase)

Langkah lengkap ada di [`supabase/DEPLOY-SUPABASE.md`](supabase/DEPLOY-SUPABASE.md)
— ringkasnya:

1. **Tabel:** paste `supabase/migrations/001_lembah_hijau.sql` di SQL
   Editor dashboard, Run. Harus ada 5 tabel di schema `public`.
   RLS aktif di semua tabel TANPA policy (disengaja — hanya Edge
   Function dengan `service_role` yang bisa akses).
   Lalu, BERURUTAN: `supabase/migrations/002_lembah_hijau_multiplayer.sql`
   (4 tabel ekonomi multiplayer) dan
   `supabase/migrations/003_lembah_hijau_recovery.sql`
   (1 tabel `recovery_codes` — kode pemulihan akun, Wave-3).
   Total 10 tabel. Semua file aman dijalankan ulang (`IF NOT EXISTS`).
2. **Edge Function:** buat fungsi **`lembah-hijau-api`**, matikan
   **Verify JWT** (API memakai token sesi sendiri, bukan JWT Supabase
   Auth), paste `supabase/functions/lembah-hijau-api/index.ts`, Deploy.
3. **Secret CORS:** `ALLOWED_ORIGINS` =
   `https://codermisaki.github.io,https://lembah-hijau.pages.dev`
   (tanpa spasi, tanpa trailing slash), lalu redeploy bila diminta.
   `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` disediakan otomatis
   oleh runtime — jangan diset manual.
4. **Sambungkan game:** `index.html` sudah berisi 2 meta ini (jangan
   dihapus):
   ```html
   <meta name="lh-api-base" content="https://ajsliyqjucgdtbimvdtd.supabase.co/functions/v1/lembah-hijau-api">
   <meta name="lh-supabase-anon-key" content="<ANON_KEY dari keys file>">
   ```
   Anon key adalah publishable key (aman tampil di HTML publik).
   Jangan pernah isi service_role key ke HTML.

## 3. Verifikasi produksi (wajib sebelum diumumkan)

```bash
cd ~/workspace/lembah-hijau-game/supabase
KEY=$(grep '^ANON_KEY=' ~/.config/supabase-lembah-hijau/keys | cut -d= -f2-)
URL=https://ajsliyqjucgdtbimvdtd.supabase.co/functions/v1/lembah-hijau-api

curl -s $URL/api/health -H "apikey: $KEY"
# -> {"ok":true,"service":"lembah-hijau","time":...}

# Harness 29 skenario (register -> login -> save -> load -> lockout 5x -> logout):
node worker-test.mjs
# -> harus PASS=29 FAIL=0. Username test ber-suffix timestamp, aman
#    dijalankan ulang (tidak bentrok dengan akun asli).
```

Lalu di browser: buka URL Pages → Buat Akun → main sebentar → tekan
💾 Simpan → muat ulang halaman → login lagi → progress + kustomisasi
harus kembali utuh.

## 4. Wave-3 (Cozy Life Simulation, 26 Nov 2026 — Lane F2)

- **Save v3** (`SAVE_VERSION = 3`, `src/save.js`): mencakup SEMUA field
  baru Wave-1/2 (discoveredSpots, 12 kunci inv baru + invQ + trees +
  machineCooldown + soil/fert petak, npcFriendship/npcGiftedDay/npcChatDay/
  npcMet/npcQuests/npcFestival, mpVisits/mpTrades/mpMinigameBest, season).
  Save v2 lama tetap terbaca (migrasi malas v2→v3, progres utuh).
  Server `validateSave()` menerima v2/v3, selalu menulis v3; field yang
  tidak dikenal tetap dibuang. **Musim tersimpan, cuaca tidak**
  (cuaca transien, selalu mulai cerah).
- **Harga jual satu sumber**: `BASE_SELL` di `src/economy.js` — field
  `sell` di `CROPS`/`ANIMAL_DEFS`/`PROCESSED`/`TREE_DEFS` dihapus.
- **Pemulihan akun (kode pemulihan):** saat register, server menerbitkan
  kode 12 karakter (`XXXX-XXXX-XXXX`, ~60 bit) dan menampilkannya SEKALI
  di modal — pemain wajib mencatatnya. Server hanya menyimpan hash
  SHA-256 kode (tabel `recovery_codes`). Pulih via "Lupa PIN?" di panel
  auth (username + kode + PIN baru): kode single-use, PIN diganti, SEMUA
  sesi lama dihapus, kode BARU diterbitkan (rotasi). Akun lama (pra-v3)
  bisa menerbitkan kode pertama lewat tombol "Kode Pemulihan" saat login.
  Rate limit 5 percobaan / 15 menit per username; pesan gagal generik.
- **Perbaikan bug sync perangkat segar:** perangkat tanpa save lokal +
  save server ada = server SELALU menang (sebelumnya save lokal kosong
  menimpa server); PUT tidak boleh menyalip GET sinkronisasi awal.
- **Smoke pasca-deploy backend** (selain §3): `GET /api/mp/leaderboard`
  (Bearer) → 200; trade palsu (qty di atas save) → 400; visit 2× di hari
  yang sama → kedua `{already:true, reward:0}`; register → kode pemulihan
  → logout → recover dengan kode → login PIN baru → kode lama ditolak.
  Detail + bukti: `~/workspace/lembah-hijau-game-lanes/cozy-2026-11-26/F2/LANE-F2-REPORT.md`.
  Status deploy Wave-3: **TER-DEPLOY 26 Nov 2026** — migrasi 002+003 via
  Management API (HTTP 201; 10 tabel di `public` terverifikasi), Edge
  Function redeploy via CLI (`--no-verify-jwt`, `verify_jwt = false`
  tetap), smoke live 11/11 (health, register+kode, leaderboard, trade
  palsu 400, visit 2×, recovery end-to-end).

## 4. Kalau deploy gagal

- `401 {"message":"Invalid API key"}` / 401 tanpa body JSON → header
  `apikey` tidak terkirim atau salah. Cek meta anon key / `getAnonKey()`.
- `401` dari gateway pada SEMUA endpoint termasuk health → **verify_jwt
  masih aktif**. Matikan di pengaturan fungsi + redeploy.
- `403 {"error":"Origin tidak diizinkan."}` → `ALLOWED_ORIGINS` belum
  diset / origin game belum masuk daftar. Periksa ejaan origin persis
  sama dengan yang dikirim browser (termasuk `https://`, tanpa trailing
  slash).
- `500 {"error":"Kesalahan server."}` → buka **Edge Functions → Logs**,
  cari baris `[error]`. Penyebab paling mungkin: tabel belum dibuat
  (langkah 2.1), atau `SUPABASE_SERVICE_ROLE_KEY` tidak tersedia.
- Game tetap jalan TANPA backend (mode offline + localStorage), tapi save
  hanya di perangkat itu — jangan anggap save sudah aman sampai langkah 3 lolos.

## 5. Rollback

Bila migrasi Supabase bermasalah, lihat
`supabase/DEPLOY-SUPABASE.md` §8: kembalikan `src/cloud.js` lama +
hapus 2 meta dari `index.html`, push. Backend Workers/D1 lama tetap
utuh di `worker/` sebagai arsip rollback (lihat `worker/DEPRECATED.md`
dan bagian HISTORIS di bawah).

## Catatan biaya

Free tier Supabase: Postgres 500 MB, Edge Functions 500 ribu
invokasi/bulan, egress 5 GB/bulan. Game ini jauh di bawah itu
(satu save < 64 KB; akun test puluhan). Project ini Free; tidak ada
kartu kredit terpasang. Bila kelak butuh naik tier, itu keputusan Izka.

---

# HISTORIS — Cloudflare Pages + Workers + D1 (legacy, TIDAK di-deploy)

> **JANGAN ikuti langkah di bawah ini untuk deploy.** Ini adalah
> rencana deploy lama (sebelum migrasi Supabase, Nov 2026) yang
> dipertahankan apa adanya sebagai referensi + arsip rollback.
> Backend Workers + D1 TIDAK PERNAH ter-deploy ke produksi (wrangler
> di VM tidak terautentikasi) dan TIDAK AKAN di-deploy — backend live
> adalah Supabase (lihat bagian atas file ini). Kode legacy ada di
> `worker/` — lihat `worker/DEPRECATED.md`.

Status saat itu: **BELUM TER-DEPLOY.** Wrangler 4.166.0 ada di VM tapi
**tidak terautentikasi** (`wrangler whoami` → "You are not authenticated"),
tidak ada `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` di environment.
Yang sudah **teruji lokal**: `wrangler dev --local` + D1 lokal (register →
login → save → load → lockout 5x → logout, semua lolos) dan game di
headless Chrome (29/29 landscape, 25/25 portrait).

## 0. Prasyarat (historis)

- Akun Cloudflare (free tier cukup: Workers + D1 + Pages semua ada free tier).
- Di VM ini, dari repo `~/workspace/lembah-hijau-game/`.

## 1. Login wrangler (historis — butuh browser)

```bash
npx wrangler login
# -> buka URL yang tampil, izinkan akses ke akun Cloudflare Izka.
# Verifikasi:
npx wrangler whoami
```

## 2. Buat database D1 + terapkan skema (historis)

```bash
cd ~/workspace/lembah-hijau-game/worker
npx wrangler d1 create lembah-hijau-db
# Salin "database_id" yang dikembalikan ke worker/wrangler.toml
# (ganti REPLACE_WITH_D1_DATABASE_ID).

npx wrangler d1 execute lembah-hijau-db --remote --file=./schema.sql
# Harus menampilkan 5 tabel dibuat: users, sessions, saves,
# login_attempts, rate_limits.

## 2b. (Pengujian lokal) Terapkan skema ke D1 lokal juga

`wrangler dev --local` memakai database lokal KOSONG — tanpa langkah ini
SEMUA endpoint yang menyentuh DB mengembalikan 500
(`D1_ERROR: no such table`, terverifikasi koordinator 21 Nov 2026).
Jalankan sekali sebelum `wrangler dev --local`:

```bash
npx wrangler d1 execute lembah-hijau-db --local --file=./schema.sql
```
```

## 3. Deploy Worker API (historis)

```bash
npx wrangler deploy
# Catat URL-nya, mis: https://lembah-hijau-api.<subdomain>.workers.dev
```

## 4. Deploy game statis ke Cloudflare Pages (historis)

```bash
cd ~/workspace/lembah-hijau-game
npx wrangler pages deploy . --project-name=lembah-hijau
# Catat URL-nya, mis: https://lembah-hijau.pages.dev
# (File _headers di root ikut ter-deploy sebagai security headers.)
```

## 5. Sambungkan game <-> API (historis — pilih SATU cara)

**Cara A (disarankan, tanpa ubah kode):** isi origin game ke Worker.

```bash
cd worker
# Edit wrangler.toml: ALLOWED_ORIGINS = "https://lembah-hijau.pages.dev"
npx wrangler deploy
# Lalu di index.html isi meta: <meta name="lh-api-base"
# content="https://lembah-hijau-api.<subdomain>.workers.dev">
# lalu deploy ulang Pages (langkah 4).
```

**Cara B (tanpa ubah HTML):** di dashboard Cloudflare, tambahkan Route
`lembah-hijau.pages.dev/api/*` -> Worker `lembah-hijau-api` (Workers Routes).
Game memakai same-origin `/api` bila meta kosong.

## 6. Verifikasi produksi (historis — wajib sebelum diumumkan)

```bash
curl https://lembah-hijau-api.<subdomain>.workers.dev/api/health
# -> {"ok":true,"service":"lembah-hijau",...}

# Daftar + login + simpan (ganti token hasil login):
curl -X POST https://<worker>/api/auth/register \
  -H 'Content-Type: application/json' -d '{"username":"izka123","pin":"123456"}'
```

Lalu di browser: buka URL Pages → Buat Akun → main sebentar → tekan
💾 Simpan → muat ulang halaman → login lagi → progress + kustomisasi
harus kembali utuh.

## 7. Kalau deploy gagal (historis)

- `wrangler login` kedaluwarsa → ulangi langkah 1.
- `database_id` belum diganti → deploy Worker gagal binding D1; isi dulu.
- CORS error di browser → cek `ALLOWED_ORIGINS` persis sama dengan origin
  Pages (termasuk `https://`, tanpa trailing slash), lalu `wrangler deploy`.
- Game tetap jalan TANPA backend (mode offline + localStorage), tapi save
  hanya di perangkat itu — jangan anggap save sudah aman sampai langkah 6 lolos.

## Catatan biaya (historis)

Free tier: Workers 100.000 request/hari, D1 5 GB storage + 5 juta baris
dibaca/hari, Pages unlimited bandwidth (fair use). Game ini jauh di bawah itu.

## GitHub Pages (mode offline, tanpa backend) — catatan historis

Game statis sudah live di https://codermisaki.github.io/lembah-hijau-game/ (branch master, `.nojekyll`).
Tanpa backend, game jalan penuh dalam mode offline: daftar/login diganti tombol "Main Offline" di layar awal, save ke localStorage. Setelah Worker ter-deploy (langkah di atas), isi meta `lh-api-base` di `index.html` dengan URL Worker agar save cloud aktif.
