// audio.js — efek suara sederhana via WebAudio (oscillator + noise).
// Semua dibungkus try/catch; audio hanya dimulai setelah gestur pengguna
// (klik/tap tombol Mulai), jadi tidak merusak bila diblokir browser.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }
  ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch (e) { /* audio tidak tersedia — game tetap jalan */ }
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
        case 'sleep': this.tone(392, 0.3, 'sine', 0.1); this.tone(330, 0.4, 'sine', 0.1, 0.25); break;
        case 'click': this.tone(700, 0.05, 'sine', 0.08); break;
        case 'error': this.tone(180, 0.15, 'sawtooth', 0.08); break;
        default: this.tone(440, 0.08, 'sine', 0.1); break;
      }
    } catch (e) { /* abaikan */ }
  }
}
