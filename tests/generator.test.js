// SPEC §10.3 — Generator und Loesbarkeitsgarantie.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildBoard, cellIndexOf, createState, emptyState,
  resolveMove, applyMove, isSolved,
  OUT, EMPTY, MAX_CUBES, RULE_VERSION
} from '../public/src/game.js';

import {
  GEN_VERSION, generateLevel, generateFromCode, generateForLevelNo,
  verifyLevel, replayTaps, solveGreedy,
  levelSpecFor, encodeLevelCode, parseLevelCode, encodeHash, parseHash,
  measureLevel, fillByDepth, pruefeUnExit, pruefeUnRelocate,
  mulberry32
} from '../public/src/levels.js';

// --- Werkzeug -----------------------------------------------------------

const vol = (W, H, D) => buildBoard({ mode: 'VOLUMEN', W, H, D });
const V = (b, x, y, z) => cellIndexOf(b, `V:${x}:${y}:${z}`);
const PX = 0, PY = 2;

/** Reihe y=0, z=0 eines VOLUMEN-Bretts. */
const X = (b, x) => V(b, x, 0, 0);

function zustand(board, cubes, goal = 'ABBAU') {
  return createState(board, cubes, goal);
}

/** Spielt eine Zellfolge ab und liefert die Zuege; bricht bei INVALID ab. */
function spiele(board, state, zellen) {
  const zuege = [];
  for (const c of zellen) {
    const m = resolveMove(board, state, c);
    zuege.push(m);
    if (m.kind === 'INVALID') break;
    applyMove(state, m);
  }
  return zuege;
}

// --- 1. Sechs Regressionsfixtures N1 bis N6 (SPEC §6.2, §10.3.1) --------
//
// Jede Ausfallart konstruiert einen Zustand, in dem der naive Rueckwaertskandidat
// plausibel aussieht. Der Kandidatentest — resolveMove(...).to === b bzw. === OUT — MUSS
// ihn verwerfen. Diese sechs Tests sind die einzige Absicherung dagegen, dass ein
// spaeterer Umbau des Generators die Loesbarkeitsgarantie stumm bricht.

test('N1 Ketten-Ueberschuss: die Kette laeuft ueber das geplante Ziel hinaus', () => {
  const b = vol(5, 2, 3);
  // q steht auf X2; Traeger auf X1 und X3, X4 frei.
  const st = zustand(b, [
    { cell: X(b, 1), dir: PX },
    { cell: X(b, 2), dir: PX },   // cubeId 1 = q
    { cell: X(b, 3), dir: PX }
  ]);
  const pr = pruefeUnRelocate(b, st, 1, X(b, 0), X(b, 2), 4);
  assert.equal(pr.move.kind, 'JUMP');
  assert.equal(pr.move.to, X(b, 4), 'Kette schiesst ueber B hinaus');
  assert.equal(pr.ok, false);
  // Der Zustand ist nach der Pruefung unveraendert.
  assert.equal(st.occ[X(b, 2)], 1);
  assert.equal(st.occ[X(b, 0)], EMPTY);
});

test('N2 Ketten-Unterschuss: die Kette stoppt vor dem geplanten Ziel', () => {
  const b = vol(5, 2, 3);
  const st = zustand(b, [
    { cell: X(b, 1), dir: PX },
    { cell: X(b, 4), dir: PX }    // cubeId 1 = q
  ]);
  const pr = pruefeUnRelocate(b, st, 1, X(b, 0), X(b, 4), 4);
  assert.equal(pr.move.kind, 'JUMP');
  assert.equal(pr.move.to, X(b, 2), 'Kette endet zu frueh, weil X3 frei ist');
  assert.equal(pr.ok, false);
});

