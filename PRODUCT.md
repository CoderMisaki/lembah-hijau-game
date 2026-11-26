# PRODUCT.md — Lembah Hijau (ANIME OVERHAUL, 25 Nov 2026)

Game berkebun 3D prosedural (Three.js, tanpa aset AI), repo
CoderMisaki/lembah-hijau-game, live di https://codermisaki.github.io/lembah-hijau-game/.
Pemain (Bima/Sari) berkebun 3 tanaman, beternak ayam+sapi, jual-beli di toko,
tidur ganti hari. Akun username + PIN 6 digit, save cloud Supabase.
Satu hari game ~4 menit nyata (06:00–22:00). Landscape-first, mobile + desktop.

Perintah Izka 25 Nov 2026 ~18:56 WIB: "rombak abis-abisan ... mulai dari
map, karakter, fitur, ui intinya secara keseluruhan bergaya anime dan
karakter anime untuk cowo/cewe". Overhaul ini MENGGANTIKAN arah visual lama
(buku cerita golden hour, serif, kertas/kayu) dan MENGGANTIKAN keputusan
22 Nov 2026 ("wajah karakter dibiarin dulu") — karakter anime beneran
sekarang WAJIB. Yang TETAP: semua fitur + perilaku + teks; hanya visual
yang berubah. Backend JANGAN disentuh.

## POV (arah visual anime — berlaku untuk semua lane)

Dunia: adegan pembuka anime slice-of-life — langit biru cerah jenuh dengan
awan kartun, sakura bermekaran, sungai berkilau, rumput hijau terang, semua
dengan cel/toon shading + outline tegas. Satu pilihan paling berani:
**semua yang disentuh pemain bereaksi seperti adegan anime** — squash-
and-stretch, spring overshoot, burst partikel, dan SFX onomatopoeia khas
lembah ("PANEN!", "TING!", "DUAR!"). Desain ini menolak menjadi: slop AI
generik (gradient ungu-biru, glassmorphism, card-in-card, pill badge
generik, emoji sebagai dekorasi), menolak menjadi dashboard-kit (KPI tiles,
sidebar, sparkline), dan menolak menjadi **copy Sakuga VFX** — mekanismenya
boleh dipakai, tampilannya WAJIB beda (lihat § Motion).

## Token (CSS custom properties — semua UI downstream pakai token)

- `--lh-sky: #3fa9f5` — biru langit anime (vibrant); `--lh-sky-deep: #1e6fd9`
- `--lh-sakura: #ff8fb3` — pink sakura, aksen utama; `--lh-sakura-deep: #ff5c8a`
- `--lh-sun: #ffc93c` — emas matahari anime; `--lh-sun-deep: #ff9f1c`
- `--lh-leaf: #2fbf4a` — hijau daun vibrant, aksi primer
- `--lh-valley: #4fc94f` — hijau rumput dunia 3D
- `--lh-ink: #1d2b53` — navy gelap — teks utama + outline anime
- `--lh-paper: #fff6e5` — panel kertas krem hangat; `--lh-paper-2: #ffffff`
- `--lh-cream: #fff1c4` — krem matahari, teks di atas gelap
- `--lh-wood: #8a6b3f` — kayu, dipakai hemat (bingkai/aksen saja, bukan bahasa utama)
- `--lh-night: #141b3d` — overlay malam navy
- Turunan (dari token di atas, bukan warna bebas): `--lh-leaf-soft: #dcf8e3`
  (state terpilih), `--lh-sky-soft: #d6ecff`, `--lh-sakura-soft: #ffe3ee`,
  `--lh-hairline: #e8cfa8`, `--lh-muted: #6b6f8e`, `--lh-note: #5a5e7a`,
  `--lh-danger: #e23a3a`, `--lh-error-bg: #7f1d1d`, `--lh-white: #ffffff`,
  `--lh-shadow: 4px 4px 0 rgba(29, 43, 83, .9)` — hard offset shadow anime
  (tanpa blur; ganti shadow lembut lama).
- Spacing: satu skala 4/8/12/16/24. Radius: panel 20px, tombol 14px, chip 999px.
  Border: 3px `--lh-ink` untuk panel/tombol (outline tegas anime), 1px
  hairline untuk pemisah. Tanpa gradient ungu-biru; tanpa glassmorphism.

