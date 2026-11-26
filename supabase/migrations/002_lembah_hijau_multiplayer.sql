-- Lembah Hijau — migrasi 002: ekonomi multiplayer (COZY-E, Wave 2 Lane E).
--
-- Tabel ledger untuk trade / kunjungan / minigame bersama. SEMUA akses
-- lewat Edge Function lembah-hijau-api dengan service_role key (RLS aktif
-- tanpa policy, sama seperti migrasi 001) — client TIDAK PERNAH membaca
-- atau menulis tabel ini langsung. Server yang memvalidasi kedua save,
-- menerapkan swap, dan mencatat ke ledger.
--
-- Cara pakai (Wave-3, lihat LANE-E-REPORT.md): paste SELURUH file ini di
-- SQL Editor dashboard Supabase project lembah-hijau, lalu Run. Aman
-- dijalankan ulang (IF NOT EXISTS di mana-mana). JANGAN jalankan ke
-- project lain; JANGAN jalankan dua kali tanpa cek (idempotent, aman).
--
-- Isi:
--   trade_offers    penawaran tukar (pending -> accepted/declined/expired/failed)
--   trade_ledger    jejak trade yang SELESAI (append-only, audit + leaderboard)
--   visit_ledger    kunjungan kebun + hadiah (1x/pengunjung/kebun/hari, day_key UTC)
--   minigame_scores skor minigame bersama per room per ronde 10 menit

create table if not exists public.trade_offers (
  id            text primary key,       -- base64url acak 16 byte (dari server)
  from_username text not null,          -- pengusul (username lowercase)
  to_username   text not null,          -- lawan tukar (username lowercase)
  offer_item    text not null,          -- item yang diberikan pengusul
  offer_qty     integer not null,       -- 1..99
  want_item     text not null,          -- item yang diminta dari lawan
  want_qty      integer not null,       -- 1..99
  status        text not null default 'pending', -- pending/accepted/declined/expired/failed
  created_at    bigint not null,        -- epoch ms
  expires_at    bigint not null         -- epoch ms (created_at + 10 menit)
);
create index if not exists idx_trade_offers_to on public.trade_offers (to_username, status);
create index if not exists idx_trade_offers_from on public.trade_offers (from_username, status);

create table if not exists public.trade_ledger (
  id            bigint generated always as identity primary key,
  offer_id      text not null,          -- FK logis ke trade_offers.id
  from_username text not null,
  to_username   text not null,
  offer_item    text not null,
  offer_qty     integer not null,
  want_item     text not null,
  want_qty      integer not null,
  created_at    bigint not null         -- epoch ms
);
create index if not exists idx_trade_ledger_users on public.trade_ledger (from_username, to_username);

create table if not exists public.visit_ledger (
  id         bigint generated always as identity primary key,
  visitor    text not null,             -- yang berkunjung
  garden     text not null,             -- pemilik kebun yang dikunjungi
  day_key    text not null,             -- YYYY-MM-DD (UTC) — kunci sekali-sehari
  reward     integer not null,          -- koin yang diberikan server (10)
  created_at bigint not null,           -- epoch ms
  unique (visitor, garden, day_key)     -- SATU hadiah per pengunjung/kebun/hari
);
create index if not exists idx_visit_ledger_garden on public.visit_ledger (garden, day_key);

create table if not exists public.minigame_scores (
  id            bigint generated always as identity primary key,
  room          text not null,          -- kode room 6 karakter
  username      text not null,
  score         integer not null,       -- skor terbaik pemain di ronde ini
  window_bucket bigint not null,        -- floor(now / 10 menit) — satu ronde
  rewarded      boolean not null default false, -- hadiah pemenang sudah diklaim
  created_at    bigint not null,        -- epoch ms
  unique (room, username, window_bucket)
);
create index if not exists idx_minigame_scores_room on public.minigame_scores (room, window_bucket, score desc);

-- Row Level Security: aktif di semua tabel, tanpa policy apa pun.
-- Efek: peran anon dan authenticated TIDAK BISA SELECT/INSERT/UPDATE/DELETE
-- lewat PostgREST/API Supabase. Edge Function memakai service_role key
-- (Deno: SUPABASE_SERVICE_ROLE_KEY) yang melewati RLS.
alter table public.trade_offers   enable row level security;
alter table public.trade_ledger   enable row level security;
alter table public.visit_ledger   enable row level security;
alter table public.minigame_scores enable row level security;
