// Главный файл клиента: меню, соединение, игровой цикл и интерфейс (HUD).
import { CONFIG } from '/shared/config.js';
import { GameScene } from './scene.js';
import { Net } from './net.js';
import { Controls } from './input.js';
import { Sfx } from './audio.js';

const $ = (sel) => document.querySelector(sel);
const el = {
  menu: $('#menu'), form: $('#join-form'), name: $('#name'), room: $('#room'),
  error: $('#menu-error'), play: $('#play'), bots: $('#bots'), level: $('#level'),
  botPlus: $('#bot-plus'), botMinus: $('#bot-minus'),
  hud: $('#hud'), roomCode: $('#room-code'), copy: $('#copy-link'), ping: $('#ping'),
  goal: $('#goal'), board: $('#scoreboard'), feed: $('#feed'), dash: $('#dash-fill'),
  hint: $('#hint'), banner: $('#banner'),
};
el.goal.textContent = `${CONFIG.winScore} очков`;

const scene = new GameScene($('#view'));
const controls = new Controls($('#view'));
const sfx = new Sfx();
const net = new Net();

let me = null;            // { id, room } после входа в комнату
let roster = new Map();   // id -> { id, name, color }
let frame = null;         // последний показанный снимок (для таблицы очков)
let winEndsAt = 0;
let winnerName = '';

const nameOf = (id) => roster.get(id)?.name ?? '???';
const colorOf = (id) => CONFIG.colors[(roster.get(id)?.color ?? 0) % CONFIG.colors.length];

// ---------- вход ----------
const params = new URLSearchParams(location.search);
el.room.value = (params.get('room') || '').toUpperCase();
try { el.name.value = localStorage.getItem('sumo-name') || ''; } catch { /* приватный режим */ }

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  sfx.unlock();
  el.error.textContent = '';
  el.play.disabled = true;
  const name = el.name.value.trim();
  try { localStorage.setItem('sumo-name', name); } catch { /* не критично */ }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  net.connect(`${proto}://${location.host}/ws`, {
    type: 'join', name, room: el.room.value.trim(), bots: Number(el.bots.value), level: el.level.value,
  });
});

net.on('welcome', (m) => {
  me = { id: m.id, room: m.room };
  el.roomCode.textContent = m.room;
  el.menu.hidden = true;
  el.hud.hidden = false;
  controls.enabled = true;
  history.replaceState(null, '', `?room=${m.room}`);
});

net.on('roster', (m) => {
  roster = new Map(m.players.map((p) => [p.id, p]));
  scene.setRoster(roster);
});

net.on('error', (m) => {
  el.error.textContent = m.message || 'Не удалось войти в комнату';
  el.play.disabled = false;
});

net.on('close', () => {
  if (me) showBanner('Соединение потеряно', 'Обновите страницу, чтобы вернуться в игру', true);
  else { el.error.textContent = 'Не удалось подключиться к серверу'; el.play.disabled = false; }
});

net.on('events', (events) => {
  for (const e of events) {
    if (e.k === 'hit') { scene.hitEffect(e); sfx.hit(e.p); }
    else if (e.k === 'jump') { scene.dust(e); if (me && e.id === me.id) sfx.jump(); }
    else if (e.k === 'dash') { scene.dashEffect(e); sfx.dash(); }
    else if (e.k === 'fall') {
      scene.splash(e);
      sfx.fall();
      const mine = me && (e.id === me.id || e.by === me.id);
      if (e.by != null) addFeed(`${nameOf(e.by)} ➜ ${nameOf(e.id)} 🔥`, mine);
      else addFeed(`${nameOf(e.id)} упал в лаву`, mine);
      if (me && e.by === me.id) sfx.point();
    } else if (e.k === 'win') {
      winnerName = nameOf(e.id);
      winEndsAt = performance.now() + CONFIG.roundResetDelay * 1000;
      showBanner(`🏆 Победил ${winnerName}!`, '');
      sfx.win();
    } else if (e.k === 'reset') {
      winEndsAt = 0;
      hideBanner();
      addFeed('Новый матч!', false);
    }
  }
});

