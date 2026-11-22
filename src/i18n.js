// i18n.js — semua teks UI dalam ID + EN. Pilihan bahasa tersimpan di save.
export const STRINGS = {
  tagline: { id: 'Lembah pastoral di dataran tinggi — berkebun, beternak, dan hidup tenang di golden hour.',
             en: 'A pastoral highland valley — farm, raise animals, and live slow in the golden hour.' },
  chooseChar: { id: 'Pilih Karakter', en: 'Choose Character' },
  male: { id: 'Laki-laki', en: 'Male' },
  female: { id: 'Perempuan', en: 'Female' },
  startGame: { id: 'Mulai Bermain', en: 'Start Playing' },
  controlsHint: { id: 'WASD / panah untuk bergerak • Shift lari • Spasi lompat • E aksi • Sentuh: joystick + tombol Lari / Lompat / Aksi',
                  en: 'WASD / arrows to move • Shift to run • Space to jump • E to interact • Touch: joystick + Run / Jump / Action buttons' },
  shop: { id: 'Toko', en: 'Shop' },
  settings: { id: 'Pengaturan', en: 'Settings' },
  buy: { id: 'Beli', en: 'Buy' },
  sell: { id: 'Jual', en: 'Sell' },
  close: { id: 'Tutup', en: 'Close' },
  cancel: { id: 'Batal', en: 'Cancel' },
  plantWhat: { id: 'Tanam apa?', en: 'Plant what?' },
  sleepTitle: { id: 'Tidur sampai besok?', en: 'Sleep until tomorrow?' },
  sleepDesc: { id: 'Tanaman yang disiram akan tumbuh, dan hewan yang diberi makan akan menghasilkan telur/susu di pagi hari.',
              en: 'Watered crops will grow, and fed animals will produce eggs/milk in the morning.' },
  sleepYes: { id: 'Tidur', en: 'Sleep' },
  language: { id: 'Bahasa', en: 'Language' },
  character: { id: 'Karakter', en: 'Character' },
  sound: { id: 'Suara', en: 'Sound' },
  quality: { id: 'Kualitas Grafis', en: 'Graphics Quality' },
  clearSave: { id: 'Hapus Save', en: 'Delete Save' },
  rotateTitle: { id: 'Putar perangkat Anda ke landscape', en: 'Rotate your device to landscape' },
  rotateDesc: { id: 'Lembah Hijau dimainkan dalam mode landscape. Putar HP Anda menyamping untuk melanjutkan.',
                en: 'Lembah Hijau is played in landscape mode. Turn your phone sideways to continue.' },
  day: { id: 'Hari', en: 'Day' },
  actionHoe: { id: 'Cangkul', en: 'Hoe' },
  actionPlant: { id: 'Tanam', en: 'Plant' },
  actionWater: { id: 'Siram', en: 'Water' },
  actionHarvest: { id: 'Panen', en: 'Harvest' },
  actionSleep: { id: 'Tidur', en: 'Sleep' },
  actionShop: { id: 'Toko', en: 'Shop' },
  actionFeed: { id: 'Beri Makan', en: 'Feed' },
  actionCollect: { id: 'Ambil Hasil', en: 'Collect' },
  actionPush: { id: 'Dorong', en: 'Push' },
  hintNearPlot: { id: 'Dekati petak lalu tekan Aksi', en: 'Walk to a plot, then press Action' },
  needSeeds: { id: 'Tidak ada benih — beli di Toko dulu.', en: 'No seeds — buy some at the Shop first.' },
  needCoins: { id: 'Koin tidak cukup.', en: 'Not enough coins.' },
  needFeed: { id: 'Butuh pakan (2 koin) — beli di Toko atau koin akan dipotong langsung.', en: 'Needs feed (2 coins) — buy at the Shop or coins are deducted directly.' },
  planted: { id: 'Benih ditanam. Jangan lupa disiram!', en: 'Seed planted. Don’t forget to water it!' },
  watered: { id: 'Tanaman disiram.', en: 'Crop watered.' },
  hoed: { id: 'Tanah dicangkul.', en: 'Soil hoed.' },
  harvested: { id: 'Panen! +1 hasil.', en: 'Harvested! +1 produce.' },
  sold: { id: 'Terjual! +{n} koin.', en: 'Sold! +{n} coins.' },
  bought: { id: 'Dibeli: {item}.', en: 'Bought: {item}.' },
  fed: { id: 'Hewan diberi makan. Besok pagi ada hasil.', en: 'Animal fed. There will be produce tomorrow morning.' },
  collected: { id: 'Diambil: {n} {item}.', en: 'Collected: {n} {item}.' },
  nothingToSell: { id: 'Tidak ada hasil untuk dijual.', en: 'Nothing to sell.' },
  nothingToCollect: { id: 'Belum ada hasil ternak.', en: 'No animal produce yet.' },
  morning: { id: 'Selamat pagi! Hari {d} — tanaman tumbuh, ternak menghasilkan.', en: 'Good morning! Day {d} — crops grew, animals produced.' },
  saved: { id: 'Progress tersimpan.', en: 'Progress saved.' },
  saveCleared: { id: 'Save dihapus. Memuat ulang…', en: 'Save deleted. Reloading…' },
  qualityLowered: { id: 'Performa rendah — kualitas grafis diturunkan otomatis.', en: 'Low performance — graphics quality lowered automatically.' },
  welcomeBack: { id: 'Selamat datang kembali! Hari {d}.', en: 'Welcome back! Day {d}.' },
  seeds: { id: 'Benih', en: 'Seeds' },
  feed: { id: 'Pakan', en: 'Feed' },
  // ---- Akun (username + PIN 6 digit) ----
  loginTitle: { id: 'Masuk / Buat Akun', en: 'Log In / Create Account' },
  loginTab: { id: 'Masuk', en: 'Log In' },
  registerTab: { id: 'Buat Akun', en: 'Create Account' },
  username: { id: 'Username', en: 'Username' },
  usernameHint: { id: '3–16 karakter: huruf, angka, underscore', en: '3–16 chars: letters, numbers, underscore' },
  pin: { id: 'PIN 6 digit', en: '6-digit PIN' },
  pinConfirm: { id: 'Konfirmasi PIN', en: 'Confirm PIN' },
  loginBtn: { id: 'Masuk', en: 'Log In' },
  registerBtn: { id: 'Buat Akun', en: 'Create Account' },
  offlineBtn: { id: 'Main Offline (tanpa akun)', en: 'Play Offline (no account)' },
  offlineNote: { id: 'Offline: progress hanya tersimpan di perangkat ini sampai kamu login.',
                 en: 'Offline: progress is only stored on this device until you log in.' },
  loggedInAs: { id: 'Masuk sebagai {u}', en: 'Logged in as {u}' },
  logout: { id: 'Keluar', en: 'Log Out' },
  loginOk: { id: 'Selamat datang, {u}!', en: 'Welcome, {u}!' },
  registerOk: { id: 'Akun {u} dibuat. Selamat bermain!', en: 'Account {u} created. Have fun!' },
  loginFailed: { id: 'Username atau PIN salah.', en: 'Wrong username or PIN.' },
  lockedOut: { id: 'Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi nanti.',
               en: 'Account temporarily locked after too many failed attempts. Try again later.' },
  invalidUsername: { id: 'Username 3–16 karakter: huruf, angka, underscore.', en: 'Username must be 3–16 chars: letters, numbers, underscore.' },
  invalidPin: { id: 'PIN harus tepat 6 digit angka.', en: 'PIN must be exactly 6 digits.' },
  pinMismatch: { id: 'Konfirmasi PIN tidak sama.', en: 'PIN confirmation does not match.' },
  usernameTaken: { id: 'Username sudah dipakai. Pilih username lain.', en: 'Username is taken. Choose another one.' },
  account: { id: 'Akun', en: 'Account' },
  deleteServerSave: { id: 'Hapus Save Server', en: 'Delete Server Save' },
  serverSaveDeleted: { id: 'Save server dihapus.', en: 'Server save deleted.' },
  // ---- Kustomisasi karakter ----
  customize: { id: 'Kustomisasi', en: 'Customize' },
  customizeTitle: { id: 'Kustomisasi Karakter', en: 'Customize Character' },
  skin: { id: 'Warna kulit', en: 'Skin tone' },
  hairStyle: { id: 'Gaya rambut', en: 'Hairstyle' },
  hairColor: { id: 'Warna rambut', en: 'Hair color' },
  shirtModel: { id: 'Atasan', en: 'Top' },
  shirtColor: { id: 'Warna atasan', en: 'Top color' },
  pantsModel: { id: 'Celana', en: 'Bottoms' },
  pantsColor: { id: 'Warna celana', en: 'Bottoms color' },
  hatModel: { id: 'Topi', en: 'Hat' },
  hatColor: { id: 'Warna topi', en: 'Hat color' },
  glassesModel: { id: 'Kacamata', en: 'Glasses' },
  glassesColor: { id: 'Warna kacamata', en: 'Glasses color' },
  shoesModel: { id: 'Sepatu', en: 'Shoes' },
  shoesColor: { id: 'Warna sepatu', en: 'Shoes color' },
  model: { id: 'Model', en: 'Model' },
  prevModel: { id: 'Sebelumnya', en: 'Previous' },
  nextModel: { id: 'Berikutnya', en: 'Next' },
  jump: { id: 'Lompat', en: 'Jump' },
  run: { id: 'Lari', en: 'Run' },
  color: { id: 'Warna', en: 'Color' },
  resetCustom: { id: 'Reset', en: 'Reset' },
  customSaved: { id: 'Penampilan disimpan.', en: 'Look saved.' },
  // ---- Save / Load ----
  saveBtn: { id: 'Simpan', en: 'Save' },
  loadBtn: { id: 'Muat', en: 'Load' },
  // ---- Minimap realtime ----
  minimap: { id: 'Peta', en: 'Map' },
  minimapLabel: { id: 'Peta lembah — posisi pemain, rumah, toko, kebun, dan kandang',
                  en: 'Valley map — player position, house, shop, farm, and pen' },
  minimapCollapse: { id: 'Lipat peta', en: 'Collapse map' },
  minimapExpand: { id: 'Buka peta', en: 'Expand map' },
  saving: { id: 'Menyimpan…', en: 'Saving…' },
  savedCloud: { id: '✓ Berhasil tersimpan di server!', en: '✓ Progress saved to the server!' }, // taste-skill-ignore: ✓ is a text check mark in toast copy, not an emoji icon
  savedLocal: { id: '✓ Tersimpan di perangkat (offline — akan disinkron saat online).', // taste-skill-ignore: ✓ is a text check mark in toast copy, not an emoji icon
                en: '✓ Saved on this device (offline — will sync when online).' }, // taste-skill-ignore: ✓ is a text check mark in toast copy, not an emoji icon
  loadedCloud: { id: 'Progress dimuat dari server.', en: 'Progress loaded from the server.' },
  loadFailed: { id: 'Gagal memuat dari server.', en: 'Failed to load from the server.' },
  noServerSave: { id: 'Belum ada save di server.', en: 'No save on the server yet.' },
  needLogin: { id: 'Login dulu untuk simpan ke server.', en: 'Log in first to save to the server.' },
  syncPending: { id: 'Menunggu sinkron ke server…', en: 'Waiting to sync to the server…' },
  serverNewer: { id: 'Save server lebih baru — dipakai.', en: 'Server save is newer — using it.' },
  localUploaded: { id: 'Progress offline diunggah ke server.', en: 'Offline progress uploaded to the server.' },
};

export function t(key, lang = 'id', vars = {}) {
  const entry = STRINGS[key];
  let s = entry ? (entry[lang] || entry.id || key) : key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// Terapkan semua elemen [data-i18n] ke bahasa aktif.
export function applyI18n(lang) {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!STRINGS[key]) return;
    // Hanya node teks yang diganti — ikon SVG (.ui-icon) di dalam elemen
    // (mis. tombol HUD) dipertahankan agar tidak hilang saat ganti bahasa.
    [...el.childNodes].forEach((n) => { if (n.nodeType === Node.TEXT_NODE) n.remove(); });
    el.appendChild(document.createTextNode(t(key, lang)));
  });
  document.documentElement.lang = lang;
}
