// Pfeilspiel — Three.js-Renderschicht (SPEC §4.3, §8).
// Renderer, Szenengraph, Kamera, OrbitControls, prozeduraler Pfeilatlas,
// UV-Variantengeometrien, Sichtbarkeit, Picking, Tweens.
// Geteilte Materialien werden hier NIE mutiert (SPEC §0.6): Hover, Selektion,
// Roentgen und Ausblenden laufen ausschliesslich ueber Materialvarianten.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CELL, CUBE_EDGE, OUT, DIR6, worldPosOf, dirWorldOf, latticeOf } from './game.js';

// --- Konstanten ---------------------------------------------------------

/** Picking-Layer der antippbaren Turmwuerfel (SPEC §8.7). */
export const LAYER_PICK = 1;

/** Spalten des Pfeilatlas. */
export const TILE = Object.freeze({ PLAIN: 0, ARROW: 1, TIP: 2, TAIL: 3 });

/** Zeilen des Pfeilatlas, von oben gezaehlt (rowFromTop). */
export const ROW = Object.freeze({ NORMAL: 0, TARGET: 1, HINT: 2 });

const COLS = 4;
const ROWS = 4;

// Die BoxGeometry-Flaechen liegen in der Reihenfolge +X,-X,+Y,-Y,+Z,-Z vor,
// also exakt in der Reihenfolge von DIR6 (SPEC §2.2, §8.5).
const FACE_N = DIR6;
/** Gemessene UV-Tangentenbasis in r185; es gilt Tu x Tv = n. */
const FACE_TU = [
  [0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0]
];
const FACE_TV = [
  [0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]
];
/** UV der vier Eckpunkte je BoxGeometry-Flaeche in Vertexreihenfolge. */
const BASE_UV = [[0, 1], [1, 1], [0, 0], [1, 0]];
/** (a,b) = (d*Tu, d*Tv) je Vierteldrehung, gegen den Uhrzeigersinn. */
const DIR4 = [[0, 1], [-1, 0], [0, -1], [1, 0]];

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Ein Tap in den letzten 140 ms einer Animation wird gepuffert (SPEC §8.9.3). */
const BUFFER_WINDOW_MS = 140;

// --- Easing -------------------------------------------------------------

function stepped(n) {
  return (t) => (t >= 1 ? 1 : Math.floor(t * n) / n);
}

/** Easingfunktionen; die Namen sind die Tokenwerte aus skin.motion. */
export const Ease = Object.freeze({
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inQuad: (t) => t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // Gedaempfte Feder mit leichtem Ueberschwingen, endet exakt auf 1.
  appleSpring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(7.0 * t)),
  stepped6: stepped(6),
  stepped8: stepped(8)
});

/** Loest einen Easingnamen aus skin.motion auf; unbekannt -> linear. */
function easeOf(name) {
  return (typeof name === 'string' && typeof Ease[name] === 'function') ? Ease[name] : Ease.linear;
}

// --- kleine Helfer ------------------------------------------------------

function now() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function dirKeyOf(v) {
  return Math.round(v[0]) + ',' + Math.round(v[1]) + ',' + Math.round(v[2]);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function raf(fn) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
  return setTimeout(fn, 16);
}

function unraf(h) {
  if (h == null) return;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(h);
  else clearTimeout(h);
}

// --- Renderer -----------------------------------------------------------

/** Rendererzustand (Pixelverhaeltnis, Groesse) ohne Fremdfelder am Renderer. */
const rendererState = new WeakMap();

function stateOf(renderer) {
  let s = rendererState.get(renderer);
  if (!s) {
    s = { lowEnd: false, maxPixelRatio: 2, pixelRatio: 1, width: 1, height: 1 };
    rendererState.set(renderer, s);
  }
  return s;
}

function applyViewport(renderer) {
  const s = stateOf(renderer);
  renderer.setPixelRatio(s.pixelRatio);
  renderer.setSize(s.width, s.height, false);
}

function detectLowEnd() {
  const nav = (typeof navigator !== 'undefined') ? navigator : null;
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
  const cores = nav && typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 8;
  const ua = nav && nav.userAgent ? nav.userAgent : '';
  return cores <= 4 || (/Android/.test(ua) && dpr > 2.5);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{lowEnd?:boolean}} [opts]
 * @returns {THREE.WebGLRenderer}
 */
export function createRenderer(canvas, opts = {}) {
  const lowEnd = (typeof opts.lowEnd === 'boolean') ? opts.lowEnd : detectLowEnd();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !lowEnd,
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
  const cap = lowEnd ? 1.5 : 2;
  const s = stateOf(renderer);
  s.lowEnd = lowEnd;
  s.maxPixelRatio = cap;
  s.pixelRatio = Math.min(dpr, cap);
  s.width = Math.max(1, canvas.clientWidth || canvas.width || 1);
  s.height = Math.max(1, canvas.clientHeight || canvas.height || 1);
  renderer.setPixelRatio(s.pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap ist ab 0.185 veraltet
  renderer.shadowMap.enabled = !lowEnd;
  return renderer;
}

// --- Szenengraph --------------------------------------------------------

/**
 * Baut den Szenengraphen nach SPEC §8.2. Der Screenshake wirkt auf worldRig.
 * @param {THREE.WebGLRenderer} renderer
 */
export function createScene(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);

  const worldRig = new THREE.Group();
  worldRig.name = 'psWorldRig';
  const towerGroup = new THREE.Group();
  towerGroup.name = 'psTowerGroup';
  const flyingGroup = new THREE.Group();
  flyingGroup.name = 'psFlyingGroup';
  const fxGroup = new THREE.Group();
  fxGroup.name = 'psFxGroup';

  // Platzhaltergeometrie; createTowerView ersetzt sie durch die Turmmasse.
  const coreBox = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x0e1116, roughness: 1, metalness: 0 })
  );
  coreBox.name = 'psCoreBox';
  coreBox.visible = false;
  coreBox.matrixAutoUpdate = false;
  coreBox.updateMatrix();

  worldRig.add(towerGroup, coreBox, flyingGroup, fxGroup);
  scene.add(worldRig);

  const hemi = new THREE.HemisphereLight(0x8fa3bd, 0x0a0c10, 0.55);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0x5b8cff, 0.45);
  fill.position.set(-1, 0.4, -1);
  scene.add(hemi, key, key.target, fill);

  // Weiches Specular ohne HDR-Datei: PMREM aus der RoomEnvironment.
  let envRT = null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    envRT = pmrem.fromScene(room, 0.04);
    scene.environment = envRT.texture;
    room.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      }
    });
    pmrem.dispose();
  } catch (err) {
    // Ohne Environment ist die Szene lediglich matter; kein harter Fehler.
    scene.environment = null;
  }

  scene.userData.psEnvRT = envRT;
  scene.userData.psDispose = () => {
    if (envRT) { envRT.dispose(); envRT = null; }
    scene.environment = null;
    if (key.shadow && key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    coreBox.geometry.dispose();
    coreBox.material.dispose();
  };

  return {
    scene, worldRig, towerGroup, flyingGroup, fxGroup,
    lights: { hemi, key, fill },
    coreBox
  };
}

// --- Kamera, Controls, Framing -----------------------------------------

/** @param {number} aspect */
export function createCamera(aspect) {
  const cam = new THREE.PerspectiveCamera(45, aspect > 0 ? aspect : 1, 0.1, 1000);
  cam.position.set(0, 6, 12);
  return cam;
}

/**
 * OrbitControls nach SPEC §8.4.
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLCanvasElement} canvas
 * @param {{minPolarDeg?:number, maxPolarDeg?:number}} [opts]
 */
export function createControls(camera, canvas, opts = {}) {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.9;
  controls.zoomToCursor = false;
  controls.minPolarAngle = THREE.MathUtils.degToRad(
    typeof opts.minPolarDeg === 'number' ? opts.minPolarDeg : 18);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(
    typeof opts.maxPolarDeg === 'number' ? opts.maxPolarDeg : 102);
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE
  };
  // enablePan = false laesst DOLLY_PAN zu reinem Pinch-Dolly entarten.
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  return controls;
}

