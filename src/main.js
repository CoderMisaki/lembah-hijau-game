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
import { saveGame, loadGame, clearSave } from './save.js';
import { Input } from './input.js';
import { DynamicBox, terrainHeight } from './physics.js';
import { attachDebug } from './debug.js';

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
    inv: { carrotSeed: 0, tomatoSeed: 0, pumpkinSeed: 0, feed: 0,
           carrot: 0, tomato: 0, pumpkin: 0, egg: 0, milk: 0 },
    plots, animals, playerX: 0, playerZ: 0,
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
        inv: { ...this.state.inv, ...(saved.inv || {}) },
        playerX: saved.player?.x ?? 0, playerZ: saved.player?.z ?? 0,
      });
      if (Array.isArray(saved.plots) && saved.plots.length === this.state.plots.length) this.state.plots = saved.plots;
      if (Array.isArray(saved.animals) && saved.animals.length === this.state.animals.length) this.state.animals = saved.animals;
      this._hadSave = true;
    }
    this.fps = 60;
    this.started = false;
    this._fpsAccum = 0; this._fpsFrames = 0; this._lowFpsTime = 0; this._lastDegrade = 0;
    this._saveTimer = 0;
    this._pendingCropPlot = null;
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
    this.scene.background = new THREE.Color(0xf6c98a);
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 8, 12);

    this.world = buildWorld(this.scene);
    this.player = new Player(this.scene, this.state.gender, this.state.playerX, this.state.playerZ);
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
      onClearSave: () => { clearSave(); this.ui.toast(t('saveCleared', this.state.lang)); setTimeout(() => location.reload(), 900); },
      onLang: (lang) => this.setLang(lang),
      onGender: (g) => { this.state.gender = g; this.player.setGender(this.scene, g); this.save(); },
      onSound: (on) => { this.state.sound = on; this.sfx.enabled = on; this.save(); },
      onQuality: (q) => this.applyQuality(q),
    });
    this.ui.setLang(this.state.lang);
    this.ui.showStart(this._hadSave
      ? t('welcomeBack', this.state.lang, { d: this.state.day }) : '');
    this.ui.updateHUD(this.state);
    this.applyQuality(this.state.quality);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.checkOrientation(), 300));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.checkOrientation(); });

    attachDebug(this);
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.loop());
  }

  // ---------- Siklus hidup ----------
  async startGame() {
    this.sfx.ensure();
    this.sfx.play('click');
    this.started = true;
    this.ui.showGame(this._isTouch);
    this.ui.updateHUD(this.state);
    // Landscape: fullscreen + orientation lock (Android Chrome). Semua error ditangkap.
    try {
      if (this._isTouch && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch (e) { /* abaikan */ }
    try {
      if (this._isTouch && screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape');
        this._orientationLocked = true;
      }
    } catch (e) { this._orientationLocked = false; /* iOS / tidak didukung -> fallback overlay */ }
    this.checkOrientation();
    this.save();
  }
  checkOrientation() {
    // Desktop: jangan paksa apa pun. Mobile portrait + lock gagal -> overlay.
    if (!this.started || !this._isTouch) { this.ui.setOrientationOverlay(false); return; }
    const portrait = window.innerHeight > window.innerWidth;
    this.ui.setOrientationOverlay(portrait && !this._orientationLocked);
  }
  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.checkOrientation();
  }

  // ---------- Kualitas grafis + auto-degrade ----------
  applyQuality(q) {
    if (!QUALITY[q]) q = 'medium';
    this.state.quality = q;
    const cfg = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.pixelRatio));
    this.renderer.shadowMap.enabled = cfg.shadows;
    if (this.world?.sun) {
      this.world.sun.castShadow = cfg.shadows;
      this.world.sun.shadow.mapSize.set(cfg.shadowSize, cfg.shadowSize);
      if (this.world.sun.shadow.map) { this.world.sun.shadow.map.dispose(); this.world.sun.shadow.map = null; }
    }
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
      // Waktu berjalan; mentok 22:00 sampai tidur.
      if (this.state.minutes < DAY_END) {
        this.state.minutes = Math.min(DAY_END, this.state.minutes + MIN_PER_SEC * dt);
      }
      const mv = this.input.moveVector();
      this.player.update(dt, mv, this.world.colliders);
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
      this.updateInteraction();
      // Autosave tiap 10 detik.
      this._saveTimer += dt;
      if (this._saveTimer > 10) { this._saveTimer = 0; this.save(); }
      this._fpsCheck(rawDt);
      this.ui.updateHUD(this.state);
    }
    this.world.update(dt, this.state.minutes);
    // Kamera third-person: smooth follow dari belakang-atas.
    const px = this.player.x, py = this.player.y, pz = this.player.z;
    const camTarget = new THREE.Vector3(px, py + 1.6, pz);
    const desired = new THREE.Vector3(px, py + 7.5, pz + 11);
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
    this._ctx = ctx;
    this.ui.setActionLabel(ctx ? ctx.label : '✋');
    this.ui.setHint(ctx ? '' : t('hintNearPlot', this.state.lang));
  }
  doAction() {
    if (!this.started) return;
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

  // ---------- API inti (dipakai UI + hook uji window.__LH.api) ----------
  hoeAt(ix, iz) { const ok = this.farm.hoeAt(ix, iz); if (ok) this.save(); return ok; }
  plantAt(ix, iz, crop) { const ok = this.farm.plantAt(ix, iz, crop, this.state.inv); if (ok) this.save(); return ok; }
  waterAt(ix, iz) { const ok = this.farm.waterAt(ix, iz); if (ok) this.save(); return ok; }
  harvestAt(ix, iz) {
    const got = this.farm.harvestAt(ix, iz, this.state.inv);
    if (got) this.save();
    return got || false;
  }
  sleep() {
    const grown = this.farm.plots.filter((p) => p.crop && p.watered).length;
    this.farm.growDay();
    const prod = this.animals.produceMorning();
    this.state.day += 1;
    this.state.minutes = DAY_START;
    this.sfx.play('sleep');
    this.save();
    this.ui.toast(t('morning', this.state.lang, { d: this.state.day }));
    this.ui.updateHUD(this.state);
    return { day: this.state.day, grown, eggs: prod.eggs, milk: prod.milk };
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
      quality: this.state.quality, inv: this.state.inv,
      plots: this.state.plots,
      animals: this.state.animals,
      player: { x: this.player.x, z: this.player.z, y: this.player.y },
    }));
  }
  save() {
    this.state.playerX = this.player.x;
    this.state.playerZ = this.player.z;
    saveGame(this.state);
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
