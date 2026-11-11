import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { startServer } from '../server/index.js';
import { CONFIG } from '../shared/config.js';

let srv;
before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1' }); });
after(async () => { await srv.close(); });

function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
  const c = { ws, log: [], waiters: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    c.log.push(m);
    for (const w of [...c.waiters]) {
      if (w.pred(m)) { c.waiters.splice(c.waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(m); }
    }
  });
  c.open = new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.waitFor = (pred, ms = 4000) => {
    const hit = c.log.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      w.timer = setTimeout(() => reject(new Error('таймаут ожидания сообщения')), ms);
      c.waiters.push(w);
    });
  };
  c.latest = (type) => [...c.log].reverse().find((m) => m.type === type);
  c.join = async (room, name) => {
    await c.open;
    c.send({ type: 'join', room, name });
    return c.waitFor((m) => m.type === 'welcome' || m.type === 'error');
  };
  return c;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.port, path }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
  }).on('error', reject);
});

test('раздаёт страницу игры, общий конфиг и библиотеку three', async () => {
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /Sumo Arena/);
  assert.equal((await get('/health')).body, 'ok');
  assert.equal((await get('/shared/config.js')).status, 200);
  assert.equal((await get('/client/main.js')).status, 200);
  assert.equal((await get('/vendor/three/build/three.module.js')).status, 200);
});

test('не отдаёт файлы за пределами публичных папок', async () => {
  for (const p of ['/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/vendor/three/../../package.json', '/server/room.js', '/nope']) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test('два игрока в одной комнате видят друг друга, ввод двигает шар', async () => {
  const a = client();
  const b = client();
  const wa = await a.join('ROOM1', 'Аня');
  const wb = await b.join('room1', 'Борис'); // регистр кода не важен
  assert.equal(wa.type, 'welcome');
  assert.equal(wa.room, 'ROOM1');
  assert.equal(wb.room, 'ROOM1');
  assert.notEqual(wa.id, wb.id);

  const roster = await a.waitFor((m) => m.type === 'roster' && m.players.length === 2);
  assert.deepEqual(roster.players.map((p) => p.name).sort(), ['Аня', 'Борис']);

  const first = await b.waitFor((m) => m.type === 's' && m.p.length === 2);
  const me = first.p.find((p) => p[0] === wa.id);
  // идём к центру арены
  const len = Math.hypot(me[1], me[3]);
  const dir = { x: -me[1] / len, z: -me[3] / len };
  const timer = setInterval(() => a.send({ type: 'input', x: dir.x, z: dir.z, jump: false }), 33);
  await sleep(1000);
  clearInterval(timer);

  const last = b.latest('s');
  const after = last.p.find((p) => p[0] === wa.id);
  assert.ok(Math.hypot(after[1] - me[1], after[3] - me[3]) > 1.5, 'шар Ани сдвинулся (виден Борису)');
  assert.equal(after[8], 1, 'жив');
  a.ws.close(); b.ws.close();
});

test('комнаты изолированы друг от друга', async () => {
  const a = client();
  const c = client();
  await a.join('AAAA', 'A');
  await c.join('CCCC', 'C');
  const sa = await a.waitFor((m) => m.type === 's');
  const sc = await c.waitFor((m) => m.type === 's');
  assert.equal(sa.p.length, 1);
  assert.equal(sc.p.length, 1);
  a.ws.close(); c.ws.close();
});

test('пустой код комнаты — создаётся новая со случайным кодом', async () => {
  const a = client();
  const w = await a.join('', 'Аноним');
  assert.match(w.room, /^[A-Z2-9]{4}$/);
  a.ws.close();
});

test('имя очищается от лишних символов', async () => {
  const a = client();
  await a.join('NAMES', '<b>Хакер</b>  с очень-очень длинным именем');
  const r = await a.waitFor((m) => m.type === 'roster');
  const name = r.players[0].name;
  assert.ok(!/[<>]/.test(name));
  assert.ok(name.length <= 14);
  a.ws.close();
});

test('мусорные сообщения не ломают сервер', async () => {
  const a = client();
  await a.join('JUNK', 'A');
  a.ws.send('{{{ не json');
  a.ws.send(Buffer.from([1, 2, 3]));
  a.send({ type: 'input', x: 'abc', z: null });
  a.send([1, 2, 3]);
  a.send({ type: 'неизвестный' });
  a.send({ type: 'ping', t: 42 });
  const pong = await a.waitFor((m) => m.type === 'pong');
  assert.equal(pong.t, 42);

  const big = client(); // слишком большое сообщение — соединение закрывается, сервер живёт
  await big.open;
  const closed = new Promise((r) => big.ws.once('close', r));
  big.ws.send('x'.repeat(5000));
  await closed;
  assert.equal((await get('/health')).body, 'ok');
  a.ws.close();
});

test('когда игрок уходит, остальные получают обновлённый список', async () => {
  const a = client();
  const b = client();
  await a.join('LEAVE', 'A');
  await b.join('LEAVE', 'B');
  await a.waitFor((m) => m.type === 'roster' && m.players.length === 2);
  b.ws.close();
  await a.waitFor((m) => m.type === 'roster' && m.players.length === 1);
  a.ws.close();
});

test('девятый игрок получает «комната заполнена»', async () => {
  const clients = [];
  for (let i = 0; i < CONFIG.maxPlayers; i++) {
    const c = client();
    assert.equal((await c.join('FULL', 'p' + i)).type, 'welcome');
    clients.push(c);
  }
  const extra = client();
  const res = await extra.join('FULL', 'лишний');
  assert.equal(res.type, 'error');
  assert.equal(res.code, 'full');
  for (const c of [...clients, extra]) c.ws.close();
});

test('пустая комната удаляется из памяти', async () => {
  const a = client();
  await a.join('TEMP', 'A');
  assert.ok(srv.rooms.has('TEMP'));
  a.ws.close();
  for (let i = 0; i < 40 && srv.rooms.has('TEMP'); i++) await sleep(25);
  assert.ok(!srv.rooms.has('TEMP'));
});

test('боты: заказываются при создании комнаты, добавляются и убираются по сообщению', async () => {
  const a = client();
  await a.open;
  a.send({ type: 'join', room: 'BOTS', name: 'Шер', bots: 2, level: 'hard' });
  await a.waitFor((m) => m.type === 'welcome');
  const roster = await a.waitFor((m) => m.type === 'roster' && m.players.length === 3);
  assert.equal(roster.players.filter((p) => p.bot).length, 2);

  a.send({ type: 'bots', delta: 1 });
  await a.waitFor((m) => m.type === 'roster' && m.players.length === 4);
  a.send({ type: 'bots', delta: -1 });
  a.send({ type: 'bots', delta: -1 });
  await a.waitFor((m) => m.type === 'roster' && m.players.length === 2);

  // друг заходит по коду и просит ботов — в уже созданной комнате это игнорируется
  const b = client();
  await b.open;
  b.send({ type: 'join', room: 'BOTS', name: 'Друг', bots: 5 });
  await b.waitFor((m) => m.type === 'welcome');
  const r2 = await b.waitFor((m) => m.type === 'roster' && m.players.length === 3);
  assert.equal(r2.players.filter((p) => p.bot).length, 1);

  // в снимках видны и люди, и боты
  const snap = await a.waitFor((m) => m.type === 's' && m.p.length === 3);
  assert.equal(snap.p.length, 3);
  a.ws.close(); b.ws.close();
});
