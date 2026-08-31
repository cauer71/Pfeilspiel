// SPEC §10.2 — Zugregel (RULE_VERSION 3).
//
// Die Regel kennt nur noch zwei Ausgaenge: der Stein verlaesst den Turm (EXIT) oder es
// passiert nichts (INVALID). Weder Schritt noch Sprung: ist die Bahn in Pfeilrichtung
// irgendwo verstellt, bleibt der Stein stehen.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoard, cellIndexOf, latticeOf, validDirs, depthOf,
  createState, emptyState, cloneState, addCube, dropCube, isFree,
  resolveMove, applyMove, revertMove, legalCells, mobility, hasAnyMove, isSolved,
  createSession, tap, undo, restart, toRunLog,
  OUT, EMPTY, EXT_NONE, RULE_VERSION
} from '../public/src/game.js';

// --- Werkzeug -----------------------------------------------------------

const vol = (W, H, D) => buildBoard({ mode: 'VOLUMEN', W, H, D });
const V = (b, x, y, z) => cellIndexOf(b, `V:${x}:${y}:${z}`);

/** RNG aus SPEC §11 — die Tests bleiben damit deterministisch. */
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

function snap(state) {
  return {
    occ: Array.from(state.occ),
    cellOf: Array.from(state.cellOf),
    alive: Array.from(state.alive),
    aliveCount: state.aliveCount,
    cubeCount: state.cubeCount,
    targetId: state.targetId
  };
}

// Reihe y=0, z=0 eines VOLUMEN-Bretts: bequeme Achse fuer alle Faelle.
const B3 = vol(3, 2, 3), B4 = vol(4, 2, 3), B5 = vol(5, 2, 3), B7 = vol(7, 2, 3), B9 = vol(9, 2, 3);
const X = (b, x) => V(b, x, 0, 0);
const PX = 0;   // Richtung +X
const NX = 1, PY = 2, NY = 3;

// --- RF-1 bis RF-6 als Tabelle -----------------------------------------

const FIXTURES = [
  {
    name: 'RF-1: der Stein steht am Rand und zeigt hinaus -> EXIT ohne Zwischenstation',
    board: B5,
    cubes: b => [{ cell: X(b, 4), dir: PX }],
    tap: b => X(b, 4),
    move: b => ({ kind: 'EXIT', cubeId: 0, from: X(b, 4), to: OUT, path: [X(b, 4)], blocker: [] })
  },
  {
    name: 'RF-2: die ganze Bahn ist frei -> EXIT, path nennt jede durchlaufene Zelle',
    board: B5,
    cubes: b => [{ cell: X(b, 0), dir: PX }],
    tap: b => X(b, 0),
    move: b => ({
      kind: 'EXIT', cubeId: 0, from: X(b, 0), to: OUT,
      path: [X(b, 0), X(b, 1), X(b, 2), X(b, 3), X(b, 4)], blocker: []
    })
  },
  {
    name: 'RF-3a: der direkte Nachbar ist besetzt -> INVALID, kein Sprung',
    board: B5,
    cubes: b => [{ cell: X(b, 3), dir: PX }, { cell: X(b, 4), dir: PX }],
    tap: b => X(b, 3),
    move: b => ({
      kind: 'INVALID', reason: 'BLOCKED', cubeId: 0, from: X(b, 3), to: OUT,
      path: [X(b, 3)], blocker: [X(b, 4)]
    })
  },
  {
    name: 'RF-3b: der Blocker steht weiter vorn -> INVALID, kein Schritt',
    board: B5,
    cubes: b => [{ cell: X(b, 0), dir: PX }, { cell: X(b, 3), dir: PX }],
    tap: b => X(b, 0),
    move: b => ({
      kind: 'INVALID', reason: 'BLOCKED', cubeId: 0, from: X(b, 0), to: OUT,
      path: [X(b, 0)], blocker: [X(b, 3)]
    })
  },
  {
    name: 'RF-4: leere Zelle -> INVALID/DEAD',
    board: B5,
    cubes: b => [{ cell: X(b, 0), dir: PX }],
    tap: b => X(b, 2),
    move: b => ({
      kind: 'INVALID', reason: 'DEAD', cubeId: EMPTY, from: X(b, 2), to: OUT,
      path: [X(b, 2)], blocker: []
    })
  }
];

