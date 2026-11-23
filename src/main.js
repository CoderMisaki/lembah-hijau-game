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
// Pasar malam + multiplayer (23 Nov 2026): zona, 8 game berhadiah, wahana,
// jajanan, room online via Supabase Realtime (ephemeral, tanpa tabel baru).
import { buildNightMarketZone, NM_RECT } from './nm-zone.js';
import { buildNightMarketGames } from './nm-games.js';
import { buildNightMarketRides } from './nm-rides.js';
import { buildNightMarketFood } from './nm-food.js';
import { Multiplayer } from './multiplayer.js';
import {
  getSession, setSession, clearSession, hasPending, markPending, clearPending,
  validateUsername, validatePin, normalizeUsername,
  register as cloudRegister, login as cloudLogin, logout as cloudLogout,
  cloudGetSave, cloudPutSave, cloudDeleteSave, cloudHealth,
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
           carrot: 0, tomato: 0, pumpkin: 0, egg: 0, milk: 0 },
    plots, animals, playerX: 6, playerZ: 20, // spawn pembuka: selatan kebun/kandang,
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = null; // langit digambar sky dome di world.js (gradient ikut waktu)
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
    // Posisi awal: tinggi + jauh ke selatan agar frame pembuka memuat kebun,
    // sungai (barat), dan pegunungan (utara) — bukan hamparan rumput kosong.
    this.camera.position.set(6, 16, 42);

    this.world = buildWorld(this.scene);
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
    // Geometri jauh (pegunungan) butuh far ini; langit aman via trik sky dome.
    this.camera.far = this.world.view.camFar;
    this.camera.updateProjectionMatrix();
    this.player = new Player(this.scene, this.state.gender, this.state.playerX, this.state.playerZ, this.state.custom);
    this.farm = new Farm(this.scene, this.state.plots);
    this.animals = new Animals(this.scene, this.state.animals);
    this.crate = new DynamicBox(7, -15);
    this.input = new Input();
    this.input.onAction = () => this.doAction();
    this.input.onJump = () => { if (this.started && this.player.jump()) this.sfx.play('jump'); };

    this.ui = new UI({
      onStart: () => this.startGame(),
      onBuy: (k, p, n) => this.buyItem(k, p, n),
      onSell: (k, p, n) => this.sellItem(k, p, n),
      onPlant: (crop) => this.plantChosen(crop),
      onSleepYes: () => { this.ui.closeSleep(); this.sleep(); },
      onClearSave: () => this.clearAllSave(),
      onLang: (lang) => this.setLang(lang),
      onGender: (g) => { this.state.gender = g; this.player.setGender(this.scene, g); this.save(); },
      onSound: (on) => { this.state.sound = on; this.sfx.enabled = on; this.save(); },
      onQuality: (q) => this.applyQuality(q),
      onSave: () => this.saveNow(),
      onLoad: () => this.loadNow(),
      onCustomChange: (custom, gender) => this.applyCustom(custom, gender),
      onAuthSubmit: (mode, u, pin, pinConfirm) => this.handleAuth(mode, u, pin, pinConfirm),
      onOffline: () => this.enterOfflineMode(),
      onLogout: () => this.handleLogout(),
      onDeleteServerSave: () => this.deleteServerSave(),
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
    this.ui.h.onCreateRoom = () => this.mp.createRoom();
    this.ui.h.onJoinRoom = (code) => this.mp.joinRoom(code);
    this.ui.h.onLeaveRoom = () => this.mp.leaveRoom();
    this.ui.h.onSendChat = (text) => { if (this.mp.sendChat(text)) this.ui.addRoomChat(selfName(), text); };
    this.ui.h.getRemotePlayers = () => this.remotePlayers || [];
    this.ui.setLang(this.state.lang);
    this.ui.setAuthState(this.session ? this.session.username : null);
    this.ui.showStart(this._hadSave
      ? t('welcomeBack', this.state.lang, { d: this.state.day }) : '');
    this.ui.updateHUD(this.state);
    this.applyQuality(this.state.quality);
    // Sinkronisasi awal (non-blocking): bila ada sesi, samakan save lokal/server.
    if (this.session) this.syncFromCloudOnBoot();
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
  applyQuality(q) {
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
    this.save();
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
        if (this._lowFpsTime >= 5 && now - this._lastDegrade > 10000) {
          const idx = QUALITY_ORDER.indexOf(this.state.quality);
          if (idx > 0) {
            this.applyQuality(QUALITY_ORDER[idx - 1]);
            this.ui.toast(t('qualityLowered', this.state.lang));
            this._lastDegrade = now;
          }
          this._lowFpsTime = 0;
        }
      } else this._lowFpsTime = 0;
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
        // Pasar malam: game/wahana/jajanan + kirim posisi ke room (~10 Hz,
        // throttle internal di Multiplayer).
        this.nmGames.update(dt, t, this);
        this.nmFood.update(dt, t, this);
        this.nmRides.update(dt, t, this);
        if (this.mp.connected) this.mp.sendPosition(this.player.x, this.player.z, this.player.facing);
        if (this.nmRides.isRiding()) {
          // Naik wahana: tombol Aksi = Turun — hanya bila input tidak dikunci
          // (wahana duduk mengunci input; keluarnya lewat tombol Turun panel).
          if (this.input.locked) {
            this._ctx = null;
            this.ui.setActionLabel('');
            this.ui.setHint('');
          } else {
            const rid = this.nmRides.debug.state().riding;
            this._ctx = rid ? { type: 'nm', id: rid, label: i18nT('rideExit', this.state.lang) } : null;
            this.ui.setActionLabel(this._ctx ? this._ctx.label : '');
            this.ui.setHint('');
          }
        } else this.updateInteraction();
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
    if (this.started && inNm && !this._inNightMarket) this.ui.toast(i18nT('nmEnter', this.state.lang));
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
      camTarget = new THREE.Vector3(px, py + 1.6, pz);
      const o = this.input.orbit;
      const cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
      desired = new THREE.Vector3(
        px + o.dist * Math.sin(o.yaw) * cp,
        py + 1.6 + o.dist * sp,
        pz + o.dist * Math.cos(o.yaw) * cp,
      );
      // Kamera tidak boleh masuk tanah: angkat ke terrain + 0.5 m.
      const minY = terrainHeight(desired.x, desired.z) + 0.5;
      if (desired.y < minY) desired.y = minY;
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
      else if (pl.crop && !pl.watered && !this.farm.isReady(pl)) ctx = { type: 'water', plot, label: t('actionWater', this.state.lang) };
      else if (pl.crop && this.farm.isReady(pl)) ctx = { type: 'harvest', plot, label: t('actionHarvest', this.state.lang) };
    }
    if (!ctx && animalIdx >= 0) {
      const a = this.state.animals[animalIdx];
      if ((a.ready || 0) > 0) ctx = { type: 'collect', kind: a.kind, label: t('actionCollect', this.state.lang) };
      else if (!a.fed) ctx = { type: 'feed', kind: a.kind, label: t('actionFeed', this.state.lang) };
    }
    if (!ctx && nearDoor) ctx = { type: 'sleep', label: t('actionSleep', this.state.lang) };
    if (!ctx && nearShop) ctx = { type: 'shop', label: t('actionShop', this.state.lang) };
    if (!ctx && nearGate && this.animals.fedCount() < this.state.animals.length) {
      ctx = { type: 'feedAll', label: t('actionFeed', this.state.lang) };
    }
    if (!ctx && nearCrate) ctx = { type: 'push', label: t('actionPush', this.state.lang) };
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
        if (got) { this.sfx.play('harvest'); this.ui.toast(t('harvested', lang)); }
        break;
      }
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

  async syncFromCloudOnBoot() {
    try {
      const res = await cloudGetSave();
      if (!res || !res.save) {
        // Akun baru / belum ada save server: unggah save lokal bila ada progress.
        if (this._hadSave) await this.cloudSync();
        return;
      }
      const remoteAt = res.save.updatedAt || res.save.savedAt || res.updatedAt || 0;
      const localAt = this.state.updatedAt || 0;
      if (remoteAt > localAt) {
        this.applySaveData(res.save);
        this.ui.toast(t('serverNewer', this.state.lang));
      } else if (localAt > remoteAt) {
        await this.cloudSync();
        this.ui.toast(t('localUploaded', this.state.lang));
      }
      // Sama -> server menang, tapi isinya identik jadi tidak ada yang diubah.
    } catch (e) {
      // Offline / server belum deploy: lanjut dengan save lokal, tandai pending.
      markPending();
    }
  }

  scheduleCloudSync() {
    if (!this.session) return;
    clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => this.cloudSync(), 1500);
  }

  async cloudSync() {
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
      // Samakan save lokal/server untuk akun ini.
      await this.syncFromCloudOnBoot();
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

  async handleLogout() {
    this.save();
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
    const got = this.farm.harvestAt(ix, iz, this.state.inv);
    if (got) this.save();
    return got || false;
  }
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
    this.ui.toast(t('morning', this.state.lang, { d: this.state.day }));
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
    if (r.ok) this.save();
    return r;
  }
  collectAnimal(kind) {
    if (!ANIMAL_DEFS[kind]) return 0;
    const n = this.animals.collectAnimal(kind, this.state.inv);
    if (n > 0) this.save();
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
    if ((this.state.inv[key] || 0) < 1) return false;
    this.state.inv[key] -= 1;
    this.state.coins += price;
    this.sfx.play('coin');
    this.ui.toast(t('sold', this.state.lang, { n: price }));
    this.ui.refreshShop(this.state);
    this.ui.updateHUD(this.state);
    this.save();
    return true;
  }
  sellAll() {
    const prices = { carrot: 12, tomato: 20, pumpkin: 32, egg: 8, milk: 15 };
    let earned = 0, count = 0;
    for (const [k, price] of Object.entries(prices)) {
      const n = this.state.inv[k] || 0;
      if (n > 0) { earned += n * price; count += n; this.state.inv[k] = 0; }
    }
    if (earned > 0) {
      this.state.coins += earned;
      this.sfx.play('coin');
      this.ui.toast(t('sold', this.state.lang, { n: earned }));
      this.ui.updateHUD(this.state);
      this.save();
    }
    return { earned, count, coins: this.state.coins };
  }
  getStateSnapshot() {
    return JSON.parse(JSON.stringify({
      coins: this.state.coins, day: this.state.day, minutes: this.state.minutes,
      lang: this.state.lang, gender: this.state.gender, sound: this.state.sound,
      quality: this.state.quality, custom: this.state.custom,
      username: this.state.username, updatedAt: this.state.updatedAt,
      inv: this.state.inv,
      plots: this.state.plots,
      animals: this.state.animals,
      player: { x: this.player.x, z: this.player.z, y: this.player.y },
    }));
  }
  save() {
    this.state.playerX = this.player.x;
    this.state.playerZ = this.player.z;
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
