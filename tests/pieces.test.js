// SPEC §1.2 (Regelversion 3) und §1.3 RF-7 — zweizellige Steine.
//
// Die Regel kennt nur noch EXIT und INVALID. Diese Datei deckt ab, dass ein 2x1-Stein
// sich dabei wie EIN Koerper verhaelt: er belegt zwei Zellen, braucht seine ganze Bahn
// frei, blockiert zwei Zellen und bleibt in jeder Lage starr.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoard, cellIndexOf, emptyState, createState, cloneState,
  addCube, dropCube, resolveMove, applyMove, revertMove,
  cellsOfCube, sizeOfCube, hasAnyMove,
  OUT, EMPTY, EXT_NONE, RULE_VERSION
} from '../public/src/game.js';
import { generateLevel, verifyLevel, levelSpecFor } from '../public/src/levels.js';

const vol = (W, H, D) => buildBoard({ mode: 'VOLUMEN', W, H, D });
const fas = (W, H, D) => buildBoard({ mode: 'FASSADE', W, H, D });
const V = (b, x, y, z) => cellIndexOf(b, `V:${x}:${y}:${z}`);

const PX = 0, NX = 1, PY = 2, NY = 3;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Grundlagen ----------------------------------------------------------

test('Ein 2x1-Stein belegt beide Zellen und zaehlt als ein Stein', () => {
  assert.equal(RULE_VERSION, 3);
  const b = vol(5, 3, 3);
  const st = emptyState(b, 4, 'ABBAU');
  const id = addCube(st, V(b, 1, 1, 1), PX, false, PY);

  assert.equal(sizeOfCube(st, id), 2);
  assert.equal(st.occ[V(b, 1, 1, 1)], id);
  assert.equal(st.occ[V(b, 1, 2, 1)], id);
  assert.deepEqual(cellsOfCube(st, id).slice().sort((x, y) => x - y),
    [V(b, 1, 1, 1), V(b, 1, 2, 1)].sort((x, y) => x - y));
  assert.equal(st.aliveCount, 1, 'ein Stein, nicht zwei');

  dropCube(st, id);
  assert.equal(st.occ[V(b, 1, 1, 1)], EMPTY);
  assert.equal(st.occ[V(b, 1, 2, 1)], EMPTY, 'dropCube raeumt BEIDE Zellen');
});

test('addCube lehnt einen 2x1-Stein ab, dessen zweite Zelle nicht frei ist', () => {
  const b = vol(5, 3, 3);
  const st = emptyState(b, 4, 'ABBAU');
  addCube(st, V(b, 1, 2, 1), PX);
  assert.throws(() => addCube(st, V(b, 1, 1, 1), PX, false, PY), RangeError);
  assert.throws(() => addCube(st, V(b, 4, 0, 0), PY, false, PX), RangeError);
});

test('createState uebergeht einen 2x1-Eintrag, dessen Ausleger aus dem Gitter fuehrt', () => {
  const b = vol(4, 3, 3);
  const st = createState(b, [{ cell: V(b, 3, 0, 0), dir: PY, ext: PX }], 'ABBAU');
  assert.equal(st.aliveCount, 0);
  assert.equal(st.occ[V(b, 3, 0, 0)], EMPTY);
});

test('verifyLevel lehnt eine doppelt belegte Zelle ab', () => {
  const b = vol(4, 3, 3);
  const doppelt = {
    v: 1, ruleVersion: RULE_VERSION, genVersion: 3,
    seed: 1, attempt: 0, mode: 'VOLUMEN', goal: 'ABBAU',
    dims: { W: 4, H: 3, D: 3 }, levelCode: 'V-A-4x3x3-0-00000001',
    cubes: [
      { cell: V(b, 0, 0, 0), dir: PY, target: false },
      { cell: V(b, 0, 0, 0), dir: PY, target: false, ext: PX }
    ],
    targetId: null, witness: [], par: 0, stars: [0, 0, 0],
    metrics: { density: 0, mobility: 0, naivePerPar: 0 }
  };
  const ver = verifyLevel(doppelt);
  assert.equal(ver.ok, false);
  assert.ok(String(ver.reason).startsWith('cell@') || String(ver.reason).startsWith('ext@'),
    'die doppelt belegte Zelle wird benannt: ' + ver.reason);
});

// --- Bewegung ------------------------------------------------------------

