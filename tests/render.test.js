// tests/render.test.js — Zeigerlogik der Renderschicht (SPEC §8.7).
//
// Geprueft wird ausschliesslich createPointerInput: Tap gegen Drag und der
// Verwurf eines Taps waehrend nachlaufender Kamera-Daempfung. Three.js wird
// dafuer nicht gebraucht, wohl aber von render.js importiert; laesst sich das
// Modul nicht aufloesen (Installation ohne three), meldet sich diese Datei als
// uebersprungen statt rot.

import test from 'node:test';
import assert from 'node:assert/strict';

let render = null;
let THREE = null;
try {
  render = await import('../public/src/render.js');
  THREE = await import('three');
} catch {
  render = null;
  THREE = null;
}
const skip = (render && THREE) ? false : 'three nicht aufloesbar';

/** Winziger Ereignisverteiler fuer Canvas, Fenster und OrbitControls-Attrappe. */
function verteiler() {
  const map = new Map();
  return {
    addEventListener(typ, fn) {
      if (!map.has(typ)) map.set(typ, new Set());
      map.get(typ).add(fn);
    },
    removeEventListener(typ, fn) {
      const s = map.get(typ);
      if (s) s.delete(fn);
    },
    feuere(typ, ev) {
      const s = map.get(typ);
      if (s) for (const fn of [...s]) fn(ev);
    }
  };
}

/**
 * Baut eine Zeigereingabe ueber einer Attrappe: eine einzige antippbare Zelle
 * (Index 0), die jeder Strahl trifft.
 *
 * `verschachtelt` legt die Zelle in eine Group unter pickRoot, so wie ein 2x1-Stein
 * dort liegt (SPEC §8.5.1). Ohne rekursives Raycasting bleibt sie dann unerreichbar.
 * @param {boolean} [verschachtelt]
 * @returns {{taps:number[], down:Function, move:Function, up:Function,
 *            kamera:Function, controls:Object, dispose:Function}}
 */
function baueEingabe(verschachtelt) {
  const canvas = verteiler();
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  const fenster = verteiler();
  const controls = verteiler();
  controls.enabled = true;

  const altAdd = globalThis.addEventListener;
  const altRemove = globalThis.removeEventListener;
  globalThis.addEventListener = (t, f) => fenster.addEventListener(t, f);
  globalThis.removeEventListener = (t, f) => fenster.removeEventListener(t, f);

  // Ein echtes Object3D, damit der Strahl den Baum so durchlaeuft wie im Spiel.
  const zelle = new THREE.Object3D();
  zelle.userData.cell = 0;
  zelle.layers.enable(render.LAYER_PICK);   // wie belegeZellen es im Spiel tut
  zelle.raycast = (_raycaster, intersects) => { intersects.push({ distance: 1, object: zelle }); };

  const wurzel = new THREE.Group();
  if (verschachtelt) {
    const traeger = new THREE.Group();     // hat selbst keine Geometrie
    traeger.userData.cell = 0;
    traeger.add(zelle);
    wurzel.add(traeger);
  } else {
    wurzel.add(zelle);
  }

  const taps = [];
  let input;
  try {
    input = render.createPointerInput({
      canvas,
      camera: render.createCamera(800 / 600),
      pickRoot: wurzel,
      controls,
      onTap: (cell) => taps.push(cell)
    });
  } finally {
    globalThis.addEventListener = altAdd;
    globalThis.removeEventListener = altRemove;
    if (altAdd === undefined) delete globalThis.addEventListener;
    if (altRemove === undefined) delete globalThis.removeEventListener;
  }

  const ev = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, pointerType: 'touch' });
  return {
    taps,
    controls,
    down: (x, y) => canvas.feuere('pointerdown', ev(x, y)),
    move: (x, y) => fenster.feuere('pointermove', ev(x, y)),
    up: (x, y) => fenster.feuere('pointerup', ev(x, y)),
    /** Ein change-Ereignis von OrbitControls, wie es je Bild faellt. */
    kamera: () => controls.feuere('change', {}),
    dispose: () => input.dispose()
  };
}

test('sauberer Tap ohne Kamerabewegung loest onTap aus', { skip }, () => {
  const e = baueEingabe();
  e.down(400, 300);
  e.up(400, 300);
  assert.deepEqual(e.taps, [0]);
  e.dispose();
});

test('Wischen ueber die Touch-Schwelle loest keinen Tap aus', { skip }, () => {
  const e = baueEingabe();
  e.down(400, 300);
  e.move(430, 300);
  e.up(430, 300);
  assert.deepEqual(e.taps, []);
  e.dispose();
});

test('Fingerzittern unter der Zittertoleranz ueberlebt den Daempfungsnachlauf', { skip }, () => {
  // Turm gedreht, losgelassen, sofort getippt: OrbitControls meldet waehrend des
  // gesamten Nachlaufs Aenderungen. Ein Tap mit 2 px Zittern ist gewollt.
  const e = baueEingabe();
  e.kamera();
  e.down(400, 300);
  e.kamera();
  e.move(401, 301);
  e.kamera();
  e.up(401, 301);
  assert.deepEqual(e.taps, [0], 'Tap wurde still verworfen');
  e.dispose();
});

test('Tap waehrend eines programmatischen Refits wird nicht verworfen', { skip }, () => {
  // fitCamera schaltet controls.enabled ab und bewegt die Kamera von aussen;
  // controls.update() meldet das als Aenderung. Das ist keine Nutzergeste.
  const e = baueEingabe();
  e.controls.enabled = false;
  e.down(400, 300);
  e.kamera();
  e.move(408, 300);          // ueber der Zittertoleranz, unter der Tap-Schwelle
  e.kamera();
  e.up(408, 300);
  assert.deepEqual(e.taps, [0], 'Tap im Refit wurde still verworfen');
  e.dispose();
});

test('bewusstes Schieben unter der Tap-Schwelle waehrend Kamerabewegung wird verworfen', { skip }, () => {
  const e = baueEingabe();
  e.down(400, 300);
  e.move(409, 300);          // > halbe Schwelle, < 12 px
  e.kamera();
  e.up(409, 300);
  assert.deepEqual(e.taps, [], 'SPEC-§8.7-Verwurf greift nicht mehr');
  e.dispose();
});

test('ohne Kamerabewegung greift der Verwurf auch bei Schieben unter der Schwelle nicht', { skip }, () => {
  const e = baueEingabe();
  e.down(400, 300);
  e.move(409, 300);
  e.up(409, 300);
  assert.deepEqual(e.taps, [0]);
  e.dispose();
});

test('ein Stein in einer Group ist antippbar (2x1-Steine)', { skip }, () => {
  // Befund: `intersectObjects(pickRoot.children, false)` prueft nur die direkten Kinder.
  // Ein 1x1-Stein ist ein Mesh und wurde getroffen, ein 2x1-Stein ist aber eine Group
  // aus drei Meshes — eine Group hat keine Geometrie, also traf der Strahl sie NIE und
  // die langen Steine liessen sich ueberhaupt nicht entfernen. Der Strahl muss rekursiv
  // laufen (SPEC §8.7).
  const e = baueEingabe(true);
  e.down(400, 300);
  e.up(400, 300);
  assert.deepEqual(e.taps, [0], 'Tap auf einen verschachtelten Stein kam nicht an');
  e.dispose();
});