test('N3 Schritt statt Sprung: A+d ist frei, die Regel liefert STEP', () => {
  const b = vol(5, 2, 3);
  // Der Blocker bei x=4 ist ab RULE_VERSION 2 noetig: ohne ihn waere die Bahn frei und
  // die Regel lieferte einen Austritt durch Rutschen (R0) statt eines Schrittes.
  const st = zustand(b, [{ cell: X(b, 2), dir: PX }, { cell: X(b, 4), dir: PX }]);
  const pr = pruefeUnRelocate(b, st, 0, X(b, 0), X(b, 2), 4);
  assert.equal(pr.move.kind, 'STEP');
  assert.equal(pr.move.to, X(b, 1));
  assert.equal(pr.ok, false);
});

test('N4 Feste Pfeile: unRelocate benutzt die BESTEHENDE Richtung des Wuerfels', () => {
  const b = vol(5, 5, 3);
  const bZelle = V(b, 2, 1, 0);
  const aZelle = V(b, 1, 1, 0);
  // Zwei ruhende Blocker halten beide Bahnen verstellt; ab RULE_VERSION 2 wuerde die
  // Regel sonst rutschen lassen statt einen Schritt zu liefern.
  const blockerOben = { cell: V(b, 1, 3, 0), dir: PY };
  const blockerRechts = { cell: V(b, 4, 1, 0), dir: PX };

  // q zeigt nach oben (PY). Der naive Kandidat entlang der X-Achse setzt stillschweigend
  // eine frei gewaehlte Richtung voraus und ist deshalb zu verwerfen.
  const stPY = zustand(b, [{ cell: bZelle, dir: PY }, blockerOben, blockerRechts]);
  const prPY = pruefeUnRelocate(b, stPY, 0, aZelle, bZelle, 4);
  assert.equal(prPY.move.kind, 'STEP');
  assert.equal(prPY.move.to, V(b, 1, 2, 0), 'der Wuerfel zieht nach oben, nicht nach B');
  assert.equal(prPY.ok, false);

  // Gegenprobe: mit frei gewaehlter Richtung PX waere derselbe Kandidat akzeptiert worden.
  const stPX = zustand(b, [{ cell: bZelle, dir: PX }, blockerOben, blockerRechts]);
  const prPX = pruefeUnRelocate(b, stPX, 0, aZelle, bZelle, 4);
  assert.equal(prPX.ok, true);
  assert.equal(prPX.move.to, bZelle);
});

test('N5 Zustandsdrift: geprueft wird der Zustand zur Zugzeit, nicht der Endzustand', () => {
  // Ab RULE_VERSION 2 macht ein duennerer Zustand einen Austritt eher moeglich, nicht
  // seltener. Der Nachweis der Zustandsdrift laeuft deshalb ueber die Sprungkette: sie
  // traegt den Wuerfel nur dann hinaus, wenn der zweite Traeger schon steht.
  const b = vol(5, 2, 3);
  const duenn = zustand(b, [{ cell: X(b, 2), dir: PX }]);          // nur ein Traeger
  const prDuenn = pruefeUnExit(b, duenn, X(b, 1), PX, 4);
  assert.equal(prDuenn.move.kind, 'JUMP', 'im Zustand zur Zugzeit endet die Kette im Gitter');
  assert.equal(prDuenn.ok, false);

  const dicht = zustand(b, [{ cell: X(b, 2), dir: PX }, { cell: X(b, 4), dir: PX }]);
  const prDicht = pruefeUnExit(b, dicht, X(b, 1), PX, 4);
  assert.equal(prDicht.move.kind, 'EXIT');
  assert.equal(prDicht.move.jumps, 2);
  assert.equal(prDicht.ok, true, 'gegen den Endzustand geprueft saehe der Kandidat gut aus');
});

test('N6 Austritts-Umkehr: im dichteren Zustand tritt der Wuerfel nicht mehr aus', () => {
  const b = vol(5, 2, 3);
  const frueher = zustand(b, [{ cell: X(b, 2), dir: PX }, { cell: X(b, 4), dir: PX }]);
  const prFrueh = pruefeUnExit(b, frueher, X(b, 1), PX, 4);
  assert.equal(prFrueh.move.kind, 'EXIT');
  assert.equal(prFrueh.move.jumps, 2);
  assert.equal(prFrueh.ok, true);

  const spaeter = zustand(b, [
    { cell: X(b, 2), dir: PX }, { cell: X(b, 3), dir: PX }, { cell: X(b, 4), dir: PX }
  ]);
  const prSpaet = pruefeUnExit(b, spaeter, X(b, 1), PX, 4);
  assert.equal(prSpaet.move.kind, 'INVALID');
  assert.equal(prSpaet.move.reason, 'BLOCKED');
  assert.equal(prSpaet.ok, false, 'die Landezelle wurde inzwischen belegt');
});