test('Laengs der eigenen Achse blockiert sich ein 2x1-Stein nicht selbst', () => {
  const b = vol(6, 2, 3);
  const st = emptyState(b, 4, 'ABBAU');
  addCube(st, V(b, 0, 0, 0), PX, false, PX);   // belegt x=0 und x=1, zeigt nach +X

  const m = resolveMove(b, st, V(b, 0, 0, 0));
  assert.equal(m.kind, 'EXIT', 'die eigene vordere Zelle darf nicht als Blocker zaehlen');
  assert.deepEqual(m.blocker, []);

  applyMove(st, m);
  assert.equal(st.occ[V(b, 0, 0, 0)], EMPTY);
  assert.equal(st.occ[V(b, 1, 0, 0)], EMPTY, 'beide Zellen werden geraeumt');
  assert.equal(st.aliveCount, 0);
});

test('Ein 2x1-Stein braucht seine GANZE Bahn frei - auf beiden Spuren', () => {
  const b = vol(6, 4, 3);

  // quer zur Achse: der Stein liegt uebereinander und zieht nach +X.
  // Ein Blocker allein in der oberen Spur reicht, um ihn festzuhalten.
  for (const spur of [0, 1]) {
    const st = emptyState(b, 6, 'ABBAU');
    addCube(st, V(b, 0, 0, 0), PX, false, PY);
    addCube(st, V(b, 3, spur, 0), NX);
    const m = resolveMove(b, st, V(b, 0, 0, 0));
    assert.equal(m.kind, 'INVALID', `Blocker in Spur ${spur}`);
    assert.deepEqual(m.blocker, [V(b, 3, spur, 0)]);
  }

  // Beide Spuren frei -> der Stein geht hinaus.
  const frei = emptyState(b, 6, 'ABBAU');
  addCube(frei, V(b, 0, 0, 0), PX, false, PY);
  assert.equal(resolveMove(b, frei, V(b, 0, 0, 0)).kind, 'EXIT');
});

test('Ein 2x1-Stein blockiert zwei Zellen', () => {
  const b = vol(6, 4, 3);
  const st = emptyState(b, 6, 'ABBAU');
  addCube(st, V(b, 3, 0, 0), PY, false, PY);   // Riegel ueber (3,0,0) und (3,1,0)
  addCube(st, V(b, 0, 0, 0), PX);              // untere Spur
  addCube(st, V(b, 0, 1, 0), PX);              // obere Spur

  assert.equal(resolveMove(b, st, V(b, 0, 0, 0)).kind, 'INVALID');
  assert.equal(resolveMove(b, st, V(b, 0, 1, 0)).kind, 'INVALID');

  // Der Riegel selbst zeigt nach oben und ist frei.
  const weg = resolveMove(b, st, V(b, 3, 0, 0));
  assert.equal(weg.kind, 'EXIT');
  applyMove(st, weg);
  assert.equal(resolveMove(b, st, V(b, 0, 0, 0)).kind, 'EXIT');
  assert.equal(resolveMove(b, st, V(b, 0, 1, 0)).kind, 'EXIT');
});

test('Der Stein laesst sich von jeder seiner beiden Zellen aus antippen', () => {
  const b = vol(6, 4, 3);
  const st = emptyState(b, 4, 'ABBAU');
  const id = addCube(st, V(b, 0, 0, 0), PX, false, PY);
  const a = resolveMove(b, st, V(b, 0, 0, 0));
  const c = resolveMove(b, st, V(b, 0, 1, 0));
  assert.equal(a.kind, 'EXIT');
  assert.equal(c.kind, 'EXIT');
  assert.equal(a.cubeId, id);
  assert.equal(c.cubeId, id);
  assert.equal(a.from, c.from, 'beide Tipps melden dieselbe Ankerzelle');
});

test('RF-7: ein 2x1-Stein bleibt starr — der Ausleger aendert sich nie', () => {
  const b = vol(6, 4, 4);
  const rng = mulberry32(20260830);
  let geprueft = 0;

  for (let runde = 0; runde < 300; runde++) {
    const st = emptyState(b, 24, 'ABBAU');
    const gesetzt = [];
    for (let k = 0; k < 10; k++) {
      const c = Math.floor(rng() * b.C);
      const d = Math.floor(rng() * 6);
      const e = rng() < 0.5 ? Math.floor(rng() * 6) : EXT_NONE;
      if (st.occ[c] !== EMPTY) continue;
      if (e !== EXT_NONE) {
        const z = b.step[c * 6 + e];
        if (z === OUT || st.occ[z] !== EMPTY) continue;
      }
      gesetzt.push(addCube(st, c, d, false, e));
    }

    for (const id of gesetzt) {
      if (!st.alive[id]) continue;
      const extVor = st.extOf[id];
      const m = resolveMove(b, st, st.cellOf[id]);
      if (m.kind === 'INVALID') continue;
      applyMove(st, m);
      geprueft++;
      assert.equal(st.extOf[id], extVor, 'der Ausleger aendert sich nie');
      assert.equal(st.alive[id], 0, 'ein gueltiger Zug traegt den Stein hinaus');
    }
  }
  assert.ok(geprueft > 200, `zu wenige Zuege geprueft: ${geprueft}`);
});

