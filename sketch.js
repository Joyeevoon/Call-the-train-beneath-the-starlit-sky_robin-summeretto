/* 星穹列车 · Honkai: Star Rail — 流星落水
 * Blender renders the train (assets/train_*.webp); p5.js runs the night:
 * meteor rain → ringed water → butterflies & stars; train entry, aurora + twin
 * galaxies, and galaxy-waterfall fireworks, all mirrored in the water. */

const SPRITE_W = 1110, SPRITE_H = 720;
const BLUE = ["#bfe3ff", "#7fb4ff", "#5b8cff", "#e8f4ff", "#9fd8ff"];
const GAL = ["#5fe3ff", "#4f8bff", "#8e6bff", "#c77bff", "#ff8fd8", "#ffd6f2", "#ffffff"];   // blue → pink → violet

let W, H, DPR, hz, VS = 1;         // viewport, horizon, visual scale
let skyG, fwG, fxG;                // static sky, firework trails, train/galaxy layer
let imgBlue, imgAurora, hitMask;
let T = 0, dt = 1;                 // seconds, frame scale (1 = 60fps)

const train = {
  state: "absent",                 // absent → entering → ready → aurora
  t: 0, x: 0, y: 0, s: 1, rot: 0,
  aur: 0, gal: 0, bursts: 0,
  tw: 0, th: 0, cx: 0, cy: 0, mirror: 0,
};
let meteors = [], ripples = [], butterflies = [], sparks = [], drops = [];
let shells = [], embers = [], cascades = [], flashes = [];
let bands = [], orbiters = [];
let nextMeteor = 0, nextAmbient = 0;
const glowCache = new Map();