test('N-Fixtures: maxChain wird im Kandidatenfilter durchgesetzt, nicht als Nachfilter', () => {
  const b = vol(5, 2, 3);
  const st = zustand(b, [{ cell: X(b, 2), dir: PX }, { cell: X(b, 4), dir: PX }]);
  assert.equal(pruefeUnExit(b, st, X(b, 1), PX, 2).ok, true);
  assert.equal(pruefeUnExit(b, st, X(b, 1), PX, 1).ok, false, 'jumps=2 ueber maxChain=1');
});

// --- 2. Prepend-Semantik (SPEC §10.3.2) ---------------------------------

/** Minimales, von Hand nachgerechnetes Level. */
function handLevel(b, cubes, witness) {
  const par = witness.length;
  return {
    v: 1, ruleVersion: RULE_VERSION, genVersion: GEN_VERSION,
    seed: 1, attempt: 0, mode: b.mode, goal: 'ABBAU',
    dims: { W: b.W, H: b.H, D: b.D },
    levelCode: encodeLevelCode({ mode: b.mode, goal: 'ABBAU', W: b.W, H: b.H, D: b.D, attempt: 0, seed: 1 }),
    cubes, targetId: null, witness, par,
    stars: [par, par, par],
    metrics: { density: 0, chainShare: 0, maxChain: 0, mobility: 0, naivePerPar: 0, trivialExit: 0 }
  };
}

test('2. Prepend-Semantik: ref.push statt ref.unshift wird von verifyLevel abgelehnt', () => {
  // Drei Wuerfel in einer Reihe, alle nach +X: der hinterste ist anfangs eingeklemmt
  // (n1 und n2 besetzt) und wird erst frei, wenn die beiden vor ihm gegangen sind.
  // Ab RULE_VERSION 2 ist das der Fall, an dem sich die Reihenfolge noch entscheidet:
  // ein Austritt macht andere Wuerfel nie schlechter, wohl aber ein zu frueher Tipp.
  const b = vol(4, 2, 3);
  const cubes = [
    { cell: X(b, 0), dir: PX, target: false },
    { cell: X(b, 1), dir: PX, target: false },
    { cell: X(b, 2), dir: PX, target: false }
  ];
  const richtig = handLevel(b, cubes, [X(b, 2), X(b, 1), X(b, 0)]);
  assert.equal(verifyLevel(richtig).ok, true);

  const falsch = handLevel(b, cubes, [X(b, 0), X(b, 1), X(b, 2)]);   // push-Reihenfolge
  const ver = verifyLevel(falsch);
  assert.equal(ver.ok, false);
  // Der zu fruehe Tipp trifft einen eingeklemmten Wuerfel: die Verifikation bricht
  // schon beim ersten Zug ab, statt erst am Ende einen Rest festzustellen.
  assert.equal(ver.reason, 'invalid@0');

  // Dasselbe an echten Generatorleveln: die umgedrehte Referenz faellt durch.
  for (const n of [2, 5, 14, 24]) {
    const lv = generateForLevelNo(n);
    const gedreht = Object.assign({}, lv, { witness: lv.witness.slice().reverse() });
    assert.equal(verifyLevel(gedreht).ok, false, 'Level ' + n);
  }
});

// --- 3. Fuellsatz (SPEC §6.5, §10.3.3) ----------------------------------

/** Alle Dimensionen aus SPEC §10.1.2. */
function alleDims() {
  const res = [];
  for (let W = 3; W <= 8; W++)
    for (let H = 2; H <= 8; H++)
      for (let D = 3; D <= 8; D++) res.push({ W, H, D });
  return res;
}

