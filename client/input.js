// Управление: клавиатура + мышь (поворот камеры).
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Controls {
  constructor(canvas) {
    this.canvas = canvas;
    this.enabled = false;
    this.keys = new Set();
    this.yaw = 0;      // поворот камеры вокруг шара
    this.pitch = 0.62; // наклон камеры
    this.dashQueued = false;
    this.onMute = null;

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.keys.clear());

    // Клик по игре захватывает мышь: движение мыши вращает камеру (Esc — отпустить).
    canvas.addEventListener('click', () => {
      if (!this.enabled || document.pointerLockElement === canvas) return;
      try { canvas.requestPointerLock?.(); } catch { /* не критично */ }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === canvas || (e.buttons & 1)) {
        this.yaw -= e.movementX * 0.0035;
        this.pitch = clamp(this.pitch + e.movementY * 0.0035, 0.12, 1.35);
      }
    });
  }

  _key(e, down) {
    if (!this.enabled) return;
    if (e.target && e.target.tagName === 'INPUT') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (down) {
      if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) this.dashQueued = true;
      if (e.code === 'KeyM' && !e.repeat) this.onMute?.();
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
  }

  // Q/E — поворот камеры с клавиатуры (для тех, у кого нет мыши)
  update(dt) {
    if (this.keys.has('KeyQ')) this.yaw += 2 * dt;
    if (this.keys.has('KeyE')) this.yaw -= 2 * dt;
  }

  // Направление хода в координатах мира: «вперёд» — от камеры к шару.
  getInput() {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    let x = -sy * f + cy * r;
    let z = -cy * f - sy * r;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    const dash = this.dashQueued;
    this.dashQueued = false;
    return { x, z, fx: -sy, fz: -cy, jump: k.has('Space'), dash };
  }
}
