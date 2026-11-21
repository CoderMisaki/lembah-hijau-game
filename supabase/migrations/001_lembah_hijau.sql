-- Lembah Hijau — migrasi Postgres (Supabase project "lembah-hijau").
--
-- Dipetakan 1:1 dari worker/schema.sql (D1) ke Postgres. Perbedaan dari D1:
--   * INTEGER (epoch ms) -> bigint (epoch ms melebihi int32).
--   * data save tetap TEXT berisi JSON string (bukan jsonb) supaya perilaku
--     baca/tulis identik dengan versi D1 (JSON.stringify di Edge Function).
--   * Parameter binding D1 (?) diganti query builder supabase-js di Edge
--     Function; tidak ada SQL mentah dengan interpolasi string.
--   * RLS DIAKTIFKAN di semua tabel TANPA policy: anon/authenticated TIDAK
--     BISA membaca/menulis tabel ini lewat PostgREST. Satu-satunya akses
--     adalah Edge Function dengan service_role key (bypass RLS).
--
-- Cara pakai (lihat DEPLOY-SUPABASE.md): paste SELURUH file ini di SQL Editor
-- dashboard Supabase project lembah-hijau, lalu Run. Aman dijalankan ulang
-- (IF NOT EXISTS di mana-mana).

create extension if not exists "pgcrypto";
-- pgcrypto disediakan untuk kebutuhan mendatang (mis. default server-side
-- gen_random_bytes); kode Edge Function saat ini memakai WebCrypto untuk
-- semua nilai acak, jadi ekstensi ini bukan dependensi wajib.

create table if not exists public.users (
  username   text primary key,       -- lowercase, 3-16 karakter [a-z0-9_]
  pin_hash   text not null,          -- PBKDF2-HMAC-SHA256, base64url (32 byte)
  salt       text not null,          -- acak 16 byte per user, base64url
  created_at bigint not null         -- epoch ms
);

create table if not exists public.sessions (
  token_hash text primary key,       -- SHA-256 dari token sesi (token mentah TIDAK disimpan)
  username   text not null,
  expires_at bigint not null,        -- epoch ms, 30 hari sejak login
  created_at bigint not null         -- epoch ms
);
create index if not exists idx_sessions_username on public.sessions (username);

create table if not exists public.saves (
  username   text primary key,       -- satu save per akun
  data       text not null,          -- JSON save tervalidasi (maks 64 KB)
  updated_at bigint not null         -- epoch ms (last-write-wins, tie -> server)
);

create table if not exists public.login_attempts (
  username        text primary key,
  failed          integer not null,  -- kegagalan dalam jendela 15 menit
  first_failed_at bigint not null,   -- epoch ms
  last_failed_at  bigint not null,   -- epoch ms
  locked_until    bigint not null    -- epoch ms; 0 = tidak terkunci
);

create table if not exists public.rate_limits (
  key          text primary key,     -- contoh: login:ip:1.2.3.4
  count        integer not null,
  window_start bigint not null       -- epoch ms
);

-- Row Level Security: aktif di semua tabel, tanpa policy apa pun.
-- Efek: peran anon dan authenticated TIDAK BISA SELECT/INSERT/UPDATE/DELETE
-- lewat PostgREST/API Supabase. Edge Function memakai service_role key
-- (Deno: SUPABASE_SERVICE_ROLE_KEY) yang melewati RLS.
alter table public.users          enable row level security;
alter table public.sessions      enable row level security;
alter table public.saves         enable row level security;
alter table public.login_attempts enable row level security;
alter table public.rate_limits   enable row level security;