test('3. fillByDepth fuellt das leere Brett zu 100 Prozent und raeumt es restlos ab', () => {
  let geprueft = 0;
  for (const mode of ['FASSADE', 'VOLUMEN']) {
    for (const { W, H, D } of alleDims()) {
      const board = buildBoard({ mode, W, H, D });
      const state = emptyState(board, board.C, 'ABBAU');
      const ref = [], info = [];
      fillByDepth(board, state, ref, mulberry32(0xA11 ^ (W * 900 + H * 30 + D)), { info });

      assert.equal(state.aliveCount, board.C, `${mode} ${W}x${H}x${D}: nicht vollstaendig`);
      assert.equal(info.length, ref.length);
      // Genau ein Austritt je Wuerfel; alle uebrigen Referenzzuege sind Schritte im
      // freien Korridor (siehe Kommentar zu austrittsfolge in levels.js).
      assert.equal(info.filter((e) => e.kind === 'EXIT').length, board.C);
      for (const e of info) assert.ok(e.kind === 'EXIT' || e.kind === 'STEP', e.kind);

      // Die Referenz ist vom Startzustand aus vollstaendig legal und raeumt den Turm ab.
      const cubes = [];
      for (let c = 0; c < board.C; c++) {
        const id = state.occ[c];
        cubes.push({ cell: c, dir: state.dirOf[id], target: false });
      }
      const frisch = createState(board, cubes, 'ABBAU');
      const zuege = spiele(board, frisch, ref);
      for (const m of zuege) assert.notEqual(m.kind, 'INVALID');
      assert.equal(frisch.aliveCount, 0, `${mode} ${W}x${H}x${D}: Referenz raeumt nicht ab`);
      geprueft++;
    }
  }
  assert.equal(geprueft, 504);
});

// --- 4. Kennzahlen ueber viele Level (SPEC §10.3.4) ---------------------

/** SPEC §10.3.4 verlangt 100 Level je Modus und Zielmodus. */
const LEVEL_JE_KOMBINATION = 100;

test('4. Kennzahlen: maxChain, Dichte, restloser Abbau, Befreiungspraefix', () => {
  for (const mode of ['FASSADE', 'VOLUMEN']) {
    for (const goal of ['ABBAU', 'BEFREIUNG']) {
      for (let i = 0; i < LEVEL_JE_KOMBINATION; i++) {
        const spec = {
          seed: (0x1000 + i * 7919) >>> 0, attempt: 0,
          mode, goal, W: 3, H: 3, D: 3
        };
        const level = generateLevel(spec);
        const ver = verifyLevel(level);
        assert.equal(ver.ok, true, `${mode}/${goal}/${i}: ${ver.reason}`);

        const board = buildBoard({ mode, W: 3, H: 3, D: 3 });
        // Die Sollwerte kommen aus dem Levelcode, also aus genau der Quelle, aus der auch
        // der Worker das Level regeneriert.
        const soll = parseLevelCode(level.levelCode);
        assert.ok(level.metrics.maxChain <= soll.maxChain, `${mode}/${goal}/${i}: maxChain`);

        // Dichte = Anteil belegter ZELLEN. Ein 2x1-Stein belegt zwei; die Steinzahl
        // allein waere von der Steinform abhaengig (SPEC §3.5).
        const zustandDichte = createState(board, level.cubes, goal);
        let belegt = 0;
        for (let c = 0; c < board.C; c++) if (zustandDichte.occ[c] !== -1) belegt++;
        const dichte = belegt / board.C;
        assert.ok(dichte >= soll.density - 0.02, `${mode}/${goal}/${i}: Dichte ${dichte}`);
        // metrics.density wird gerundet ausgeliefert (SPEC §3.5), deshalb mit Toleranz.
        assert.ok(Math.abs(level.metrics.density - dichte) < 0.005,
          `${mode}/${goal}/${i}: metrics.density ${level.metrics.density} vs ${dichte}`);

        // Kein Referenzzug ueberschreitet maxChain der Spec.
        const state = createState(board, level.cubes, goal);
        const zuege = spiele(board, state, level.witness);
        for (const m of zuege) {
          assert.notEqual(m.kind, 'INVALID');
          assert.ok(m.jumps <= soll.maxChain, `${mode}/${goal}/${i}: jumps ${m.jumps}`);
        }
        if (goal === 'ABBAU') {
          assert.equal(state.aliveCount, 0, 'ABBAU raeumt den Turm restlos ab');
          assert.equal(level.targetId, null);
        } else {
          const letzter = zuege[zuege.length - 1];
          assert.equal(letzter.kind, 'EXIT', 'BEFREIUNG-Praefix endet mit einem Austritt');
          assert.equal(letzter.cubeId, level.targetId, 'und zwar dem des Zielwuerfels');
          assert.equal(state.alive[level.targetId], 0);
          assert.ok(isSolved(state));
        }
      }
    }
  }
});

