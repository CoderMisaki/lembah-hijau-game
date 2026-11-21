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
import {
  SKIN_TONES, HAIR_STYLES, HAIR_COLORS, SHIRT_MODELS, PANTS_MODELS,
  HAT_MODELS, GLASSES_MODELS, SHOES_MODELS, PALETTE, FRAME_COLORS,
  defaultCustom, sanitizeCustom,
} from './customization.js';

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
    this._authMode = 'login';
    this._custom = defaultCustom('male');
    this._customGender = 'male';
    this._preview = null; // {renderer, scene, camera, group, raf}
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
    if (this._customOptionsBuilt) this._renderCustomOptions();
  }
  showGame(isTouch) {
    $('start-screen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    if (isTouch) $('touch-controls').classList.remove('hidden');
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
  setHint(text) { $('hint-bar').textContent = text || ''; }
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
  }
  _setShopCoins(n) {
    const e = $('shop-coins');
    while (e.firstChild) e.removeChild(e.firstChild);
    e.appendChild(iconEl('coin'));
    e.appendChild(document.createTextNode(` ${n}`));
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