// ------------------------------------------------------------ utilities
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c = 1.35; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(h, a) { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; }
function lerpHex(pal, t) {
  t = clamp(t, 0, 0.9999) * (pal.length - 1);
  const i = Math.floor(t), f = t - i;
  const a = hexRgb(pal[i]), b = hexRgb(pal[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
function glow(hex) {                       // soft radial sprite, cached per colour
  if (glowCache.has(hex)) return glowCache.get(hex);
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.18, rgba(hex, 0.9));
  gr.addColorStop(0.5, rgba(hex, 0.25));
  gr.addColorStop(1, rgba(hex, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowCache.set(hex, c);
  return c;
}
function dot(ctx, x, y, r, hex, a = 1) {
  ctx.globalAlpha = a;
  ctx.drawImage(glow(hex), x - r, y - r, r * 2, r * 2);
}
function depthAt(y) { return clamp((y - hz) / (H - hz), 0, 1); }  // 0 = horizon, 1 = shore
const palette = () => (train.aur > 0.5 ? GAL : BLUE);

// ------------------------------------------------------------ p5 lifecycle
const ASSETS = ["assets/train_blue.webp", "assets/train_aurora.webp"];

function preload() {
  let done = 0;
  const step = () => { done++; loadingProgress(0.15 + 0.8 * done / (ASSETS.length + 1)); };
  for (const src of ASSETS) loadImage(src, step, step);
  bgm.addEventListener("canplaythrough", step, { once: true });
  setTimeout(step, 4000);
  imgBlue = loadImage("assets/train_blue.webp");
  imgAurora = loadImage("assets/train_aurora.webp");
}

function setup() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  pixelDensity(DPR);
  const c = createCanvas(window.innerWidth, window.innerHeight);
  c.parent("stage");
  buildHitMask();
  layout();
  c.elt.addEventListener("pointerdown", onPointer);
  replayBtn.hidden = false;
  loadingProgress(1);
  setTimeout(() => document.getElementById("loading").classList.add("is-done"), 350);
}

function windowResized() {
  resizeCanvas(window.innerWidth, window.innerHeight);
  layout();
}

function layout() {
  W = width; H = height;
  VS = clamp(Math.min(W, H * 1.4) / 1100, 0.6, 1.2);
  hz = Math.round(H * 0.6);
  const tw = Math.min(W * 0.94, H * 0.56 * SPRITE_W / SPRITE_H);
  train.tw = tw; train.th = tw * SPRITE_H / SPRITE_W;
  train.cx = W / 2;
  train.cy = Math.max(H * 0.36, hz - train.th * 0.48);
  train.mirror = Math.max(hz + H * 0.03, train.cy + train.th * 0.5 + 4);
  if (train.state === "ready" || train.state === "aurora") { train.x = train.cx; train.y = train.cy; }
  skyG = buildSky();
  fwG = createGraphics(W, H); fwG.pixelDensity(DPR);
  fxG = createGraphics(W, H); fxG.pixelDensity(DPR);
  buildGalaxy();
}

function buildHitMask() {
  const c = document.createElement("canvas");
  c.width = 222; c.height = 144;                    // 1/5 scale alpha map is plenty for hit tests
  const g = c.getContext("2d");
  g.drawImage(imgBlue.canvas, 0, 0, 222, 144);
  hitMask = g.getImageData(0, 0, 222, 144).data;
}

// ------------------------------------------------------------ static sky
function buildSky() {
  const g = createGraphics(W, H); g.pixelDensity(DPR);
  const ctx = g.drawingContext;
  let gr = ctx.createLinearGradient(0, 0, 0, hz);
  gr.addColorStop(0, "#01020a"); gr.addColorStop(0.55, "#060c2a"); gr.addColorStop(1, "#13245e");
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, hz + 1);
  // horizon haze
  gr = ctx.createRadialGradient(W / 2, hz, 0, W / 2, hz, Math.max(W, H) * 0.7);
  gr.addColorStop(0, "rgba(90,130,255,0.35)"); gr.addColorStop(1, "rgba(90,130,255,0)");
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, hz);
  // a faint milky band across the sky
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 260; i++) {
    const u = Math.random(), x = u * W, y = hz * (0.12 + 0.55 * (1 - u)) + rand(-1, 1) * hz * 0.09;
    dot(ctx, x, y, rand(10, 46), pick(["#2a3f9a", "#3b2a8a", "#23407a"]), 0.12);
  }
  for (let i = 0; i < (W * hz) / 1400; i++) {
    const big = Math.random() < 0.06;
    dot(ctx, Math.random() * W, Math.pow(Math.random(), 1.3) * hz, big ? rand(2.5, 5) : rand(0.6, 1.8),
        pick(["#ffffff", "#bcd4ff", "#d9ccff"]), big ? 0.9 : rand(0.35, 0.9));
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  return g;
}

// ------------------------------------------------------------ galaxy rings + orbiting stars
function buildGalaxy() {
  const tw = train.tw;
  bands = [
    { R: tw * 0.6, squash: 0.26, tilt: -0.40, speed: 0.22, width: tw * 0.05, parts: [] },
    { R: tw * 0.5, squash: 0.36, tilt: 0.30, speed: -0.17, width: tw * 0.04, parts: [] },
  ];
  for (const b of bands) {
    for (let i = 0; i < 620; i++) {
      const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // ~gaussian
      b.parts.push({
        th: Math.random() * Math.PI * 2, off: g * b.width, lift: rand(-1, 1) * b.width * 0.35,
        r: Math.random() < 0.08 ? rand(2.5, 4.5) : rand(0.8, 2), col: pick(GAL), tw: Math.random() * 6,
      });
    }
    for (let i = 0; i < 46; i++) {
      b.parts.push({ th: Math.random() * Math.PI * 2, off: rand(-0.5, 0.5) * b.width, lift: 0,
        r: rand(tw * 0.03, tw * 0.07), col: pick(["#4f6bff", "#8e6bff", "#ff8fd8", "#5fe3ff"]), neb: true, tw: 0 });
    }
  }
  orbiters = [];
  for (let i = 0; i < 90; i++) {
    orbiters.push({
      R: rand(0.32, 0.78) * tw, squash: rand(0.2, 0.6), tilt: rand(-0.7, 0.5),
      th: Math.random() * Math.PI * 2, speed: rand(0.25, 0.7) * (Math.random() < 0.5 ? -1 : 1),
      size: rand(3, 9) * (tw / 900), col: pick(GAL), tw: Math.random() * 6,
    });
  }
}

function ringPoint(R, squash, tilt, a, lift) {
  const ex = Math.cos(a) * R, ey = Math.sin(a) * R * squash + lift;
  return [ex * Math.cos(tilt) - ey * Math.sin(tilt), ex * Math.sin(tilt) + ey * Math.cos(tilt), Math.sin(a)];
}

function drawGalaxy(ctx, front) {
  if (train.gal <= 0) return;
  const k = easeOutCubic(train.gal);
  ctx.globalCompositeOperation = "lighter";
  for (const b of bands) {
    for (const p of b.parts) {
      const a = p.th + T * b.speed;
      const [x, y, d] = ringPoint((b.R + p.off) * k, b.squash, b.tilt, a, p.lift);
      if ((d >= 0) !== front) continue;
      const shade = 0.55 + 0.45 * (d * 0.5 + 0.5);
      if (p.neb) dot(ctx, train.x + x, train.y + y, p.r, p.col, 0.12 * k * shade);
      else dot(ctx, train.x + x, train.y + y, p.r * 2.6, p.col, k * shade * (0.65 + 0.35 * Math.sin(T * 3 + p.tw)));
    }
  }
  for (const o of orbiters) {
    const [x, y, d] = ringPoint(o.R * k, o.squash, o.tilt, o.th + T * o.speed, 0);
    if ((d >= 0) !== front) continue;
    const tw = 0.6 + 0.4 * Math.sin(T * 4 + o.tw);
    sparkle(ctx, train.x + x, train.y + y, o.size * (0.8 + 0.4 * d) * tw, o.col, k * (0.6 + 0.4 * d));
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}

function sparkle(ctx, x, y, s, hex, a) {           // four-point twinkle star
  dot(ctx, x, y, s * 2.4, hex, a * 0.6);
  ctx.globalAlpha = a; ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(x, y - s * 1.8); ctx.quadraticCurveTo(x, y, x + s * 1.8, y);
  ctx.quadraticCurveTo(x, y, x, y + s * 1.8); ctx.quadraticCurveTo(x, y, x - s * 1.8, y);
  ctx.quadraticCurveTo(x, y, x, y - s * 1.8); ctx.fill();
}

function star5(ctx, x, y, r, rot, hex, a) {
  ctx.globalAlpha = a; ctx.fillStyle = hex;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r, an = rot + (i * Math.PI) / 5 - Math.PI / 2;
    i ? ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr) : ctx.moveTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr);
  }
  ctx.closePath(); ctx.fill();
}

