// multiplayer.js — Room ephemeral "Main Bareng" via Supabase Realtime.
//
// Restyle visual Lane D (anime overhaul, 25 Nov 2026): sprite nama pemain
// lain jadi pil kertas krem + outline tinta + teks display rounded
// (bukan teks krem ber-outline gelap tanpa latar), SFX khas lembah
// ("TING!") + burst kelopak saat pemain lain masuk room. Avatar remote
// ikut buildCharacter (Lane B). Protokol Phoenix, presence, chat, posisi
// TIDAK berubah.
//
// Arsitektur (keputusan koordinator): TANPA supabase-js, TANPA server baru.
// WebSocket mentah ke endpoint Realtime project lembah-hijau dengan protokol
// Phoenix v1 (array JSON [join_ref, ref, topic, event, payload], vsn=1.0.0):
//   wss://<ref>.supabase.co/realtime/v1/websocket?apikey=<anon>&vsn=1.0.0
// Channel `realtime:room:<KODE>`. Presence = posisi/facing/konfigurasi
// karakter tiap pemain; Broadcast = event `chat` / `game_result` / `room_event`.
// Room EPHEMERAL: tidak ada tabel baru, tidak ada yang disimpan.
// Auth: HANYA anon key publishable (dari meta lh-supabase-anon-key di halaman).
// Token sesi akun (cloud.js) TIDAK PERNAH dikirim ke Realtime.
// Bila WebSocket gagal/timeout 5 detik -> game tetap jalan solo + event
// 'offline' (UI menampilkan toast jujur). Reconnect otomatis 1x saja.
import * as THREE from 'three';
import { buildCharacter } from './player.js';
import { sanitizeCustom } from './customization.js';
import { terrainHeight } from './physics.js';

export const MP_PROJECT_REF = 'ajsliyqjucgdtbimvdtd';
export const MP_CONNECT_TIMEOUT_MS = 5000;
export const MP_POSITION_INTERVAL_MS = 100; // ~10 Hz
export const MP_HEARTBEAT_MS = 30000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa O/0/I/1
const SPAWN = { x: 6, z: 20 }; // posisi awal bila belum ada sendPosition
const LERP_RATE = 8; // /detik — avatar remote mengejar target dengan halus
const NAME_SPRITE_Y = 2.7;

// ---------- Kode room ----------
export function generateRoomCode() {
  let code = '';
  const buf = new Uint32Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 0xffffffff);
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return code;
}

export function isValidRoomCode(code) {
  return typeof code === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(code.trim().toUpperCase());
}

export function normalizeRoomCode(code) {
  return String(code || '').trim().toUpperCase();
}

// Bentuk presence yang dikirim: { username, x, z, facing, gender, custom }.
// sanitize di sini supaya data pemain lain tidak pernah merusak render.
function sanitizePresence(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const username = String(raw.username || '').slice(0, 16);
  if (!username) return null;
  const gender = raw.gender === 'female' ? 'female' : 'male';
  return {
    username,
    x: Number.isFinite(raw.x) ? raw.x : SPAWN.x,
    z: Number.isFinite(raw.z) ? raw.z : SPAWN.z,
    facing: Number.isFinite(raw.facing) ? raw.facing : 0,
    gender,
    custom: sanitizeCustom(raw.custom, gender),
  };
}

