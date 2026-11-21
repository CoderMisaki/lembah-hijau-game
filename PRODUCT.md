# PRODUCT.md — Lembah Hijau

Game berkebun 3D low-poly prosedural (Three.js, tanpa aset AI), repo
CoderMisaki/lembah-hijau-game, live di https://codermisaki.github.io/lembah-hijau-game/.
Pemain (Bima/Sari) berkebun 3 tanaman, beternak ayam+sapi, jual-beli di toko,
tidur ganti hari. Akun username + PIN 6 digit, save cloud Supabase.
Satu hari game ~4 menit nyata (06:00–22:00). Landscape-first, mobile + desktop.

## POV (arah visual — berlaku untuk semua lane)

Dunia: lembah pastoral di golden hour, buku cerita anak yang digambar dari kode.
Satu pilihan paling berani: **dunia game ITU sistem desainnya** — seluruh UI
dibangun dari material lembah itu sendiri (kertas krem, kayu, daun, emas
matahari). Desain ini menolak menjadi: slop AI generik (gradient ungu-biru,
glassmorphism, card-in-card, pill badge generik, emoji sebagai dekorasi),
dan menolak menjadi dashboard-kit (KPI tiles, sidebar, sparkline).

## Token (CSS custom properties — semua UI downstream pakai token)

- `--lh-paper: #fff8dc` — panel kertas (krem hangat, bukan putih murni)
- `--lh-paper-2: #fffdf2` — permukaan panel lebih terang
- `--lh-ink: #2b2118` — teks utama; `--lh-bark: #4a3419` — teks sekunder/kayu gelap
- `--lh-leaf: #2e7d32` — hijau daun, aksi primer (satu-satunya hijau aksi)
- `--lh-valley: #5da244` — hijau rumput dunia 3D
- `--lh-sun: #ffb340` — emas matahari, aksen SEKALI-SE-KALI (harga, sorotan)
- `--lh-wood: #8a6b3f` — kayu, border & bingkai
- `--lh-night: #16240f` — overlay gelap
- Spacing: satu skala 4/8/12/16/24. Radius: panel 18px, tombol 12px, chip 999px.
  Border: 2px kayu untuk panel, 1px hairline untuk pemisah. Tanpa bayangan
  diam yang berat; tanpa gradient ungu-biru (gradient krem hangat yang sudah
  ada dipertahankan, diratakan bila perlu).

## Tipografi (maks 2, offline-safe)

- Display (judul, angka besar): `Georgia, 'Iowan Old Style', 'Times New Roman', serif`
  — nuansa buku cerita, bobot 700, leading rapat.
- Teks/UI: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Angka (koin, harga): tabular (`font-variant-numeric: tabular-nums`).

## Prinsip

- Flat surfaces + hairline, bukan kartu melayang. Satu elemen dominan per layar.
- Motion: transform/opacity saja; durasi UI <300ms; `:active scale(.97)`;
  `prefers-reduced-motion` mematikan animasi non-esensial.
- `:focus-visible` di semua elemen interaktif. Tap target ≥44px.
- Responsif 390/768/1440 tanpa tabrakan; landscape game + overlay portrait tetap.
- Perilaku & teks TIDAK berubah (kecuali visual). Backend (worker/, supabase/,
  src/cloud.js, auth/PIN, save/load) JANGAN disentuh. Kustomisasi 7 kategori
  harus tetap bekerja. Auto-degrade kualitas tetap jalan. Target 60fps;
  FPS headless ~4–5 adalah lantai SwiftShader, bukan patokan.

## Lane (koordinator 2026-11-22)

- **Lane A — 3D environment** (`src/world.js`, `src/farm.js`, `src/animals.js`,
  sentuhan minimal `src/main.js` hanya untuk langit/lighting/kualitas):
  terrain warna vertex lebih kaya, pegunungan berlapis + kabut, sungai
  beranimasi, awan bergerak, vegetasi beragam (pohon beberapa bentuk, semak,
  bunga, rumput bergoyang), bebatuan, sky dome/gradient, matahari hangat +
  hemisphere + fog, partikel halus (serbuk sari/kupu-kupu, mati di kualitas
  rendah). Tetap prosedural dari kode, tanpa aset eksternal.
- **Lane B — Karakter** (`src/player.js` saja): rig kaki berartikulasi —
  pivot di pinggul, ayun berlawanan fase, lutut menekuk (kaki 2 segmen),
  sepatu menempel di segmen bawah, lengan ayun, badan bob + condong, idle
  napas, pose lompat. Semua model kustomisasi (kemeja/celana/topi/kacamata/
  rambut/kulit/sepatu, kedua gender) tetap bekerja.
- **Lane C — Frontend** (`index.html`, `styles.css`, `src/ui.js` visual saja,
  `src/i18n.js` visual saja): overhaul menyeluruh dalam bahasa token di atas —
  HUD, start screen, panel auth, modal toko/tanam/tidur/pengaturan/kustomisasi,
  toast, touch controls. Baca `reference/craft-floor.md` TEPAT SEBELUM edit UI.

## Gates (koordinator, sesudah lane)

Anti-slop ban-list + taste-skill lint/inspect (1440/768/390, 0 FAIL);
web-design-guidelines audit file:line; screenshot critique maks 3 round;
impeccable detect --json; node --check + verifikasi fungsional (load tanpa
error, jalan + animasi kaki terlihat, simpan/load & auth tetap jalan,
0 pageerror). JANGAN push/commit — parent yang melakukannya.