test('revertMove ist auch fuer 2x1-Steine exakt invers', () => {
  const b = vol(5, 4, 4);
  const rng = mulberry32(4711);
  let geprueft = 0;

  for (let runde = 0; runde < 400; runde++) {
    const st = emptyState(b, 20, 'ABBAU');
    for (let k = 0; k < 8; k++) {
      const c = Math.floor(rng() * b.C);
      const d = Math.floor(rng() * 6);
      const e = rng() < 0.6 ? Math.floor(rng() * 6) : EXT_NONE;
      if (st.occ[c] !== EMPTY) continue;
      if (e !== EXT_NONE) {
        const z = b.step[c * 6 + e];
        if (z === OUT || st.occ[z] !== EMPTY) continue;
      }
      addCube(st, c, d, false, e);
    }

    for (let c = 0; c < b.C; c++) {
      if (st.occ[c] === EMPTY) continue;
      const vor = cloneState(st);
      const m = resolveMove(b, st, c);
      if (m.kind === 'INVALID') continue;
      applyMove(st, m);
      revertMove(st, m);
      geprueft++;
      for (let i = 0; i < b.C; i++)
        assert.equal(st.occ[i], vor.occ[i], `occ[${i}] nach revertMove`);
      for (let id = 0; id < st.cubeCount; id++) {
        assert.equal(st.cellOf[id], vor.cellOf[id]);
        assert.equal(st.alive[id], vor.alive[id]);
        assert.equal(st.extOf[id], vor.extOf[id]);
      }
      assert.equal(st.aliveCount, vor.aliveCount);
    }
  }
  assert.ok(geprueft > 500, `zu wenige Zuege geprueft: ${geprueft}`);
});

// --- Generator -----------------------------------------------------------

test('FASSADE: ein 2x1-Stein liegt nie ueber zwei Waenden', () => {
  const b = fas(4, 5, 4);
  const spec = Object.assign(levelSpecFor(15), { mode: 'FASSADE', W: 4, H: 5, D: 4, seed: 99 });
  const level = generateLevel(spec);
  assert.equal(verifyLevel(level).ok, true);

  let zwei = 0;
  for (const cu of level.cubes) {
    if (cu.ext === undefined) continue;
    zwei++;
    const zweite = b.step[cu.cell * 6 + cu.ext];
    assert.notEqual(zweite, OUT, 'die zweite Zelle liegt im Gitter');
    assert.equal(b.faceOf[cu.cell], b.faceOf[zweite], 'beide Zellen auf derselben Wand');
    assert.ok(zweite > cu.cell, 'der Anker ist die kleinere Zelle');
  }
  assert.ok(zwei > 0, 'das Level enthaelt ueberhaupt 2x1-Steine');
});

test('Der Generator erzeugt 2x1-Steine und liefert nur verifizierte Level aus', () => {
  let mitZwei = 0, gesamt = 0;
  for (const n of [5, 10, 15, 20, 25, 35]) {
    const level = generateLevel(levelSpecFor(n));
    const ver = verifyLevel(level);
    assert.equal(ver.ok, true, `Level ${n}: ${ver.reason}`);
    assert.equal(ver.checked, level.witness.length);
    gesamt++;
    if (level.cubes.some((c) => c.ext !== undefined)) mitZwei++;
  }
  assert.ok(mitZwei >= gesamt - 1, `zu wenige Level mit 2x1-Steinen: ${mitZwei}/${gesamt}`);
});

test('pruefeStruktur lehnt einen 2x1-Stein mit falschem Anker ab', () => {
  const level = generateLevel(levelSpecFor(15));
  const stein = level.cubes.find((c) => c.ext !== undefined);
  assert.ok(stein, 'Testvoraussetzung: das Level enthaelt einen 2x1-Stein');

  const board = buildBoard({ mode: level.mode, W: level.dims.W, H: level.dims.H, D: level.dims.D });
  const zweite = board.step[stein.cell * 6 + stein.ext];

  const gedreht = JSON.parse(JSON.stringify(level));
  const k = gedreht.cubes.findIndex((c) => c.cell === stein.cell);
  gedreht.cubes[k] = { cell: zweite, dir: stein.dir, target: !!stein.target, ext: board.opp[stein.ext] };
  assert.equal(verifyLevel(gedreht).ok, false);
});
