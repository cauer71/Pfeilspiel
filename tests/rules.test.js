// SPEC §10.2 — Zugregel. Tabellengetriebene Fixtures fuer RF-1 bis RF-12 aus §1.3.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoard, cellIndexOf, latticeOf, validDirs, depthOf,
  createState, emptyState, cloneState, addCube, dropCube, isFree,
  resolveMove, applyMove, revertMove, legalCells, mobility, hasAnyMove, isSolved,
  createSession, tap, undo, restart, toRunLog,
  OUT, EMPTY, RULE_VERSION
} from '../public/src/game.js';

// --- Werkzeug -----------------------------------------------------------

const vol = (W, H, D) => buildBoard({ mode: 'VOLUMEN', W, H, D });
const fas = (W, H, D) => buildBoard({ mode: 'FASSADE', W, H, D });
const V = (b, x, y, z) => cellIndexOf(b, `V:${x}:${y}:${z}`);
const F = (b, f, u, v) => cellIndexOf(b, `F${f}:${u}:${v}`);

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

// Reihe y=0, z=0 eines VOLUMEN-Bretts: bequeme Achse fuer alle Sprungfaelle.
const B3 = vol(3, 2, 3), B4 = vol(4, 2, 3), B5 = vol(5, 2, 3), B7 = vol(7, 2, 3), B9 = vol(9, 2, 3);
const X = (b, x) => V(b, x, 0, 0);
const PX = 0;   // Richtung +X

// --- RF-1 bis RF-12 als Tabelle ----------------------------------------

const FIXTURES = [
  {
    name: 'RF-1: n1 ausserhalb -> EXIT, Belegung wird nicht geprueft',
    board: B5,
    cubes: b => [{ cell: X(b, 4), dir: PX }],
    tap: b => X(b, 4),
    move: b => ({ kind: 'EXIT', cubeId: 0, from: X(b, 4), to: OUT, jumps: 0, path: [X(b, 4)], jumped: [] })
  },
  {
    name: 'RF-2: n1 innerhalb und frei -> STEP, keine Verkettung',
    board: B5,
    cubes: b => [{ cell: X(b, 0), dir: PX }],
    tap: b => X(b, 0),
    move: b => ({ kind: 'STEP', cubeId: 0, from: X(b, 0), to: X(b, 1), jumps: 0, path: [X(b, 0), X(b, 1)], jumped: [] })
  },
  {
    name: 'RF-3: n1 besetzt, n2 ausserhalb -> EXIT (Sprung ueber den Rand hinaus)',
    board: B5,
    cubes: b => [{ cell: X(b, 3), dir: PX }, { cell: X(b, 4), dir: PX }],
    tap: b => X(b, 3),
    move: b => ({ kind: 'EXIT', cubeId: 0, from: X(b, 3), to: OUT, jumps: 1, path: [X(b, 3)], jumped: [X(b, 4)] })
  },
  {
    name: 'RF-4: n1 und n2 besetzt -> INVALID/BLOCKED, jumped nennt den Blockierer',
    board: B5,
    cubes: b => [{ cell: X(b, 0), dir: PX }, { cell: X(b, 1), dir: PX }, { cell: X(b, 2), dir: PX }],
    tap: b => X(b, 0),
    move: b => ({
      kind: 'INVALID', reason: 'BLOCKED', cubeId: 0, from: X(b, 0), to: OUT,
      jumps: 0, path: [X(b, 0)], jumped: [X(b, 1)]
    })
  },
  {
    name: 'RF-5: Kette endet, weil cur+d ausserhalb liegt',
    board: B3,
    cubes: b => [{ cell: X(b, 0), dir: PX }, { cell: X(b, 1), dir: PX }],
    tap: b => X(b, 0),
    move: b => ({ kind: 'JUMP', cubeId: 0, from: X(b, 0), to: X(b, 2), jumps: 1, path: [X(b, 0), X(b, 2)], jumped: [X(b, 1)] })
  },
  {
    name: 'RF-6: kein Schritt hinter dem Sprung, obwohl cur+d frei und im Gitter ist',
    board: B5,
    cubes: b => [{ cell: X(b, 0), dir: PX }, { cell: X(b, 1), dir: PX }],
    tap: b => X(b, 0),
    move: b => ({ kind: 'JUMP', cubeId: 0, from: X(b, 0), to: X(b, 2), jumps: 1, path: [X(b, 0), X(b, 2)], jumped: [X(b, 1)] })
  },
  {
    name: 'RF-7: EXIT mitten aus der Kette heraus',
    board: B4,
    cubes: b => [{ cell: X(b, 0), dir: PX }, { cell: X(b, 1), dir: PX }, { cell: X(b, 3), dir: PX }],
    tap: b => X(b, 0),
    move: b => ({
      kind: 'EXIT', cubeId: 0, from: X(b, 0), to: OUT, jumps: 2,
      path: [X(b, 0), X(b, 2)], jumped: [X(b, 1), X(b, 3)]
    })
  },
  {
    name: 'RF-8: Kette endet, weil cur+2d besetzt ist',
    board: B5,
    cubes: b => [{ cell: X(b, 0), dir: PX }, { cell: X(b, 1), dir: PX },
                 { cell: X(b, 3), dir: PX }, { cell: X(b, 4), dir: PX }],
    tap: b => X(b, 0),
    move: b => ({ kind: 'JUMP', cubeId: 0, from: X(b, 0), to: X(b, 2), jumps: 1, path: [X(b, 0), X(b, 2)], jumped: [X(b, 1)] })
  },
  {
    name: 'RF-9: leere Zelle -> INVALID/DEAD',
    board: B5,
    cubes: b => [{ cell: X(b, 0), dir: PX }],
    tap: b => X(b, 2),
    move: b => ({
      kind: 'INVALID', reason: 'DEAD', cubeId: EMPTY, from: X(b, 2), to: OUT,
      jumps: 0, path: [X(b, 2)], jumped: []
    })
  },
  {
    name: 'RF-11: Kette laeuft ueber die ganze Reihe und endet dennoch',
    board: B9,
    cubes: b => [{ cell: X(b, 0), dir: PX }, { cell: X(b, 1), dir: PX }, { cell: X(b, 3), dir: PX },
                 { cell: X(b, 5), dir: PX }, { cell: X(b, 7), dir: PX }],
    tap: b => X(b, 0),
    move: b => ({
      kind: 'JUMP', cubeId: 0, from: X(b, 0), to: X(b, 8), jumps: 4,
      path: [X(b, 0), X(b, 2), X(b, 4), X(b, 6), X(b, 8)],
      jumped: [X(b, 1), X(b, 3), X(b, 5), X(b, 7)]
    })
  }
];