// ---- SFX onomatopoeia + burst kelopak (Lane D; PRODUCT.md § Motion) ----
// Teks SFX khas lembah, partikel = kelopak sakura + daun + bintang — BUKAN
// asap/shard Sakuga. Hanya saat pemain lain masuk room (bukan sinkronisasi
// awal). Mati bila prefers-reduced-motion.
const LH_REDUCED = typeof matchMedia === 'function'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
function lhFxCss() {
  if (typeof document === 'undefined' || document.getElementById('lh-fx-style-mp')) return;
  const st = document.createElement('style');
  st.id = 'lh-fx-style-mp';
  st.textContent = '.lh-sfx-nm{position:fixed;left:50%;top:38%;z-index:60;pointer-events:none;font-family:"Arial Rounded MT Bold","Hiragino Maru Gothic ProN","Hiragino Sans","Trebuchet MS",system-ui,sans-serif;font-weight:800;font-style:italic;font-size:clamp(34px,6vw,52px);letter-spacing:.02em;color:#ffc93c;-webkit-text-stroke:2px #1d2b53;text-shadow:4px 4px 0 rgba(29,43,83,.9);transform:translate(-50%,-50%) rotate(-6deg);animation:lh-sfx-nm-pop .9s cubic-bezier(.34,1.56,.64,1) forwards}'
    + '@keyframes lh-sfx-nm-pop{0%{transform:translate(-50%,-50%) scale(.35) rotate(-12deg);opacity:0}25%{opacity:1;transform:translate(-50%,-50%) scale(1.18) rotate(-3deg)}55%{transform:translate(-50%,-50%) scale(1) rotate(-6deg);opacity:1}100%{transform:translate(-50%,-62%) scale(1.04) rotate(-6deg);opacity:0}}'
    + '.lh-petal{position:fixed;z-index:60;pointer-events:none;animation:lh-petal-fly .9s ease-out forwards}'
    + '@keyframes lh-petal-fly{to{transform:translate(var(--dx,0px),var(--dy,-60px)) rotate(var(--rot,180deg)) scale(.55);opacity:0}}'
    + '@media (prefers-reduced-motion:reduce){.lh-sfx-nm,.lh-petal{animation:none!important;display:none!important}}';
  document.head.appendChild(st);
}
function lhBurst(host) {
  const cols = ['#ff8fb3', '#ffc93c', '#2fbf4a', '#ff5c8a'];
  const shapes = ['50% 0 50% 50%', '50%', '0 50% 50% 50%']; // kelopak / bulat / daun
  for (let i = 0; i < 10; i++) {
    const p = document.createElement('span');
    p.className = 'lh-petal';
    p.setAttribute('aria-hidden', 'true');
    const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 90;
    p.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    p.style.setProperty('--dy', `${Math.sin(a) * d - 40}px`);
    p.style.setProperty('--rot', `${(Math.random() * 360) | 0}deg`);
    p.style.left = '50%';
    p.style.top = '38%';
    p.style.background = cols[i % cols.length];
    p.style.borderRadius = shapes[i % shapes.length];
    const s = 9 + Math.random() * 7;
    p.style.width = `${s}px`;
    p.style.height = `${s * 0.8}px`;
    host.appendChild(p);
    setTimeout(() => p.remove(), 950);
  }
}
function lhSfx(text) {
  if (LH_REDUCED || typeof document === 'undefined') return;
  lhFxCss();
  const host = document.getElementById('game-container') || document.body;
  const el = document.createElement('div');
  el.className = 'lh-sfx-nm';
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  host.appendChild(el);
  lhBurst(host);
  setTimeout(() => el.remove(), 950);
}

// Sprite nama di atas kepala: canvas 2D -> texture. Teks via fillText saja
// (bukan innerHTML), jadi username pemain lain tidak bisa injeksi markup.
// Anime: pil kertas krem (--lh-paper) + outline tinta 3px + teks tinta
// display rounded — terbaca di atas langit/sawah, bukan teks melayang.
function makeNameSprite(username) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const label = username.slice(0, 16);
  ctx.fillStyle = '#fff6e5';
  ctx.strokeStyle = '#1d2b53';
  ctx.lineWidth = 5;
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(6, 8, 244, 48, 14);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(6, 8, 244, 48);
    ctx.strokeRect(6, 8, 244, 48);
  }
  ctx.font = '800 28px "Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Trebuchet MS", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1d2b53';
  ctx.fillText(label, 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = NAME_SPRITE_Y;
  return sprite;
}