test('RF-Fixtures aus §1.3 liefern exakt den spezifizierten Move', () => {
  for (const fx of FIXTURES) {
    const b = fx.board;
    const state = createState(b, fx.cubes(b), 'ABBAU');
    const m = resolveMove(b, state, fx.tap(b));
    const soll = fx.move(b);
    for (const k of Object.keys(soll)) assert.deepEqual(m[k], soll[k], `${fx.name} -> ${k}`);
  }
});

test('Blockiert bleibt blockiert: kein Stein verlaesst den Turm ueber einen Blocker hinweg', () => {
  assert.equal(RULE_VERSION, 3);
  const b = B9;
  // Ein Blocker an JEDER Position der Bahn muss den Zug verhindern - egal wie weit weg.
  for (let blocker = 1; blocker <= 8; blocker++) {
    const state = createState(b, [{ cell: X(b, 0), dir: PX }, { cell: X(b, blocker), dir: NX }], 'ABBAU');
    const m = resolveMove(b, state, X(b, 0));
    assert.equal(m.kind, 'INVALID', `Blocker bei x=${blocker}`);
    assert.equal(m.reason, 'BLOCKED');
    assert.deepEqual(m.blocker, [X(b, blocker)], 'der Blockierer wird benannt');
  }
  // Ohne Blocker geht derselbe Stein hinaus.
  const frei = createState(b, [{ cell: X(b, 0), dir: PX }], 'ABBAU');
  assert.equal(resolveMove(b, frei, X(b, 0)).kind, 'EXIT');
});

test('Ein Blocker verschwindet nicht durch andere Zuege: erst raeumen, dann geht es', () => {
  const b = B5;
  const state = createState(b, [{ cell: X(b, 0), dir: PX }, { cell: X(b, 2), dir: PY }], 'ABBAU');
  assert.equal(resolveMove(b, state, X(b, 0)).kind, 'INVALID');

  // Der Blocker zeigt nach oben und ist selbst frei -> er geht.
  const weg = resolveMove(b, state, X(b, 2));
  assert.equal(weg.kind, 'EXIT');
  applyMove(state, weg);

  // Jetzt ist die Bahn frei.
  assert.equal(resolveMove(b, state, X(b, 0)).kind, 'EXIT');
});

test('RF-4: ausgeschiedener Stein und Index ausserhalb liefern INVALID/DEAD', () => {
  const b = B5;
  const state = createState(b, [{ cell: X(b, 0), dir: PX }], 'ABBAU');
  const m = resolveMove(b, state, X(b, 0));
  applyMove(state, m);
  const tot = resolveMove(b, state, X(b, 0));
  assert.equal(tot.kind, 'INVALID');
  assert.equal(tot.reason, 'DEAD');

  for (const c of [-1, b.C, b.C + 5, 1.5, NaN]) {
    const r = resolveMove(b, state, c);
    assert.equal(r.kind, 'INVALID');
    assert.equal(r.reason, 'DEAD');
  }
});

test('RF-6: ein Zug entfernt genau einen Stein, alle anderen bleiben unberuehrt', () => {
  const b = B5;
  const state = createState(b, [
    { cell: X(b, 0), dir: PX }, { cell: V(b, 1, 1, 0), dir: PY }, { cell: V(b, 2, 1, 0), dir: PY }
  ], 'ABBAU');
  const vor = snap(state);
  const m = resolveMove(b, state, X(b, 0));
  assert.equal(m.kind, 'EXIT');
  applyMove(state, m);

  assert.equal(state.aliveCount, vor.aliveCount - 1);
  for (let id = 1; id < state.cubeCount; id++) {
    assert.equal(state.cellOf[id], vor.cellOf[id], 'fremder Stein wurde bewegt');
    assert.equal(state.alive[id], vor.alive[id], 'fremder Stein wurde entfernt');
  }
});