test('RF-Fixtures aus §1.3 liefern exakt den spezifizierten Move', () => {
  for (const fx of FIXTURES) {
    const b = fx.board;
    const state = createState(b, fx.cubes(b), 'ABBAU');
    const m = resolveMove(b, state, fx.tap(b));
    assert.deepEqual(m, fx.move(b), fx.name);
  }
});

test('RF-3 ist normativ: Sprung ueber den letzten Blocker ins Freie (Teil von RULE_VERSION)', () => {
  assert.equal(RULE_VERSION, 1);
  const b = B5;
  const state = createState(b, [{ cell: X(b, 3), dir: PX }, { cell: X(b, 4), dir: PX }], 'ABBAU');
  const m = resolveMove(b, state, X(b, 3));
  assert.equal(m.kind, 'EXIT');
  assert.equal(m.jumps, 1);
  assert.deepEqual(m.jumped, [X(b, 4)]);
  // Waere n2 im Gitter und besetzt, muesste derselbe Aufbau BLOCKED liefern.
  const b6 = vol(6, 2, 3);
  const s2 = createState(b6, [{ cell: X(b6, 3), dir: PX }, { cell: X(b6, 4), dir: PX },
                              { cell: X(b6, 5), dir: PX }], 'ABBAU');
  assert.equal(resolveMove(b6, s2, X(b6, 3)).kind, 'INVALID');
  assert.equal(resolveMove(b6, s2, X(b6, 3)).reason, 'BLOCKED');
});

test('RF-6: kein Schritt hinter dem Sprung — das naechste Feld waere frei und im Gitter', () => {
  const b = B5;
  const state = createState(b, [{ cell: X(b, 0), dir: PX }, { cell: X(b, 1), dir: PX }], 'ABBAU');
  assert.ok(isFree(state, X(b, 3)), 'Vorbedingung: X3 ist frei');
  assert.notEqual(b.step[X(b, 2) * 6 + PX], OUT, 'Vorbedingung: X3 liegt im Gitter');
  const m = resolveMove(b, state, X(b, 0));
  assert.equal(m.kind, 'JUMP');
  assert.equal(m.to, X(b, 2));
  assert.equal(m.jumps, 1);
});

