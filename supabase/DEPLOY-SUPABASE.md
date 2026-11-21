# DEPLOY-SUPABASE — Lembah Hijau (Supabase Edge Function + Postgres)

Migrasi backend dari Cloudflare Workers + D1 ke Supabase. Status file:
**SIAP, BELUM TER-DEPLOY.** Semua file ada di `supabase/` repo ini
(belum di-commit — parent yang putuskan commit/push sesudah verifikasi).
Backend lama (Workers + D1) TIDAK dihapus dan TIDAK diubah; rollback =
kembalikan `src/cloud.js` lama + hapus meta di bawah (langkah 5).

Prasyarat: login dashboard Supabase sebagai CoderMisaki (sudah terverifikasi
berhasil 21 Nov 2026 via GitHub), project **lembah-hijau**
(`ajsliyqjucgdtbimvdtd`, ap-southeast-1, Free). Anon key ada di
`~/.config/supabase-lembah-hijau/keys` (file 600 di VM, JANGAN di-print
ke chat atau di-commit).

## 1. Buat tabel (SQL Editor)

1. Buka project lembah-hijau di dashboard → **SQL Editor** → **New query**.
2. Paste SELURUH isi `supabase/migrations/001_lembah_hijau.sql`, lalu **Run**.
3. Verifikasi: buka **Table Editor** — harus ada 5 tabel di schema `public`:
   `users`, `sessions`, `saves`, `login_attempts`, `rate_limits`.
   (Bila salah satu tidak ada, cek pesan error SQL Editor; file ini aman
   dijalankan ulang — semua `IF NOT EXISTS`.)
4. Catatan keamanan: RLS aktif di semua tabel TANPA policy — itu disengaja.
   Anon key TIDAK BISA membaca/menulis tabel lewat PostgREST; hanya Edge
   Function (service_role) yang bisa. Jangan tambah policy "allow all".

## 2. Buat Edge Function (paling rawan salah — baca sampai habis)

1. Dashboard → **Edge Functions** → **Create a new function**.
2. Nama fungsi: **`lembah-hijau-api`** (persis; URL API mengikuti nama ini).
3. **MATIKAN "Verify JWT" / "Enforce JWT verification"** (toggle OFF).
   INI LANGKAH PALING PENTING: API ini memakai token sesi sendiri
   (Bearer), bukan JWT Supabase Auth. Bila JWT verification AKTIF,
   gateway menolak SEMUA request dengan 401 sebelum sampai ke kode —
   termasuk register/login. Bila deploy via CLI, yang setara adalah
   `supabase functions deploy lembah-hijau-api --no-verify-jwt`
   (dan `verify_jwt = false` di `supabase/config.toml`).
4. Paste SELURUH isi `supabase/functions/lembah-hijau-api/index.ts`
   ke editor fungsi, lalu **Deploy**.
5. Catat URL fungsi:
   `https://ajsliyqjucgdtbimvdtd.supabase.co/functions/v1/lembah-hijau-api`
6. Cek cepat (tanpa anon key, health tetap butuh apikey — lihat langkah 4):
   log fungsi di dashboard harus bersih dari error deploy.

## 3. Set secret ALLOWED_ORIGINS (CORS produksi)

Tanpa ini, game live di GitHub Pages akan ditolak CORS 403 (origin
`https://codermisaki.github.io` TIDAK termasuk `*.pages.dev`).

1. Dashboard → **Edge Functions** → **Secrets** (atau
   **Settings → Edge Functions → Secrets**) → **Add secret**.
2. Name: `ALLOWED_ORIGINS`
   Value: `https://codermisaki.github.io,https://lembah-hijau.pages.dev`
   (tanpa spasi sesudah koma; tanpa trailing slash).
3. Simpan, lalu **redeploy fungsi** bila dashboard meminta (secret baru
   hanya dibaca saat fungsi start ulang — redeploy memastikan).
4. `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` TIDAK perlu diset
   manual — keduanya disediakan otomatis oleh runtime Edge Function.

## 4. Verifikasi API (wajib sebelum sambung game)

Dari VM (anon key dibaca dari keys file, tidak di-print):

```bash
cd ~/workspace/lembah-hijau-game/supabase
KEY=$(grep '^ANON_KEY=' ~/.config/supabase-lembah-hijau/keys | cut -d= -f2-)
URL=https://ajsliyqjucgdtbimvdtd.supabase.co/functions/v1/lembah-hijau-api

curl -s $URL/api/health -H "apikey: $KEY"
# -> {"ok":true,"service":"lembah-hijau","time":...}

# Harness 29 skenario (sama seperti verifikasi Workers dulu):
node worker-test.mjs
# -> harus PASS=29 FAIL=0. Username test ber-suffix timestamp, aman
#    dijalankan ulang (tidak bentrok dengan akun asli).
```