export class Multiplayer {
  constructor(opts = {}) {
    this.projectRef = opts.projectRef || MP_PROJECT_REF;
    // Anon key publishable dari meta halaman; JANGAN pernah isi token sesi.
    this.anonKey = opts.anonKey
      || document.querySelector('meta[name="lh-supabase-anon-key"]')?.content || '';
    // Override endpoint (khusus verifikasi headless: mock Phoenix lokal).
    // Default = endpoint Realtime Supabase asli.
    this.wsUrlOverride = opts.wsUrl || null;
    // getIdentity() -> { username, gender, custom }. Dipanggil tiap track
    // supaya ganti kustomisasi ikut tersinkron tanpa reconnect.
    this.getIdentity = opts.getIdentity || (() => ({ username: 'Tamu', gender: 'male', custom: null }));
    this.onPlayers = opts.onPlayers || (() => {});
    this.onEvent = opts.onEvent || (() => {});
    // Scene Three.js (opsional): bila diisi, avatar remote dikelola di sini.
    this.scene = opts.scene || null;

    this.ws = null;
    this.connected = false;
    this.roomCode = null;
    // players: Map key presence -> state (TANPA diri sendiri).
    this.players = new Map();
    // remotePlayers: array datar untuk minimap (game.remotePlayers).
    this.remotePlayers = [];
    this._avatars = new Map(); // key -> { group, sprite, tx, tz, tf, walkPhase, speed }
    this._ref = 0;
    this._joinRef = null;
    this._presenceKey = null;
    this._posTimer = null;
    this._heartbeatTimer = null;
    this._connectTimer = null;
    this._reconnectTimer = null;
    this._lastSentAt = 0;
    this._lastSent = null; // {x,z,facing} terakhir yang terkirim
    this._pendingPos = null; // {x,z,facing} terbaru dari sendPosition
    this._reconnectTried = false;
    this._intentionalClose = false;
    this._clientId = Math.random().toString(36).slice(2, 6).toUpperCase();
    this._destroyed = false;
  }

  get state() {
    return { connected: this.connected, roomCode: this.roomCode, players: this.players.size + (this.connected ? 1 : 0) };
  }

