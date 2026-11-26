// npc.js — NPC + kehidupan sosial Lembah Hijau (COZY-D, Wave 2).
//
// Isi: 5 warga desa bernama + 1 pedagang keliling, jadwal harian mengikuti
// jam game (state.minutes), dialog bercabang (2-3 pilihan, 2-3 node),
// pertemanan + hadiah, quest harian/mingguan, pedagang keliling, festival
// panen mingguan. Semua visual memakai buildCharacter() dari player.js
// (gaya chibi yang sama dengan Bima/Sari — TIDAK ada builder kedua);
// animasi reaksi memakai metode Lane A: player.greet()/pet() +
// setExpression() untuk pemain, dan untuk NPC: lambaian lengan + ekspresi
// wajah via userData.face (logika yang sama dengan applyFaceExpression di
// player.js:377-402 — fungsi itu tidak diekspor, jadi disalin seperlunya di
// sini, lihat setNpcFace()).
//
// State (semua di Game.state, persisten aditif, SAVE_VERSION tetap 2):
//   npcFriendship {id: poin}, npcGiftedDay {id: hari}, npcMet {id: true},
//   npcQuests {day, week, daily[], weekly[], weekGiftNpcs[]},
//   npcFestival {day, talked{}, harvested, rewarded}.
// Default + sanitasi ada di main.js (defaultState + constructor load);
// buildSaveData di save.js menulisnya; F2 (v3) menambahkan ke allowlist
// server. Modul ini TIDAK pernah menyentuh localStorage / server langsung.
import { buildCharacter } from './player.js';
import { terrainHeight } from './physics.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Jam game: 06:00 = 360, 22:00 = 1320 (main.js DAY_START/DAY_END).
const T = (h, m = 0) => h * 60 + m;