// ------------------------------------------------------------ meteors → water
function spawnMeteor(landX, landY) {
  const p = depthAt(landY);
  const ang = rand(1.95, 2.2);                 // heading down-left
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const dist = (landY + 80) / dy;
  const sp = rand(11, 17) * (H / 900) * (0.75 + p * 0.5);
  const pal = palette();
  meteors.push({
    x: landX - dx * dist, y: landY - dy * dist, dx, dy, sp, landX, landY, p,
    len: rand(90, 190) * (H / 900) * (0.6 + p * 0.6), w: 1 + p * 2.2,
    col: pick(pal), head: "#ffffff",
  });
}

function updateMeteors() {
  if (T > nextMeteor) {
    const rate = train.aur > 0.5 ? 0.12 : 0.2;
    nextMeteor = T + rand(rate * 0.5, rate * 1.6);
    const p = Math.pow(Math.random(), 1.6);    // more impacts far away, a few close
    spawnMeteor(rand(-0.05, 1.05) * W, hz + 6 + p * (H - hz - 14));
  }
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    m.x += m.dx * m.sp * dt; m.y += m.dy * m.sp * dt;
    if (m.y >= m.landY) { splash(m.landX, m.landY, m.p, m.col); meteors.splice(i, 1); }
  }
}

function drawMeteors(ctx) {
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (const m of meteors) {
    const tx = m.x - m.dx * m.len, ty = m.y - m.dy * m.len;
    const gr = ctx.createLinearGradient(m.x, m.y, tx, ty);
    gr.addColorStop(0, rgba("#ffffff", 0.95)); gr.addColorStop(0.15, rgba(m.col, 0.7)); gr.addColorStop(1, rgba(m.col, 0));
    ctx.strokeStyle = gr; ctx.lineWidth = m.w; ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
    dot(ctx, m.x, m.y, 6 + m.w * 3, m.col, 0.9);
    // reflection: mirrored about the impact point, only while above the water there
    if (m.y > hz - 2) {
      const ry = 2 * m.landY - m.y, rty = 2 * m.landY - ty;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = m.w * 0.8;
      ctx.beginPath(); ctx.moveTo(m.x, ry); ctx.lineTo(tx, Math.max(rty, m.landY)); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}

function splash(x, y, p, col) {
  const sc = (0.45 + p * 1.1) * VS;
  const pal = palette();
  for (let k = 0; k < 3; k++) ripples.push({ x, y, r: 0, max: (40 + k * 26) * sc * (W / 1200 + 0.4), delay: k * 0.14, life: 0, dur: 1.6 + k * 0.3, col });
  flashes.push({ x, y, r: 26 * sc, life: 0, col });
  const nb = Math.random() < 0.85 ? (1 + (Math.random() * (2 + p * 3)) | 0) : 0;
  for (let i = 0; i < nb; i++) {
    butterflies.push({
      x: x + rand(-8, 8), y: y - 4, vx: rand(-0.9, 0.9), vy: rand(-1.6, -0.8) * (0.7 + p * 0.5),
      ph: Math.random() * 6, fs: rand(0.32, 0.45), size: rand(7, 12) * sc, col: pick(pal), col2: pick(pal),
      life: 0, dur: rand(3.5, 6), wander: Math.random() * 6,
    });
  }
  const ns = (5 + Math.random() * (5 + p * 8)) | 0;
  for (let i = 0; i < ns; i++) {
    const a = rand(-Math.PI * 0.92, -Math.PI * 0.08), v = rand(2, 5.2) * sc;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, base: y, rot: Math.random() * 6, vr: rand(-0.2, 0.2),
      size: rand(2.5, 5.5) * sc, col: pick(pal), five: Math.random() < 0.55, life: 0, dur: rand(1.2, 2) });
  }
  for (let i = 0; i < 8 * sc; i++) {
    const a = rand(-Math.PI * 0.85, -Math.PI * 0.15), v = rand(1, 3.4) * sc;
    drops.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, base: y, life: 0 });
  }
}

