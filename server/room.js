// Игровая комната: физика (cannon-es), правила, очки, возрождение.
// Не знает про сеть — поэтому легко тестируется: step(dt) двигает мир, snapshot() отдаёт состояние.
import * as CANNON from 'cannon-es';
import { CONFIG } from '../shared/config.js';

const { arena, player: P, box: B } = CONFIG;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v) => (Number.isFinite(v) ? v : 0);

export class Room {
  constructor(code, rng = Math.random) {
    this.code = code;
    this.rng = rng;
    this.time = 0;
    this.players = new Map();   // id -> игрок
    this.bodyOwner = new Map(); // body.id -> игрок
    this.events = [];           // события для клиентов (эффекты, звук, лента)
    this.state = 'play';        // 'play' | 'win'
    this.winner = null;
    this.resetAt = 0;

    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, CONFIG.gravity, 0) });
    world.broadphase = new CANNON.NaiveBroadphase(); // тел мало — этого достаточно
    world.solver.iterations = 12;
    world.allowSleep = false;
    this.world = world;

    const mGround = new CANNON.Material('ground');
    const mPlayer = new CANNON.Material('player');
    const mBox = new CANNON.Material('box');
    const link = (a, b, friction, restitution) =>
      world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
    link(mPlayer, mGround, 0.35, 0.15);
    link(mPlayer, mPlayer, 0.05, 0.85); // шары упруго отскакивают друг от друга
    link(mPlayer, mBox, 0.2, 0.3);
    link(mBox, mGround, 0.5, 0.1);
    link(mBox, mBox, 0.4, 0.1);
    this.materials = { ground: mGround, player: mPlayer, box: mBox };

    // Арена: неподвижный цилиндр, верхняя грань на высоте y = 0.
    const arenaBody = new CANNON.Body({ mass: 0, material: mGround });
    arenaBody.addShape(new CANNON.Cylinder(arena.radius, arena.radius, arena.thickness, 48));
    arenaBody.position.set(0, -arena.thickness / 2, 0);
    world.addBody(arenaBody);
    this.arenaBody = arenaBody;

    // Ящики
    this.boxes = [];
    const h = B.size / 2;
    for (let i = 0; i < B.count; i++) {
      const body = new CANNON.Body({ mass: B.mass, material: mBox, linearDamping: 0.1, angularDamping: 0.2 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(h, h, h)));
      this._placeBox(body, i, false);
      world.addBody(body);
      this.boxes.push(body);
    }
  }

  get size() { return this.players.size; }

  _emit(ev) { if (this.events.length < 64) this.events.push(ev); }

  _placeBox(body, i, drop) {
    const h = B.size / 2;
    if (drop) {
      const a = this.rng() * Math.PI * 2;
      const r = this.rng() * 4;
      body.position.set(Math.cos(a) * r, 6, Math.sin(a) * r);
    } else {
      const a = (i / B.count) * Math.PI * 2 + 0.3;
      const r = 3.5 + (i % 2) * 1.5;
      body.position.set(Math.cos(a) * r, h + 0.05, Math.sin(a) * r);
    }
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.quaternion.set(0, 0, 0, 1);
  }

  // ---------- игроки ----------

  addPlayer(id, name) {
    if (this.players.size >= CONFIG.maxPlayers) return null;
    const used = new Set([...this.players.values()].map((p) => p.color));
    let color = 0;
    while (used.has(color)) color++;

    const body = new CANNON.Body({
      mass: P.mass,
      material: this.materials.player,
      shape: new CANNON.Sphere(P.radius),
      linearDamping: P.linearDamping,
      angularDamping: P.angularDamping,
    });
    const p = {
      id, name, color, body,
      alive: false, inWorld: false, score: 0,
      input: { x: 0, z: 0, fx: 0, fz: -1, jump: false, dash: false },
      grounded: false, lastHit: null,
      dashReadyAt: 0, dashUntil: 0, lastJump: -1, respawnAt: 0,
    };
    body.addEventListener('collide', (ev) => this._onCollide(p, ev));
    this.players.set(id, p);
    this.bodyOwner.set(body.id, p);
    this._spawn(p);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.inWorld) this.world.removeBody(p.body);
    this.bodyOwner.delete(p.body.id);
    this.players.delete(id);
  }

  setInput(id, raw) {
    const p = this.players.get(id);
    if (!p || !raw || typeof raw !== 'object') return;
    let x = num(raw.x), z = num(raw.z);
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    p.input.x = x;
    p.input.z = z;
    const fx = num(raw.fx), fz = num(raw.fz);
    const fl = Math.hypot(fx, fz);
    if (fl > 1e-6) { p.input.fx = fx / fl; p.input.fz = fz / fl; }
    p.input.jump = !!raw.jump;
    if (raw.dash) p.input.dash = true; // «запомнить» до обработки на сервере
  }

  _spawnPoint() {
    const alive = [...this.players.values()].filter((q) => q.alive);
    const base = this.rng() * Math.PI * 2;
    let best = null;
    let bestD = -1;
    for (let i = 0; i < 16; i++) {
      const a = base + (i / 16) * Math.PI * 2;
      const x = Math.cos(a) * 7.5;
      const z = Math.sin(a) * 7.5;
      let d = Infinity;
      for (const q of alive) d = Math.min(d, Math.hypot(q.body.position.x - x, q.body.position.z - z));
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
    return best;
  }

  _restoreMass(p) {
    p.dashUntil = 0;
    if (p.body.mass !== P.mass) { p.body.mass = P.mass; p.body.updateMassProperties(); }
  }

  _spawn(p) {
    const s = this._spawnPoint();
    const b = p.body;
    b.position.set(s.x, 1.6, s.z);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    b.force.setZero();
    b.torque.setZero();
    b.quaternion.set(0, 0, 0, 1);
    this._restoreMass(p);
    if (!p.inWorld) { this.world.addBody(b); p.inWorld = true; }
    p.alive = true;
    p.grounded = false;
    p.lastHit = null;
  }

  // ---------- такт ----------

  step(dt) {
    this.time += dt;
    const now = this.time;

    if (this.state === 'win' && now >= this.resetAt) this._resetMatch();

    for (const p of this.players.values()) {
      if (p.alive) this._control(p, now);
      else if (now >= p.respawnAt) this._spawn(p);
    }

    this.world.step(dt);
    this._afterStep(now);
  }

  _control(p, now) {
    const b = p.body;
    const inp = p.input;
    if (p.dashUntil && now >= p.dashUntil) this._restoreMass(p);

    const len = Math.hypot(inp.x, inp.z);
    const wx = len > 0.01 ? inp.x / len : 0;
    const wz = len > 0.01 ? inp.z / len : 0;

    if (len > 0.01) {
      // Разгоняем только пока скорость вдоль желаемого направления ниже предела,
      // поэтому удар отбрасывает шар, а не гасится «тормозом» управления.
      const along = b.velocity.x * wx + b.velocity.z * wz;
      if (along < P.speed) {
        const k = P.accel * P.mass * (p.grounded ? 1 : P.airControl) * Math.min(len, 1);
        b.force.x += wx * k;
        b.force.z += wz * k;
      }
    }

    if (inp.jump && p.grounded && now - p.lastJump > 0.25) {
      b.velocity.y = P.jumpSpeed;
      p.lastJump = now;
      p.grounded = false;
      this._emit({ k: 'jump', id: p.id, x: r2(b.position.x), y: r2(b.position.y), z: r2(b.position.z) });
    }

    if (inp.dash) {
      inp.dash = false;
      if (now >= p.dashReadyAt) {
        const dx = len > 0.01 ? wx : inp.fx;
        const dz = len > 0.01 ? wz : inp.fz;
        b.velocity.x += dx * P.dashSpeed;
        b.velocity.z += dz * P.dashSpeed;
        p.dashReadyAt = now + P.dashCooldown;
        p.dashUntil = now + P.dashDuration;
        b.mass = P.dashMass;
        b.updateMassProperties();
        this._emit({ k: 'dash', id: p.id, x: r2(b.position.x), y: r2(b.position.y), z: r2(b.position.z) });
      }
    }
  }

  _afterStep(now) {
    // Что под ногами и кто с кем соприкасается
    for (const p of this.players.values()) p.grounded = false;
    for (const c of this.world.contacts) {
      const a = this.bodyOwner.get(c.bi.id);
      const b = this.bodyOwner.get(c.bj.id);
      if (a && c.ni.y < -0.6) a.grounded = true; // нормаль из тела i «вниз» — опора под i
      if (b && c.ni.y > 0.6) b.grounded = true;
      if (a && b) {
        a.lastHit = { by: b.id, t: now };
        b.lastHit = { by: a.id, t: now };
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const v = p.body.velocity;
      const sp = Math.hypot(v.x, v.z);
      if (sp > P.maxSpeed) { v.x *= P.maxSpeed / sp; v.z *= P.maxSpeed / sp; }
      if (p.body.position.y < CONFIG.voidY) this._kill(p, now);
    }

    this.boxes.forEach((body, i) => {
      if (body.position.y < CONFIG.voidY) this._placeBox(body, i, true);
    });
  }

  _kill(p, now) {
    const pos = p.body.position;
    let by = null;
    if (p.lastHit && now - p.lastHit.t <= CONFIG.lastHitWindow && this.players.has(p.lastHit.by)) by = p.lastHit.by;

    this._emit({ k: 'fall', id: p.id, by, x: r2(pos.x), z: r2(pos.z) });
    this.world.removeBody(p.body);
    p.inWorld = false;
    p.alive = false;
    p.lastHit = null;
    p.respawnAt = now + CONFIG.respawnDelay;
    this._restoreMass(p);

    if (by !== null && this.state === 'play') {
      const killer = this.players.get(by);
      killer.score++;
      if (killer.score >= CONFIG.winScore) {
        this.state = 'win';
        this.winner = killer.id;
        this.resetAt = now + CONFIG.roundResetDelay;
        this._emit({ k: 'win', id: killer.id });
      }
    }
  }

  _resetMatch() {
    this.state = 'play';
    this.winner = null;
    for (const p of this.players.values()) {
      p.score = 0;
      if (p.inWorld) { this.world.removeBody(p.body); p.inWorld = false; }
      p.alive = false;
    }
    for (const p of this.players.values()) this._spawn(p);
    this.boxes.forEach((body, i) => this._placeBox(body, i, false));
    this._emit({ k: 'reset' });
  }

  _onCollide(p, ev) {
    const other = this.bodyOwner.get(ev.body.id);
    if (other && other.id < p.id) return; // пару игроков сообщаем один раз
    const impact = Math.abs(ev.contact.getImpactVelocityAlongNormal());
    if (impact < 2.5) return;
    const pos = p.body.position;
    this._emit({ k: 'hit', x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), p: r2(Math.min(impact / 14, 1)) });
  }

  // ---------- что отправляем клиентам ----------

  rosterMessage() {
    return {
      type: 'roster',
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color })),
    };
  }

  snapshot() {
    const now = this.time;
    const p = [];
    for (const pl of this.players.values()) {
      const b = pl.body;
      p.push([
        pl.id, r2(b.position.x), r2(b.position.y), r2(b.position.z),
        r3(b.quaternion.x), r3(b.quaternion.y), r3(b.quaternion.z), r3(b.quaternion.w),
        pl.alive ? 1 : 0, pl.score, r2(Math.max(0, (pl.dashReadyAt - now) / P.dashCooldown)),
      ]);
    }
    const bx = this.boxes.map((b) => [
      r2(b.position.x), r2(b.position.y), r2(b.position.z),
      r3(b.quaternion.x), r3(b.quaternion.y), r3(b.quaternion.z), r3(b.quaternion.w),
    ]);
    const out = { type: 's', t: r3(now), p, b: bx };
    if (this.events.length) { out.ev = this.events; this.events = []; }
    return out;
  }
}
