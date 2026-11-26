# worker/ — DEPRECATED (legacy, JANGAN deploy, JANGAN kembangkan)

Backend lama Lembah Hijau: **Cloudflare Workers + D1** (API auth + save,
`worker/src/index.js`, skema D1 `worker/schema.sql`, binding
`worker/wrangler.toml`).

**Status: DIGANTIKAN oleh Supabase.** Backend live adalah Edge Function
`lembah-hijau-api` di project Supabase `lembah-hijau`
(`ajsliyqjucgdtbimvdtd`) + Postgres — lihat `supabase/DEPLOY-SUPABASE.md`
dan `DEPLOY.md`. Client (`src/cloud.js`) + `index.html` sudah menunjuk
ke Supabase; tidak ada kode di `src/` yang memanggil Worker ini lagi.

**Keputusan (lane F1, 26 Nov 2026): KEEP sebagai arsip legacy — JANGAN hapus.**
Alasan: `supabase/DEPLOY-SUPABASE.md` §8 menunjuk direktori ini sebagai
jalur rollback bila migrasi Supabase bermasalah (kembalikan `src/cloud.js`
lama + hapus 2 meta `index.html`, lalu deploy ulang mengikuti bagian
HISTORIS di `DEPLOY.md`).

**Aturan untuk direktori ini:**

- JANGAN deploy (`wrangler deploy`, `wrangler d1 ...`) — backend ini
  tidak pernah ter-deploy ke produksi dan tidak akan di-deploy.
- JANGAN kembangkan / JANGAN tambah endpoint, tabel, atau validasi di sini.
  Semua perubahan backend masuk ke
  `supabase/functions/lembah-hijau-api/index.ts` (+ migrasi SQL bila perlu).
- JANGAN hapus — penghapusan memutus jalur rollback yang didokumentasikan.
- Boleh dibaca sebagai referensi: logika auth (PBKDF2, lockout, rate limit)
  dan validasi save di `worker/src/index.js` adalah sumber yang dipetakan
  1:1 ke Edge Function Supabase (`supabase/migrations/001_lembah_hijau.sql`
  mencatat pemetaan ini).

Isi direktori (beku sejak migrasi):

| File | Isi |
|---|---|
| `wrangler.toml` | Nama Worker, binding D1 (`database_id` masih placeholder `REPLACE_WITH_D1_DATABASE_ID`), `ALLOWED_ORIGINS` kosong |
| `schema.sql` | Skema D1: 5 tabel (`users`, `sessions`, `saves`, `login_attempts`, `rate_limits`) |
| `src/index.js` | API Workers lama — rute + validasi yang sama dengan Edge Function |