function ambientRipples() {
  if (T > nextAmbient) {
    nextAmbient = T + rand(0.18, 0.45);
    const y = hz + 4 + Math.pow(Math.random(), 1.4) * (H - hz - 8), p = depthAt(y);
    ripples.push({ x: Math.random() * W, y, r: 0, max: (30 + Math.random() * 50) * (0.4 + p) * (W / 1200 + 0.4), delay: 0, life: 0, dur: 2.6, col: "#6f8fff", faint: true });
  }
  // the hovering train keeps a set of rings breathing on the water beneath it
  if (train.state === "ready" || train.state === "aurora") {
    if (!train._ringT || T > train._ringT) {
      train._ringT = T + 0.9;
      ripples.push({ x: train.x + train.tw * 0.04, y: train.mirror + 6, r: 0, max: train.tw * 0.6, delay: 0, life: 0, dur: 4.2,
        col: train.aur > 0.5 ? pick(GAL) : "#9fc4ff", under: true });
    }
  }
}

function updateWaterLife() {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.life += dt / 60;
    if (r.life > r.delay + r.dur) ripples.splice(i, 1);
  }
  for (let i = flashes.length - 1; i >= 0; i--) if ((flashes[i].life += dt / 60) > 0.5) flashes.splice(i, 1);
  for (let i = butterflies.length - 1; i >= 0; i--) {
    const b = butterflies[i];
    b.life += dt / 60;
    b.vx += Math.sin(T * 1.7 + b.wander) * 0.03 * dt;
    b.vy += (-0.012 + Math.sin(T * 2.3 + b.wander) * 0.02) * dt;
    b.vx *= 0.99; b.vy = Math.max(b.vy * 0.995, -2.2);
    b.x += b.vx * dt; b.y += b.vy * dt; b.ph += b.fs * dt;
    if (b.life > b.dur || b.y < -30) butterflies.splice(i, 1);
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life += dt / 60; s.vy += 0.11 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.rot += s.vr * dt;
    if ((s.vy > 0 && s.y > s.base) || s.life > s.dur) {
      if (s.y > s.base && Math.random() < 0.35) ripples.push({ x: s.x, y: s.base, r: 0, max: 14 * (0.5 + depthAt(s.base)), delay: 0, life: 0, dur: 0.9, col: s.col });
      sparks.splice(i, 1);
    }
  }
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.life += dt / 60; d.vy += 0.16 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
    if (d.y > d.base + 2 || d.life > 1.4) drops.splice(i, 1);
  }
}