// ---------------------------------------------------------------- NPC ---
// home = titik depan rumah; work = tempat kerja; plaza = alun-alun (16,-31).
// Waypoint dipilih di jalur/ruang terbuka (bukan di dalam footprint rumah /
// collider) supaya NPC tidak menembus dinding saat berjalan lurus.
export const NPC_DEFS = [
  {
    id: 'darman', name: 'Pak Darman', job: { id: 'Kepala Desa', en: 'Village Chief' },
    gender: 'male',
    custom: { skin: 'tan', hairStyle: 'short', hairColor: 'grey', shirtModel: 'long', shirtColor: 'brown', pantsModel: 'pants', pantsColor: 'brown', hatModel: 'straw', hatColor: 'straw', glassesModel: 'round', glassesColor: 'black', shoesModel: 'boots', shoesColor: 'brown' },
    likes: ['pumpkin', 'egg'],
    home: { x: 27, z: -29 }, work: { x: 20, z: -31 }, plaza: { x: 13, z: -27 },
    greet: { id: 'Selamat datang di Lembah Hijau! Ada yang bisa saya bantu, Nak?', en: 'Welcome to Lembah Hijau! How can I help you, kid?' },
    chat: { id: 'Desa ini dulu cuma tiga rumah dan satu sumur. Sekarang lihat — ramai, kan? Semua karena warga saling bantu.', en: 'This village used to be just three houses and one well. Look at it now — busy, right? All because neighbours help each other.' },
    chat2: { id: 'Rahasia saya: tiap pagi saya keliling desa sebelum sarapan. Kalau ada warga yang murung, saya tahu sebelum siang.', en: 'My secret: every morning I walk the village before breakfast. If anyone is down, I know before noon.' },
  },
  {
    id: 'ratna', name: 'Bu Ratna', job: { id: 'Pedagang Pasar', en: 'Market Trader' },
    gender: 'female',
    custom: { skin: 'medium', hairStyle: 'bun', hairColor: 'black', shirtModel: 'tee', shirtColor: 'pink', pantsModel: 'skirt', pantsColor: 'purple', hatModel: 'none', hatColor: 'white', glassesModel: 'none', glassesColor: 'black', shoesModel: 'boots', shoesColor: 'brown' },
    likes: ['tomato', 'milk'],
    home: { x: 29, z: -16 }, work: { x: 12, z: -27 }, plaza: { x: 19, z: -27 },
    greet: { id: 'Wah, ada pembeli! Eh, bukan — ada tetangga baru. Mau lihat dagangan saya?', en: 'Oh, a customer! No wait — a new neighbour. Want to see my goods?' },
    chat: { id: 'Harga di pasar naik-turun ikut musim. Tomat lagi bagus minggu ini — petani yang rajin pasti untung.', en: 'Market prices rise and fall with the season. Tomatoes are doing well this week — a hardworking farmer always profits.' },
    chat2: { id: 'Dulu saya jualan keliling pakai gerobak. Sekarang lapak saya di sini, tapi hati saya tetap di jalanan desa.', en: 'I used to hawk goods from a cart. Now my stall is here, but my heart is still out on the village roads.' },
  },
  {
    id: 'udin', name: 'Kang Udin', job: { id: 'Nelayan', en: 'Fisherman' },
    gender: 'male',
    custom: { skin: 'brown', hairStyle: 'short', hairColor: 'black', shirtModel: 'tee', shirtColor: 'teal', pantsModel: 'shorts', pantsColor: 'blue', hatModel: 'cap', hatColor: 'blue', glassesModel: 'none', glassesColor: 'black', shoesModel: 'sandals', shoesColor: 'brown' },
    likes: ['egg', 'carrot'],
    home: { x: -14, z: -33 }, work: { x: -19, z: 6 }, plaza: { x: 16, z: -26 },
    greet: { id: 'Pagi! Ikan di sungai lagi banyak. Kamu mancing juga, Nak?', en: 'Morning! The river is full of fish. Do you fish too, kid?' },
    chat: { id: 'Sungai ini aneh — kadang tenang, kadang arusnya kencang. Nelayan yang sabar selalu pulang bawa ikan.', en: 'This river is strange — sometimes calm, sometimes the current runs fast. A patient fisherman always comes home with fish.' },
    chat2: { id: 'Ikan terbesar yang pernah saya tangkap? Sebesar lengan saya! …Ya, mungkin saya yang melebih-lebihkan sedikit.', en: 'The biggest fish I ever caught? As big as my arm! …Yes, maybe I exaggerate a little.' },
  },
  {
    id: 'lestari', name: 'Mbak Lestari', job: { id: 'Penjahit', en: 'Tailor' },
    gender: 'female',
    custom: { skin: 'fair', hairStyle: 'ponytail', hairColor: 'auburn', shirtModel: 'long', shirtColor: 'white', pantsModel: 'pants', pantsColor: 'purple', hatModel: 'bandana', hatColor: 'pink', glassesModel: 'none', glassesColor: 'black', shoesModel: 'boots', shoesColor: 'brown' },
    likes: ['pumpkin', 'milk'],
    home: { x: 16, z: -38 }, work: { x: -13, z: -18 }, plaza: { x: 21, z: -28 },
    greet: { id: 'Halo! Baju robek? Celana kependekan? Bawa ke saya — jarum saya tidak pernah meleset.', en: 'Hello! Torn shirt? Trousers too short? Bring them to me — my needle never misses.' },
    chat: { id: 'Kain terbaik itu yang dijahit pelan-pelan. Sama seperti kebun — tidak ada yang tumbuh karena diburu-buru.', en: 'The best cloth is sewn slowly. Just like a garden — nothing grows from being rushed.' },
    chat2: { id: 'Saya sedang menjahit bendera festival tahun ini. Warnanya… rahasia. Lihat saja nanti di alun-alun!', en: 'I am sewing this year’s festival banner. Its colours… a secret. Just look at the square when the day comes!' },
  },
  {
    id: 'joyo', name: 'Mbah Joyo', job: { id: 'Petani Senior', en: 'Senior Farmer' },
    gender: 'male',
    custom: { skin: 'tan', hairStyle: 'short', hairColor: 'grey', shirtModel: 'vest', shirtColor: 'brown', pantsModel: 'pants', pantsColor: 'brown', hatModel: 'straw', hatColor: 'straw', glassesModel: 'none', glassesColor: 'black', shoesModel: 'boots', shoesColor: 'brown' },
    likes: ['carrot', 'tomato'],
    home: { x: 3, z: -36 }, work: { x: 10, z: 15 }, plaza: { x: 16, z: -35 },
    greet: { id: 'Hehe, anak muda berkebun. Tanah di sini baik, asal kamu baik juga padanya.', en: 'Hehe, a young one farming. The soil here is kind, as long as you are kind to it.' },
    chat: { id: 'Wortel itu sabar. Dua hari disiram, dia tumbuh. Manusia saja yang sering tidak sabaran.', en: 'Carrots are patient. Two days of watering and they grow. Humans are the impatient ones.' },
    chat2: { id: 'Dulu saya menanam labu sebesar tempayan. Tetangga sampai tidak percaya — sampai saya potong di depan mereka.', en: 'I once grew a pumpkin as big as a water jar. The neighbours did not believe it — until I cut it open in front of them.' },
  },
];