test('Terminierung: die Bahn ist hoechstens so lang wie die groesste Kante', () => {
  for (const b of [B3, B5, B9, vol(6, 6, 6), vol(4, 7, 5)]) {
    const grenze = Math.max(b.W, b.H, b.D);
    const rng = mulberry32(7);
    for (let runde = 0; runde < 50; runde++) {
      const state = emptyState(b, b.C, 'ABBAU');
      for (let c = 0; c < b.C; c++) {
        if (rng() >= 0.4) continue;
        const dirs = validDirs(b, c);
        addCube(state, c, dirs[Math.floor(rng() * dirs.length)]);
      }
      for (let c = 0; c < b.C; c++) {
        if (state.occ[c] === EMPTY) continue;
        const m = resolveMove(b, state, c);
        assert.ok(m.path.length <= grenze, `Bahn zu lang: ${m.path.length} > ${grenze}`);
      }
    }
  }
});

test('Sackgassen existieren: zwei Steine, die aufeinander zeigen, kommen nie heraus', () => {
  const b = B5;
  const state = createState(b, [{ cell: X(b, 1), dir: PX }, { cell: X(b, 2), dir: NX }], 'ABBAU');
  assert.equal(resolveMove(b, state, X(b, 1)).kind, 'INVALID');
  assert.equal(resolveMove(b, state, X(b, 2)).kind, 'INVALID');
  assert.equal(hasAnyMove(b, state), false);
  assert.equal(isSolved(state), false);
});

test('applyMove gefolgt von revertMove ist die Identitaet (10 000 Faelle)', () => {
  const bretter = [vol(4, 4, 4), vol(5, 5, 4), vol(5, 2, 3)];
  const rng = mulberry32(1234);
  let geprueft = 0;

  for (let runde = 0; runde < 400 && geprueft < 10000; runde++) {
    const b = bretter[runde % bretter.length];
    const state = emptyState(b, b.C, 'ABBAU');
    for (let c = 0; c < b.C; c++) {
      if (rng() >= 0.55) continue;
      if (state.occ[c] !== EMPTY) continue;   // zweite Zelle eines bereits gesetzten 2x1-Steins
      const dirs = validDirs(b, c);
      const ext = rng() < 0.3 ? dirs[Math.floor(rng() * dirs.length)] : EXT_NONE;
      if (ext !== EXT_NONE) {
        const z = b.step[c * 6 + ext];
        if (z === OUT || state.occ[z] !== EMPTY) continue;
      }
      addCube(state, c, dirs[Math.floor(rng() * dirs.length)], false, ext);
    }
    for (let c = 0; c < b.C && geprueft < 10000; c++) {
      if (state.occ[c] === EMPTY) continue;
      const vor = snap(state);
      const m = resolveMove(b, state, c);
      if (m.kind === 'INVALID') continue;
      applyMove(state, m);
      revertMove(state, m);
      geprueft++;
      assert.deepEqual(snap(state), vor, 'revertMove ist nicht exakt invers');
    }
  }
  assert.ok(geprueft >= 1000, `zu wenige Faelle geprueft: ${geprueft}`);
});

test('path und blocker sind strukturell korrekt', () => {
  const bretter = [vol(4, 4, 4), vol(5, 5, 4), vol(5, 2, 3)];
  const rng = mulberry32(4711);
  const gesehen = { EXIT: 0, INVALID: 0 };

  for (let runde = 0; runde < 400; runde++) {
    const b = bretter[runde % bretter.length];
    const state = emptyState(b, b.C, 'ABBAU');
    for (let c = 0; c < b.C; c++) {
      if (rng() >= 0.6) continue;
      const dirs = validDirs(b, c);
      addCube(state, c, dirs[Math.floor(rng() * dirs.length)]);
    }
    for (let c = 0; c < b.C; c++) {
      if (state.occ[c] === EMPTY) continue;
      const m = resolveMove(b, state, c);
      const d = state.dirOf[state.occ[c]];
      gesehen[m.kind]++;

      assert.equal(m.from, c);
      assert.equal(m.path[0], m.from);
      assert.equal(m.cubeId, state.occ[c]);
      assert.equal(m.to, OUT, 'to ist immer OUT');

      if (m.kind === 'INVALID') {
        assert.deepEqual(m.path, [c]);
        assert.equal(m.reason, 'BLOCKED');
        assert.equal(m.blocker.length, 1, 'genau der erste Blockierer wird gemeldet');
        assert.notEqual(state.occ[m.blocker[0]], EMPTY);
        continue;
      }

      // EXIT: die Bahn liegt auf dem Strahl, ist frei und endet am Rand.
      assert.deepEqual(m.blocker, []);
      for (let k = 0; k + 1 < m.path.length; k++)
        assert.equal(b.step[m.path[k] * 6 + d], m.path[k + 1], 'path nicht auf dem Strahl');
      assert.equal(b.step[m.path[m.path.length - 1] * 6 + d], OUT, 'path endet nicht am Rand');
      for (let k = 1; k < m.path.length; k++)
        assert.equal(state.occ[m.path[k]], EMPTY, 'Bahn war nicht frei');
      assert.equal(new Set(m.path).size, m.path.length, 'path enthaelt Wiederholungen');
    }
  }
  for (const k of ['EXIT', 'INVALID'])
    assert.ok(gesehen[k] > 50, `Zugart ${k} kaum getroffen: ${gesehen[k]}`);
});