function drawRipples(ctx) {
  ctx.globalCompositeOperation = "lighter";
  for (const r of ripples) {
    const t = (r.life - r.delay) / r.dur;
    if (t < 0) continue;
    const p = depthAt(r.y), squash = 0.14 + p * 0.26;
    const rad = r.max * easeOutCubic(t);
    const a = (1 - t) * (r.faint ? 0.22 : r.under ? 0.5 : 0.75);
    ctx.globalAlpha = a; ctx.strokeStyle = r.col; ctx.lineWidth = (r.faint ? 0.8 : 1.4) * (0.6 + p);
    ctx.beginPath(); ctx.ellipse(r.x, r.y, rad, rad * squash, 0, 0, Math.PI * 2); ctx.stroke();
    if (!r.faint) {
      ctx.globalAlpha = a * 0.35; ctx.lineWidth *= 3;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, rad * 0.92, rad * squash * 0.92, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  for (const f of flashes) {
    const t = f.life / 0.5;
    ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1, 0.35);
    dot(ctx, 0, 0, f.r * (1 + t * 1.5), f.col, (1 - t) * 0.9);
    ctx.restore();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}

function drawSplashLife(ctx) {
  ctx.globalCompositeOperation = "lighter";
  for (const d of drops) dot(ctx, d.x, d.y, 3, "#cfe4ff", 0.8 * (1 - d.life / 1.4));
  for (const s of sparks) {
    const a = 1 - s.life / s.dur;
    if (s.five) { dot(ctx, s.x, s.y, s.size * 2.6, s.col, a * 0.6); star5(ctx, s.x, s.y, s.size, s.rot, "#ffffff", a); }
    else sparkle(ctx, s.x, s.y, s.size, s.col, a);
  }
  for (const b of butterflies) drawButterfly(ctx, b);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}

function drawButterfly(ctx, b) {
  const t = b.life / b.dur;
  const a = Math.min(1, b.life * 3) * (1 - Math.pow(t, 3));
  const flap = 0.2 + 0.8 * Math.abs(Math.sin(b.ph));
  const s = b.size;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(clamp(b.vx * 0.35, -0.5, 0.5));
  dot(ctx, 0, 0, s * 2.6, b.col, a * 0.45);
  ctx.globalAlpha = a;
  for (const side of [-1, 1]) {
    ctx.save(); ctx.scale(side * flap, 1);
    let gr = ctx.createLinearGradient(0, 0, s * 1.4, -s);
    gr.addColorStop(0, rgba("#ffffff", 0.95)); gr.addColorStop(1, rgba(b.col, 0.85));
    ctx.fillStyle = gr;
    ctx.beginPath();                                  // forewing
    ctx.moveTo(0, -1);
    ctx.bezierCurveTo(s * 0.4, -s * 1.5, s * 1.6, -s * 1.4, s * 1.25, -s * 0.2);
    ctx.quadraticCurveTo(s * 0.7, 0, 0, 0);
    ctx.fill();
    gr = ctx.createLinearGradient(0, 0, s, s);
    gr.addColorStop(0, rgba("#ffffff", 0.85)); gr.addColorStop(1, rgba(b.col2, 0.8));
    ctx.fillStyle = gr;
    ctx.beginPath();                                  // hindwing
    ctx.moveTo(0, 1);
    ctx.bezierCurveTo(s * 0.9, s * 0.1, s * 1.05, s * 0.95, s * 0.45, s * 1.0);
    ctx.quadraticCurveTo(s * 0.1, s * 0.8, 0, 1);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = "#ffffff"; ctx.fillRect(-0.6, -s * 0.5, 1.2, s * 1.1);
  ctx.restore();
}

// ------------------------------------------------------------ train
function onPointer(e) {
  const x = e.clientX, y = e.clientY;
  if (train.state === "absent") {
    train.state = "entering"; train.t = 0;
    setHint("");
    return;
  }
  if (train.state === "entering") return;
  if (hitTrain(x, y)) {
    if (train.state === "ready") {
      train.state = "aurora";
      burstAround(30);
      setHint("再点一次列车 · 银河烟花");
    } else {
      launchFireworks();
      setHint("继续点击列车 · 再放一轮");
    }
  } else {
    // tapping open sky / water calls a meteor down right there
    const ly = y > hz ? y : hz + 6 + Math.random() * (H - hz) * 0.25;
    spawnMeteor(x, ly);
  }
}

function hitTrain(px, py) {
  const s = train.s, c = Math.cos(-train.rot), sn = Math.sin(-train.rot);
  for (const [ox, oy] of [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, -10], [10, -10], [-10, 10]]) {
    const dx = px + ox - train.x, dy = py + oy - train.y;
    const lx = (dx * c - dy * sn) / s, ly = (dx * sn + dy * c) / s;
    const u = lx / train.tw + 0.5, v = ly / train.th + 0.5;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
    if (hitMask[(((v * 144) | 0) * 222 + ((u * 222) | 0)) * 4 + 3] > 40) return true;
  }
  return false;
}

function updateTrain() {
  const tr = train;
  if (tr.state === "absent") return;
  if (tr.state === "entering") {
    tr.t += dt / 60 / 1.9;
    const k = Math.min(1, tr.t), e = easeOutBack(k);
    const sx = -tr.tw * 0.75, sy = tr.cy + H * 0.34;
    tr.x = sx + (tr.cx - sx) * e;
    tr.y = sy + (tr.cy - sy) * easeOutCubic(k);
    tr.s = 0.62 + 0.38 * easeOutCubic(k);
    tr.rot = -0.14 * (1 - easeOutCubic(k));
    // wake: the train skims in, kicking up spray along the water
    if (Math.random() < 0.6 * dt && k < 0.85) {
      const wx = tr.x + rand(-0.4, 0.2) * tr.tw * tr.s, wy = clamp(tr.y + tr.th * tr.s * 0.4, hz + 6, H - 6);
      splash(wx, wy, depthAt(wy), pick(BLUE));
    }
    if (k >= 1) {
      tr.state = "ready";
      burstAround(18);
      setHint("点击列车 · 极光苏醒");
    }
    return;
  }
  tr.x = tr.cx + Math.sin(T * 0.6) * 4;
  tr.y = tr.cy + Math.sin(T * 1.2) * 6;
  tr.rot = Math.sin(T * 0.8) * 0.012;
  tr.s = 1;
  if (tr.state === "aurora") {
    tr.aur = Math.min(1, tr.aur + dt / 60 / 1.3);
    tr.gal = Math.min(1, tr.gal + dt / 60 / 1.8);
  }
}

function burstAround(n) {                        // ring of stars thrown off the carriage
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), v = rand(2, 6);
    sparks.push({ x: train.x + rand(-0.25, 0.25) * train.tw, y: train.y + rand(-0.1, 0.1) * train.th, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2,
      base: train.mirror + rand(0, H - train.mirror), rot: 0, vr: rand(-0.2, 0.2), size: rand(3, 6), col: pick(train.aur > 0 || train.state === "aurora" ? GAL : BLUE),
      five: Math.random() < 0.5, life: 0, dur: rand(1.2, 2.2) });
  }
}

