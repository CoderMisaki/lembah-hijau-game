// save.js — simpan otomatis ke localStorage (tiap 10 dtk + tiap aksi penting).
export const SAVE_KEY = 'lembahHijauSaveV1';

export function saveGame(state) {
  try {
    const data = {
      v: 1, savedAt: Date.now(),
      coins: state.coins, day: state.day, minutes: state.minutes,
      lang: state.lang, gender: state.gender, sound: state.sound, quality: state.quality,
      inv: state.inv,
      plots: state.plots.map((p) => ({ crop: p.crop, growth: p.growth, watered: p.watered, hoed: p.hoed })),
      animals: state.animals,
      player: { x: state.playerX, z: state.playerZ },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) { console.warn('[save] gagal menyimpan', e); return false; }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1) return null;
    return d;
  } catch (e) { console.warn('[save] gagal memuat', e); return null; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* abaikan */ }
}
