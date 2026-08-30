// SPEC §10.5 — Sitzung, Undo, Neustart, Replay und Zugbuchhaltung.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoard, cellIndexOf, createState,
  resolveMove, isSolved,
  createSession, tap, undo, restart, tickClock, toRunLog,
  EMPTY
} from '../public/src/game.js';

import { generateForLevelNo, verifyLevel, replayTaps } from '../public/src/levels.js';

// --- Werkzeug -----------------------------------------------------------

function brett(level) {
  return buildBoard({ mode: level.mode, W: level.dims.W, H: level.dims.H, D: level.dims.D });
}

/** Feldweiser Abzug eines Zustands. */
function abzug(state) {
  return {
    occ: Array.from(state.occ),
    cellOf: Array.from(state.cellOf),
    dirOf: Array.from(state.dirOf),
    alive: Array.from(state.alive),
    cubeCount: state.cubeCount,
    aliveCount: state.aliveCount,
    targetId: state.targetId,
    goal: state.goal
  };
}

/** Eine im Startzustand leere Zelle; ein Tipp darauf ist INVALID (RF-9). */
function leereZelle(board, state) {
  for (let c = 0; c < board.C; c++) if (state.occ[c] === EMPTY) return c;
  return -1;
}

const ABBAU_LEVEL = generateForLevelNo(4);        // FASSADE / ABBAU
const BEFREI_LEVEL = generateForLevelNo(10);      // FASSADE / BEFREIUNG
const VOL_LEVEL = generateForLevelNo(25);         // VOLUMEN / ABBAU

test('Vorbedingung: die benutzten Level sind verifiziert', () => {
  for (const l of [ABBAU_LEVEL, BEFREI_LEVEL, VOL_LEVEL]) assert.equal(verifyLevel(l).ok, true);
});

// --- 1. Zugbuchhaltung (SPEC §5.3, §10.5.1) -----------------------------

test('1. tap erhoeht moves nur bei gueltigen Zuegen; taps enthaelt auch ungueltige', () => {
  const board = brett(ABBAU_LEVEL);
  const s = createSession(board, ABBAU_LEVEL);
  const leer = leereZelle(board, s.state);
  assert.ok(leer >= 0, 'das Level laesst mindestens eine Zelle frei');

  const m1 = tap(s, leer);
  assert.equal(m1.kind, 'INVALID');
  assert.equal(m1.reason, 'DEAD');
  assert.equal(s.moves, 0, 'kein Zaehler');
  assert.equal(s.history.length, 0, 'kein Undo-Eintrag');
  assert.deepEqual(s.taps, [leer], 'der ungueltige Tipp steht trotzdem im Protokoll');

  const m2 = tap(s, ABBAU_LEVEL.witness[0]);
  assert.notEqual(m2.kind, 'INVALID');
  assert.equal(s.moves, 1);
  assert.equal(s.history.length, 1);
  assert.deepEqual(s.taps, [leer, ABBAU_LEVEL.witness[0]]);

  // Auch ein blockierter Wuerfel zaehlt nicht (RF-4).
  const b2 = buildBoard({ mode: 'VOLUMEN', W: 5, H: 2, D: 3 });
  const X = (x) => cellIndexOf(b2, `V:${x}:0:0`);
  const mini = {
    cubes: [{ cell: X(0), dir: 0 }, { cell: X(1), dir: 0 }, { cell: X(2), dir: 0 }],
    goal: 'ABBAU', levelCode: 'V-A-5x2x3-0-00000000', seed: 0, genVersion: 1, ruleVersion: 1
  };
  const s2 = createSession(b2, mini);
  const blockiert = tap(s2, X(0));
  assert.equal(blockiert.kind, 'INVALID');
  assert.equal(blockiert.reason, 'BLOCKED');
  assert.deepEqual(blockiert.blocker, [X(1)], 'der erste Blockierer wird benannt');
  assert.equal(s2.moves, 0);
  assert.equal(s2.taps.length, 1);
});

test('1b. die Spieluhr laeuft erst ab dem ersten gueltigen Zug', () => {
  const board = brett(ABBAU_LEVEL);
  const s = createSession(board, ABBAU_LEVEL);
  tickClock(s, 500);
  assert.equal(s.clockMs, 0);
  tap(s, ABBAU_LEVEL.witness[0]);
  tickClock(s, 500);
  tickClock(s, -10);
  assert.equal(s.clockMs, 500);
});

// --- 2. Vollstaendiges Undo (SPEC §10.5.2) ------------------------------