test('Zusatz 8a: legalCells ist aufsteigend, deterministisch und deckt sich mit hasAnyMove', () => {
  const b = vol(4, 4, 4);
  const rng = mulberry32(99);
  for (let runde = 0; runde < 60; runde++) {
    const state = emptyState(b, b.C, 'ABBAU');
    for (let c = 0; c < b.C; c++) {
      if (rng() >= 0.7) continue;
      addCube(state, c, Math.floor(rng() * 6));
    }
    const l1 = legalCells(b, state);
    const l2 = legalCells(b, state);
    assert.deepEqual(l1, l2, 'legalCells ist nicht deterministisch');
    assert.deepEqual(l1, [...l1].sort((a, c) => a - c), 'legalCells ist nicht aufsteigend');
    assert.equal(new Set(l1).size, l1.length);
    assert.equal(hasAnyMove(b, state), l1.length > 0);
    for (const c of l1) assert.notEqual(resolveMove(b, state, c).kind, 'INVALID');
    for (let c = 0; c < b.C; c++)
      if (state.occ[c] !== EMPTY && !l1.includes(c))
        assert.equal(resolveMove(b, state, c).kind, 'INVALID');
    if (state.aliveCount > 0)
      assert.equal(mobility(b, state), l1.length / state.aliveCount);
  }
  assert.equal(mobility(b, emptyState(b, 4, 'ABBAU')), 0);
});

test('Zusatz 8b: isSolved fuer ABBAU und BEFREIUNG', () => {
  const b = B5;
  // X4 steht am Rand und geht sofort. X3 (das Ziel) ist von X4 blockiert, bis der weg ist.
  // X0 zeigt nach +X und ist von X3 blockiert - er bleibt als Restturm stehen.
  const cubes = [
    { cell: X(b, 4), dir: PX },
    { cell: X(b, 3), dir: PX, target: true },
    { cell: X(b, 0), dir: PX }
  ];

  const abbau = createState(b, cubes, 'ABBAU');
  assert.equal(abbau.targetId, 1);
  assert.equal(isSolved(abbau), false);
  assert.equal(resolveMove(b, abbau, X(b, 3)).kind, 'INVALID', 'X3 ist von X4 blockiert');

  applyMove(abbau, resolveMove(b, abbau, X(b, 4)));
  assert.equal(abbau.aliveCount, 2);
  assert.equal(isSolved(abbau), false, 'ABBAU ist erst bei aliveCount 0 geloest');
  applyMove(abbau, resolveMove(b, abbau, X(b, 3)));
  applyMove(abbau, resolveMove(b, abbau, X(b, 0)));
  assert.equal(abbau.aliveCount, 0);
  assert.equal(isSolved(abbau), true);

  const befreiung = createState(b, cubes, 'BEFREIUNG');
  assert.equal(befreiung.targetId, 1);
  assert.equal(isSolved(befreiung), false);
  // Der Nicht-Zielstein verlaesst das Gitter: das loest nichts aus.
  applyMove(befreiung, resolveMove(b, befreiung, X(b, 4)));
  assert.equal(isSolved(befreiung), false);
  // Jetzt der gruene Stein; der Restturm darf stehenbleiben.
  const zugZiel = resolveMove(b, befreiung, X(b, 3));
  assert.equal(zugZiel.kind, 'EXIT');
  applyMove(befreiung, zugZiel);
  assert.equal(isSolved(befreiung), true);
  assert.equal(befreiung.aliveCount, 1, 'Restturm bleibt stehen');
  revertMove(befreiung, zugZiel);
  assert.equal(isSolved(befreiung), false, 'Undo dreht den Sieg zurueck');
});