  getPlayers() {
    return [...this.players.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  _wsUrl() {
    if (this.wsUrlOverride) return this.wsUrlOverride;
    return `wss://${this.projectRef}.supabase.co/realtime/v1/websocket?apikey=${encodeURIComponent(this.anonKey)}&vsn=1.0.0`;
  }

  _topic() { return `realtime:room:${this.roomCode}`; }

  _nextRef() { this._ref += 1; return String(this._ref); }

  _push(event, payload, topic = this._topic()) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const ref = this._nextRef();
    this.ws.send(JSON.stringify([this._joinRef, ref, topic, event, payload]));
    return ref;
  }

  // ---------- Room ----------
  // createRoom() mengembalikan kode SEGERA (sinkron); join berjalan async
  // dan hasilnya dilaporkan lewat onEvent('joined' | 'offline').
  createRoom() {
    const code = generateRoomCode();
    this.joinRoom(code);
    return code;
  }

  joinRoom(code) {
    const clean = normalizeRoomCode(code);
    if (!isValidRoomCode(clean)) {
      this.onEvent('error', { kind: 'invalid-code', code: clean });
      return false;
    }
    if (this.roomCode === clean && this.connected) return true;
    this._leaveSilently();
    this.roomCode = clean;
    this._reconnectTried = false;
    this._intentionalClose = false;
    this._connect();
    return true;
  }

  leaveRoom() {
    if (!this.roomCode && !this.ws) return;
    this._intentionalClose = true;
    this._leaveSilently();
    const code = this.roomCode;
    this.roomCode = null;
    this.connected = false;
    this._clearPlayers();
    this.onEvent('left', { code });
  }

  _leaveSilently() {
    clearTimeout(this._connectTimer); this._connectTimer = null;
    clearTimeout(this._reconnectTimer); this._reconnectTimer = null;
    clearInterval(this._posTimer); this._posTimer = null;
    clearInterval(this._heartbeatTimer); this._heartbeatTimer = null;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN && this.roomCode) {
          this.ws.send(JSON.stringify([this._joinRef, this._nextRef(), this._topic(), 'phx_leave', {}]));
        }
      } catch { /* abaikan */ }
      try { this.ws.close(); } catch { /* abaikan */ }
      this.ws = null;
    }
  }

  // ---------- Koneksi ----------
  _connect() {
    if (this._destroyed || !this.roomCode) return;
    let ws;
    try {
      ws = new WebSocket(this._wsUrl());
    } catch {
      this._failConnect('connect-error');
      return;
    }
    this.ws = ws;
    this._joinRef = this._nextRef();
    // Timeout 5 detik: WS tidak pernah open -> solo + toast, tanpa retry liar.
    clearTimeout(this._connectTimer);
    this._connectTimer = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== WebSocket.OPEN) {
        try { ws.close(); } catch { /* abaikan */ }
        this._failConnect('connect-timeout');
      }
    }, MP_CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(this._connectTimer); this._connectTimer = null;
      const identity = this.getIdentity();
      this._presenceKey = `${identity.username || 'Tamu'}#${this._clientId}`;
      ws.send(JSON.stringify([this._joinRef, this._joinRef, this._topic(), 'phx_join', {
        config: { broadcast: { self: false, ack: false }, presence: { key: this._presenceKey } },
        access_token: this.anonKey,
      }]));
    };
    ws.onmessage = (ev) => this._onMessage(ev.data);
    ws.onerror = () => { /* onclose yang memutuskan */ };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this._posTimer); this._posTimer = null;
      clearInterval(this._heartbeatTimer); this._heartbeatTimer = null;
      if (this._intentionalClose || this._destroyed) return;
      if (!this.connected) {
        // Putus SEBELUM join ok (mis. join ditolak): jangan reconnect buta.
        this._failConnect('connect-closed');
        return;
      }
      // Putus di tengah room: 1x reconnect otomatis, lalu solo + toast.
      this.connected = false;
      if (!this._reconnectTried) {
        this._reconnectTried = true;
        this.onEvent('reconnecting', { code: this.roomCode });
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => this._connect(), 1000);
      } else {
        this._goSolo('connection-lost');
      }
    };
  }

  _failConnect(reason) {
    this._leaveSilently();
    const code = this.roomCode;
    this.roomCode = null;
    this.connected = false;
    this._clearPlayers();
    this.onEvent('offline', { reason, code });
  }

  _goSolo(reason) {
    const code = this.roomCode;
    this._leaveSilently();
    this.roomCode = null;
    this.connected = false;
    this._clearPlayers();
    this.onEvent('offline', { reason, code });
  }

  // ---------- Pesan Phoenix ----------
  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(msg) || msg.length < 5) return;
    const [joinRef, ref, topic, event, payload] = msg;
    if (topic === 'phoenix') {
      // Balasan heartbeat — tidak ada aksi.
      return;
    }
    if (topic !== this._topic()) return;
    switch (event) {
      case 'phx_reply': {
        if (ref === this._joinRef || joinRef === this._joinRef) {
          if (payload && payload.status === 'ok') this._onJoined();
          else this._failConnect('join-rejected');
        }
        break;
      }
      case 'presence_state':
        this._applyPresenceState(payload);
        break;
      case 'presence_diff':
        this._applyPresenceDiff(payload);
        break;
      case 'broadcast': {
        const type = payload && payload.event;
        const data = payload && payload.payload;
        if (type && data && typeof data === 'object') this.onEvent(type, data);
        break;
      }
      case 'phx_close':
      case 'phx_error':
        // Server menutup channel: perlakukan seperti putus.
        try { this.ws?.close(); } catch { /* abaikan */ }
        break;
      default: break;
    }
  }

  _onJoined() {
    this.connected = true;
    // Heartbeat 30 detik (Phoenix).
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify([null, this._nextRef(), 'phoenix', 'heartbeat', {}]));
      }
    }, MP_HEARTBEAT_MS);
    // Track presence pertama + timer kirim posisi ~10 Hz.
    this._trackPresence();
    clearInterval(this._posTimer);
    this._posTimer = setInterval(() => this._flushPosition(), MP_POSITION_INTERVAL_MS);
    this.onEvent('joined', { code: this.roomCode });
  }

  _presenceState() {
    const id = this.getIdentity();
    const pos = this._pendingPos || SPAWN;
    return {
      username: id.username || 'Tamu',
      x: pos.x, z: pos.z, facing: pos.facing ?? 0,
      gender: id.gender || 'male',
      custom: id.custom || null,
    };
  }

  _trackPresence() {
    this._push('presence', this._presenceState());
  }

  // ---------- Presence ----------
  _applyPresenceState(payload) {
    if (!payload || typeof payload !== 'object') return;
    const next = new Map();
    for (const [key, entry] of Object.entries(payload)) {
      if (key === this._presenceKey) continue;
      const metas = entry && Array.isArray(entry.metas) ? entry.metas : [];
      const state = sanitizePresence(metas[metas.length - 1]);
      if (state) next.set(key, { ...state, key });
    }
    const before = new Set(this.players.keys());
    this.players = next;
    for (const key of next.keys()) {
      if (!before.has(key)) this.onEvent('player-joined', { username: next.get(key).username });
    }
    for (const key of before) {
      if (!next.has(key)) this.onEvent('player-left', { username: this._lastNames?.get(key) || 'Pemain' });
    }
    this._rememberNames();
    this._afterPlayersChanged();
  }

  _applyPresenceDiff(payload) {
    if (!payload || typeof payload !== 'object') return;
    const joins = payload.joins || {};
    const leaves = payload.leaves || {};
    for (const [key, entry] of Object.entries(joins)) {
      if (key === this._presenceKey) continue;
      const metas = entry && Array.isArray(entry.metas) ? entry.metas : [];
      const state = sanitizePresence(metas[metas.length - 1]);
      if (state) {
        const isNew = !this.players.has(key);
        this.players.set(key, { ...state, key });
        if (isNew) {
          this.onEvent('player-joined', { username: state.username });
          lhSfx('TING!'); // momen: pemain lain masuk room (hanya join susulan,
          // bukan sinkronisasi awal presence_state)
        }
      }
    }
    for (const key of Object.keys(leaves)) {
      if (key === this._presenceKey) continue;
      const old = this.players.get(key);
      this.players.delete(key);
      if (old) this.onEvent('player-left', { username: old.username });
    }
    this._rememberNames();
    this._afterPlayersChanged();
  }

  _rememberNames() {
    if (!this._lastNames) this._lastNames = new Map();
    for (const [key, p] of this.players) this._lastNames.set(key, p.username);
  }

  _afterPlayersChanged() {
    this.remotePlayers = this.getPlayers().map((p) => ({
      username: p.username, x: p.x, z: p.z, facing: p.facing,
    }));
    this._syncAvatars();
    this.onPlayers(this.getPlayers());
  }

  _clearPlayers() {
    this.players = new Map();
    this.remotePlayers = [];
    this._syncAvatars();
    this.onPlayers([]);
  }

  // ---------- Posisi (throttle ~10 Hz) ----------
  sendPosition(x, z, facing) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this._pendingPos = { x, z, facing: Number.isFinite(facing) ? facing : 0 };
    // Kirim langsung bila sudah >100 ms sejak kirim terakhir — gerakan
    // pertama setelah join tidak menunggu tick timer.
    if (this.connected && Date.now() - this._lastSentAt >= MP_POSITION_INTERVAL_MS) {
      this._flushPosition();
    }
  }

  _flushPosition() {
    if (!this.connected) return;
    const pos = this._pendingPos;
    if (!pos) return;
    const last = this._lastSent;
    if (last && last.x === pos.x && last.z === pos.z && last.facing === pos.facing) return;
    this._lastSent = { ...pos };
    this._lastSentAt = Date.now();
    this._trackPresence();
  }

  // ---------- Broadcast ----------
  broadcast(type, data) {
    if (!this.connected) return false;
    const payload = { type: 'broadcast', event: type, payload: data || {} };
    return this._push('broadcast', payload);
  }

  sendChat(text) {
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean) return false;
    const id = this.getIdentity();
    return this.broadcast('chat', { from: id.username || 'Tamu', text: clean, at: Date.now() });
  }

  // ---------- Avatar pemain lain ----------
  _syncAvatars() {
    if (!this.scene) return;
    const seen = new Set();
    for (const [key, p] of this.players) {
      seen.add(key);
      let av = this._avatars.get(key);
      if (!av) {
        const group = buildCharacter(p.gender, sanitizeCustom(p.custom, p.gender));
        group.position.set(p.x, terrainHeight(p.x, p.z), p.z);
        group.rotation.y = p.facing;
        const sprite = makeNameSprite(p.username);
        group.add(sprite);
        group.userData.mpRemote = key;
        group.userData.mpUsername = p.username;
        this.scene.add(group);
        av = { group, sprite, tx: p.x, tz: p.z, tf: p.facing, walkPhase: 0, speed: 0 };
        this._avatars.set(key, av);
      } else {
        av.tx = p.x; av.tz = p.z; av.tf = p.facing;
        // Nama bisa berubah bila pemain ganti username: rebuild sprite.
        if (groupUsername(av) !== p.username) {
          av.group.remove(av.sprite);
          disposeSprite(av.sprite);
          av.sprite = makeNameSprite(p.username);
          av.group.add(av.sprite);
          av.group.userData.mpUsername = p.username;
        }
      }
    }
    for (const [key, av] of this._avatars) {
      if (!seen.has(key)) {
        this.scene.remove(av.group);
        disposeSprite(av.sprite);
        this._avatars.delete(key);
      }
    }
  }

  // Dipanggil tiap frame dari loop game (koordinator wiring di main.js).
  // Lerp posisi + hadap, ayun kaki halus mengikuti kecepatan gerak.
  update(dt) {
    if (!this.scene || this._avatars.size === 0) return;
    const step = Math.min(1, LERP_RATE * Math.max(0, dt));
    for (const av of this._avatars.values()) {
      const g = av.group;
      const dx = av.tx - g.position.x;
      const dz = av.tz - g.position.z;
      const dist = Math.hypot(dx, dz);
      av.speed = dt > 0 ? (dist / dt) * step : 0;
      g.position.x += dx * step;
      g.position.z += dz * step;
      g.position.y = terrainHeight(g.position.x, g.position.z);
      // Hadap: putar ke arah terdekat (bukan memutar 350°).
      let df = av.tf - g.rotation.y;
      while (df > Math.PI) df -= Math.PI * 2;
      while (df < -Math.PI) df += Math.PI * 2;
      g.rotation.y += df * step;
      // Ayun kaki + lengan bila bergerak; diam = napas pelan.
      const moving = dist > 0.02;
      const amp = Math.min(1, av.speed / 6);
      av.walkPhase += dt * (moving ? 6 + 6 * amp : 0);
      const swing = moving ? Math.sin(av.walkPhase) * 0.55 * amp : 0;
      const u = g.userData;
      if (u.legL) u.legL.rotation.x = swing;
      if (u.legR) u.legR.rotation.x = -swing;
      if (u.armL) u.armL.rotation.x = -swing * 0.7;
      if (u.armR) u.armR.rotation.x = swing * 0.7;
      if (u.upper) u.upper.position.y = moving ? Math.abs(Math.sin(av.walkPhase)) * 0.05 : Math.sin(performance.now() / 900) * 0.015;
    }
  }

  destroy() {
    this._destroyed = true;
    this._intentionalClose = true;
    this._leaveSilently();
    this._clearPlayers();
  }
}