## Tipografi (maks 2, offline-safe)

- Display (judul, angka besar, SFX): `"Arial Rounded MT Bold", "Hiragino Maru
  Gothic ProN", "Hiragino Sans", "Trebuchet MS", system-ui, sans-serif` —
  rounded bold, bobot 800, leading rapat. SFX pakai display ini, italic,
  ukuran besar.
- Teks/UI: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Angka (koin, harga): tabular (`font-variant-numeric: tabular-nums`).

## Dunia 3D (cel/toon — aturan untuk Lane A)

- Material: `MeshToonMaterial` + gradientMap 3–4 step untuk SEMUA mesh dunia
  (terrain, pohon, rumah, hewan, tanaman, wahana). Outline tegas: inverted
  hull (mesh BackSide warna `--lh-ink`, scale ~1.03) pada objek hero
  (karakter, rumah, pohon besar, wahana); objek kecil cukup toon shading.
- Langit: sky dome gradient biru cerah → krem horizon + matahari bergaris
  (disc + ray) + awan kartun (gumpalan sphere pipih putih, bergerak pelan).
- Vegetasi: sakura (kanopi pink berlapis), pohon hijau terang bentuk bulat,
  bunga warna-warni, rumput bergoyang (vertex sway, mati di kualitas rendah).
- Sungai: air toon berkilau (warna langit + highlight putih bergerak, opacity
  saja — tanpa refleksi mahal). Partikel halus: kelopak sakura beterbangan +
  kunang-kunang malam (mati di kualitas rendah).
- Lighting: matahari hangat directional + hemisphere biru/krem + fog biru
  muda. Tetap prosedural dari kode, tanpa aset eksternal. Auto-degrade
  kualitas tetap jalan. Target 60fps; FPS headless ~4–5 adalah lantai
  SwiftShader, bukan patokan.

## Karakter (aturan untuk Lane B)

- Bima (cowo) + Sari (cewe) = karakter ANIME beneran: wajah dengan mata
  besar ekspresif (sklera putih + iris berwarna + highlight putih +
  alis), pipi merona (blush pink), rambut anime (Bima spiky; Sari twin-tail
  / panjang), outfit khas warna toon. Rig jalan/lompat/idle dari lane
  sebelumnya TETAP (kaki berartikulasi, ayun lengan, bob + condong, napas).
- Kustomisasi 7 kategori (kemeja/celana/topi/kacamata/rambut/kulit/sepatu)
  HARUS tetap bekerja untuk kedua gender — model baru wajib memakai slot
  yang sama. Preview kustomisasi ikut bergaya anime.

## Motion UI (mekanisme Sakuga — aturan untuk Lane C/D)

Mekanisme dari referensi Sakuga VFX BOLEH dipakai (lihat
`~/workspace/research_notes/sakuga-vfx-gallery-research-2026-11-25.md`
§ Cara kerja yang disimpan); TAMPILAN wajib beda:
- Squash-and-stretch saat tekan (tombol gepeng sesaat, `:active scale(.93)`).
- Spring overshoot (toggle/tab/modal-in; easing pegas, bukan ease biasa).
- Burst partikel di canvas overlay untuk momen perayaan (panen, beli,
  menang game): partikel = kelopak sakura + daun + bintang (MILIK KITA —
  bukan asap/shard Sakuga); hilang <1 dtk.
- SFX onomatopoeia khas lembah (Bahasa Indonesia): "PANEN!", "TING!",
  "DUAR!", "YEAY!", "HAP!" — display font italic besar, pop + fade <1 dtk.
  JANGAN pakai "ドン!"/"カチッ"/"ポン" Sakuga.
- Status line kecil tetap ada (hint-bar / toast) — state selalu terlihat.
- Tes jiplak: berdampingan dengan Sakuga harus terasa "mirip energinya",
  bukan "ini copy". Palet, partikel, SFX, komposisi = milik Lembah Hijau.
- Motion: transform/opacity saja; durasi UI <300ms (transisi adegan tidur
  1.2 dtk tetap); `prefers-reduced-motion` mematikan animasi non-esensial
  (termasuk burst + SFX).

## Prinsip (tetap)

- Satu elemen dominan per layar. `:focus-visible` di semua elemen interaktif.
  Tap target ≥44px. Responsif 390/768/1440 tanpa tabrakan; landscape game +
  overlay portrait tetap.
