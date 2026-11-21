// input.js — keyboard (WASD/panah + Spasi + E) + joystick analog virtual (sentuh).
export class Input {
  constructor() {
    this.keys = new Set();
    this.joy = { x: 0, y: 0, active: false };
    this.onAction = null; // () => void
    this.onJump = null;
    this._joyId = null;
    this._bindKeyboard();
    this._bindJoystick();
    this._bindButtons();
  }
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key === ' ' && this.onJump) this.onJump();
      if ((e.key === 'e' || e.key === 'E') && this.onAction) this.onAction();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }
  // Vektor gerak ternormalisasi: x = kanan, y = maju (diubah main.js ke arah kamera).
  moveVector() {
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
    if (act) act.addEventListener('click', () => { if (this.onAction) this.onAction(); });
    if (jmp) jmp.addEventListener('click', () => { if (this.onJump) this.onJump(); });
  }
}
