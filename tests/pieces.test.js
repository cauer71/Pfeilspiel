// SPEC §1.2 R0 (Rutschen) und §1.3 RF-13 (zweizellige Steine).
//
// Diese Datei deckt genau die beiden Erweiterungen ab, die RULE_VERSION 2 ausmachen:
// den Austritt bei freier Bahn und die 2x1-Steine, die sich als starre Einheit bewegen.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoard, cellIndexOf, emptyState, createState, cloneState,
  addCube, dropCube, resolveMove, applyMove, revertMove,
  cellsOfCube, sizeOfCube,
  OUT, EMPTY, EXT_NONE, RULE_VERSION
} from '../public/src/game.js';
import { generateLevel, verifyLevel, levelSpecFor } from '../public/src/levels.js';

const vol = (W, H, D) => buildBoard({ mode: 'VOLUMEN', W, H, D });
const fas = (W, H, D) => buildBoard({ mode: 'FASSADE', W, H, D });
const V = (b, x, y, z) => cellIndexOf(b, `V:${x}:${y}:${z}`);

const PX = 0, NX = 1, PY = 2, NY = 3, PZ = 4;

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

// --- R0: Rutschen --------------------------------------------------------

test('R0: freie Bahn traegt den Stein in EINEM Zug aus dem Turm', () => {
  assert.equal(RULE_VERSION, 2);
  const b = vol(6, 2, 3);
  const st = emptyState(b, 4, 'ABBAU');
  addCube(st, V(b, 0, 0, 0), PX);

  const m = resolveMove(b, st, V(b, 0, 0, 0));
  assert.equal(m.kind, 'EXIT');
  assert.equal(m.jumps, 0);
  assert.deepEqual(m.jumped, []);
  // path nennt jede durchlaufene Zelle, die Startzelle eingeschlossen.
  assert.deepEqual(m.path, [0, 1, 2, 3, 4, 5].map((x) => V(b, x, 0, 0)));

  applyMove(st, m);
  assert.equal(st.aliveCount, 0);
});

test('R0 hat Vorrang vor R1: nur bei verstellter Bahn wird geschritten', () => {
  const b = vol(6, 2, 3);
  for (const blocker of [1, 2, 3, 4, 5]) {
    const st = emptyState(b, 4, 'ABBAU');
    addCube(st, V(b, 0, 0, 0), PX);
    addCube(st, V(b, blocker, 0, 0), NX);
    const m = resolveMove(b, st, V(b, 0, 0, 0));
    if (blocker === 1) {
      // Nachbar besetzt: das ist ein Sprungfall, kein Rutschfall.
      assert.equal(m.kind === 'JUMP' || m.kind === 'EXIT' || m.kind === 'INVALID', true);
    } else {
      assert.equal(m.kind, 'STEP', `Blocker bei x=${blocker}`);
      assert.equal(m.to, V(b, 1, 0, 0));
    }
  }
});

test('R0 greift nicht hinter einem Sprung (RF-6 bleibt in Kraft)', () => {
  const b = vol(6, 2, 3);
  const st = emptyState(b, 4, 'ABBAU');
  addCube(st, V(b, 0, 0, 0), PX);
  addCube(st, V(b, 1, 0, 0), NX);   // Traeger
  const m = resolveMove(b, st, V(b, 0, 0, 0));
  // Sprung auf x=2; dahinter ist alles frei, es wird aber NICHT weitergerutscht.
  assert.equal(m.kind, 'JUMP');
  assert.equal(m.jumps, 1);
  assert.equal(m.to, V(b, 2, 0, 0));
});

// --- 2x1-Steine: Grundlagen ---------------------------------------------

test('Ein 2x1-Stein belegt beide Zellen und meldet sie', () => {
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
  // Zweite Zelle ausserhalb
  assert.throws(() => addCube(st, V(b, 4, 0, 0), PY, false, PX), RangeError);
});