function drawTrain(ctx) {
  const tr = train;
  if (tr.state === "absent") return;
  drawGalaxy(ctx, false);
  ctx.save();
  ctx.translate(tr.x, tr.y); ctx.rotate(tr.rot); ctx.scale(tr.s, tr.s);
  const w = tr.tw, h = tr.th;
  if (tr.state === "entering") {                 // speed ghosts trailing back along the track
    ctx.globalCompositeOperation = "lighter";
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha = 0.12 * (1 - tr.t) * (4 - i) / 3;
      ctx.drawImage(imgBlue.canvas, -w / 2 - i * w * 0.07, -h / 2 + i * h * 0.05, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
  }
  if (tr.aur < 1) { ctx.globalAlpha = 1; ctx.drawImage(imgBlue.canvas, -w / 2, -h / 2, w, h); }
  if (tr.aur > 0) {
    ctx.globalAlpha = easeOutCubic(tr.aur);
    ctx.drawImage(imgAurora.canvas, -w / 2, -h / 2, w, h);
    // aurora shimmer sweeping along the carriage
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.18 * tr.aur * (0.6 + 0.4 * Math.sin(T * 2));
    ctx.drawImage(imgAurora.canvas, -w / 2, -h / 2, w, h);
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  drawGalaxy(ctx, true);
}

// ------------------------------------------------------------ galaxy-waterfall fireworks
// order of a show: shells climb → each bursts into a crisp sphere → the sphere hangs a beat →
// only then does it droop and pour down as a galaxy-coloured waterfall from its rim.
function launchFireworks() {
  train.bursts++;
  const n = (W < 600 ? 3 : 5) + Math.min(train.bursts, W < 600 ? 1 : 3);
  for (let i = 0; i < n; i++) {
    const tx = train.cx + (i / (n - 1) - 0.5) * Math.min(W * 0.86, train.tw * 1.5) + rand(-20, 20);
    shells.push({
      x: train.x + rand(-0.2, 0.25) * train.tw, y: train.y - train.th * 0.1,
      tx, ty: rand(0.11, 0.26) * H, t: 0, dur: rand(0.75, 1.05), delay: i * 0.18 + rand(0, 0.12),
      hue0: Math.random(), lx: 0, ly: 0,
    });
  }
  burstAround(20);
}

function updateFireworks() {
  const ctx = fwG.drawingContext;
  // fade the trail layer so falling sparks leave long waterfall streaks
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(0,0,0,${0.06 * dt})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  // 1 — shells climbing, each with a short sparkling tail
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    if (s.delay > 0) { s.delay -= dt / 60; continue; }
    s.t += dt / 60 / s.dur;
    const e = easeOutCubic(Math.min(1, s.t));
    const x = s.x + (s.tx - s.x) * e, y = s.y + (s.ty - s.y) * e;
    if (s.lx) {
      ctx.globalAlpha = 0.8; ctx.strokeStyle = "#dfe8ff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.lx, s.ly); ctx.lineTo(x, y); ctx.stroke();
    }
    s.lx = x; s.ly = y;
    dot(ctx, x, y, 6, "#ffffff", 0.95);
    if (Math.random() < 0.5) dot(ctx, x + rand(-3, 3), y + rand(4, 12), 2.5, lerpHex(GAL, s.hue0), 0.8);
    if (s.t >= 1) { explode(x, y, s.hue0); shells.splice(i, 1); }
  }

  // 3 — waterfalls: after its burst has bloomed, each rim pours sparks straight down
  for (let i = cascades.length - 1; i >= 0; i--) {
    const c = cascades[i];
    c.life += dt / 60;
    if (c.life < c.delay) continue;
    const k = (c.life - c.delay) / c.dur;
    if (k >= 1) { cascades.splice(i, 1); continue; }
    const rate = 11 * (1 - k * 0.7) * dt;
    for (let j = 0; j < rate; j++) {
      const a = rand(-0.15, Math.PI + 0.15), rr = c.R * rand(0.75, 1.05);
      const u = a / Math.PI;
      embers.push({ x: c.x + Math.cos(a) * rr, y: c.y + Math.sin(a) * rr * 0.85, px: 0, py: 0,
        vx: Math.cos(a) * 0.15, vy: rand(0.2, 0.9), g: 0.04 * c.sc, drag: 0.993, drag0: 0.993, hold: 0,
        col: lerpHex(GAL, (c.h0 + u * 0.5) % 1 * 0.95), life: 0, dur: rand(2.4, 3.4), w: rand(0.9, 1.9), fall: true });
    }
  }

  // 2 + 3 — burst sparks and waterfall sparks
  for (let i = embers.length - 1; i >= 0; i--) {
    const p = embers[i];
    p.px = p.x; p.py = p.y;
    const holding = p.life < p.hold;
    const drag = Math.pow(holding ? p.drag0 : p.drag, dt);
    p.vx *= drag;
    p.vy = p.vy * drag + (holding ? 0 : p.g * dt);
    p.x += p.vx * dt; p.y += p.vy * dt; p.life += dt / 60;
    const a = Math.max(0, 1 - p.life / p.dur);
    ctx.globalAlpha = holding ? 1 : a;
    ctx.strokeStyle = p.col; ctx.lineWidth = p.w;
    ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
    if (holding) dot(ctx, p.x, p.y, 3.5, p.col, 0.9);
    else if (Math.random() < 0.06) dot(ctx, p.x, p.y, 4, "#ffffff", a);
    if (p.y > hz) {
      if (Math.random() < 0.05) ripples.push({ x: p.x, y: hz + 3 + Math.random() * 40, r: 0, max: 18, delay: 0, life: 0, dur: 1.1, col: p.col });
      embers.splice(i, 1);
    } else if (p.life > p.dur) embers.splice(i, 1);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}

function explode(x, y, h0) {
  const sc = Math.min(H / 900, W / 720), n = Math.round(170 * clamp(sc, 0.5, 1));
  // 2 — a crisp sphere: fast, strongly damped, no gravity while it blooms
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.02, 0.02), v = rand(6.5, 9) * sc;
    embers.push({ x, y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      g: 0.035 * sc, drag0: 0.925, drag: 0.985, hold: rand(0.5, 0.65),
      col: lerpHex(GAL, (h0 + i / n) % 1 * 0.95), life: 0, dur: rand(2.6, 3.4), w: rand(1.2, 2.4) });
  }
  // inner ring of white-gold glitter
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, v = rand(2, 4) * sc;
    embers.push({ x, y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      g: 0.03 * sc, drag0: 0.92, drag: 0.985, hold: 0.55, col: "#ffffff", life: 0, dur: rand(1.4, 2), w: 1 });
  }
  flashes.push({ x, y, r: 60 * sc, life: 0, col: "#ffffff" });
  cascades.push({ x, y, R: 105 * sc, sc, h0, life: 0, delay: 0.55, dur: 2.2 });
  const ctx = fwG.drawingContext;
  ctx.globalCompositeOperation = "lighter";
  dot(ctx, x, y, 120 * sc, lerpHex(GAL, h0), 0.6);
}

