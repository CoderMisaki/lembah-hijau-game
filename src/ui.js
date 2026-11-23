// ui.js — HUD, dialog, toko, pengaturan, toast, overlay orientasi, akun,
// kustomisasi karakter (preview 3D live). Semua teks lewat i18n (ID/EN).
// Keamanan: data pemain (username dll.) HANYA via textContent — tidak ada
// innerHTML dari data pemain di mana pun di file ini.
import * as THREE from 'three';
import { t, applyI18n } from './i18n.js';
import { icon } from './icons.js';
import { CROPS } from './farm.js';
import { ANIMAL_DEFS } from './animals.js';
import { buildCharacter } from './player.js';
// Minimap: konstanta fallback bila world.minimapData belum ada (lane dunia
// paralel) — peta tetap tergambar dari data yang sudah diekspor.
import {
  HOUSE, SHOP, PEN, FARM_ORIGIN, FARM_COLS, FARM_ROWS, FARM_SPACING,
} from './world.js';
import { riverCenterX, RIVER_HALF } from './physics.js';
import {
  SKIN_TONES, HAIR_STYLES, HAIR_COLORS, SHIRT_MODELS, PANTS_MODELS,
  HAT_MODELS, GLASSES_MODELS, SHOES_MODELS, PALETTE, FRAME_COLORS,
  defaultCustom, sanitizeCustom,
} from './customization.js';
import { isValidRoomCode, normalizeRoomCode } from './multiplayer.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Ubah string SVG statis (ikon milik sendiri, bukan data pemain) jadi elemen.
function iconEl(name) {
  const tpl = document.createElement('template');
  tpl.innerHTML = icon(name);
  return tpl.content.firstElementChild;
}

// Sisipkan teks dengan penanda {coin}/{sprout} sebagai ikon SVG di posisinya.
function appendRichText(parent, text) {
  for (const part of text.split(/(\{coin\}|\{sprout\})/g)) {
    if (part === '{coin}') parent.appendChild(iconEl('coin'));
    else if (part === '{sprout}') parent.appendChild(iconEl('sprout'));
    else if (part) parent.appendChild(document.createTextNode(part));
  }
}

// Definisi baris kustomisasi: [kunci model, daftar model, kunci warna, daftar warna, kunci i18n label]
const CUSTOM_ROWS = [
  { label: 'skin', modelKey: null, models: SKIN_TONES, colorKey: 'skin', colors: SKIN_TONES },
  { label: 'hairStyle', modelKey: 'hairStyle', models: HAIR_STYLES, colorKey: 'hairColor', colors: HAIR_COLORS },
  { label: 'shirtModel', modelKey: 'shirtModel', models: SHIRT_MODELS, colorKey: 'shirtColor', colors: PALETTE },
  { label: 'pantsModel', modelKey: 'pantsModel', models: PANTS_MODELS, colorKey: 'pantsColor', colors: PALETTE },
  { label: 'hatModel', modelKey: 'hatModel', models: HAT_MODELS, colorKey: 'hatColor', colors: PALETTE },
  { label: 'glassesModel', modelKey: 'glassesModel', models: GLASSES_MODELS, colorKey: 'glassesColor', colors: FRAME_COLORS },
  { label: 'shoesModel', modelKey: 'shoesModel', models: SHOES_MODELS, colorKey: 'shoesColor', colors: PALETTE },
];