test('createState ist nachsichtig: ein unbrauchbarer 2x1-Eintrag wird uebergangen', () => {
  const b = vol(4, 3, 3);
  // Ausleger fuehrt aus dem Gitter: der Stein entsteht als bereits ausgeschieden.
  const st = createState(b, [{ cell: V(b, 3, 0, 0), dir: PY, ext: PX }], 'ABBAU');
  assert.equal(st.aliveCount, 0);
  assert.equal(st.occ[V(b, 3, 0, 0)], EMPTY);

  // Zwei Steine auf derselben Ankerzelle: createState bleibt bewusst nachsichtig und
  // laesst den spaeteren die Zelle verdecken, statt zu werfen (SPEC §6.8). Die Abwehr
  // sitzt in der Strukturpruefung, die eine doppelt belegte Zelle ablehnt.
  const doppelt = {
    v: 1, ruleVersion: RULE_VERSION, genVersion: 2,
    seed: 1, attempt: 0, mode: 'VOLUMEN', goal: 'ABBAU',
    dims: { W: 4, H: 3, D: 3 }, levelCode: 'V-A-4x3x3-0-00000001',
    cubes: [
      { cell: V(b, 0, 0, 0), dir: PY, target: false },
      { cell: V(b, 0, 0, 0), dir: PY, target: false, ext: PX }
    ],
    targetId: null, witness: [], par: 0, stars: [0, 0, 0],
    metrics: { density: 0, chainShare: 0, maxChain: 0, mobility: 0, naivePerPar: 0, trivialExit: 0 }
  };
  const ver = verifyLevel(doppelt);
  assert.equal(ver.ok, false);
  assert.ok(String(ver.reason).startsWith('cell@') || String(ver.reason).startsWith('ext@'),
    'die doppelt belegte Zelle wird benannt: ' + ver.reason);
});

// --- 2x1-Steine: Bewegung ------------------------------------------------

test('Ein 2x1-Stein bewegt sich laengs seiner Achse, ohne sich selbst zu blockieren', () => {
  const b = vol(6, 2, 3);
  const st = emptyState(b, 4, 'ABBAU');
  addCube(st, V(b, 0, 0, 0), PX, false, PX);   // belegt x=0 und x=1, zeigt nach +X

  const frei = resolveMove(b, st, V(b, 0, 0, 0));
  assert.equal(frei.kind, 'EXIT', 'freie Bahn: der Stein rutscht ganz heraus');

  const st2 = emptyState(b, 4, 'ABBAU');
  addCube(st2, V(b, 0, 0, 0), PX, false, PX);
  addCube(st2, V(b, 4, 0, 0), NX);             // Blocker weiter vorn
  const m = resolveMove(b, st2, V(b, 0, 0, 0));
  assert.equal(m.kind, 'STEP');
  assert.equal(m.to, V(b, 1, 0, 0), 'der Anker rueckt ein Feld vor');

  applyMove(st2, m);
  assert.equal(st2.occ[V(b, 0, 0, 0)], EMPTY);
  assert.equal(st2.occ[V(b, 1, 0, 0)], 0);
  assert.equal(st2.occ[V(b, 2, 0, 0)], 0, 'die zweite Zelle wandert mit');
});

