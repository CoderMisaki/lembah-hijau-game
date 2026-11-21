# Lembah Hijau — Game Berkebun (Stage 1 Prototipe)

Game berkebun **original dari nol** (web statis, tanpa server, tanpa multiplayer/chat).
Bukan Harvest Moon / Story of Seasons: semua art prosedural dari kode (primitif
Three.js + material + lighting), semua nama dan teks original.

**POV visual:** lembah pastoral low-poly, desa dataran tinggi Indonesia di golden
hour — SATU lembah, SATU cahaya emas hangat sebagai pemersatu. Palet: hijau lembah,
tanah coklat hangat, kayu, emas matahari, biru sungai.

## Cara menjalankan (lokal)

```bash
cd ~/workspace/lembah-hijau-game
python3 -m http.server 8000
# buka http://localhost:8000/ di browser (butuh HTTP, bukan file://, karena ES modules)
```

Tidak ada build step. Satu-satunya dependensi runtime adalah Three.js 0.170.0 yang
sudah di-vendor di `vendor/three.module.min.js` (MIT) lewat importmap di `index.html`.
Tidak ada import dari CDN lain.

## Struktur file

| File | Isi |
|---|---|
| `index.html` | Shell + importmap + semua elemen HUD/modal |
| `styles.css` | Layout landscape-first, responsif, tap target ≥44px |
| `src/main.js` | Entry + game loop + ekonomi + tidur + interaksi + kualitas/FPS |
| `src/world.js` | Terrain, pegunungan, sungai mengalir, jembatan, rumah, kios, kandang, pohon (instanced) |
| `src/player.js` | Karakter low-poly Bima/Sari + kamera third-person + gerak |
| `src/farm.js` | Petak grid 6×4 + 3 tanaman + tahap tumbuh 0–3 |
| `src/animals.js` | Ayam (3) + Sapi (2), gerak idle, makan, produksi |
| `src/ui.js` | HUD, toko (Beli/Jual), picker tanaman, pengaturan, toast |
| `src/i18n.js` | Semua teks UI: Bahasa Indonesia + English |
| `src/audio.js` | Efek suara WebAudio (tanam, panen, koin, hewan, …) |
| `src/save.js` | Autosave localStorage (`lembahHijauSaveV1`) |
| `src/input.js` | Keyboard WASD/panah + joystick analog virtual + tombol aksi/lompat |
| `src/physics.js` | Fisika kustom: gravitasi, terrain h(x,z), tabrakan, peti dorong |
| `src/debug.js` | Hook uji `window.__LH` |

## Fitur Stage 1

1. **Pilih karakter** laki-laki (Bima) / perempuan (Sari) di layar awal; bisa diganti di Pengaturan.
2. **Gerak:** joystick analog virtual + WASD/panah + tombol aksi + lompat. Tabrakan rumah/pagar/pohon/batu; sungai hanya bisa diseberangi lewat jembatan kayu.
3. **Bertani:** cangkul → tanam benih → siram → tumbuh per hari → panen.
   - Wortel: 2 hari, benih 4 koin, jual 12. Tomat: 3 hari, benih 8, jual 20. Labu: 4 hari, benih 14, jual 32.
   - Tahap tumbuh 0–3 dengan model 3D berbeda tiap tahap; tanaman yang disiram tumbuh 1 hari saat tidur.
4. **Ternak:** kandang berpagar berisi 3 Ayam + 2 Sapi. Beri makan (1 pakan dari toko, atau potong 2 koin langsung bila pakan habis); yang diberi makan menghasilkan keesokan paginya: Ayam → Telur (jual 8), Sapi → Susu (jual 15). Ambil hasil lewat aksi di dekat hewan / koleksi via API.
5. **Ekonomi:** koin (mulai 50), toko benih + pakan (tab Beli), jual hasil panen + ternak (tab Jual).
6. **Waktu:** 1 hari = ~4 menit nyata (06:00–22:00, mentok di 22:00 sampai tidur). Tidur di rumah → hari berikut, tanaman tumbuh, ternak berproduksi. Malam gelap + lampu teras rumah menyala.
7. **Simpan otomatis:** localStorage tiap 10 detik + tiap aksi penting; progress dimuat saat buka; "Hapus save" di Pengaturan.
8. **Pengaturan:** bahasa ID/EN (semua teks UI dua bahasa, tersimpan), ganti karakter, suara on/off, kualitas grafis Rendah/Sedang/Tinggi.
9. **Suara:** WebAudio sederhana (tanam, panen, koin, hewan, cangkul, siram, lompat, tidur); try/catch, mulai setelah gestur pengguna.

## Orientasi & responsif

