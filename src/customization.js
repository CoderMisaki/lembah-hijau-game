// customization.js — definisi kustomisasi karakter Lembah Hijau (low-poly #1).
// Satu sumber kebenaran untuk opsi client; server (worker/src/index.js)
// memvalidasi dengan allowlist yang sama. Nilai disimpan sebagai string/hex,
// TIDAK PERNAH sebagai kode — tidak ada eval / konstruktor dinamis dari data pemain.
//
// Kategori: skin, hairStyle + hairColor, shirtModel + shirtColor,
// pantsModel + pantsColor, hatModel + hatColor, glassesModel + glassesColor,
// shoesModel + shoesColor. Setiap item: MODEL (varian bentuk) + WARNA (palet).

export const SKIN_TONES = [
  { id: 'fair',   hex: '#f2c9a0', label: 'Terang' },
  { id: 'medium', hex: '#e8b88a', label: 'Sawo' },
  { id: 'tan',    hex: '#c98d5f', label: 'Sawo matang' },
  { id: 'brown',  hex: '#9c6b43', label: 'Coklat' },
  { id: 'deep',   hex: '#6e4426', label: 'Gelap' },
];

export const HAIR_STYLES = [
  { id: 'short',    label: 'Pendek' },
  { id: 'spiky',    label: 'Spike' },
  { id: 'long',     label: 'Panjang' },
  { id: 'bun',      label: 'Sanggul' },
  { id: 'ponytail', label: 'Kuncir' },
];

export const HAIR_COLORS = [
  { id: 'black',  hex: '#1e130c' },
  { id: 'brown',  hex: '#4a2f1d' },
  { id: 'auburn', hex: '#7a3b1e' },
  { id: 'blond',  hex: '#d8b36a' },
  { id: 'grey',   hex: '#8d8578' },
];

export const SHIRT_MODELS = [
  { id: 'tee',     label: 'Kaos' },
  { id: 'long',    label: 'Lengan panjang' },
  { id: 'overall', label: 'Overall petani' },
  { id: 'vest',    label: 'Rompi' },
];

export const PANTS_MODELS = [
  { id: 'pants',  label: 'Celana panjang' },
  { id: 'shorts', label: 'Celana pendek' },
  { id: 'skirt',  label: 'Rok' },
];

export const HAT_MODELS = [
  { id: 'none',    label: 'Tanpa topi' },
  { id: 'straw',   label: 'Topi jerami' },
  { id: 'cap',     label: 'Topi cap' },
  { id: 'beanie',  label: 'Kupluk' },
  { id: 'bandana', label: 'Bandana' },
];

export const GLASSES_MODELS = [
  { id: 'none',   label: 'Tanpa kacamata' },
  { id: 'round',  label: 'Bulat' },
  { id: 'square', label: 'Kotak' },
  { id: 'shades', label: 'Hitam' },
];

export const SHOES_MODELS = [
  { id: 'boots',    label: 'Sepatu bot' },
  { id: 'sneakers', label: 'Sneakers' },
  { id: 'sandals',  label: 'Sandal' },
];

export const PALETTE = [
  { id: 'green',  hex: '#3f7d3a' },
  { id: 'pink',   hex: '#d94f70' },
  { id: 'blue',   hex: '#4a5d8a' },
  { id: 'purple', hex: '#7d5ba6' },
  { id: 'red',    hex: '#b03a2e' },
  { id: 'orange', hex: '#e8912a' },
  { id: 'yellow', hex: '#e8c832' },
  { id: 'teal',   hex: '#2e7d7a' },
  { id: 'brown',  hex: '#6e4a26' },
  { id: 'white',  hex: '#f5f0e6' },
  { id: 'black',  hex: '#2b2b2b' },
  { id: 'straw',  hex: '#d8b36a' },
];

export const FRAME_COLORS = [
  { id: 'black', hex: '#1a1a1a' },
  { id: 'brown', hex: '#6e4a26' },
  { id: 'red',   hex: '#b03a2e' },
  { id: 'teal',  hex: '#2e7d7a' },
];

export function defaultCustom(gender = 'male') {
  const female = gender === 'female';
  return {
    skin: 'medium',
    // Anime overhaul 25 Nov 2026: Bima default spiky, Sari default long
    // (= twin-tail untuk cewe, lihat addHair di player.js).
    hairStyle: female ? 'long' : 'spiky',
    hairColor: female ? 'black' : 'black',
    shirtModel: 'tee',
    shirtColor: female ? 'pink' : 'green',
    pantsModel: female ? 'skirt' : 'pants',
    pantsColor: female ? 'purple' : 'blue',
    hatModel: 'straw',
    hatColor: 'straw',
    glassesModel: 'none',
    glassesColor: 'black',
    shoesModel: 'boots',
    shoesColor: 'brown',
  };
}

const ALLOW = {
  skin: SKIN_TONES.map((o) => o.id),
  hairStyle: HAIR_STYLES.map((o) => o.id),
  hairColor: HAIR_COLORS.map((o) => o.id),
  shirtModel: SHIRT_MODELS.map((o) => o.id),
  shirtColor: PALETTE.map((o) => o.id),
  pantsModel: PANTS_MODELS.map((o) => o.id),
  pantsColor: PALETTE.map((o) => o.id),
  hatModel: HAT_MODELS.map((o) => o.id),
  hatColor: PALETTE.map((o) => o.id),
  glassesModel: GLASSES_MODELS.map((o) => o.id),
  glassesColor: FRAME_COLORS.map((o) => o.id),
  shoesModel: SHOES_MODELS.map((o) => o.id),
  shoesColor: PALETTE.map((o) => o.id),
};

// Sanitasi: hanya nilai allowlist yang lolos; sisanya kembali ke default.
// Dipakai client (saat load save) dan dicerminkan server.
export function sanitizeCustom(input, gender = 'male') {
  const def = defaultCustom(gender);
  const src = (input && typeof input === 'object') ? input : {};
  const out = {};
  for (const key of Object.keys(def)) {
    out[key] = ALLOW[key].includes(src[key]) ? src[key] : def[key];
  }
  return out;
}

export function hexOf(list, id, fallback = '#888888') {
  const found = list.find((o) => o.id === id);
  return found ? found.hex : fallback;
}