/**
 * Gieren-invariantes Framing (SPEC §8.3).
 * @param {THREE.PerspectiveCamera} camera
 * @param {OrbitControls} controls
 * @param {{W:number,H:number,D:number}} dims
 * @param {number} [cell]
 * @param {number} [margin]
 * @param {number} [hudFraction]  verkuerzt die nutzbare Viewporthoehe
 * @param {{anim?:Object, durMs?:number, ease?:Function}} [opts]
 *        Mit opts.anim laeuft der Refit als Spherical-Tween (SPEC §8.3),
 *        dabei bleiben die aktuellen Blickwinkel erhalten.
 * @returns {number} Kameradistanz
 */
export function fitCamera(camera, controls, dims, cell = CELL, margin = 1.15, hudFraction = 0, opts) {
  const W = dims.W, H = dims.H, D = dims.D;
  const hf = clamp(hudFraction || 0, 0, 0.6);
  const vFovFull = THREE.MathUtils.degToRad(camera.fov);
  const usable = 1 - hf;
  const vFov = 2 * Math.atan(Math.tan(vFovFull / 2) * usable);
  const hFov = 2 * Math.atan(Math.tan(vFovFull / 2) * camera.aspect);
  const halfH = (H * cell) / 2;
  const Rxz = 0.5 * Math.hypot(W * cell, D * cell);
  const dist = Math.max(halfH / Math.tan(vFov / 2) + Rxz,
    Rxz / Math.tan(hFov / 2) + Rxz) * margin;

  const targetY = H * cell * 0.04 + hf * halfH;

  controls.minDistance = Math.max(2 * cell, dist * 0.35);
  controls.maxDistance = dist * 2.2;
  camera.near = Math.max(0.1, dist * 0.01);
  camera.far = dist * 6;
  camera.updateProjectionMatrix();

  const anim = opts && opts.anim;
  if (anim && typeof anim.play === 'function') {
    // Laufendes Spiel: 500-ms-Tween, Blickrichtung bleibt stehen.
    const startTarget = controls.target.clone();
    const endTarget = new THREE.Vector3(0, targetY, 0);
    const sph = new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(startTarget));
    const startR = sph.radius;
    const phi = clamp(sph.phi, controls.minPolarAngle, controls.maxPolarAngle);
    const theta = sph.theta;
    const dur = (opts && typeof opts.durMs === 'number') ? opts.durMs : 500;
    const ease = (opts && typeof opts.ease === 'function') ? opts.ease : Ease.inOutCubic;
    const wasEnabled = controls.enabled;
    controls.enabled = false;
    const tmp = new THREE.Spherical();
    const pos = new THREE.Vector3();
    anim.play(new Tween(dur, ease, (e) => {
      tmp.set(startR + (dist - startR) * e, phi, theta);
      pos.setFromSpherical(tmp);
      controls.target.lerpVectors(startTarget, endTarget, e);
      camera.position.copy(controls.target).add(pos);
      camera.lookAt(controls.target);
    }, () => {
      controls.enabled = wasEnabled;
      controls.update();
    }));
    return dist;
  }

  controls.target.set(0, targetY, 0);
  camera.position
    .setFromSpherical(new THREE.Spherical(dist, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(35)))
    .add(controls.target);
  camera.lookAt(controls.target);
  controls.update();
  return dist;
}

const _keyDir = new THREE.Vector3();
const _keyState = new WeakMap();

/**
 * Fuehrt das Key-Light der Kamera nach: 35 Grad seitlich versetzt, y >= 0.55*|v|
 * (SPEC §8.4). Ohne Nachfuehrung steht der Spieler nach einer halben Drehung
 * im Gegenlicht und liest keinen Pfeil mehr.
 */
export function updateKeyLight(key, camera, controls, dist) {
  _keyDir.copy(camera.position).sub(controls.target);
  const len = _keyDir.length();
  if (len < 1e-6) return;
  _keyDir.applyAxisAngle(WORLD_UP, THREE.MathUtils.degToRad(35));
  const minY = 0.55 * len;
  if (_keyDir.y < minY) _keyDir.y = minY;
  _keyDir.setLength(Math.max(dist, 1) * 1.25);
  key.position.copy(controls.target).add(_keyDir);
  key.target.position.copy(controls.target);
  key.target.updateMatrixWorld();

  if (key.castShadow) {
    const st = _keyState.get(key);
    if (!st || Math.abs(st.dist - dist) > 1e-3) {
      const s = Math.max(1, dist * 0.75);
      const cam = key.shadow.camera;
      cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
      cam.near = Math.max(0.1, dist * 0.05);
      cam.far = Math.max(cam.near + 1, dist * 3);
      cam.updateProjectionMatrix();
      _keyState.set(key, { dist });
    }
  }
}

/**
 * ResizeObserver auf dem Canvas-Container plus DPR-Wechsel per matchMedia
 * (SPEC §8.2). Liefert die Abmeldefunktion.
 */
export function attachResize(renderer, camera, container, onResize) {
  const s = stateOf(renderer);
  let mq = null;

  const apply = () => {
    const w = Math.max(1, Math.round(container.clientWidth || 1));
    const h = Math.max(1, Math.round(container.clientHeight || 1));
    s.width = w; s.height = h;
    applyViewport(renderer);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (typeof onResize === 'function') onResize(w, h);
  };

  const onDpr = () => {
    const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
    s.pixelRatio = Math.min(dpr, s.maxPixelRatio);
    watchDpr();
    apply();
  };

  function watchDpr() {
    if (typeof matchMedia !== 'function') return;
    if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onDpr);
    const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
    mq = matchMedia('(resolution: ' + dpr + 'dppx)');
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onDpr);
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(apply);
    ro.observe(container);
  } else if (typeof addEventListener === 'function') {
    addEventListener('resize', apply, { passive: true });
  }
  watchDpr();
  apply();

  return () => {
    if (ro) ro.disconnect();
    else if (typeof removeEventListener === 'function') removeEventListener('resize', apply);
    if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onDpr);
  };
}

/**
 * Renderloop mit On-Demand-Rendering und adaptivem Pixelverhaeltnis
 * (SPEC §8.2, §8.4). `step(dtMs, forced)` rendert selbst und meldet per
 * Rueckgabewert, ob ein Bild gezeichnet wurde.
 */
export function startLoop(renderer, step) {
  const timer = new THREE.Timer();   // THREE.Clock ist ab 0.185 veraltet
  const s = stateOf(renderer);
  let forced = true;
  let frames = 0;
  let sum = 0;

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05) * 1000;
    const want = forced;
    forced = false;
    const drawn = step(dt, want);
    if (!drawn) return;
    // Rollierender Mittelwert ueber 60 gezeichnete Bilder.
    sum += dt; frames++;
    if (frames >= 60) {
      const mean = sum / frames;
      sum = 0; frames = 0;
      if (mean > 22 && s.pixelRatio > 1.0) {
        s.pixelRatio = Math.max(1.0, Math.round((s.pixelRatio - 0.25) * 100) / 100);
        applyViewport(renderer);
        forced = true;
      }
    }
  });

  return {
    stop() { renderer.setAnimationLoop(null); },
    requestRender() { forced = true; }
  };
}

// --- Pfeilatlas ---------------------------------------------------------

function colorOf(v, fallback) {
  try { return new THREE.Color(v === undefined || v === null ? fallback : v); }
  catch (err) { return new THREE.Color(fallback); }
}

function cssColor(v, fallback) {
  return colorOf(v, fallback).getStyle();
}

/** Analytischer Pfeil (nach oben zeigend) im Einheitsquadrat 0..1. */
function arrowInside(px, py, a) {
  // py = 0 ist die Spitze, py = 1 der Schaftfuss.
  const headEnd = a.head;
  const halfShaft = a.shaft / 2;
  if (py < 0) return false;
  if (py > 1) return false;
  if (py <= headEnd) {
    // Dreieck: Breite waechst linear von 0 (Spitze) auf 0.5 (Basis).
    const w = headEnd > 0 ? 0.5 * (py / headEnd) : 0.5;
    return Math.abs(px - 0.5) <= w;
  }
  return Math.abs(px - 0.5) <= halfShaft;
}

function paintArrowSolid(ctx, x, y, size, a, fill) {
  const hx = x + size * 0.5;
  const headEnd = y + size * a.head;
  const r = a.radius * size;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(hx, y);
  ctx.lineTo(x + size, headEnd);
  ctx.lineTo(x, headEnd);
  ctx.closePath();
  ctx.fill();
  const sw = a.shaft * size;
  const sx = hx - sw / 2;
  ctx.beginPath();
  if (r > 0 && typeof ctx.roundRect === 'function') {
    ctx.roundRect(sx, headEnd - size * 0.02, sw, size - (a.head * size) + size * 0.02, r);
  } else {
    ctx.rect(sx, headEnd - size * 0.02, sw, size - (a.head * size) + size * 0.02);
  }
  ctx.fill();
}