- Gameplay mode **landscape**. Dunia + HUD dirancang untuk layar lebar.
- Mobile: saat game dimulai, otomatis minta fullscreen + `screen.orientation.lock('landscape')` (Android Chrome). Semua error ditangkap — lock gagal tidak crash.
- iOS Safari tidak mendukung orientation lock → fallback: bila perangkat touch dalam portrait, tampilkan overlay **"Putar perangkat Anda ke landscape"** (dwibahasa) sampai orientasi jadi landscape. Game tidak dimainkan dalam portrait.
- Desktop: tidak ada paksaan orientasi; layout menyesuaikan ukuran jendela.
- Canvas resize mengikuti viewport; HUD/joystick/tombol/modal menyesuaikan ukuran layar.

## Fisika (kustom, tanpa engine eksternal)

- Gravitasi ~22 m/s², lompat v0 ~8 m/s, akselerasi 30, friksi, momentum (bukan teleport/grid-snapping), kecepatan maks ~6 m/s.
- Terrain `h(x,z)`: lembah landai + cincin pegunungan di tepi + cekungan sungai; karakter menempel terrain (dan papan jembatan saat menyeberang).
- Tabrakan lingkaran vs AABB (dorong-keluar), gerak per-sumbu agar bisa meluncur di sepanjang dinding; sungai di luar jembatan = collider.
- Peti kayu bisa didorong (kotak dinamis: kecepatan + friksi + tabrakan vs AABB statis + dorongan pemain).

## Performa

- Pixel ratio dibatasi per kualitas (Rendah 1, Sedang ≤1.5, Tinggi ≤2); bayangan hanya Sedang/Tinggi (1024/2048); instancing untuk pohon/batu; fog + frustum culling bawaan Three.js.
- Auto-degrade: bila FPS rata-rata <45 selama 5 detik, turunkan satu tingkat kualitas otomatis (maks 1× per 10 detik) + toast pemberitahuan.

## Hook uji — `window.__LH`

Untuk verifikasi otomatis (tanpa klik UI). Seluruh loop inti bisa dijalankan lewat API:

```js
const api = window.__LH.api;
api.teleport(x, z)              // pindah pemain
api.hoeAt(ix, iz)               // cangkul petak (ix 0-5, iz 0-3)
api.plantAt(ix, iz, 'carrot' | 'tomato' | 'pumpkin')
api.waterAt(ix, iz)             // siram
api.sleep()                     // tidur -> hari berikut, tanaman tumbuh, ternak produksi
api.harvestAt(ix, iz)           // panen -> masuk inventaris
api.sellAll()                   // jual semua hasil -> {earned, count, coins}
api.feedAnimal('ayam' | 'sapi') // beri makan 1 ekor ({ok, reason})
api.collectAnimal('ayam' | 'sapi') // ambil telur/susu siap -> jumlah
api.addCoins(n)                 // tambah koin (uji)
api.setLang('id' | 'en')
api.getFps()                    // FPS rata-rata terakhir
api.getState()                  // snapshot state (koin, hari, jam, inv, petak, hewan, pemain)
```

Contoh loop penuh (wortel):

```js
api.addCoins(100);
api.buySeed('carrot');          // beli 1 benih wortel (4 koin) lewat toko/API
api.teleport(14, 6);            // dekat petak (0,0)
api.hoeAt(0, 0);
api.plantAt(0, 0, 'carrot');
api.waterAt(0, 0);
api.sleep();                    // hari 2: tumbuh 1/2 — siram lagi
api.waterAt(0, 0);
api.sleep();                    // hari 3: wortel siap (2 hari)
api.harvestAt(0, 0);
api.sellAll();                  // +12 koin
```

Catatan: tanaman hanya tumbuh bila **disiram** pada hari itu — jadi tiap `sleep()`
harus didahului `waterAt()` bila tanaman belum siap. Hewan hanya berproduksi bila
diberi makan sehari sebelumnya (`feedAnimal` lalu `sleep()` lalu `collectAnimal`).

Properti baca: `window.__LH.state`, `.player`, `.farm`, `.animals`,
`.economy` (`{coins, inv}`), `.time` (`{day, minutes}`).

## Kekurangan yang diketahui (Stage 1)

- Kamera sudut tetap (belakang-atas); belum ada rotasi kamera manual.
- Hewan tidak bisa dibeli/dijual; jumlah ternak tetap (3 ayam + 2 sapi).
- Satu jenis pakan untuk semua hewan; tidak ada sistem lapar/animasi makan khusus.
- Jalan tanah hanya pewarnaan vertex terrain (bukan mesh jalan terpisah).
- Belum ada musik latar (hanya efek suara); belum ada cuaca.
- Verifikasi browser penuh (headless) belum dilakukan di VM ini bila tidak ada
  Chromium — lihat laporan build untuk hasil self-check yang sebenarnya.
- Di chrome-headless-shell VM (software rendering tanpa GPU), game hanya berjalan
  ~3 fps sehingga waktu game melambat (dt di-clamp 0,05 dtk) — ini artefak
  headless, bukan patokan perangkat nyata; `api.getFps()` mengukur waktu dinding
  nyata sehingga tetap jujur.