// ---------- интерфейс ----------
function addFeed(text, mine) {
  const d = document.createElement('div');
  d.className = 'feed-item' + (mine ? ' mine' : '');
  d.textContent = text;
  el.feed.prepend(d);
  while (el.feed.children.length > 5) el.feed.lastChild.remove();
  setTimeout(() => d.remove(), 5000);
}

function showBanner(title, sub, withReload = false) {
  el.banner.replaceChildren();
  const h = document.createElement('div');
  h.className = 'banner-title';
  h.textContent = title;
  const s = document.createElement('div');
  s.className = 'banner-sub';
  s.id = 'banner-sub';
  s.textContent = sub;
  el.banner.append(h, s);
  if (withReload) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Обновить';
    b.addEventListener('click', () => location.reload());
    el.banner.append(b);
  }
  el.banner.hidden = false;
}
function hideBanner() { el.banner.hidden = true; }

el.copy.addEventListener('click', async () => {
  const url = `${location.origin}/?room=${me ? me.room : ''}`;
  try {
    await navigator.clipboard.writeText(url);
    el.copy.textContent = 'Скопировано ✓';
  } catch {
    window.prompt('Скопируйте ссылку для друга:', url);
  }
  setTimeout(() => { el.copy.textContent = 'Скопировать ссылку'; }, 1800);
});

el.botPlus.addEventListener('click', () => net.send({ type: 'bots', delta: 1, level: el.level.value }));
el.botMinus.addEventListener('click', () => net.send({ type: 'bots', delta: -1 }));

controls.onMute = () => addFeed(sfx.toggleMute() ? 'Звук выключен' : 'Звук включён', false);
document.addEventListener('pointerlockchange', () => {
  el.hint.hidden = document.pointerLockElement === $('#view');
});

let lastHud = 0;
function updateHud(now) {
  if (!me || now - lastHud < 200) return;
  lastHud = now;
  el.ping.textContent = net.ping ? `${net.ping} мс` : '';

  if (frame) {
    const rows = frame.p
      .map((p) => ({ id: p[0], alive: p[8] === 1, score: p[9] }))
      .sort((a, b) => b.score - a.score);
    const items = rows.map((r) => {
      const li = document.createElement('li');
      if (r.id === me.id) li.className = 'me';
      if (!r.alive) li.classList.add('dead');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = colorOf(r.id);
      const nm = document.createElement('span');
      nm.className = 'pname';
      nm.textContent = nameOf(r.id);
      const sc = document.createElement('b');
      sc.textContent = r.score;
      li.append(dot, nm, sc);
      return li;
    });
    el.board.replaceChildren(...items);
  }

  if (winEndsAt) {
    const left = Math.max(0, Math.ceil((winEndsAt - now) / 1000));
    const sub = $('#banner-sub');
    if (sub) sub.textContent = `Новый матч через ${left} с`;
  }
}

// ---------- отправка управления ----------
setInterval(() => {
  if (!me || !controls.enabled) return;
  const i = controls.getInput();
  const r = (v) => Math.round(v * 1000) / 1000;
  net.send({ type: 'input', x: r(i.x), z: r(i.z), fx: r(i.fx), fz: r(i.fz), jump: i.jump, dash: i.dash });
}, 1000 / 30);

// ---------- игровой цикл ----------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  controls.update(dt);
  const s = net.sample();
  if (s) {
    scene.applyInterp(s.a, s.b, s.alpha);
    frame = s.b;
  }
  scene.update(dt, controls, me ? me.id : null);
  scene.render();

  const mine = me && scene.players.get(me.id);
  el.dash.style.transform = `scaleX(${mine ? 1 - Math.min(1, mine.cd) : 1})`;
  updateHud(now);
}
requestAnimationFrame(loop);
