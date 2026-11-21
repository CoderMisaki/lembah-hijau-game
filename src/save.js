// save.js — simpan otomatis ke localStorage (tiap 10 dtk + tiap aksi penting).
// localStorage = cache/fallback offline. Backend (Cloudflare Workers + D1)
// adalah sumber kebenaran saat online — sinkronisasi diatur di cloud.js.
// Format v2 menambahkan: custom (kustomisasi karakter), updatedAt, username.
import { sanitizeCustom } from './customization.js';

export const SAVE_KEY = 'lembahHijauSaveV1';
export const SAVE_VERSION = 2;

export function buildSaveData(state) {
  return {
    v: SAVE_VERSION,
    savedAt: Date.now(),
    updatedAt: state.updatedAt || Date.now(),
    username: state.username || null,
    // minutes berjalan sebagai float di game loop -> bulatkan agar lolos
    // validasi integer server (dan konsisten dengan snapshot debug).
    coins: state.coins, day: state.day, minutes: Math.floor(state.minutes),
    lang: state.lang, gender: state.gender, sound: state.sound, quality: state.quality,
    custom: sanitizeCustom(state.custom, state.gender),
    inv: state.inv,
    plots: state.plots.map((p) => ({ crop: p.crop, growth: p.growth, watered: p.watered, hoed: p.hoed })),
    animals: state.animals,
    player: { x: state.playerX, z: state.playerZ },
  };
}

export function saveGame(state) {
  try {
    state.updatedAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(buildSaveData(state)));
    return true;
  } catch (e) { console.warn('[save] gagal menyimpan', e); return false; }
}

// Membaca save lokal. Menerima v1 (tanpa custom -> default) dan v2.
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || (d.v !== 1 && d.v !== 2)) return null;
    if (d.v === 1) {
      d.custom = sanitizeCustom(null, d.gender || 'male');
      d.updatedAt = d.savedAt || 0;
    } else {
      d.custom = sanitizeCustom(d.custom, d.gender || 'male');
    }
    return d;
  } catch (e) { console.warn('[save] gagal memuat', e); return null; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* abaikan */ }
}