function paintArrowChevron(ctx, x, y, size, a, stroke) {
  const hx = x + size * 0.5;
  const lw = Math.max(1, a.stroke * size);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const headEnd = y + size * a.head;
  const inset = lw * 0.6;
  ctx.beginPath();
  ctx.moveTo(hx, y + size);
  ctx.lineTo(hx, y + inset);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + inset, headEnd);
  ctx.lineTo(hx, y + inset);
  ctx.lineTo(x + size - inset, headEnd);
  ctx.stroke();
}

function paintArrowPixel(ctx, x, y, size, a, fill) {
  const n = Math.max(4, Math.round(a.grid || 16));
  const c = size / n;
  ctx.fillStyle = fill;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const px = (gx + 0.5) / n;
      const py = (gy + 0.5) / n;
      if (arrowInside(px, py, a)) ctx.fillRect(x + gx * c, y + gy * c, Math.ceil(c), Math.ceil(c));
    }
  }
}

function paintRing(ctx, x, y, size, a, color, withDot, withCross) {
  const cx = x + size / 2, cy = y + size / 2;
  const r = size * 0.34;
  const lw = Math.max(1, a.stroke * size);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (withDot) {
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
  if (withCross) {
    const d = r * 0.62;
    ctx.beginPath();
    ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
    ctx.stroke();
  }
}

/** Zeichnet eine Kachel: erst Koerperflaeche, dann Glyph. */
function paintTile(ctx, col, rowFromTop, tile, a, body, glyph, glow) {
  const x0 = col * tile;
  const y0 = rowFromTop * tile;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.fillStyle = body;
  ctx.fillRect(x0, y0, tile, tile);

  if (col === TILE.PLAIN) { ctx.restore(); return; }

  // Gutter erzwingen: der Glyph bleibt in der inneren Flaeche.
  const m = Math.max(a.margin, (a.gutter || 16) / tile);
  const inner = tile * (1 - 2 * m);
  const ix = x0 + tile * m;
  const iy = y0 + tile * m;

  ctx.globalAlpha = clamp(a.glyphAlpha === undefined ? 1 : a.glyphAlpha, 0, 1);
  if (glow > 0) {
    ctx.shadowBlur = glow * tile * 0.06;
    ctx.shadowColor = glyph;
  }

  if (col === TILE.ARROW) {
    if (a.style === 'pixelArrow') paintArrowPixel(ctx, ix, iy, inner, a, glyph);
    else if (a.style === 'softChevron') paintArrowChevron(ctx, ix, iy, inner, a, glyph);
    else paintArrowSolid(ctx, ix, iy, inner, a, glyph);
  } else if (col === TILE.TIP) {
    paintRing(ctx, ix, iy, inner, a, glyph, true, false);
  } else if (col === TILE.TAIL) {
    paintRing(ctx, ix, iy, inner, a, glyph, false, true);
  }
  ctx.restore();
}

function atlasTokens(skin) {
  const a = (skin && skin.three && skin.three.atlas) ? skin.three.atlas : {};
  return {
    tile: Math.max(32, Math.round(a.tile || 256)),
    gutter: Math.max(16, Math.round(a.gutter === undefined ? 16 : a.gutter)),
    style: a.style || 'solidTriangle',
    body: cssColor(a.body, '#F2F1EE'),
    bodyTarget: cssColor(a.bodyTarget, '#4ADE80'),
    glyph: cssColor(a.glyph, '#12151A'),
    glyphAlpha: a.glyphAlpha === undefined ? 1 : a.glyphAlpha,
    accent: cssColor(a.accent, '#5B8CFF'),
    margin: clamp(a.margin === undefined ? 0.18 : a.margin, 0, 0.45),
    shaft: a.shaft === undefined ? 0.24 : a.shaft,
    head: a.head === undefined ? 0.56 : a.head,
    radius: a.radius === undefined ? 0.05 : a.radius,
    stroke: a.stroke === undefined ? 0.11 : a.stroke,
    grid: a.grid === undefined ? 16 : a.grid,
    glow: a.glow === undefined ? 0 : a.glow,
    nearest: !!a.nearest,
    anisotropy: a.anisotropy === undefined ? 8 : a.anisotropy
  };
}

function paintAtlas(canvas, a, emissive) {
  const tile = a.tile;
  canvas.width = tile * COLS;
  canvas.height = tile * ROWS;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Zeile 3 ist Reserve und wird wie NORMAL gezeichnet.
  const rows = [ROW.NORMAL, ROW.TARGET, ROW.HINT, ROW.NORMAL];
  for (let r = 0; r < ROWS; r++) {
    const kind = rows[r];
    let body, glyph;
    if (emissive) {
      // Emissivkarte: leuchtende Koerperflaeche, dunkler Glyph.
      body = kind === ROW.NORMAL ? '#ffffff' : (kind === ROW.TARGET ? '#ffffff' : '#c8c8c8');
      glyph = '#000000';
    } else {
      body = kind === ROW.TARGET ? a.bodyTarget : (kind === ROW.HINT ? a.accent : a.body);
      glyph = a.glyph;
    }
    for (let c = 0; c < COLS; c++) {
      paintTile(ctx, c, r, tile, a, body, glyph, emissive ? 0 : a.glow);
    }
  }
}

/**
 * Prozeduraler Pfeilatlas auf einem Canvas, keine externen Bilder (SPEC §8.5).
 * @param {Object} skin SkinTokens
 * @param {number} maxAnisotropy renderer.capabilities.getMaxAnisotropy()
 */
export function buildAtlas(skin, maxAnisotropy) {
  const cvA = document.createElement('canvas');
  const cvE = document.createElement('canvas');
  const map = new THREE.CanvasTexture(cvA);
  const emissiveMap = new THREE.CanvasTexture(cvE);

  function configure(a) {
    const aniso = Math.max(1, Math.min(a.anisotropy, maxAnisotropy || 1));
    for (const tex of [map, emissiveMap]) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = a.nearest ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
      tex.magFilter = a.nearest ? THREE.NearestFilter : THREE.LinearFilter;
      tex.anisotropy = a.nearest ? 1 : aniso;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
    }
  }

  function redraw(nextSkin) {
    const a = atlasTokens(nextSkin || skin);
    paintAtlas(cvA, a, false);
    paintAtlas(cvE, a, true);
    configure(a);
  }

  redraw(skin);

  return {
    map,
    emissiveMap,
    redraw,
    dispose() { map.dispose(); emissiveMap.dispose(); }
  };
}

// --- UV-Variantengeometrien ---------------------------------------------

/** Vierteldrehung des Glyphs in der Flaechenebene (SPEC §8.5). */
function inPlaneRotation(f, d) {
  const a = Math.round(dot3(d, FACE_TU[f]));
  const b = Math.round(dot3(d, FACE_TV[f]));
  for (let r = 0; r < 4; r++) if (DIR4[r][0] === a && DIR4[r][1] === b) return r;
  return 0;
}

/**
 * Schreibt die vier UVs einer Wuerfelflaeche auf die Atlaskachel.
 * Die innere Schleife dreht die UV-Koordinaten im Uhrzeigersinn, damit der
 * Glyph auf der Flaeche gegen den Uhrzeigersinn kippt und rot = r genau
 * DIR4[r] trifft (SPEC §8.5, Spiegelungsfall).
 */
function writeFaceUV(uv, f, col, rowFromTop, rot) {
  for (let k = 0; k < 4; k++) {
    let u = BASE_UV[k][0];
    let v = BASE_UV[k][1];
    for (let i = 0; i < rot; i++) { const nu = v, nv = 1 - u; u = nu; v = nv; }
    const row = ROWS - 1 - rowFromTop;   // CanvasTexture hat flipY = true
    uv.setXY(f * 4 + k, (col + u) / COLS, (row + v) / ROWS);
  }
}

/**
 * Eine Wuerfelgeometrie mit umgeschriebenen UVs; ein Material, ein Draw Call.
 * @param {number[]} dirWorld Weltrichtung des Pfeils, Einheitsvektor
 * @param {number} rowFromTop Atlaszeile von oben (ROW.*)
 * @returns {THREE.BufferGeometry}
 */
