// ui.js — HUD, dialog, toko, pengaturan, toast, overlay orientasi, akun,
// kustomisasi karakter (preview 3D live). Semua teks lewat i18n (ID/EN).
// Keamanan: data pemain (username dll.) HANYA via textContent — tidak ada
// innerHTML dari data pemain di mana pun di file ini.
import * as THREE from 'three';
import { t, applyI18n, LH_SFX } from './i18n.js';
import { icon } from './icons.js';
import { CROPS } from './farm.js';
import { ANIMAL_DEFS } from './animals.js';
// COZY-C — start: ekonomi baru — harga dinamis, resep olah, pohon buah.
import {
  RECIPES, FERTILISER, SAPLINGS, TREE_DEFS, MACHINE_COOLDOWN_MS,
  demandFor, sellPrice, bestUnit, itemName, itemIcon,
} from './economy.js';
// COZY-C — end
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
import { isValidRoomCode, normalizeRoomCode, MP_ECO_TRADE_ITEMS } from './multiplayer.js';
// COZY-D — NPC + Sosial (Lane D): nama barang hadiah + dagangan pedagang.
import { GIFTABLE, MERCHANT_STOCK } from './npc.js';

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
    // ---- Efek perayaan anime (Lane C, visual saja) ----
    this._fxReduce = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._fxParts = [];
    this._fxRaf = 0;
    this._bind();
  }
  _bind() {
    $('btn-start').addEventListener('click', () => {
      this._celebrate('start', window.innerWidth / 2, window.innerHeight * 0.35);
      this.h.onStart();
    });
    document.querySelectorAll('.char-card').forEach((el2) => {
      el2.addEventListener('click', (e) => {
        document.querySelectorAll('.char-card').forEach((c) => c.classList.remove('selected'));
        el2.classList.add('selected');
        this._celebrate('buy', e.clientX, e.clientY, 0.6);
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
    // COZY-F2 — pemulihan akun (kode pemulihan).
    $('btn-forgot-pin').addEventListener('click', () => this.showRecoveryForm(true));
    $('btn-recovery-back').addEventListener('click', () => this.showRecoveryForm(false));
    $('btn-recovery-submit').addEventListener('click', () => this._submitRecovery());
    $('recovery-pin-confirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') this._submitRecovery(); });
    $('btn-show-recovery-code').addEventListener('click', () => this.h.onShowRecoveryCode());
    $('btn-copy-recovery-code').addEventListener('click', () => this._copyRecoveryCode());
    $('btn-recovery-code-close').addEventListener('click', () => this.hideRecoveryCode());
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
    // COZY-D — NPC + Sosial: tombol "Warga" di HUD (dibangun dinamis —
    // index.html di luar batas lane; teks ikut i18n via data-i18n).
    const hudRight = document.getElementById('hud-right');
    if (hudRight && !document.getElementById('btn-npc')) {
      const b = el('button', 'hud-btn', t('npcTitle', this.lang));
      b.id = 'btn-npc';
      b.setAttribute('data-i18n', 'npcTitle');
      b.addEventListener('click', () => this.openNpcPanel());
      hudRight.appendChild(b);
    }
    // COZY-D — end
    // COZY-C — start: panel olah + picker pohon dibuat di sini (DOM
    // dinamis) supaya index.html tidak disentuh; tab Pasar ditambahkan ke
    // tab toko yang sudah ada. data-i18n supaya ganti bahasa ikut jalan.
    this._buildCraftModal();
    this._buildTreeModal();
    const shopTabs = document.querySelector('#shop-modal .tabs');
    if (shopTabs) {
      const tab = document.createElement('button');
      tab.id = 'tab-market';
      tab.className = 'tab';
      tab.type = 'button';
      tab.setAttribute('data-i18n', 'marketTab');
      tab.textContent = t('marketTab', this.lang);
      tab.addEventListener('click', () => this.openShop('market'));
      shopTabs.appendChild(tab);
    }
    // COZY-C — end
  }
  // COZY-C — start: modal olah + modal pohon (dibangun sekali di _bind).
  _buildCraftModal() {
    const modal = el('div', 'modal hidden');
    modal.id = 'craft-modal';
    const panel = el('div', 'panel modal-panel');
    const h = el('h2');
    h.setAttribute('data-i18n', 'craftTitle');
    h.textContent = t('craftTitle', this.lang);
    panel.appendChild(h);
    const note = el('p');
    note.id = 'craft-note';
    panel.appendChild(note);
    const list = el('div');
    list.id = 'craft-list';
    panel.appendChild(list);
    const close = el('button', 'primary-btn', t('close', this.lang));
    close.id = 'btn-close-craft';
    close.setAttribute('data-i18n', 'close');
    close.addEventListener('click', () => this.closeCraft());
    panel.appendChild(close);
    modal.appendChild(panel);
    document.getElementById('game-container').appendChild(modal);
  }
  _buildTreeModal() {
    const modal = el('div', 'modal hidden');
    modal.id = 'tree-modal';
    const panel = el('div', 'panel modal-panel');
    const h = el('h2');
    h.setAttribute('data-i18n', 'plantTreeWhat');
    h.textContent = t('plantTreeWhat', this.lang);
    panel.appendChild(h);
    const list = el('div');
    list.id = 'tree-list';
    panel.appendChild(list);
    const close = el('button', 'primary-btn', t('cancel', this.lang));
    close.id = 'btn-close-tree';
    close.setAttribute('data-i18n', 'cancel');
    close.addEventListener('click', () => this.closeTreePicker());
    panel.appendChild(close);
    modal.appendChild(panel);
    document.getElementById('game-container').appendChild(modal);
  }
  // COZY-C — end
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
    this._toastCelebrate(msg);
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => e.classList.add('hidden'), ms);
  }

  // ---------- Efek perayaan anime (Lane C) ----------
  // Mekanisme Sakuga (burst di satu canvas overlay + SFX onomatopoeia),
  // tampilan MILIK Lembah Hijau: partikel = kelopak sakura + daun +
  // bintang (bukan asap/shard Sakuga); SFX = kosakata khas lembah
  // (LH_SFX: "PANEN!"/"TING!"/"HAP!"/"YEAY!" — bukan katakana Sakuga).
  // Visual saja: tidak mengubah state, handler, atau teks apa pun.
  // Mati total bila prefers-reduced-motion (this._fxReduce).
  _celebrate(kind, x, y, scale = 1) {
    if (this._fxReduce) return;
    const word = LH_SFX[kind];
    if (word) this._fxSfx(word, x, y);
    this._fxBurst(x, y, scale);
  }
  // Toast momen perayaan ikut meledak: panen / jual-beli / pagi hari /
  // menang. Deteksi kata kunci ID + EN karena toast sudah diterjemahkan.
  _toastCelebrate(msg) {
    if (this._fxReduce || typeof msg !== 'string') return;
    const cx = window.innerWidth / 2, cy = window.innerHeight * 0.32;
    if (/Panen|Harvest/i.test(msg)) this._celebrate('harvest', cx, cy);
    else if (/Terjual|Sold|Dibeli|Bought/i.test(msg)) this._celebrate('buy', cx, cy);
    else if (/Selamat pagi|Good morning|Menang|You win|Dapat ikan|Caught a fish/i.test(msg)) this._celebrate('win', cx, cy);
  }
  _fxSfx(word, x, y) {
    const layer = $('lh-sfx-layer');
    if (!layer) return;
    const s = el('div', 'lh-sfx', word);
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    layer.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
    setTimeout(() => s.remove(), 900); // pengaman bila animationend tak jalan
  }
  _fxBurst(x, y, scale = 1) {
    const canvas = $('lh-fx-canvas');
    if (!canvas) return;
    const host = canvas.parentElement || document.body;
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const COLORS = {
      petal: ['#ff8fb3', '#ff5c8a', '#ffe3ee'],
      leaf: ['#2fbf4a', '#4fc94f'],
      star: ['#ffc93c', '#ff9f1c'],
    };
    const SHAPES = ['petal', 'petal', 'leaf', 'star'];
    const n = Math.round(22 * scale) + 6;
    const rect = canvas.getBoundingClientRect();
    const cx = x - rect.left, cy = y - rect.top;
    for (let i = 0; i < n; i++) {
      const shape = SHAPES[i % SHAPES.length];
      const palette = COLORS[shape];
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 160) * scale;
      this._fxParts.push({
        shape, x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90 * scale,
        rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 8,
        size: (5 + Math.random() * 7) * scale,
        color: palette[Math.floor(Math.random() * palette.length)],
        life: 0, maxLife: 0.55 + Math.random() * 0.35,
      });
    }
    if (!this._fxRaf) this._fxRaf = requestAnimationFrame(() => this._fxTick());
  }
  _fxTick() {
    const canvas = $('lh-fx-canvas');
    this._fxRaf = 0;
    if (!canvas) { this._fxParts = []; return; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    const dt = 1 / 60;
    this._fxParts = this._fxParts.filter((p) => {
      p.life += dt;
      if (p.life >= p.maxLife) return false;
      p.vy += 260 * dt; // gravitasi ringan
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const k = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 'petal') {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.6, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.shape === 'leaf') {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.quadraticCurveTo(p.size * 0.8, 0, 0, p.size);
        ctx.quadraticCurveTo(-p.size * 0.8, 0, 0, -p.size);
        ctx.fill();
      } else { // bintang 4-titik
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.quadraticCurveTo(0, 0, p.size, 0);
        ctx.quadraticCurveTo(0, 0, 0, p.size);
        ctx.quadraticCurveTo(0, 0, -p.size, 0);
        ctx.quadraticCurveTo(0, 0, 0, -p.size);
        ctx.fill();
      }
      ctx.restore();
      return true;
    });
    if (this._fxParts.length > 0) this._fxRaf = requestAnimationFrame(() => this._fxTick());
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
    // COZY-C: chip ikut menampilkan kualitas (Bagus/Langka) bila ada, dan
    // satu chip pasar di ujung: barang paling dicari hari ini (×1,5).
    // Semua chip tetap .inv-chip yang sama — tanpa CSS baru, tanpa tabrakan
    // di 390px (inv-bar sudah flex-wrap + disembunyikan di layar pendek).
    const qStr = (id) => {
      const q = state.invQ && state.invQ[id];
      if (!q) return '';
      const parts = [];
      if (q.good > 0) parts.push(`${t('qualityGood', this.lang)} ×${q.good}`);
      if (q.rare > 0) parts.push(`${t('qualityRare', this.lang)} ×${q.rare}`);
      return parts.length ? ` (${parts.join(' • ')})` : '';
    };
    const add = (iconName, n, label, qid) => {
      if (n > 0) {
        const chip = el('span', 'inv-chip');
        chip.appendChild(iconEl(iconName));
        chip.appendChild(document.createTextNode(` ${label} ×${n}${qid ? qStr(qid) : ''}`));
        bar.appendChild(chip);
      }
    };
    add('sprout', inv.carrotSeed, 'Wortel'); add('sprout', inv.tomatoSeed, 'Tomat'); add('sprout', inv.pumpkinSeed, 'Labu');
    add('wheat', inv.wheatSeed, t('wheat', this.lang)); add('sprout', inv.strawberrySeed, t('strawberry', this.lang));
    add('wheat', inv.feed, t('feed', this.lang));
    add('carrot', inv.carrot, 'Wortel', 'carrot'); add('tomato', inv.tomato, 'Tomat', 'tomato'); add('pumpkin', inv.pumpkin, 'Labu', 'pumpkin');
    add('wheat', inv.wheat, t('wheat', this.lang), 'wheat'); add('tomato', inv.strawberry, t('strawberry', this.lang), 'strawberry');
    add('tomato', inv.apple, t('apple', this.lang), 'apple'); add('pumpkin', inv.orange, t('orange', this.lang), 'orange');
    add('egg', inv.egg, 'Telur', 'egg'); add('milk', inv.milk, 'Susu', 'milk');
    // COZY-D — NPC + Sosial: Telur Emas (barang langka pedagang keliling).
    add('egg', inv.goldenEgg, 'Telur Emas');
    add('milk', inv.cheese, t('cheese', this.lang)); add('tomato', inv.sauce, t('sauce', this.lang)); add('wheat', inv.flour, t('flour', this.lang));
    add('leaf', inv.fertiliser, t('fertiliser', this.lang));
    add('tomato', inv.appleSapling, t('saplingApple', this.lang)); add('pumpkin', inv.orangeSapling, t('saplingOrange', this.lang));
    const dmd = demandFor(state.day);
    const multTxt = this.lang === 'id' ? '×1,5' : '×1.5';
    const marketChip = el('span', 'inv-chip');
    marketChip.appendChild(iconEl('coin'));
    marketChip.appendChild(document.createTextNode(` ${t('marketTab', this.lang)}: ${dmd.wanted.map((id) => itemName(id, this.lang)).join(' • ')} ${multTxt}`));
    bar.appendChild(marketChip);
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
  // rumput #4fc94f (valley), sungai #3fa9f5 (sky), jalan/kayu #8a6b3f,
  // emas #ffc93c (sun) hanya untuk rumah pemain + titik pemain. Sumbu peta: x → kanan, z → bawah (utara di atas).
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
    const WATER = '#3fa9f5', GRASS = '#4fc94f', DIRT = '#8a6b3f', WOOD = '#8a6b3f';
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
      ctx.fillStyle = '#e8cfa8'; // tanah olahan — hairline krem
      rect(data.farm);
      ctx.strokeStyle = '#1d2b53'; // garis petak — ink
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
      ctx.fillStyle = '#fff6e5'; // kandang — paper
      rect(data.pen);
      ctx.strokeStyle = WOOD;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(data.pen.x - data.pen.w / 2), Z(data.pen.z - data.pen.d / 2), data.pen.w * s, data.pen.d * s);
    }
    // Pasar malam (NIGHT MARKET P): rect zona gelap hangat + garis emas +
    // titik wahana/game + stan jajanan. Data dari world.minimapData.
    if (data.nightmarket) {
      const nm = data.nightmarket;
      ctx.fillStyle = '#141b3d'; // pasar malam — night
      ctx.fillRect(X(nm.rect.minX), Z(nm.rect.minZ),
        (nm.rect.maxX - nm.rect.minX) * s, (nm.rect.maxZ - nm.rect.minZ) * s);
      ctx.strokeStyle = '#ffc93c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(nm.rect.minX), Z(nm.rect.minZ),
        (nm.rect.maxX - nm.rect.minX) * s, (nm.rect.maxZ - nm.rect.minZ) * s);
      ctx.fillStyle = '#ffc93c';
      for (const r of nm.rides) {
        ctx.beginPath(); ctx.arc(X(r.x), Z(r.z), 2, 0, Math.PI * 2); ctx.fill();
      }
      if (nm.stalls) {
        for (let z = nm.stalls.zFrom; z <= nm.stalls.zTo; z += nm.stalls.step) {
          ctx.beginPath(); ctx.arc(X(nm.stalls.x), Z(z), 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (nm.gate) {
        ctx.fillStyle = '#fff6e5';
        ctx.fillRect(X(nm.gate.x) - 2, Z(nm.gate.z) - 2, 4, 4);
      }
    }
    // Rumah: rumah pemain emas, rumah lain kayu. Toko: daun.
    for (const h of data.houses) {
      ctx.fillStyle = h.player ? '#ffc93c' : WOOD;
      rect(h);
      ctx.strokeStyle = '#1d2b53';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(h.x - h.w / 2), Z(h.z - h.d / 2), h.w * s, h.d * s);
    }
    if (data.shop) {
      ctx.fillStyle = '#2fbf4a'; // toko — leaf
      rect(data.shop);
      ctx.strokeStyle = '#1d2b53';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(data.shop.x - data.shop.w / 2), Z(data.shop.z - data.shop.d / 2), data.shop.w * s, data.shop.d * s);
    }
    // Kincir (baling-baling) / sumur (lingkaran air + ring kayu).
    if (data.windmill) {
      const wx = X(data.windmill.x), wz = Z(data.windmill.z);
      ctx.strokeStyle = '#1d2b53';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(wx - 4, wz - 4); ctx.lineTo(wx + 4, wz + 4);
      ctx.moveTo(wx + 4, wz - 4); ctx.lineTo(wx - 4, wz + 4);
      ctx.stroke();
      ctx.fillStyle = '#1d2b53';
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
      ctx.fillStyle = 'rgba(255, 246, 229, .9)';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffc93c';
      ctx.strokeStyle = '#1d2b53';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // COZY-F2 — titik warga (opsional, zero-risk): titik sakura-pink per
    // NPC yang sedang terlihat (pedagang keliling hanya di jam dagang —
    // group.visible false di luar jam, jadi tidak digambar). Baca langsung
    // dari window.__LH_GAME (pola yang sama dengan _resolveMinimap);
    // semua guard defensif — gagal baca = minimap tetap jalan tanpa titik.
    try {
      const g = typeof window !== 'undefined' ? window.__LH_GAME : null;
      const npcs = g && g.npc && Array.isArray(g.npc.npcs) ? g.npc.npcs : null;
      if (npcs) {
        for (const npc of npcs) {
          if (!npc || !npc.group || !npc.group.visible) continue;
          if (typeof npc.x !== 'number' || typeof npc.z !== 'number') continue;
          ctx.fillStyle = '#ff8fb3'; // sakura — warga desa
          ctx.strokeStyle = '#1d2b53';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(X(npc.x), Z(npc.z), 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    } catch (e) { /* minimap tetap jalan tanpa titik warga */ }
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
        ctx.fillStyle = '#ffc93c';
        ctx.strokeStyle = '#1d2b53';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(rx, ry, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (cssW >= 140 && rp.username) {
          const label = String(rp.username).slice(0, 8);
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,246,229,.9)';
          ctx.strokeText(label, rx, ry - 8);
          ctx.fillStyle = '#1d2b53';
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
    // COZY-E — start: bangun seksi ekonomi bareng + cek ketersediaan server.
    this._ensureMpEco();
    if (typeof this.h.onRoomOpened === 'function') this.h.onRoomOpened();
    // COZY-E — end
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
      // COZY-E — start: tombol aksi per pemain lain (Kunjungi / Tukar).
      if (!p.self && r.inRoom) {
        const acts = el('span', 'room-player-actions');
        const btnVisit = el('button', 'primary-btn secondary', t('mpVisit', this.lang));
        btnVisit.addEventListener('click', () => {
          if (typeof this.h.onMpVisit === 'function') this.h.onMpVisit(p.username);
        });
        const btnTrade = el('button', 'primary-btn secondary', t('mpTrade', this.lang));
        btnTrade.addEventListener('click', () => this.openMpTrade(p.username));
        acts.append(btnVisit, btnTrade);
        li.appendChild(acts);
      }
      // COZY-E — end
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

  // ---------- COZY-D — NPC + Sosial: dialog + panel warga ----------
  // Semua DOM dibangun dinamis di sini (index.html di luar batas lane).
  // Memakai kelas yang sudah ada (.modal/.panel/.primary-btn/.shop-row)
  // + token warna proyek — tanpa CSS baru, tanpa innerHTML dari data
  // pemain (semua teks via textContent). Dialog = modal; panel warga =
  // modal dengan daftar pertemanan + quest.
  _ensureNpcDom() {
    if (this._npcDlg) return;
    const mkModal = (id) => {
      const m = el('div', 'modal hidden');
      m.id = id;
      const p = el('div', 'panel modal-panel');
      m.appendChild(p);
      document.getElementById('game-container').appendChild(m);
      return { m, p };
    };
    const dlg = mkModal('npc-dialogue-modal');
    const panel = mkModal('npc-panel-modal');
    this._npcDlg = dlg;
    this._npcPanel = panel;
    this._dlg = null; // { npcId, nodeId }
  }
  openDialogue(npcId) {
    this._ensureNpcDom();
    const node = typeof this.h.onNpcTalk === 'function' ? this.h.onNpcTalk(npcId) : null;
    if (!node) return;
    this._dlg = { npcId, nodeId: node.nodeId };
    this._renderDialogue(node);
    this._npcDlg.m.classList.remove('hidden');
  }
  closeDialogue() {
    if (this._npcDlg) this._npcDlg.m.classList.add('hidden');
    if (typeof this.h.onNpcEndTalk === 'function') this.h.onNpcEndTalk();
    this._dlg = null;
  }
  _dlgText(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj[this.lang] || obj.id || '';
  }
  _renderDialogue(node) {
    const { p } = this._npcDlg;
    while (p.firstChild) p.removeChild(p.firstChild);
    p.appendChild(el('h2', null, node.speaker || ''));
    const job = node.job ? this._dlgText(node.job) : '';
    if (job) {
      const j = el('p', 'room-desc', job);
      p.appendChild(j);
    }
    const body = el('p', 'room-desc', this._dlgText(node.text));
    body.style.color = 'var(--lh-ink)';
    body.style.fontWeight = '600';
    p.appendChild(body);
    const wrap = el('div', 'row-btns');
    wrap.style.flexDirection = 'column';
    for (let i = 0; i < (node.choices || []).length; i++) {
      const c = node.choices[i];
      const b = el('button', 'primary-btn', this._dlgText(c.label));
      b.style.width = '100%';
      b.addEventListener('click', () => this._dlgChoice(i));
      wrap.appendChild(b);
    }
    p.appendChild(wrap);
    this._dlg = { npcId: node.npcId, nodeId: node.nodeId };
  }
  _dlgChoice(idx) {
    if (!this._dlg) return;
    const { npcId, nodeId } = this._dlg;
    const res = typeof this.h.onNpcChoice === 'function'
      ? this.h.onNpcChoice(npcId, nodeId, idx) : { action: 'close' };
    if (res.action === 'close') { this.closeDialogue(); return; }
    if (res.action === 'gift') { this._renderGiftView(npcId); return; }
    if (res.action === 'shop') { this._renderMerchantView(npcId); return; }
    if (res.action === 'node' && res.node) { this._renderDialogue(res.node); return; }
    this.closeDialogue();
  }
  _dlgBack(npcId) {
    const node = typeof this.h.onNpcRoot === 'function' ? this.h.onNpcRoot(npcId) : null;
    if (node) this._renderDialogue(node);
    else this.closeDialogue();
  }
  _renderGiftView(npcId) {
    const { p } = this._npcDlg;
    while (p.firstChild) p.removeChild(p.firstChild);
    p.appendChild(el('h2', null, t('npcGift', this.lang)));
    const list = typeof this.h.onNpcGiftables === 'function' ? this.h.onNpcGiftables() : [];
    if (!list.length) {
      p.appendChild(el('p', 'room-desc', t('npcNoGift', this.lang)));
    } else {
      for (const g of list) {
        const def = GIFTABLE.find((x) => x.key === g.key) || { name: { id: g.key, en: g.key } };
        const row = el('div', 'shop-row');
        const info = el('div', 'info');
        info.appendChild(el('div', 'name', `${this._dlgText(def.name)} ×${g.owned}`));
        row.appendChild(info);
        const b = el('button', 'buy-btn', t('npcGift', this.lang));
        b.addEventListener('click', () => {
          const r = this.h.onNpcGift(npcId, g.key);
          if (r && r.ok) this._dlgBack(npcId);
          else this._renderGiftView(npcId);
        });
        row.appendChild(b);
        p.appendChild(row);
      }
    }
    const back = el('button', 'primary-btn secondary', t('cancel', this.lang));
    back.addEventListener('click', () => this._dlgBack(npcId));
    const wrap = el('div', 'row-btns');
    wrap.appendChild(back);
    p.appendChild(wrap);
  }
  _renderMerchantView(npcId) {
    const { p } = this._npcDlg;
    while (p.firstChild) p.removeChild(p.firstChild);
    p.appendChild(el('h2', null, t('npcMerchantShop', this.lang)));
    const coins = this._lastState ? this._lastState.coins : 0;
    for (const item of MERCHANT_STOCK) {
      const row = el('div', 'shop-row');
      const info = el('div', 'info');
      info.appendChild(el('div', 'name', this._dlgText(item.name)));
      const sub = el('div', 'sub');
      appendRichText(sub, `${item.price} {coin}`);
      info.appendChild(sub);
      row.appendChild(info);
      const b = el('button', 'buy-btn', t('buy', this.lang));
      b.disabled = coins < item.price;
      b.addEventListener('click', () => {
        const r = this.h.onNpcBuy(item.key);
        if (r && r.ok) { this.updateHUD(this._lastState); this._renderMerchantView(npcId); }
      });
      row.appendChild(b);
      p.appendChild(row);
    }
    const back = el('button', 'primary-btn secondary', t('cancel', this.lang));
    back.addEventListener('click', () => this._dlgBack(npcId));
    const wrap = el('div', 'row-btns');
    wrap.appendChild(back);
    p.appendChild(wrap);
  }
  openNpcPanel() {
    this._ensureNpcDom();
    const data = typeof this.h.onNpcPanelData === 'function' ? this.h.onNpcPanelData() : null;
    if (!data) return;
    const { p } = this._npcPanel;
    while (p.firstChild) p.removeChild(p.firstChild);
    p.appendChild(el('h2', null, t('npcPanelTitle', this.lang)));
    // Status festival + pedagang.
    const fest = data.festival.active
      ? t('npcFestivalToday', this.lang)
      : t('npcFestivalNext', this.lang, { d: data.festival.day + (7 - (data.festival.day % 7)) });
    p.appendChild(el('p', 'room-desc', fest));
    const merch = data.merchant.present
      ? t('npcMerchantHere', this.lang)
      : t('npcMerchantNext', this.lang, { d: data.merchant.nextDay });
    const merchEl = el('p', 'room-desc', merch);
    merchEl.style.fontWeight = '700';
    p.appendChild(merchEl);
    // Daftar warga + pertemanan.
    p.appendChild(el('h3', 'room-section-title', t('npcFriends', this.lang)));
    for (const n of data.npcs) {
      const row = el('div', 'shop-row');
      const info = el('div', 'info');
      info.appendChild(el('div', 'name', `${n.name} — ${this._dlgText(n.job)}`));
      const lvlKey = n.level === 2 ? 'npcLvl2' : n.level === 1 ? 'npcLvl1' : 'npcLvl0';
      const likes = n.likes.map((k) => {
        const g = GIFTABLE.find((x) => x.key === k);
        return g ? this._dlgText(g.name) : k;
      }).join(', ');
      const sub = el('div', 'sub', `${t(lvlKey, this.lang)} • ${n.fp} pts${n.giftedToday ? ` • ${t('npcGiftedToday', this.lang)}` : ''} • ${t('npcLikes', this.lang, { items: likes })}`);
      info.appendChild(sub);
      row.appendChild(info);
      p.appendChild(row);
    }
    // Quest harian + mingguan.
    const questSection = (titleKey, list) => {
      p.appendChild(el('h3', 'room-section-title', t(titleKey, this.lang)));
      if (!list.length) {
        p.appendChild(el('p', 'room-desc', '—'));
        return;
      }
      for (const q of list) {
        const row = el('div', 'shop-row');
        const info = el('div', 'info');
        info.appendChild(el('div', 'name', this._dlgText(q.text)));
        const sub = el('div', 'sub',
          q.done ? t('npcQuestDoneShort', this.lang)
            : `${q.progress}/${q.need} • ${t('npcQuestReward', this.lang, { n: q.reward ? q.reward.coins : 0 })}`);
        info.appendChild(sub);
        row.appendChild(info);
        p.appendChild(row);
      }
    };
    questSection('npcDaily', data.daily);
    questSection('npcWeekly', data.weekly);
    const close = el('button', 'primary-btn', t('close', this.lang));
    close.addEventListener('click', () => this.closeNpcPanel());
    const wrap = el('div', 'row-btns');
    wrap.appendChild(close);
    p.appendChild(wrap);
    this._npcPanel.m.classList.remove('hidden');
  }
  closeNpcPanel() {
    if (this._npcPanel) this._npcPanel.m.classList.add('hidden');
  }
  // ---------- COZY-D end ----------
  // ---------- COZY-E — Ekonomi multiplayer di dalam modal room ----------
  // Semua seksi dibangun dinamis di sini (tidak ada markup baru di
  // index.html): panel memakai class yang sudah ada (.room-section-title,
  // .primary-btn, .room-players) + warna token --lh-*; grid kebun adalah
  // visualnya (kotak tanah/tanaman, bukan kartu statistik). Semua data
  // pemain dirender via textContent. Bila endpoint server belum ada (404)
  // seksi menampilkan "segera hadir" dan tombol dimatikan — game tetap jalan.
  _mpItemLabel(item) {
    const key = 'mpItem' + item[0].toUpperCase() + item.slice(1);
    return t(key, this.lang);
  }
  _mpCropColor(crop) {
    return { carrot: '#e87a2a', tomato: '#d9382b', pumpkin: '#e8912a' }[crop] || '#6e4a26';
  }
  _ensureMpEco() {
    if (this._mpEcoBuilt) { this._renderMpEcoStatus(); return; }
    this._mpEcoBuilt = true;
    this._mpAvailable = null; // null=belum tahu, true=ada, false=segera hadir
    const panel = document.querySelector('#room-modal .room-panel');
    const closeBtn = $('btn-close-room');
    const wrap = el('div', 'mp-eco');
    wrap.id = 'mp-eco';
    const title = el('h3', 'room-section-title', t('mpEcoTitle', this.lang));
    this._mpStatus = el('p', 'room-status');
    const btnRow = el('div', 'row-btns');
    this._mpGameBtn = el('button', 'primary-btn', t('mpGameStart', this.lang));
    this._mpGameBtn.id = 'btn-mp-game';
    this._mpGameBtn.addEventListener('click', () => {
      if (typeof this.h.onMpGameStart === 'function') this.h.onMpGameStart();
    });
    this._mpBoardBtn = el('button', 'primary-btn secondary', t('mpLeaderboard', this.lang));
    this._mpBoardBtn.id = 'btn-mp-board';
    this._mpBoardBtn.addEventListener('click', () => {
      if (typeof this.h.onMpLeaderboard === 'function') this.h.onMpLeaderboard();
    });
    btnRow.append(this._mpGameBtn, this._mpBoardBtn);
    // Panel minigame "Panen Cepat".
    this._mpGamePanel = el('div', 'mp-game-panel hidden');
    this._mpGamePanel.id = 'mp-game-panel';
    this._mpGameTitle = el('p', 'room-status', t('mpGameTitle', this.lang));
    this._mpGameTime = el('p', 'room-status');
    this._mpGameScore = el('p', 'room-status', t('mpGameScore', this.lang, { n: 0 }));
    this._mpGameTap = el('button', 'primary-btn', t('mpGameTap', this.lang));
    this._mpGameTap.style.fontSize = '28px';
    this._mpGameTap.style.minHeight = '64px';
    this._mpGameTap.style.width = '100%';
    this._mpGameTap.addEventListener('click', () => {
      if (typeof this.h.onMpGameTap === 'function') {
        const s = this.h.onMpGameTap();
        this._mpGameScore.textContent = t('mpGameScore', this.lang, { n: s });
      }
    });
    this._mpGameStandings = el('ul', 'room-players');
    this._mpGameResult = el('p', 'room-status');
    this._mpGamePanel.append(
      this._mpGameTitle, this._mpGameTime, this._mpGameScore,
      this._mpGameTap, this._mpGameStandings, this._mpGameResult,
    );
    // Daftar peringkat.
    this._mpBoardList = el('ul', 'room-players');
    this._mpBoardList.id = 'mp-board-list';
    // Snapshot kebun yang dikunjungi (grid 6x4 + hewan).
    this._mpGardenPanel = el('div', 'mp-garden-panel hidden');
    this._mpGardenPanel.id = 'mp-garden-panel';
    this._mpGardenTitle = el('p', 'room-status');
    this._mpGardenGrid = el('div', 'mp-garden-grid');
    this._mpGardenGrid.style.display = 'grid';
    this._mpGardenGrid.style.gridTemplateColumns = 'repeat(6, 1fr)';
    this._mpGardenGrid.style.gap = '4px';
    this._mpGardenGrid.style.maxWidth = '360px';
    this._mpGardenAnimals = el('p', 'room-status');
    this._mpGardenPanel.append(this._mpGardenTitle, this._mpGardenGrid, this._mpGardenAnimals);
    // Panel tukar (pilih item + jumlah).
    this._mpTradePanel = el('div', 'mp-trade-panel hidden');
    this._mpTradePanel.id = 'mp-trade-panel';
    this._mpTradeTitle = el('p', 'room-status');
    const giveRow = el('div', 'room-chat-row');
    giveRow.appendChild(el('span', 'room-player-name', t('mpTradeGive', this.lang)));
    this._mpGiveSel = document.createElement('select');
    this._mpGiveQty = document.createElement('input');
    this._mpGiveQty.type = 'number'; this._mpGiveQty.min = '1'; this._mpGiveQty.max = '99';
    this._mpGiveQty.value = '1'; this._mpGiveQty.setAttribute('aria-label', t('mpTradeGive', this.lang));
    giveRow.append(this._mpGiveSel, this._mpGiveQty);
    const wantRow = el('div', 'room-chat-row');
    wantRow.appendChild(el('span', 'room-player-name', t('mpTradeWant', this.lang)));
    this._mpWantSel = document.createElement('select');
    this._mpWantQty = document.createElement('input');
    this._mpWantQty.type = 'number'; this._mpWantQty.min = '1'; this._mpWantQty.max = '99';
    this._mpWantQty.value = '1'; this._mpWantQty.setAttribute('aria-label', t('mpTradeWant', this.lang));
    wantRow.append(this._mpWantSel, this._mpWantQty);
    this._mpTradeBtn = el('button', 'primary-btn', t('mpTradePropose', this.lang));
    this._mpTradeBtn.addEventListener('click', () => {
      if (typeof this.h.onMpTradePropose !== 'function') return;
      const offer = { item: this._mpGiveSel.value, qty: Math.max(1, Math.min(99, Number(this._mpGiveQty.value) || 1)) };
      const want = { item: this._mpWantSel.value, qty: Math.max(1, Math.min(99, Number(this._mpWantQty.value) || 1)) };
      const inv = typeof this.h.getMpInv === 'function' ? this.h.getMpInv() : {};
      if ((inv[offer.item] || 0) < offer.qty) { this.toast(t('mpTradeNeedItem', this.lang)); return; }
      this.h.onMpTradePropose(this._mpTradeTarget, offer, want);
    });
    this._mpTradePending = el('p', 'room-status');
    this._mpTradePanel.append(this._mpTradeTitle, giveRow, wantRow, this._mpTradeBtn, this._mpTradePending);
    // Panel tawaran masuk (terima / tolak).
    this._mpOfferPanel = el('div', 'mp-offer-panel hidden');
    this._mpOfferPanel.id = 'mp-offer-panel';
    this._mpOfferText = el('p', 'room-status');
    const offerRow = el('div', 'row-btns');
    this._mpOfferAccept = el('button', 'primary-btn', t('mpTradeAccept', this.lang));
    this._mpOfferAccept.addEventListener('click', () => {
      if (this._mpOffer && typeof this.h.onMpTradeAccept === 'function') this.h.onMpTradeAccept(this._mpOffer.offerId);
    });
    this._mpOfferDecline = el('button', 'primary-btn secondary', t('mpTradeDecline', this.lang));
    this._mpOfferDecline.addEventListener('click', () => {
      if (this._mpOffer && typeof this.h.onMpTradeDecline === 'function') this.h.onMpTradeDecline(this._mpOffer.offerId);
    });
    offerRow.append(this._mpOfferAccept, this._mpOfferDecline);
    this._mpOfferPanel.append(this._mpOfferText, offerRow);
    wrap.append(
      title, this._mpStatus, btnRow, this._mpGamePanel,
      this._mpBoardList, this._mpGardenPanel, this._mpTradePanel, this._mpOfferPanel,
    );
    panel.insertBefore(wrap, closeBtn);
    this._renderMpEcoStatus();
  }
  _renderMpEcoStatus() {
    if (!this._mpStatus) return;
    const loggedIn = typeof this.h.getMpSession === 'function' ? this.h.getMpSession() : false;
    if (this._mpAvailable === false) {
      this._mpStatus.textContent = t('mpComingSoon', this.lang);
    } else if (!loggedIn) {
      this._mpStatus.textContent = t('mpNeedLogin', this.lang);
    } else {
      this._mpStatus.textContent = '';
    }
    const disabled = this._mpAvailable === false || !loggedIn;
    if (this._mpGameBtn) this._mpGameBtn.disabled = disabled;
    if (this._mpBoardBtn) this._mpBoardBtn.disabled = disabled;
  }
  setMpAvailable(avail) {
    this._mpAvailable = !!avail;
    this._renderMpEcoStatus();
  }
  showMpGarden(garden, visit) {
    this._ensureMpEco();
    this._mpGardenTitle.textContent = `${garden.username} — ${t('mpGardenDay', this.lang, { d: garden.day })}`;
    while (this._mpGardenGrid.firstChild) this._mpGardenGrid.removeChild(this._mpGardenGrid.firstChild);
    for (const p of garden.plots || []) {
      const cell = el('div', 'mp-plot');
      cell.style.aspectRatio = '1';
      cell.style.border = '2px solid #1d2b53';
      cell.style.borderRadius = '6px';
      cell.style.backgroundColor = p.crop ? this._mpCropColor(p.crop) : (p.hoed ? '#4a2f16' : '#6e4a26');
      cell.style.opacity = p.crop ? String(0.55 + 0.15 * (p.growth || 0)) : '1';
      cell.style.display = 'flex';
      cell.style.alignItems = 'center';
      cell.style.justifyContent = 'center';
      cell.style.color = '#fff6e5';
      cell.style.fontWeight = '800';
      cell.textContent = p.crop ? String(p.growth || 0) : '';
      cell.title = p.crop ? `${this._mpItemLabel(p.crop)} ${p.growth || 0}` : '';
      this._mpGardenGrid.appendChild(cell);
    }
    const byKind = {};
    for (const a of garden.animals || []) {
      byKind[a.kind] = byKind[a.kind] || { n: 0, ready: 0 };
      byKind[a.kind].n += 1;
      byKind[a.kind].ready += a.ready || 0;
    }
    const kindName = { ayam: { id: 'Ayam', en: 'Chicken' }, sapi: { id: 'Sapi', en: 'Cow' } };
    const parts = Object.entries(byKind).map(([k, v]) => {
      const nm = (kindName[k] || { id: k, en: k })[this.lang] || k;
      return `${nm} ×${v.n} (${v.ready} ${t('mpReady', this.lang)})`;
    });
    this._mpGardenAnimals.textContent = parts.length
      ? parts.join(' • ')
      : t('mpGardenAnimals', this.lang, { n: 0 });
    this._mpGardenPanel.classList.remove('hidden');
  }
  openMpTrade(username) {
    this._ensureMpEco();
    this._mpTradeTarget = username;
    this._mpTradeTitle.textContent = `${t('mpTrade', this.lang)} — ${username}`;
    const inv = typeof this.h.getMpInv === 'function' ? this.h.getMpInv() : {};
    for (const sel of [this._mpGiveSel, this._mpWantSel]) {
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      for (const item of MP_ECO_TRADE_ITEMS) {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = sel === this._mpGiveSel
          ? `${this._mpItemLabel(item)} (${inv[item] || 0})`
          : this._mpItemLabel(item);
        sel.appendChild(opt);
      }
    }
    const firstOwned = MP_ECO_TRADE_ITEMS.find((it) => (inv[it] || 0) > 0);
    if (firstOwned) this._mpGiveSel.value = firstOwned;
    this._mpTradePending.textContent = '';
    this._mpTradePanel.classList.remove('hidden');
  }
  setMpTradePending(pending) {
    if (!this._mpTradePanel) return;
    this._mpTradePending.textContent = pending
      ? t('mpTradePending', this.lang, { u: pending.to })
      : '';
  }
  showMpTradeOffer(offer) {
    this._ensureMpEco();
    this._mpOffer = offer;
    const give = `${offer.offer.qty} ${this._mpItemLabel(offer.offer.item)}`;
    const want = `${offer.want.qty} ${this._mpItemLabel(offer.want.item)}`;
    this._mpOfferText.textContent = `${t('mpTradeOfferFrom', this.lang, { u: offer.from })} ${give} ↔ ${want}`;
    this._mpOfferPanel.classList.remove('hidden');
  }
  hideMpTradeOffer() {
    this._mpOffer = null;
    if (this._mpOfferPanel) this._mpOfferPanel.classList.add('hidden');
  }
  showMpGame(room, endsAt) {
    this._ensureMpEco();
    this._mpGameEndsAt = endsAt;
    this._mpGameScore.textContent = t('mpGameScore', this.lang, { n: 0 });
    this._mpGameResult.textContent = '';
    while (this._mpGameStandings.firstChild) this._mpGameStandings.removeChild(this._mpGameStandings.firstChild);
    this._mpGamePanel.classList.remove('hidden');
    if (this._mpGameTick) clearInterval(this._mpGameTick);
    this._mpGameTick = setInterval(() => {
      if (!this._mpGameEndsAt) return;
      const left = Math.max(0, Math.ceil((this._mpGameEndsAt - Date.now()) / 1000));
      this._mpGameTime.textContent = t('mpGameTime', this.lang, { n: left });
      if (left <= 0) {
        clearInterval(this._mpGameTick);
        this._mpGameTick = null;
        this._mpGameTime.textContent = t('mpGameWaiting', this.lang);
      }
    }, 250);
  }
  setMpGameScores(scores) {
    if (!this._mpGameStandings) return;
    while (this._mpGameStandings.firstChild) this._mpGameStandings.removeChild(this._mpGameStandings.firstChild);
    const rows = Object.entries(scores || {}).sort((a, b) => b[1] - a[1]);
    for (const [u, s] of rows) {
      this._mpGameStandings.appendChild(el('li', 'room-player', `${u} — ${s}`));
    }
  }
  showMpGameResults(data) {
    this._ensureMpEco();
    if (this._mpGameTick) { clearInterval(this._mpGameTick); this._mpGameTick = null; }
    this._mpGameTime.textContent = '';
    const lines = [];
    if (data.winner) lines.push(t('mpGameWinner', this.lang, { u: data.winner }));
    if (data.reward > 0) lines.push(t('mpGameReward', this.lang, { n: data.reward }));
    if (typeof data.score === 'number') {
      lines.push(t('mpGameScore', this.lang, { n: data.score }));
    }
    if (Array.isArray(data.scores) && data.scores.length) {
      lines.push(data.scores.map((r) => `${r.username} ${r.score}`).join(' • '));
    }
    this._mpGameResult.textContent = lines.join(' — ');
    this._mpGamePanel.classList.remove('hidden');
  }
  showMpLeaderboard(board) {
    this._ensureMpEco();
    while (this._mpBoardList.firstChild) this._mpBoardList.removeChild(this._mpBoardList.firstChild);
    if (!board || board.length === 0) {
      this._mpBoardList.appendChild(el('li', 'room-player room-player-empty', t('mpLeaderboardEmpty', this.lang)));
      return;
    }
    board.forEach((row, i) => {
      const li = el('li', 'room-player',
        `${i + 1}. ${row.username} — ${row.coins} ${t('mpCoins', this.lang)} • ${t('mpLeaderboardTrades', this.lang, { n: row.trades || 0 })}`);
      this._mpBoardList.appendChild(li);
    });
  }
  // COZY-E — end

  // ---------- Akun ----------
  setAuthMode(mode) {
    this._authMode = mode;
    $('tab-login').classList.toggle('active', mode === 'login');
    $('tab-register').classList.toggle('active', mode === 'register');
    $('auth-pin-confirm-wrap').classList.toggle('hidden', mode !== 'register');
    $('btn-auth-submit').textContent = mode === 'login' ? t('loginBtn', this.lang) : t('registerBtn', this.lang);
    $('auth-pin').setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    // COZY-F2: "Lupa PIN?" hanya relevan di mode Masuk; ganti mode
    // menutup form pemulihan supaya tidak tertinggal terbuka.
    $('btn-forgot-pin').classList.toggle('hidden', mode !== 'login');
    this.showRecoveryForm(false);
    this.setAuthError('');
  }
  // COZY-F2 — form pemulihan akun (ganti tampilan form login <-> pulih).
  showRecoveryForm(show) {
    $('recovery-form').classList.toggle('hidden', !show);
    $('auth-form').classList.toggle('hidden', show);
    $('btn-forgot-pin').classList.toggle('hidden', show);
    if (show) {
      this.setRecoveryError('');
      $('recovery-username').value = $('auth-username').value;
    }
  }
  setRecoveryError(msg) {
    const e = $('recovery-error');
    e.textContent = msg || '';
    e.classList.toggle('hidden', !msg);
  }
  setRecoveryBusy(busy) {
    $('btn-recovery-submit').disabled = busy;
    $('btn-recovery-submit').textContent = busy ? '…' : t('recoverBtn', this.lang);
  }
  _submitRecovery() {
    this.h.onAuthRecover(
      $('recovery-username').value,
      $('recovery-code').value,
      $('recovery-pin').value,
      $('recovery-pin-confirm').value,
    );
  }
  // COZY-F2 — modal kode pemulihan (sekali tampil; kode TIDAK disimpan).
  showRecoveryCode(code) {
    $('recovery-code-value').textContent = code || '';
    $('btn-copy-recovery-code').textContent = t('copyCode', this.lang);
    $('recovery-code-modal').classList.remove('hidden');
  }
  hideRecoveryCode() {
    $('recovery-code-modal').classList.add('hidden');
    $('recovery-code-value').textContent = ''; // jangan biarkan kode tertinggal di DOM
  }
  async _copyRecoveryCode() {
    const code = $('recovery-code-value').textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      $('btn-copy-recovery-code').textContent = t('copied', this.lang);
    } catch (e) {
      // Clipboard ditolak (izin / konteks tidak aman): pemain masih bisa
      // menyalin manual — teks kode tetap terlihat di modal.
      $('btn-copy-recovery-code').textContent = t('copyFailed', this.lang);
    }
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
      scene.background = new THREE.Color(0xd6ecff); // langit anime — sky-soft, bukan krem senja
      const camera = new THREE.PerspectiveCamera(40, 300 / 340, 0.1, 100);
      camera.position.set(0, 1.6, 5.2);
      camera.lookAt(0, 1.1, 0);
      const sun = new THREE.DirectionalLight(0xfff1c4, 2.0); // cream matahari anime
      sun.position.set(3, 6, 4);
      scene.add(sun);
      scene.add(new THREE.HemisphereLight(0xd6ecff, 0x4fc94f, 0.9)); // langit biru anime, tanah valley
      const ground = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.3, 0.25, 12),
        new THREE.MeshLambertMaterial({ color: 0x4fc94f }),
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
    // COZY-F2 — buang geometri grup lama sebelum diganti (bocor GPU kecil
    // tiap klik kustomisasi: geometri karakter tidak pernah di-dispose).
    // Material TIDAK di-dispose — material dipakai bersama (toonMat cache /
    // material outline bersama di player.js).
    if (p.group) {
      p.scene.remove(p.group);
      p.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      p.group = null;
    }
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
    // COZY-C: tab Pasar ikut aktif bila dipilih (tombol dibuat di _bind).
    const tabMarket = $('tab-market');
    if (tabMarket) tabMarket.classList.toggle('active', this._shopTab === 'market');
    const box = $('shop-items');
    while (box.firstChild) box.removeChild(box.firstChild);
    // COZY-C: harga jual dihitung dinamis (dasar × kualitas terbaik ×
    // permintaan hari ini) — bukan lagi c.sell / angka hardcoded 8/15.
    const sellRowFor = (id, iconName, owned) => {
      const price = sellPrice(id, bestUnit(state.inv, state.invQ, id), state.day);
      const q = state.invQ && state.invQ[id];
      const qNote = q && (q.good > 0 || q.rare > 0)
        ? ` • ${q.good > 0 ? `${t('qualityGood', this.lang)} ×${q.good}` : ''}${q.good > 0 && q.rare > 0 ? ' • ' : ''}${q.rare > 0 ? `${t('qualityRare', this.lang)} ×${q.rare}` : ''}`
        : '';
      return {
        key: id, icon: iconName, name: itemName(id, this.lang),
        sub: `${price} {coin} / 1${qNote}`,
        price, owned,
      };
    };
    if (this._shopTab === 'buy') {
      const items = [
        ...Object.values(CROPS).map((c) => ({
          key: c.seedKey, icon: c.icon, name: `${t('seeds', this.lang)} ${c.name}`,
          sub: `${c.days} ${this.lang === 'id' ? 'hari' : 'days'} • ${this.lang === 'id' ? 'jual' : 'sells'} ${sellPrice(c.id, 'normal', state.day)} {coin}`,
          price: c.seed, owned: state.inv[c.seedKey] || 0,
        })),
        { key: 'feed', icon: 'wheat', name: t('feed', this.lang),
          sub: this.lang === 'id' ? '1 pakan = 1 ekor/hari' : '1 feed = 1 animal/day',
          price: 2, owned: state.inv.feed || 0 },
        // COZY-C: pupuk + bibit pohon (beli di sini, dipakai di kebun).
        { key: 'fertiliser', icon: 'leaf', name: t('fertiliser', this.lang),
          sub: this.lang === 'id' ? 'Tanah +25 • tumbuh lebih cepat • panen lebih bagus' : 'Soil +25 • grows faster • better harvest',
          price: FERTILISER.price, owned: state.inv.fertiliser || 0 },
        { key: 'appleSapling', icon: 'tomato', name: t('saplingApple', this.lang),
          sub: this.lang === 'id' ? 'Pohon apel — berbuah dalam 2 hari, panen tiap hari' : 'Apple tree — fruits in 2 days, harvest daily',
          price: SAPLINGS.apple.price, owned: state.inv.appleSapling || 0 },
        { key: 'orangeSapling', icon: 'pumpkin', name: t('saplingOrange', this.lang),
          sub: this.lang === 'id' ? 'Pohon jeruk — berbuah dalam 2 hari, panen tiap hari' : 'Orange tree — fruits in 2 days, harvest daily',
          price: SAPLINGS.orange.price, owned: state.inv.orangeSapling || 0 },
      ];
      for (const it of items) this._shopRow(box, it, 'buy');
    } else if (this._shopTab === 'market') {
      // COZY-C: tab Pasar — barang paling dicari dulu (×1,5), lalu sisanya
      // dengan harga hari ini. Semua baris bisa langsung dijual.
      const dmd = demandFor(state.day);
      const wantedRows = dmd.wanted.map((id) => {
        const r = sellRowFor(id, itemIcon(id), state.inv[id] || 0);
        // marketDemandUp SUDAH berisi 'Dicari ×1,5' — jangan tambah lagi.
        r.sub = `${r.price} {coin} / 1 • ${t('marketDemandUp', this.lang)}`;
        return r;
      });
      const restRows = ['carrot', 'tomato', 'pumpkin', 'wheat', 'strawberry', 'apple', 'orange', 'egg', 'milk', 'cheese', 'sauce', 'flour']
        .filter((id) => !dmd.wanted.includes(id))
        .map((id) => sellRowFor(id, itemIcon(id), state.inv[id] || 0));
      for (const it of [...wantedRows, ...restRows]) this._shopRow(box, it, 'sell');
    } else {
      const items = [
        ...Object.values(CROPS).map((c) => sellRowFor(c.id, c.icon, state.inv[c.id] || 0)),
        sellRowFor('egg', 'egg', state.inv.egg || 0),
        sellRowFor('milk', 'milk', state.inv.milk || 0),
        sellRowFor('apple', 'tomato', state.inv.apple || 0),
        sellRowFor('orange', 'pumpkin', state.inv.orange || 0),
        sellRowFor('cheese', 'milk', state.inv.cheese || 0),
        sellRowFor('sauce', 'tomato', state.inv.sauce || 0),
        sellRowFor('flour', 'wheat', state.inv.flour || 0),
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
    btn.addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      this._celebrate(mode === 'buy' ? 'buy' : 'sell', r.left + r.width / 2, r.top + r.height / 2, 0.7);
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
        // COZY-C: harga jual yang tampil = harga hari ini (ikut permintaan).
        `${c.days} ${this.lang === 'id' ? 'hari' : 'days'} • ${this.lang === 'id' ? 'jual' : 'sell'} ${sellPrice(c.id, 'normal', state.day)} {coin} • ${this.lang === 'id' ? 'benih' : 'seeds'}: ${owned}`);
      info.appendChild(subEl);
      row.appendChild(info);
      const btn = el('button', 'buy-btn');
      appendRichText(btn, `${this.lang === 'id' ? 'Tanam' : 'Plant'} {sprout}`);
      btn.disabled = owned < 1;
      btn.addEventListener('click', (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this._celebrate('plant', r.left + r.width / 2, r.top + r.height / 2, 0.7);
        this.closeCropPicker(); onPick(c.id);
      });
      row.appendChild(btn);
      box.appendChild(row);
    }
    $('crop-modal').classList.remove('hidden');
  }
  closeCropPicker() { $('crop-modal').classList.add('hidden'); }
  // COZY-C — start: panel mesin pengolah + picker pohon buah.
  // Panel olah: 3 resep (susu->keju, tomat->saus, gandum->tepung), olah
  // instan + cooldown 15 detik (dihitung dari state.machineCooldown).
  // Timer 1 detik me-refresh countdown selama panel terbuka.
  openCraft(state) {
    state = state || this._lastState;
    if (!state) return;
    this._craftState = state;
    this._renderCraft(state);
    $('craft-modal').classList.remove('hidden');
    if (this._craftTimer) clearInterval(this._craftTimer);
    this._craftTimer = setInterval(() => {
      if ($('craft-modal').classList.contains('hidden')) { clearInterval(this._craftTimer); this._craftTimer = 0; return; }
      this._renderCraft(this._craftState || this._lastState);
    }, 1000);
  }
  closeCraft() {
    $('craft-modal').classList.add('hidden');
    if (this._craftTimer) { clearInterval(this._craftTimer); this._craftTimer = 0; }
  }
  refreshCraft(state) {
    if ($('craft-modal') && !$('craft-modal').classList.contains('hidden')) {
      this._craftState = state || this._craftState || this._lastState;
      this._renderCraft(this._craftState);
    }
  }
  _renderCraft(state) {
    if (!state) return;
    const box = $('craft-list');
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    const now = Date.now();
    const remainMs = Math.max(0, (state.machineCooldown || 0) - now);
    const note = $('craft-note');
    if (note) {
      note.textContent = remainMs > 0
        ? t('craftCooldown', this.lang, { s: Math.ceil(remainMs / 1000) })
        : t('craftBonusNote', this.lang);
    }
    for (const r of RECIPES) {
      const outId = Object.keys(r.output)[0];
      const needTxt = Object.entries(r.inputs)
        .map(([item, n]) => `${itemName(item, this.lang)} ×${n} (${this.lang === 'id' ? 'punya' : 'owned'} ${state.inv[item] || 0})`)
        .join(' + ');
      const canAfford = Object.entries(r.inputs).every(([item, n]) => (state.inv[item] || 0) >= n);
      const row = el('div', 'shop-row');
      const info = el('div', 'info');
      const nameEl = el('div', 'name');
      nameEl.appendChild(iconEl(itemIcon(outId)));
      nameEl.appendChild(document.createTextNode(` ${itemName(outId, this.lang)}`));
      info.appendChild(nameEl);
      const subEl = el('div', 'sub');
      appendRichText(subEl, `${t('craftNeed', this.lang, { items: needTxt })} • ${this.lang === 'id' ? 'jual' : 'sells'} ${sellPrice(outId, 'normal', state.day)} {coin}`);
      info.appendChild(subEl);
      row.appendChild(info);
      const btn = el('button', 'buy-btn', t('craftBtn', this.lang));
      btn.disabled = !canAfford || remainMs > 0;
      btn.addEventListener('click', () => {
        if (typeof this.h.onCraft === 'function') this.h.onCraft(r.id);
      });
      row.appendChild(btn);
      box.appendChild(row);
    }
  }
  // Picker bibit pohon (apel/jeruk) — pola yang sama dengan crop picker.
  openTreePicker(state, onPick) {
    const box = $('tree-list');
    while (box.firstChild) box.removeChild(box.firstChild);
    for (const kind of ['apple', 'orange']) {
      const def = TREE_DEFS[kind];
      const key = kind === 'apple' ? 'appleSapling' : 'orangeSapling';
      const owned = state.inv[key] || 0;
      const row = el('div', 'crop-row');
      const info = el('div', 'info');
      const nameEl = el('div', 'name');
      nameEl.appendChild(iconEl(def.icon));
      nameEl.appendChild(document.createTextNode(` ${itemName(kind, this.lang)}`));
      info.appendChild(nameEl);
      const subEl = el('div', 'sub');
      subEl.textContent = this.lang === 'id'
        ? `Berbuah dalam 2 hari • panen tiap hari • bibit: ${owned}`
        : `Fruits in 2 days • harvest daily • saplings: ${owned}`;
      info.appendChild(subEl);
      row.appendChild(info);
      const btn = el('button', 'buy-btn', t('actionPlantTree', this.lang));
      btn.disabled = owned < 1;
      btn.addEventListener('click', () => { this.closeTreePicker(); onPick(kind); });
      row.appendChild(btn);
      box.appendChild(row);
    }
    $('tree-modal').classList.remove('hidden');
  }
  closeTreePicker() { $('tree-modal').classList.add('hidden'); }
  // COZY-C — end
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
