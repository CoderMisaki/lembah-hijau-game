// save.js — simpan otomatis ke localStorage (tiap 10 dtk + tiap aksi penting).
// localStorage = cache/fallback offline. Backend (Supabase Edge Function
// lembah-hijau-api) adalah sumber kebenaran saat online — sinkronisasi
// diatur di cloud.js.
// Format v3 (F2, 26 Nov 2026) menambahkan SEMUA field baru Wave-1 + Wave-2
// yang dulu dibuang validateSave() server saat round-trip cloud:
//   discoveredSpots (B), braids/visor via custom (A, allowlist server),
//   inv kunci baru + invQ + trees + machineCooldown + plot soil/fert (C),
//   npcFriendship/npcGiftedDay/npcMet/npcQuests/npcFestival + npcChatDay (D),
//   mpVisits/mpTrades/mpMinigameBest (E), season (B, runtime -> tersimpan).
//   Cuaca TIDAK disimpan (transien, auto-cycle tiap 50 dtk; selalu mulai cerah).
// Migrasi: v1 -> v2 (custom + updatedAt, sudah ada) -> v3 (field baru =
// default; lihat loadGame). Save v2 lama tetap terbaca, progres utuh.
import { sanitizeCustom } from './customization.js';

export const SAVE_KEY = 'lembahHijauSaveV1';
export const SAVE_VERSION = 3;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const HIDDEN_SPOT_IDS = ['sakura-grove', 'lake-shore', 'mountain-nook', 'old-well', 'windmill-back'];
export const NPC_IDS = ['darman', 'ratna', 'udin', 'lestari', 'joyo', 'raka'];
export const QUEST_IDS = ['d-carrot', 'd-harvest', 'd-feed', 'w-harvest', 'w-gifts'];

function sanitizeNpcMap(src, maxV) {
  if (!src || typeof src !== 'object') return {};
  return Object.fromEntries(Object.entries(src)
    .filter(([k, v]) => NPC_IDS.includes(k) && Number.isFinite(v))
    .map(([k, v]) => [k, Math.max(0, Math.min(maxV, Math.floor(v)))]));
}

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
    // COZY-F2 — v3: musim tersimpan (world.season disalin ke state.season
    // oleh Game.save(); cuaca tetap runtime — lihat header file).
    season: SEASONS.includes(state.season) ? state.season : 'spring',
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
    // v3: id di-allowlist (5 spot Lane B) supaya save liar tak lolos.
    discoveredSpots: Array.isArray(state.discoveredSpots)
      ? state.discoveredSpots.filter((s) => HIDDEN_SPOT_IDS.includes(s)).slice(0, 32)
      : [],
    // COZY-D — NPC + Sosial (Lane D, aditif; v2 tetap, F2 menambahkan ke
    // allowlist server v3): pertemanan, hadiah harian, quest, festival.
    // inv sudah ditulis utuh di atas, jadi kunci baru 'goldenEgg' ikut.
    // COZY-F2 — v3: npcFriendship/npcGiftedDay kini di-allowlist 6 id warga
    // (sebelumnya kunci string apa pun lolos); npcChatDay baru = hari
    // terakhir tiap warga dapat +1 fp dari obrolan chat2 (cap harian F2).
    npcFriendship: sanitizeNpcMap(state.npcFriendship, 999),
    npcGiftedDay: sanitizeNpcMap(state.npcGiftedDay, 10000),
    npcChatDay: sanitizeNpcMap(state.npcChatDay, 10000),
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

// Membaca save lokal. Menerima v1, v2, dan v3.
//   v1 -> v2: tanpa custom -> default; updatedAt = savedAt || 0.
//   v2 -> v3: field baru Wave-1/2 (invQ, trees, npc*, mp*, season,
//     discoveredSpots, soil/fert) ABSEN di save v2 — bukan hilang, tapi
//     diisi default oleh Game (constructor) + sanitize di sini; progres
//     lama (koin/hari/inv/petak/hewan) terbaca utuh. v3 ditulis ulang
//     saat save berikutnya (migrasi malas, tanpa dialog).
// Save dengan v tak dikenal / rusak tetap null (diperlakukan sebagai baru).
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || (d.v !== 1 && d.v !== 2 && d.v !== 3)) return null;
    if (d.v === 1) {
      d.custom = sanitizeCustom(null, d.gender || 'male');
      d.updatedAt = d.savedAt || 0;
    } else {
      d.custom = sanitizeCustom(d.custom, d.gender || 'male');
    }
    if (d.v === 2) d.v = 3; // migrasi malas v2 -> v3 (field baru = default)
    return d;
  } catch (e) { console.warn('[save] gagal memuat', e); return null; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* abaikan */ }
}