export class UI {
  constructor(handlers) {
    this.h = handlers; // onStart, onBuy, onSell, onPlant, onSleepYes, onClearSave, onLang, onGender,
    // onSound, onQuality, onSave, onLoad, onCustomChange, onAuthSubmit, onOffline, onLogout, onDeleteServerSave
    this.lang = 'id';
    this._toastTimer = null;
    this._hintTimer = null;
    this._hintText = '';
    this._authMode = 'login';
    this._custom = defaultCustom('male');
    this._customGender = 'male';
    this._preview = null; // {renderer, scene, camera, group, raf}
    // ---- Minimap realtime ----
    this._mmCollapsed = false;
    this._mmLastDraw = 0;
    this._mmFallback = null;
    this._bind();
  }
  _bind() {
    $('btn-start').addEventListener('click', () => this.h.onStart());
    document.querySelectorAll('.char-card').forEach((el2) => {
      el2.addEventListener('click', () => {
        document.querySelectorAll('.char-card').forEach((c) => c.classList.remove('selected'));
        el2.classList.add('selected');
        this.h.onGender(el2.dataset.gender);
      });
    });
    $('btn-shop').addEventListener('click', () => { this.openShop('buy'); });
    $('btn-save').addEventListener('click', () => this.h.onSave());
    $('btn-load').addEventListener('click', () => this.h.onLoad());
    $('btn-customize').addEventListener('click', () => this.openCustomize());
    $('btn-close-shop').addEventListener('click', () => this.closeShop());
    $('tab-buy').addEventListener('click', () => this.openShop('buy'));
    $('tab-sell').addEventListener('click', () => this.openShop('sell'));
    $('btn-close-crop').addEventListener('click', () => this.closeCropPicker());
    $('btn-sleep-yes').addEventListener('click', () => this.h.onSleepYes());
    $('btn-sleep-no').addEventListener('click', () => this.closeSleep());
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-close-settings').addEventListener('click', () => this.closeSettings());
    $('btn-clear-save').addEventListener('click', () => this.h.onClearSave());
    $('btn-delete-server-save').addEventListener('click', () => this.h.onDeleteServerSave());
    $('setting-lang').addEventListener('change', (e) => this.h.onLang(e.target.value));
    $('setting-gender').addEventListener('change', (e) => this.h.onGender(e.target.value));
    $('setting-sound').addEventListener('change', (e) => this.h.onSound(e.target.value === 'on'));
    $('setting-quality').addEventListener('change', (e) => this.h.onQuality(e.target.value));
    // ---- Akun ----
    $('tab-login').addEventListener('click', () => this.setAuthMode('login'));
    $('tab-register').addEventListener('click', () => this.setAuthMode('register'));
    $('btn-auth-submit').addEventListener('click', () => this._submitAuth());
    $('auth-pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._submitAuth(); });
    $('auth-pin-confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._submitAuth(); });
    $('btn-offline').addEventListener('click', () => this.h.onOffline());
    $('btn-logout').addEventListener('click', () => this.h.onLogout());
    // ---- Minimap realtime ----
    $('btn-minimap-toggle').addEventListener('click', (e) => { e.stopPropagation(); this._toggleMinimap(); });
    window.addEventListener('resize', () => { if (!this._mmCollapsed) this._drawMinimap(true); });
    // ---- Room "Main Bareng" (NIGHT MARKET M) ----
    this._room = { inRoom: false, code: null, players: [], selfName: null };
    this._roomMessages = [];
    $('btn-room').addEventListener('click', () => this.openRoom());
    $('btn-close-room').addEventListener('click', () => this.closeRoom());
    $('btn-room-create').addEventListener('click', () => this._createRoom());
    $('btn-room-join').addEventListener('click', () => this._joinRoom());
    $('room-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._joinRoom(); });
    $('btn-room-copy').addEventListener('click', () => this._copyRoomCode());
    $('btn-room-leave').addEventListener('click', () => this._leaveRoom());
    $('btn-room-chat-send').addEventListener('click', () => this._sendRoomChat());
    $('room-chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._sendRoomChat(); });
    // ---- Kustomisasi ----
    $('btn-close-customize').addEventListener('click', () => this.closeCustomize());
    $('btn-custom-reset').addEventListener('click', () => {
      this._custom = defaultCustom(this._customGender);
      this._renderCustomOptions();
      this._rebuildPreview();
      this.h.onCustomChange({ ...this._custom }, this._customGender);
    });
    $('custom-male').addEventListener('click', () => this._setCustomGender('male'));
    $('custom-female').addEventListener('click', () => this._setCustomGender('female'));
  }
  setLang(lang) {
    this.lang = lang;
    applyI18n(lang);
    $('setting-lang').value = lang;
    $('btn-jump').setAttribute('aria-label', t('jump', lang));
    $('btn-run').setAttribute('aria-label', t('run', lang));
    $('minimap-canvas').setAttribute('aria-label', t('minimapLabel', lang));
    $('room-code-input').placeholder = t('roomJoinPlaceholder', lang);
    $('room-chat-input').placeholder = t('roomChatPlaceholder', lang);
    this._renderRoomState();
    this._renderRoomChat();
    this._syncMinimapToggleLabel();
    if (this._customOptionsBuilt) this._renderCustomOptions();
  }
  showGame(isTouch) {
    $('start-screen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    if (isTouch) $('touch-controls').classList.remove('hidden');
    this._drawMinimap(true);
  }
  showStart(saveNote) {
    $('save-note').textContent = saveNote || '';
  }
  toast(msg, ms = 2600) {
    const e = $('toast');
    e.textContent = msg;
    e.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => e.classList.add('hidden'), ms);
  }
  // Hint kontekstual: notifikasi 3 detik saja, lalu memudar. Dipanggil tiap
  // frame oleh main.js — teks yang SAMA tidak me-reset timer, jadi hint tidak
  // muncul terus-menerus; teks BARU (mis. habis dekat petak lalu menjauh)
  // tampil lagi 3 detik. '' = sembunyikan langsung.
  setHint(text) {
    const bar = $('hint-bar');
    const next = text || '';
    if (next === this._hintText) return;
    this._hintText = next;
    clearTimeout(this._hintTimer);
    if (!next) { bar.classList.add('hidden'); bar.textContent = ''; return; }
    bar.textContent = next;
    bar.classList.remove('hidden');
    bar.classList.remove('hint-fade');
    this._hintTimer = setTimeout(() => bar.classList.add('hint-fade'), 3000);
  }
  setActionLabel(text) { $('btn-action').textContent = text || ''; }
  updateHUD(state) {
    this._lastState = state;
    $('coins').textContent = state.coins;
    const mins = Math.floor(state.minutes);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    $('day-time').textContent = `${t('day', this.lang)} ${state.day} • ${hh}:${mm}`;
    const bar = $('inv-bar');
    while (bar.firstChild) bar.removeChild(bar.firstChild);
    const inv = state.inv;
    const add = (iconName, n, label) => {
      if (n > 0) {
        const chip = el('span', 'inv-chip');
        chip.appendChild(iconEl(iconName));
        chip.appendChild(document.createTextNode(` ${label} ×${n}`));
        bar.appendChild(chip);
      }
    };
    add('sprout', inv.carrotSeed, 'Wortel'); add('sprout', inv.tomatoSeed, 'Tomat'); add('sprout', inv.pumpkinSeed, 'Labu');
    add('wheat', inv.feed, t('feed', this.lang));
    add('carrot', inv.carrot, 'Wortel'); add('tomato', inv.tomato, 'Tomat'); add('pumpkin', inv.pumpkin, 'Labu');
    add('egg', inv.egg, 'Telur'); add('milk', inv.milk, 'Susu');
    this._setShopCoins(state.coins);
    this._drawMinimap();
  }
  _setShopCoins(n) {
    const e = $('shop-coins');
    while (e.firstChild) e.removeChild(e.firstChild);
    e.appendChild(iconEl('coin'));
    e.appendChild(document.createTextNode(` ${n}`));
  }

  // ---------- Minimap realtime ----------
  // Satu <canvas> 2D; digambar ulang max ~10 Hz (throttle di updateHUD yang
  // dipanggil tiap frame). Warna isi peta = warna dunia itu sendiri:
  // rumput #6da344, sungai #56a8d0 (sama dengan tekstur air world.js),
  // tanah jalan #9a7b4f, kayu #8a6b3f, emas #ffb340 hanya untuk rumah
  // pemain + titik pemain. Sumbu peta: x → kanan, z → bawah (utara di atas).
  _toggleMinimap() {
    this._mmCollapsed = !this._mmCollapsed;
    $('minimap').classList.toggle('collapsed', this._mmCollapsed);
    $('btn-minimap-toggle').setAttribute('aria-expanded', String(!this._mmCollapsed));
    this._syncMinimapToggleLabel();
    if (!this._mmCollapsed) this._drawMinimap(true);
  }
  _syncMinimapToggleLabel() {
    $('btn-minimap-toggle').setAttribute('aria-label',
      t(this._mmCollapsed ? 'minimapExpand' : 'minimapCollapse', this.lang));
  }
  // Bentuk bounds yang diterima: {minX,maxX,minZ,maxZ} |
  // {min:{x,z},max:{x,z}} | {min,max} angka (peta bujur sangkar).
  _normalizeBounds(b) {
    if (!b || typeof b !== 'object') return null;
    if (typeof b.minX === 'number' && typeof b.maxX === 'number'
      && typeof b.minZ === 'number' && typeof b.maxZ === 'number') {
      return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
    }
    if (b.min && typeof b.min.x === 'number' && b.max && typeof b.max.x === 'number') {
      return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
    }
    if (typeof b.min === 'number' && typeof b.max === 'number') {
      return { minX: b.min, maxX: b.max, minZ: b.min, maxZ: b.max };
    }
    return null;
  }
  // Satu bangunan/zona: {x,z,w,d} (pusat + ukuran) atau {minX,maxX,minZ,maxZ}.
  _normalizeRect(r) {
    if (!r || typeof r !== 'object') return null;
    if (typeof r.minX === 'number' && typeof r.maxX === 'number') {
      return {
        x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2,
        w: r.maxX - r.minX, d: r.maxZ - r.minZ,
      };
    }
    if (typeof r.x === 'number' && typeof r.z === 'number') {
      return { x: r.x, z: r.z, w: r.w || 4, d: r.d || 4 };
    }
    return null;
  }
  _normalizeMinimapData(d) {
    const bounds = this._normalizeBounds(d.bounds);
    if (!bounds) return null;
    const houses = (Array.isArray(d.houses) ? d.houses : [])
      .map((r) => { const n = this._normalizeRect(r); return n ? { ...n, player: Boolean(r && r.player) } : null; })
      .filter(Boolean);
    const point = (p) => (p && typeof p.x === 'number' && typeof p.z === 'number' ? { x: p.x, z: p.z } : null);
    return {
      bounds,
      river: Array.isArray(d.river) ? d.river.filter((p) => p && typeof p.x === 'number') : [],
      lake: d.lake && typeof d.lake.x === 'number'
        ? { x: d.lake.x, z: d.lake.z, rx: d.lake.rx || 4, rz: d.lake.rz || 3 } : null,
      houses,
      nightmarket: d.nightmarket || null,
      shop: this._normalizeRect(d.shop),
      farm: this._normalizeRect(d.farm),
      pen: this._normalizeRect(d.pen),
      paths: Array.isArray(d.paths)
        ? d.paths.filter((p) => Array.isArray(p) && p.length > 1)
          .map((p) => p.filter((q) => q && typeof q.x === 'number')) : [],
      windmill: point(d.windmill),
      well: point(d.well),
    };
  }
  // Fallback bila world.minimapData belum ada: bangun dari konstanta yang
  // sudah diekspor world.js / physics.js (sungai dari riverCenterX, jalan
  // dari pola yang sama dengan pewarnaan terrain di world.js).
  _fallbackMinimapData() {
    if (this._mmFallback) return this._mmFallback;
    const river = [];
    for (let z = -32; z <= 32; z += 2) river.push({ x: riverCenterX(z), z });
    this._mmFallback = {
      bounds: { minX: -32, maxX: 32, minZ: -32, maxZ: 32 },
      river,
      lake: null,
      houses: [{
        x: (HOUSE.minX + HOUSE.maxX) / 2, z: (HOUSE.minZ + HOUSE.maxZ) / 2,
        w: HOUSE.maxX - HOUSE.minX, d: HOUSE.maxZ - HOUSE.minZ, player: true,
      }],
      shop: {
        x: (SHOP.minX + SHOP.maxX) / 2, z: (SHOP.minZ + SHOP.maxZ) / 2,
        w: SHOP.maxX - SHOP.minX, d: SHOP.maxZ - SHOP.minZ,
      },
      farm: {
        x: FARM_ORIGIN.x + ((FARM_COLS - 1) * FARM_SPACING) / 2,
        z: FARM_ORIGIN.z + ((FARM_ROWS - 1) * FARM_SPACING) / 2,
        w: FARM_COLS * FARM_SPACING, d: FARM_ROWS * FARM_SPACING,
      },
      pen: {
        x: (PEN.minX + PEN.maxX) / 2, z: (PEN.minZ + PEN.maxZ) / 2,
        w: PEN.maxX - PEN.minX, d: PEN.maxZ - PEN.minZ,
      },
      paths: [
        [{ x: -12, z: -17 }, { x: 12, z: -17 }],
        [{ x: 9, z: -17 }, { x: 9, z: 12 }],
        [{ x: -28, z: 6 }, { x: 9, z: 6 }],
      ],
      windmill: null,
      well: null,
    };
    return this._mmFallback;
  }
  // Sumber posisi pemain + data peta, berurutan:
  // 1) handler getMinimap (bila main.js suatu saat mengopernya),
  // 2) window.__LH_GAME (player + world.minimapData),
  // 3) peta statis tanpa titik pemain (fallback di atas).
  _resolveMinimap() {
    let src = null;
    if (typeof this.h.getMinimap === 'function') {
      try { src = this.h.getMinimap(); } catch { src = null; }
    }
    if (!src && typeof window !== 'undefined' && window.__LH_GAME) {
      const g = window.__LH_GAME;
      src = { player: g.player || null, data: g.world ? g.world.minimapData : null };
    }
    if (!src) return { player: null, data: this._fallbackMinimapData() };
    const data = src.data ? this._normalizeMinimapData(src.data) : null;
    return { player: src.player || null, data: data || this._fallbackMinimapData() };
  }
  _drawMinimap(force = false) {
    const now = performance.now();
    if (!force && now - this._mmLastDraw < 100) return; // ~10 Hz
    const canvas = $('minimap-canvas');
    if (!canvas || this._mmCollapsed) return;
    if ($('hud').classList.contains('hidden')) return;
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;
    this._mmLastDraw = now;
    const { player, data } = this._resolveMinimap();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const b = data.bounds;
    const s = Math.min(cssW / (b.maxX - b.minX), cssH / (b.maxZ - b.minZ));
    const ox = (cssW - (b.maxX - b.minX) * s) / 2;
    const oy = (cssH - (b.maxZ - b.minZ) * s) / 2;
    const X = (x) => ox + (x - b.minX) * s;
    const Z = (z) => oy + (z - b.minZ) * s;
    const rect = (r) => { ctx.fillRect(X(r.x - r.w / 2), Z(r.z - r.d / 2), r.w * s, r.d * s); };
    const WATER = '#56a8d0', GRASS = '#6da344', DIRT = '#9a7b4f', WOOD = '#8a6b3f';
    // Rumput.
    ctx.fillStyle = GRASS;
    ctx.fillRect(0, 0, cssW, cssH);
    // Danau.
    if (data.lake) {
      ctx.fillStyle = WATER;
      ctx.beginPath();
      ctx.ellipse(X(data.lake.x), Z(data.lake.z), Math.max(2, data.lake.rx * s), Math.max(2, data.lake.rz * s), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Sungai (lebar asli 2 * RIVER_HALF dunia).
    if (data.river.length > 1) {
      ctx.strokeStyle = WATER;
      ctx.lineWidth = Math.max(2, RIVER_HALF * 2 * s);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      data.river.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.x), Z(p.z)); else ctx.lineTo(X(p.x), Z(p.z)); });
      ctx.stroke();
    }
    // Jalan tanah.
    ctx.strokeStyle = DIRT;
    ctx.lineWidth = Math.max(2, 1.6 * s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const path of data.paths) {
      ctx.beginPath();
      path.forEach((p, i) => { if (i === 0) ctx.moveTo(X(p.x), Z(p.z)); else ctx.lineTo(X(p.x), Z(p.z)); });
      ctx.stroke();
    }
    // Kebun (tanah olahan + garis petak).
    if (data.farm) {
      ctx.fillStyle = '#a08050';
      rect(data.farm);
      ctx.strokeStyle = '#6b5233';
      ctx.lineWidth = 1;
      const fx = X(data.farm.x - data.farm.w / 2), fz = Z(data.farm.z - data.farm.d / 2);
      for (let i = 1; i < FARM_COLS; i++) {
        ctx.beginPath(); ctx.moveTo(fx + (i * data.farm.w * s) / FARM_COLS, fz);
        ctx.lineTo(fx + (i * data.farm.w * s) / FARM_COLS, fz + data.farm.d * s); ctx.stroke();
      }
      for (let i = 1; i < FARM_ROWS; i++) {
        ctx.beginPath(); ctx.moveTo(fx, fz + (i * data.farm.d * s) / FARM_ROWS);
        ctx.lineTo(fx + data.farm.w * s, fz + (i * data.farm.d * s) / FARM_ROWS); ctx.stroke();
      }
      ctx.strokeStyle = WOOD;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(fx, fz, data.farm.w * s, data.farm.d * s);
    }
    // Kandang (pagar kayu, isi krem).
    if (data.pen) {
      ctx.fillStyle = '#e6d9b8';
      rect(data.pen);
      ctx.strokeStyle = WOOD;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(data.pen.x - data.pen.w / 2), Z(data.pen.z - data.pen.d / 2), data.pen.w * s, data.pen.d * s);
    }
    // Pasar malam (NIGHT MARKET P): rect zona gelap hangat + garis emas +
    // titik wahana/game + stan jajanan. Data dari world.minimapData.
    if (data.nightmarket) {
      const nm = data.nightmarket;
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(X(nm.rect.minX), Z(nm.rect.minZ),
        (nm.rect.maxX - nm.rect.minX) * s, (nm.rect.maxZ - nm.rect.minZ) * s);
      ctx.strokeStyle = '#ffb340';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(nm.rect.minX), Z(nm.rect.minZ),
        (nm.rect.maxX - nm.rect.minX) * s, (nm.rect.maxZ - nm.rect.minZ) * s);
      ctx.fillStyle = '#ffb340';
      for (const r of nm.rides) {
        ctx.beginPath(); ctx.arc(X(r.x), Z(r.z), 2, 0, Math.PI * 2); ctx.fill();
      }
      if (nm.stalls) {
        for (let z = nm.stalls.zFrom; z <= nm.stalls.zTo; z += nm.stalls.step) {
          ctx.beginPath(); ctx.arc(X(nm.stalls.x), Z(z), 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (nm.gate) {
        ctx.fillStyle = '#fff8dc';
        ctx.fillRect(X(nm.gate.x) - 2, Z(nm.gate.z) - 2, 4, 4);
      }
    }
    // Rumah: rumah pemain emas, rumah lain kayu. Toko: daun.
    for (const h of data.houses) {
      ctx.fillStyle = h.player ? '#ffb340' : WOOD;
      rect(h);
      ctx.strokeStyle = '#2b2118';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(h.x - h.w / 2), Z(h.z - h.d / 2), h.w * s, h.d * s);
    }
    if (data.shop) {
      ctx.fillStyle = '#2e7d32';
      rect(data.shop);
      ctx.strokeStyle = '#2b2118';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(data.shop.x - data.shop.w / 2), Z(data.shop.z - data.shop.d / 2), data.shop.w * s, data.shop.d * s);
    }
    // Kincir (baling-baling) / sumur (lingkaran air + ring kayu).
    if (data.windmill) {
      const wx = X(data.windmill.x), wz = Z(data.windmill.z);
      ctx.strokeStyle = '#4a3419';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(wx - 4, wz - 4); ctx.lineTo(wx + 4, wz + 4);
      ctx.moveTo(wx + 4, wz - 4); ctx.lineTo(wx - 4, wz + 4);
      ctx.stroke();
      ctx.fillStyle = '#4a3419';
      ctx.beginPath(); ctx.arc(wx, wz, 2, 0, Math.PI * 2); ctx.fill();
    }
    if (data.well) {
      const wx = X(data.well.x), wz = Z(data.well.z);
      ctx.fillStyle = WATER;
      ctx.beginPath(); ctx.arc(wx, wz, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = WOOD;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(wx, wz, 3.5, 0, Math.PI * 2); ctx.stroke();
    }
    // Bingkai batas playable.
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, cssW - 2, cssH - 2);
    // Titik pemain: segitiga emas berputar sesuai facing.
    // facing = atan2(vx, vz): arah dunia (sin f, cos f) di (x, z) → di
    // canvas (sin f, cos f) di (x, y); segitiga menunjuk ke atas (0,-1)
    // diputar sebesar (π − f) searah jarum jam.
    if (player && typeof player.x === 'number' && typeof player.z === 'number') {
      const px = X(player.x), py = Z(player.z);
      const f = typeof player.facing === 'number' ? player.facing : 0;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI - f);
      ctx.fillStyle = 'rgba(255, 253, 242, .9)';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffb340';
      ctx.strokeStyle = '#2b2118';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Titik pemain lain (NIGHT MARKET M): lingkaran emas --lh-sun — bentuknya
    // beda dari segitiga diri sendiri (yang sejak awal sudah emas; jangan
    // diubah, verify-bigmap mengunci piksel emas di posisi pemain). Nama
    // singkat hanya bila minimap cukup lega (cssW >= 140).
    const remotes = this._remotePlayers();
    if (remotes.length > 0) {
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const rp of remotes) {
        if (typeof rp.x !== 'number' || typeof rp.z !== 'number') continue;
        const rx = X(rp.x), ry = Z(rp.z);
        ctx.fillStyle = '#ffb340';
        ctx.strokeStyle = '#2b2118';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(rx, ry, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (cssW >= 140 && rp.username) {
          const label = String(rp.username).slice(0, 8);
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,253,242,.9)';
          ctx.strokeText(label, rx, ry - 8);
          ctx.fillStyle = '#2b2118';
          ctx.fillText(label, rx, ry - 8);
        }
      }
    }
  }
  // Sumber pemain remote untuk minimap: handler getRemotePlayers (wiring
  // koordinator di main.js) atau window.__LH_GAME.remotePlayers.
  _remotePlayers() {
    try {
      if (typeof this.h.getRemotePlayers === 'function') {
        const list = this.h.getRemotePlayers();
        if (Array.isArray(list)) return list;
      }
    } catch { /* abaikan */ }
    try {
      const g = typeof window !== 'undefined' ? window.__LH_GAME : null;
      if (g && Array.isArray(g.remotePlayers)) return g.remotePlayers;
    } catch { /* abaikan */ }
    return [];
  }