// Pedagang keliling — BUKAN warga tetap: muncul di hari tertentu saja.
export const MERCHANT_DEF = {
  id: 'raka', name: 'Pak Raka', job: { id: 'Pedagang Keliling', en: 'Travelling Merchant' },
  gender: 'male',
  custom: { skin: 'medium', hairStyle: 'spiky', hairColor: 'black', shirtModel: 'vest', shirtColor: 'red', pantsModel: 'pants', pantsColor: 'teal', hatModel: 'cap', hatColor: 'red', glassesModel: 'none', glassesColor: 'black', shoesModel: 'boots', shoesColor: 'brown' },
  likes: ['goldenEgg'],
  plaza: { x: 12, z: -27 },
  greet: { id: 'Psst — barang langka, harga teman! Cuma hari ini saya di desa. Besok saya sudah di lembah seberang.', en: 'Psst — rare goods, friends’ prices! I am only in the village today. Tomorrow I will be in the valley across.' },
  chat: { id: 'Saya keliling tujuh lembah. Lembah Hijau ini yang paling ramah — dan yang paling banyak wortelnya, hehe.', en: 'I travel seven valleys. Lembah Hijau is the friendliest — and the one with the most carrots, hehe.' },
  chat2: { id: 'Telur emas itu? Dari ayam yang makannya cuma jagung manis dan tidur di jerami hangat. Langka, makanya mahal.', en: 'That golden egg? From a hen that eats only sweet corn and sleeps in warm straw. Rare — that is why it costs.' },
};
// Hari pedagang: hari 1, 4, 7, 10, … (deterministik dari nomor hari).
export function isMerchantDay(day) { return ((day - 1) % 3) === 0; }
// Festival Panen: tiap hari ke-7 (hari 7, 14, 21, …).
export function isFestivalDay(day) { return day % 7 === 0; }
// Barang pedagang: benih/umpan lebih murah dari toko + 1 barang langka
// (Telur Emas — kunci inv baru 'goldenEgg', hadiah kesukaan semua warga).
export const MERCHANT_STOCK = [
  { key: 'carrotSeed', name: { id: 'Benih Wortel', en: 'Carrot Seeds' }, price: 3 },
  { key: 'tomatoSeed', name: { id: 'Benih Tomat', en: 'Tomato Seeds' }, price: 6 },
  { key: 'pumpkinSeed', name: { id: 'Benih Labu', en: 'Pumpkin Seeds' }, price: 10 },
  { key: 'feed', name: { id: 'Pakan', en: 'Feed' }, price: 1 },
  { key: 'goldenEgg', name: { id: 'Telur Emas', en: 'Golden Egg' }, price: 25 },
];
export const GIFTABLE = [
  { key: 'carrot', name: { id: 'Wortel', en: 'Carrot' } },
  { key: 'tomato', name: { id: 'Tomat', en: 'Tomato' } },
  { key: 'pumpkin', name: { id: 'Labu', en: 'Pumpkin' } },
  { key: 'egg', name: { id: 'Telur', en: 'Egg' } },
  { key: 'milk', name: { id: 'Susu', en: 'Milk' } },
  { key: 'goldenEgg', name: { id: 'Telur Emas', en: 'Golden Egg' } },
];

// ------------------------------------------------------------- Quest -----
export const DAILY_QUESTS = [
  { id: 'd-carrot', giver: 'ratna', kind: 'deliver', item: 'carrot', n: 3,
    text: { id: 'Antar 3 wortel ke Bu Ratna', en: 'Deliver 3 carrots to Bu Ratna' },
    reward: { coins: 30, fp: { npc: 'ratna', n: 5 } } },
  { id: 'd-harvest', giver: 'joyo', kind: 'harvest', n: 5,
    text: { id: 'Panen 5 hasil kebun', en: 'Harvest 5 crops' },
    reward: { coins: 25, fp: { npc: 'joyo', n: 3 } } },
  { id: 'd-feed', giver: 'udin', kind: 'feed', n: 3,
    text: { id: 'Beri makan 3 hewan', en: 'Feed 3 animals' },
    reward: { coins: 20, fp: { npc: 'udin', n: 3 } } },
];
export const WEEKLY_QUESTS = [
  { id: 'w-harvest', giver: 'joyo', kind: 'harvest', n: 15,
    text: { id: 'Panen 15 hasil kebun dalam seminggu', en: 'Harvest 15 crops in a week' },
    reward: { coins: 100, fp: { npc: 'joyo', n: 8 } } },
  { id: 'w-gifts', giver: 'lestari', kind: 'giftNpcs', n: 3,
    text: { id: 'Beri hadiah ke 3 warga berbeda', en: 'Give gifts to 3 different villagers' },
    reward: { coins: 80, fp: { npc: 'lestari', n: 8 } } },
];

// Level pertemanan: 0 Kenalan (<10), 1 Teman (>=10), 2 Sahabat (>=25).
export function friendshipLevel(fp) { return fp >= 25 ? 2 : fp >= 10 ? 1 : 0; }
export function nextMerchantDay(day) {
  for (let d = day; d < day + 3; d++) if (isMerchantDay(d)) return d;
  return day + 3;
}

function questState(tpl) { return { id: tpl.id, progress: 0, done: false }; }
function freshQuests(day) {
  return {
    day,
    week: Math.floor((day - 1) / 7),
    daily: DAILY_QUESTS.map(questState),
    weekly: WEEKLY_QUESTS.map(questState),
    weekGiftNpcs: [],
  };
}