test('RF-9: ausgeschiedener Wuerfel und Index ausserhalb liefern INVALID/DEAD', () => {
  const b = B5;
  const state = createState(b, [{ cell: X(b, 4), dir: PX }], 'ABBAU');
  const raus = resolveMove(b, state, X(b, 4));
  applyMove(state, raus);
  assert.equal(state.alive[0], 0);
  const tot = resolveMove(b, state, X(b, 4));
  assert.equal(tot.kind, 'INVALID');
  assert.equal(tot.reason, 'DEAD');
  const daneben = resolveMove(b, state, b.C + 5);
  assert.equal(daneben.kind, 'INVALID');
  assert.equal(daneben.reason, 'DEAD');
  assert.equal(daneben.to, OUT);
});

test('RF-10 / Zusatz 1: Grenze vor Belegung — die Nachbarwand existiert fuer die Regel nicht', () => {
  const b = fas(5, 4, 5);
  const oben = F(b, 0, 1, b.H - 2);            // SUED, oberste Reihe
  const deckel = F(b, 4, 3, b.D - 1);          // geometrisch direkt darueber
  assert.ok(oben >= 0 && deckel >= 0);
  const [x1, y1, z1] = latticeOf(b, oben);
  const [x2, y2, z2] = latticeOf(b, deckel);
  assert.deepEqual([x2, y2, z2], [x1, y1 + 1, z1], 'Vorbedingung: die Zellen liegen aneinander');
  assert.equal(b.faceOf[oben], 0);
  assert.equal(b.faceOf[deckel], 4);

  const HOCH = 1;
  const leer = createState(b, [{ cell: oben, dir: HOCH }], 'ABBAU');
  const belegt = createState(b, [{ cell: oben, dir: HOCH }, { cell: deckel, dir: HOCH }], 'ABBAU');
  assert.ok(isFree(leer, deckel));
  assert.ok(!isFree(belegt, deckel));

  const mLeer = resolveMove(b, leer, oben);
  const mBelegt = resolveMove(b, belegt, oben);
  assert.deepEqual(mLeer, mBelegt, 'Nachbarwand darf den Zug nicht beeinflussen');
  assert.deepEqual(mLeer, { kind: 'EXIT', cubeId: 0, from: oben, to: OUT, jumps: 0, path: [oben], jumped: [] });
});

test('RF-10: in FASSADE bleibt jeder Zug auf seiner Flaeche', () => {
  const b = fas(5, 4, 5);
  const rng = mulberry32(7);
  const cubes = [];
  for (let c = 0; c < b.C; c++)
    if (rng() < 0.5) cubes.push({ cell: c, dir: Math.floor(rng() * 4) });
  const state = createState(b, cubes, 'ABBAU');
  for (const c of legalCells(b, state)) {
    const m = resolveMove(b, state, c);
    for (const p of m.path) assert.equal(b.faceOf[p], b.faceOf[c]);
    for (const j of m.jumped) assert.equal(b.faceOf[j], b.faceOf[c]);
  }
});

test('RF-12: ein Zug veraendert genau einen Wuerfel, uebersprungene bleiben unberuehrt', () => {
  const b = B9;
  const cubes = [{ cell: X(b, 0), dir: PX }, { cell: X(b, 1), dir: PX }, { cell: X(b, 3), dir: PX },
                 { cell: X(b, 5), dir: PX }, { cell: X(b, 7), dir: PX }];
  const state = createState(b, cubes, 'ABBAU');
  const vorher = snap(state);
  const m = resolveMove(b, state, X(b, 0));
  applyMove(state, m);
  const nachher = snap(state);
  for (let id = 1; id < state.cubeCount; id++) {
    assert.equal(nachher.cellOf[id], vorher.cellOf[id], `Wuerfel ${id} wurde bewegt`);
    assert.equal(nachher.alive[id], vorher.alive[id]);
  }
  for (const j of m.jumped) assert.equal(nachher.occ[j], vorher.occ[j], 'uebersprungene Zelle veraendert');
  let geaendert = 0;
  for (let c = 0; c < b.C; c++) if (nachher.occ[c] !== vorher.occ[c]) geaendert++;
  assert.equal(geaendert, 2, 'genau Start- und Zielzelle aendern sich');
});

