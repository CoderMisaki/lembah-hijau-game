// i18n.js — semua teks UI dalam ID + EN. Pilihan bahasa tersimpan di save.
export const STRINGS = {
  tagline: { id: 'Lembah pastoral di dataran tinggi — berkebun, beternak, dan hidup tenang di golden hour.',
             en: 'A pastoral highland valley — farm, raise animals, and live slow in the golden hour.' },
  chooseChar: { id: 'Pilih Karakter', en: 'Choose Character' },
  male: { id: 'Laki-laki', en: 'Male' },
  female: { id: 'Perempuan', en: 'Female' },
  startGame: { id: '▶ Mulai Bermain', en: '▶ Start Playing' },
  controlsHint: { id: 'WASD / panah untuk bergerak • Spasi lompat • E aksi • Sentuh: joystick + tombol',
                  en: 'WASD / arrows to move • Space to jump • E to interact • Touch: joystick + buttons' },
  shop: { id: '🛒 Toko', en: '🛒 Shop' },
  settings: { id: '⚙️ Pengaturan', en: '⚙️ Settings' },
  buy: { id: 'Beli', en: 'Buy' },
  sell: { id: 'Jual', en: 'Sell' },
  close: { id: 'Tutup', en: 'Close' },
  cancel: { id: 'Batal', en: 'Cancel' },
  plantWhat: { id: 'Tanam apa?', en: 'Plant what?' },
  sleepTitle: { id: 'Tidur sampai besok?', en: 'Sleep until tomorrow?' },
  sleepDesc: { id: 'Tanaman yang disiram akan tumbuh, dan hewan yang diberi makan akan menghasilkan telur/susu di pagi hari.',
              en: 'Watered crops will grow, and fed animals will produce eggs/milk in the morning.' },
  sleepYes: { id: '😴 Tidur', en: '😴 Sleep' },
  language: { id: 'Bahasa', en: 'Language' },
  character: { id: 'Karakter', en: 'Character' },
  sound: { id: 'Suara', en: 'Sound' },
  quality: { id: 'Kualitas Grafis', en: 'Graphics Quality' },
  clearSave: { id: 'Hapus Save', en: 'Delete Save' },
  rotateTitle: { id: 'Putar perangkat Anda ke landscape', en: 'Rotate your device to landscape' },
  rotateDesc: { id: 'Lembah Hijau dimainkan dalam mode landscape. Putar HP Anda menyamping untuk melanjutkan.',
                en: 'Lembah Hijau is played in landscape mode. Turn your phone sideways to continue.' },
  day: { id: 'Hari', en: 'Day' },
  actionHoe: { id: '⛏️ Cangkul', en: '⛏️ Hoe' },
  actionPlant: { id: '🌱 Tanam', en: '🌱 Plant' },
  actionWater: { id: '💧 Siram', en: '💧 Water' },
  actionHarvest: { id: '🧺 Panen', en: '🧺 Harvest' },
  actionSleep: { id: '😴 Tidur', en: '😴 Sleep' },
  actionShop: { id: '🛒 Toko', en: '🛒 Shop' },
  actionFeed: { id: '🌾 Beri Makan', en: '🌾 Feed' },
  actionCollect: { id: '🥚 Ambil Hasil', en: '🥚 Collect' },
  actionPush: { id: '📦 Dorong', en: '📦 Push' },
  hintNearPlot: { id: 'Dekati petak lalu tekan Aksi', en: 'Walk to a plot, then press Action' },
  needSeeds: { id: 'Tidak ada benih — beli di Toko dulu.', en: 'No seeds — buy some at the Shop first.' },
  needCoins: { id: 'Koin tidak cukup.', en: 'Not enough coins.' },
  needFeed: { id: 'Butuh pakan (2 koin) — beli di Toko atau koin akan dipotong langsung.', en: 'Needs feed (2 coins) — buy at the Shop or coins are deducted directly.' },
  planted: { id: 'Benih ditanam. Jangan lupa disiram!', en: 'Seed planted. Don’t forget to water it!' },
  watered: { id: 'Tanaman disiram 💧', en: 'Crop watered 💧' },
  hoed: { id: 'Tanah dicangkul.', en: 'Soil hoed.' },
  harvested: { id: 'Panen! +1 hasil.', en: 'Harvested! +1 produce.' },
  sold: { id: 'Terjual! +{n} koin.', en: 'Sold! +{n} coins.' },
  bought: { id: 'Dibeli: {item}.', en: 'Bought: {item}.' },
  fed: { id: 'Hewan diberi makan. Besok pagi ada hasil. 🐔', en: 'Animal fed. There will be produce tomorrow morning. 🐔' },
  collected: { id: 'Diambil: {n} {item}.', en: 'Collected: {n} {item}.' },
  nothingToSell: { id: 'Tidak ada hasil untuk dijual.', en: 'Nothing to sell.' },
  nothingToCollect: { id: 'Belum ada hasil ternak.', en: 'No animal produce yet.' },
  morning: { id: 'Selamat pagi! Hari {d} — tanaman tumbuh, ternak menghasilkan. 🌅', en: 'Good morning! Day {d} — crops grew, animals produced. 🌅' },
  saved: { id: 'Progress tersimpan.', en: 'Progress saved.' },
  saveCleared: { id: 'Save dihapus. Memuat ulang…', en: 'Save deleted. Reloading…' },
  qualityLowered: { id: 'Performa rendah — kualitas grafis diturunkan otomatis.', en: 'Low performance — graphics quality lowered automatically.' },
  welcomeBack: { id: 'Selamat datang kembali! Hari {d}.', en: 'Welcome back! Day {d}.' },
  seeds: { id: 'Benih', en: 'Seeds' },
  feed: { id: 'Pakan', en: 'Feed' },
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
    if (STRINGS[key]) el.textContent = t(key, lang);
  });
  document.documentElement.lang = lang;
}