test('2. witness abspielen und alles zuruecknehmen ergibt exakt den Startzustand', () => {
  for (const level of [ABBAU_LEVEL, BEFREI_LEVEL, VOL_LEVEL]) {
    const board = brett(level);
    const start = abzug(createState(board, level.cubes, level.goal));
    const s = createSession(board, level);

    for (const cell of level.witness) {
      const m = tap(s, cell);
      assert.notEqual(m.kind, 'INVALID');
      tickClock(s, 120);
    }
    assert.equal(s.moves, level.par);
    assert.equal(s.won, true);
    assert.equal(isSolved(s.state), true);
    assert.equal(s.clockMs, 120 * level.par);

    let zurueck = 0;
    while (undo(s)) zurueck++;
    assert.equal(zurueck, level.par);
    assert.equal(s.moves, 0);
    assert.equal(s.clockMs, 0, 'die Uhr ist zurueckgedreht');
    assert.equal(s.undos, level.par);
    assert.equal(s.won, false);
    assert.deepEqual(abzug(s.state), start, 'feldweise identisch mit dem Startzustand');
    assert.equal(undo(s), false, 'ein leerer Verlauf liefert false');
  }
});

test('2b. taps bleibt nach Undo eine gueltige Tippfolge zu moves', () => {
  const level = ABBAU_LEVEL;
  const board = brett(level);
  const s = createSession(board, level);
  const leer = leereZelle(board, s.state);

  tap(s, level.witness[0]);
  tap(s, leer);                       // ungueltig
  tap(s, level.witness[1]);
  tap(s, level.witness[2]);
  assert.equal(s.moves, 3);
  undo(s);
  undo(s);
  assert.equal(s.moves, 1);

  const rep = replayTaps(level, s.taps);
  assert.equal(rep.ok, true);
  assert.equal(rep.moves, s.moves, 'das Replay ergibt genau die gezaehlten Zuege');
  assert.equal(rep.solved, false);
});

// --- 3. Neustart (SPEC §10.5.3) -----------------------------------------

test('3. restart stellt den Startzustand her; undos bleibt erhalten', () => {
  const level = BEFREI_LEVEL;
  const board = brett(level);
  const start = abzug(createState(board, level.cubes, level.goal));
  const s = createSession(board, level);

  for (const cell of level.witness.slice(0, 3)) tap(s, cell);
  tickClock(s, 900);
  undo(s);
  assert.equal(s.undos, 1);

  restart(s);
  assert.deepEqual(abzug(s.state), start);
  assert.equal(s.moves, 0);
  assert.equal(s.clockMs, 0);
  assert.deepEqual(s.taps, []);
  assert.deepEqual(s.history, []);
  assert.equal(s.won, false);
  assert.equal(s.undos, 1, 'Neustart loescht die Undo-Zaehlung nicht');

  // Nach dem Neustart traegt die Referenzloesung erneut.
  for (const cell of level.witness) assert.notEqual(tap(s, cell).kind, 'INVALID');
  assert.equal(s.won, true);
  assert.equal(s.moves, level.par);
});

// --- 4. Replay der Referenzloesung (SPEC §10.5.4) -----------------------

test('4. replayTaps(level, level.witness) loest das Level', () => {
  for (const level of [ABBAU_LEVEL, BEFREI_LEVEL, VOL_LEVEL]) {
    const r = replayTaps(level, level.witness);
    assert.deepEqual(
      { ok: r.ok, solved: r.solved, moves: r.moves, invalid: r.invalid },
      { ok: true, solved: true, moves: level.par, invalid: 0 }
    );
    assert.equal(r.timeLowerMs, Math.max(300, level.par * 60));
  }
});

// --- 5. Replay mit ungueltigen Tipps (SPEC §10.5.5) ---------------------

test('5. eingestreute ungueltige Tipps zaehlen invalid hoch und aendern moves nicht', () => {
  const level = ABBAU_LEVEL;
  const board = brett(level);
  const leer = leereZelle(board, createState(board, level.cubes, level.goal));
  const ausserhalb = board.C + 5;

  const taps = [leer, ...level.witness, leer, ausserhalb, -1];
  const r = replayTaps(level, taps);
  assert.equal(r.ok, true);
  assert.equal(r.moves, level.par, 'nur gueltige Zuege werden gezaehlt');
  assert.equal(r.invalid, 4);
  assert.equal(r.solved, true);

  // Ein Tipp mitten in die Loesung hinein, der ins Leere geht, aendert nichts.
  const mitten = level.witness.slice(0, 5).concat([leer], level.witness.slice(5));
  const r2 = replayTaps(level, mitten);
  assert.equal(r2.moves, level.par);
  assert.equal(r2.invalid, 1);
  assert.equal(r2.solved, true);
});

