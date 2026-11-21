// audio.js — efek suara sederhana via WebAudio (oscillator + noise).
// Semua dibungkus try/catch; audio hanya dimulai setelah gestur pengguna
// (klik/tap tombol Mulai), jadi tidak merusak bila diblokir browser.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._water = null; // {src, filt, g} loop suara air
    this.waterLevel = 0; // 0..1 — target terakhir setWaterLevel
  }
  ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this._startWater();
    } catch (e) { /* audio tidak tersedia — game tetap jalan */ }
  }
  // Suara air mengalir (loop): noise coklat → lowpass. Gain diatur oleh
  // setWaterLevel (jarak pemain ke sungai); 0 = senyap.
  _startWater() {
    try {
      if (!this.ctx || this._water) return;
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 0.4;
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(filt); filt.connect(g); g.connect(this.ctx.destination);
      src.start();
      this._water = { src, filt, g };
    } catch (e) { /* abaikan */ }
  }
  // v 0..1 — transisi ~0.5 detik, jadi suara muncul/menghilang perlahan.
  setWaterLevel(v) {
    v = Math.max(0, Math.min(1, v));
    this.waterLevel = v;
    try {
      if (!this.ctx || !this._water) return;
      const target = this.enabled ? v * 0.22 : 0;
      this._water.g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.5);
      this._water.filt.frequency.setTargetAtTime(380 + v * 420, this.ctx.currentTime, 0.5);
    } catch (e) { /* abaikan */ }
  }
  _splash() {
    try {
      if (!this.enabled || !this.ctx) return;
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = 750; filt.Q.value = 0.8;
      const g = this.ctx.createGain(); g.gain.value = 0.25;
      src.connect(filt); filt.connect(g); g.connect(this.ctx.destination);
      src.start();
    } catch (e) { /* abaikan */ }
  }
  tone(freq, dur = 0.12, type = 'sine', vol = 0.15, when = 0, slideTo = null) {
    try {
      if (!this.enabled || !this.ctx) return;
      const t0 = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* abaikan */ }
  }
  play(name) {
    if (!this.enabled) return;
    try {
      switch (name) {
        case 'hoe': this.tone(140, 0.12, 'triangle', 0.2, 0, 70); break;
        case 'plant': this.tone(520, 0.1, 'sine', 0.15); this.tone(780, 0.14, 'sine', 0.12, 0.08); break;
        case 'water': this.tone(900, 0.18, 'sine', 0.08, 0, 400); break;
        case 'harvest': this.tone(523, 0.1, 'triangle', 0.18); this.tone(659, 0.1, 'triangle', 0.18, 0.09); this.tone(784, 0.16, 'triangle', 0.18, 0.18); break;
        case 'coin': this.tone(988, 0.09, 'square', 0.07); this.tone(1319, 0.16, 'square', 0.07, 0.07); break;
        case 'animal': this.tone(660, 0.09, 'square', 0.08); this.tone(880, 0.12, 'square', 0.08, 0.1); break;
        case 'jump': this.tone(300, 0.14, 'sine', 0.12, 0, 620); break;
        case 'splash': this._splash(); break;
        case 'sleep': this.tone(392, 0.3, 'sine', 0.1); this.tone(330, 0.4, 'sine', 0.1, 0.25); break;
        case 'click': this.tone(700, 0.05, 'sine', 0.08); break;
        case 'error': this.tone(180, 0.15, 'sawtooth', 0.08); break;
        default: this.tone(440, 0.08, 'sine', 0.1); break;
      }
    } catch (e) { /* abaikan */ }
  }
}
