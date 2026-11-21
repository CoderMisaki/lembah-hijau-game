// ui.js — HUD, dialog, toko, pengaturan, toast, overlay orientasi.
// Semua teks lewat i18n (ID/EN); UI tidak menyimpan logika game.
import { t, applyI18n } from './i18n.js';
import { CROPS } from './farm.js';
import { ANIMAL_DEFS } from './animals.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.h = handlers; // {onStart, onBuy, onSell, onPlant, onSleepYes, onClearSave, onLang, onGender, onSound, onQuality}
    this.lang = 'id';
    this._toastTimer = null;
    this._bind();
  }
  _bind() {
    $('btn-start').addEventListener('click', () => this.h.onStart());
    document.querySelectorAll('.char-card').forEach((el) => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.char-card').forEach((c) => c.classList.remove('selected'));
        el.classList.add('selected');
        this.h.onGender(el.dataset.gender);
      });
    });
    $('btn-shop').addEventListener('click', () => { this.openShop('buy'); });
    $('btn-close-shop').addEventListener('click', () => this.closeShop());
    $('tab-buy').addEventListener('click', () => this.openShop('buy'));
    $('tab-sell').addEventListener('click', () => this.openShop('sell'));
    $('btn-close-crop').addEventListener('click', () => this.closeCropPicker());
    $('btn-sleep-yes').addEventListener('click', () => this.h.onSleepYes());
    $('btn-sleep-no').addEventListener('click', () => this.closeSleep());
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-close-settings').addEventListener('click', () => this.closeSettings());
    $('btn-clear-save').addEventListener('click', () => this.h.onClearSave());
    $('setting-lang').addEventListener('change', (e) => this.h.onLang(e.target.value));
    $('setting-gender').addEventListener('change', (e) => this.h.onGender(e.target.value));
    $('setting-sound').addEventListener('change', (e) => this.h.onSound(e.target.value === 'on'));
    $('setting-quality').addEventListener('change', (e) => this.h.onQuality(e.target.value));
  }
  setLang(lang) {
    this.lang = lang;
    applyI18n(lang);
    $('setting-lang').value = lang;
  }
  showGame(isTouch) {
    $('start-screen').classList.add('hidden');
    $('hud').classList.remove('hidden');
    // Joystick + tombol aksi hanya untuk perangkat sentuh; desktop pakai keyboard.
    if (isTouch) $('touch-controls').classList.remove('hidden');
  }
  showStart(saveNote) {
    $('save-note').textContent = saveNote || '';
  }
  toast(msg, ms = 2600) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }
  setHint(text) { $('hint-bar').textContent = text || ''; }
  setActionLabel(text) { $('btn-action').textContent = text || '✋'; }
  updateHUD(state) {
    $('coins').textContent = state.coins;
    const mins = Math.floor(state.minutes);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    $('day-time').textContent = `${t('day', this.lang)} ${state.day} • ${hh}:${mm}`;
    const chips = [];
    const inv = state.inv;
    const add = (emoji, n, label) => { if (n > 0) chips.push(`${emoji} ${label} ×${n}`); };
    add('🌱', inv.carrotSeed, 'Wortel'); add('🌱', inv.tomatoSeed, 'Tomat'); add('🌱', inv.pumpkinSeed, 'Labu');
    add('🌾', inv.feed, t('feed', this.lang));
    add('🥕', inv.carrot, 'Wortel'); add('🍅', inv.tomato, 'Tomat'); add('🎃', inv.pumpkin, 'Labu');
    add('🥚', inv.egg, 'Telur'); add('🥛', inv.milk, 'Susu');
    $('inv-bar').innerHTML = chips.map((c) => `<span class="inv-chip">${c}</span>`).join('');
    $('shop-coins').textContent = `🪙 ${state.coins}`;
  }
  // ---- Toko: tab Beli (benih + pakan) / Jual (hasil panen + ternak)
  openShop(tab, state) {
    this._shopTab = tab || this._shopTab || 'buy';
    this._shopState = state;
    $('tab-buy').classList.toggle('active', this._shopTab === 'buy');
    $('tab-sell').classList.toggle('active', this._shopTab === 'sell');
    const box = $('shop-items');
    box.innerHTML = '';
    if (this._shopTab === 'buy') {
      const items = [
        ...Object.values(CROPS).map((c) => ({
          key: c.seedKey, emoji: c.emoji, name: `${t('seeds', this.lang)} ${c.name}`,
          sub: `${c.days} ${this.lang === 'id' ? 'hari' : 'days'} • ${this.lang === 'id' ? 'jual' : 'sells'} ${c.sell} 🪙`,
          price: c.seed, owned: state.inv[c.seedKey] || 0,
        })),
        { key: 'feed', emoji: '🌾', name: t('feed', this.lang),
          sub: this.lang === 'id' ? '1 pakan = 1 ekor/hari' : '1 feed = 1 animal/day',
          price: 2, owned: state.inv.feed || 0 },
      ];
      for (const it of items) this._shopRow(box, it, 'buy');
    } else {
      const items = [
        ...Object.values(CROPS).map((c) => ({
          key: c.id, emoji: c.emoji, name: c.name, sub: `${c.sell} 🪙 / 1`,
          price: c.sell, owned: state.inv[c.id] || 0,
        })),
        { key: 'egg', emoji: '🥚', name: ANIMAL_DEFS.ayam.produceName, sub: '8 🪙 / 1', price: 8, owned: state.inv.egg || 0 },
        { key: 'milk', emoji: '🥛', name: ANIMAL_DEFS.sapi.produceName, sub: '15 🪙 / 1', price: 15, owned: state.inv.milk || 0 },
      ];
      for (const it of items) this._shopRow(box, it, 'sell');
    }
    $('shop-coins').textContent = `🪙 ${state.coins}`;
    $('shop-modal').classList.remove('hidden');
  }
  _shopRow(box, it, mode) {
    const row = document.createElement('div');
    row.className = 'shop-row';
    const ownedTxt = mode === 'buy'
      ? `${this.lang === 'id' ? 'Punya' : 'Owned'}: ${it.owned}`
      : `${this.lang === 'id' ? 'Punya' : 'Owned'}: ${it.owned}`;
    row.innerHTML = `<div class="info"><div class="name">${it.emoji} ${it.name}</div><div class="sub">${it.sub} • ${ownedTxt}</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'buy-btn';
    btn.textContent = mode === 'buy' ? `${t('buy', this.lang)} ${it.price} 🪙` : `${t('sell', this.lang)} ${it.price} 🪙`;
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
    box.innerHTML = '';
    for (const c of Object.values(CROPS)) {
      const owned = state.inv[c.seedKey] || 0;
      const row = document.createElement('div');
      row.className = 'crop-row';
      row.innerHTML = `<div class="info"><div class="name">${c.emoji} ${c.name}</div>` +
        `<div class="sub">${c.days} ${this.lang === 'id' ? 'hari' : 'days'} • ${this.lang === 'id' ? 'jual' : 'sell'} ${c.sell} 🪙 • ${this.lang === 'id' ? 'benih' : 'seeds'}: ${owned}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'buy-btn';
      btn.textContent = `${this.lang === 'id' ? 'Tanam' : 'Plant'} 🌱`;
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
    $('setting-lang').value = state.lang;
    $('setting-gender').value = state.gender;
    $('setting-sound').value = state.sound ? 'on' : 'off';
    $('setting-quality').value = state.quality;
    $('settings-modal').classList.remove('hidden');
  }
  closeSettings() { $('settings-modal').classList.add('hidden'); }
  // ---- Orientasi: overlay "putar ke landscape" (mobile portrait)
  setOrientationOverlay(show) {
    $('orientation-overlay').classList.toggle('hidden', !show);
  }
  showError(msg) {
    const el = $('error-box');
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}
