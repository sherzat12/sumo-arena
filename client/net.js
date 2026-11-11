// Сеть: WebSocket + буфер снимков с интерполяцией.
// Сервер присылает состояние 30 раз в секунду; мы показываем картинку «с запаздыванием»
// на INTERP_DELAY, плавно перетекая между двумя последними снимками — движение выглядит гладким.
const INTERP_DELAY = 0.1;

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.snaps = [];
    this.pending = [];  // события, ждущие своего времени показа
    this.offset = null; // разница между часами сервера и браузера
    this.ping = 0;
    this._pingTimer = null;
  }

  on(type, fn) { this.handlers[type] = fn; return this; }

  connect(url, joinMsg) {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.send(joinMsg);
      this._pingTimer = setInterval(() => this.send({ type: 'ping', t: performance.now() }), 2000);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 's') this._push(m);
      else if (m.type === 'pong') this.ping = Math.round(performance.now() - m.t);
      else this.handlers[m.type]?.(m);
    };
    ws.onclose = () => { clearInterval(this._pingTimer); this.handlers.close?.(); };
    ws.onerror = () => {};
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  _push(m) {
    const off = m.t - performance.now() / 1000;
    this.offset = this.offset === null ? off : this.offset + (off - this.offset) * 0.05;
    this.snaps.push(m);
    if (this.snaps.length > 40) this.snaps.shift();
    if (m.ev && m.ev.length) this.pending.push({ t: m.t, ev: m.ev });
  }

  // Возвращает пару снимков и долю между ними; заодно «проигрывает» события, чьё время пришло.
  sample() {
    if (!this.snaps.length || this.offset === null) return null;
    const rt = performance.now() / 1000 + this.offset - INTERP_DELAY;

    while (this.pending.length && this.pending[0].t <= rt) {
      this.handlers.events?.(this.pending.shift().ev);
    }

    const s = this.snaps;
    if (rt <= s[0].t) return { a: s[0], b: s[0], alpha: 0 };
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i].t <= rt && rt <= s[i + 1].t) {
        const span = s[i + 1].t - s[i].t || 1;
        return { a: s[i], b: s[i + 1], alpha: (rt - s[i].t) / span };
      }
    }
    const last = s[s.length - 1];
    return { a: last, b: last, alpha: 0 };
  }
}