// --- 5. Stockungspfad und Fuellrueckfall (SPEC §10.3.5) -----------------

test('5. erzwungene Sackgasse: Fuellrueckfall greift und liefert ein verifiziertes Level', () => {
  // In einem 5x5x5-Quader hat die Mittelzelle in JEDER Richtung die Austrittstiefe 2.
  // Ein Austritt in einem einzigen Zug ist dort in keinem Zustand moeglich (ein Sprung
  // landet stets wieder im Gitter). Eine Dichte von 1.0 ist deshalb nur ueber den
  // Fuellrueckfall aus SPEC §6.5 erreichbar.
  const level = generateLevel({
    seed: 4242, attempt: 0, mode: 'VOLUMEN', goal: 'ABBAU',
    W: 5, H: 5, D: 5, density: 1.0, maxChain: 1, dominoRate: 0
  });
  const board = buildBoard({ mode: 'VOLUMEN', W: 5, H: 5, D: 5 });
  assert.equal(level.cubes.length, board.C, 'das Gitter ist vollstaendig gefuellt');
  // Ab RULE_VERSION 2 raeumt der Fuellrueckfall seinen Korridor in EINEM Rutschzug ab,
  // statt Feld fuer Feld zu schreiten; par ist deshalb nicht mehr groesser als die
  // Wuerfelzahl. Gepruefte Aussage bleibt: das volle Gitter ist nur ueber den
  // Fuellrueckfall erreichbar und der so erzeugte Zeuge loest es restlos auf.
  assert.ok(level.par >= level.cubes.length, 'jeder Wuerfel braucht mindestens einen Tipp');
  assert.equal(verifyLevel(level).ok, true);

  const state = createState(board, level.cubes, 'ABBAU');
  for (const m of spiele(board, state, level.witness)) assert.ok(m.jumps <= 1);
  assert.equal(state.aliveCount, 0);
});

test('5b. unRelocate erzeugt par > N und bleibt verifizierbar', () => {
  // Standardmaessig ist relocateRate 0 (SPEC §6.11). Der Zweig darf trotzdem nicht
  // ungetestet bleiben: er ist die zweite Rueckwaertsoperation aus SPEC §6.3.
  for (const seed of [1, 2, 3]) {
    const level = generateLevel({
      seed, attempt: 0, mode: 'VOLUMEN', goal: 'ABBAU',
      W: 4, H: 4, D: 4, relocateRate: 0.8
    });
    assert.equal(verifyLevel(level).ok, true, 'seed ' + seed);
    assert.ok(level.par > level.cubes.length, 'zurueckgezogene Wuerfel kosten Extrazuege');

    const board = buildBoard({ mode: 'VOLUMEN', W: 4, H: 4, D: 4 });
    const state = createState(board, level.cubes, 'ABBAU');
    for (const m of spiele(board, state, level.witness)) assert.notEqual(m.kind, 'INVALID');
    assert.equal(state.aliveCount, 0);
  }
});

// --- 6. Codes (SPEC §10.3.6) --------------------------------------------