test('Ein 2x1-Stein quer zur Achse braucht BEIDE Zielfelder frei', () => {
  const b = vol(6, 4, 3);

  // Fall 1: eine der beiden Zielzellen ist besetzt -> kein Schritt, sondern Sprung.
  // Dahinter steht ein Riegel ueber beide Zeilen, damit die Kette dort endet.
  const st = emptyState(b, 8, 'ABBAU');
  addCube(st, V(b, 0, 0, 0), PX, false, PY);   // belegt (0,0,0) und (0,1,0), zeigt nach +X
  addCube(st, V(b, 1, 1, 0), NX);              // blockiert nur die obere Zeile
  addCube(st, V(b, 3, 0, 0), NX);              // Riegel, untere Zeile
  addCube(st, V(b, 3, 1, 0), NX);              // Riegel, obere Zeile
  addCube(st, V(b, 4, 0, 0), NX);              // dahinter belegt: die Kette endet

  const m = resolveMove(b, st, V(b, 0, 0, 0));
  assert.equal(m.kind, 'JUMP');
  assert.equal(m.to, V(b, 2, 0, 0), 'Sprung um genau zwei Felder');
  assert.deepEqual(m.jumped, [V(b, 1, 1, 0)]);

  // Fall 2: beide Zielzellen besetzt und dahinter ebenfalls -> ungueltig.
  const st2 = emptyState(b, 8, 'ABBAU');
  addCube(st2, V(b, 0, 0, 0), PX, false, PY);
  addCube(st2, V(b, 1, 0, 0), NX);
  addCube(st2, V(b, 1, 1, 0), NX);
  addCube(st2, V(b, 2, 0, 0), NX);
  const m2 = resolveMove(b, st2, V(b, 0, 0, 0));
  assert.equal(m2.kind, 'INVALID');
  assert.equal(m2.reason, 'BLOCKED');

  // Fall 3: beide Zielzellen frei, Bahn dahinter verstellt -> Schritt, beide Zellen wandern.
  const st3 = emptyState(b, 8, 'ABBAU');
  addCube(st3, V(b, 0, 0, 0), PX, false, PY);
  addCube(st3, V(b, 2, 0, 0), NX);
  const m3 = resolveMove(b, st3, V(b, 0, 0, 0));
  assert.equal(m3.kind, 'STEP');
  applyMove(st3, m3);
  assert.equal(st3.occ[V(b, 1, 0, 0)], 0);
  assert.equal(st3.occ[V(b, 1, 1, 0)], 0);
  assert.equal(st3.occ[V(b, 0, 0, 0)], EMPTY);
  assert.equal(st3.occ[V(b, 0, 1, 0)], EMPTY);
});

test('RF-13: ein 2x1-Stein bleibt starr — Ausleger und Nachbarschaft ueberleben jeden Zug', () => {
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
      if (st.alive[id] && extVor !== EXT_NONE) {
        const zellen = cellsOfCube(st, id);
        assert.equal(zellen.length, 2, 'der Stein bleibt zweizellig');
        assert.equal(b.step[zellen[0] * 6 + extVor], zellen[1],
          'die beiden Zellen bleiben benachbart');
      }
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
    gesamt++;
    if (level.cubes.some((c) => c.ext !== undefined)) mitZwei++;

    // Der Zeuge nennt stets den Anker; verifyLevel prueft das ueber move.from.
    assert.equal(ver.checked, level.witness.length);
  }
  assert.ok(mitZwei >= gesamt - 1, `zu wenige Level mit 2x1-Steinen: ${mitZwei}/${gesamt}`);
});

test('pruefeStruktur lehnt einen 2x1-Stein mit falschem Anker ab', () => {
  const level = generateLevel(levelSpecFor(15));
  const stein = level.cubes.find((c) => c.ext !== undefined);
  assert.ok(stein, 'Testvoraussetzung: das Level enthaelt einen 2x1-Stein');

  const board = buildBoard({ mode: level.mode, W: level.dims.W, H: level.dims.H, D: level.dims.D });
  const zweite = board.step[stein.cell * 6 + stein.ext];

  // Anker auf die groessere Zelle drehen: dieselbe Lage, aber nicht mehr kanonisch.
  const gedreht = JSON.parse(JSON.stringify(level));
  const k = gedreht.cubes.indexOf(gedreht.cubes.find((c) => c.cell === stein.cell));
  gedreht.cubes[k] = { cell: zweite, dir: stein.dir, target: !!stein.target, ext: board.opp[stein.ext] };
  assert.equal(verifyLevel(gedreht).ok, false);
});