// --- 6. Manipulierte Zugliste (SPEC §10.5.6) ----------------------------

test('6. eine gekuerzte oder umgestellte Zugliste loest das Level nicht', () => {
  const level = ABBAU_LEVEL;

  const kurz = replayTaps(level, level.witness.slice(0, level.par - 1));
  assert.equal(kurz.ok, true);
  assert.equal(kurz.moves, level.par - 1);
  assert.equal(kurz.solved, false, 'das ist der serverseitige Anti-Cheat-Test');

  const leer = replayTaps(level, []);
  assert.equal(leer.moves, 0);
  assert.equal(leer.solved, false);

  const gedreht = replayTaps(level, level.witness.slice().reverse());
  assert.equal(gedreht.solved, false);
  assert.ok(gedreht.moves <= level.par);

  // BEFREIUNG: das Praefix vor dem Austritt des Zielwuerfels genuegt nicht.
  const b = replayTaps(BEFREI_LEVEL, BEFREI_LEVEL.witness.slice(0, BEFREI_LEVEL.par - 1));
  assert.equal(b.solved, false);
  assert.equal(replayTaps(BEFREI_LEVEL, BEFREI_LEVEL.witness).solved, true);

  // Ein Level, das gar nicht erst geprueft werden kann, liefert ok:false.
  const kaputt = Object.assign({}, level, { v: 2 });
  assert.deepEqual(replayTaps(kaputt, level.witness),
    { ok: false, moves: 0, invalid: 0, solved: false, timeLowerMs: 0 });
});

// --- 7. Sitzung und Bestenlistenzeile ------------------------------------

test('7. toRunLog uebernimmt Zugzahl, Undos, Uhr und Tippfolge', () => {
  const level = ABBAU_LEVEL;
  const board = brett(level);
  const s = createSession(board, level);
  const leer = leereZelle(board, s.state);

  tap(s, leer);
  for (const cell of level.witness) { tap(s, cell); tickClock(s, 75); }
  const log = toRunLog(s, {
    runId: '11111111-2222-4333-8444-555555555555',
    clientId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
    name: 'Testerin', appVersion: '0.1.0'
  });

  assert.equal(log.levelCode, level.levelCode);
  assert.equal(log.seed, level.seed);
  assert.equal(log.genVersion, level.genVersion);
  assert.equal(log.ruleVersion, level.ruleVersion);
  assert.equal(log.dirMode, 'fassade');
  assert.equal(log.goalMode, 'abbau');
  assert.deepEqual(log.size, { x: level.dims.W, y: level.dims.H, z: level.dims.D });
  assert.equal(log.cubes, level.cubes.length);
  assert.equal(log.moves, level.par);
  assert.equal(log.undos, 0);
  assert.equal(log.timeMs, 75 * level.par);
  assert.equal(log.taps.length, level.par + 1);
  assert.equal(log.name, 'Testerin');

  // Der Worker verifiziert genau diese Zeile ueber replayTaps (SPEC §9.4).
  const r = replayTaps(level, log.taps);
  assert.equal(r.solved, true);
  assert.equal(r.moves, log.moves);
  assert.ok(r.timeLowerMs <= log.timeMs);
});

test('8. jeder Zug veraendert genau einen Wuerfel (RF-12)', () => {
  const level = VOL_LEVEL;
  const board = brett(level);
  const s = createSession(board, level);
  for (const cell of level.witness) {
    const vorher = abzug(s.state);
    const m = tap(s, cell);
    assert.notEqual(m.kind, 'INVALID');
    const nachher = abzug(s.state);
    let geaendert = 0;
    for (let id = 0; id < nachher.cubeCount; id++)
      if (vorher.cellOf[id] !== nachher.cellOf[id] || vorher.alive[id] !== nachher.alive[id]) geaendert++;
    assert.equal(geaendert, 1, 'genau ein Stein verlaesst den Turm');
    assert.equal(m.path[0], m.from);
    assert.equal(m.kind, 'EXIT', 'die Regel kennt nur EXIT und INVALID');
    assert.deepEqual(m.blocker, []);
    // Die Bahn war frei und bleibt es: kein anderer Stein wird beruehrt.
    for (let k = 1; k < m.path.length; k++)
      assert.equal(nachher.occ[m.path[k]], -1, 'die Bahn ist nach dem Zug leer');
  }
  assert.equal(s.won, true);
  assert.equal(resolveMove(board, s.state, level.witness[0]).kind, 'INVALID');
});
