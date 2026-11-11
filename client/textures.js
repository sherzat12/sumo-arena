// Все текстуры рисуются кодом на canvas — внешних картинок игре не нужно.
import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Верх арены: плитка с кольцами и опасной полосой по краю.
export function arenaTexture() {
  const S = 1024;
  const [c, g] = makeCanvas(S, S);
  const m = S / 2;

  g.fillStyle = '#1b1826';
  g.fillRect(0, 0, S, S);

  // Предупреждающая полоса у края: чередуем оранжевые и тёмные сектора
  const segs = 64;
  for (let i = 0; i < segs; i++) {
    g.beginPath();
    g.moveTo(m, m);
    g.arc(m, m, m * 0.99, (i / segs) * Math.PI * 2, ((i + 1) / segs) * Math.PI * 2);
    g.closePath();
    g.fillStyle = i % 2 ? '#ff6a2a' : '#2a1d20';
    g.fill();
  }

  const disc = (r, color) => { g.beginPath(); g.arc(m, m, m * r, 0, Math.PI * 2); g.fillStyle = color; g.fill(); };
  disc(0.925, '#3b4263');
  disc(0.9, '#434b70');

  // Узор: кольца и лучи
  g.strokeStyle = 'rgba(15, 18, 38, 0.55)';
  g.lineWidth = 5;
  for (const r of [0.72, 0.5, 0.28]) { g.beginPath(); g.arc(m, m, m * r, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * m * 0.28, m + Math.sin(a) * m * 0.28);
    g.lineTo(m + Math.cos(a) * m * 0.9, m + Math.sin(a) * m * 0.9);
    g.stroke();
  }
  disc(0.16, '#ffcf70');
  disc(0.12, '#2b2f4f');
  disc(0.06, '#ffcf70');

  // Лёгкая зернистость, чтобы поверхность не была плоской
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * S, Math.random() * S, 3, 3);
  }
  return toTexture(c);
}

// Шар: полосы и пояс — чтобы было видно, как он катится.
export function ballTexture(hex) {
  const [c, g] = makeCanvas(256, 128);
  g.fillStyle = hex;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(255,255,255,0.3)';
  for (let i = 0; i < 8; i++) g.fillRect(i * 32, 0, 12, 128);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(0, 54, 256, 20);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(i * 64 + 32, 64, 7, 0, Math.PI * 2); g.fill(); }
  return toTexture(c);
}

export function lavaTexture() {
  const S = 512;
  const [c, g] = makeCanvas(S, S);
  g.fillStyle = '#6e1200';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 150; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 20 + Math.random() * 60;
    // рисуем и со сдвигами, чтобы текстура бесшовно повторялась
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, 'rgba(255, 210, 70, 0.95)');
        grad.addColorStop(0.45, 'rgba(255, 110, 10, 0.65)');
        grad.addColorStop(1, 'rgba(255, 60, 0, 0)');
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  return toTexture(c, { repeat: true });
}

export function crateTexture() {
  const [c, g] = makeCanvas(128, 128);
  g.fillStyle = '#b07a3c';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#7a4e22';
  g.lineWidth = 3;
  for (let y = 26; y < 128; y += 26) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.lineWidth = 10;
  g.strokeStyle = '#5a3818';
  g.strokeRect(5, 5, 118, 118);
  g.lineWidth = 8;
  g.beginPath(); g.moveTo(10, 10); g.lineTo(118, 118); g.moveTo(118, 10); g.lineTo(10, 118); g.stroke();
  return toTexture(c);
}

// Небо — вертикальный градиент, который растягивается на весь экран.
export function skyTexture() {
  const [c, g] = makeCanvas(2, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#0a0620');
  grad.addColorStop(0.45, '#31175a');
  grad.addColorStop(0.78, '#b53c74');
  grad.addColorStop(1, '#ff9348');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 512);
  return toTexture(c);
}

export function sparkTexture() {
  const [c, g] = makeCanvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c, { srgb: false });
}

export function labelTexture(text) {
  const [c, g] = makeCanvas(256, 64);
  g.font = '700 34px system-ui, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(10,5,25,0.9)';
  g.strokeText(text, 128, 34, 240);
  g.fillStyle = '#ffffff';
  g.fillText(text, 128, 34, 240);
  return toTexture(c);
}