test('6. parseLevelCode(encodeLevelCode(spec)) ist die Identitaet', () => {
  const felder = ['mode', 'goal', 'W', 'H', 'D', 'attempt', 'seed'];
  for (let n = 1; n <= 60; n++) {
    for (const attempt of [0, 3, 11]) {
      const spec = Object.assign(levelSpecFor(n), { attempt });
      const code = encodeLevelCode(spec);
      assert.match(code, /^[FV]-[AB]-\d+x\d+x\d+-\d{1,2}-[0-9A-F]{8}$/);
      assert.ok(code.includes('-' + attempt + '-'), 'attempt steht im Code');
      const zurueck = parseLevelCode(code);
      for (const f of felder) assert.deepEqual(zurueck[f], spec[f], f + ' in ' + code);
      // Auch die abgeleiteten Generatorparameter muessen sich ergeben.
      assert.equal(zurueck.density, spec.density);
      assert.equal(zurueck.maxChain, spec.maxChain);
      assert.equal(zurueck.targetQuantile, spec.targetQuantile);

      const hash = encodeHash(spec);
      const ausHash = parseHash(hash);
      assert.notEqual(ausHash, null);
      for (const f of felder) assert.deepEqual(ausHash[f], spec[f], f + ' in ' + hash);
    }
  }
  assert.equal(encodeLevelCode({ mode: 'FASSADE', goal: 'ABBAU', W: 4, H: 5, D: 4, attempt: 0, seed: 0x0008FA3C }),
    'F-A-4x5x4-0-0008FA3C');
  assert.equal(encodeHash({ mode: 'FASSADE', goal: 'ABBAU', W: 5, H: 7, D: 5, attempt: 0, seed: 0x8fa3c }),
    '#s=8fa3c&m=FASSADE&g=ABBAU&d=5x7x5&a=0&r=2&gv=2');

  assert.throws(() => parseLevelCode('X-A-4x5x4-0-0008FA3C'), Error);
  assert.throws(() => parseLevelCode('F-A-4x5x4-12-0008FA3C'), Error);
  assert.throws(() => parseLevelCode('F-A-2x5x4-0-0008FA3C'), RangeError);
  assert.equal(parseHash('#s=1&m=FASSADE&g=ABBAU&d=4x5x4&a=0&r=99&gv=1'), null);
  assert.equal(parseHash('unsinn'), null);
});

test('6b. generateFromCode regeneriert das Level bitgleich', () => {
  for (const n of [1, 6, 10, 15, 20, 27, 35, 41]) {
    const level = generateForLevelNo(n);
    const wieder = generateFromCode(level.levelCode);
    assert.equal(JSON.stringify(wieder), JSON.stringify(level), 'Level ' + n);
  }
});

// --- 7. Determinismus (SPEC §10.3.7) ------------------------------------

test('7. derselbe Seed erzeugt bitgleiche Level, auch nach einem Zwischenlauf', () => {
  const a = JSON.stringify(generateForLevelNo(7));
  generateForLevelNo(33);
  generateLevel({ seed: 987654, attempt: 0, mode: 'VOLUMEN', goal: 'BEFREIUNG', W: 4, H: 4, D: 4 });
  const b = JSON.stringify(generateForLevelNo(7));
  assert.equal(a, b);

  const c = JSON.stringify(generateLevel(levelSpecFor(12)));
  const d = JSON.stringify(generateLevel(levelSpecFor(12)));
  assert.equal(c, d);
});

test('7b. game.js und levels.js referenzieren keine Laufzeitquelle von Zufall oder Zeit', () => {
  const dateien = ['../public/src/game.js', '../public/src/levels.js'];
  // Kommentare werden entfernt: verboten sind Referenzen im Quelltext, nicht Erwaehnungen
  // in der Dokumentation der Regel selbst.
  const ohneKommentar = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const rel of dateien) {
    const pfad = fileURLToPath(new URL(rel, import.meta.url));
    const quelle = ohneKommentar(readFileSync(pfad, 'utf8'));
    for (const verboten of ['Math.random', 'Date.', 'performance.', 'document', 'window', 'three']) {
      assert.equal(quelle.includes(verboten), false, `${rel} enthaelt ${verboten}`);
    }
  }
});

// --- 8. Deckel (SPEC §10.3.8) -------------------------------------------