  // ---------- Room "Main Bareng" (NIGHT MARKET M) ----------
  // UI murni: koneksi milik Multiplayer (wiring koordinator di main.js via
  // handler onCreateRoom/onJoinRoom/onLeaveRoom/onSendChat). Semua nama dan
  // pesan chat dirender via textContent — tidak ada innerHTML dari pemain.
  openRoom() {
    this._renderRoomState();
    this._renderRoomChat();
    $('room-modal').classList.remove('hidden');
  }
  closeRoom() { $('room-modal').classList.add('hidden'); }
  _createRoom() {
    const code = typeof this.h.onCreateRoom === 'function' ? this.h.onCreateRoom() : null;
    if (code) this.setRoomCode(code);
  }
  _joinRoom() {
    const code = normalizeRoomCode($('room-code-input').value);
    if (!isValidRoomCode(code)) {
      this.toast(t('roomInvalidCode', this.lang));
      return;
    }
    if (typeof this.h.onJoinRoom === 'function') this.h.onJoinRoom(code);
  }
  _leaveRoom() {
    if (typeof this.h.onLeaveRoom === 'function') this.h.onLeaveRoom();
  }
  async _copyRoomCode() {
    const code = this._room.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Fallback clipboard lama: textarea sementara + execCommand.
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* abaikan */ }
      ta.remove();
    }
    this.toast(t('roomCopied', this.lang));
  }
  _sendRoomChat() {
    const input = $('room-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (typeof this.h.onSendChat === 'function') this.h.onSendChat(text);
  }
  setRoomCode(code) {
    this._room.code = code;
    $('room-code-display').textContent = code;
    $('room-code-box').classList.remove('hidden');
  }
  // state: { inRoom, code, players: [{username, self}], selfName }
  setRoomState(state) {
    if (!state) return;
    this._room.inRoom = !!state.inRoom;
    if (state.code !== undefined) this._room.code = state.code || null;
    if (Array.isArray(state.players)) this._room.players = state.players;
    if (state.selfName !== undefined) this._room.selfName = state.selfName || null;
    this._renderRoomState();
  }
  _renderRoomState() {
    const r = this._room;
    const status = $('room-status');
    if (!status) return; // setLang sebelum DOM room siap — tidak terjadi di boot normal
    if (r.inRoom && r.code) {
      status.textContent = t('roomInRoom', this.lang, { code: r.code, n: r.players.length });
      $('room-code-display').textContent = r.code;
      $('room-code-box').classList.remove('hidden');
      $('btn-room-create').classList.add('hidden');
      $('btn-room-leave').classList.remove('hidden');
      $('room-join-row').classList.add('hidden');
    } else {
      status.textContent = t('roomSolo', this.lang);
      $('room-code-box').classList.add('hidden');
      $('btn-room-create').classList.remove('hidden');
      $('btn-room-leave').classList.add('hidden');
      $('room-join-row').classList.remove('hidden');
    }
    // Daftar pemain: nama via textContent; "(kamu)" untuk diri sendiri.
    const list = $('room-players');
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const p of r.players) {
      const li = el('li', 'room-player');
      const name = el('span', 'room-player-name', p.username || '');
      li.appendChild(name);
      if (p.self) li.appendChild(el('span', 'room-player-you', ` (${t('roomYou', this.lang)})`));
      list.appendChild(li);
    }
    if (r.players.length === 0) {
      const li = el('li', 'room-player room-player-empty', t('roomNoPlayers', this.lang));
      list.appendChild(li);
    }
    // HUD: indikator "Room ABC123 • 3 pemain" hanya saat di room.
    const ind = $('room-indicator');
    if (r.inRoom && r.code) {
      $('room-indicator-text').textContent = t('roomInRoom', this.lang, { code: r.code, n: r.players.length });
      ind.classList.remove('hidden');
    } else {
      ind.classList.add('hidden');
    }
  }
  addRoomChat(from, text) {
    const cleanFrom = String(from || '').slice(0, 16);
    const cleanText = String(text || '').trim().slice(0, 200);
    if (!cleanText) return;
    this._roomMessages.push({ from: cleanFrom, text: cleanText });
    if (this._roomMessages.length > 5) this._roomMessages.splice(0, this._roomMessages.length - 5);
    this._renderRoomChat();
  }
  _renderRoomChat() {
    const log = $('room-chat-log');
    if (!log) return;
    while (log.firstChild) log.removeChild(log.firstChild);
    if (this._roomMessages.length === 0) {
      log.appendChild(el('p', 'room-chat-empty', t('roomChatEmpty', this.lang)));
      return;
    }
    for (const m of this._roomMessages) {
      const row = el('div', 'room-chat-row-msg');
      row.appendChild(el('span', 'room-chat-from', `${m.from}: `));
      row.appendChild(el('span', 'room-chat-text', m.text));
      log.appendChild(row);
    }
    log.scrollTop = log.scrollHeight;
  }

  // ---------- Akun ----------
  setAuthMode(mode) {
    this._authMode = mode;
    $('tab-login').classList.toggle('active', mode === 'login');
    $('tab-register').classList.toggle('active', mode === 'register');
    $('auth-pin-confirm-wrap').classList.toggle('hidden', mode !== 'register');
    $('btn-auth-submit').textContent = mode === 'login' ? t('loginBtn', this.lang) : t('registerBtn', this.lang);
    $('auth-pin').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    this.setAuthError('');
  }
  setAuthError(msg) {
    const e = $('auth-error');
    e.textContent = msg || '';
    e.classList.toggle('hidden', !msg);
  }
  setAuthBusy(busy) {
    $('btn-auth-submit').disabled = busy;
    $('btn-auth-submit').textContent = busy ? '…' : (this._authMode === 'login' ? t('loginBtn', this.lang) : t('registerBtn', this.lang));
  }
  _submitAuth() {
    const username = $('auth-username').value;
    const pin = $('auth-pin').value;
    const pinConfirm = $('auth-pin-confirm').value;
    this.h.onAuthSubmit(this._authMode, username, pin, pinConfirm);
  }
  // Tampilkan status login di layar awal. username ditampilkan via textContent.
  setAuthState(username) {
    const loggedIn = Boolean(username);
    $('auth-logged-in').classList.toggle('hidden', !loggedIn);
    $('auth-form').classList.toggle('hidden', loggedIn);
    if (loggedIn) $('auth-who').textContent = t('loggedInAs', this.lang, { u: username });
    const acc = $('settings-account');
    if (acc) acc.textContent = loggedIn ? t('loggedInAs', this.lang, { u: username }) : t('offlineNote', this.lang);
  }

  // ---------- Kustomisasi ----------
  openCustomize(state) {
    state = state || this._lastState;
    if (state) {
      this._customGender = state.gender || 'male';
      this._custom = sanitizeCustom(state.custom, this._customGender);
    }
    this._renderCustomOptions();
    $('customize-modal').classList.remove('hidden');
    this._startPreview();
  }
  closeCustomize() {
    $('customize-modal').classList.add('hidden');
    this._stopPreview();
    this.toast(t('customSaved', this.lang));
  }
  _setCustomGender(gender) {
    this._customGender = gender;
    this._custom = sanitizeCustom(this._custom, gender);
    $('custom-male').classList.toggle('active', gender === 'male');
    $('custom-female').classList.toggle('active', gender === 'female');
    this._renderCustomOptions();
    this._rebuildPreview();
    this.h.onCustomChange({ ...this._custom }, gender);
  }
  _renderCustomOptions() {
    const box = $('custom-options');
    while (box.firstChild) box.removeChild(box.firstChild);
    $('custom-male').classList.toggle('active', this._customGender === 'male');
    $('custom-female').classList.toggle('active', this._customGender === 'female');
    for (const row of CUSTOM_ROWS) {
      const wrap = el('div', 'custom-row');
      wrap.appendChild(el('div', 'custom-label', t(row.label, this.lang)));
      if (row.modelKey) {
        const nav = el('div', 'custom-nav');
        const prev = el('button', 'custom-arrow', '‹');
        prev.setAttribute('aria-label', t('prevModel', this.lang));
        const name = el('span', 'custom-model-name');
        const next = el('button', 'custom-arrow', '›');
        next.setAttribute('aria-label', t('nextModel', this.lang));
        const models = row.models;
        const curIdx = () => Math.max(0, models.findIndex((m) => m.id === this._custom[row.modelKey]));
        const show = () => { name.textContent = models[curIdx()].label || models[curIdx()].id; };
        show();
        const step = (d) => {
          const i = (curIdx() + d + models.length) % models.length;
          this._custom[row.modelKey] = models[i].id;
          show();
          this._rebuildPreview();
          this.h.onCustomChange({ ...this._custom }, this._customGender);
        };
        prev.addEventListener('click', () => step(-1));
        next.addEventListener('click', () => step(1));
        nav.append(prev, name, next);
        wrap.appendChild(nav);
      }
      const sw = el('div', 'custom-swatches');
      for (const c of row.colors) {
        const b = el('button', 'swatch' + (this._custom[row.colorKey] === c.id ? ' selected' : ''));
        b.style.backgroundColor = c.hex;
        b.title = c.id;
        b.setAttribute('aria-label', c.id);
        b.addEventListener('click', () => {
          this._custom[row.colorKey] = c.id;
          this._renderCustomOptions();
          this._rebuildPreview();
          this.h.onCustomChange({ ...this._custom }, this._customGender);
        });
        sw.appendChild(b);
      }
      wrap.appendChild(sw);
      box.appendChild(wrap);
    }
    this._customOptionsBuilt = true;
  }
  _startPreview() {
    const canvas = $('custom-preview');
    if (!this._preview) {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xffe9b8); // krem senja — token kertas/emas, bukan oranye datar
      const camera = new THREE.PerspectiveCamera(40, 300 / 340, 0.1, 100);
      camera.position.set(0, 1.6, 5.2);
      camera.lookAt(0, 1.1, 0);
      const sun = new THREE.DirectionalLight(0xffd9a0, 2.0);
      sun.position.set(3, 6, 4);
      scene.add(sun);
      scene.add(new THREE.HemisphereLight(0xfff3d6, 0x6a8f4f, 0.9)); // langit krem hangat, tanah lembah
      const ground = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.3, 0.25, 12),
        new THREE.MeshLambertMaterial({ color: 0x5da244 }),
      );
      ground.position.y = -0.12;
      scene.add(ground);
      this._preview = { renderer, scene, camera, group: null, raf: 0, last: performance.now() };
    }
    this._rebuildPreview();
    const tick = (now) => {
      if ($('customize-modal').classList.contains('hidden')) return;
      const p = this._preview;
      if (!p) return;
      const dt = Math.min(0.05, (now - p.last) / 1000);
      p.last = now;
      if (p.group) p.group.rotation.y += dt * 0.9; // karakter berputar
      p.renderer.render(p.scene, p.camera);
      p.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this._preview.raf);
    this._preview.raf = requestAnimationFrame(tick);
  }
  _rebuildPreview() {
    const p = this._preview;
    if (!p) return;
    if (p.group) { p.scene.remove(p.group); p.group = null; }
    p.group = buildCharacter(this._customGender, this._custom);
    p.group.position.y = 0;
    p.scene.add(p.group);
  }
  _stopPreview() {
    if (this._preview) cancelAnimationFrame(this._preview.raf);
  }

  // ---------- Toko ----------
  openShop(tab, state) {
    state = state || this._lastState;
    if (!state) return;
    this._shopTab = tab || this._shopTab || 'buy';
    this._shopState = state;
    $('tab-buy').classList.toggle('active', this._shopTab === 'buy');
    $('tab-sell').classList.toggle('active', this._shopTab === 'sell');
    const box = $('shop-items');
    while (box.firstChild) box.removeChild(box.firstChild);
    if (this._shopTab === 'buy') {
      const items = [
        ...Object.values(CROPS).map((c) => ({
          key: c.seedKey, icon: c.icon, name: `${t('seeds', this.lang)} ${c.name}`,
          sub: `${c.days} ${this.lang === 'id' ? 'hari' : 'days'} • ${this.lang === 'id' ? 'jual' : 'sells'} ${c.sell} {coin}`,
          price: c.seed, owned: state.inv[c.seedKey] || 0,
        })),
        { key: 'feed', icon: 'wheat', name: t('feed', this.lang),
          sub: this.lang === 'id' ? '1 pakan = 1 ekor/hari' : '1 feed = 1 animal/day',
          price: 2, owned: state.inv.feed || 0 },
      ];
      for (const it of items) this._shopRow(box, it, 'buy');
    } else {
      const items = [
        ...Object.values(CROPS).map((c) => ({
          key: c.id, icon: c.icon, name: c.name, sub: `${c.sell} {coin} / 1`,
          price: c.sell, owned: state.inv[c.id] || 0,
        })),
        { key: 'egg', icon: 'egg', name: ANIMAL_DEFS.ayam.produceName, sub: '8 {coin} / 1', price: 8, owned: state.inv.egg || 0 },
        { key: 'milk', icon: 'milk', name: ANIMAL_DEFS.sapi.produceName, sub: '15 {coin} / 1', price: 15, owned: state.inv.milk || 0 },
      ];
      for (const it of items) this._shopRow(box, it, 'sell');
    }
    this._setShopCoins(state.coins);
    $('shop-modal').classList.remove('hidden');
  }
  _shopRow(box, it, mode) {
    const row = el('div', 'shop-row');
    const info = el('div', 'info');
    const nameEl = el('div', 'name');
    nameEl.appendChild(iconEl(it.icon));
    nameEl.appendChild(document.createTextNode(` ${it.name}`));
    info.appendChild(nameEl);
    const subEl = el('div', 'sub');
    appendRichText(subEl, `${it.sub} • ${this.lang === 'id' ? 'Punya' : 'Owned'}: ${it.owned}`);
    info.appendChild(subEl);
    row.appendChild(info);
    const btn = el('button', 'buy-btn');
    appendRichText(btn, mode === 'buy' ? `${t('buy', this.lang)} ${it.price} {coin}` : `${t('sell', this.lang)} ${it.price} {coin}`);
    btn.disabled = mode === 'sell' ? it.owned < 1 : false;
    btn.addEventListener('click', () => {
      if (mode === 'buy') this.h.onBuy(it.key, it.price, it.name);
      else this.h.onSell(it.key, it.price, it.name);
    });
    row.appendChild(btn);
    box.appendChild(row);
  }
  refreshShop(state) { if (!$('shop-modal').classList.contains('hidden')) this.openShop(this._shopTab, state); }
  closeShop() { $('shop-modal').classList.add('hidden'); }
  // ---- Picker tanaman
  openCropPicker(state, onPick) {
    const box = $('crop-list');
    while (box.firstChild) box.removeChild(box.firstChild);
    for (const c of Object.values(CROPS)) {
      const owned = state.inv[c.seedKey] || 0;
      const row = el('div', 'crop-row');
      const info = el('div', 'info');
      const nameEl = el('div', 'name');
      nameEl.appendChild(iconEl(c.icon));
      nameEl.appendChild(document.createTextNode(` ${c.name}`));
      info.appendChild(nameEl);
      const subEl = el('div', 'sub');
      appendRichText(subEl,
        `${c.days} ${this.lang === 'id' ? 'hari' : 'days'} • ${this.lang === 'id' ? 'jual' : 'sell'} ${c.sell} {coin} • ${this.lang === 'id' ? 'benih' : 'seeds'}: ${owned}`);
      info.appendChild(subEl);
      row.appendChild(info);
      const btn = el('button', 'buy-btn');
      appendRichText(btn, `${this.lang === 'id' ? 'Tanam' : 'Plant'} {sprout}`);
      btn.disabled = owned < 1;
      btn.addEventListener('click', () => { this.closeCropPicker(); onPick(c.id); });
      row.appendChild(btn);
      box.appendChild(row);
    }
    $('crop-modal').classList.remove('hidden');
  }
  closeCropPicker() { $('crop-modal').classList.add('hidden'); }
  // ---- Tidur / pengaturan
  openSleep() { $('sleep-modal').classList.remove('hidden'); }
  closeSleep() { $('sleep-modal').classList.add('hidden'); }
  // Fade malam urutan tidur: #sleep-fade (overlay --lh-night, transisi
  // opacity 1.2 dtk). pointer-events none — tidak pernah menelan input.
  setSleepFade(on) { $('sleep-fade').classList.toggle('on', !!on); }
  openSettings(state) {
    const s = state || this._lastState || {};
    $('setting-lang').value = s.lang || this.lang;
    $('setting-gender').value = s.gender || 'male';
    $('setting-sound').value = s.sound === false ? 'off' : 'on';
    $('setting-quality').value = s.quality || 'medium';
    $('settings-modal').classList.remove('hidden');
  }
  closeSettings() { $('settings-modal').classList.add('hidden'); }
  // ---- Orientasi: overlay "putar ke landscape" (mobile portrait)
  setOrientationOverlay(show) {
    $('orientation-overlay').classList.toggle('hidden', !show);
  }
  showError(msg) {
    const e = $('error-box');
    e.textContent = msg;
    e.classList.remove('hidden');
  }
}
