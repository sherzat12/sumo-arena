// Звуки синтезируются на лету (WebAudio) — никаких аудиофайлов.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = false;
  }

  // Браузер разрешает звук только после действия пользователя — вызываем при нажатии «Играть».
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  _tone(f0, f1, dur, type = 'sine', gain = 0.2, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noise(dur, f0, f1, gain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  hit(power = 0.5) {
    this._tone(190, 45, 0.18, 'sine', 0.12 + 0.4 * power);
    this._noise(0.09, 1800, 500, 0.04 + 0.14 * power);
  }
  jump() { this._tone(280, 560, 0.12, 'square', 0.05); }
  dash() { this._noise(0.28, 500, 3200, 0.16); }
  fall() { this._tone(520, 70, 0.7, 'sawtooth', 0.1); this._noise(0.5, 900, 200, 0.07); }
  point() { this._tone(660, 660, 0.1, 'triangle', 0.16); this._tone(990, 990, 0.18, 'triangle', 0.16, 0.09); }
  win() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone(f, f, 0.25, 'triangle', 0.18, i * 0.13));
  }
}