test('Zustandsverwaltung: addCube, dropCube, cloneState, isFree', () => {
  const b = vol(3, 3, 3);
  const state = emptyState(b, b.C, 'BEFREIUNG');
  assert.equal(state.aliveCount, 0);
  assert.equal(state.cubeCount, 0);
  assert.equal(state.targetId, -1);

  const a = addCube(state, V(b, 0, 0, 0), 0);
  const z = addCube(state, V(b, 1, 0, 0), 2, true);
  assert.deepEqual([a, z], [0, 1]);
  assert.equal(state.targetId, 1);
  assert.equal(state.aliveCount, 2);
  assert.equal(isFree(state, V(b, 0, 0, 0)), false);
  assert.equal(isFree(state, V(b, 2, 2, 2)), true);
  assert.throws(() => addCube(state, V(b, 0, 0, 0), 1), RangeError);
  assert.throws(() => addCube(state, -1, 1), RangeError);
  assert.throws(() => addCube(state, V(b, 2, 2, 2), 6), RangeError);
  assert.throws(() => isFree(state, b.C), RangeError);

  const kopie = cloneState(state);
  applyMove(state, resolveMove(b, state, V(b, 0, 0, 0)));
  assert.equal(kopie.occ[V(b, 0, 0, 0)], 0, 'cloneState teilt Speicher mit dem Original');
  assert.equal(kopie.aliveCount, 2);

  // dropCube gibt die Id des zuletzt erzeugten Wuerfels wieder frei (Rueckwaertsbau §6.3).
  dropCube(kopie, 1);
  assert.equal(kopie.cubeCount, 1);
  assert.equal(kopie.aliveCount, 1);
  assert.equal(kopie.targetId, -1);
  assert.equal(isFree(kopie, V(b, 1, 0, 0)), true);
  const neu = addCube(kopie, V(b, 2, 2, 2), 3);
  assert.equal(neu, 1, 'Id wurde nicht wiederverwendet');
  assert.throws(() => dropCube(kopie, 5), RangeError);
});

test('createState ist nachsichtig genug fuer verifyLevel: kaputte Eintraege werfen nicht', () => {
  const b = vol(3, 3, 3);
  const state = createState(b, [
    { cell: V(b, 0, 0, 0), dir: 0 },
    { cell: b.C + 10, dir: 0 },      // Zellindex verschoben
    { cell: V(b, 1, 1, 1), dir: 9 }  // Richtung verfaelscht
  ], 'ABBAU');
  assert.equal(state.cubeCount, 3);
  assert.equal(state.aliveCount, 1);
  assert.equal(state.alive[1], 0);
  assert.equal(state.alive[2], 0);
  assert.equal(isSolved(state), false);
  // Ein BEFREIUNG-Level ohne Zielmarkierung gilt als ungeloest, statt zu werfen.
  const ohneZiel = createState(b, [{ cell: V(b, 0, 0, 0), dir: 0 }], 'BEFREIUNG');
  assert.equal(ohneZiel.targetId, -1);
  assert.equal(isSolved(ohneZiel), false);
  assert.throws(() => emptyState(b, 4, 'UNSINN'), RangeError);
});

// --- Regressionen aus der adversarialen Pruefung ------------------------

