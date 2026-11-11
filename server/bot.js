// «Мозги» бота. Бот ходит теми же кнопками, что и человек: считает желаемое направление
// и отдаёт его в room.setInput(). Читов нет — те же скорость, рывок и физика.
import { CONFIG } from '../shared/config.js';

export const LEVELS = {
  easy:   { react: 0.38, noise: 0.55, dashP: 0.25, edge: 2.4, power: 0.75 },
  normal: { react: 0.22, noise: 0.28, dashP: 0.55, edge: 1.9, power: 0.92 },
  hard:   { react: 0.10, noise: 0.08, dashP: 0.95, edge: 1.5, power: 1 },
};
export const DEFAULT_LEVEL = 'normal';
export const cleanLevel = (v) => (Object.hasOwn(LEVELS, v) ? v : DEFAULT_LEVEL);

export const BOT_NAMES = [
  'Артём', 'Лола', 'Бублик', 'Танк', 'Ниндзя', 'Пончик', 'Громила', 'Шустрик',
  'Кекс', 'Малыш', 'Барон', 'Тигра', 'Ураган', 'Йети',
];

const R = CONFIG.arena.radius;

export function makeBotState(level) {
  return { level: cleanLevel(level), nextThink: 0, side: 1 };
}

// Решение принимается не каждый кадр, а раз в L.react секунд — так бот реагирует «по-человечески».
export function thinkBot(room, p, now) {
  const bot = p.bot;
  const L = LEVELS[bot.level];
  if (now < bot.nextThink) return;
  bot.nextThink = now + L.react * (0.7 + 0.6 * room.rng());

  const pos = p.body.position;
  const vel = p.body.velocity;
  const px = pos.x + vel.x * 0.45; // где окажемся через ~полсекунды
  const pz = pos.z + vel.z * 0.45;
  const edgeDist = Math.hypot(px, pz);

  let mx = 0;
  let mz = 0;
  let dash = false;

  if (edgeDist > R - L.edge) {
    // Слишком близко к обрыву — уходим к центру, про соперников забываем.
    mx = -px;
    mz = -pz;
  } else {
    let target = null;
    let best = Infinity;
    for (const q of room.players.values()) {
      if (q === p || !q.alive) continue;
      const d = Math.hypot(q.body.position.x - pos.x, q.body.position.z - pos.z);
      if (d < best) { best = d; target = q; }
    }

    if (!target) {
      mx = -pos.x * 0.5; // никого нет — ждём в центре
      mz = -pos.z * 0.5;
    } else {
      const tp = target.body.position;
      const tv = target.body.velocity;
      const tx = tp.x + tv.x * 0.25;
      const tz = tp.z + tv.z * 0.25;
      const td = Math.hypot(tx, tz) || 1;
      const ox = tx / td; // «наружу» от центра в точке цели
      const oz = tz / td;
      const dist = Math.hypot(tx - pos.x, tz - pos.z);
      const inner = (pos.x - tx) * ox + (pos.z - tz) * oz < 0.3; // мы между целью и центром

      let ax = tx;
      let az = tz;
      if (!inner && dist > 2.4) {
        // Обходим цель сбоку, чтобы оказаться с внутренней стороны и толкнуть её к краю.
        ax = tx - ox * 2.8 - oz * 2.2 * bot.side;
        az = tz - oz * 2.8 + ox * 2.2 * bot.side;
      }
      mx = ax - pos.x;
      mz = az - pos.z;

      // Рывок: цель рядом, мы не на краю, и толчок отправит её наружу (либо нам хватает запаса).
      const safe = edgeDist < R - 4.5 || td > edgeDist;
      if (dist < 3.4 && safe && p.dashReadyAt <= room.time && room.rng() < L.dashP) dash = true;
    }
  }

  const ang = Math.atan2(mz, mx) + (room.rng() - 0.5) * 2 * L.noise;
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  if (room.rng() < 0.05) bot.side = -bot.side; // иногда меняем сторону обхода
  room.setInput(p.id, { x: dx * L.power, z: dz * L.power, fx: dx, fz: dz, jump: false, dash });
}
