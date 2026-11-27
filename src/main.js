// main.js — entry point + game loop Lembah Hijau.
// Merangkai: world, player, farm, animals, ui, i18n, audio, save, input,
// physics, debug. Satu hari = ~4 menit nyata (06:00-22:00).
import * as THREE from 'three';
import { buildWorld, FARM_COLS, FARM_ROWS, PEN } from './world.js';
import { Player } from './player.js';
import { Farm, CROPS, plotPos } from './farm.js';
import { Animals, ANIMAL_DEFS } from './animals.js';
import { UI } from './ui.js';
import { t } from './i18n.js';
import { Sfx } from './audio.js';
import { saveGame, loadGame, clearSave, buildSaveData } from './save.js';
import { Input } from './input.js';
import { DynamicBox, terrainHeight, riverDistance, smoothstep } from './physics.js';
import { attachDebug } from './debug.js';
import { defaultCustom, sanitizeCustom } from './customization.js';
// COZY-C — start: ekonomi baru (farm + pasar + olah). economy.js = satu
// sumber harga; farm.js menyediakan pohon buah + pupuk + kualitas panen.
import {
  RECIPES, FERTILISER, SAPLINGS, MACHINE_COOLDOWN_MS,
  demandFor, sellPrice, computeSellAll, itemName,
  sanitizeInvQ, sanitizeTrees, defaultTrees, takeUnit, craftBonus, bestUnit,
  buildMachine, rollQuality, addQuality,
} from './economy.js';
import { toonMat, addOutline } from './world.js';
// COZY-C — end
// Pasar malam + multiplayer (23 Nov 2026): zona, 8 game berhadiah, wahana,
// jajanan, room online via Supabase Realtime (ephemeral, tanpa tabel baru).
import { buildNightMarketZone, NM_RECT } from './nm-zone.js';
import { buildNightMarketGames } from './nm-games.js';
import { buildNightMarketRides } from './nm-rides.js';
import { buildNightMarketFood } from './nm-food.js';
import { Multiplayer, MpEconomy } from './multiplayer.js';
import { NmInvite } from './nm-invite.js';
import { createBots } from './nm-bots.js';
// COZY-D — NPC + Sosial (Lane D): manajer warga desa, dialog, quest,
// pedagang keliling, festival. Satu blok import saja; wiring di bawah.
import { NpcManager } from './npc.js';
import {
  getSession, setSession, clearSession, hasPending, markPending, clearPending,
  validateUsername, validatePin, normalizeUsername,
  register as cloudRegister, login as cloudLogin, logout as cloudLogout,
  // COZY-F2 — pemulihan akun (kode pemulihan).
  recover as cloudRecover, issueRecoveryCode as cloudIssueRecoveryCode,
  cloudGetSave, cloudPutSave, cloudDeleteSave, cloudHealth,
  // COZY-E — start: API ekonomi multiplayer (server-validated).
  mpGarden, mpTradePropose, mpTradeAccept, mpTradeDecline, mpVisit,
  mpMinigameSubmit, mpMinigameResults, mpMinigameClaim, mpLeaderboard,
  isMpUnavailable,
  // COZY-E — end
} from './cloud.js';

// Alias fungsi i18n t(): loop() mendeklarasikan variabel lokal `t` (elapsed
// time, angka) yang men-shadow impor ini — pemanggilan t('...') di dalam
// loop() HARUS memakai i18nT, kalau tidak loop mati (TypeError) sekali jalan.
const i18nT = t;

const DAY_START = 360;   // 06:00
const DAY_END = 1320;    // 22:00
const DAY_LENGTH_SEC = 240; // 1 hari ~4 menit nyata
const MIN_PER_SEC = (DAY_END - DAY_START) / DAY_LENGTH_SEC; // 4 menit game/detik

const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 1024 },
  medium: { pixelRatio: 1.5, shadows: true, shadowSize: 1024 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048 },
};
const QUALITY_ORDER = ['low', 'medium', 'high'];

function defaultState() {
  const plots = [];
  for (let i = 0; i < FARM_COLS * FARM_ROWS; i++) plots.push({ crop: null, growth: 0, watered: false, hoed: false });
  const animals = [];
  const spots = [
    { kind: 'ayam', x: -9, z: 14 }, { kind: 'ayam', x: -6, z: 18 }, { kind: 'ayam', x: -3, z: 13 },
    { kind: 'sapi', x: -10, z: 19 }, { kind: 'sapi', x: -4, z: 20 },
  ];
  for (const s of spots) animals.push({ ...s, fed: false, ready: 0 });
  return {
    coins: 50, day: 1, minutes: DAY_START,
    lang: 'id', gender: 'male', sound: true, quality: 'medium',
    custom: defaultCustom('male'),
    username: null, updatedAt: 0,
    inv: { carrotSeed: 0, tomatoSeed: 0, pumpkinSeed: 0, feed: 0,
           carrot: 0, tomato: 0, pumpkin: 0, egg: 0, milk: 0,
           // COZY-C: benih + hasil baru (gandum/stroberi/buah/olahan/pupuk/bibit).
           wheatSeed: 0, strawberrySeed: 0, wheat: 0, strawberry: 0,
           apple: 0, orange: 0, cheese: 0, sauce: 0, flour: 0,
           fertiliser: 0, appleSapling: 0, orangeSapling: 0, goldenEgg: 0 },
    plots, animals, playerX: 6, playerZ: 20, // spawn pembuka: selatan kebun/kandang,
    discoveredSpots: [], // id lokasi tersembunyi yang sudah memberi hadiah
    // COZY-F2 — v3: musim tersimpan (mirror world.season; cuaca tetap
    // runtime). npcChatDay = hari terakhir tiap warga dapat +1 fp dari
    // obrolan chat2 (cap +1/hari/NPC, F2).
    season: 'spring',
    npcChatDay: {},
    // COZY-C — start: kualitas inventaris {item:{good,rare}} (inv = total),
    // pohon buah (4 titik), cooldown mesin pengolah (epoch ms, 0 = siap).
    invQ: {},
    trees: defaultTrees(),
    machineCooldown: 0,
    // COZY-C — end
    // COZY-D — NPC + Sosial (Lane D, aditif; SAVE_VERSION tetap 2):
    // pertemanan {id: poin}, hari terakhir beri hadiah {id: hari},
    // warga yang sudah disapa {id: true}, quest, status festival.
    npcFriendship: {}, npcGiftedDay: {}, npcMet: {},
    npcQuests: null, // diisi NpcManager (freshQuests) bila null
    npcFestival: null, // diisi NpcManager per hari festival bila null
    // COZY-E — start: ekonomi multiplayer (aditif, SAVE_VERSION tetap 2;
    // F2 menambahkan ketiganya ke validateSave clean + migrasi v3).
    mpVisits: {}, // {usernameKebun: 'YYYY-MM-DD'} kunjungan berhadiah terakhir (cermin lokal; server berwenang)
    mpTrades: [], // [{id, with, give:{item,qty}, get:{item,qty}, at}] maks 20, terbaru dulu
    mpMinigameBest: 0, // skor terbaik "Panen Cepat" bersama
    // COZY-E — end
    // kamera awal membingkai petak kebun (timur) + kandang (barat) + sungai + pegunungan (utara)
  };
}