test('Zusatz 4: Terminierung — Kette hoechstens ceil(max(W,H,D)/2) Glieder', () => {
  for (const [b, letzte] of [[B7, 6], [B9, 8]]) {
    const L = Math.max(b.W, b.H, b.D);
    const cubes = [{ cell: X(b, 0), dir: PX }];
    for (let x = 1; x < b.W; x += 2) cubes.push({ cell: X(b, x), dir: PX });
    const state = createState(b, cubes, 'ABBAU');
    const m = resolveMove(b, state, X(b, 0));
    assert.equal(m.kind, 'JUMP');
    assert.equal(m.to, X(b, letzte));
    assert.ok(m.jumps <= Math.ceil(L / 2), `Kette zu lang: ${m.jumps} > ceil(${L}/2)`);

    // Unabhaengige Nachrechnung mit hartem Zaehlerlimit (gehoert in den Test, nicht in den Code).
    let cur = X(b, 0), glieder = 0, zaehler = 0;
    for (;;) {
      if (++zaehler > 2 * L) throw new Error('Kette terminiert nicht');
      const over = b.step[cur * 6 + PX];
      if (over === OUT || state.occ[over] === EMPTY) break;
      const land = b.step[over * 6 + PX];
      if (land === OUT || state.occ[land] !== EMPTY) break;
      cur = land; glieder++;
    }
    assert.equal(glieder, m.jumps);
    assert.equal(cur, m.to);
  }
});

test('Zusatz 5: Sackgassen existieren — vollbelegtes Gitter, alle Pfeile nach innen', () => {
  for (const b of [vol(5, 5, 5), fas(6, 6, 6)]) {
    const cubes = [];
    for (let c = 0; c < b.C; c++) {
      let best = -1, tiefe = -1;
      for (const d of validDirs(b, c)) {
        const t = depthOf(b, c, d);
        if (t > tiefe) { tiefe = t; best = d; }
      }
      assert.ok(tiefe >= 2, `${b.mode}: Zelle ${c} hat keine Richtung mit Tiefe >= 2`);
      cubes.push({ cell: c, dir: best });
    }
    const state = createState(b, cubes, 'ABBAU');
    assert.equal(state.aliveCount, b.C);
    assert.deepEqual(legalCells(b, state), [], `${b.mode}: unerwarteter Zug im Vollgitter`);
    assert.equal(hasAnyMove(b, state), false);
    assert.equal(mobility(b, state), 0);
    assert.equal(isSolved(state), false);
    for (let c = 0; c < b.C; c++) {
      const m = resolveMove(b, state, c);
      assert.equal(m.kind, 'INVALID');
      assert.equal(m.reason, 'BLOCKED');
    }
  }
});

test('Zusatz 6: applyMove gefolgt von revertMove ist die Identitaet (10 000 Faelle)', () => {
  const bretter = [vol(4, 4, 4), fas(4, 4, 4), vol(3, 3, 3), fas(5, 4, 3)];
  const rng = mulberry32(20250830);
  let pruefungen = 0, exits = 0, jumps = 0, steps = 0, invalid = 0;

  while (pruefungen < 10000) {
    const b = bretter[Math.floor(rng() * bretter.length)];
    const state = emptyState(b, b.C, 'ABBAU');
    const dichte = 0.35 + 0.55 * rng();
    for (let c = 0; c < b.C; c++) {
      if (rng() >= dichte) continue;
      const dirs = validDirs(b, c);
      addCube(state, c, dirs[Math.floor(rng() * dirs.length)]);
    }
    for (let k = 0; k < 60 && pruefungen < 10000; k++) {
      const besetzt = [];
      for (let c = 0; c < b.C; c++) if (state.occ[c] !== EMPTY) besetzt.push(c);
      if (besetzt.length === 0) break;
      // auch ungueltige Zellen pruefen: applyMove/revertMove muessen dort folgenlos bleiben
      const probe = besetzt[Math.floor(rng() * besetzt.length)];
      const mp = resolveMove(b, state, probe);
      const vorher = snap(state);
      applyMove(state, mp);
      revertMove(state, mp);
      assert.deepEqual(snap(state), vorher, `Involution verletzt bei ${b.mode}/${probe}/${mp.kind}`);
      pruefungen++;
      if (mp.kind === 'EXIT') exits++;
      else if (mp.kind === 'JUMP') jumps++;
      else if (mp.kind === 'STEP') steps++;
      else invalid++;
      const legal = legalCells(b, state);
      if (legal.length === 0) break;
      const zug = resolveMove(b, state, legal[Math.floor(rng() * legal.length)]);
      applyMove(state, zug);
    }
  }
  assert.equal(pruefungen, 10000);
  // Der Lauf muss alle vier Ausgaenge tatsaechlich getroffen haben, sonst prueft er nichts.
  assert.ok(exits > 100 && jumps > 100 && steps > 100 && invalid > 100,
    `Ausgaenge zu einseitig: EXIT ${exits}, JUMP ${jumps}, STEP ${steps}, INVALID ${invalid}`);
});

