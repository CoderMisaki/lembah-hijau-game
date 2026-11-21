-- Lembah Hijau — skema D1 (Cloudflare Workers + D1, free tier).
-- Jalankan sekali saat setup (lihat DEPLOY.md):
--   npx wrangler d1 execute lembah-hijau-db --remote --file=./schema.sql
-- Untuk pengujian lokal (wrangler dev --local), jalankan JUGA varian lokal
-- (D1 lokal kosong tanpa ini -> semua endpoint DB 500 "no such table"):
--   npx wrangler d1 execute lembah-hijau-db --local --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  username   TEXT PRIMARY KEY,       -- lowercase, 3-16 karakter [a-z0-9_]
  pin_hash   TEXT NOT NULL,          -- PBKDF2-HMAC-SHA256, base64url (32 byte)
  salt       TEXT NOT NULL,          -- acak 16 byte per user, base64url
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,       -- SHA-256 dari token sesi (token mentah TIDAK disimpan)
  username   TEXT NOT NULL,
  expires_at INTEGER NOT NULL,       -- epoch ms, 30 hari sejak login
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions (username);

CREATE TABLE IF NOT EXISTS saves (
  username   TEXT PRIMARY KEY,       -- satu save per akun
  data       TEXT NOT NULL,          -- JSON save tervalidasi (maks 64 KB)
  updated_at INTEGER NOT NULL        -- epoch ms (last-write-wins, tie -> server)
);

CREATE TABLE IF NOT EXISTS login_attempts (
  username        TEXT PRIMARY KEY,
  failed          INTEGER NOT NULL,  -- kegagalan dalam jendela 15 menit
  first_failed_at INTEGER NOT NULL,
  last_failed_at  INTEGER NOT NULL,
  locked_until    INTEGER NOT NULL   -- epoch ms; 0 = tidak terkunci
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,     -- contoh: login:ip:1.2.3.4
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
