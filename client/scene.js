// 3D-сцена: арена, лава, шары, ящики, эффекты и камера от третьего лица.
import * as THREE from 'three';
import { CONFIG } from '/shared/config.js';
import {
  arenaTexture, ballTexture, lavaTexture, crateTexture, skyTexture, sparkTexture, labelTexture,
} from './textures.js';

const { arena, player: P, box: B } = CONFIG;
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const lerp = (a, b, t) => a + (b - a) * t;

// Искры, пыль и брызги: один пул частиц, рисуется одним вызовом.
class Sparks {
  constructor(scene, max = 500) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({
      size: 0.5, map: sparkTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, r, g, b, life) {
    const k = this.next;
    this.next = (this.next + 1) % this.max;
    const i = k * 3;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    this.vel[i] = vx; this.vel[i + 1] = vy; this.vel[i + 2] = vz;
    this.base[i] = r; this.base[i + 1] = g; this.base[i + 2] = b;
    this.life[k] = this.maxLife[k] = life;
  }

  burst(x, y, z, count, speed, [r, g, b], { life = 0.6, up = 0.5 } = {}) {
    for (let n = 0; n < count; n++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.35 + 0.65 * Math.random());
      this.emit(
        x, y, z,
        Math.sin(ph) * Math.cos(th) * v, Math.abs(Math.cos(ph)) * v + up * speed, Math.sin(ph) * Math.sin(th) * v,
        r, g, b, life * (0.6 + 0.8 * Math.random()),
      );
    }
  }