test('8. levelSpecFor haelt MAX_CUBES und die Groessendeckel fuer n in [1,500]', () => {
  for (let n = 1; n <= 500; n++) {
    const spec = levelSpecFor(n);
    assert.ok(spec.W >= 3 && spec.D >= 3 && spec.H >= 2);
    assert.ok(spec.W <= 6 && spec.D <= 6, 'Grundflaechendeckel 6 bei n=' + n);
    assert.ok(spec.H <= (spec.mode === 'VOLUMEN' ? 10 : 16), 'Hoehendeckel bei n=' + n);
    const board = buildBoard({ mode: spec.mode, W: spec.W, H: spec.H, D: spec.D });
    assert.ok(board.C <= MAX_CUBES);
    assert.ok(Math.round(spec.density * board.C) <= MAX_CUBES);
    assert.ok(spec.maxChain >= 1 && spec.maxChain <= 4);
    assert.equal(spec.relocateRate, 0);
  }
  // Stichprobe: die erzeugten Level bleiben unter der Obergrenze.
  for (const n of [1, 9, 19, 31, 41, 200, 500]) {
    const level = generateForLevelNo(n);
    assert.ok(level.cubes.length <= MAX_CUBES);
    assert.equal(verifyLevel(level).ok, true);
  }
});

// --- 9. Unabhaengiger Solver (SPEC §6.10) -------------------------------

test('9. solveGreedy endet an Generatorleveln nie ohne einen einzigen Zug', () => {
  const rng = mulberry32(0xBEEF);
  for (const n of [1, 4, 9, 13, 19, 23, 31, 41]) {
    const level = generateForLevelNo(n);
    const board = buildBoard({ mode: level.mode, W: level.dims.W, H: level.dims.H, D: level.dims.D });
    const state = createState(board, level.cubes, level.goal);
    for (let k = 0; k < 5; k++) {
      const res = solveGreedy(board, state, rng);
      assert.ok(res.moves >= 1, 'Level ' + n + ' startet in einer Sackgasse');
      assert.ok(res.rest >= 0);
      assert.equal(state.aliveCount, level.cubes.length, 'solveGreedy arbeitet auf einer Kopie');
    }
    const kennz = measureLevel(board, level, 5);
    for (const s of ['density', 'chainShare', 'maxChain', 'mobility', 'naivePerPar', 'trivialExit'])
      assert.ok(Number.isFinite(kennz[s]), s);
  }
});

// --- 10. Verifikation im Produktivpfad ----------------------------------

test('10. generateLevel liefert nur verifizierte Level aus', () => {
  for (let n = 1; n <= 45; n++) {
    const level = generateForLevelNo(n);
    const ver = verifyLevel(level);
    assert.equal(ver.ok, true, 'Level ' + n + ': ' + ver.reason);
    assert.equal(ver.checked, level.witness.length);
    assert.equal(level.par, level.witness.length);
    assert.equal(level.stars[0], level.par);
    assert.ok(level.stars[1] >= level.stars[0] && level.stars[2] >= level.stars[1]);
    assert.equal(level.ruleVersion, RULE_VERSION);
    assert.equal(level.genVersion, GEN_VERSION);
    assert.ok(level.attempt >= 0 && level.attempt <= 11);
    // Wuerfelliste aufsteigend nach Zelle, Index === cubeId.
    for (let i = 1; i < level.cubes.length; i++)
      assert.ok(level.cubes[i].cell > level.cubes[i - 1].cell);
    // Der witness ist zugleich eine gueltige Tippfolge fuer den Worker.
    const rep = replayTaps(level, level.witness);
    assert.deepEqual(
      { ok: rep.ok, moves: rep.moves, invalid: rep.invalid, solved: rep.solved },
      { ok: true, moves: level.par, invalid: 0, solved: true }
    );
  }
});

test('10b. OUT und EMPTY bleiben die vereinbarten Sentinelwerte', () => {
  assert.equal(OUT, -1);
  assert.equal(EMPTY, -1);
  assert.equal(GEN_VERSION, 2);
});
