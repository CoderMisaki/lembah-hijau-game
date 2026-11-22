// input.js — keyboard (WASD/panah + Spasi + E) + joystick analog virtual (sentuh).
export class Input {
  constructor() {
    this.keys = new Set();
    this.joy = { x: 0, y: 0, active: false };
    this.running = false; // tahan tombol Lari / Shift = sprint 1.6x
    this.onAction = null; // () => void
    this.onJump = null;
    // Kunci input selama urutan sinematik (mis. tidur): gerak nol, aksi/lompat
    // diabaikan. Orbit kamera TIDAK dikunci (kamera sinematik mengabaikannya).
    this.locked = false;
    // Orbit kamera: yaw 0 + pitch 0.49 + jarak 12.5 = offset kamera lama
    // (0, +5.9, +11) dari titik bidik (pemain +1.6 m). Pitch/jarak di-clamp.
    this.orbit = { yaw: 0, pitch: 0.49, dist: 12.5 };
    this._orbitPointers = new Map(); // pointerId -> {x, y}
    this._pinchDist = 0;
    this._joyId = null;
    this._bindKeyboard();
    this._bindJoystick();
    this._bindButtons();
    this._bindOrbit();
  }
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === 'Shift') this.running = true;
      if (e.key === ' ' && this.onJump && !this.locked) this.onJump();
      if ((e.key === 'e' || e.key === 'E') && this.onAction && !this.locked) this.onAction();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
      if (e.key === 'Shift') this.running = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.running = false; });
  }
  // Vektor gerak ternormalisasi: x = kanan, y = maju (diubah main.js ke arah kamera).
  moveVector() {
    if (this.locked) return { x: 0, y: 0, mag: 0 };
    let x = 0, y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y -= 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.joy.active) { x += this.joy.x; y += -this.joy.y; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y, mag: Math.min(1, len) };
  }
  _bindJoystick() {
    const base = document.getElementById('joystick');
    const knob = document.getElementById('joystick-knob');
    if (!base || !knob) return;
    const R = 44; // radius gerak knob (px)
    const setKnob = (dx, dy) => { knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
    const update = (t) => {
      if (this.locked) return; // urutan sinematik: joystick tidak menggerakkan pemain
      const rect = base.getBoundingClientRect();
      let dx = t.clientX - (rect.left + rect.width / 2);
      let dy = t.clientY - (rect.top + rect.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      this.joy.x = dx / R; this.joy.y = dy / R; this.joy.active = true;
      setKnob(dx, dy);
    };
    const end = () => { this.joy.x = 0; this.joy.y = 0; this.joy.active = false; this._joyId = null; setKnob(0, 0); };
    base.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; this._joyId = t.identifier; update(t); }, { passive: false });
    base.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === this._joyId) update(t);
    }, { passive: false });
    base.addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === this._joyId) end(); });
    base.addEventListener('touchcancel', end);
    // Mouse juga bisa drag joystick (berguna di desktop saat testing).
    let mouseDown = false;
    base.addEventListener('mousedown', (e) => { mouseDown = true; update(e); });
    window.addEventListener('mousemove', (e) => { if (mouseDown) update(e); });
    window.addEventListener('mouseup', () => { if (mouseDown) { mouseDown = false; end(); } });
  }
  _bindButtons() {
    const act = document.getElementById('btn-action');
    const jmp = document.getElementById('btn-jump');
    const run = document.getElementById('btn-run');
    if (act) act.addEventListener('click', () => { if (this.onAction && !this.locked) this.onAction(); });
    if (jmp) jmp.addEventListener('click', () => { if (this.onJump && !this.locked) this.onJump(); });
    // Tombol Lari: TAHAN (bukan klik) — sentuh/mouse down = lari, lepas = jalan.
    if (run) {
      const on = (e) => { e.preventDefault(); this.running = true; run.classList.add('active'); };
      const off = (e) => { if (e) e.preventDefault(); this.running = false; run.classList.remove('active'); };
      run.addEventListener('touchstart', on, { passive: false });
      run.addEventListener('touchend', off);
      run.addEventListener('touchcancel', off);
      run.addEventListener('mousedown', on);
      run.addEventListener('mouseleave', off);
      window.addEventListener('mouseup', off);
    }
  }
  // Orbit kamera — HANYA di #game-canvas. Sentuhan/klik yang dimulai di
  // elemen UI DOM (joystick, tombol, HUD, modal) tidak sampai ke canvas,
  // jadi tidak pernah memutar kamera. 1 jari/mouse = putar (yaw bebas 360°,
  // pitch di-clamp supaya kamera tidak masuk tanah); 2 jari = pinch zoom
  // (jarak 6–18 m); wheel desktop = zoom. Pointer Events menyatukan
  // mouse + sentuh; setPointerCapture menjaga drag tetap di canvas.
  _bindOrbit() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    const ORBIT = this.orbit;
    const clampOrbit = () => {
      ORBIT.pitch = Math.max(0.15, Math.min(1.25, ORBIT.pitch));
      ORBIT.dist = Math.max(6, Math.min(18, ORBIT.dist));
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this._orbitPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._orbitPointers.size === 2) {
        const [a, b] = [...this._orbitPointers.values()];
        this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = this._orbitPointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      this._orbitPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._orbitPointers.size === 1) {
        // Seret ke atas = kamera naik (pitch +); seret ke samping = yaw.
        ORBIT.yaw -= dx * 0.005;
        ORBIT.pitch -= dy * 0.005;
        clampOrbit();
      } else if (this._orbitPointers.size === 2 && this._pinchDist > 0) {
        const [a, b] = [...this._orbitPointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > 0) {
          ORBIT.dist *= this._pinchDist / d; // jari menjauh = zoom in
          this._pinchDist = d;
          clampOrbit();
        }
      }
    });
    const endPointer = (e) => {
      this._orbitPointers.delete(e.pointerId);
      if (this._orbitPointers.size < 2) this._pinchDist = 0;
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      ORBIT.dist *= Math.exp(e.deltaY * 0.001); // wheel ke bawah = zoom out
      clampOrbit();
    }, { passive: false });
  }
}
