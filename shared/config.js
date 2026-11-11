// Общие настройки игры: их читают и сервер, и браузер.
// Хотите изменить баланс (скорость, прыжок, размер арены) — правьте здесь.
export const CONFIG = {
  tickRate: 60,        // шагов физики в секунду
  sendRate: 30,        // снимков состояния игрокам в секунду
  maxPlayers: 8,
  gravity: -24,

  arena: { radius: 13, thickness: 1 },
  lavaY: -8,           // уровень лавы (для картинки)
  voidY: -8.5,         // ниже этой высоты игрок считается упавшим

  player: {
    radius: 0.6,
    mass: 1,
    speed: 9,          // целевая скорость бега
    accel: 42,         // разгон
    airControl: 0.4,   // доля управления в воздухе
    jumpSpeed: 9,
    dashSpeed: 14,     // добавка скорости при рывке
    dashMass: 2.4,     // во время рывка шар тяжелее и бьёт сильнее
    dashDuration: 0.35,
    dashCooldown: 1.5,
    linearDamping: 0.2,
    angularDamping: 0.4,
    maxSpeed: 26,
  },

  box: { size: 1.3, mass: 4, count: 5 }, // ящики, которые можно двигать

  respawnDelay: 2,       // сек до возрождения
  winScore: 7,           // очков до победы в матче
  roundResetDelay: 6,    // пауза после победы
  lastHitWindow: 4,      // сек, в течение которых толчок засчитывается

  colors: ['#ff5252', '#2979ff', '#00e676', '#ffd740', '#e040fb', '#18ffff', '#ff9100', '#f5f5f5'],
};
