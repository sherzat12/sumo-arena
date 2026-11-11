// HTTP-сервер (раздаёт игру) + WebSocket-сервер (комнаты и игровой цикл).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { cleanLevel } from './bot.js';
import { CONFIG } from '../shared/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

// Какие URL какие папки раздают. Самый длинный префикс — первым.
const ROUTES = [
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three'), true],
  ['/shared/', path.join(ROOT, 'shared'), false],
  ['/client/', path.join(ROOT, 'client'), false],
  ['/', path.join(ROOT, 'public'), false],
];

const gzipCache = new Map(); // файл -> { mtime, buf }

function resolveStatic(pathname) {
  for (const [prefix, dir, immutable] of ROUTES) {
    if (!pathname.startsWith(prefix)) continue;
    let rel = pathname.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep)) return null; // защита от выхода из папки
    return { file, immutable };
  }
  return null;
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Не найдено');
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  const target = resolveStatic(pathname);
  if (!target) return notFound(res);

  fs.stat(target.file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const ext = path.extname(target.file).toLowerCase();
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': target.immutable ? 'public, max-age=86400' : 'no-cache',
    };
    const wantsGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    fs.readFile(target.file, (e, data) => {
      if (e) return notFound(res);
      if (wantsGzip) {
        let hit = gzipCache.get(target.file);
        if (!hit || hit.mtime !== st.mtimeMs) {
          hit = { mtime: st.mtimeMs, buf: zlib.gzipSync(data) };
          gzipCache.set(target.file, hit);
        }
        data = hit.buf;
        headers['content-encoding'] = 'gzip';
        headers.vary = 'Accept-Encoding';
      }
      headers['content-length'] = data.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const cleanCode = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const cleanName = (v) => String(v ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 14);

export function startServer({ port = 3000, host = '0.0.0.0' } = {}) {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const hosts = new Map(); // код комнаты -> { room, clients, acc, sinceSend }
  const conns = new Set();
  let nextId = 1;

  const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  const broadcast = (h, obj) => {
    const text = JSON.stringify(obj);
    for (const c of h.clients.values()) {
      if (c.ws.readyState === 1 && c.ws.bufferedAmount < 1_000_000) c.ws.send(text);
    }
  };

  function randomCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!hosts.has(code)) return code;
    }
  }

  function onJoin(conn, msg) {
    if (conn.host) return;
    const name = cleanName(msg.name) || `Игрок ${conn.id}`;
    const code = cleanCode(msg.room) || randomCode();
    let h = hosts.get(code);
    const created = !h;
    if (created) {
      h = { room: new Room(code), clients: new Map(), acc: 0, sinceSend: 0 };
      hosts.set(code, h);
    }
    const player = h.room.addPlayer(conn.id, name);
    if (!player) {
      send(conn.ws, { type: 'error', code: 'full', message: 'Комната заполнена (максимум ' + CONFIG.maxPlayers + ' игроков)' });
      return;
    }
    conn.host = h;
    conn.player = player;
    conn.lastInput = Date.now();
    h.clients.set(conn.id, conn);
    // Боты заказываются при создании комнаты (в чужую комнату по коду их не добавляем).
    if (created) {
      const n = Math.max(0, Math.min(CONFIG.maxPlayers - 1, Math.trunc(Number(msg.bots)) || 0));
      h.room.setBots(n, cleanLevel(msg.level));
    }
    send(conn.ws, { type: 'welcome', id: conn.id, room: code });
    broadcast(h, h.room.rosterMessage());
  }

  function leave(conn) {
    const h = conn.host;
    if (!h) return;
    conn.host = null;
    h.room.removePlayer(conn.id);
    h.clients.delete(conn.id);
    if (h.clients.size === 0) hosts.delete(h.room.code);
    else broadcast(h, h.room.rosterMessage());
  }

  wss.on('connection', (ws) => {
    const conn = { ws, id: nextId++, host: null, player: null, lastInput: Date.now(), msgs: 0, isAlive: true };
    conns.add(conn);
    const joinTimer = setTimeout(() => { if (!conn.host) ws.close(4000, 'join timeout'); }, 15000);

    ws.on('pong', () => { conn.isAlive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (++conn.msgs > 200) { ws.close(1008, 'too many messages'); return; }
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'join') onJoin(conn, msg);
      else if (msg.type === 'input' && conn.host) {
        conn.lastInput = Date.now();
        conn.host.room.setInput(conn.id, msg);
      } else if (msg.type === 'bots' && conn.host) {
        const room = conn.host.room;
        if (msg.delta > 0) room.addBot(cleanLevel(msg.level));
        else if (msg.delta < 0) room.removeBot();
        else return;
        broadcast(conn.host, room.rosterMessage());
      } else if (msg.type === 'ping') {
        send(ws, { type: 'pong', t: Number.isFinite(msg.t) ? msg.t : 0 });
      }
    });
    ws.on('close', () => { clearTimeout(joinTimer); conns.delete(conn); leave(conn); });
    ws.on('error', () => {});
  });

  // Игровой цикл: фиксированный шаг физики + рассылка снимков.
  const dt = 1 / CONFIG.tickRate;
  let last = performance.now();
  const loop = setInterval(() => {
    const now = performance.now();
    const elapsed = Math.min((now - last) / 1000, 0.25);
    last = now;
    const wall = Date.now();
    for (const h of hosts.values()) {
      // Если от игрока давно нет ввода (вкладка заснула) — останавливаем шар.
      for (const c of h.clients.values()) {
        if (wall - c.lastInput > 700) h.room.setInput(c.id, { x: 0, z: 0, jump: false });
      }
      h.acc += elapsed;
      let steps = 0;
      while (h.acc >= dt && steps < 8) { h.room.step(dt); h.acc -= dt; steps++; }
      if (steps === 8) h.acc = 0;
      h.sinceSend += elapsed;
      if (h.sinceSend >= 1 / CONFIG.sendRate) {
        h.sinceSend = 0;
        broadcast(h, h.room.snapshot());
      }
    }
  }, 8);

  const rateTimer = setInterval(() => { for (const c of conns) c.msgs = 0; }, 1000);
  const heartbeat = setInterval(() => {
    for (const c of conns) {
      if (!c.isAlive) { c.ws.terminate(); continue; }
      c.isAlive = false;
      try { c.ws.ping(); } catch { /* соединение уже закрыто */ }
    }
  }, 15000);

  function close() {
    clearInterval(loop);
    clearInterval(rateTimer);
    clearInterval(heartbeat);
    for (const c of conns) c.ws.terminate();
    wss.close();
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, port: server.address().port, rooms: hosts, close }));
  });
}