function groupUsername(av) {
  return av.group.userData.mpUsername || '';
}

// ---------- COZY-E — Ekonomi multiplayer (orkestrasi client) ----------
// MpEconomy HANYA mengusulkan dan menampilkan; yang memvalidasi +
// menerapkan adalah server (Edge Function seksi COZY-E). Client tidak
// pernah mengubah koin/inventory sendiri dari hasil trade/kunjungan/
// minigame — semua angka yang diterapkan berasal dari respons server.
// Broadcast Realtime dipakai untuk MEMBERI TAHU lawan (trade_offer,
// trade_done, mp_game_*); keputusan ekonomi TIDAK diambil dari broadcast.
//   available: null = belum tahu, true = endpoint ada, false = 404
//   (server lama) -> UI menampilkan "segera hadir", game tetap jalan.
// Minigame bersama: "Panen Cepat" — 20 detik ketuk secepat mungkin;
// skor dilaporkan ke server, pemenang + hadiah ditentukan server.
export const MP_ECO_GAME_MS = 20000;
export const MP_ECO_TRADE_ITEMS = ['carrot', 'tomato', 'pumpkin', 'egg', 'milk'];

export class MpEconomy {
  constructor(opts = {}) {
    // getMp() dibaca DINAMIS supaya penggantian instance Multiplayer
    // (mis. mock headless) langsung dipakai tanpa rebind.
    this.getMp = opts.getMp || (() => null);
    this.api = opts.api || null; // {mpGarden, mpTradePropose, ...} dari cloud.js
    this.getUsername = opts.getUsername || (() => 'Tamu');
    this.onEvent = opts.onEvent || (() => {});
    this.available = null;
    this.pendingOffer = null; // {offerId, to, offer, want} — menunggu jawaban
    this.incomingOffer = null; // {offerId, from, offer, want} — menunggu saya
    this.game = null; // {room, endsAt, score, scores, submitted, timer}
    this._gameTimer = null;
    this._scoreTimer = null;
    this._lastSentScore = -1;
  }