- Perilaku & teks TIDAK berubah (kecuali visual). Backend (supabase/,
  src/cloud.js, src/save.js, auth/PIN, save/load) JANGAN disentuh.
  Backend lama Workers/D1 (`worker/`) sudah tidak dipakai — legacy,
  lihat `worker/DEPRECATED.md`; jangan disentuh juga kecuali rollback.
- JANGAN commit/push — koordinator utama yang melakukannya.

## Lane (overhaul anime, koordinator 2026-11-25)

- **Lane A — Map/dunia anime** (`src/world.js`, `src/farm.js`,
  `src/animals.js`, sentuhan minimal `src/main.js` hanya langit/lighting/
  kualitas): cel shading + outline, langit anime + awan kartun + matahari
  bergaris, sakura + bunga + rumput goyang, sungai berkilau, partikel
  kelopak/kunang-kunang. Baca § Dunia 3D di atas.
- **Lane B — Karakter anime** (`src/player.js`, `src/customization.js`):
  wajah anime (mata besar, blush, alis), rambut anime kedua gender, outfit
  toon; rig + 7 kategori kustomisasi tetap jalan. Baca § Karakter di atas.
- **Lane C — UI anime** (`index.html`, `styles.css`, `src/ui.js` visual saja,
  `src/i18n.js` visual saja): HUD, start screen, panel auth, modal
  (toko/tanam/tidur/pengaturan/kustomisasi), toast, touch controls — token
  baru, outline 3px ink, hard offset shadow, display rounded, motion
  Sakuga-mekanisme. Baca `reference/craft-floor.md` TEPAT SEBELUM edit UI.
- **Lane D — Fitur restyle visual** (`src/nm-zone.js`, `src/nm-rides.js`,
  `src/nm-games.js`, `src/nm-food.js`, `src/nm-bots.js`, `src/nm-invite.js`,
  `src/multiplayer.js` — visual saja, perilaku tetap): pasar malam, wahana,
  games, jajanan, bot, invite, room — cel/toon + UI anime; teks/perilaku
  TIDAK berubah. Baca `reference/craft-floor.md` TEPAT SEBELUM edit UI.
- **Lane E — Integrasi + verifikasi** (koordinator, sesudah A–D): gabung,
  selesaikan konflik, jalankan gates.

## Gates (koordinator, sesudah lane)

node --check semua JS yang diubah; verifikasi fungsional headless browser
(game load tanpa error, jalan + animasi karakter terlihat, simpan/load &
auth tetap jalan, 0 pageerror); screenshot 1440/768/390 + screenshot
gameplay (map baru, karakter anime cowo + cewe, UI baru); anti-slop
ban-list + taste inspect; impeccable detect --json; screenshot critique
maks 3 round. JANGAN push/commit — parent yang melakukannya.

## Cozy Life Simulation — Wave-3 Robustness (Lane F2, 26 Nov 2026)

- **Save v3** (`SAVE_VERSION = 3`): semua field Wave-1/2 masuk save +
  allowlist server; save v2 lama migrasi malas (progres utuh). Musim
  tersimpan, cuaca tidak (transien).
- **Pemulihan akun**: kode pemulihan 12 karakter sekali tampil saat
  register (hash SHA-256 saja di server), single-use + rotasi, semua sesi
  lama dihapus saat pulih. "Lupa PIN?" di panel auth.
- **Harga jual satu sumber**: `BASE_SELL` di `src/economy.js`.
- **Sync perangkat segar**: server selalu menang bila lokal kosong;
  PUT menunggu sync awal selesai.
- **Performa**: culling detail wajah NPC di atas 30 m; pemulihan kualitas
  otomatis (naik 1 tingkat sesudah 30 dtk FPS ≥ 55, hanya bila penurunan
  terakhir otomatis); dispose geometri preview kustomisasi.
- **UI**: inv-bar mengalir di bawah hud-top (tidak lagi menumpuk tombol);
  label aksi "Ngobrol"; titik warga sakura-pink di minimap; cap obrolan
  +1 fp/hari/NPC; top-bar 390-landscape = strip scroll (tombol Warga
  tercapai dengan scroll).
- Detail + bukti verifikasi:
  `~/workspace/lembah-hijau-game-lanes/cozy-2026-11-26/F2/LANE-F2-REPORT.md`.