// ------------------------------------------------------------ water + reflections
function drawWater(ctx) {
  const gr = ctx.createLinearGradient(0, hz, 0, H);
  gr.addColorStop(0, "#0d1b52"); gr.addColorStop(0.25, "#060d2c"); gr.addColorStop(1, "#01030c");
  ctx.fillStyle = gr; ctx.fillRect(0, hz, W, H - hz);

  // mirrored, wave-shifted slices of sky, fireworks and the train
  const step = 2;
  for (let y = hz; y < H; y += step) {
    const p = depthAt(y);
    const wob = Math.sin(y * 0.09 + T * 2.2) * (0.6 + p * 4) + Math.sin(y * 0.031 - T * 1.3) * p * 3;
    const fade = 1 - p * 0.55;
    // sky (mirror at horizon)
    let sy = 2 * hz - y;
    if (sy > 0) blit(ctx, skyG, sy, y, step, wob * 0.5, 0.38 * fade);
    if (sy > 0) blit(ctx, fwG, sy, y, step, wob, 0.55 * fade);
    // train layer (mirror at the water point beneath it)
    if (y >= train.mirror) {
      sy = 2 * train.mirror - y;
      if (sy > 0) blit(ctx, fxG, sy, y, step, wob * 0.7, 0.5 * (1 - (y - train.mirror) / (H - train.mirror + 1) * 0.6));
    }
  }
  ctx.globalAlpha = 1;
  // horizon glint line
  const hg = ctx.createLinearGradient(0, 0, W, 0);
  const tint = train.aur > 0.5 ? ["#5fe3ff", "#c77bff", "#ff8fd8"] : ["#4f8bff", "#bfe3ff", "#4f8bff"];
  hg.addColorStop(0, rgba(tint[0], 0)); hg.addColorStop(0.5, rgba(tint[1], 0.5)); hg.addColorStop(1, rgba(tint[2], 0));
  ctx.fillStyle = hg; ctx.fillRect(0, hz - 1, W, 2);
}