export function buildVariant(dirWorld, rowFromTop) {
  const g = new THREE.BoxGeometry(CUBE_EDGE, CUBE_EDGE, CUBE_EDGE);
  const uv = g.getAttribute('uv');
  for (let f = 0; f < 6; f++) {
    const t = dot3(dirWorld, FACE_N[f]);
    if (t > 0.5) writeFaceUV(uv, f, TILE.TIP, rowFromTop, 0);
    else if (t < -0.5) writeFaceUV(uv, f, TILE.TAIL, rowFromTop, 0);
    else writeFaceUV(uv, f, TILE.ARROW, rowFromTop, inPlaneRotation(f, dirWorld));
  }
  uv.needsUpdate = true;
  g.clearGroups();
  g.addGroup(0, 36, 0);
  return g;
}

/**
 * Die 12 Turmvarianten: 6 Weltrichtungen x {NORMAL, TARGET} (SPEC §8.5).
 * Schluessel `${dirWorldKey}|${rowFromTop}`.
 * @param {'FASSADE'|'VOLUMEN'} mode
 * @returns {Map<string, THREE.BufferGeometry>}
 */
export function buildVariantSet(mode) {
  if (mode !== 'FASSADE' && mode !== 'VOLUMEN') throw new RangeError('Modus: FASSADE oder VOLUMEN');
  const set = new Map();
  for (let d = 0; d < 6; d++) {
    const v = FACE_N[d];   // identisch zu DIR6
    const key = dirKeyOf(v);
    for (const row of [ROW.NORMAL, ROW.TARGET]) {
      set.set(key + '|' + row, buildVariant(v, row));
    }
  }
  return set;
}

// --- Tween und Animationslauf -------------------------------------------

/** Minimaler Tween; keine externe Bibliothek (SPEC §8.8). */
export class Tween {
  /**
   * @param {number} durMs
   * @param {(t:number)=>number} ease
   * @param {(eased:number, raw:number)=>void} onUpdate
   * @param {()=>void} [onDone]
   */
  constructor(durMs, ease, onUpdate, onDone) {
    this.dur = Math.max(0, durMs || 0);
    this.ease = typeof ease === 'function' ? ease : Ease.linear;
    this.onUpdate = onUpdate;
    this.onDone = onDone;
    this.elapsed = 0;
    this.done = false;
  }

  get remainingMs() { return this.done ? 0 : Math.max(0, this.dur - this.elapsed); }

  /** @returns {boolean} true solange der Tween laeuft */
  update(dtMs) {
    if (this.done) return false;
    this.elapsed += dtMs;
    if (this.elapsed >= this.dur) { this.finish(); return false; }
    const t = this.dur > 0 ? this.elapsed / this.dur : 1;
    if (this.onUpdate) this.onUpdate(this.ease(t), t);
    return true;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.elapsed = this.dur;
    if (this.onUpdate) this.onUpdate(1, 1);
    if (this.onDone) this.onDone();
  }
}

function trackRemaining(track) {
  let ms = 0;
  for (let i = track.i; i < track.items.length; i++) {
    const it = track.items[i];
    if (typeof it === 'number') ms += (i === track.i ? track.wait : it);
    else ms += it.remainingMs;
  }
  return ms;
}

function enterItem(track) {
  const it = track.items[track.i];
  track.wait = (typeof it === 'number') ? Math.max(0, it) : 0;
}

/**
 * Lauf fuer parallele Tweenspuren mit Ein-Slot-Eingabepuffer (SPEC §8.8, §8.9).
 * @param {{speed?:number, strictLock?:boolean}} [opts]
 */
export function createAnimRunner(opts = {}) {
  const tracks = [];
  let buffered = null;

  const runner = {
    speed: typeof opts.speed === 'number' && opts.speed > 0 ? opts.speed : 1,
    strictLock: !!opts.strictLock,
    busy: false,

    /** Verbleibende Laufzeit der laengsten Spur in Millisekunden. */
    get remainingMs() {
      let ms = 0;
      for (const t of tracks) ms = Math.max(ms, trackRemaining(t));
      return ms;
    },

    play(tween) {
      if (!tween) return;
      const track = { items: [tween], i: 0, wait: 0 };
      tracks.push(track);
      runner.busy = true;
    },

    playSequence(items) {
      if (!items || !items.length) return;
      const track = { items: items.slice(), i: 0, wait: 0 };
      enterItem(track);
      tracks.push(track);
      runner.busy = true;
    },

    /** @returns {boolean} true solange irgendetwas laeuft */
    update(dtMs) {
      const dt = Math.max(0, dtMs) * (runner.speed > 0 ? runner.speed : 1);
      for (let ti = tracks.length - 1; ti >= 0; ti--) {
        const track = tracks[ti];
        let left = dt;
        while (left > 0 && track.i < track.items.length) {
          const it = track.items[track.i];
          if (typeof it === 'number') {
            if (track.wait <= left) { left -= track.wait; track.i++; enterItem(track); }
            else { track.wait -= left; left = 0; }
          } else {
            const rem = it.remainingMs;
            if (rem <= left) { it.finish(); left -= rem; track.i++; enterItem(track); }
            else { it.update(left); left = 0; }
          }
        }
        if (track.i >= track.items.length) tracks.splice(ti, 1);
      }
      runner.busy = tracks.length > 0;
      return runner.busy;
    },

    /** Ein-Slot-Puffer: nur ein Tap kurz vor dem Animationsende wird gemerkt. */
    buffer(cell) {
      if (!Number.isInteger(cell)) return;
      if (runner.remainingMs > BUFFER_WINDOW_MS) return;
      buffered = cell;
    },

    takeBuffered() {
      const c = buffered;
      buffered = null;
      return c === null || c === undefined ? null : c;
    },

    /** Harter Synchronisationspunkt vor Undo, Neustart, Skin-/Modus-/Levelwechsel. */
    finishAll() {
      for (const track of tracks) {
        for (let i = track.i; i < track.items.length; i++) {
          const it = track.items[i];
          if (typeof it !== 'number') it.finish();
        }
      }
      tracks.length = 0;
      runner.busy = false;
    }
  };

  return runner;
}

/**
 * Sprungbogen radial nach aussen, nicht nach Weltoben (SPEC §8.8).
 * @param {THREE.Vector3} from @param {THREE.Vector3} dir @param {THREE.Vector3} center
 */
export function arcAxis(from, dir, center) {
  const radial = from.clone().sub(center);
  radial.addScaledVector(dir, -radial.dot(dir));
  if (radial.lengthSq() < 1e-6) radial.copy(WORLD_UP).addScaledVector(dir, -WORLD_UP.dot(dir));
  if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
  return radial.normalize();
}

/** Screenshake auf worldRig.position, niemals auf der Kamera (SPEC §7.6). */
export function shakeWorld(worldRig, amplitude, durMs) {
  const base = worldRig.position.clone();
  const amp = amplitude * CELL;
  const f = 34;
  return new Tween(durMs, Ease.linear, (e, t) => {
    const damp = (1 - t);
    const w = 2 * Math.PI * f * (durMs / 1000) * t;
    worldRig.position.set(
      base.x + Math.sin(w) * amp * damp,
      base.y + Math.sin(w * 1.31 + 1.7) * amp * 0.6 * damp,
      base.z + Math.sin(w * 0.87 + 3.1) * amp * damp
    );
  }, () => { worldRig.position.copy(base); });
}

// --- Turmansicht --------------------------------------------------------

function findGroup(scene, name) {
  const g = scene.getObjectByName(name);
  if (g) return g;
  const created = new THREE.Group();
  created.name = name;
  scene.add(created);
  return created;
}