class Game {
  constructor() {
    this.state = defaultState();
    const saved = loadGame();
    if (saved) {
      Object.assign(this.state, {
        coins: saved.coins ?? 50, day: saved.day ?? 1, minutes: saved.minutes ?? DAY_START,
        lang: saved.lang || 'id', gender: saved.gender || 'male',
        sound: saved.sound !== false, quality: saved.quality || 'medium',
        custom: sanitizeCustom(saved.custom, saved.gender || 'male'),
        username: saved.username || null, updatedAt: saved.updatedAt || saved.savedAt || 0,
        inv: { ...this.state.inv, ...(saved.inv || {}) },
        discoveredSpots: Array.isArray(saved.discoveredSpots)
          ? saved.discoveredSpots.filter((s) => typeof s === 'string')
          : [],
        // COZY-F2 — v3: musim + cap obrolan harian (save v2 = default).
        season: ['spring', 'summer', 'autumn', 'winter'].includes(saved.season) ? saved.season : 'spring',
        npcChatDay: (saved.npcChatDay && typeof saved.npcChatDay === 'object') ? saved.npcChatDay : {},
        // COZY-C — start: pulihkan field ekonomi baru (absen di save lama =
        // default; sanitizeTrees/invQ memotong nilai liar).
        invQ: sanitizeInvQ(saved.invQ || {}, { ...this.state.inv, ...(saved.inv || {}) }),
        trees: sanitizeTrees(saved.trees),
        machineCooldown: typeof saved.machineCooldown === 'number' ? saved.machineCooldown : 0,
        // COZY-C — end
        // COZY-D — NPC + Sosial: pulihkan aditif (save lama = kosong).
        npcFriendship: (saved.npcFriendship && typeof saved.npcFriendship === 'object') ? saved.npcFriendship : {},
        npcGiftedDay: (saved.npcGiftedDay && typeof saved.npcGiftedDay === 'object') ? saved.npcGiftedDay : {},
        npcMet: (saved.npcMet && typeof saved.npcMet === 'object') ? saved.npcMet : {},
        npcQuests: (saved.npcQuests && Array.isArray(saved.npcQuests.daily)) ? saved.npcQuests : null,
        npcFestival: (saved.npcFestival && typeof saved.npcFestival === 'object') ? saved.npcFestival : null,
        // COZY-E — start: pulihkan field ekonomi multiplayer (aditif).
        mpVisits: (saved.mpVisits && typeof saved.mpVisits === 'object' && !Array.isArray(saved.mpVisits))
          ? Object.fromEntries(Object.entries(saved.mpVisits)
            .filter(([k, v]) => /^[a-z0-9_]{3,16}$/.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(v))))
          : {},
        mpTrades: Array.isArray(saved.mpTrades) ? saved.mpTrades.slice(0, 20) : [],
        mpMinigameBest: Number.isInteger(saved.mpMinigameBest) && saved.mpMinigameBest >= 0 ? saved.mpMinigameBest : 0,
        // COZY-E — end
        playerX: saved.player?.x ?? 6, playerZ: saved.player?.z ?? 20,
      });
      if (Array.isArray(saved.plots) && saved.plots.length === this.state.plots.length) this.state.plots = saved.plots;
      if (Array.isArray(saved.animals) && saved.animals.length === this.state.animals.length) this.state.animals = saved.animals;
      this._hadSave = true;
    }
    // Sesi akun (token saja; PIN tidak pernah disimpan).
    this.session = getSession();
    if (this.session) this.state.username = this.session.username;
    this.offlineMode = false; // "Main Offline" eksplisit dari layar awal
    this._cloudBusy = false;
    this._cloudTimer = null;
    // COZY-F2 — perbaikan bug sync perangkat segar (Lane E §7.1): janji +
    // flag sinkronisasi boot pertama. Sampai janji ini selesai, TIDAK ADA
    // PUT cloud yang boleh jalan (lihat cloudSync + scheduleCloudSync) —
    // kalau tidak, save lokal kosong menimpa save server (PUT-vs-GET race).
    this._bootSyncDone = false;
    this._bootSyncPromise = null;
    this._bootSyncFlush = false; // ada save() yang menunggu flush pasca-sync
    this._introUntil = 0;
    this._wasSwimming = false;
    this._waterLevel = -1;
    this.fps = 60;
    this.started = false;
    this._fpsAccum = 0; this._fpsFrames = 0; this._lowFpsTime = 0; this._lastDegrade = 0;
    this._saveTimer = 0;
    this._pendingCropPlot = null;
    // Pasar malam + multiplayer (23 Nov 2026): buff jajanan + pemain remote.
    this.buffs = { speedMul: 1, jumpMul: 1, swimMul: 1 };
    this.remotePlayers = [];
    this._inNightMarket = false;
    this._nmBadge = null;
    // Urutan tidur sinematik: sleeping + sleepPhase diekspos ke window.__LH_GAME
    // untuk verifikasi headless. _sleep = { t0, phase, phaseT0, advanced, ... }.
    this.sleeping = false;
    this.sleepPhase = null;
    this._sleep = null;
    this._isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this._orientationLocked = false;
    this.sfx = new Sfx();
    this.sfx.enabled = this.state.sound;
  }

  init() {
    const canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Lane A (27 Nov 2026) — pipeline PBR realistis: tone mapping filmik +
    // output sRGB. HUD/UI adalah DOM (bukan WebGL) jadi tidak ikut gelap/
    // berubah oleh tone mapping ini. Exposure 1.0 = netral; bila scene
    // terasa gelap/terang setelah pergantian material, yang diubah angka ini
    // (bukan intensitas lampu per-stop di world.js).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = null; // langit digambar sky dome di world.js (gradient ikut waktu)
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
    // Posisi awal: tinggi + jauh ke selatan agar frame pembuka memuat kebun,
    // sungai (barat), dan pegunungan (utara) — bukan hamparan rumput kosong.
    this.camera.position.set(6, 16, 42);

    this.world = buildWorld(this.scene);
    // COZY-F2 — v3: pulihkan musim tersimpan (bukan cuaca — cuaca selalu
    // mulai cerah, lalu auto-cycle). buildWorld default spring; setSeason
    // mewarnai ulang terrain/tajuk/rumput.
    if (this.state.season && this.state.season !== 'spring') this.world.setSeason(this.state.season);
    // ---- Pasar malam (23 Nov 2026): zona + 8 game + wahana + jajanan.
    // Collider tiap modul digabung ke world.colliders (fisika + interaksi).
    this.nightmarket = buildNightMarketZone(this.scene, THREE, { lang: this.state.lang });
    this.world.colliders.push(...this.nightmarket.colliders);
    this.nmGames = buildNightMarketGames(this.scene, THREE, {
      t: (k, lang, vars) => t(k, lang, vars),
      lang: this.state.lang,
      toast: (m) => this.ui?.toast(m),
      sfx: this.sfx,
      // Hasil game disiarkan ke room (pemain lain melihat toast menang).
      broadcast: (type, data) => { if (this.mp) this.mp.broadcast(type, data); },
    });
    this.world.colliders.push(...this.nmGames.colliders);
    this.nmRides = buildNightMarketRides(this.scene, THREE, {
      t: (k, vars) => t(k, this.state.lang, vars),
      lang: this.state.lang,
      toast: (m) => this.ui?.toast(m),
      sfx: this.sfx,
    });
    this.world.colliders.push(...this.nmRides.colliders);
    this.nmFood = buildNightMarketFood(this.scene, THREE, {
      t,
      lang: this.state.lang,
      toast: (m) => this.ui?.toast(m),
      sfx: this.sfx,
    });
    this.world.colliders.push(...this.nmFood.colliders);
    // Culling bayangan pasar malam: kumpulkan mesh NM yang melempar
    // bayangan (sekali, di init) — castShadow-nya dimatikan saat pemain
    // jauh dari zona (loop). Proyektil game yang dibuat belakangan tidak
    // ikut daftar: kecil, sedikit, dan hanya ada saat bermain (= pemain
    // sudah di zona, bayangan menyala).
    this._nmCasters = [];
    for (const g of [this.nightmarket.group, this.nmGames._group, this.nmRides._group, this.nmFood._group]) {
      if (!g) continue;
      g.traverse((o) => { if (o.isMesh && o.castShadow) this._nmCasters.push(o); });
    }
    this._nmShadows = true;
    // ---- Bot pasar malam (Lane B): driver arena + 2 penumpang bot.
    this.nmBots = createBots(this);
    this.nmBots.attachArena(); // method instance (bukan standalone) agar debug().arena terisi
    // Geometri jauh (pegunungan) butuh far ini; langit aman via trik sky dome.
    this.camera.far = this.world.view.camFar;
    this.camera.updateProjectionMatrix();
    this.player = new Player(this.scene, this.state.gender, this.state.playerX, this.state.playerZ, this.state.custom);
    this.farm = new Farm(this.scene, this.state.plots, this.state.trees);
    // COZY-C — start: mesin pengolah + collider pohon buah masuk ke
    // world.colliders (fisika pemain menabrak batang/mesin, bukan tembus).
    this.machine = buildMachine(this.scene, THREE, { toonMat, addOutline, terrainHeight });
    this.world.colliders.push(this.machine.collider, ...this.farm.treeColliders);
    // COZY-C — end
    this.animals = new Animals(this.scene, this.state.animals);
    // COZY-D — NPC + Sosial: warga desa + pedagang keliling (dibangun
    // sekali di init; update() dipanggil dari loop utama). npcT = t() untuk
    // teks toast NPC (npc.js tidak mengimpor i18n agar tidak melingkar).
    this.npcT = (k, vars) => t(k, this.state.lang, vars);
    this.npc = new NpcManager(this.scene, this);
    // COZY-D — end
    this.crate = new DynamicBox(7, -15);
    this.input = new Input();
    this.input.onAction = () => this.doAction();
    this.input.onJump = () => { if (this.started && this.player.jump()) this.sfx.play('jump'); };

    this.ui = new UI({
      onStart: () => this.startGame(),
      onBuy: (k, p, n) => this.buyItem(k, p, n),
      onSell: (k, p, n) => this.sellItem(k, p, n),
      onPlant: (crop) => this.plantChosen(crop),
      // COZY-C — start: handler panel olah + tanam pohon (ui.js memanggil).
      onCraft: (recipeId) => this.craft(recipeId),
      onPlantTree: (kind) => this.plantTreeChosen(kind),
      // COZY-C — end
      onSleepYes: () => { this.ui.closeSleep(); this.sleep(); },
      onClearSave: () => this.clearAllSave(),
      onLang: (lang) => this.setLang(lang),
      onGender: (g) => { this.state.gender = g; this.player.setGender(this.scene, g); this.save(); },
      onSound: (on) => { this.state.sound = on; this.sfx.enabled = on; this.save(); },
      // COZY-F2: pilihan manual di pengaturan membatalkan pemulihan
      // otomatis (kualitas manual tidak boleh dinaikkan sendiri).
      onQuality: (q) => { this._autoDegraded = false; this.applyQuality(q); },
      onSave: () => this.saveNow(),
      onLoad: () => this.loadNow(),
      onCustomChange: (custom, gender) => this.applyCustom(custom, gender),
      onAuthSubmit: (mode, u, pin, pinConfirm) => this.handleAuth(mode, u, pin, pinConfirm),
      // COZY-F2 — pemulihan akun (kode pemulihan).
      onAuthRecover: (u, code, pin, pinConfirm) => this.handleRecover(u, code, pin, pinConfirm),
      onShowRecoveryCode: () => this.handleShowRecoveryCode(),
      onOffline: () => this.enterOfflineMode(),
      onLogout: () => this.handleLogout(),
      onDeleteServerSave: () => this.deleteServerSave(),
      // COZY-D — NPC + Sosial: handler dialog / hadiah / dagangan / panel.
      onNpcTalk: (id) => this.npc.talkTo(id),
      onNpcChoice: (id, nodeId, idx) => this.npc.choose(id, nodeId, idx),
      onNpcRoot: (id) => this.npc.rootNode(this.npc.npcById(id)),
      onNpcEndTalk: () => this.npc.endTalk(),
      onNpcGift: (id, item) => this.npcGiveGift(id, item),
      onNpcBuy: (key) => this.npcBuyFromMerchant(key),
      onNpcPanelData: () => this.npc.panelData(),
      onNpcGiftables: () => this.npcGiftables(),
      // COZY-D — end
      // Minimap: posisi + arah pemain live, data peta dari world (robustness
      // atas fallback window.__LH_GAME yang sudah ada di ui.js).
      getMinimap: () => ({
        player: { x: this.player.x, z: this.player.z, facing: this.player.facing },
        data: this.world.minimapData,
      }),
    });
    // ---- Multiplayer rooms (Main Bareng): Supabase Realtime, ephemeral —
    // channel room:<kode>, presence = posisi/avatar, broadcast = event game.
    // Bila Realtime tak terjangkau, game tetap jalan solo (modul toast gagal).
    this._nmBadge = document.getElementById('nm-badge');
    this._touchControls = document.getElementById('touch-controls');
    const selfName = () => this.state.username || this.session?.username || 'Tamu';
    this.mp = new Multiplayer({
      scene: this.scene,
      getIdentity: () => ({ username: selfName(), gender: this.state.gender, custom: this.state.custom }),
      onPlayers: (list) => {
        this.remotePlayers = list.map((p) => ({ username: p.username, x: p.x, z: p.z, facing: p.facing }));
        this.ui.setRoomState({
          inRoom: this.mp.connected, code: this.mp.roomCode,
          players: [{ username: selfName(), self: true },
            ...list.map((p) => ({ username: p.username, self: false }))],
          selfName: selfName(),
        });
      },
      onEvent: (type, data) => {
        // COZY-E — start: broadcast ekonomi multiplayer -> MpEconomy.
        // (trade_offer / trade_done / trade_declined / mp_game_*).
        if (type === 'trade_offer' || type === 'trade_done' || type === 'trade_declined'
          || type === 'mp_game_start' || type === 'mp_game_score' || type === 'mp_game_end') {
          this.mpEco?.handleBroadcast(type, data);
        }
        // COZY-E — end
        // Invite "Ajak Main": rute event invite ke modul (tanpa mengubah
        // handler chat/joined/game_result yang sudah ada di bawah).
        if (type === 'invite' || type === 'invite_accept'
          || type === 'invite_decline' || type === 'activity_join') {
          this.invite?.handleEvent(type, data);
        }
        const lang = this.state.lang;
        if (type === 'chat') this.ui.addRoomChat(data.from, data.text);
        else if (type === 'joined') this.ui.toast(t('roomJoined', lang, { code: data.code }));
        else if (type === 'left') this.ui.setRoomState({ inRoom: false, code: null, players: [] });
        else if (type === 'offline') this.ui.toast(t('roomConnectFail', lang));
        else if (type === 'reconnecting') this.ui.toast(t('roomReconnecting', lang));
        else if (type === 'player-joined') this.ui.toast(t('roomPlayerJoined', lang, { u: data.username }));
        else if (type === 'player-left') this.ui.toast(t('roomPlayerLeft', lang, { u: data.username }));
        else if (type === 'game_result' && data && data.win && data.prize > 0) {
          this.ui.toast(t('mpGameResult', lang, { u: data.from || '?', n: data.prize }));
        }
      },
    });
    // ---- Ajak Main (invite): undang pemain terdekat ke aktivitas yang sama.
    this.invite = new NmInvite({
      game: this,
      mp: this.mp,
      toast: (m) => this.ui?.toast(m),
      t: (k, vars) => t(k, this.state.lang, vars),
      getSelfName: () => selfName(),
      getSelfKey: () => this.mp._presenceKey,
      getLocalPosition: () => ({ x: this.player.x, z: this.player.z }),
      // Aktivitas pemain lokal saat ini: naik wahana > panel game terbuka >
      // _ctx board point. (Modul punya default yang sama persis; ditulis
      // eksplisit di sini supaya wiring-nya kelihatan.)
      getActivity: () => {
        if (this.nmRides.isRiding()) {
          const rid = this.nmRides.debug.state().riding;
          if (rid) return { kind: 'ride', id: rid };
        }
        const open = this.nmGames.debug.state().open;
        if (open) return { kind: 'game', id: open };
        const ctx = this._ctx;
        if (ctx && ctx.type === 'nm') return { kind: 'ride', id: ctx.id };
        if (ctx && ctx.type === 'nmGame') return { kind: 'game', id: ctx.id };
        return null;
      },
      // Masuk aktivitas. Turun dulu bila naik wahana lain / beda (onUse
      // bersifat toggle — panggil ulang = turun/tutup; sameness check ada
      // di modul via _activeActivity, ini belt-and-braces).
      joinActivity: (activity) => {
        if (activity.kind === 'ride') {
          if (this.nmRides.isRiding()) {
            if (this.nmRides.debug.state().riding === activity.id) return true;
            this.nmRides.stopRide();
          }
          return !!this.nmRides.onUse(activity.id, this);
        }
        if (this.nmRides.isRiding()) this.nmRides.stopRide();
        return !!this.nmGames.onUse(activity.id, this);
      },
    });
    this.ui.h.onCreateRoom = () => this.mp.createRoom();    this.ui.h.onJoinRoom = (code) => this.mp.joinRoom(code);
    this.ui.h.onLeaveRoom = () => this.mp.leaveRoom();
    this.ui.h.onSendChat = (text) => { if (this.mp.sendChat(text)) this.ui.addRoomChat(selfName(), text); };
    this.ui.h.getRemotePlayers = () => this.remotePlayers || [];
    // COZY-E — start: ekonomi multiplayer (MpEconomy). Server yang
    // memvalidasi + menerapkan; client hanya mengusulkan/menampilkan.
    // Semua angka koin/inventory yang diterapkan di bawah berasal dari
    // RESPONS SERVER (accept/visit/claim), bukan dari broadcast/client.
    this.mpEco = new MpEconomy({
      getMp: () => this.mp,
      api: {
        mpGarden, mpTradePropose, mpTradeAccept, mpTradeDecline, mpVisit,
        mpMinigameSubmit, mpMinigameResults, mpMinigameClaim, mpLeaderboard,
      },
      getUsername: () => selfName(),
      onEvent: (type, data) => this._onMpEcoEvent(type, data),
    });
    this.ui.h.onRoomOpened = () => { if (this.session) this.mpEco.probe(); };
    this.ui.h.getMpSession = () => !!this.session;
    this.ui.h.getMpInv = () => this.state.inv;
    this.ui.h.getMpRoom = () => (this.mp.connected ? this.mp.roomCode : null);
    this.ui.h.getMpEco = () => this.mpEco;
    this.ui.h.onMpVisit = (username) => this.visitGarden(username);
    this.ui.h.onMpTradePropose = async (to, offer, want) => {
      try { await this.mpEco.proposeTrade(to, offer, want); }
      catch (e) {
        if (isMpUnavailable(e)) this.ui.toast(t('mpComingSoon', this.state.lang));
        else if (e && e.message === 'no_session') this.ui.toast(t('needLogin', this.state.lang));
        else this.ui.toast((e && e.message) || t('mpTradeFailed', this.state.lang));
      }
    };
    this.ui.h.onMpTradeAccept = async (offerId) => {
      try { await this.mpEco.acceptTrade(offerId); }
      catch (e) {
        if (isMpUnavailable(e)) this.ui.toast(t('mpComingSoon', this.state.lang));
        else this.ui.toast((e && e.message) || t('mpTradeFailed', this.state.lang));
      }
    };
    this.ui.h.onMpTradeDecline = async (offerId) => {
      try { await this.mpEco.declineTrade(offerId); }
      catch (e) { this.ui.toast((e && e.message) || t('mpTradeFailed', this.state.lang)); }
    };
    this.ui.h.onMpGameStart = () => {
      if (!this.mp.connected) { this.ui.toast(t('inviteNeedRoom', this.state.lang)); return; }
      if (!this.session) { this.ui.toast(t('needLogin', this.state.lang)); return; }
      this.mpEco.startMinigame(this.mp.roomCode);
    };
    this.ui.h.onMpGameTap = () => this.mpEco.tapGame();
    this.ui.h.onMpLeaderboard = async () => {
      try { await this.mpEco.loadLeaderboard(); }
      catch (e) {
        if (isMpUnavailable(e)) this.ui.toast(t('mpComingSoon', this.state.lang));
        else if (e && e.message === 'no_session') this.ui.toast(t('needLogin', this.state.lang));
        else this.ui.toast((e && e.message) || t('loadFailed', this.state.lang));
      }
    };
    // COZY-E — end
    this.ui.setLang(this.state.lang);
    this.ui.setAuthState(this.session ? this.session.username : null);
    this.ui.showStart(this._hadSave
      ? t('welcomeBack', this.state.lang, { d: this.state.day }) : '');
    this.ui.updateHUD(this.state);
    // COZY-F2 — perbaikan bug sync perangkat segar (Lane E §7.1): JANGAN
    // save() di sini. applyQuality() lama memanggil save() -> saveGame()
    // men-stamp updatedAt = sekarang SEBELUM syncFromCloudOnBoot(), jadi di
    // perangkat segar localAt selalu > remoteAt dan save lokal KOSONG
    // diunggah menimpa save server. Sekarang: terapkan kualitas tanpa save,
    // lalu sync dulu; save lokal pertama sesudah sync baru boleh naik.
    this.applyQuality(this.state.quality, { save: false });
    // Sinkronisasi awal (non-blocking): bila ada sesi, samakan save lokal/server.
    if (this.session) this._bootSyncPromise = this.syncFromCloudOnBoot();
    window.addEventListener('online', () => { if (hasPending() && this.session) this.cloudSync(); });

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.checkOrientation(), 300));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      this.checkOrientation();
      // Tab kembali terlihat di tengah urutan tidur: fase dihitung dari
      // wall-clock, jadi satu tick langsung melompat ke fase yang benar
      // (atau menyelesaikan urutan) — tidak pernah softlock.
      if (this.sleeping) this._updateSleep(performance.now(), 0.016);
    });

    attachDebug(this);
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  // ---------- Siklus hidup ----------
  async startGame() {
    // Wajib login ATAU mode offline eksplisit — tidak ada jalan pintas diam-diam.
    if (!this.session && !this.offlineMode) {
      this.ui.toast(t('needLogin', this.state.lang));
      return;
    }
    this.sfx.ensure();
    this.sfx.play('click');
    this.started = true;
    this.ui.showGame(this._isTouch);
    this.ui.updateHUD(this.state);
    // Kamera pembuka: frame lebar (kebun + sungai + pegunungan) selama ~4 detik.
    this._introUntil = performance.now() + 4000;
    const px = this.player.x, py = this.player.y, pz = this.player.z;
    this.camera.position.set(px - 2, py + 15, pz + 22);
    // PERBAIKAN 5a (lanjutan): re-check orientasi AKTUAL dijadwalkan DULUAN —
    // JANGAN bergantung pada promise fullscreen/lock: keduanya bisa resolve
    // tanpa rotasi nyata (headless) ATAU menggantung tanpa pernah settle,
    // yang akan menunda/membatalkan pengecekan bila dijadwalkan setelahnya.
    this.checkOrientation();
    setTimeout(() => this.checkOrientation(), 500);
    // Landscape: fullscreen + orientation lock (Android Chrome). Semua error
    // ditangkap; tiap janji dibatasi 1 detik agar janji yang menggantung tidak
    // menghentikan startGame.
    const timeoutVal = Symbol('timeout');
    const withTimeout = (p, ms) => Promise.race([
      Promise.resolve(p),
      new Promise((resolve) => setTimeout(() => resolve(timeoutVal), ms)),
    ]);
    try {
      if (this._isTouch && document.documentElement.requestFullscreen) {
        await withTimeout(document.documentElement.requestFullscreen().catch(() => {}), 1000);
      }
    } catch (e) { /* abaikan */ }
    try {
      if (this._isTouch && screen.orientation && screen.orientation.lock) {
        const r = await withTimeout(screen.orientation.lock('landscape'), 1000);
        this._orientationLocked = r !== timeoutVal;
      }
    } catch (e) { this._orientationLocked = false; /* iOS / tidak didukung -> fallback overlay */ }
    this.checkOrientation();
    this.save();
    if (this.session && hasPending()) this.cloudSync();
  }
  checkOrientation() {
    // Desktop: jangan paksa apa pun. Perangkat sentuh: overlay bila viewport
    // BENAR-BENAR masih portrait (innerWidth < innerHeight) — HANYA itu.
    // JANGAN pakai screen.orientation.type sebagai OR: nilainya bisa tidak
    // sesuai viewport nyata (stale saat rotasi / di headless-emulasi tetap
    // 'portrait-primary'), sehingga overlay bisa muncul di landscape.
    // Viewport adalah ground truth; onResize memanggil ulang saat rotasi.
    if (!this.started || !this._isTouch) { this.ui.setOrientationOverlay(false); return; }
    const portrait = window.innerWidth < window.innerHeight;
    this.ui.setOrientationOverlay(portrait);
  }
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Rotasi bisa mengubah status "layar kecil" -> terapkan cap DPR lagi.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this._pixelRatioCap(QUALITY[this.state.quality].pixelRatio)));
    this.checkOrientation();
  }

  // Layar kecil (HP, sisi terpendek <= 500 px): batasi pixelRatio — piksel
  // tambahan di layar mungil nyaris tidak terlihat tapi biayanya besar
  // (diukur headless 844x390: DPR 2 ~2,4x frame time vs DPR 1).
  _pixelRatioCap(cfgPr) {
    const small = Math.min(window.innerWidth, window.innerHeight) <= 500;
    return small ? Math.min(cfgPr, 1.25) : cfgPr;
  }

  // ---------- Kualitas grafis + auto-degrade ----------
  // COZY-F2: opts.save=false = terapkan kualitas TANPA save() — dipakai
  // init() supaya boot tidak men-stamp updatedAt sebelum sync cloud
  // pertama (bug Lane E §7.1). Semua pemanggil lain tetap save.
  applyQuality(q, { save = true } = {}) {
    if (!QUALITY[q]) q = 'medium';
    this.state.quality = q;
    const cfg = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this._pixelRatioCap(cfg.pixelRatio)));
    this.renderer.shadowMap.enabled = cfg.shadows;
    if (this.world?.sun) {
      this.world.sun.castShadow = cfg.shadows;
      this.world.sun.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
      if (this.world.sun.shadow.map) { this.world.sun.shadow.map.dispose(); this.world.sun.shadow.map = null; }
    }
    // Kualitas rendah mematikan partikel + goyangan rumput di world.
    this.world?.setQuality?.(q);
    this.scene?.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    if (save) this.save();
  }
  _fpsCheck(rawDt) {
    // Ukur dari waktu dinding nyata (bukan dt yang di-clamp untuk fisika).
    this._fpsAccum += rawDt; this._fpsFrames += 1;
    if (this._fpsAccum >= 1) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0; this._fpsFrames = 0;
      const now = performance.now();
      if (this.fps < 45) {
        this._lowFpsTime += 1;
        this._highFpsTime = 0;
        if (this._lowFpsTime >= 5 && now - this._lastDegrade > 10000) {
          const idx = QUALITY_ORDER.indexOf(this.state.quality);
          if (idx > 0) {
            this.applyQuality(QUALITY_ORDER[idx - 1]);
            this.ui.toast(t('qualityLowered', this.state.lang));
            this._lastDegrade = now;
            this._autoDegraded = true; // naik lagi hanya bila turunnya otomatis
          }
          this._lowFpsTime = 0;
        }
      } else {
        this._lowFpsTime = 0;
        // COZY-F2 — pemulihan kualitas: bila FPS tinggi bertahan 30 detik
        // berturut-turut DAN penurunan terakhir otomatis (bukan pilihan
        // manual pemain), naik SATU tingkat. Cooldown 30 dtk + syarat
        // _autoDegraded mencegah osilasi naik-turun dan mencegah
        // menimpa pilihan manual "Rendah" di pengaturan.
        if (this.fps >= 55 && this._autoDegraded) {
          this._highFpsTime = (this._highFpsTime || 0) + 1;
          if (this._highFpsTime >= 30 && now - this._lastDegrade > 30000) {
            const idx = QUALITY_ORDER.indexOf(this.state.quality);
            if (idx >= 0 && idx < QUALITY_ORDER.length - 1) {
              this.applyQuality(QUALITY_ORDER[idx + 1]);
              this.ui.toast(t('qualityRaised', this.state.lang));
              this._lastDegrade = now;
            }
            this._highFpsTime = 0;
            this._autoDegraded = false; // naik manual-satu-langkah; tidak merangkak terus
          }
        } else this._highFpsTime = 0;
      }
    }
  }

  // ---------- Loop utama ----------
  loop() {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05); // clamp hanya untuk fisika; FPS diukur dari waktu nyata
    const t = this.clock.elapsedTime;
    if (this.started) {
      if (this.sleeping) {
        // Urutan tidur: jam dibekukan, interaksi + autosave dijeda — pemain
        // sedang tidur, dunia menunggu. Hewan/dunia visual tetap jalan.
        this._updateSleep(performance.now(), dt);
        this.animals.update(dt, t);
      } else {
        // Waktu berjalan; mentok 22:00 sampai tidur.
        if (this.state.minutes < DAY_END) {
          this.state.minutes = Math.min(DAY_END, this.state.minutes + MIN_PER_SEC * dt);
        }
        // Gerak mengikuti yaw kamera: putar vektor move sebesar yaw. yaw=0
        // identik dengan perilaku lama (maju=-Z, kanan=+X). Turunan: maju
        // layar = (-sin yaw, -cos yaw), kanan layar = (cos yaw, -sin yaw);
        // player.update memetakan (x, y) -> dunia (x, -y).
        const mv = this.input.moveVector();
        const yaw = this.input.orbit.yaw;
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        const rmv = { x: mv.x * cy - mv.y * sy, y: mv.x * sy + mv.y * cy, mag: mv.mag };
        // Buff jajanan (pasar malam) diterapkan ke pemain sebelum fisika gerak.
        this.player.buffs = this.buffs;
        if (this.nmRides.isRiding()) {
          // Naik wahana: tempel pemain ke kursi/kabin; player.update dilewati
          // supaya fisika jalan tidak melawan gerakan wahana.
          const rt = this.nmRides.getRiderTransform();
          if (rt) {
            this.player.x = rt.x;
            this.player.z = rt.z;
            this.player.vx = 0; this.player.vz = 0;
            this.player.yOff = Math.max(0, rt.y - this.player.groundAt(rt.x, rt.z));
            this.player.group.position.set(rt.x, rt.y, rt.z);
            this.player.group.rotation.y = rt.ry;
            this.player.facing = rt.ry;
          }
        } else {
          this.player.update(dt, rmv, this.world.colliders, this.input.running);
        }
        // Peti: dorong bila bersentuhan.
        const crate = this.crate;
        const dx = crate.x - this.player.x, dz = crate.z - this.player.z;
        if (Math.hypot(dx, dz) < crate.half + 0.7) {
          crate.pushFrom(this.player.x, this.player.z, this.player.vx, this.player.vz);
        }
        crate.update(dt, this.world.colliders);
        this.world.crate.position.set(crate.x, crate.y + 0.7, crate.z);
        this.world.crate.rotation.y += (Math.hypot(crate.vx, crate.vz) * dt) * 0.4;
        this.animals.update(dt, t);
        // COZY-D — NPC + Sosial: jadwal + gerak warga desa / pedagang.
        this.npc?.update(dt, this.state.minutes, this.state.day);
        // Pasar malam: game/wahana/jajanan + kirim posisi ke room (~10 Hz,
        // throttle internal di Multiplayer).
        this.nmGames.update(dt, t, this);
        this.nmFood.update(dt, t, this);
        this.nmRides.update(dt, t, this);
        this.invite?.update(dt);
        this.nmBots?.update(dt);
        if (this.mp.connected) this.mp.sendPosition(this.player.x, this.player.z, this.player.facing);
        if (this.nmRides.isRiding()) {
          // Naik wahana: tombol Aksi = Turun — selalu aktif, untuk SEMUA
          // wahana (duduk maupun kendaraan). Ini satu-satunya jalan keluar
          // sejak panel tengah layar dihapus (2026-11-23); input tidak
          // dikunci saat naik supaya tombol ini tetap bisa ditekan.
          const rid = this.nmRides.debug.state().riding;
          this._ctx = rid ? { type: 'nm', id: rid, label: i18nT('rideExit', this.state.lang) } : null;
          this.ui.setActionLabel(this._ctx ? this._ctx.label : '');
          this.ui.setHint('');
          // Desktop (tanpa sentuh): kontrol sentuh normalnya tersembunyi —
          // tampilkan HANYA tombol Aksi "Turun" supaya tetap ada jalan
          // keluar dengan mouse. (Dulu jalan keluar desktop adalah tombol
          // di panel tengah layar yang sudah dihapus.)
          if (this._touchControls && !this._isTouch) {
            this._touchControls.classList.remove('hidden');
            this._touchControls.classList.add('riding-exit');
          }
        } else {
          if (this._touchControls && !this._isTouch) {
            this._touchControls.classList.add('hidden');
            this._touchControls.classList.remove('riding-exit');
          }
          this.updateInteraction();
        }
        // Suara air: penuh di tepi sungai, memudar sampai hilang ~22 m.
        const dRiver = riverDistance(this.player.x, this.player.z);
        const wl = dRiver <= 0 ? 1 : 1 - smoothstep(3, 22, dRiver);
        if (Math.abs(wl - this._waterLevel) > 0.02) { this._waterLevel = wl; this.sfx.setWaterLevel(wl); }
        // Cipratan saat baru masuk air.
        const sw = this.player.swimming;
        if (sw && !this._wasSwimming) this.sfx.play('splash');
        this._wasSwimming = sw;
        // Autosave tiap 10 detik.
        this._saveTimer += dt;
        if (this._saveTimer > 10) { this._saveTimer = 0; this.save(); }
      }
      this.mp.update(dt); // lerp avatar pemain lain (no-op bila tidak di room)
      this._fpsCheck(rawDt);
      this.ui.updateHUD(this.state);
    }
    this.world.update(dt, this.state.minutes);
    // Pasar malam: animasi zona (lampu, kubah, wahana ambient) + badge.
    this.nightmarket.update(dt, t, this.player);
    const inNm = this.nightmarket.nightFactor > 0.5;
    if (this._nmBadge) this._nmBadge.classList.toggle('hidden', !inNm);
    this._inNightMarket = inNm;
    // Kamera: intro ~4 detik (posisi pembuka, orbit diabaikan), lalu orbit
    // third-person mengikuti pemain. Selama fase 'lying'/'dark' urutan tidur,
    // kamera scripted di dalam kamar; fase lain tidur = orbit biasa.
    const px = this.player.x, py = this.player.y, pz = this.player.z;
    // Bayangan pasar malam: matikan castShadow saat pemain jauh dari zona.
    // Bayangan jatuh di tanah dalam zona — dari >45 m tidak terlihat, tapi
    // pass bayangan tetap membayar tiap caster. Hysteresis 30/45 m dari tepi
    // rect supaya tidak flicker saat pemain mondar-mandir di batas. Skyline
    // zona (bianglala, gapura, stan) tetap terlihat: yang dimatikan hanya
    // bayangannya, bukan mesh-nya.
    const _nmDx = Math.max(NM_RECT.minX - px, 0, px - NM_RECT.maxX);
    const _nmDz = Math.max(NM_RECT.minZ - pz, 0, pz - NM_RECT.maxZ);
    const _nmD = Math.hypot(_nmDx, _nmDz);
    const _wantNmShadows = _nmD < 30 || (this._nmShadows && _nmD < 45);
    if (_wantNmShadows !== this._nmShadows) {
      this._nmShadows = _wantNmShadows;
      for (const m of this._nmCasters) m.castShadow = _wantNmShadows;
    }
    const intro = !this.sleeping && performance.now() < this._introUntil;
    const scripted = this.sleeping && (this.sleepPhase === 'lying' || this.sleepPhase === 'dark');
    let camTarget, desired;
    if (scripted) {
      const bed = this.world.bedroom.bed;
      const by = terrainHeight(bed.x, bed.z);
      camTarget = new THREE.Vector3(bed.x, by + 1.0, bed.z);
      desired = new THREE.Vector3(bed.x + 3.4, by + 2.4, bed.z + 4.1);
    } else if (intro) {
      camTarget = new THREE.Vector3(px - 3, py + 3, pz - 10);
      desired = new THREE.Vector3(px - 2, py + 13, pz + 20);
    } else {
      // COZY-B — start: kamera orbit halus + preset jalan/desa (tombol C).
      // Zoom/pitch yang diminta input (o.dist/o.pitch) TIDAK dipakai mentah —
      // _camDist/_camPitch mengikutinya dengan redaman eksponensial (~7/dtk)
      // supaya wheel/pinch/preset terasa halus, bukan lompat. Clamp yaw/pitch
      // tetap di input.js; clamp terrain tetap di bawah. Intro/tidur tidak
      // lewat cabang ini (scripted/intro di atas). Preset: C = village
      // (dist 16, pitch 0.65) <-> walk (dist 8, pitch 0.45); orbit bebas =
      // preset null sampai C ditekan pertama kali.
      if (this._cozyBKey !== true) {
        this._cozyBKey = true;
        this._camPreset = null;
        this._camDist = this.input.orbit.dist;
        this._camPitch = this.input.orbit.pitch;
        window.addEventListener('keydown', (e) => {
          if (e.repeat) return;
          if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
          if (e.key !== 'c' && e.key !== 'C') return;
          if (this.sleeping) return;
          this._camPreset = this._camPreset === 'village' ? 'walk' : 'village';
          const o2 = this.input.orbit;
          if (this._camPreset === 'village') { o2.dist = 16; o2.pitch = 0.65; }
          else { o2.dist = 8; o2.pitch = 0.45; }
        });
      }
      const o = this.input.orbit;
      const kCam = 1 - Math.exp(-dt * 7);
      this._camDist += (o.dist - this._camDist) * kCam;
      this._camPitch += (o.pitch - this._camPitch) * kCam;
      camTarget = new THREE.Vector3(px, py + 1.6, pz);
      const cp = Math.cos(this._camPitch), sp = Math.sin(this._camPitch);
      desired = new THREE.Vector3(
        px + this._camDist * Math.sin(o.yaw) * cp,
        py + 1.6 + this._camDist * sp,
        pz + this._camDist * Math.cos(o.yaw) * cp,
      );
      // Kamera tidak boleh masuk tanah: angkat ke terrain + 0.5 m.
      const minY = terrainHeight(desired.x, desired.z) + 0.5;
      if (desired.y < minY) desired.y = minY;
      // COZY-B — end
    }
    this.camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
    this.camera.lookAt(camTarget);
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- Interaksi kontekstual ----------
  updateInteraction() {
    const p = this.player;
    const plot = this.farm.nearestPlot(p.x, p.z);
    const animalIdx = this.animals.nearest(p.x, p.z);
    const nearDoor = Math.hypot(p.x - this.world.doorPos.x, p.z - this.world.doorPos.z) < 3.2;
    const nearShop = Math.hypot(p.x - this.world.shopPos.x, p.z - this.world.shopPos.z) < 3.2;
    const nearCrate = Math.hypot(p.x - this.crate.x, p.z - this.crate.z) < 2.2;
    const nearGate = Math.hypot(p.x - this.world.penGate.x, p.z - this.world.penGate.z) < 3;
    let ctx = null;
    if (plot) {
      const pl = this.state.plots[plot.iz * FARM_COLS + plot.ix];
      if (!pl.hoed && !pl.crop) ctx = { type: 'hoe', plot, label: t('actionHoe', this.state.lang) };
      else if (pl.hoed && !pl.crop) ctx = { type: 'plant', plot, label: t('actionPlant', this.state.lang) };
      // COZY-C: pupuk dulu bila ada tanaman belum dipupuk + pupuk tersedia
      // (sebelum siram — sekali per siklus; habis panen fert reset).
      else if (pl.crop && !pl.fert && !this.farm.isReady(pl) && (this.state.inv.fertiliser || 0) > 0) ctx = { type: 'fertilise', plot, label: t('actionFertilise', this.state.lang) };
      else if (pl.crop && !pl.watered && !this.farm.isReady(pl)) ctx = { type: 'water', plot, label: t('actionWater', this.state.lang) };
      else if (pl.crop && this.farm.isReady(pl)) ctx = { type: 'harvest', plot, label: t('actionHarvest', this.state.lang) };
    }
    if (!ctx && animalIdx >= 0) {
      const a = this.state.animals[animalIdx];
      if ((a.ready || 0) > 0) ctx = { type: 'collect', kind: a.kind, label: t('actionCollect', this.state.lang) };
      else if (!a.fed) ctx = { type: 'feed', kind: a.kind, label: t('actionFeed', this.state.lang) };
    }
    // COZY-C — start: pohon buah + mesin pengolah (setelah petak/hewan,
    // sebelum pintu/toko — posisinya tidak bertabrakan dengan keduanya).
    if (!ctx) {
      const treeIdx = this.farm.nearestTree(p.x, p.z);
      if (treeIdx >= 0) {
        const tr = this.state.trees[treeIdx];
        if (!tr.kind) ctx = { type: 'plantTree', tree: treeIdx, label: t('actionPlantTree', this.state.lang) };
        else if (this.farm.treeIsReady(treeIdx)) ctx = { type: 'harvestTree', tree: treeIdx, label: t('actionHarvestTree', this.state.lang) };
      }
    }
    if (!ctx && this.machine) {
      const dm = Math.hypot(p.x - this.machine.pos.x, p.z - this.machine.pos.z);
      if (dm < 3.2) ctx = { type: 'machine', label: t('actionMachine', this.state.lang) };
    }
    // COZY-C — end
    if (!ctx && nearDoor) ctx = { type: 'sleep', label: t('actionSleep', this.state.lang) };
    if (!ctx && nearShop) ctx = { type: 'shop', label: t('actionShop', this.state.lang) };
    if (!ctx && nearGate && this.animals.fedCount() < this.state.animals.length) {
      ctx = { type: 'feedAll', label: t('actionFeed', this.state.lang) };
    }
    if (!ctx && nearCrate) ctx = { type: 'push', label: t('actionPush', this.state.lang) };
    // COZY-D — NPC + Sosial: warga terdekat (r 2,8 m) — dicek sesudah
    // petak/hewan/rumah/toko, sebelum pasar malam (zona jauh, tidak bentrok).
    // COZY-F2: label dipendekkan jadi "Ngobrol" — "Ngobrol dengan Pak
    // Darman" meluber keluar tombol aksi bundar di 390px (koordinator
    // Wave-2); nama warga tetap terlihat di dialog yang terbuka.
    if (!ctx && this.npc) {
      const near = this.npc.nearestNpc(p.x, p.z, 2.8);
      if (near) ctx = { type: 'npc', id: near.def.id, label: t('npcTalk', this.state.lang) };
    }
    // Pasar malam: game berhadiah (r 3,2), jajanan (r 2,8), wahana (r board).
    // Dicek setelah ctx lama supaya petak/kandang/toko/dll tetap prioritas.
    if (!ctx && this.nmGames) {
      const nm = this.nmGames.interactables.find((it) => Math.hypot(p.x - it.x, p.z - it.z) < it.r);
      if (nm) ctx = { type: 'nmGame', id: nm.id, label: t(nm.labelKey, this.state.lang) };
    }
    if (!ctx && this.nmFood) {
      const fd = this.nmFood.interactables.find((it) => Math.hypot(p.x - it.x, p.z - it.z) < it.r);
      if (fd) ctx = { type: 'food', id: fd.id, label: t(fd.labelKey, this.state.lang) };
    }
    if (!ctx && this.nmRides) {
      const rd = this.nmRides.interactables.find((it) => Math.hypot(p.x - it.x, p.z - it.z) < it.r);
      if (rd) ctx = { type: 'nm', id: rd.id, label: t(rd.labelKey, this.state.lang) };
    }
    this._ctx = ctx;
    this.ui.setActionLabel(ctx ? ctx.label : '');
    this.ui.setHint(ctx ? '' : t('hintNearPlot', this.state.lang));
  }
  doAction() {
    if (!this.started || this.sleeping) return; // urutan tidur: aksi dikunci
    const ctx = this._ctx;
    if (!ctx) return;
    const lang = this.state.lang;
    switch (ctx.type) {
      case 'hoe':
        if (this.hoeAt(ctx.plot.ix, ctx.plot.iz)) { this.sfx.play('hoe'); this.ui.toast(t('hoed', lang)); }
        break;
      case 'plant':
        this._pendingCropPlot = ctx.plot;
        this.ui.openCropPicker(this.state, (crop) => this.plantChosen(crop));
        break;
      case 'water':
        if (this.waterAt(ctx.plot.ix, ctx.plot.iz)) { this.sfx.play('water'); this.ui.toast(t('watered', lang)); }
        break;
      case 'harvest': {
        const got = this.harvestAt(ctx.plot.ix, ctx.plot.iz);
        // COZY-C: harvestAt kini mengembalikan {crop, quality} — toast
        // menyebut kualitasnya (Bagus/Langka terbaca pemain).
        if (got) {
          this.sfx.play('harvest');
          const qk = got.quality === 'normal' ? 'harvested' : 'harvestedQuality';
          this.ui.toast(t(qk, lang, { item: itemName(got.crop, lang), q: t(`quality${got.quality === 'good' ? 'Good' : got.quality === 'rare' ? 'Rare' : 'Normal'}`, lang) }));
        }
        break;
      }
      // COZY-C — start: pupuk / pohon buah / mesin pengolah.
      case 'fertilise':
        if (this.fertiliseAt(ctx.plot.ix, ctx.plot.iz)) { this.sfx.play('plant'); this.ui.toast(t('fertilised', lang)); }
        else this.ui.toast(t('needFertiliser', lang));
        break;
      case 'plantTree':
        this._pendingTree = ctx.tree;
        this.ui.openTreePicker(this.state, (kind) => this.plantTreeChosen(kind));
        break;
      case 'harvestTree': {
        const got = this.harvestTree(ctx.tree);
        if (got) {
          this.sfx.play('harvest');
          this.ui.toast(t('harvestedTree', lang, { n: got.count, item: itemName(got.kind, lang) }));
        }
        break;
      }
      case 'machine':
        this.ui.openCraft(this.state);
        break;
      // COZY-C — end
      case 'feed': {
        const r = this.feedAnimal(ctx.kind);
        if (r.ok) { this.sfx.play('animal'); this.ui.toast(t('fed', lang)); }
        else this.ui.toast(t('needCoins', lang));
        break;
      }
      case 'feedAll': {
        const n = this.animals.feedAll(this.state);
        if (n > 0) { this.sfx.play('animal'); this.ui.toast(t('fed', lang)); this.save(); }
        else this.ui.toast(t('needCoins', lang));
        break;
      }
      case 'collect': {
        const n = this.collectAnimal(ctx.kind);
        if (n > 0) { this.sfx.play('coin'); this.ui.toast(t('collected', lang, { n, item: ANIMAL_DEFS[ctx.kind].produceName })); }
        else this.ui.toast(t('nothingToCollect', lang));
        break;
      }
      case 'sleep': this.ui.openSleep(); break;
      case 'shop': this.ui.openShop('buy', this.state); break;
      case 'push': this.ui.toast(t('actionPush', lang)); break;
      // COZY-D — NPC + Sosial: buka dialog warga (sapaan Lane A di npc.js).
      case 'npc': this.ui.openDialogue(ctx.id); break;
      case 'nmGame': this.nmGames.onUse(ctx.id, this); break;
      case 'nm': this.nmRides.onUse(ctx.id, this); break;
      case 'food': this.nmFood.onUse(ctx.id, this); break;
      default: break;
    }
    this.ui.updateHUD(this.state);
  }
  plantChosen(cropId) {
    const plot = this._pendingCropPlot;
    this._pendingCropPlot = null;
    if (!plot) return false;
    if ((this.state.inv[CROPS[cropId].seedKey] || 0) < 1) {
      this.ui.toast(t('needSeeds', this.state.lang));
      return false;
    }
    if (this.plantAt(plot.ix, plot.iz, cropId)) {
      this.sfx.play('plant');
      this.ui.toast(t('planted', this.state.lang));
      this.save();
      return true;
    }
    return false;
  }
  // COZY-C — start: tanam bibit pohon di titik yang dipilih (dari picker).
  plantTreeChosen(kind) {
    const idx = this._pendingTree;
    this._pendingTree = null;
    if (idx === undefined || idx === null) return false;
    const key = kind === 'apple' ? 'appleSapling' : kind === 'orange' ? 'orangeSapling' : null;
    if (!key || (this.state.inv[key] || 0) < 1) {
      this.ui.toast(t('needSapling', this.state.lang));
      return false;
    }
    if (this.farm.plantTree(idx, kind, this.state.inv)) {
      this.sfx.play('plant');
      this.ui.toast(t('treePlanted', this.state.lang, { item: itemName(kind, this.state.lang) }));
      this.save();
      return true;
    }
    return false;
  }
  // COZY-C — end

  // ---------- Akun + sinkronisasi cloud ----------
  // Aturan sinkronisasi (lengkap di README):
  //  - localStorage = cache/fallback offline; backend = sumber kebenaran.
  //  - Boot/login: server lebih baru -> pakai server; lokal lebih baru (main
  //    offline) -> upload lokal; updatedAt sama -> server menang.
  //  - Tombol Muat manual: server SELALU menang.
  //  - Gagal jaringan -> tandai pending, coba lagi di save berikut / online.
  applySaveData(d) {
    if (!d) return false;
    const lang = this.state.lang;
    this.state.coins = d.coins ?? this.state.coins;
    this.state.day = d.day ?? this.state.day;
    this.state.minutes = d.minutes ?? this.state.minutes;
    this.state.lang = d.lang || this.state.lang;
    this.state.gender = d.gender || this.state.gender;
    this.state.sound = d.sound !== false;
    this.state.quality = d.quality || this.state.quality;
    this.state.custom = sanitizeCustom(d.custom, this.state.gender);
    this.state.username = d.username || this.state.username;
    this.state.updatedAt = d.updatedAt || d.savedAt || 0;
    this.state.inv = { ...this.state.inv, ...(d.inv || {}) };
    // COZY-C — start: field ekonomi baru dari cloud (absen = default lama).
    this.state.invQ = sanitizeInvQ(d.invQ || {}, this.state.inv);
    if (Array.isArray(d.trees)) {
      this.state.trees.splice(0, this.state.trees.length, ...sanitizeTrees(d.trees));
      this.farm.refreshTrees();
    }
    if (typeof d.machineCooldown === 'number') this.state.machineCooldown = d.machineCooldown;
    // COZY-C — end
    // COZY-D — NPC + Sosial: pulihkan dari save cloud (aditif, save lama
    // tanpa field ini = tetap kosong; NpcManager mengisi default bila null).
    if (d.npcFriendship && typeof d.npcFriendship === 'object') this.state.npcFriendship = d.npcFriendship;
    if (d.npcGiftedDay && typeof d.npcGiftedDay === 'object') this.state.npcGiftedDay = d.npcGiftedDay;
    if (d.npcChatDay && typeof d.npcChatDay === 'object') this.state.npcChatDay = d.npcChatDay;
    if (d.npcMet && typeof d.npcMet === 'object') this.state.npcMet = d.npcMet;
    if (d.npcQuests && Array.isArray(d.npcQuests.daily)) this.state.npcQuests = d.npcQuests;
    if (d.npcFestival && typeof d.npcFestival === 'object') this.state.npcFestival = d.npcFestival;
    // COZY-F2 — v3: pulihkan musim + field yang dulu TIDAK PERNAH
    // dipulihkan dari cloud (discoveredSpots, mp*). Guard "hadir di
    // payload" penting: save server lama (pra-v3) tidak membawa field ini
    // — tanpa guard, load cloud akan MENGHAPUS progres lokal.
    if (['spring', 'summer', 'autumn', 'winter'].includes(d.season)) {
      this.state.season = d.season;
      this.world?.setSeason?.(d.season);
    }
    if (Array.isArray(d.discoveredSpots)) {
      this.state.discoveredSpots = d.discoveredSpots.filter((s) => typeof s === 'string');
    }
    if (d.mpVisits && typeof d.mpVisits === 'object' && !Array.isArray(d.mpVisits)) this.state.mpVisits = d.mpVisits;
    if (Array.isArray(d.mpTrades)) this.state.mpTrades = d.mpTrades.slice(0, 20);
    if (Number.isInteger(d.mpMinigameBest) && d.mpMinigameBest >= 0) this.state.mpMinigameBest = d.mpMinigameBest;
    this.npc?._ensureState();
    if (Array.isArray(d.plots) && d.plots.length === this.state.plots.length) {
      this.state.plots.splice(0, this.state.plots.length, ...d.plots);
      this.farm.refreshAll();
    }
    if (Array.isArray(d.animals) && d.animals.length === this.state.animals.length) {
      this.state.animals.splice(0, this.state.animals.length, ...d.animals);
    }
    if (d.player) this.player.teleport(d.player.x ?? 6, d.player.z ?? 20);
    if (this.player.gender !== this.state.gender) this.player.setGender(this.scene, this.state.gender);
    this.player.applyCustomization(this.scene, this.state.custom);
    this.sfx.enabled = this.state.sound;
    this.applyQuality(this.state.quality);
    this.ui.setLang(this.state.lang);
    this.ui.updateHUD(this.state);
    this.save();
    void lang;
    return true;
  }

  // COZY-F2 — perbaikan bug sync perangkat segar (Lane E §7.1).
  // DUA lapis pertahanan:
  //   (1) Perangkat segar (TANPA save lokal) + save server ADA = server
  //       SELALU menang, tanpa membandingkan updatedAt. Alasannya:
  //       save lokal segar hanyalah default (koin 50, hari 1) — tidak ada
  //       progres yang perlu dilindungi; membandingkan timestamp di sini
  //       salah karena init() lama men-stamp localAt = waktu boot (selalu
  //       > remoteAt) dan cabang localAt > remoteAt mengunggah kekosongan.
  //   (2) PUT-vs-GET race: cloudSync() MENUNGGU janji sync boot selesai
  //       (maks 10 dtk) sebelum PUT apa pun; scheduleCloudSync() menunda
  //       timer sampai sync boot selesai. Jadi tidak ada PUT yang bisa
  //       menyalip GET sinkronisasi awal — baik dari autosave 10 dtk,
  //       debounce 1,5 dtk, maupun klik Simpan/Mulai.
  // Jalur normal TIDAK berubah: save lokal ada + server lebih baru =
  // server menang; lokal lebih baru = upload; tidak ada save server +
  // ada save lokal = upload; offline = pending seperti biasa.
  async syncFromCloudOnBoot() {
    try {
      const res = await cloudGetSave();
      if (!res || !res.save) {
        // Akun baru / belum ada save server: unggah save lokal bila ada progress.
        if (this._hadSave) await this._cloudPutNow();
        return;
      }
      const remoteAt = res.save.updatedAt || res.save.savedAt || res.updatedAt || 0;
      const localAt = this.state.updatedAt || 0;
      if (!this._hadSave || remoteAt > localAt) {
        this.applySaveData(res.save);
        this.ui.toast(t('serverNewer', this.state.lang));
      } else if (localAt > remoteAt) {
        // PUT langsung (bukan cloudSync): sync boot sedang BERJALAN di
        // sini, jadi menunggu janji-nya sendiri = deadlock 10 dtk.
        await this._cloudPutNow();
        this.ui.toast(t('localUploaded', this.state.lang));
      }
      // Sama -> server menang, tapi isinya identik jadi tidak ada yang diubah.
    } catch (e) {
      // Offline / server belum deploy: lanjut dengan save lokal, tandai pending.
      markPending();
    } finally {
      this._bootSyncDone = true;
      if (this._bootSyncFlush) {
        this._bootSyncFlush = false;
        this.scheduleCloudSync();
      }
    }
  }

  scheduleCloudSync() {
    if (!this.session) return;
    // COZY-F2: jangan jadwalkan PUT sebelum sync boot selesai — timer
    // ditunda ke finally syncFromCloudOnBoot (lihat _bootSyncFlush).
    if (this.session && !this._bootSyncDone) { this._bootSyncFlush = true; return; }
    clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => this.cloudSync(), 1500);
  }

  async cloudSync() {
    if (!this.session) return false;
    // COZY-F2: tunggu sinkronisasi boot selesai dulu (maks 10 dtk) —
    // PUT tidak boleh menyalip GET awal. Bila tidak ada sesi boot sync
    // (mis. login sesudah boot), janji null dan tidak ada yang ditunggu.
    if (this._bootSyncPromise) {
      try {
        await Promise.race([
          this._bootSyncPromise,
          new Promise((r) => setTimeout(r, 10000)),
        ]);
      } catch (e) { /* sync boot gagal -> lanjut; PUT akan ditandai pending bila gagal */ }
    }
    return this._cloudPutNow();
  }

  // PUT save ke server (tanpa menunggu sync boot — dipakai cloudSync()
  // sesudah menunggu, dan syncFromCloudOnBoot() yang sedang berjalan).
  async _cloudPutNow() {
    if (!this.session) return false;
    // Bila ada sync yang sedang berjalan, TUNGGU selesai lalu sync ulang —
    // jangan langsung gagal (klik Simpan 2x cepat tidak boleh lapor "offline").
    let waited = 0;
    while (this._cloudBusy && waited < 10000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }
    if (this._cloudBusy) return false;
    this._cloudBusy = true;
    try {
      const data = buildSaveData({ ...this.state, playerX: this.player.x, playerZ: this.player.z });
      await cloudPutSave(data);
      this.state.updatedAt = data.updatedAt;
      clearPending();
      return true;
    } catch (e) {
      markPending();
      return false;
    } finally {
      this._cloudBusy = false;
    }
  }

  async saveNow() {
    this.save();
    if (!this.session) {
      this.ui.toast(t(this.offlineMode ? 'savedLocal' : 'needLogin', this.state.lang), 4000);
      return;
    }
    // Konfirmasi langsung terlihat saat klik (toast hasil menyusul sesudah sync).
    this.ui.toast(t('saving', this.state.lang), 4000);
    const ok = await this.cloudSync();
    this.ui.toast(t(ok ? 'savedCloud' : 'savedLocal', this.state.lang), 4000);
  }

  async loadNow() {
    if (!this.session) {
      this.ui.toast(t('needLogin', this.state.lang));
      return;
    }
    try {
      const res = await cloudGetSave();
      if (!res || !res.save) {
        this.ui.toast(t('noServerSave', this.state.lang));
        return;
      }
      this.applySaveData(res.save);
      this.ui.toast(t('loadedCloud', this.state.lang));
    } catch (e) {
      this.ui.toast(t('loadFailed', this.state.lang));
    }
  }

  async deleteServerSave() {
    if (!this.session) {
      this.ui.toast(t('needLogin', this.state.lang));
      return;
    }
    try {
      await cloudDeleteSave();
      this.ui.toast(t('serverSaveDeleted', this.state.lang));
    } catch (e) {
      this.ui.toast(t('loadFailed', this.state.lang));
    }
  }

  clearAllSave() {
    const doReload = () => {
      this.ui.toast(t('saveCleared', this.state.lang));
      setTimeout(() => location.reload(), 900);
    };
    // COZY-F2: batalkan PUT terjadwal — tanpanya PUT save lama bisa jalan
    // SESUDAH cloudDeleteSave() dan menghidupkan kembali save server
    // yang baru saja dihapus (balapan hapus-vs-unggah).
    clearTimeout(this._cloudTimer);
    clearSave();
    clearPending();
    if (this.session) {
      cloudDeleteSave().catch(() => {}).finally(doReload);
    } else doReload();
  }

  applyCustom(custom, gender) {
    if (gender && gender !== this.state.gender) {
      this.state.gender = gender;
      this.player.setGender(this.scene, gender);
    }
    this.state.custom = sanitizeCustom(custom, this.state.gender);
    this.player.applyCustomization(this.scene, this.state.custom);
    this.save();
  }

  enterOfflineMode() {
    this.offlineMode = true;
    this.ui.setAuthState(null);
    this.ui.showStart(t('offlineNote', this.state.lang));
    this.ui.toast(t('offlineNote', this.state.lang));
  }

  async handleAuth(mode, username, pin, pinConfirm) {
    const lang = this.state.lang;
    this.ui.setAuthError('');
    const u = normalizeUsername(username);
    if (!validateUsername(u)) { this.ui.setAuthError(t('invalidUsername', lang)); return; }
    if (!validatePin(pin)) { this.ui.setAuthError(t('invalidPin', lang)); return; }
    if (mode === 'register' && pin !== pinConfirm) {
      this.ui.setAuthError(t('pinMismatch', lang));
      return;
    }
    this.ui.setAuthBusy(true);
    try {
      // PIN hanya dikirim di request ini (HTTPS); tidak pernah disimpan/di-log.
      const res = mode === 'register' ? await cloudRegister(u, pin) : await cloudLogin(u, pin);
      this.session = getSession() || res;
      if (res && res.token) setSession(res);
      this.state.username = u;
      this.offlineMode = false;
      this.ui.setAuthState(u);
      this.ui.toast(t(mode === 'register' ? 'registerOk' : 'loginOk', lang, { u }));
      // COZY-F2: register mengembalikan kode pemulihan — tampilkan SEKALI
      // (modal). Tanpa ini pemain baru tidak pernah tahu kodenya.
      if (mode === 'register' && res && res.recoveryCode) this.ui.showRecoveryCode(res.recoveryCode);
      // Samakan save lokal/server untuk akun ini. Simpan janjinya di
      // _bootSyncPromise + reset flag-nya supaya save() yang terjadi
      // selama login (mis. klik Mulai) menunggu sync ini selesai dulu
      // (PUT-vs-GET race yang sama seperti boot; lihat cloudSync()).
      this._bootSyncDone = false;
      this._bootSyncPromise = this.syncFromCloudOnBoot();
      await this._bootSyncPromise;
      this.save();
    } catch (e) {
      const status = e && e.status;
      if (status === 409) this.ui.setAuthError(t('usernameTaken', lang));
      else if (status === 429) this.ui.setAuthError(t('lockedOut', lang));
      else if (status === 401) this.ui.setAuthError(t('loginFailed', lang));
      else if (e && e.message === 'invalid_username') this.ui.setAuthError(t('invalidUsername', lang));
      else if (e && e.message === 'invalid_pin') this.ui.setAuthError(t('invalidPin', lang));
      else this.ui.setAuthError((e && e.message) || t('loginFailed', lang));
    } finally {
      this.ui.setAuthBusy(false);
    }
  }

  // COZY-F2 — pemulihan akun: kode pemulihan + PIN baru.
  // Sukses = login otomatis dengan PIN baru (sesi baru dari server) +
  // kode pemulihan BARU ditampilkan sekali (rotasi — kode lama hangus).
  // Gagal = pesan generik server (tidak membedakan user/kode salah).
  async handleRecover(username, code, pin, pinConfirm) {
    const lang = this.state.lang;
    this.ui.setRecoveryError('');
    const u = normalizeUsername(username);
    if (!validateUsername(u)) { this.ui.setRecoveryError(t('invalidUsername', lang)); return; }
    if (!validatePin(pin)) { this.ui.setRecoveryError(t('invalidPin', lang)); return; }
    if (pin !== pinConfirm) { this.ui.setRecoveryError(t('pinMismatch', lang)); return; }
    this.ui.setRecoveryBusy(true);
    try {
      const res = await cloudRecover(u, code, pin);
      this.session = getSession() || res;
      if (res && res.token) setSession(res);
      this.state.username = u;
      this.offlineMode = false;
      this.ui.setAuthState(u);
      this.ui.showRecoveryForm(false);
      this.ui.toast(t('recoveryOk', lang, { u }));
      if (res && res.recoveryCode) this.ui.showRecoveryCode(res.recoveryCode);
      // Samakan save seperti login (janji disimpan supaya save selama
      // sync menunggu — lihat handleAuth).
      this._bootSyncDone = false;
      this._bootSyncPromise = this.syncFromCloudOnBoot();
      await this._bootSyncPromise;
      this.save();
    } catch (e) {
      const status = e && e.status;
      if (status === 429) this.ui.setRecoveryError(t('lockedOut', lang));
      else if (status === 401) this.ui.setRecoveryError(t('recoveryFailed', lang));
      else this.ui.setRecoveryError((e && e.message) || t('recoveryFailed', lang));
    } finally {
      this.ui.setRecoveryBusy(false);
    }
  }

  // COZY-F2 — terbitkan kode pemulihan baru saat sudah login (akun lama
  // pra-v3 yang belum punya kode, atau kode hilang). Kode lama langsung
  // hangus begitu kode baru diterbitkan.
  async handleShowRecoveryCode() {
    if (!this.session) { this.ui.toast(t('needLogin', this.state.lang)); return; }
    try {
      const res = await cloudIssueRecoveryCode();
      if (res && res.recoveryCode) this.ui.showRecoveryCode(res.recoveryCode);
      else this.ui.toast(t('loadFailed', this.state.lang));
    } catch (e) {
      this.ui.toast(t('loadFailed', this.state.lang));
    }
  }

  async handleLogout() {
    this.save();
    // COZY-F2: batalkan PUT cloud yang dijadwalkan save() di atas — sesudah
    // logout token sesi dicabut server; PUT yang telanjur jalan akan 401
    // (dan menandai pending tanpa guna). Urutan penting: clearTimeout
    // SESUDAH save(), karena save() sendiri menjadwalkan PUT baru.
    clearTimeout(this._cloudTimer);
    try { await cloudLogout(); } catch (e) { /* abaikan */ }
    clearSession();
    this.session = null;
    this.state.username = null;
    setTimeout(() => location.reload(), 300);
  }

  // ---------- API inti (dipakai UI + hook uji window.__LH.api) ----------
  hoeAt(ix, iz) { const ok = this.farm.hoeAt(ix, iz); if (ok) this.save(); return ok; }
  plantAt(ix, iz, crop) { const ok = this.farm.plantAt(ix, iz, crop, this.state.inv); if (ok) this.save(); return ok; }
  waterAt(ix, iz) { const ok = this.farm.waterAt(ix, iz); if (ok) this.save(); return ok; }
  harvestAt(ix, iz) {
    // COZY-C: mengembalikan {crop, quality} (bukan lagi string crop saja);
    // kualitas dicatat di state.invQ supaya harga jual ikut kualitas.
    const got = this.farm.harvestAt(ix, iz, this.state.inv, this.state.invQ);
    if (got) {
      // COZY-D — NPC + Sosial: progres quest panen (harian/mingguan/festival).
      this.npc?.onHarvest(1);
      this.save();
    }
    return got || false;
  }
  // COZY-C — start: pupuk + pohon buah (API inti, dipakai UI + __LH_GAME).
  fertiliseAt(ix, iz) {
    const ok = this.farm.fertiliseAt(ix, iz, this.state.inv);
    if (ok) this.save();
    return ok;
  }
  harvestTree(i) {
    const got = this.farm.harvestTree(i, this.state.inv, this.state.invQ);
    if (got) this.save();
    return got || false;
  }
  plantTree(i, kind) {
    const ok = this.farm.plantTree(i, kind, this.state.inv);
    if (ok) this.save();
    return ok;
  }
  buySapling(kind) {
    const s = SAPLINGS[kind];
    if (!s) return false;
    return this.buyItem(s.seedKey, s.price, s.name);
  }
  buyFertiliser() { return this.buyItem('fertiliser', FERTILISER.price, FERTILISER.name); }
  // Olah di mesin pengolah: instan, cooldown 15 detik nyata per mesin
  // (state.machineCooldown = epoch ms kapan mesin siap lagi; tersimpan di
  // save supaya reload tidak me-reset cooldown). Bahan diambil kualitas
  // terbaik dulu; bonus hasil dari bahan bagus/langka (economy.craftBonus).
  craft(recipeId) {
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return { ok: false, reason: 'recipe' };
    const now = Date.now();
    if (now < this.state.machineCooldown) {
      return { ok: false, reason: 'cooldown', readyInMs: this.state.machineCooldown - now };
    }
    for (const [item, n] of Object.entries(recipe.inputs)) {
      if ((this.state.inv[item] || 0) < n) return { ok: false, reason: 'inputs' };
    }
    let bonus = 0;
    for (const [item, n] of Object.entries(recipe.inputs)) {
      const took = takeUnit(this.state.inv, this.state.invQ, item, n);
      bonus += craftBonus(took.quality);
    }
    const outId = Object.keys(recipe.output)[0];
    const outN = recipe.output[outId] + bonus;
    this.state.inv[outId] = (this.state.inv[outId] || 0) + outN;
    this.state.machineCooldown = now + MACHINE_COOLDOWN_MS;
    this.sfx.play('coin');
    this.ui.toast(t('craftMade', this.state.lang, { n: outN, item: itemName(outId, this.state.lang) }));
    this.ui.refreshCraft(this.state);
    this.ui.updateHUD(this.state);
    this.save();
    return { ok: true, output: { [outId]: outN }, bonus };
  }
  // Permintaan pasar hari ini (deterministik dari hari — tanpa simpan).
  demandToday() { return demandFor(this.state.day); }
  // COZY-C — end
  // ---------- Urutan tidur sinematik (~10 detik) ----------
  // Fase (semua timing dari wall-clock performance.now(), BUKAN akumulasi dt
  // — rAF berhenti saat tab hidden, jadi urutan tidak pernah softlock):
  //   walk-in (auto-jalan ke pintu → masuk) → lying (berbaring di kasur,
  //   kamera masuk kamar) → dark (fade gelap + hari berganti) → morning
  //   (fade terang + bangun + jalan keluar). Safety: >25 detik dipaksa selesai.
  sleep() {
    if (!this.started || this.sleeping) return false;
    this.input.locked = true;
    this.sleeping = true;
    document.body.classList.add('sleeping'); // HUD + kontrol sentuh disembunyikan selama adegan
    this.ui.setActionLabel('');
    this.ui.setHint('');
    this._sleep = {
      t0: performance.now(),
      phase: null, phaseT0: 0,
      advanced: false,          // advanceDay() sudah jalan atau belum
      waypoints: [this.world.doorPos, this.world.bedroom.doorIn],
      wpIndex: 0,
    };
    this._setSleepPhase('walk-in');
    return true;
  }
  _setSleepPhase(phase, now = performance.now()) {
    const s = this._sleep;
    if (!s) return;
    s.phase = phase;
    s.phaseT0 = now;
    this.sleepPhase = phase;
    if (phase === 'lying') {
      // Posisikan di kasur: kepala (ke utara) jatuh di bantal — pemain di
      // z = bed.z + 1.0, bukan di tengah kasur.
      const bed = this.world.bedroom.bed;
      this.world.bedroom.show(true);
      this.player.teleport(bed.x, bed.z + 1.0);
      this.player.setLying(true);
    } else if (phase === 'dark') {
      this.ui.setSleepFade(true);
      this.sfx.play('sleep');
    } else if (phase === 'morning') {
      // Pop interior tertutup kegelapan: atap/dinding kembali sebelum terang.
      this.world.bedroom.show(false);
      this.player.setLying(false);
      this.ui.setSleepFade(false);
      s.waypoints = [this.world.bedroom.doorIn, this.world.doorPos];
      s.wpIndex = 0;
    }
  }
  // Logika ganti hari (dulu isi sleep() instan): dipanggil SEKALI di tengah
  // urutan, saat layar gelap. Toast 'morning' tetap muncul — di akhir urutan.
  advanceDay() {
    const grown = this.farm.plots.filter((p) => p.crop && p.watered).length;
    this.farm.growDay();
    const prod = this.animals.produceMorning();
    this.state.day += 1;
    this.state.minutes = DAY_START;
    // COZY-D — NPC + Sosial: reset quest harian/mingguan di hari baru.
    this.npc?.onNewDay(this.state.day);
    this.save();
    this.ui.updateHUD(this.state);
    return { day: this.state.day, grown, eggs: prod.eggs, milk: prod.milk };
  }
  // Jalan otomatis menuju (tx, tz) dengan vektor sintetis. Colliders kosong
  // supaya pemain bisa melewati pintu (dinding rumah = collider).
  // player.update memetakan (x, y) -> dunia (x, -y) TANPA rotasi yaw — jadi
  // arah dunia diteruskan langsung: x = wx, y = -wz. (Versi lama memutar
  // vektor sebesar yaw orbit — padahal player.update tidak menerapkan
  // rotasi itu — sehingga pada yaw != 0 kecepatan jalan terotasi sebesar
  // yaw: yaw ~90° pemain mengorbit pintu, yaw 180° pemain jalan MENJAUH
  // dari pintu. Terukur headless: yaw=1.2 sudut gerak 51° dari target,
  // yaw=PI sudut 180°, jarak ke pintu 3.12 -> 6.05 m.)
  // mag mengecil saat mendekat supaya tidak overshoot melewati waypoint.
  _autoWalkToward(tx, tz, dt) {
    const dx = tx - this.player.x, dz = tz - this.player.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.player.update(dt, { x: 0, y: 0, mag: 0 }, [], false); return d; }
    const wx = dx / d, wz = dz / d; // arah dunia ternormalisasi
    const mag = Math.max(0.3, Math.min(1, d / 1.5));
    this.player.update(dt, { x: wx, y: -wz, mag }, [], false);
    return d;
  }
  _updateSleep(now, dt) {
    const s = this._sleep;
    if (!s) return;
    const total = now - s.t0;
    const inPhase = now - s.phaseT0;
    // Safety absolut: apa pun yang terjadi, urutan selesai <25 detik.
    if (total > 25000) { this._finishSleep(); return; }
    switch (s.phase) {
      case 'walk-in': {
        const wp = s.waypoints[s.wpIndex];
        const d = this._autoWalkToward(wp.x, wp.z, dt);
        if (d < 0.5) {
          s.wpIndex += 1;
          if (s.wpIndex >= s.waypoints.length) this._setSleepPhase('lying', now);
        } else if (inPhase > 6000) {
          // Macet (mis. terjebak geometri): teleport ke dalam sebagai fallback.
          const di = this.world.bedroom.doorIn;
          this.player.teleport(di.x, di.z);
          this._setSleepPhase('lying', now);
        }
        break;
      }
      case 'lying': {
        // Tetap panggil update supaya blend berbaring + napas berjalan.
        this.player.update(dt, { x: 0, y: 0, mag: 0 }, [], false);
        if (inPhase > 3000) this._setSleepPhase('dark', now);
        break;
      }
      case 'dark': {
        this.player.update(dt, { x: 0, y: 0, mag: 0 }, [], false);
        // Hari berganti saat layar sudah gelap (fade 1.2 dtk).
        if (!s.advanced && inPhase > 1300) {
          s.advanced = true;
          this.advanceDay();
        }
        if (inPhase > 2600) this._setSleepPhase('morning', now);
        break;
      }
      case 'morning': {
        const wp = s.waypoints[s.wpIndex];
        const d = this._autoWalkToward(wp.x, wp.z, dt);
        if (d < 0.5) {
          s.wpIndex += 1;
          if (s.wpIndex >= s.waypoints.length) { this._finishSleep(); return; }
        } else if (inPhase > 6000) {
          const dp = this.world.doorPos;
          this.player.teleport(dp.x, dp.z);
          this._finishSleep(); return;
        }
        break;
      }
      default: break;
    }
  }
  _finishSleep() {
    const s = this._sleep;
    // Bila safety timeout memotong sebelum 'dark', hari tetap berganti.
    if (s && !s.advanced) { s.advanced = true; this.advanceDay(); }
    this.player.setLying(false);
    this.world.bedroom.show(false);
    this.ui.setSleepFade(false);
    this.input.locked = false;
    this.sleeping = false;
    document.body.classList.remove('sleeping');
    this.sleepPhase = null;
    this._sleep = null;
    this.save(); // posisi akhir (di luar pintu) ikut tersimpan
    // COZY-C: toast pagi menyebut permintaan pasar hari ini (rotasi harian).
    const dmd = demandFor(this.state.day);
    const wantedNames = dmd.wanted.map((id) => itemName(id, this.state.lang)).join(' • ');
    this.ui.toast(`${t('morning', this.state.lang, { d: this.state.day })} ${t('marketToday', this.state.lang, { items: wantedNames })}`);
    this.ui.updateHUD(this.state);
  }
  teleport(x, z) { this.player.teleport(x, z); return true; }
  addCoins(n) { this.state.coins = Math.max(0, this.state.coins + n); this.save(); return this.state.coins; }
  setLang(lang) {
    if (lang !== 'id' && lang !== 'en') return false;
    this.state.lang = lang;
    this.ui.setLang(lang);
    this.ui.updateHUD(this.state);
    this.save();
    return true;
  }
  feedAnimal(kind) {
    if (!ANIMAL_DEFS[kind]) return { ok: false, reason: 'kind' };
    const r = this.animals.feedAnimal(kind, this.state);
    if (r.ok) {
      // COZY-D — NPC + Sosial: progres quest beri makan harian.
      this.npc?.onFeed(1);
      this.save();
    }
    return r;
  }
  // COZY-D — NPC + Sosial: hadiah / belanja pedagang / daftar hadiah.
  // (Logika inti di npc.js; di sini hanya toast + refresh HUD.)
  npcGiveGift(id, item) {
    const r = this.npc.giveGift(id, item);
    if (r.ok) {
      const name = this.npc.npcById(id)?.def.name || id;
      this.sfx.play('coin');
      this.ui.toast(t(r.liked ? 'npcGiftLiked' : 'npcGiftOk', this.state.lang, { name, n: r.gain }));
    } else if (r.reason === 'none') this.ui.toast(t('npcGiftNone', this.state.lang));
    else if (r.reason === 'already') this.ui.toast(t('npcGiftAlready', this.state.lang, { name: this.npc.npcById(id)?.def.name || id }));
    return r;
  }
  npcBuyFromMerchant(key) {
    const r = this.npc.buyFromMerchant(key);
    if (r.ok) {
      this.sfx.play('coin');
      this.ui.toast(t('npcBuyOk', this.state.lang, { item: key }));
    } else if (r.reason === 'coins') this.ui.toast(t('needCoins', this.state.lang));
    return r;
  }
  npcGiftables() {
    const inv = this.state.inv;
    return ['carrot', 'tomato', 'pumpkin', 'egg', 'milk', 'goldenEgg']
      .map((k) => ({ key: k, owned: inv[k] || 0 }))
      .filter((g) => g.owned > 0);
  }
  // COZY-D — end
  collectAnimal(kind) {
    if (!ANIMAL_DEFS[kind]) return 0;
    const n = this.animals.collectAnimal(kind, this.state.inv);
    // COZY-C: hasil ternak ikut roll kualitas (tanah subur tetap, tanpa
    // pupuk) supaya telur/susu bagus/langka ikut dihargai pasar.
    if (n > 0) {
      const produce = ANIMAL_DEFS[kind].produce;
      for (let i = 0; i < n; i++) addQuality(this.state.invQ, produce, rollQuality(Math.random(), 80, false), 1);
      this.save();
    }
    return n;
  }
  buySeed(cropId) {
    const crop = CROPS[cropId];
    if (!crop) return false;
    return this.buyItem(crop.seedKey, crop.seed, crop.name);
  }
  buyFeed() { return this.buyItem('feed', 2, t('feed', this.state.lang)); }
  buyItem(key, price, name) {
    if (this.state.coins < price) { this.sfx.play('error'); this.ui.toast(t('needCoins', this.state.lang)); return false; }
    this.state.coins -= price;
    this.state.inv[key] = (this.state.inv[key] || 0) + 1;
    this.sfx.play('coin');
    this.ui.toast(t('bought', this.state.lang, { item: name }));
    this.ui.refreshShop(this.state);
    this.ui.updateHUD(this.state);
    this.save();
    return true;
  }
  sellItem(key, price, name) {
    // COZY-C: harga TIDAK lagi diambil dari parameter UI (p) — dihitung
    // ulang dari economy.js (dasar × kualitas unit terbaik × permintaan
    // hari ini) supaya toko, sellAll, dan panel pasar selalu sama.
    if ((this.state.inv[key] || 0) < 1) return false;
    const q = bestUnit(this.state.inv, this.state.invQ, key);
    const actual = sellPrice(key, q, this.state.day);
    takeUnit(this.state.inv, this.state.invQ, key, 1);
    this.state.coins += actual;
    this.sfx.play('coin');
    this.ui.toast(t('sold', this.state.lang, { n: actual }));
    this.ui.refreshShop(this.state);
    this.ui.updateHUD(this.state);
    this.save();
    return true;
  }
  sellAll() {
    // COZY-C: harga hardcoded lama ({carrot:12, ...}) DIGANTI economy.js —
    // computeSellAll menghitung dasar × kualitas × permintaan per unit,
    // termasuk barang baru (gandum/stroberi/buah/olahan).
    const res = computeSellAll(this.state.inv, this.state.invQ, this.state.day);
    for (const line of res.lines) {
      this.state.inv[line.id] = 0;
      if (this.state.invQ[line.id]) delete this.state.invQ[line.id];
    }
    if (res.earned > 0) {
      this.state.coins += res.earned;
      this.sfx.play('coin');
      this.ui.toast(t('sold', this.state.lang, { n: res.earned }));
      this.ui.updateHUD(this.state);
      this.save();
    }
    return { earned: res.earned, count: res.count, coins: this.state.coins };
  }
  // COZY-E — start: ekonomi multiplayer (handler event MpEconomy).
  // Aturan: angka koin/inventory HANYA dari respons server.
  _onMpEcoEvent(type, data) {
    const lang = this.state.lang;
    if (type === 'mp-unavailable') {
      this.ui.setMpAvailable(false);
      return;
    }
    if (type === 'garden') {
      const { garden, visit } = data;
      if (visit && typeof visit.coins === 'number') this.state.coins = visit.coins;
      if (visit && !visit.already) {
        if (!this.state.mpVisits || typeof this.state.mpVisits !== 'object') this.state.mpVisits = {};
        this.state.mpVisits[garden.username] = new Date().toISOString().slice(0, 10);
      }
      this.ui.showMpGarden(garden, visit);
      if (visit && !visit.already && visit.reward > 0) {
        this.ui.toast(t('mpVisitReward', lang, { n: visit.reward }));
      } else if (visit && visit.already) {
        this.ui.toast(t('mpVisitAgain', lang));
      }
      this.ui.updateHUD(this.state);
      this.save();
      return;
    }
    if (type === 'trade-sent') {
      this.ui.toast(t('mpTradeSent', lang));
      this.ui.setMpTradePending(data);
      return;
    }
    if (type === 'trade-offer') {
      this.ui.showMpTradeOffer(data);
      return;
    }
    if (type === 'trade-done') {
      // Saya penerima: server mengembalikan inv/koin SAYA sesudah swap.
      if (data.inv) this.state.inv = { ...this.state.inv, ...data.inv };
      if (typeof data.coins === 'number') this.state.coins = data.coins;
      if (data.offer) {
        this._recordMpTrade({
          id: data.offerId, with: data.offer.from,
          give: data.offer.want, get: data.offer.offer, at: Date.now(),
        });
      }
      this.ui.hideMpTradeOffer();
      this.ui.toast(t('mpTradeDone', lang));
      this.ui.updateHUD(this.state);
      this.save();
      return;
    }
    if (type === 'trade-done-remote') {
      // Saya pengusul: server sudah mengubah save saya — ambil ulang.
      if (data) {
        this._recordMpTrade({
          id: data.offerId, with: data.to,
          give: data.offer, get: data.want, at: Date.now(),
        });
        // Terapkan inv/koin pasca-trade SEGERA (peerInv/peerCoins direlay
        // lewat broadcast dari respons accept — nilai hasil server, bukan
        // klaim client). Ini menutup balapan autosave-vs-refresh: PUT
        // autosave berikutnya sudah membawa state pasca-trade. Validasi
        // ketat sebelum menerapkan: kunci harus dikenal (ada di state.inv),
        // nilai integer 0-99999, koin 0-999999 — nilai di luar itu diabaikan
        // dan GET sesudahnya yang memutuskan. Sisa risiko: peer nakal bisa
        // merelay peerInv palsu NAMUN dalam range; dampaknya terbatas
        // (tampilan + PUT berikutnya) dan GET konfirmasi (milidetik
        // kemudian) langsung menimpanya dengan kebenaran server.
        if (data.peerInv && typeof data.peerInv === 'object' && !Array.isArray(data.peerInv)) {
          const keys = Object.keys(data.peerInv);
          const ok = keys.length > 0 && keys.every((k) =>
            Object.prototype.hasOwnProperty.call(this.state.inv, k)
            && Number.isInteger(data.peerInv[k]) && data.peerInv[k] >= 0 && data.peerInv[k] <= 99999);
          if (ok) {
            this.state.inv = { ...this.state.inv, ...data.peerInv };
            if (Number.isInteger(data.peerCoins) && data.peerCoins >= 0 && data.peerCoins <= 999999) {
              this.state.coins = data.peerCoins;
            }
            this.ui.updateHUD(this.state);
          }
        }
      }
      this.ui.setMpTradePending(null);
      this.ui.toast(t('mpTradeDone', lang));
      this._refreshSaveAfterTrade();
      return;
    }
    if (type === 'trade-declined') {
      this.ui.hideMpTradeOffer();
      this.ui.toast(t('mpTradeDeclined', lang));
      return;
    }
    if (type === 'trade-declined-remote') {
      this.ui.setMpTradePending(null);
      this.ui.toast(t('mpTradeDeclined', lang));
      return;
    }
    if (type === 'game-started') {
      this.ui.showMpGame(data.room, data.endsAt);
      return;
    }
    if (type === 'game-score') {
      this.ui.setMpGameScores(this.mpEco.game ? this.mpEco.game.scores : {});
      return;
    }
    if (type === 'game-ended') {
      if (data.unavailable) { this.ui.toast(t('mpComingSoon', lang)); return; }
      if (data.error) { this.ui.toast(t('loadFailed', lang)); return; }
      if (typeof data.coins === 'number') this.state.coins = data.coins;
      if (Number.isInteger(data.score) && data.score > (this.state.mpMinigameBest || 0)) {
        this.state.mpMinigameBest = data.score;
      }
      this.ui.showMpGameResults(data);
      this.ui.updateHUD(this.state);
      this.save();
      return;
    }
    if (type === 'game-ended-remote') {
      this.ui.showMpGameResults({ room: data.room, winner: data.winner, scores: data.scores, remote: true });
      return;
    }
    if (type === 'leaderboard') {
      this.ui.showMpLeaderboard(data.board || []);
      return;
    }
  }

  // Kunjungi kebun pemain lain: snapshot publik + hadiah sekali-sehari.
  // Hadiah + koin diterapkan dari respons server (lihat _onMpEcoEvent).
  async visitGarden(username) {
    if (!this.session) { this.ui.toast(t('needLogin', this.state.lang)); return; }
    if (!username || username === this.state.username) return;
    try {
      await this.mpEco.visitGarden(username);
    } catch (e) {
      if (isMpUnavailable(e)) this.ui.toast(t('mpComingSoon', this.state.lang));
      else if (e && e.message === 'no_session') this.ui.toast(t('needLogin', this.state.lang));
      else this.ui.toast((e && e.message) || t('loadFailed', this.state.lang));
    }
  }

  _recordMpTrade(entry) {
    if (!entry || !entry.id) return;
    if (!Array.isArray(this.state.mpTrades)) this.state.mpTrades = [];
    this.state.mpTrades.unshift(entry);
    this.state.mpTrades = this.state.mpTrades.slice(0, 20);
  }

  // Sesudah trade selesai sebagai pengusul: tarik save server terbaru
  // (server sudah menerapkan swap di sana). Gagal jaringan -> tandai
  // pending; sync berikutnya memperbaikinya.
  async _refreshSaveAfterTrade() {
    if (!this.session) return;
    try {
      const res = await cloudGetSave();
      if (res && res.save) this.applySaveData(res.save);
    } catch (e) { markPending(); }
  }
  // COZY-E — end
  getStateSnapshot() {
    return JSON.parse(JSON.stringify({
      coins: this.state.coins, day: this.state.day, minutes: this.state.minutes,
      lang: this.state.lang, gender: this.state.gender, sound: this.state.sound,
      quality: this.state.quality, custom: this.state.custom,
      username: this.state.username, updatedAt: this.state.updatedAt,
      inv: this.state.inv,
      plots: this.state.plots,
      animals: this.state.animals,
      // COZY-C: snapshot ekonomi baru untuk probe/verifikasi.
      invQ: this.state.invQ,
      trees: this.state.trees,
      machineCooldown: this.state.machineCooldown,
      demand: demandFor(this.state.day),
      // COZY-D — NPC + Sosial (untuk probe/debug via getStateSnapshot).
      npc: this.npc ? this.npc.debug() : null,
      player: { x: this.player.x, z: this.player.z, y: this.player.y },
    }));
  }
  save() {
    this.state.playerX = this.player.x;
    this.state.playerZ = this.player.z;
    // COZY-F2 — v3: salin musim dunia ke state sebelum disimpan (musim
    // hanya berubah lewat world.setSeason; state.season = cerminnya).
    if (this.world && typeof this.world.season === 'string') this.state.season = this.world.season;
    saveGame(this.state);
    this.scheduleCloudSync();
  }
}

// ---------- Boot ----------
try {
  const game = new Game();
  game.init();
  window.__LH_GAME = game; // referensi internal (debug utama di window.__LH via debug.js)
} catch (err) {
  console.error(err);
  const box = document.getElementById('error-box');
  if (box) { box.textContent = `Gagal memuat game: ${err.message}\n${err.stack || ''}`; box.classList.remove('hidden'); }
}
