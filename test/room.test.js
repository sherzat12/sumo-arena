import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.js';
import { CONFIG } from '../shared/config.js';

const DT = 1 / CONFIG.tickRate;
const R = CONFIG.arena.radius;
const RADIUS = CONFIG.player.radius;

// Детерминированный генератор случайных чисел, чтобы тесты были воспроизводимы
const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// Прогнать комнату `seconds` секунд; each(i) вызывается перед каждым шагом
function run(room, seconds, each) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    if (each) each(i);
    room.step(DT);
  }
}

function place(p, x, z, y = RADIUS) {
  p.body.position.set(x, y, z);
  p.body.velocity.setZero();
  p.body.angularVelocity.setZero();
}

test('арена — вертикальный цилиндр нужного радиуса', () => {
  const room = new Room('T', seeded());
  const v = room.arenaBody.shapes[0].vertices;
  assert.ok(Math.abs(Math.max(...v.map((p) => p.y)) - CONFIG.arena.thickness / 2) < 1e-6);
  assert.ok(Math.abs(Math.max(...v.map((p) => p.x)) - R) < 0.1);
});

test('шар спокойно стоит на арене и «чувствует» опору', () => {
  const room = new Room('T', seeded());
  const p = room.addPlayer(1, 'A');
  place(p, 0, 0, 1.5);
  run(room, 2);
  assert.equal(p.alive, true);
  assert.ok(Math.abs(p.body.position.y - RADIUS) < 0.08, `y = ${p.body.position.y}`);
  assert.equal(p.grounded, true);
});

test('шар разгоняется по вводу и катится', () => {
  const room = new Room('T', seeded());
  const p = room.addPlayer(1, 'A');
  place(p, -6, 0);
  run(room, 0.3);
  room.setInput(1, { x: 1, z: 0 });
  run(room, 1);
  assert.ok(p.body.velocity.x > 6, `vx = ${p.body.velocity.x}`);
  assert.ok(p.body.position.x > -3, `x = ${p.body.position.x}`);
  assert.ok(Math.abs(p.body.angularVelocity.z) > 3, 'шар вращается при движении');
});

test('прыжок работает только с опоры, двойного прыжка нет', () => {
  const room = new Room('T', seeded());
  const p = room.addPlayer(1, 'A');
  place(p, 0, 0);
  run(room, 0.5);
  room.setInput(1, { x: 0, z: 0, jump: true }); // клавиша зажата — прыгаем снова и снова
  let maxY = 0;
  run(room, 1.5, () => { maxY = Math.max(maxY, p.body.position.y); });
  const expectedPeak = RADIUS + (CONFIG.player.jumpSpeed ** 2) / (2 * -CONFIG.gravity);
  assert.ok(maxY > expectedPeak - 0.3, `прыжок слишком низкий: ${maxY}`);
  assert.ok(maxY < expectedPeak + 0.3, `прыжок выше ожидаемого (двойной?): ${maxY}`);
});

test('в воздухе прыжок не срабатывает', () => {
  const room = new Room('T', seeded());
  const p = room.addPlayer(1, 'A');
  place(p, 0, 0, 4); // высоко над ареной
  room.setInput(1, { x: 0, z: 0, jump: true });
  run(room, 0.2);
  assert.ok(p.body.velocity.y < 0, 'шар продолжает падать');
});

test('рывок с ударом сбрасывает соперника, очко получает толкнувший', () => {
  const room = new Room('T', seeded());
  const a = room.addPlayer(1, 'A');
  const b = room.addPlayer(2, 'B');
  place(a, R - 6.2, 0);
  place(b, R - 5.0, 0); // шары касаются
  run(room, 0.2);
  const events = [];
  room.setInput(1, { x: 1, z: 0, dash: true });
  run(room, 5, (i) => {
    events.push(...room.events.splice(0));
    room.setInput(1, { x: i < 6 ? 1 : i < 70 ? -1 : 0, z: 0 }); // после удара тормозим, чтобы не упасть самим
  });
  events.push(...room.events.splice(0));

  const fall = events.find((e) => e.k === 'fall' && e.id === 2);
  assert.ok(fall, 'B должен упасть с арены');
  assert.equal(fall.by, 1, 'очко — тому, кто толкнул');
  assert.equal(a.score, 1);
  assert.equal(a.alive, true);
  assert.equal(b.alive, true, 'B возродился через respawnDelay');
  assert.ok(events.some((e) => e.k === 'dash'));
  assert.ok(events.some((e) => e.k === 'hit'), 'удар порождает событие для эффектов');
});

test('упасть самому — очко никому', () => {
  const room = new Room('T', seeded());
  const a = room.addPlayer(1, 'A');
  const b = room.addPlayer(2, 'B');
  place(b, -5, 0);
  place(a, R + 2, 0, 0.6); // за краем
  const events = [];
  run(room, 3, () => events.push(...room.events.splice(0)));
  const fall = events.find((e) => e.k === 'fall' && e.id === 1);
  assert.ok(fall);
  assert.equal(fall.by, null);
  assert.equal(a.score + b.score, 0);
});