function buildMaterialSet(skin, atlas) {
  const t = (skin && skin.three) ? skin.three : {};
  const cube = t.cube || {};
  const shadows = t.shadows !== false;

  const base = new THREE.MeshStandardMaterial({
    map: atlas.map,
    emissiveMap: atlas.emissiveMap,
    color: 0xffffff,
    roughness: cube.roughness === undefined ? 0.62 : cube.roughness,
    metalness: cube.metalness === undefined ? 0 : cube.metalness,
    emissive: colorOf(cube.emissive, 0x000000),
    emissiveIntensity: cube.emissiveIntensity === undefined ? 0 : cube.emissiveIntensity,
    envMapIntensity: cube.envMapIntensity === undefined ? 0.5 : cube.envMapIntensity,
    side: THREE.FrontSide
  });

  const hoverTok = t.hover || {};
  const targetTok = t.target || {};
  const ghostTok = t.ghost || {};

  const hover = base.clone();
  hover.emissive = colorOf(hoverTok.emissive, 0x5b8cff);
  hover.emissiveIntensity = hoverTok.emissiveIntensity === undefined ? 0.22 : hoverTok.emissiveIntensity;

  const target = base.clone();
  target.emissive = colorOf(targetTok.emissive, 0x0f3d24);
  target.emissiveIntensity = targetTok.emissiveIntensity === undefined ? 0.6 : targetTok.emissiveIntensity;

  const targetHover = target.clone();
  targetHover.emissive = colorOf(hoverTok.emissive, 0x5b8cff);
  targetHover.emissiveIntensity = Math.max(
    hover.emissiveIntensity, target.emissiveIntensity);

  const ghostOpacity = ghostTok.opacity === undefined ? 0.16 : ghostTok.opacity;
  const ghost = base.clone();
  ghost.transparent = true; ghost.opacity = ghostOpacity; ghost.depthWrite = false;
  const ghostTarget = target.clone();
  ghostTarget.transparent = true; ghostTarget.opacity = ghostOpacity; ghostTarget.depthWrite = false;

  const accentCol = (t.atlas && t.atlas.accent) || '#5B8CFF';
  const danger = (skin && skin.css && skin.css['--ps-danger']) || '#E2564A';
  const flash = base.clone();
  flash.emissive = colorOf(danger, 0xe2564a);
  flash.emissiveIntensity = 0.9;

  // Vorschau: Geisterspur (Atlas, HINT-Zeile) und Traegerleuchten im fxGroup.
  const preview = new THREE.MeshBasicMaterial({
    map: atlas.map, color: 0xffffff,
    transparent: true, opacity: 0.30, depthWrite: false
  });

  const carrier = new THREE.MeshBasicMaterial({
    color: colorOf(accentCol, 0x5b8cff), transparent: true, opacity: 0.55,
    depthWrite: false, wireframe: true
  });

  const fade = [];
  for (let i = 0; i < 8; i++) {
    const m = base.clone();
    m.transparent = true; m.depthWrite = false; m.opacity = 1;
    fade.push({ mat: m, used: false });
  }

  return {
    base, hover, target, targetHover, ghost, ghostTarget, flash, preview, carrier,
    fade, shadows,
    all() {
      return [base, hover, target, targetHover, ghost, ghostTarget, flash, preview, carrier]
        .concat(fade.map((f) => f.mat));
    }
  };
}

/**
 * @typedef {Object} CubeRef
 * @property {number} id @property {number} cell @property {number} dir
 * @property {string} dirKey @property {boolean} target @property {boolean} alive
 * @property {boolean} busy @property {boolean} hovered @property {boolean} ghosted
 * @property {boolean} hidden @property {boolean} flashing
 * @property {THREE.Mesh} mesh
 * @property {?THREE.Material} fadeMat
 */

/**
 * Die Turmansicht: ein Mesh je Wuerfel, geteilte Geometrie je Variante,
 * geteilte Materialien (SPEC §8.5, §8.6).
 * @param {{scene:THREE.Scene, renderer:THREE.WebGLRenderer, board:Object, skin:Object,
 *          requestRender?:()=>void}} ctx
 */