test('Regression A: createState akzeptiert nur Richtungen, die board.valid erlaubt', () => {
  // Befund: `brauchbar` liess Richtungen durch, die auf dem Brett gesperrt sind. Ein so
  // verfaelschter Wuerfel war lebendig und lieferte bei jedem Tipp sofort EXIT — ein Level,
  // dessen Richtungen gedreht wurden, war trivial loesbar (SPEC §2.3, §10.4). Seit dem
  // Wegfall der Schalenvariante ist keine der sechs Richtungen mehr gesperrt; die Pruefung
  // muss aber weiterhin greifen, sobald eine Richtung ganz ausserhalb des Wertebereichs liegt.
  const b = vol(4, 4, 4);
  assert.equal(b.C, 64, 'Vorbedingung: massiver Quader');
  for (const d of [-1, 6, 7, 255, 1.5, NaN, undefined, null, 'PX']) {
    const cubes = [];
    for (let c = 0; c < b.C; c++) cubes.push({ cell: c, dir: d });
    const state = createState(b, cubes, 'ABBAU');
    assert.equal(state.cubeCount, b.C, 'jeder Eintrag bekommt trotzdem eine Id');
    assert.equal(state.aliveCount, 0, `Richtung ${String(d)} darf keinen Wuerfel erzeugen`);
    for (let id = 0; id < state.cubeCount; id++) {
      assert.equal(state.alive[id], 0);
      assert.equal(state.cellOf[id], -1);
    }
    for (let c = 0; c < b.C; c++) assert.equal(state.occ[c], EMPTY);
    assert.deepEqual(legalCells(b, state), [], 'kein Tipp darf einen Zug erzeugen');
    assert.equal(hasAnyMove(b, state), false);
    for (let c = 0; c < b.C; c++) {
      const m = resolveMove(b, state, c);
      assert.equal(m.kind, 'INVALID');
      assert.equal(m.reason, 'DEAD');
    }
  }

  // Eine einzelne verdrehte Richtung faellt aus der Aufstellung heraus, der Rest bleibt intakt.
  const gut = [{ cell: V(b, 0, 0, 0), dir: 0 }, { cell: V(b, 0, 1, 0), dir: 1 },
               { cell: V(b, 2, 0, 0), dir: 2 }];
  const heil = createState(b, gut, 'ABBAU');
  assert.equal(heil.aliveCount, 3);
  const verfaelscht = createState(b, [gut[0], { ...gut[1], dir: 9 }, gut[2]], 'ABBAU');
  assert.equal(verfaelscht.aliveCount, 2);
  assert.equal(verfaelscht.alive[1], 0);
  assert.equal(verfaelscht.occ[gut[1].cell], EMPTY, 'die Zelle bleibt leer, statt zu leben');

  // Alle sechs echten Raumrichtungen muessen weiterhin durchgehen.
  const v = vol(3, 3, 3);
  for (let d = 0; d < 6; d++) {
    const s = createState(v, [{ cell: V(v, 1, 1, 1), dir: d }], 'ABBAU');
    assert.equal(s.aliveCount, 1, `Richtung ${d} muss erlaubt bleiben`);
    assert.equal(s.dirOf[0], d);
  }
});

test('Regression A2: doppelt belegte Zellen verdecken einander, der spaetere Eintrag gewinnt', () => {
  // Die Verdeckungsrichtung ist Teil des Vertrags: der verdeckte Wuerfel bleibt lebendig und
  // unerreichbar, damit ein ABBAU-Level mit doppelter Zelle nie geloest werden kann.
  const b = vol(3, 3, 3);
  const zelle = V(b, 0, 1, 1);                    // am Rand: Richtung NX fuehrt hinaus
  const state = createState(b, [{ cell: zelle, dir: 0 }, { cell: zelle, dir: 1 }], 'ABBAU');
  assert.equal(state.cubeCount, 2);
  assert.equal(state.aliveCount, 2);
  assert.equal(state.occ[zelle], 1, 'der spaetere Eintrag belegt die Zelle');
  assert.deepEqual([...state.cellOf], [zelle, zelle]);
  assert.equal(state.dirOf[0], 0);
  assert.equal(state.dirOf[1], 1);
  const m = resolveMove(b, state, zelle);
  assert.equal(m.cubeId, 1, 'getippt wird der verdeckende Wuerfel');
  assert.equal(m.kind, 'EXIT');
  applyMove(state, m);
  assert.equal(state.aliveCount, 1);
  assert.equal(state.occ[zelle], EMPTY);
  assert.equal(resolveMove(b, state, zelle).reason, 'DEAD', 'der verdeckte Wuerfel bleibt unerreichbar');
  assert.equal(isSolved(state), false, 'ein solches ABBAU-Level ist nie loesbar');
});

