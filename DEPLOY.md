# DEPLOY — Lembah Hijau (Cloudflare Pages + Workers + D1)

Status saat ini: **BELUM TER-DEPLOY.** Wrangler 4.166.0 ada di VM tapi
**tidak terautentikasi** (`wrangler whoami` → "You are not authenticated"),
tidak ada `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` di environment.
Yang sudah **teruji lokal**: `wrangler dev --local` + D1 lokal (register →
login → save → load → lockout 5x → logout, semua lolos) dan game di
headless Chrome (29/29 landscape, 25/25 portrait). Langkah di bawah ini
yang tersisa — dikerjakan Izka (atau agen dengan sesi Cloudflare login).

## 0. Prasyarat

- Akun Cloudflare (free tier cukup: Workers + D1 + Pages semua ada free tier).
- Di VM ini, dari repo `~/workspace/lembah-hijau-game/`.

## 1. Login wrangler (Izka yang lakukan — butuh browser)

```bash
npx wrangler login
# -> buka URL yang tampil, izinkan akses ke akun Cloudflare Izka.
# Verifikasi:
npx wrangler whoami
```

## 2. Buat database D1 + terapkan skema

```bash
cd ~/workspace/lembah-hijau-game/worker
npx wrangler d1 create lembah-hijau-db
# Salin "database_id" yang dikembalikan ke worker/wrangler.toml
# (ganti REPLACE_WITH_D1_DATABASE_ID).

npx wrangler d1 execute lembah-hijau-db --remote --file=./schema.sql
# Harus menampilkan 5 tabel dibuat: users, sessions, saves,
# login_attempts, rate_limits.
```

## 3. Deploy Worker API

```bash
npx wrangler deploy
# Catat URL-nya, mis: https://lembah-hijau-api.<subdomain>.workers.dev
```

## 4. Deploy game statis ke Cloudflare Pages

```bash
cd ~/workspace/lembah-hijau-game
npx wrangler pages deploy . --project-name=lembah-hijau
# Catat URL-nya, mis: https://lembah-hijau.pages.dev
# (File _headers di root ikut ter-deploy sebagai security headers.)
```

## 5. Sambungkan game <-> API (pilih SATU cara)

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

## 6. Verifikasi produksi (wajib sebelum diumumkan)

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

## 7. Kalau deploy gagal

- `wrangler login` kedaluwarsa → ulangi langkah 1.
- `database_id` belum diganti → deploy Worker gagal binding D1; isi dulu.
- CORS error di browser → cek `ALLOWED_ORIGINS` persis sama dengan origin
  Pages (termasuk `https://`, tanpa trailing slash), lalu `wrangler deploy`.
- Game tetap jalan TANPA backend (mode offline + localStorage), tapi save
  hanya di perangkat itu — jangan anggap save sudah aman sampai langkah 6 lolos.

## Catatan biaya

Free tier: Workers 100.000 request/hari, D1 5 GB storage + 5 juta baris
dibaca/hari, Pages unlimited bandwidth (fair use). Game ini jauh di bawah itu.