function blit(ctx, g, sy, dy, h, dx, a) {
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  ctx.drawImage(g.elt, 0, sy * DPR, W * DPR, h * DPR, dx, dy, W, h);
}

function drawAuroraSky(ctx) {
  if (train.aur <= 0) return;
  const a = easeOutCubic(train.aur);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 3; i++) {
    const x = W * (0.2 + i * 0.3) + Math.sin(T * 0.3 + i * 2) * W * 0.06;
    const gr = ctx.createRadialGradient(x, hz * 0.55, 0, x, hz * 0.55, W * 0.4);
    const c = ["#2fd0ff", "#a06bff", "#ff6fc8"][i];
    gr.addColorStop(0, rgba(c, 0.13 * a)); gr.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, hz);
  }
  ctx.globalCompositeOperation = "source-over";
}

// ------------------------------------------------------------ main loop
function draw() {
  dt = clamp(deltaTime / (1000 / 60), 0.25, 3);
  T += dt / 60;
  const ctx = drawingContext;

  updateTrain();
  updateMeteors();
  ambientRipples();
  updateWaterLife();
  updateFireworks();

  // train layer first (it is reflected too)
  fxG.clear();
  drawTrain(fxG.drawingContext);

  ctx.globalAlpha = 1;
  ctx.drawImage(skyG.elt, 0, 0, W * DPR, H * DPR, 0, 0, W, H);
  drawAuroraSky(ctx);
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(fwG.elt, 0, 0, W * DPR, hz * DPR, 0, 0, W, hz);
  ctx.globalCompositeOperation = "source-over";
  drawWater(ctx);
  drawRipples(ctx);
  drawMeteors(ctx);
  ctx.globalAlpha = 1;
  ctx.drawImage(fxG.elt, 0, 0, W * DPR, H * DPR, 0, 0, W, H);
  drawSplashLife(ctx);
}

// ------------------------------------------------------------ audio + loading + replay
const bgm = document.getElementById("bgm");
const musicBtn = document.getElementById("musicBtn");
bgm.volume = 0.55;
let musicOn = true;

function setMusic(on) {
  musicOn = on;
  musicBtn.classList.toggle("is-off", !on);
  document.getElementById("musicLabel").textContent = on ? "音乐：开" : "音乐：关";
  if (on) bgm.play().catch(() => {});
  else bgm.pause();
}
musicBtn.addEventListener("click", (e) => { e.stopPropagation(); setMusic(!musicOn); });

function bindAudioUnlock() {
  const unlock = () => {
    musicBtn.hidden = false;
    if (musicOn) bgm.play().catch(() => setMusic(false));
    window.removeEventListener("pointerdown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
}
bindAudioUnlock();

const replayBtn = document.getElementById("replayBtn");
function resetScene() {
  train.state = "absent";
  train.t = 0; train.aur = 0; train.gal = 0; train.bursts = 0;
  train._ringT = 0;
  meteors.length = 0; ripples.length = 0; flashes.length = 0;
  butterflies.length = 0; sparks.length = 0; drops.length = 0;
  shells.length = 0; embers.length = 0; cascades.length = 0;
  fwG.clear();
  setHint("");
  setTimeout(() => setHint("点击夜空 · 召唤列车"), 600);
}
replayBtn.addEventListener("click", (e) => { e.stopPropagation(); resetScene(); });

function loadingProgress(p) {
  const el = document.getElementById("loadingFill");
  if (el) el.style.width = Math.round(p * 100) + "%";
}

// ------------------------------------------------------------ hint
let hintTimer;
function setHint(text) {
  const el = document.getElementById("hint");
  clearTimeout(hintTimer);
  el.classList.add("is-hidden");
  if (!text) return;
  hintTimer = setTimeout(() => { el.textContent = text; el.classList.remove("is-hidden"); }, 500);
}