test('Regression B: resolveMove prueft den Bereich, bevor es state.occ liest', () => {
  const b = B5;
  const state = createState(b, [{ cell: X(b, 0), dir: PX }], 'ABBAU');
  const erwartet = (cell) => ({
    kind: 'INVALID', reason: 'DEAD', cubeId: EMPTY, from: cell, to: OUT,
    path: [cell], blocker: []
  });
  for (const cell of [-1, -100, b.C, b.C + 5, 1.5, NaN, Infinity]) {
    const m = resolveMove(b, state, cell);
    assert.deepEqual(m, erwartet(cell), `Bereichspruefung fehlt fuer ${cell}`);
    // Ohne Bereichspruefung liefe der Zugriff auf undefined und cubeId waere nicht EMPTY.
    assert.equal(m.cubeId, EMPTY);
  }
  // Ein solcher Tipp darf den Zustand nicht anfassen.
  const vorher = snap(state);
  applyMove(state, resolveMove(b, state, -1));
  assert.deepEqual(snap(state), vorher);
});

test('Regression C: applyMove loescht bei EXIT auch cellOf, revertMove stellt es her', () => {
  const b = B5;
  const state = createState(b, [{ cell: X(b, 4), dir: PX }, { cell: X(b, 0), dir: PX }], 'ABBAU');
  const m = resolveMove(b, state, X(b, 4));
  assert.equal(m.kind, 'EXIT');
  applyMove(state, m);
  assert.equal(state.alive[0], 0);
  assert.equal(state.cellOf[0], -1, 'ein ausgeschiedener Wuerfel darf auf keine Zelle mehr zeigen');
  assert.equal(state.occ[X(b, 4)], EMPTY);
  revertMove(state, m);
  assert.equal(state.cellOf[0], X(b, 4));
  assert.equal(state.alive[0], 1);
  assert.equal(state.aliveCount, 2);
});

// --- Sitzung: Tippliste bleibt nachspielbar (SPEC §1.5 gegen §9.4) -------

/** Minimales Level-Objekt; createSession liest nur cubes und goal. */
function levelAus(cubes, goal = 'ABBAU') {
  return {
    v: 1, ruleVersion: RULE_VERSION, genVersion: 1, seed: 0, attempt: 0,
    levelCode: 'V-A-5x2x3-0-00000000', goal, cubes,
    targetId: null, witness: [], par: 0
  };
}

/**
 * Spielt eine Tippliste nach §9.4-Semantik nach: frische Sitzung, jeder Tipp durch dieselbe
 * Regelimplementierung. Liefert dieselben Kennzahlen wie replayTaps aus levels.js.
 */
function nachspielen(board, level, taps) {
  const s = createSession(board, level);
  let invalid = 0;
  for (const c of taps) if (tap(s, c).kind === 'INVALID') invalid++;
  return { moves: s.moves, invalid, solved: s.won, state: s.state };
}

test('Regression D: undo verwirft den zurueckgenommenen Tipp aus session.taps', () => {
  // Befund: die Tippliste behielt zurueckgenommene Zuege. Nach §9.4 verlangt der Worker
  // `replayTaps(level, taps).moves === payload.moves` — jeder Lauf mit Undo waere damit
  // grundsaetzlich unverifiziert gewesen, obwohl §1.5 Undo ausdruecklich zulaesst.
  const b = B5;                                   // VOLUMEN 5x2x3
  // X4 steht am Rand und geht sofort; X0 ist von X4 blockiert, bis der weg ist.
  const level = levelAus([{ cell: X(b, 4), dir: PX }, { cell: X(b, 0), dir: PX }]);
  const ses = createSession(b, level);

  assert.equal(tap(ses, X(b, 4)).kind, 'EXIT');
  assert.equal(ses.moves, 1);
  assert.deepEqual(ses.taps, [X(b, 4)]);

  assert.equal(undo(ses), true);
  assert.equal(ses.moves, 0);
  assert.equal(ses.undos, 1);
  assert.deepEqual(ses.taps, [], 'der zurueckgenommene Tipp gehoert nicht mehr in die Liste');

  assert.equal(tap(ses, X(b, 4)).kind, 'EXIT');
  assert.equal(ses.moves, 1);
  assert.deepEqual(ses.taps, [X(b, 4)]);

  const r = nachspielen(b, level, ses.taps);
  assert.equal(r.moves, ses.moves, 'Nachspielen muss dieselbe Zugzahl ergeben (§9.4)');
  assert.equal(r.invalid, 0);
  assert.deepEqual(snap(r.state), snap(ses.state), 'Nachspielen muss denselben Zustand ergeben');
  assert.deepEqual(toRunLog(ses, { runId: 'r', clientId: 'c', name: 'n', appVersion: '1' }).taps,
    [X(b, 4)], 'der RunLog meldet die gekuerzte Liste');
});