test('победа при winScore очков и новый матч после паузы', () => {
  const room = new Room('T', seeded());
  const a = room.addPlayer(1, 'A');
  const b = room.addPlayer(2, 'B');
  a.score = CONFIG.winScore - 1;
  b.lastHit = { by: 1, t: room.time };
  place(b, R + 2, 0, 0.6);
  const events = [];
  run(room, 2, () => events.push(...room.events.splice(0)));
  assert.equal(room.state, 'win');
  assert.ok(events.some((e) => e.k === 'win' && e.id === 1));
  assert.equal(a.score, CONFIG.winScore);

  run(room, CONFIG.roundResetDelay + 0.5, () => events.push(...room.events.splice(0)));
  assert.equal(room.state, 'play');
  assert.equal(a.score, 0);
  assert.ok(a.alive && b.alive);
  assert.ok(events.some((e) => e.k === 'reset'));
});

test('очки не начисляются в паузе после победы', () => {
  const room = new Room('T', seeded());
  const a = room.addPlayer(1, 'A');
  const b = room.addPlayer(2, 'B');
  a.score = CONFIG.winScore - 1;
  b.lastHit = { by: 1, t: room.time };
  place(b, R + 2, 0, 0.6);
  run(room, 1.5);
  assert.equal(room.state, 'win');
  b.lastHit = { by: 1, t: room.time };
  run(room, 3); // B возродился
  place(b, R + 2, 0, 0.6);
  run(room, 1.5);
  assert.equal(a.score, CONFIG.winScore, 'счёт не растёт после победы');
});

test('вместимость комнаты и освобождение места', () => {
  const room = new Room('T', seeded());
  for (let i = 1; i <= CONFIG.maxPlayers; i++) assert.ok(room.addPlayer(i, 'p' + i));
  assert.equal(room.addPlayer(99, 'лишний'), null);
  room.removePlayer(3);
  assert.equal(room.size, CONFIG.maxPlayers - 1);
  assert.ok(room.addPlayer(100, 'новый'));
});

test('цвета игроков не повторяются', () => {
  const room = new Room('T', seeded());
  for (let i = 1; i <= CONFIG.maxPlayers; i++) room.addPlayer(i, 'p' + i);
  const colors = new Set([...room.players.values()].map((p) => p.color));
  assert.equal(colors.size, CONFIG.maxPlayers);
});

test('ввод очищается от мусора: длина, NaN, типы', () => {
  const room = new Room('T', seeded());
  const p = room.addPlayer(1, 'A');
  room.setInput(1, { x: 1e9, z: NaN, jump: 'да', fx: 'x', fz: Infinity });
  assert.ok(Math.hypot(p.input.x, p.input.z) <= 1 + 1e-9);
  assert.equal(p.input.z, 0);
  assert.equal(p.input.jump, true);
  assert.equal(Math.hypot(p.input.fx, p.input.fz), 1);
  room.setInput(1, null);
  room.setInput(404, { x: 1 }); // несуществующий игрок
});

test('снимок состояния сериализуется и содержит нужные поля', () => {
  const room = new Room('T', seeded());
  room.addPlayer(1, 'A');
  room.addPlayer(2, 'B');
  run(room, 0.5);
  const s = JSON.parse(JSON.stringify(room.snapshot()));
  assert.equal(s.type, 's');
  assert.equal(s.p.length, 2);
  assert.equal(s.b.length, CONFIG.box.count);
  for (const row of s.p) { assert.equal(row.length, 11); assert.ok(row.every(Number.isFinite)); }
  for (const row of s.b) { assert.equal(row.length, 7); assert.ok(row.every(Number.isFinite)); }
});

test('8 игроков со случайным вводом 40 секунд: мир стабилен', () => {
  const rnd = seeded(7);
  const room = new Room('T', rnd);
  for (let i = 1; i <= 8; i++) room.addPlayer(i, 'p' + i);
  run(room, 40, (i) => {
    if (i % 12 !== 0) return;
    for (let id = 1; id <= 8; id++) {
      room.setInput(id, { x: rnd() * 2 - 1, z: rnd() * 2 - 1, jump: rnd() < 0.2, dash: rnd() < 0.15 });
    }
    room.events.length = 0;
  });
  for (const p of room.players.values()) {
    const pos = p.body.position;
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z), 'координаты конечны');
    assert.ok(Math.hypot(p.body.velocity.x, p.body.velocity.z) <= CONFIG.player.maxSpeed + 1e-6);
  }
  for (const b of room.boxes) assert.ok(Number.isFinite(b.position.y));
  assert.ok(room.world.bodies.length <= 1 + CONFIG.box.count + 8);
});