  _broadcast(type, data) {
    const mp = this.getMp();
    if (mp && mp.connected) mp.broadcast(type, data);
  }

  _unavailable(err) {
    if (err && err.status === 404) {
      this.available = false;
      this.onEvent('mp-unavailable', {});
      return true;
    }
    return false;
  }

  // Cek sekali apakah endpoint mp ada di server ini (dipanggil saat room
  // dibuka dan ada sesi). 404 -> available=false. Error lain (offline,
  // 401) -> tetap null supaya dicoba lagi nanti.
  async probe() {
    if (!this.api || this.available !== null) return this.available;
    try {
      await this.api.mpLeaderboard();
      this.available = true;
    } catch (e) {
      if (e && e.status === 404) {
        this.available = false;
        this.onEvent('mp-unavailable', {});
      }
    }
    return this.available;
  }

  // ---------- Kunjungan kebun ----------
  // Ambil snapshot publik + klaim hadiah sekali-sehari. Koin yang
  // diterapkan pemanggil berasal dari respons server (visit.coins).
  async visitGarden(username) {
    if (!this.api) throw new Error('no_api');
    try {
      const garden = await this.api.mpGarden(username);
      const visit = await this.api.mpVisit(username);
      this.available = true;
      const out = { garden: garden.garden, visit };
      this.onEvent('garden', out);
      return out;
    } catch (e) {
      if (this._unavailable(e)) throw new Error('mp_unavailable');
      throw e;
    }
  }