test('Zusatz 7: path und jumped sind strukturell korrekt', () => {
  const bretter = [vol(4, 4, 4), fas(5, 5, 4), vol(5, 2, 3)];
  const rng = mulberry32(4711);
  let gesehen = { STEP: 0, JUMP: 0, EXIT: 0, INVALID: 0 };

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

      if (m.kind === 'INVALID') {
        assert.deepEqual(m.path, [c]);
        assert.equal(m.to, OUT);
        assert.equal(m.jumps, 0);
        if (m.reason === 'BLOCKED') {
          assert.equal(m.jumped.length, 1);
          assert.equal(m.jumped[0], b.step[c * 6 + d]);
          assert.notEqual(state.occ[m.jumped[0]], EMPTY);
          assert.notEqual(b.step[m.jumped[0] * 6 + d], OUT);
          assert.notEqual(state.occ[b.step[m.jumped[0] * 6 + d]], EMPTY);
        } else {
          assert.deepEqual(m.jumped, []);
        }
        continue;
      }

      assert.equal(m.jumped.length, m.jumps, 'jumped.length !== jumps');
      if (m.kind === 'STEP') {
        assert.equal(m.path.length, 2);
        assert.equal(m.jumps, 0);
        assert.equal(m.to, m.path[1]);
        assert.equal(m.path[1], b.step[c * 6 + d]);
        assert.equal(state.occ[m.to], EMPTY);
      } else if (m.kind === 'JUMP') {
        assert.equal(m.path.length, m.jumps + 1);
        assert.ok(m.jumps >= 1);
        assert.equal(m.to, m.path[m.path.length - 1]);
        assert.equal(state.occ[m.to], EMPTY);
      } else {
        assert.equal(m.to, OUT);
        assert.equal(m.path.length, Math.max(1, m.jumps));
      }

      // Der Zug laeuft auf dem Strahl: jumped[k] liegt zwischen path[k] und path[k+1].
      for (let k = 0; k < m.jumped.length; k++) {
        assert.equal(m.jumped[k], b.step[m.path[k] * 6 + d], 'jumped nicht auf dem Strahl');
        assert.notEqual(state.occ[m.jumped[k]], EMPTY, 'jumped-Zelle war nicht besetzt');
      }
      if (m.kind !== 'STEP')
        for (let k = 0; k + 1 < m.path.length; k++)
          assert.equal(m.path[k + 1], b.step[m.jumped[k] * 6 + d], 'path nicht auf dem Strahl');
      for (let k = 1; k < m.path.length; k++)
        assert.equal(state.occ[m.path[k]], EMPTY, 'Landepunkt war besetzt');
      assert.equal(new Set([...m.path, ...m.jumped]).size, m.path.length + m.jumped.length);
    }
  }
  for (const k of ['STEP', 'JUMP', 'EXIT', 'INVALID'])
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
  const cubes = [{ cell: X(b, 4), dir: PX }, { cell: X(b, 3), dir: PX, target: true }];

  const abbau = createState(b, cubes, 'ABBAU');
  assert.equal(abbau.targetId, 1);
  assert.equal(isSolved(abbau), false);
  applyMove(abbau, resolveMove(b, abbau, X(b, 3)));   // RF-3: springt ueber X4 hinaus
  assert.equal(abbau.aliveCount, 1);
  assert.equal(isSolved(abbau), false, 'ABBAU ist erst bei aliveCount 0 geloest');
  applyMove(abbau, resolveMove(b, abbau, X(b, 4)));
  assert.equal(abbau.aliveCount, 0);
  assert.equal(isSolved(abbau), true);

  const befreiung = createState(b, cubes, 'BEFREIUNG');
  assert.equal(befreiung.targetId, 1);
  assert.equal(isSolved(befreiung), false);
  // Der Nicht-Zielwuerfel verlaesst das Gitter: das loest nichts aus.
  applyMove(befreiung, resolveMove(b, befreiung, X(b, 4)));
  assert.equal(isSolved(befreiung), false);
  // Jetzt der gruene Wuerfel; der Restturm darf stehenbleiben.
  const restZustand = createState(b, cubes, 'BEFREIUNG');
  const zugZiel = resolveMove(b, restZustand, X(b, 3));
  assert.equal(zugZiel.kind, 'EXIT');
  applyMove(restZustand, zugZiel);
  assert.equal(isSolved(restZustand), true);
  assert.equal(restZustand.aliveCount, 1, 'Restturm bleibt stehen');
  revertMove(restZustand, zugZiel);
  assert.equal(isSolved(restZustand), false, 'Undo dreht den Sieg zurueck');
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

