// save.js — simpan otomatis ke localStorage (tiap 10 dtk + tiap aksi penting).
// localStorage = cache/fallback offline. Backend (Supabase Edge Function
// lembah-hijau-api) adalah sumber kebenaran saat online — sinkronisasi
// diatur di cloud.js.
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
    // COZY-C (additive, v2 tetap): kualitas inventaris {item:{good,rare}},
    // pohon buah, cooldown mesin, dan tanah/pupuk per petak. F2 menambahkan
    // semuanya ke allowlist server (validateSave) + migrasi v3.
    invQ: state.invQ || {},
    trees: Array.isArray(state.trees)
      ? state.trees.map((tr) => ({ kind: tr.kind || null, growth: tr.growth || 0, fruit: tr.fruit || 0 })).slice(0, 4)
      : [],
    machineCooldown: state.machineCooldown || 0,
    // Lokasi tersembunyi yang sudah ditemukan (sekali per save) — tanpa ini
    // hadiah spot terbit ulang tiap reload (duplikasi koin, Wave-1).
    discoveredSpots: Array.isArray(state.discoveredSpots)
      ? state.discoveredSpots.filter((s) => typeof s === 'string').slice(0, 32)
      : [],
    // COZY-D — NPC + Sosial (Lane D, aditif; v2 tetap, F2 menambahkan ke
    // allowlist server v3): pertemanan, hadiah harian, quest, festival.
    // inv sudah ditulis utuh di atas, jadi kunci baru 'goldenEgg' ikut.
    npcFriendship: (state.npcFriendship && typeof state.npcFriendship === 'object')
      ? Object.fromEntries(Object.entries(state.npcFriendship)
          .filter(([k, v]) => typeof k === 'string' && Number.isFinite(v))
          .map(([k, v]) => [k, Math.max(0, Math.min(999, Math.floor(v)))]))
      : {},
    npcGiftedDay: (state.npcGiftedDay && typeof state.npcGiftedDay === 'object')
      ? Object.fromEntries(Object.entries(state.npcGiftedDay)
          .filter(([k, v]) => typeof k === 'string' && Number.isFinite(v))
          .map(([k, v]) => [k, Math.floor(v)]))
      : {},
    npcMet: (state.npcMet && typeof state.npcMet === 'object')
      ? Object.fromEntries(Object.entries(state.npcMet)
          .filter(([k, v]) => typeof k === 'string' && v === true))
      : {},
    npcQuests: (state.npcQuests && Array.isArray(state.npcQuests.daily)
        && Array.isArray(state.npcQuests.weekly))
      ? {
          day: Math.floor(state.npcQuests.day || 1),
          week: Math.floor(state.npcQuests.week || 0),
          daily: state.npcQuests.daily.map((q) => ({ id: String(q.id), progress: Math.max(0, Math.floor(q.progress || 0)), done: !!q.done })).slice(0, 8),
          weekly: state.npcQuests.weekly.map((q) => ({ id: String(q.id), progress: Math.max(0, Math.floor(q.progress || 0)), done: !!q.done })).slice(0, 8),
          weekGiftNpcs: Array.isArray(state.npcQuests.weekGiftNpcs)
            ? state.npcQuests.weekGiftNpcs.filter((s) => typeof s === 'string').slice(0, 16) : [],
        }
      : null,
    npcFestival: (state.npcFestival && typeof state.npcFestival === 'object' && Number.isFinite(state.npcFestival.day))
      ? {
          day: Math.floor(state.npcFestival.day),
          talked: Object.fromEntries(Object.entries(state.npcFestival.talked || {})
            .filter(([k, v]) => typeof k === 'string' && v === true)),
          harvested: Math.max(0, Math.floor(state.npcFestival.harvested || 0)),
          rewarded: !!state.npcFestival.rewarded,
        }
      : null,
    // COZY-D — end
    // COZY-E — start: ekonomi multiplayer (aditif; server validateSave
    // clean BELUM mengenal field ini — F2 menambahkan ke allowlist.
    // Sampai itu ada, cloud round-trip memangkasnya seperti discoveredSpots
    // sebelum Wave-1; save lokal tetap utuh.)
    mpVisits: (state.mpVisits && typeof state.mpVisits === 'object' && !Array.isArray(state.mpVisits))
      ? Object.fromEntries(Object.entries(state.mpVisits)
        .filter(([k, v]) => /^[a-z0-9_]{3,16}$/.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(v))).slice(0, 64))
      : {},
    mpTrades: Array.isArray(state.mpTrades) ? state.mpTrades.slice(0, 20) : [],
    mpMinigameBest: Number.isInteger(state.mpMinigameBest) && state.mpMinigameBest >= 0 ? state.mpMinigameBest : 0,
    // COZY-E — end
    plots: state.plots.map((p) => ({ crop: p.crop, growth: p.growth, watered: p.watered, hoed: p.hoed,
      soil: p.soil ?? 80, fert: !!p.fert })),
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