  // ---------- Tukar hasil panen ----------
  async proposeTrade(to, offer, want) {
    if (!this.api) throw new Error('no_api');
    try {
      const res = await this.api.mpTradePropose(to, offer, want);
      this.available = true;
      this.pendingOffer = { offerId: res.offerId, to, offer, want };
      this._broadcast('trade_offer', {
        offerId: res.offerId, from: this.getUsername(), offer, want,
      });
      this.onEvent('trade-sent', { ...this.pendingOffer });
      return res;
    } catch (e) {
      if (this._unavailable(e)) throw new Error('mp_unavailable');
      throw e;
    }
  }

  async acceptTrade(offerId) {
    if (!this.api) throw new Error('no_api');
    try {
      const done = this.incomingOffer;
      const res = await this.api.mpTradeAccept(offerId);
      this.available = true;
      this.incomingOffer = null;
      this._broadcast('trade_done', {
        offerId, by: this.getUsername(),
        // Relay nilai server (dari respons accept): inv/koin pengusul
        // sesudah swap, supaya ia menerapkan segera (lihat trade-done-remote).
        peerInv: res.peerInv, peerCoins: res.peerCoins,
      });
      this.onEvent('trade-done', { offerId, inv: res.inv, coins: res.coins, offer: done });
      return res;
    } catch (e) {
      if (this._unavailable(e)) throw new Error('mp_unavailable');
      throw e;
    }
  }

  async declineTrade(offerId) {
    if (!this.api) throw new Error('no_api');
    try {
      const done = this.incomingOffer;
      const res = await this.api.mpTradeDecline(offerId);
      this.incomingOffer = null;
      this._broadcast('trade_declined', { offerId, by: this.getUsername() });
      this.onEvent('trade-declined', { offerId, offer: done });
      return res;
    } catch (e) {
      if (this._unavailable(e)) throw new Error('mp_unavailable');
      throw e;
    }
  }

  // ---------- Minigame bersama: "Panen Cepat" (20 detik) ----------
  startMinigame(room) {
    const endsAt = Date.now() + MP_ECO_GAME_MS;
    this._broadcast('mp_game_start', { room, by: this.getUsername(), endsAt });
    this._beginGame(room, endsAt);
    return endsAt;
  }

  _beginGame(room, endsAt) {
    this._clearGameTimers();
    this.game = { room, endsAt, score: 0, scores: {}, submitted: false };
    this._lastSentScore = -1;
    this.onEvent('game-started', { room, endsAt });
    this._scoreTimer = setInterval(() => {
      if (this.game && this.game.score !== this._lastSentScore) {
        this._lastSentScore = this.game.score;
        this._broadcast('mp_game_score', { room, from: this.getUsername(), score: this.game.score });
      }
    }, 2000);
    this._gameTimer = setTimeout(() => { this.endMinigame(); }, Math.max(0, endsAt - Date.now()));
  }