export function createTowerView(ctx) {
  const scene = ctx.scene;
  const renderer = ctx.renderer;
  const board = ctx.board;
  let skin = ctx.skin;
  const requestRender = typeof ctx.requestRender === 'function' ? ctx.requestRender : () => {};

  const towerGroup = findGroup(scene, 'psTowerGroup');
  const flyingGroup = findGroup(scene, 'psFlyingGroup');
  const fxGroup = findGroup(scene, 'psFxGroup');
  const coreBox = scene.getObjectByName('psCoreBox') || null;

  const maxAniso = (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
    ? renderer.capabilities.getMaxAnisotropy() : 1;

  let atlas = buildAtlas(skin, maxAniso);
  let mats = buildMaterialSet(skin, atlas);
  const variants = buildVariantSet(board.mode);

  /** @type {CubeRef[]} */
  const cubes = [];
  /** @type {Map<number, number>} Zelle -> cubeId */
  const byCell = new Map();
  let aliveCount = 0;
  let xray = false;
  let peel = 0;

  const scratch = [0, 0, 0];
  const center = new THREE.Vector3(0, 0, 0);

  // --- Innenkern (nur FASSADE) -----------------------------------------
  let coreGeo = null;
  let coreMat = null;
  if (coreBox) {
    coreGeo = new THREE.BoxGeometry(
      Math.max(0.1, board.W - 1.1), Math.max(0.1, board.H - 1.1), Math.max(0.1, board.D - 1.1));
    const old = coreBox.geometry;
    coreBox.geometry = coreGeo;
    if (old) old.dispose();
    coreMat = makeCoreMaterial(skin);
    const oldMat = coreBox.material;
    coreBox.material = coreMat;
    if (oldMat) oldMat.dispose();
    coreBox.position.set(0, 0, 0);
    coreBox.updateMatrix();
  }

  function makeCoreMaterial(s) {
    const tok = (s && s.three && s.three.coreBox) ? s.three.coreBox : {};
    const op = tok.opacity === undefined ? 1 : tok.opacity;
    return new THREE.MeshStandardMaterial({
      color: colorOf(tok.color, 0x0e1116),
      roughness: 1, metalness: 0,
      transparent: op < 1, opacity: op,
      side: THREE.FrontSide
    });
  }

  function updateCore() {
    if (!coreBox) return;
    coreBox.visible = board.mode === 'FASSADE' && aliveCount >= 8;
  }

  // --- Effektticker (Vorschaublende, rotes Aufblitzen) -------------------
  const jobs = [];
  let tickHandle = null;
  let lastTick = 0;

  function tick() {
    tickHandle = null;
    const t = now();
    const dt = lastTick ? t - lastTick : 16;
    lastTick = t;
    for (let i = jobs.length - 1; i >= 0; i--) {
      if (!jobs[i].update(dt)) jobs.splice(i, 1);
    }
    requestRender();
    if (jobs.length) tickHandle = raf(tick);
    else lastTick = 0;
  }

  function addJob(job) {
    jobs.push(job);
    if (tickHandle === null) { lastTick = now(); tickHandle = raf(tick); }
  }

  // --- Materialauswahl ---------------------------------------------------
  function materialFor(cube) {
    if (cube.fadeMat) return cube.fadeMat;
    if (cube.flashing) return mats.flash;
    if (cube.ghosted) return cube.target ? mats.ghostTarget : mats.ghost;
    if (cube.hovered) return cube.target ? mats.targetHover : mats.hover;
    return cube.target ? mats.target : mats.base;
  }

  function refresh(cube) {
    cube.mesh.material = materialFor(cube);
  }

  function variantFor(dirKey, row) {
    const key = dirKey + '|' + row;
    let g = variants.get(key);
    if (!g) {
      const parts = dirKey.split(',');
      g = buildVariant([Number(parts[0]), Number(parts[1]), Number(parts[2])], row);
      variants.set(key, g);
    }
    return g;
  }

  function worldOf(cell) {
    worldPosOf(board, cell, scratch);
    return new THREE.Vector3(scratch[0], scratch[1], scratch[2]);
  }

  function dirVectorOf(cell, dir) {
    dirWorldOf(board, cell, dir, scratch);
    return new THREE.Vector3(scratch[0], scratch[1], scratch[2]);
  }

  function shellOf(cell) {
    const l = latticeOf(board, cell);
    return Math.min(
      l[0], board.W - 1 - l[0],
      l[1], board.H - 1 - l[1],
      l[2], board.D - 1 - l[2]);
  }

  function applyVisibility(cube) {
    const hide = cube.hidden;
    cube.mesh.visible = !hide && cube.alive;
    if (hide || !cube.alive) cube.mesh.layers.disable(LAYER_PICK);
    else cube.mesh.layers.enable(LAYER_PICK);
  }

  // --- Aufbau ------------------------------------------------------------
  function clearCubes() {
    for (const c of cubes) {
      if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
      if (c.fadeMat) releaseFade(c);
    }
    cubes.length = 0;
    byCell.clear();
    aliveCount = 0;
  }

  function build(level) {
    clearPreview();
    clearCubes();
    const list = level.cubes || [];
    for (let id = 0; id < list.length; id++) {
      const spec = list[id];
      const dv = dirVectorOf(spec.cell, spec.dir);
      const dirKey = dirKeyOf([dv.x, dv.y, dv.z]);
      const row = spec.target ? ROW.TARGET : ROW.NORMAL;
      const mesh = new THREE.Mesh(variantFor(dirKey, row), mats.base);
      const p = worldOf(spec.cell);
      mesh.position.copy(p);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.castShadow = mats.shadows;
      mesh.receiveShadow = mats.shadows;
      mesh.layers.enable(LAYER_PICK);
      mesh.userData.cell = spec.cell;
      mesh.userData.cubeId = id;
      /** @type {CubeRef} */
      const cube = {
        id, cell: spec.cell, dir: spec.dir, dirKey, target: !!spec.target,
        alive: true, busy: false, hovered: false, ghosted: false, hidden: false,
        flashing: false, mesh, fadeMat: null
      };
      cubes.push(cube);
      byCell.set(spec.cell, id);
      towerGroup.add(mesh);
      refresh(cube);
      aliveCount++;
    }
    xray = false;
    peel = 0;
    updateCore();
    requestRender();
  }

  function get(cubeId) {
    return (cubeId >= 0 && cubeId < cubes.length) ? cubes[cubeId] : undefined;
  }

  function cubeAtCell(cell) {
    const id = byCell.get(cell);
    return id === undefined ? undefined : cubes[id];
  }

  // --- Hover, Roentgen, Schichten ---------------------------------------
  let hoveredId = null;

  function setHovered(id) {
    const next = (id === null || id === undefined || id < 0) ? null : id;
    if (next === hoveredId) return;
    if (hoveredId !== null) {
      const prev = get(hoveredId);
      if (prev) { prev.hovered = false; refresh(prev); }
    }
    hoveredId = next;
    if (hoveredId !== null) {
      const cur = get(hoveredId);
      if (cur) { cur.hovered = true; refresh(cur); }
      else hoveredId = null;
    }
    requestRender();
  }

  function setXray(on) {
    xray = !!on;
    for (const c of cubes) {
      if (!c.alive) continue;
      const outer = board.mode === 'FASSADE' ? true : shellOf(c.cell) === 0;
      const g = xray && outer;
      if (g !== c.ghosted) { c.ghosted = g; refresh(c); }
    }
    requestRender();
  }

  function setPeelLayers(k) {
    peel = board.mode === 'VOLUMEN' ? Math.max(0, Math.round(k || 0)) : 0;
    for (const c of cubes) {
      const hide = c.alive && peel > 0 && shellOf(c.cell) < peel;
      if (hide !== c.hidden) { c.hidden = hide; applyVisibility(c); }
    }
    requestRender();
  }

  // --- Rotes Aufblitzen des Blockierers ---------------------------------
  function flashBlocker(cell) {
    const cube = cubeAtCell(cell);
    if (!cube) return;
    if (cube.flashing) return;
    cube.flashing = true;
    refresh(cube);
    let left = 220;
    addJob({
      update(dt) {
        left -= dt;
        if (left > 0) return true;
        cube.flashing = false;
        refresh(cube);
        return false;
      }
    });
  }

  // --- Zugvorschau -------------------------------------------------------
  const previewObjects = [];
  let previewJob = null;
  let carrierGeo = null;

  function clearPreview() {
    if (previewJob) { const j = previewJob; previewJob = null; const i = jobs.indexOf(j); if (i >= 0) jobs.splice(i, 1); }
    for (const o of previewObjects) {
      if (o.parent) o.parent.remove(o);
    }
    previewObjects.length = 0;
  }

  function setPreview(move) {
    clearPreview();
    if (!move || move.kind === 'INVALID') { requestRender(); return; }
    const cube = get(move.cubeId);
    const dirKey = cube ? cube.dirKey : dirKeyOf([0, 1, 0]);
    const geo = variantFor(dirKey, ROW.HINT);

    const path = move.path || [];
    for (let i = 1; i < path.length; i++) {
      const m = new THREE.Mesh(geo, mats.preview);
      m.position.copy(worldOf(path[i]));
      m.userData.psScale = 0.92;
      m.matrixAutoUpdate = false;
      fxGroup.add(m);
      previewObjects.push(m);
    }
    if (move.kind === 'EXIT' && cube) {
      const last = path.length ? path[path.length - 1] : move.from;
      const d = dirVectorOf(last, cube.dir).normalize();
      const m = new THREE.Mesh(geo, mats.preview);
      m.position.copy(worldOf(last)).addScaledVector(d, CELL * 1.4);
      m.userData.psScale = 0.7;
      m.matrixAutoUpdate = false;
      fxGroup.add(m);
      previewObjects.push(m);
    }

    if (!carrierGeo) {
      carrierGeo = new THREE.BoxGeometry(CUBE_EDGE * 1.06, CUBE_EDGE * 1.06, CUBE_EDGE * 1.06);
    }
    for (const cell of (move.jumped || [])) {
      const m = new THREE.Mesh(carrierGeo, mats.carrier);
      m.position.copy(worldOf(cell));
      m.userData.psScale = 1;
      m.matrixAutoUpdate = false;
      fxGroup.add(m);
      previewObjects.push(m);
    }

    // 120 ms Einblenden mit outCubic; skaliert die Deckkraft der Kopien.
    const objs = previewObjects.slice();
    let t = 0;
    const scaleAt = (o, e) => {
      o.scale.setScalar(o.userData.psScale * (0.6 + 0.4 * e));
      o.updateMatrix();
    };
    for (const o of objs) scaleAt(o, 0);
    const job = {
      update(dt) {
        t = Math.min(1, t + dt / 120);
        const e = Ease.outCubic(t);
        for (const o of objs) scaleAt(o, e);
        if (t >= 1) { previewJob = null; return false; }
        return true;
      }
    };
    previewJob = job;
    addJob(job);
    requestRender();
  }

  // --- Materialpool fuer Pro-Wuerfel-Opazitaet ---------------------------
  function acquireFade(cube) {
    let slot = mats.fade.find((f) => !f.used);
    if (!slot) {
      const m = mats.base.clone();
      m.transparent = true; m.depthWrite = false; m.opacity = 1;
      slot = { mat: m, used: false };
      mats.fade.push(slot);
    }
    slot.used = true;
    slot.mat.opacity = 1;
    cube.fadeSlot = slot;
    cube.fadeMat = slot.mat;
    refresh(cube);
    return slot.mat;
  }

  function releaseFade(cube) {
    if (cube.fadeSlot) { cube.fadeSlot.used = false; cube.fadeSlot.mat.opacity = 1; }
    cube.fadeSlot = null;
    cube.fadeMat = null;
    refresh(cube);
  }

  function detachToFlying(cube) {
    if (cube.mesh.parent) cube.mesh.parent.remove(cube.mesh);
    cube.mesh.layers.disable(LAYER_PICK);
    cube.mesh.matrixAutoUpdate = false;
    flyingGroup.add(cube.mesh);
  }

  /** Schreibt das visuelle Ergebnis eines Zuges fest (Aufruf am Tweenende). */
  function commitMove(move) {
    const cube = get(move.cubeId);
    if (!cube) return;
    if (byCell.get(move.from) === cube.id) byCell.delete(move.from);
    cube.mesh.quaternion.identity();
    cube.mesh.scale.setScalar(1);
    if (move.to === OUT) {
      cube.alive = false;
      cube.cell = OUT;
      cube.mesh.userData.cell = OUT;
      if (cube.mesh.parent) cube.mesh.parent.remove(cube.mesh);
      cube.mesh.layers.disable(LAYER_PICK);
      aliveCount = Math.max(0, aliveCount - 1);
    } else {
      cube.cell = move.to;
      cube.mesh.userData.cell = move.to;
      cube.mesh.position.copy(worldOf(move.to));
      byCell.set(move.to, cube.id);
      if (cube.mesh.parent !== towerGroup) towerGroup.add(cube.mesh);
      // Schale kann sich geaendert haben: Roentgen und Schichtenregler nachziehen.
      cube.hidden = board.mode === 'VOLUMEN' && peel > 0 && shellOf(move.to) < peel;
      cube.ghosted = xray && (board.mode === 'FASSADE' || shellOf(move.to) === 0);
      applyVisibility(cube);
    }
    cube.mesh.updateMatrix();
    if (cube.fadeMat) releaseFade(cube);
    else refresh(cube);
    cube.busy = false;
    updateCore();
    requestRender();
  }

  /** Setzt die gesamte Ansicht hart auf einen Spielzustand (Undo, Neustart). */
  function snapAll(state) {
    clearPreview();
    byCell.clear();
    aliveCount = 0;
    for (const cube of cubes) {
      const live = cube.id < state.cubeCount && state.alive[cube.id] === 1;
      cube.busy = false;
      cube.flashing = false;
      cube.hovered = false;
      if (cube.fadeMat) releaseFade(cube);
      cube.mesh.quaternion.identity();
      cube.mesh.scale.setScalar(1);
      if (live) {
        const cell = state.cellOf[cube.id];
        cube.alive = true;
        cube.cell = cell;
        cube.mesh.userData.cell = cell;
        cube.mesh.position.copy(worldOf(cell));
        if (cube.mesh.parent !== towerGroup) towerGroup.add(cube.mesh);
        byCell.set(cell, cube.id);
        aliveCount++;
        cube.hidden = board.mode === 'VOLUMEN' && peel > 0 && shellOf(cell) < peel;
        const outer = board.mode === 'FASSADE' ? true : shellOf(cell) === 0;
        cube.ghosted = xray && outer;
      } else {
        cube.alive = false;
        cube.cell = OUT;
        cube.mesh.userData.cell = OUT;
        cube.hidden = false;
        cube.ghosted = false;
        if (cube.mesh.parent) cube.mesh.parent.remove(cube.mesh);
      }
      applyVisibility(cube);
      refresh(cube);
      cube.mesh.updateMatrix();
    }
    hoveredId = null;
    updateCore();
    requestRender();
  }

  // --- Skinwechsel -------------------------------------------------------
  function setSkin(nextSkin) {
    const oldAtlas = atlas;
    const oldMats = mats;
    const oldCoreMat = coreMat;
    skin = nextSkin;
    atlas = buildAtlas(skin, maxAniso);
    mats = buildMaterialSet(skin, atlas);
    for (const cube of cubes) {
      if (cube.fadeMat) releaseFade(cube);
      cube.mesh.castShadow = mats.shadows;
      cube.mesh.receiveShadow = mats.shadows;
      refresh(cube);
    }
    if (coreBox) {
      coreMat = makeCoreMaterial(skin);
      coreBox.material = coreMat;
    }
    for (const o of previewObjects) {
      o.material = (o.geometry === carrierGeo) ? mats.carrier : mats.preview;
    }
    view.material = mats.base;
    // Erst tauschen, dann nach einem gerenderten Bild freigeben (SPEC §7.7).
    raf(() => {
      for (const m of oldMats.all()) m.dispose();
      oldAtlas.dispose();
      if (oldCoreMat) oldCoreMat.dispose();
    });
    requestRender();
  }

  function dispose() {
    clearPreview();
    if (tickHandle !== null) { unraf(tickHandle); tickHandle = null; }
    jobs.length = 0;
    for (const cube of cubes) {
      if (cube.mesh.parent) cube.mesh.parent.remove(cube.mesh);
    }
    cubes.length = 0;
    byCell.clear();
    for (const g of variants.values()) g.dispose();
    variants.clear();
    if (carrierGeo) { carrierGeo.dispose(); carrierGeo = null; }
    for (const m of mats.all()) m.dispose();
    atlas.dispose();
    if (coreBox) {
      coreBox.visible = false;
      if (coreMat) { coreMat.dispose(); coreMat = null; }
      if (coreGeo) { coreGeo.dispose(); coreGeo = null; }
    }
  }

  const view = {
    towerGroup, flyingGroup, fxGroup, coreBox,
    board,
    center,
    material: mats.base,
    build, get, worldOf, setHovered, setPreview, flashBlocker, setSkin,
    setXray, setPeelLayers, snapAll, dispose,
    // Interne Schnittstelle fuer buildTweens (gleiches Modul).
    cubeAtCell, dirVectorOf, commitMove, acquireFade, releaseFade, detachToFlying,
    get aliveCount() { return aliveCount; },
    get skin() { return skin; },
    get atlas() { return atlas; },
    get materials() { return mats; }
  };
  return view;
}

// --- Zug-Tweens ---------------------------------------------------------

function motionOf(skin) {
  const m = (skin && skin.motion) ? skin.motion : {};
  return {
    step: m.step || { dur: 150, ease: 'inOutCubic' },
    jump: m.jump || { dur: 260, ease: 'inOutCubic', arc: 0.55 },
    chain: m.chain || { delay: 45 },
    wobble: m.wobble || { dur: 260, ease: 'outCubic', amp: 0.10, cycles: 3 },
    fly: m.fly || { dur: 420, ease: 'inQuad', spin: 1.5 }
  };
}

/**
 * Baut die Tweenfolge eines Zuges (SPEC §8.8). Der Spielzustand ist zu diesem
 * Zeitpunkt bereits synchron fortgeschrieben; die Animation zieht nur nach.
 * @returns {Array<Tween|number>} fuer AnimRunner.playSequence
 */
export function buildTweens(view, board, move, skin) {
  const items = [];
  const cube = view.get(move.cubeId);
  if (!cube) return items;
  const mesh = cube.mesh;
  const mo = motionOf(skin);
  cube.busy = true;

  // --- Ungueltig: Wackeln entlang der Pfeilrichtung + rotes Aufblitzen ---
  if (move.kind === 'INVALID') {
    const d = view.dirVectorOf(move.from, cube.dir).normalize();
    const base = view.worldOf(move.from);
    const amp = mo.wobble.amp * CELL;
    const cycles = mo.wobble.cycles;
    const ease = easeOf(mo.wobble.ease);
    let flashed = false;
    items.push(new Tween(mo.wobble.dur, ease, (e, t) => {
      if (!flashed) {
        flashed = true;
        if (move.jumped && move.jumped.length) view.flashBlocker(move.jumped[0]);
      }
      const off = amp * Math.sin(2 * Math.PI * cycles * t) * (1 - e);
      mesh.position.copy(base).addScaledVector(d, off);
      mesh.updateMatrix();
    }, () => {
      mesh.position.copy(base);
      mesh.updateMatrix();
      cube.busy = false;
    }));
    return items;
  }

  // --- Schritt -----------------------------------------------------------
  if (move.kind === 'STEP') {
    const from = view.worldOf(move.from);
    const to = view.worldOf(move.to);
    items.push(new Tween(mo.step.dur, easeOf(mo.step.ease), (e) => {
      mesh.position.lerpVectors(from, to, e);
      mesh.updateMatrix();
    }, () => { view.commitMove(move); }));
    return items;
  }

  // --- Sprungglieder (JUMP und der Gitteranteil von EXIT) ---------------
  const path = move.path || [move.from];
  const tiltAxis = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let i = 0; i + 1 < path.length; i++) {
    if (i > 0) items.push(mo.chain.delay);
    const a = view.worldOf(path[i]);
    const b = view.worldOf(path[i + 1]);
    const d = view.dirVectorOf(path[i], cube.dir).normalize();
    const axis = arcAxis(a, d, view.center);
    tiltAxis.copy(d).cross(axis);
    if (tiltAxis.lengthSq() < 1e-6) tiltAxis.set(0, 1, 0);
    else tiltAxis.normalize();
    const tilt = tiltAxis.clone();
    const arcH = mo.jump.arc * CELL;
    const last = (i + 2 === path.length) && move.kind === 'JUMP';
    items.push(new Tween(mo.jump.dur, easeOf(mo.jump.ease), (e, t) => {
      mesh.position.lerpVectors(a, b, e);
      mesh.position.addScaledVector(axis, arcH * 4 * t * (1 - t));
      // +-12 Grad Kippen, bei t = 1 wieder exakt 0.
      q.setFromAxisAngle(tilt, THREE.MathUtils.degToRad(12) * Math.sin(Math.PI * t));
      mesh.quaternion.copy(q);
      mesh.updateMatrix();
    }, last ? () => { view.commitMove(move); } : null));
  }

  if (move.kind === 'JUMP') {
    if (!items.length) items.push(new Tween(0, Ease.linear, null, () => { view.commitMove(move); }));
    return items;
  }

  // --- Austritt: Wegfliegen ----------------------------------------------
  const lastCell = path.length ? path[path.length - 1] : move.from;
  const start = view.worldOf(lastCell);
  const dOut = view.dirVectorOf(lastCell, cube.dir).normalize();
  const span = Math.max(board.W, board.H, board.D) * CELL;
  const end = start.clone().addScaledVector(dOut, span * 1.2 + 4 * CELL);
  const spinAxis = new THREE.Vector3(0.37, 0.86, -0.35).normalize();
  const spinTurns = mo.fly.spin;
  const posEase = easeOf(mo.fly.ease);
  const qf = new THREE.Quaternion();

  items.push(new Tween(mo.fly.dur, posEase, (e, t) => {
    if (!cube.fadeMat) { view.detachToFlying(cube); view.acquireFade(cube); }
    mesh.position.lerpVectors(start, end, e);
    const s = 1 - 0.45 * Ease.outCubic(t);
    mesh.scale.setScalar(s);
    qf.setFromAxisAngle(spinAxis, spinTurns * Math.PI * 2 * t);
    mesh.quaternion.copy(qf);
    if (cube.fadeMat) {
      cube.fadeMat.opacity = t < 0.35 ? 1 : Math.max(0, 1 - (t - 0.35) / 0.65);
    }
    mesh.updateMatrix();
  }, () => {
    view.commitMove(move);
  }));

  return items;
}