test('Regression D2: undo kuerzt nur den eigenen Tipp samt nachfolgender ungueltiger Tipps', () => {
  const b = B5;
  const level = levelAus([{ cell: X(b, 0), dir: PX }, { cell: X(b, 4), dir: PX }]);
  const ses = createSession(b, level);

  assert.equal(tap(ses, X(b, 2)).kind, 'INVALID');   // leere Zelle, vor dem Zug
  assert.equal(tap(ses, X(b, 4)).kind, 'EXIT');      // der Zug, der zurueckgenommen wird
  assert.equal(tap(ses, X(b, 3)).kind, 'INVALID');   // leere Zelle, nach dem Zug
  assert.deepEqual(ses.taps, [X(b, 2), X(b, 4), X(b, 3)]);
  assert.equal(ses.moves, 1);

  assert.equal(undo(ses), true);
  assert.deepEqual(ses.taps, [X(b, 2)], 'ungueltige Tipps vor dem Zug bleiben erhalten');
  assert.equal(ses.moves, 0);

  assert.equal(tap(ses, X(b, 4)).kind, 'EXIT');   // derselbe Stein noch einmal
  const r = nachspielen(b, level, ses.taps);
  assert.equal(r.moves, ses.moves);
  assert.equal(r.invalid, 1, 'der ungueltige Tipp vor dem Zug zaehlt weiterhin');
  assert.deepEqual(snap(r.state), snap(ses.state));

  assert.equal(undo(ses), true);
  assert.equal(undo(ses), false, 'ohne Zug in der Historie gibt es nichts zurueckzunehmen');
  assert.equal(ses.undos, 2, 'ein leeres Undo zaehlt nicht');
  assert.deepEqual(ses.taps, [X(b, 2)]);
});

test('Regression D3: Tippliste bleibt unter beliebigen Tipp/Undo-Folgen nachspielbar', () => {
  const rng = mulberry32(20260830);
  const bretter = [vol(4, 3, 3), vol(4, 4, 4), vol(5, 2, 3)];
  let mitUndo = 0, geloest = 0;

  for (let runde = 0; runde < 240; runde++) {
    const b = bretter[runde % bretter.length];
    const cubes = [];
    for (let c = 0; c < b.C; c++) {
      if (rng() >= 0.45) continue;
      const dirs = validDirs(b, c);
      cubes.push({ cell: c, dir: dirs[Math.floor(rng() * dirs.length)] });
    }
    if (cubes.length === 0) continue;
    const level = levelAus(cubes);
    const ses = createSession(b, level);

    for (let k = 0; k < 25; k++) {
      if (rng() < 0.3 && ses.history.length > 0) {
        undo(ses);
        mitUndo++;
      } else {
        // Mischung aus gueltigen und ungueltigen Tipps.
        const legal = legalCells(b, ses.state);
        const cell = (legal.length > 0 && rng() < 0.75)
          ? legal[Math.floor(rng() * legal.length)]
          : Math.floor(rng() * b.C);
        tap(ses, cell);
      }
      // Die Invariante: die Tippliste erzeugt aus dem Startzustand genau diesen Stand.
      const r = nachspielen(b, level, ses.taps);
      assert.equal(r.moves, ses.moves, `Zugzahl weicht ab (Runde ${runde}, Schritt ${k})`);
      assert.equal(r.solved, ses.won, 'Siegzustand weicht ab');
      assert.deepEqual(snap(r.state), snap(ses.state), 'Zustand weicht ab');
      if (ses.won) { geloest++; break; }
    }

    restart(ses);
    assert.deepEqual(ses.taps, [], 'restart leert die Tippliste');
    assert.equal(ses.moves, 0);
    assert.deepEqual(snap(ses.state), snap(createState(b, cubes, 'ABBAU')));
  }
  assert.ok(mitUndo > 200, `zu wenige Undos im Lauf: ${mitUndo}`);
  assert.ok(geloest > 0, 'kein einziger Lauf wurde geloest — der Test prueft zu wenig');
});
