// OnePager home page: a crumpled ball of paper that unfolds into a finished one-pager as you scroll.
// mountPaper({ canvas, stage, pins }) returns { setProgress(p) } or throws if WebGL is unavailable.
import * as THREE from "../vendor/three.module.min.js";

const W = 2.1, H = 2.97;            // A4 in scene units
const SX = 84, SY = 120;            // mesh resolution
const CAM_Z = 6.2, FOV = 32;

// ---- tiny seeded Perlin noise -------------------------------------------------------------
function rng(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function perlin(seed) {
  const r = rng(seed), perm = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256), p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const g = (h, dx, dy) => gx[h] * dx + gy[h] * dy;
    const aa = perm[X + perm[Y]], ab = perm[X + perm[Y + 1]], ba = perm[X + 1 + perm[Y]], bb = perm[X + 1 + perm[Y + 1]];
    const u = fade(xf), v = fade(yf);
    const x1 = g(aa, xf, yf) + (g(ba, xf - 1, yf) - g(aa, xf, yf)) * u;
    const x2 = g(ab, xf, yf - 1) + (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1)) * u;
    return (x1 + (x2 - x1) * v) * 1.41;
  };
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const span = (p, a, b) => ease(clamp((p - a) / (b - a)));

export function mountPaper({ canvas, stage, pins = [], topInset = 64, onReady }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  const small = Math.min(innerWidth, innerHeight) < 600;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0, 0, CAM_Z);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3ec, 1.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.25);
  key.position.set(-1.6, 2.4, 6.5);
  key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  key.shadow.radius = 6;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xdfe7ff, 0.6);
  rim.position.set(3, -1, 2);
  scene.add(rim);

  // Shadow catcher behind the paper (the canvas is transparent; only the shadow draws).
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.13 }));
  catcher.position.z = -0.7;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // ---- the sheet ----
  const geo = new THREE.PlaneGeometry(W, H, SX, SY);
  const pos = geo.attributes.position;
  const n = pos.count;
  const flat = new Float32Array(n * 2), wr = new Float32Array(n), ball = new Float32Array(n * 3), bul = new Float32Array(n * 3);
  const nA = perlin(7), nB = perlin(19), nC = perlin(43), nD = perlin(71), nE = perlin(97);
  const R = 0.64;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), u = x / W + 0.5, v = y / H + 0.5;
    flat[i * 2] = x; flat[i * 2 + 1] = y;
    // creases left behind on an unfolded sheet: ridges and valleys at three scales
    const cx = x * 1.6, cy = y * 1.6;
    wr[i] = 0.075 * Math.abs(nA(cx, cy)) - 0.045 * Math.abs(nB(cx * 2.1 + 5, cy * 2.1)) + 0.018 * nC(cx * 4.3, cy * 4.3 + 9);
    // crumpled ball: wrap onto a sphere, then crush it with ridged noise
    const lon = (u - 0.5) * Math.PI * 2 * 0.92, lat = (v - 0.5) * Math.PI * 0.94;
    const ridge = 1 - Math.abs(nD(u * 7, v * 9)), ridge2 = 1 - Math.abs(nE(u * 15 + 3, v * 19));
    const r = R * (0.7 + 0.32 * ridge * ridge + 0.12 * ridge2);
    const jx = 0.09 * nB(u * 6, v * 6 + 2), jy = 0.09 * nC(u * 6 + 4, v * 6);
    ball[i * 3] = r * Math.cos(lat) * Math.sin(lon) + jx;
    ball[i * 3 + 1] = r * Math.sin(lat) * 0.92 + jy;
    ball[i * 3 + 2] = r * Math.cos(lat) * Math.cos(lon);
    // extra chaos while it is half open
    bul[i * 3] = nE(u * 3, v * 3);
    bul[i * 3 + 1] = nA(u * 3 + 8, v * 3);
    bul[i * 3 + 2] = nD(u * 2.4 + 1, v * 2.4 + 6);
  }

  const tex = new THREE.TextureLoader().load("assets/paper-resume.jpg", () => { dirty = true; onReady?.(); });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0, side: THREE.FrontSide }));
  const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.95, side: THREE.BackSide }));
  front.castShadow = true;
  front.receiveShadow = true;
  back.receiveShadow = true;
  const paper = new THREE.Group();
  paper.add(front, back);
  scene.add(paper);

  // ---- layout ----
  let vw = 1, vh = 1, base = { x: 0, y: 0, s: 1 }, mobile = false;
  function layout() {
    const r = stage.getBoundingClientRect();
    vw = Math.max(1, r.width); vh = Math.max(1, r.height);
    renderer.setSize(vw, vh, false);
    camera.aspect = vw / vh; camera.updateProjectionMatrix();
    const visH = 2 * CAM_Z * Math.tan((FOV / 2) * Math.PI / 180), visW = visH * camera.aspect;
    mobile = camera.aspect < 0.95;
    const inset = (topInset / vh) * visH;            // the nav sits over the top of the stage
    if (!mobile) {
      let s = (0.76 * (visH - inset)) / H;
      if (W * s > 0.4 * visW) s = (0.4 * visW) / W;
      const frac = (W * s) / visW;
      base = { s, x: (clamp(1 - frac / 2 - 0.11, 0.6, 0.68) - 0.5) * visW, y: -inset / 2 - 0.02 * visH };
    } else {
      const s = Math.min((0.84 * visW) / W, (0.47 * visH) / H);
      base = { s, x: 0, y: visH / 2 - inset - 0.03 * visH - (H * s) / 2 };
    }
    dirty = true;
  }

  // ---- interaction ----
  let target = 0, prog = 0, shown = -1, dirty = true;
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener("pointermove", (e) => { ptr.tx = (e.clientX / innerWidth) * 2 - 1; ptr.ty = (e.clientY / innerHeight) * 2 - 1; }, { passive: true });
  stage.addEventListener("pointerleave", () => { ptr.tx = 0; ptr.ty = 0; });
  let poke = 0; // a click on the ball makes it hop
  canvas.addEventListener("pointerdown", () => { if (prog < 0.1) poke = 1; });

  function deform(a, b) {
    const s1 = Math.sin(Math.PI * a), arr = pos.array;
    for (let i = 0; i < n; i++) {
      const fx = flat[i * 2], fy = flat[i * 2 + 1], fz = wr[i] * (1 - b);
      const bx = ball[i * 3], by = ball[i * 3 + 1], bz = ball[i * 3 + 2];
      arr[i * 3] = bx + (fx - bx) * a + bul[i * 3] * s1 * 0.22;
      arr[i * 3 + 1] = by + (fy - by) * a + bul[i * 3 + 1] * s1 * 0.18;
      arr[i * 3 + 2] = bz + (fz - bz) * a + bul[i * 3 + 2] * s1 * 0.5;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  const v3 = new THREE.Vector3();
  function placePins(alpha) {
    for (const pin of pins) {
      v3.set((pin.u - 0.5) * W, (0.5 - pin.v) * H, 0.02).applyMatrix4(paper.matrixWorld).project(camera);
      const x = (v3.x * 0.5 + 0.5) * vw, y = (-v3.y * 0.5 + 0.5) * vh;
      const o = clamp(alpha * 1.4 - pin.delay);
      pin.el.style.opacity = o.toFixed(3);
      // desktop: the label straddles the paper's edge; phone: it tucks inside the edge so it stays on screen
      const dx = mobile ? (pin.u < 0.5 ? "-6%" : "-94%") : (pin.u < 0.5 ? "-78%" : "-22%");
      pin.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${dx}, -50%) scale(${(0.92 + 0.08 * o).toFixed(3)})`;
    }
  }

  let spin = 0.6, last = performance.now(), running = true, raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    prog += (target - prog) * Math.min(1, dt * 7);
    if (Math.abs(target - prog) < 0.0004) prog = target;
    ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 4);
    ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 4);
    poke = Math.max(0, poke - dt * 1.6);

    const a = span(prog, 0.07, 0.56), b = span(prog, 0.4, 0.8), settle = span(prog, 0.74, 0.96);
    const key3 = Math.round(a * 400) * 1000 + Math.round(b * 400);
    if (key3 !== shown || dirty) { deform(a, b); shown = key3; dirty = false; }

    spin += dt * 0.55 * (1 - a);
    const wrapped = Math.atan2(Math.sin(spin), Math.cos(spin));
    const t = now / 1000, idle = 1 - settle;
    const hop = Math.sin(poke * Math.PI) * 0.35;
    paper.scale.setScalar(base.s * (1 + 0.05 * (1 - a)));
    paper.position.set(
      base.x,
      base.y + Math.sin(t * 1.3) * 0.04 * idle + hop + (1 - a) * 0.05,
      (1 - a) * 0.5 + settle * 0.05
    );
    const tilt = mobile ? 0.3 : 1;
    paper.rotation.set(
      wrapped * 0.35 * (1 - a) + (1 - a) * 0.3 - 0.12 * (1 - settle) * a + ptr.y * 0.16 * tilt * (1 - 0.6 * settle) + poke * 0.6,
      wrapped * (1 - a) + 0.22 * (1 - settle) * a + ptr.x * 0.28 * tilt * (1 - 0.6 * settle),
      Math.sin(t * 0.7) * 0.05 * idle + (1 - a) * 0.4 - 0.04 * (1 - settle) * a
    );
    key.target.position.copy(paper.position);
    paper.updateMatrixWorld();
    placePins(span(prog, 0.82, 0.97));
    renderer.render(scene, camera);
  }

  layout();
  new ResizeObserver(layout).observe(stage);
  // pause rendering when the story is off screen
  new IntersectionObserver(([e]) => { running = e.isIntersecting; last = performance.now(); }).observe(stage);
  raf = requestAnimationFrame(frame);

  return { setProgress(p) { target = clamp(p); }, jump(p) { target = prog = clamp(p); } };
}