test('Regression A: createState akzeptiert in FASSADE nur die vier Wandrichtungen', () => {
  // Befund: `brauchbar` liess d=4/5 durch. Da step[i*6+4] in FASSADE ueberall OUT ist, war
  // jeder so verfaelschte Wuerfel lebendig und lieferte bei jedem Tipp sofort EXIT — ein
  // Level, dessen Richtungen auf 4 gedreht wurden, war trivial loesbar (SPEC §2.3, §10.4).
  const b = fas(4, 4, 4);
  assert.equal(b.C, 52, 'Vorbedingung: Kontrollwert aus §2.3');
  for (const d of [4, 5]) {
    const cubes = [];
    for (let c = 0; c < b.C; c++) {
      assert.equal(b.valid[c * 6 + d], 0, 'Vorbedingung: Richtung ist auf dem Brett ungueltig');
      assert.equal(b.step[c * 6 + d], OUT, 'Vorbedingung: Schritt fuehrt nirgendwohin');
      cubes.push({ cell: c, dir: d });
    }
    const state = createState(b, cubes, 'ABBAU');
    assert.equal(state.cubeCount, b.C, 'jeder Eintrag bekommt trotzdem eine Id');
    assert.equal(state.aliveCount, 0, `Richtung ${d} darf in FASSADE keinen Wuerfel erzeugen`);
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
  const gut = [{ cell: F(b, 0, 0, 0), dir: 0 }, { cell: F(b, 0, 1, 0), dir: 1 },
               { cell: F(b, 2, 0, 0), dir: 2 }];
  const heil = createState(b, gut, 'ABBAU');
  assert.equal(heil.aliveCount, 3);
  const verfaelscht = createState(b, [gut[0], { ...gut[1], dir: 4 }, gut[2]], 'ABBAU');
  assert.equal(verfaelscht.aliveCount, 2);
  assert.equal(verfaelscht.alive[1], 0);
  assert.equal(verfaelscht.occ[gut[1].cell], EMPTY, 'die Zelle bleibt leer, statt zu leben');

  // In VOLUMEN sind alle sechs Richtungen gueltig und muessen weiterhin durchgehen.
  const v = vol(3, 3, 3);
  for (let d = 0; d < 6; d++) {
    const s = createState(v, [{ cell: V(v, 1, 1, 1), dir: d }], 'ABBAU');
    assert.equal(s.aliveCount, 1, `VOLUMEN: Richtung ${d} muss erlaubt bleiben`);
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
    jumps: 0, path: [cell], jumped: []
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
  const level = levelAus([{ cell: X(b, 0), dir: PX }, { cell: X(b, 4), dir: PX }]);
  const ses = createSession(b, level);

  assert.equal(tap(ses, X(b, 0)).kind, 'STEP');
  assert.equal(ses.moves, 1);
  assert.deepEqual(ses.taps, [X(b, 0)]);

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
  assert.equal(tap(ses, X(b, 0)).kind, 'STEP');      // der Zug, der zurueckgenommen wird
  assert.equal(tap(ses, X(b, 3)).kind, 'INVALID');   // leere Zelle, nach dem Zug
  assert.deepEqual(ses.taps, [X(b, 2), X(b, 0), X(b, 3)]);
  assert.equal(ses.moves, 1);

  assert.equal(undo(ses), true);
  assert.deepEqual(ses.taps, [X(b, 2)], 'ungueltige Tipps vor dem Zug bleiben erhalten');
  assert.equal(ses.moves, 0);

  assert.equal(tap(ses, X(b, 4)).kind, 'EXIT');
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
  const bretter = [vol(4, 3, 3), fas(4, 4, 4), vol(5, 2, 3)];
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