// Ekspresi wajah NPC — salinan seperlunya dari applyFaceExpression
// (player.js:377-402, tidak diekspor): happy = mata senang + mulut terbuka,
// neutral = senyum biasa. Kedip tidak dipakai NPC (tidak ada update mata).
function setNpcFace(face, expr) {
  if (!face) return;
  const show = (key) => { for (const [k, m] of Object.entries(face.mouths)) m.visible = (k === key); };
  if (expr === 'happy') {
    face.eyeScale = 0.35; show('open');
    face.brows.forEach((b) => { b.rotation.z = b.userData.baseRotZ; });
    face.blushMat.opacity = 0.95;
  } else {
    face.eyeScale = 1; show('smile');
    face.brows.forEach((b) => { b.rotation.z = b.userData.baseRotZ; });
    face.blushMat.opacity = 0.75;
  }
  if (face.eyes) face.eyes.scale.y = face.eyeScale;
}

// ------------------------------------------------------------ Manager ----
export class NpcManager {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game; // Game — jembatan ke state / koin / inv / toast / save
    this.npcs = [];
    this.talkingId = null;
    for (const def of [...NPC_DEFS, MERCHANT_DEF]) {
      const group = buildCharacter(def.gender, def.custom);
      // Hanya Mbah Joyo yang memegang garpu tanah (petani); warga lain
      // menyembunyikannya supaya tidak semua laki-laki terlihat bertani.
      if (group.userData.tool) group.userData.tool.visible = (def.id === 'joyo');
      group.position.set(def.home?.x ?? def.plaza.x, 0, def.home?.z ?? def.plaza.z);
      scene.add(group);
      this.npcs.push({
        def, group, x: group.position.x, z: group.position.z,
        tx: group.position.x, tz: group.position.z,
        phase: Math.random() * 6, waveT: 0, expr: 'neutral', moving: false,
      });
    }
    this._ensureState();
  }

  get state() { return this.game.state; }
  _ensureState() {
    const s = this.state;
    if (!s.npcFriendship || typeof s.npcFriendship !== 'object') s.npcFriendship = {};
    if (!s.npcGiftedDay || typeof s.npcGiftedDay !== 'object') s.npcGiftedDay = {};
    // COZY-F2: hari terakhir tiap warga dapat +1 fp dari obrolan chat2
    // (cap harian; lihat choose()).
    if (!s.npcChatDay || typeof s.npcChatDay !== 'object') s.npcChatDay = {};
    if (!s.npcMet || typeof s.npcMet !== 'object') s.npcMet = {};
    if (!s.npcFestival || typeof s.npcFestival !== 'object') s.npcFestival = {};
    if (!s.npcQuests || !Array.isArray(s.npcQuests.daily)) s.npcQuests = freshQuests(s.day || 1);
    if (typeof s.npcQuests.day !== 'number') s.npcQuests = freshQuests(s.day || 1);
  }
  _lang() { return this.state.lang || 'id'; }
  _t(key, vars = {}) {
    // Teks UI NPC tinggal di i18n.js (STRINGS) — diimpor main.js sebagai t();
    // di sini dipakai lewat game agar tidak ada import melingkar.
    return this.game.npcT ? this.game.npcT(key, vars) : key;
  }
  _toast(msg) { this.game.ui?.toast(msg); }

  npcById(id) { return this.npcs.find((n) => n.def.id === id) || null; }
  fp(id) { return clamp(Math.floor(this.state.npcFriendship[id] || 0), 0, 999); }
  level(id) { return friendshipLevel(this.fp(id)); }

  merchantPresent(day, minutes) {
    return isMerchantDay(day) && minutes >= T(8) && minutes < T(18);
  }
  festivalActive(day) { return isFestivalDay(day); }

  // Jadwal: 06-08 rumah, 08-12 kerja, 12-14 alun-alun, 14-18 kerja,
  // 18-22 rumah. Festival: semua warga berkumpul di alun-alun 08-20.
  waypointFor(npc, minutes, day) {
    const d = npc.def;
    if (d.id === 'raka') return d.plaza;
    if (isFestivalDay(day) && minutes >= T(8) && minutes < T(20)) {
      // Lingkaran di sekeliling sumur alun-alun (pusat 16,-31, r=5).
      const idx = NPC_DEFS.findIndex((x) => x.id === d.id);
      const a = (idx / NPC_DEFS.length) * Math.PI * 2;
      return { x: 16 + Math.cos(a) * 5, z: -31 + Math.sin(a) * 5 };
    }
    if (minutes < T(8)) return d.home;
    if (minutes < T(12)) return d.work;
    if (minutes < T(14)) return d.plaza;
    if (minutes < T(18)) return d.work;
    return d.home;
  }

  update(dt, minutes, day) {
    if (!(dt > 0)) return;
    this._ensureState();
    for (const npc of this.npcs) {
      const g = npc.group;
      const u = g.userData || {};
      // Pedagang keliling: tidak ada di hari biasa / di luar jam dagang.
      if (npc.def.id === 'raka') {
        const present = this.merchantPresent(day, minutes);
        g.visible = present;
        if (!present) continue;
      }
      const wp = this.waypointFor(npc, minutes, day);
      const dx = wp.x - npc.x, dz = wp.z - npc.z;
      const dist = Math.hypot(dx, dz);
      // Sedang diajak bicara: berdiri diam menghadap pemain (jangan
      // berjalan pergi di tengah dialog saat jam berganti segmen).
      const talking = this.talkingId === npc.def.id;
      npc.moving = !talking && dist > 0.4;
      if (npc.moving) {
        const step = Math.min(2.0 * dt, dist);
        npc.x += (dx / dist) * step;
        npc.z += (dz / dist) * step;
        g.position.set(npc.x, terrainHeight(npc.x, npc.z), npc.z);
        g.rotation.y = Math.atan2(dx, dz);
        npc.phase += dt * 7;
        const sw = Math.sin(npc.phase) * 0.5;
        if (u.legL) u.legL.rotation.x = sw;
        if (u.legR) u.legR.rotation.x = -sw;
        if (u.armL) u.armL.rotation.x = -sw * 0.6;
        if (u.armR) u.armR.rotation.x = sw * 0.6;
      } else {
        // Diam: kaki lurus, napas idle, menghadap titik tujuannya
        // (atau pemain bila sedang diajak bicara).
        if (u.legL) u.legL.rotation.x = 0;
        if (u.legR) u.legR.rotation.x = 0;
        if (u.armL) u.armL.rotation.x = 0;
        npc.phase += dt * 1.6;
        if (u.upper) u.upper.position.y = Math.sin(npc.phase) * 0.02;
        if (this.talkingId !== npc.def.id) {
          g.rotation.y = Math.atan2(wp.x - npc.x, wp.z - npc.z) || g.rotation.y;
        }
      }
      // Lambaian sapaan (Lane A: pose greet pemain; NPC: lengan kanan).
      if (npc.waveT > 0) {
        npc.waveT -= dt;
        if (u.armR) {
          u.armR.rotation.x = -2.3;
          u.armR.rotation.z = 0.45 + Math.sin(npc.waveT * 14) * 0.25;
        }
      } else if (u.armR && !npc.moving) {
        u.armR.rotation.x = 0;
        u.armR.rotation.z = 0.07;
      }
      // Ekspresi kembali netral sesudah sapaan.
      if (npc.expr === 'happy' && npc.waveT <= 0 && this.talkingId !== npc.def.id) {
        npc.expr = 'neutral';
        setNpcFace(u.face, 'neutral');
      }
      // COZY-F2 — hemat draw call: detail wajah (mata/alis/mulut/blush,
      // ~15 mesh/NPC) tidak terlihat di atas ~30 m — sembunyikan, pulihkan
      // di bawah ~26 m (histeresis anti-kedip). Dicek 2×/detik/NPC, bukan
      // tiap frame. Di tampilan desa dekat (NPC 10–20 m) TIDAK ada yang
      // disembunyikan — penghematan terasa saat NPC jauh / kamera desa.
      npc._faceT = (npc._faceT || 0) + dt;
      if (npc._faceT > 0.5) {
        npc._faceT = 0;
        const cam = this.game.camera;
        if (cam && u.face) {
          const cd = Math.hypot(cam.position.x - npc.x, cam.position.z - npc.z);
          if (cd > 30 && !npc._faceHidden) {
            npc._faceHidden = true;
            if (u.face.eyes) u.face.eyes.visible = false;
            for (const m of Object.values(u.face.mouths || {})) m.visible = false;
            for (const b of u.face.brows || []) b.visible = false;
          } else if (cd < 26 && npc._faceHidden) {
            npc._faceHidden = false;
            if (u.face.eyes) u.face.eyes.visible = true;
            for (const b of u.face.brows || []) b.visible = true;
            setNpcFace(u.face, npc.expr || 'neutral'); // pulihkan mulut yang benar
          }
        }
      }
    }
  }

  nearestNpc(x, z, maxDist = 2.8) {
    let best = null, bestD = maxDist;
    for (const npc of this.npcs) {
      if (!npc.group.visible) continue;
      const d = Math.hypot(npc.x - x, npc.z - z);
      if (d < bestD) { bestD = d; best = npc; }
    }
    return best;
  }

  // ---------------------------------------------------------- Dialog -----
  // Node: { speaker, text:{id,en}, choices:[{label:{id,en}, next, fx}] }
  // next: node id | 'close' | 'gift' | 'shop'. fx: {fp, hint, quest}.
  rootNode(npc) {
    const d = npc.def;
    const lang = this._lang();
    const day = this.state.day;
    const first = !this.state.npcMet[d.id];
    let text = d.greet;
    if (d.id === 'raka') text = d.greet;
    else if (isFestivalDay(day)) {
      text = { id: `Festival Panen hari ini! Senang sekali kamu datang, Nak. Ayo tukar hadiah!`, en: `Harvest Festival today! So glad you came, kid. Let us exchange gifts!` };
    } else if (first) {
      text = { id: `${d.greet.id} Oh ya, kita belum kenalan — saya ${d.name}, ${d.job.id}.`, en: `${d.greet.en} Oh, we have not met — I am ${d.name}, ${d.job.en}.` };
    } else if (this.level(d.id) >= 2) {
      text = { id: `Ah, sahabatku datang! Duduk dulu, Nak. Ada cerita apa hari ini?`, en: `Ah, my dear friend is here! Sit a while, kid. What is new today?` };
    } else if (this.level(d.id) === 1) {
      text = { id: `Halo, teman! Senang bertemu kamu lagi.`, en: `Hello, friend! Good to see you again.` };
    }
    void lang;
    const choices = [
      { label: { id: 'Ngobrol', en: 'Chat' }, next: 'chat' },
      { label: { id: 'Beri Hadiah', en: 'Give Gift' }, next: 'gift' },
    ];
    // Quest antar barang: hanya Bu Ratna, hanya bila quest-nya aktif.
    if (d.id === 'ratna') {
      const q = this._quest('d-carrot');
      if (q && !q.done && (this.state.inv.carrot || 0) >= 3) {
        choices.push({ label: { id: 'Antar 3 Wortel (Quest)', en: 'Deliver 3 Carrots (Quest)' }, next: 'deliver' });
      }
    }
    if (d.id === 'raka') {
      choices.push({ label: { id: 'Lihat Dagangan', en: 'See Goods' }, next: 'shop' });
    }
    if (isFestivalDay(day) && d.id !== 'raka') {
      choices.push({ label: { id: 'Tukar Hadiah Festival', en: 'Exchange Festival Gift' }, next: 'festival' });
    }
    choices.push({ label: { id: 'Sampai jumpa', en: 'Goodbye' }, next: 'close' });
    return { speaker: d.name, job: d.job, text, choices, npcId: d.id, nodeId: 'root' };
  }

  talkTo(id) {
    const npc = this.npcById(id);
    if (!npc || !npc.group.visible) return null;
    this.talkingId = id;
    this.state.npcMet[id] = true;
    // Reaksi: NPC melambai + senang; pemain menyapa (Lane A greet()).
    npc.waveT = 1.6;
    npc.expr = 'happy';
    setNpcFace(npc.group.userData.face, 'happy');
    const p = this.game.player;
    if (p) {
      p.greet();
      p.setExpression('happy', 2);
      // Hadap pemain ke NPC.
      p.facing = Math.atan2(npc.x - p.x, npc.z - p.z);
    }
    // NPC menghadap pemain.
    npc.group.rotation.y = Math.atan2(p ? p.x - npc.x : 0, p ? p.z - npc.z : 1);
    this.game.save();
    return this.rootNode(npc);
  }

  endTalk() {
    if (this.talkingId) {
      const npc = this.npcById(this.talkingId);
      if (npc) { npc.expr = 'neutral'; setNpcFace(npc.group.userData.face, 'neutral'); }
    }
    this.talkingId = null;
  }

  choose(id, nodeId, choiceIdx) {
    const npc = this.npcById(id);
    if (!npc) return { action: 'close' };
    const node = nodeId === 'root' ? this.rootNode(npc) : this._node(npc, nodeId);
    const choice = node?.choices?.[choiceIdx];
    if (!choice) return { action: 'close' };
    if (choice.fx?.fp) this.addFp(id, choice.fx.fp);
    if (choice.next === 'close') { this.endTalk(); return { action: 'close' }; }
    if (choice.next === 'gift') return { action: 'gift', npcId: id };
    if (choice.next === 'shop') return { action: 'shop', npcId: id };
    if (choice.next === 'deliver') return this._deliverCarrots(npc);
    if (choice.next === 'festival') return this._festivalExchange(npc);
    const next = this._node(npc, choice.next);
    if (!next) { this.endTalk(); return { action: 'close' }; }
    // Sampai node chat2 = obrolan akrab: +1 pertemanan, MAKSIMAL 1/hari/NPC
    // (cap F2 — sebelumnya tiap kunjungan chat2 +1 tanpa batas, bisa
    // di-farm klik berulang sampai Sahabat +50 koin; Lane D §5.2).
    // npcChatDay dicatat per hari game; hari berganti = boleh +1 lagi.
    if (choice.next === 'chat2') {
      if ((this.state.npcChatDay[id] || 0) !== this.state.day) {
        this.state.npcChatDay[id] = this.state.day;
        this.addFp(id, 1);
      }
    }
    return { action: 'node', node: next };
  }

  _node(npc, nodeId) {
    const d = npc.def;
    const lvl = this.level(d.id);
    if (nodeId === 'chat') {
      return {
        speaker: d.name, job: d.job, text: d.chat, npcId: d.id, nodeId: 'chat',
        choices: [
          { label: { id: 'Ceritakan lebih banyak', en: 'Tell me more' }, next: 'chat2' },
          { label: { id: 'Kembali', en: 'Back' }, next: 'root' },
          { label: { id: 'Sampai jumpa', en: 'Goodbye' }, next: 'close' },
        ],
      };
    }
    if (nodeId === 'chat2') {
      const text = lvl >= 1 ? d.chat2 : {
        id: `${d.chat2.id} (Kamu merasa lebih dekat dengannya — teruslah mengobrol dan memberi hadiah.)`,
        en: `${d.chat2.en} (You feel closer to them — keep chatting and giving gifts.)`,
      };
      return {
        speaker: d.name, job: d.job, text, npcId: d.id, nodeId: 'chat2',
        choices: [
          { label: { id: 'Kembali', en: 'Back' }, next: 'root' },
          { label: { id: 'Sampai jumpa', en: 'Goodbye' }, next: 'close' },
        ],
      };
    }
    return null;
  }

  _deliverCarrots(npc) {
    const q = this._quest('d-carrot');
    if (!q || q.done || (this.state.inv.carrot || 0) < 3) {
      this.endTalk();
      return { action: 'close' };
    }
    this.state.inv.carrot -= 3;
    this._completeQuest(q, 'daily');
    this.game.save();
    this.game.ui?.updateHUD(this.state);
    return {
      action: 'node',
      node: {
        speaker: npc.def.name, job: npc.def.job, npcId: npc.def.id, nodeId: 'delivered',
        text: { id: 'Wortelnya segar-segar! Ini upahmu — terima kasih, Nak!', en: 'These carrots are so fresh! Here is your reward — thank you, kid!' },
        choices: [{ label: { id: 'Sama-sama!', en: 'You are welcome!' }, next: 'close' }],
      },
    };
  }

  _festivalExchange(npc) {
    const day = this.state.day;
    const fest = this._festivalState();
    if (fest.talked[npc.def.id]) {
      return {
        action: 'node',
        node: {
          speaker: npc.def.name, job: npc.def.job, npcId: npc.def.id, nodeId: 'festival-done',
          text: { id: 'Kita sudah tukar hadiah hari ini. Selamat menikmati festivalnya!', en: 'We already exchanged gifts today. Enjoy the festival!' },
          choices: [{ label: { id: 'Kembali', en: 'Back' }, next: 'root' }],
        },
      };
    }
    fest.talked[npc.def.id] = true;
    this.addFp(npc.def.id, 3);
    this.game.addCoins(15);
    this.game.save();
    return {
      action: 'node',
      node: {
        speaker: npc.def.name, job: npc.def.job, npcId: npc.def.id, nodeId: 'festival-gift',
        text: { id: 'Ini hadiah festival untukmu — +15 koin! Semoga panenmu tahun ini melimpah.', en: 'Here is a festival gift for you — +15 coins! May your harvest be plentiful this year.' },
        choices: [{ label: { id: 'Terima kasih!', en: 'Thank you!' }, next: 'close' }],
      },
    };
  }

  _festivalState() {
    const day = this.state.day;
    let f = this.state.npcFestival;
    if (!f || f.day !== day) {
      f = { day, talked: {}, harvested: 0, rewarded: false };
      this.state.npcFestival = f;
    }
    return f;
  }

  // -------------------------------------------------------- Pertemanan ---
  addFp(id, n) {
    if (!n) return;
    const before = this.level(id);
    this.state.npcFriendship[id] = clamp(this.fp(id) + n, 0, 999);
    const after = this.level(id);
    if (after > before) {
      // Naik level: hadiah sekali saat mencapai Sahabat — +50 koin.
      this._toast(this._t(after === 2 ? 'npcLevelUp' : 'npcLevelUpFriend', { name: this.npcById(id)?.def.name || id }));
      if (after === 2 && !this.state.npcMet[`${id}:lvl2paid`]) {
        this.state.npcMet[`${id}:lvl2paid`] = true;
        this.game.addCoins(50);
      }
    }
    this.game.save();
  }

  canGiftToday(id) {
    return (this.state.npcGiftedDay[id] || 0) !== this.state.day;
  }

  giveGift(id, itemKey) {
    const npc = this.npcById(id);
    if (!npc) return { ok: false, reason: 'npc' };
    if (!GIFTABLE.some((g) => g.key === itemKey)) return { ok: false, reason: 'item' };
    if ((this.state.inv[itemKey] || 0) < 1) return { ok: false, reason: 'none' };
    if (!this.canGiftToday(id)) return { ok: false, reason: 'already' };
    this.state.inv[itemKey] -= 1;
    this.state.npcGiftedDay[id] = this.state.day;
    const liked = npc.def.likes.includes(itemKey);
    const gain = itemKey === 'goldenEgg' ? 8 : liked ? 4 : 2;
    this.addFp(id, gain);
    npc.waveT = 1.2;
    npc.expr = 'happy';
    setNpcFace(npc.group.userData.face, 'happy');
    const p = this.game.player;
    if (p) { p.setExpression('happy', 2); }
    // Quest mingguan: hadiah ke warga berbeda.
    const q = this.state.npcQuests;
    if (q && Array.isArray(q.weekGiftNpcs) && !q.weekGiftNpcs.includes(id)) {
      q.weekGiftNpcs.push(id);
      this._bumpQuest('weekly', 'w-gifts', q.weekGiftNpcs.length, true);
    }
    this.game.save();
    this.game.ui?.updateHUD(this.state);
    return { ok: true, liked, gain, fp: this.fp(id) };
  }

  buyFromMerchant(itemKey) {
    const item = MERCHANT_STOCK.find((s) => s.key === itemKey);
    if (!item) return { ok: false, reason: 'item' };
    if (this.state.coins < item.price) return { ok: false, reason: 'coins' };
    this.state.coins -= item.price;
    this.state.inv[itemKey] = (this.state.inv[itemKey] || 0) + 1;
    this.game.save();
    this.game.ui?.updateHUD(this.state);
    return { ok: true, price: item.price, key: itemKey };
  }

  // ------------------------------------------------------------ Quest ----
  _quest(id) {
    const q = this.state.npcQuests;
    if (!q) return null;
    return [...(q.daily || []), ...(q.weekly || [])].find((x) => x.id === id) || null;
  }
  _questList(kind) { return kind === 'daily' ? this.state.npcQuests.daily : this.state.npcQuests.weekly; }

  _bumpQuest(kind, id, progress, absolute = false) {
    const list = this._questList(kind);
    const q = list?.find((x) => x.id === id);
    if (!q || q.done) return;
    q.progress = absolute ? progress : (q.progress || 0) + progress;
    const tpl = [...DAILY_QUESTS, ...WEEKLY_QUESTS].find((x) => x.id === id);
    if (tpl && q.progress >= tpl.n) this._completeQuest(q, kind);
    else this.game.save();
  }

  _completeQuest(q, kind) {
    q.done = true;
    q.progress = [...DAILY_QUESTS, ...WEEKLY_QUESTS].find((x) => x.id === q.id)?.n ?? q.progress;
    const tpl = [...DAILY_QUESTS, ...WEEKLY_QUESTS].find((x) => x.id === q.id);
    if (!tpl) return;
    this.game.addCoins(tpl.reward.coins);
    if (tpl.reward.fp) this.addFp(tpl.reward.fp.npc, tpl.reward.fp.n);
    this._toast(this._t('npcQuestDone', { n: tpl.reward.coins }));
    this.game.sfx?.play('coin');
    this.game.save();
  }

  // Hook dari Game: panen / beri makan / ganti hari.
  onHarvest(n = 1) {
    this._ensureState();
    this._bumpQuest('daily', 'd-harvest', n);
    this._bumpQuest('weekly', 'w-harvest', n);
    // Lomba panen festival: panen 3x di hari festival = +50 koin sekali.
    if (isFestivalDay(this.state.day)) {
      const f = this._festivalState();
      f.harvested = (f.harvested || 0) + n;
      if (f.harvested >= 3 && !f.rewarded) {
        f.rewarded = true;
        this.game.addCoins(50);
        this._toast(this._t('npcFestivalHarvest', { n: 50 }));
        this.game.save();
      }
    }
  }
  onFeed(n = 1) {
    this._ensureState();
    this._bumpQuest('daily', 'd-feed', n);
  }
  onNewDay(day) {
    this._ensureState();
    const q = this.state.npcQuests;
    const week = Math.floor((day - 1) / 7);
    if (q.day !== day) {
      q.day = day;
      q.daily = DAILY_QUESTS.map(questState);
    }
    if (q.week !== week) {
      q.week = week;
      q.weekly = WEEKLY_QUESTS.map(questState);
      q.weekGiftNpcs = [];
    }
    this.game.save();
  }

  // ------------------------------------------------------------- Panel ---
  panelData() {
    this._ensureState();
    const day = this.state.day;
    const tplOf = (q) => [...DAILY_QUESTS, ...WEEKLY_QUESTS].find((x) => x.id === q.id) || {};
    const withTpl = (list) => (list || []).map((q) => {
      const tpl = tplOf(q);
      return { id: q.id, text: tpl.text, need: tpl.n, progress: q.progress || 0, done: !!q.done, reward: tpl.reward, giver: tpl.giver };
    });
    return {
      npcs: NPC_DEFS.map((d) => ({
        id: d.id, name: d.name, job: d.job, fp: this.fp(d.id),
        level: this.level(d.id), likes: d.likes,
        giftedToday: !this.canGiftToday(d.id),
      })),
      merchant: { present: this.merchantPresent(day, this.state.minutes), nextDay: nextMerchantDay(day) },
      festival: { active: isFestivalDay(day), day },
      daily: withTpl(this.state.npcQuests.daily),
      weekly: withTpl(this.state.npcQuests.weekly),
    };
  }

  debug() {
    return {
      npcs: this.npcs.map((n) => ({
        id: n.def.id, x: +n.x.toFixed(1), z: +n.z.toFixed(1),
        visible: n.group.visible, moving: n.moving, fp: this.fp(n.def.id),
      })),
      merchantDay: isMerchantDay(this.state.day),
      festivalDay: isFestivalDay(this.state.day),
      quests: this.state.npcQuests,
    };
  }
}