// --- Eingabe ------------------------------------------------------------

/**
 * Zeiger-Eingabe nach SPEC §8.7: nur Pointer Events, keine click-Events,
 * alle Listener passiv, Tap und Drag sauber getrennt.
 * @param {{canvas:HTMLCanvasElement, camera:THREE.Camera, pickRoot:THREE.Object3D,
 *          onTap:(cell:number, hit:Object)=>void, onHover?:(cell:number|null)=>void,
 *          onLongPress?:(down:boolean)=>void, onActivity?:()=>void, controls?:Object,
 *          thresholds?:{moveMouse?:number, moveTouch?:number, maxMs?:number}}} opts
 */
export function createPointerInput(opts) {
  const canvas = opts.canvas;
  const camera = opts.camera;
  const pickRoot = opts.pickRoot;
  const th = opts.thresholds || {};
  const moveMouse = typeof th.moveMouse === 'number' ? th.moveMouse : 5;
  const moveTouch = typeof th.moveTouch === 'number' ? th.moveTouch : 12;
  const maxMs = typeof th.maxMs === 'number' ? th.maxMs : 600;

  const raycaster = new THREE.Raycaster();
  raycaster.layers.set(LAYER_PICK);
  const ndc = new THREE.Vector2();

  const active = new Map();
  let downId = null;
  let startX = 0, startY = 0, startMs = 0, startCell = -1;
  let moved = false;
  let movedAny = false;
  let multi = false;
  let longPressed = false;
  let longTimer = null;
  let lastCameraChange = -1e9;

  const hoverCapable = (typeof matchMedia === 'function')
    ? matchMedia('(hover:hover) and (pointer:fine)').matches : false;
  let hoverX = 0, hoverY = 0, hoverDirty = false, hoverCell = -1;

  function ndcFrom(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    return ndc;
  }

  function rayAt(x, y) {
    raycaster.setFromCamera(ndcFrom(x, y), camera);
    const hits = raycaster.intersectObjects(pickRoot.children, false);
    return hits.length ? hits[0] : null;
  }

  /**
   * @param {number} x @param {number} y
   * @param {number} [spread] Dicke-Finger-Fallback in CSS-Pixeln
   */
  function pickAt(x, y, spread) {
    const direct = rayAt(x, y);
    if (direct) return direct;
    const s = spread || 0;
    if (s <= 0) return null;
    let best = null;
    const offs = [[-s, 0], [s, 0], [0, -s], [0, s]];
    for (const o of offs) {
      const h = rayAt(x + o[0], y + o[1]);
      if (h && (!best || h.distance < best.distance)) best = h;
    }
    return best;
  }

  function cellOfHit(hit) {
    if (!hit || !hit.object || !hit.object.userData) return -1;
    const c = hit.object.userData.cell;
    return Number.isInteger(c) ? c : -1;
  }

  function activity() { if (opts.onActivity) opts.onActivity(); }

  function clearLongTimer() {
    if (longTimer !== null) { clearTimeout(longTimer); longTimer = null; }
  }

  function onDown(e) {
    active.set(e.pointerId, true);
    activity();
    if (active.size > 1) { multi = true; moved = true; clearLongTimer(); return; }
    downId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    startMs = now();
    moved = false;
    movedAny = false;
    multi = false;
    longPressed = false;
    const spread = e.pointerType === 'mouse' ? 0 : 10;
    startCell = cellOfHit(pickAt(e.clientX, e.clientY, spread));
    clearLongTimer();
    longTimer = setTimeout(() => {
      longTimer = null;
      longPressed = true;
      if (opts.onLongPress) opts.onLongPress(true);
      activity();
    }, maxMs);
  }

  function onMove(e) {
    if (active.size === 0) {
      if (hoverCapable && opts.onHover) { hoverX = e.clientX; hoverY = e.clientY; hoverDirty = true; }
      return;
    }
    if (e.pointerId !== downId) return;
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (dist > 0) movedAny = true;
    const lim = e.pointerType === 'mouse' ? moveMouse : moveTouch;
    // Einmal absolut gegen den Startpunkt gemessen; moved bleibt gesetzt.
    if (!moved && dist > lim) {
      moved = true;
      clearLongTimer();
    }
  }

  function onUp(e) {
    active.delete(e.pointerId);
    activity();
    if (e.pointerId !== downId) return;
    downId = null;
    clearLongTimer();
    const dt = now() - startMs;
    const wasLong = longPressed;
    if (wasLong) {
      longPressed = false;
      if (opts.onLongPress) opts.onLongPress(false);
      return;
    }
    if (moved || multi) return;
    if (dt > maxMs) return;
    // Tap waehrend nachlaufender Kamera-Daempfung verwerfen (SPEC §8.7).
    if (movedAny && (now() - lastCameraChange) < 80) return;
    if (startCell < 0) return;
    const spread = e.pointerType === 'mouse' ? 0 : 10;
    const hit = pickAt(e.clientX, e.clientY, spread);
    const cell = cellOfHit(hit);
    if (cell !== startCell) return;
    if (opts.onTap) opts.onTap(cell, hit);
  }

  function onCancel(e) {
    active.delete(e.pointerId);
    if (e.pointerId !== downId) return;
    downId = null;
    clearLongTimer();
    if (longPressed) {
      longPressed = false;
      if (opts.onLongPress) opts.onLongPress(false);
    }
  }

  function onLeave() {
    if (active.size > 0) return;
    hoverDirty = false;
    if (hoverCell !== -1 && opts.onHover) { hoverCell = -1; opts.onHover(null); }
  }

  function onCameraChange() { lastCameraChange = now(); }

  const P = { passive: true };
  canvas.addEventListener('pointerdown', onDown, P);
  canvas.addEventListener('pointerleave', onLeave, P);
  if (typeof addEventListener === 'function') {
    addEventListener('pointermove', onMove, P);
    addEventListener('pointerup', onUp, P);
    addEventListener('pointercancel', onCancel, P);
  }
  if (opts.controls && typeof opts.controls.addEventListener === 'function') {
    opts.controls.addEventListener('change', onCameraChange);
  }

  return {
    /** Hoechstens ein Hover-Raycast je Bild und nur ohne aktiven Zeiger. */
    update() {
      if (!hoverDirty || !hoverCapable || !opts.onHover) return;
      hoverDirty = false;
      if (active.size > 0) return;
      const cell = cellOfHit(pickAt(hoverX, hoverY, 0));
      if (cell === hoverCell) return;
      hoverCell = cell;
      opts.onHover(cell < 0 ? null : cell);
    },
    pickAt,
    dispose() {
      clearLongTimer();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      if (typeof removeEventListener === 'function') {
        removeEventListener('pointermove', onMove);
        removeEventListener('pointerup', onUp);
        removeEventListener('pointercancel', onCancel);
      }
      if (opts.controls && typeof opts.controls.removeEventListener === 'function') {
        opts.controls.removeEventListener('change', onCameraChange);
      }
      active.clear();
    }
  };
}