  update(dt) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue;
      const i = k * 3;
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        this.pos[i + 1] = -999;
        this.col[i] = this.col[i + 1] = this.col[i + 2] = 0;
        continue;
      }
      this.vel[i + 1] -= 14 * dt;
      this.pos[i] += this.vel[i] * dt;
      this.pos[i + 1] += this.vel[i + 1] * dt;
      this.pos[i + 2] += this.vel[i + 2] * dt;
      const f = this.life[k] / this.maxLife[k];
      this.col[i] = this.base[i] * f;
      this.col[i + 1] = this.base[i + 1] * f;
      this.col[i + 2] = this.base[i + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class GameScene {
  constructor(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0x4a2050, 50, 170);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);

    this.players = new Map(); // id -> { mesh, label, color, alive, score, cd }
    this.boxes = [];
    this.roster = new Map();
    this.decor = [];
    this.camTarget = new THREE.Vector3();
    this.camDist = 16;
    this.shake = 0;
    this.myPos = null;
    this.ballGeo = new THREE.SphereGeometry(P.radius, 32, 24);
    this.boxGeo = new THREE.BoxGeometry(B.size, B.size, B.size);
    this.boxMat = new THREE.MeshStandardMaterial({ map: crateTexture(), roughness: 0.8 });

    this._buildWorld();
    this.sparks = new Sparks(this.scene);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  _buildWorld() {
    const scene = this.scene;
    const R = arena.radius;
    const T = arena.thickness;

    scene.add(new THREE.HemisphereLight(0xc7d6ff, 0x6a2a24, 1.0));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    sun.position.set(14, 28, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    const glow = new THREE.PointLight(0xff6a1a, 90, 45, 2); // отсвет лавы на скале
    glow.position.set(0, -6, 0);
    scene.add(glow);

    // Арена
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a3a52, roughness: 1, flatShading: true });
    const topMat = new THREE.MeshStandardMaterial({ map: arenaTexture(), roughness: 0.8, metalness: 0.1 });
    const arenaMesh = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 72), [rockMat, topMat, rockMat]);
    arenaMesh.position.y = -T / 2;
    arenaMesh.receiveShadow = true;
    scene.add(arenaMesh);

    const stalactite = new THREE.Mesh(new THREE.ConeGeometry(R * 0.98, 10, 14), rockMat);
    stalactite.rotation.x = Math.PI;
    stalactite.position.y = -T - 5;
    scene.add(stalactite);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(R, 0.1, 8, 120),
      new THREE.MeshBasicMaterial({ color: 0xff7a2f }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    scene.add(rim);

    // Лава
    this.lavaTex = lavaTexture();
    this.lavaTex.repeat.set(60, 60);
    const lava = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshBasicMaterial({ map: this.lavaTex }),
    );
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = CONFIG.lavaY;
    scene.add(lava);

    // Парящие камни вдали — для глубины сцены
    const decorMat = new THREE.MeshStandardMaterial({ color: 0x5b4663, roughness: 1, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 32 + Math.random() * 45;
      const size = 1.5 + Math.random() * 4;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), decorMat);
      m.position.set(Math.cos(a) * d, -3 + Math.random() * 18, Math.sin(a) * d);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      scene.add(m);
      this.decor.push({ mesh: m, spin: (Math.random() - 0.5) * 0.4 });
    }

    // Кольцо под своим шаром — чтобы себя не потерять в толпе
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.05, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- игроки ----------

  setRoster(roster) {
    this.roster = roster;
    for (const [id, o] of this.players) {
      if (roster.has(id)) continue;
      this.scene.remove(o.mesh, o.label);
      o.mesh.material.map?.dispose();
      o.mesh.material.dispose();
      o.label.material.map?.dispose();
      o.label.material.dispose();
      this.players.delete(id);
    }
  }

  _makePlayer(id) {
    const info = this.roster.get(id);
    if (!info) return null;
    const hex = CONFIG.colors[info.color % CONFIG.colors.length];
    const mesh = new THREE.Mesh(
      this.ballGeo,
      new THREE.MeshStandardMaterial({ map: ballTexture(hex), roughness: 0.35, metalness: 0.15 }),
    );
    mesh.castShadow = true;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: labelTexture(info.name), transparent: true, depthWrite: false }),
    );
    label.scale.set(3.2, 0.8, 1);
    this.scene.add(mesh, label);
    const c = new THREE.Color(hex);
    const o = { id, mesh, label, rgb: [c.r, c.g, c.b], alive: false, score: 0, cd: 0 };
    this.players.set(id, o);
    return o;
  }

  _makeBox() {
    const m = new THREE.Mesh(this.boxGeo, this.boxMat);
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    this.boxes.push(m);
  }

  // Расставляет всё по двум снимкам и доле alpha между ними.
  applyInterp(a, b, alpha) {
    const prev = new Map();
    for (const row of a.p) prev.set(row[0], row);

    for (const pb of b.p) {
      const id = pb[0];
      let o = this.players.get(id);
      if (!o) { o = this._makePlayer(id); if (!o) continue; }
      let pa = prev.get(id) || pb;
      if (pa[8] !== pb[8]) pa = pb; // возрождение: не «ездим» из старой точки

      const x = lerp(pa[1], pb[1], alpha);
      const y = lerp(pa[2], pb[2], alpha);
      const z = lerp(pa[3], pb[3], alpha);
      o.mesh.position.set(x, y, z);
      qa.set(pa[4], pa[5], pa[6], pa[7]);
      qb.set(pb[4], pb[5], pb[6], pb[7]);
      o.mesh.quaternion.copy(qa).slerp(qb, alpha);

      const wasAlive = o.alive;
      o.alive = pb[8] === 1;
      o.score = pb[9];
      o.cd = pb[10];
      o.mesh.visible = o.alive;
      o.label.visible = o.alive;
      o.label.position.set(x, y + 1.3, z);

      if (o.alive && !wasAlive) this.sparks.burst(x, y, z, 26, 6, o.rgb, { life: 0.7 });
      // След от рывка: пока кулдаун почти полный, значит рывок был только что
      if (o.alive && o.cd > 0.83) {
        this.sparks.emit(
          x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4,
          0, 0.6, 0, o.rgb[0], o.rgb[1], o.rgb[2], 0.4,
        );
      }
    }

    while (this.boxes.length < b.b.length) this._makeBox();
    b.b.forEach((nb, i) => {
      const na = a.b[i] || nb;
      const m = this.boxes[i];
      m.position.set(lerp(na[0], nb[0], alpha), lerp(na[1], nb[1], alpha), lerp(na[2], nb[2], alpha));
      qa.set(na[3], na[4], na[5], na[6]);
      qb.set(nb[3], nb[4], nb[5], nb[6]);
      m.quaternion.copy(qa).slerp(qb, alpha);
    });
  }

  // ---------- эффекты ----------

  _nearMe(x, z, radius) {
    return this.myPos && Math.hypot(this.myPos.x - x, this.myPos.z - z) < radius;
  }

  hitEffect(e) {
    this.sparks.burst(e.x, e.y, e.z, 8 + Math.round(24 * e.p), 3 + 7 * e.p, [1, 0.85, 0.5], { life: 0.5 });
    if (e.p > 0.4 && this._nearMe(e.x, e.z, 12)) this.shake = Math.max(this.shake, 0.35 * e.p);
  }
  dust(e) { this.sparks.burst(e.x, e.y - 0.5, e.z, 6, 2.2, [0.7, 0.7, 0.85], { life: 0.4, up: 0.2 }); }
  dashEffect(e) { this.sparks.burst(e.x, e.y, e.z, 16, 5, [1, 0.95, 0.8], { life: 0.35, up: 0.1 }); }
  splash(e) {
    this.sparks.burst(e.x, CONFIG.lavaY, e.z, 50, 9, [1, 0.5, 0.1], { life: 0.9, up: 0.9 });
    if (this._nearMe(e.x, e.z, 20)) this.shake = Math.max(this.shake, 0.15);
  }

  // ---------- кадр ----------

  update(dt, controls, myId) {
    this.lavaTex.offset.x += dt * 0.012;
    this.lavaTex.offset.y += dt * 0.007;
    for (const d of this.decor) d.mesh.rotation.y += d.spin * dt;
    this.sparks.update(dt);
    this._updateCamera(dt, controls, myId);
  }

  _updateCamera(dt, controls, myId) {
    const me = this.players.get(myId);
    const alive = me && me.alive;
    const wantTarget = alive ? me.mesh.position : { x: 0, y: 0, z: 0 };
    if (!alive) controls.yaw += dt * 0.15; // пока вы выбыли — камера плавно облетает арену

    this.camTarget.x += (wantTarget.x - this.camTarget.x) * (1 - Math.exp(-dt * 9));
    this.camTarget.y += (wantTarget.y - this.camTarget.y) * (1 - Math.exp(-dt * 9));
    this.camTarget.z += (wantTarget.z - this.camTarget.z) * (1 - Math.exp(-dt * 9));

    const wantDist = alive ? 10 : 24;
    this.camDist += (wantDist - this.camDist) * (1 - Math.exp(-dt * 3));

    const yaw = controls.yaw;
    const pitch = controls.pitch;
    const t = this.camTarget;
    this.camera.position.set(
      t.x + Math.sin(yaw) * Math.cos(pitch) * this.camDist,
      t.y + 0.8 + Math.sin(pitch) * this.camDist,
      t.z + Math.cos(yaw) * Math.cos(pitch) * this.camDist,
    );
    if (this.shake > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(t.x, t.y + 0.4, t.z);

    if (alive) {
      this.myPos = me.mesh.position;
      this.ring.visible = me.mesh.position.y > -0.2 && me.mesh.position.y < 2.5;
      this.ring.position.set(me.mesh.position.x, 0.04, me.mesh.position.z);
      this.ring.material.opacity = 0.6 + 0.25 * Math.sin(performance.now() / 220);
    } else {
      this.myPos = null;
      this.ring.visible = false;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
