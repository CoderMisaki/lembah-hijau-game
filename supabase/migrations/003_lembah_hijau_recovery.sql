-- Lembah Hijau — migrasi 003: tabel kode pemulihan akun (COZY-F2, 26 Nov 2026).
--
-- Satu kode aktif per akun (username PK). Server HANYA menyimpan hash
-- SHA-256 kode (lihat supabase/functions/lembah-hijau-api/index.ts seksi
-- COZY-F2); kode plaintext TIDAK PERNAH disimpan. Kode single-use: dipakai
-- sekali lalu dihapus + diganti kode baru (rotasi).
--
-- Cara pakai: paste SELURUH file ini di SQL Editor dashboard Supabase
-- project lembah-hijau (ajsliyqjucgdtbimvdtd), lalu Run — SETELAH migrasi
-- 002 (multiplayer). Aman dijalankan ulang (IF NOT EXISTS).
-- RLS aktif TANPA policy (seperti tabel lain): hanya Edge Function dengan
-- service_role yang bisa akses. Jangan tambah policy "allow all".

create table if not exists public.recovery_codes (
  username   text primary key,       -- lowercase, 3-16 karakter [a-z0-9_]
  code_hash  text not null,          -- SHA-256 hex dari kode (12 karakter, tanpa strip)
  created_at bigint not null         -- epoch ms (kapan kode ini diterbitkan)
);

alter table public.recovery_codes enable row level security;