Bila health gagal, lihat "Kalau gagal" di bawah SEBELUM lanjut.

## 5. Sambungkan game ke backend baru

1. Ganti client: `cp supabase/cloud.js src/cloud.js` (timpa yang lama —
   yang lama tersimpan di git, bisa dikembalikan).
2. Di `index.html`, isi 2 meta ini (di `<head>`, ganti nilai anon key
   dari keys file):
   ```html
   <meta name="lh-api-base" content="https://ajsliyqjucgdtbimvdtd.supabase.co/functions/v1/lembah-hijau-api">
   <meta name="lh-supabase-anon-key" content="<ANON_KEY dari keys file>">
   ```
   Anon key adalah publishable key (aman tampil di HTML publik — yang
   dilindungi adalah service_role key, yang TIDAK PERNAH keluar dari
   server). Jangan isi service_role key ke HTML.
3. Commit + push ke main (repo CoderMisaki/lembah-hijau-game) seperti
   biasa — GitHub Pages deploy otomatis. Tunggu ±1 menit.
4. Alternatif tanpa ubah HTML: set `window.LH_API_BASE` dan
   `window.LH_SUPABASE_ANON_KEY` sebelum `cloud.js` dimuat.

## 6. Verifikasi E2E di browser (seperti verifikasi Stage 1 dulu)

1. Buka https://codermisaki.github.io/lembah-hijau-game/ → Buat Akun
   (username + PIN 6 digit) → main sebentar → tekan Simpan.
2. Muat ulang halaman → login lagi → progress + kustomisasi harus
   kembali utuh (save cloud, bukan localStorage).
3. Uji negatif: PIN salah 5x → akun terkunci 429; PIN benar saat
   terkunci tetap 429; logout → token mati (GET save 401).
4. Cek console browser: 0 pageerror, 0 failed request.
5. Cek Table Editor Supabase: baris `users`/`saves` bertambah sesuai
   akun test (jangan intip PIN — di DB hanya ada `pin_hash` + `salt`).

## 7. Kalau gagal

- `401 {"message":"Invalid API key"}` / 401 tanpa body JSON → header
  `apikey` tidak terkirim atau salah. Cek meta anon key / `getAnonKey()`.
- `401` dari gateway pada SEMUA endpoint termasuk health → **verify_jwt
  masih aktif**. Matikan di pengaturan fungsi (langkah 2.3) + redeploy.
- `403 {"error":"Origin tidak diizinkan."}` → `ALLOWED_ORIGINS` belum
  diset / origin game belum masuk daftar (langkah 3). Periksa ejaan
  origin persis sama dengan yang dikirim browser (termasuk `https://`,
  tanpa trailing slash).
- `500 {"error":"Kesalahan server."}` → buka **Edge Functions → Logs**,
  cari baris `[error]`. Penyebab paling mungkin: tabel belum dibuat
  (langkah 1), atau `SUPABASE_SERVICE_ROLE_KEY` tidak tersedia (hanya
  terjadi bila deploy di luar runtime Supabase).
- Harness `FAIL` di skenario lockout/rate-limit → kemungkinan ada
  sisa baris `login_attempts`/`rate_limits` dari run sebelumnya untuk
  username yang sama — harness memakai suffix timestamp sehingga ini
  tidak terjadi bila run normal; bila terjadi, tunggu 15 menit (jendela
  lockout) atau hapus baris terkait via SQL Editor.
- Game tetap jalan TANPA backend (mode offline + localStorage) bila API
  mati — tapi save hanya di perangkat itu. Jangan umumkan save cloud
  aktif sebelum langkah 4 + 6 lolos.

## 8. Rollback (bila migrasi bermasalah)

1. `git checkout -- src/cloud.js` (kembalikan client Workers) + hapus
   2 meta dari `index.html`, push.
2. Backend Supabase dibiarkan saja (tidak mengganggu apa pun; tabel
   berisi data test). Jangan hapus project lembah-hijau.
3. Backend Workers + D1 lama tetap utuh di `worker/` — deploy ulang
   mengikuti `DEPLOY.md` bila mau kembali ke Cloudflare.

## Catatan biaya & batas

- Free tier Supabase: Postgres 500 MB, Edge Functions 500 ribu
  invokasi/bulan, egress 5 GB/bulan. Game ini jauh di bawah itu
  (satu save < 64 KB; akun test puluhan).
- Project ini Free; tidak ada kartu kredit terpasang. Bila kelak butuh
  naik tier, itu keputusan Izka.
- Dibanding Workers + D1: tidak ada lagi ketergantungan login wrangler/
  Cloudflare untuk backend game. Yang masih di Cloudflare: TIDAK ADA —
  game statis di GitHub Pages, backend di Supabase.