  // Satu ketukan = 1 panen. Dipanggil UI saat tombol ditekan.
  tapGame() {
    if (!this.game) return 0;
    this.game.score += 1;
    return this.game.score;
  }

  async endMinigame() {
    const g = this.game;
    if (!g || g.submitted) return null;
    g.submitted = true;
    this._clearGameTimers();
    const score = g.score;
    let results = null;
    let claim = null;
    try {
      await this.api.mpMinigameSubmit(g.room, score);
      results = await this.api.mpMinigameResults(g.room);
      const me = this.getUsername();
      if (results && results.winner === me) {
        claim = await this.api.mpMinigameClaim(g.room);
      }
      this.available = true;
    } catch (e) {
      if (this._unavailable(e)) {
        this.onEvent('game-ended', { room: g.room, score, unavailable: true });
        this.game = null;
        return null;
      }
      // Gagal jaringan di akhir ronde: skor lokal tetap dilaporkan apa
      // adanya; hadiah tidak diklaim (server yang memutuskan).
      this.onEvent('game-ended', { room: g.room, score, error: String((e && e.message) || e) });
      this.game = null;
      return null;
    }
    const out = {
      room: g.room, score, scores: results ? results.scores : [],
      winner: results ? results.winner : null,
      reward: claim && !claim.already ? claim.reward : 0,
      coins: claim ? claim.coins : null,
    };
    this._broadcast('mp_game_end', { room: g.room, winner: out.winner, scores: out.scores });
    this.onEvent('game-ended', out);
    this.game = null;
    return out;
  }

  _clearGameTimers() {
    if (this._gameTimer) { clearTimeout(this._gameTimer); this._gameTimer = null; }
    if (this._scoreTimer) { clearInterval(this._scoreTimer); this._scoreTimer = null; }
  }

  // ---------- Peringkat ----------
  async loadLeaderboard() {
    if (!this.api) throw new Error('no_api');
    try {
      const res = await this.api.mpLeaderboard();
      this.available = true;
      this.onEvent('leaderboard', { board: res.board || [] });
      return res.board || [];
    } catch (e) {
      if (this._unavailable(e)) throw new Error('mp_unavailable');
      throw e;
    }
  }

  // ---------- Broadcast masuk (dipanggil main.js dari mp.onEvent) ----------
  // Broadcast HANYA pemberitahuan; tidak ada angka ekonomi yang diambil
  // dari sini — angka selalu dari respons server (accept/visit/claim).
  handleBroadcast(type, data) {
    const me = this.getUsername();
    if (type === 'trade_offer') {
      if (!data || data.from === me || !data.offerId) return;
      this.incomingOffer = {
        offerId: data.offerId, from: data.from, offer: data.offer, want: data.want,
      };
      this.onEvent('trade-offer', { ...this.incomingOffer });
    } else if (type === 'trade_done') {
      if (!data || !data.offerId) return;
      if (this.pendingOffer && this.pendingOffer.offerId === data.offerId) {
        const done = this.pendingOffer;
        this.pendingOffer = null;
        this.onEvent('trade-done-remote', {
          ...done, by: data.by, peerInv: data.peerInv, peerCoins: data.peerCoins,
        });
      }
    } else if (type === 'trade_declined') {
      if (!data || !data.offerId) return;
      if (this.pendingOffer && this.pendingOffer.offerId === data.offerId) {
        const done = this.pendingOffer;
        this.pendingOffer = null;
        this.onEvent('trade-declined-remote', { ...done, by: data.by });
      }
    } else if (type === 'mp_game_start') {
      if (!data || data.by === me || !data.room || !data.endsAt) return;
      if (!this.game) this._beginGame(data.room, data.endsAt);
    } else if (type === 'mp_game_score') {
      if (!data || data.from === me || !this.game || data.room !== this.game.room) return;
      this.game.scores[data.from] = data.score;
      this.onEvent('game-score', { from: data.from, score: data.score, room: data.room });
    } else if (type === 'mp_game_end') {
      if (!data || !this.game || data.room !== this.game.room) return;
      this.onEvent('game-ended-remote', {
        room: data.room, winner: data.winner, scores: data.scores || [],
      });
    }
  }
}
// COZY-E — end

function disposeSprite(sprite) {
  if (!sprite) return;
  if (sprite.material?.map) sprite.material.map.dispose();
  if (sprite.material) sprite.material.dispose();
}
