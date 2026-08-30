// SPEC §10.4 — Fuzz-Harness, die zentrale Garantiepruefung.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoard, cellIndexOf, createState, emptyState, validDirs,
  resolveMove, applyMove,
  EMPTY, RULE_VERSION
} from '../public/src/game.js';

import {
  GEN_VERSION, generateLevel, generateForLevelNo, verifyLevel, replayTaps,
  parseLevelCode, pruefeUnExit, pruefeUnRelocate
} from '../public/src/levels.js';

/**
 * Seed-Anzahl des Harness.
 *
 * SPEC §10.4 nennt 10 000 Seeds fuer den naechtlichen Lauf und 500 fuer `npm test`.
 * Gemessen kostet ein Seed (2 Modi x 2 Zielmodi x 3 Groessen = 12 verifizierte Level,
 * jedes mit bis zu 12 Versuchen nach SPEC §6.7) rund 330 ms. 150 Seeds ergeben damit
 * 1800 Level in etwa 50 Sekunden und halten den geforderten Rahmen von rund 90 Sekunden
 * auch auf langsamerer Hardware ein. Der vollstaendige Lauf mit 10 000 Seeds bleibt dem
 * separaten Fuzz-Ziel vorbehalten; er unterscheidet sich nur in dieser Konstanten.
 */
const FUZZ_SEEDS = 150;

const MODI = ['FASSADE', 'VOLUMEN'];
const ZIELE = ['ABBAU', 'BEFREIUNG'];
const MASSE = [[3, 3, 3], [4, 5, 4], [5, 6, 5]];

function median(werte) {
  const s = werte.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// --- Der Harness --------------------------------------------------------

test('Fuzz: verifyLevel().ok ist in allen Faellen true', { timeout: 600000 }, () => {
  /** @type {Map<string, {dichte:number[], parProN:number[], chainShare:number[], maxChain:number, soll:number}>} */
  const protokoll = new Map();
  let faelle = 0;

  for (let seed = 0; seed < FUZZ_SEEDS; seed++) {
    for (const mode of MODI) {
      for (const goal of ZIELE) {
        for (const [W, H, D] of MASSE) {
          const level = generateLevel({ seed, attempt: 0, mode, goal, W, H, D });
          const ver = verifyLevel(level);
          assert.equal(ver.ok, true,
            `seed=${seed} ${mode}/${goal}/${W}x${H}x${D}: ${ver.reason}`);
          assert.equal(ver.checked, level.witness.length);
          faelle++;

          const board = buildBoard({ mode, W, H, D });
          const soll = parseLevelCode(level.levelCode);
          const schluessel = `${mode}/${goal}/${W}x${H}x${D}`;
          let p = protokoll.get(schluessel);
          if (!p) {
            p = { dichte: [], parProN: [], chainShare: [], maxChain: 0, soll: soll.density, kette: soll.maxChain };
            protokoll.set(schluessel, p);
          }
          p.dichte.push(level.cubes.length / board.C);
          p.parProN.push(level.par / level.cubes.length);
          p.chainShare.push(level.metrics.chainShare);
          if (level.metrics.maxChain > p.maxChain) p.maxChain = level.metrics.maxChain;

          assert.ok(level.metrics.maxChain <= soll.maxChain, schluessel + ': maxChain');
        }
      }
    }
  }

  assert.equal(faelle, FUZZ_SEEDS * MODI.length * ZIELE.length * MASSE.length);

  // Der Fuellgrad wird als Kennzahl getrackt und als Untergrenze fixiert (SPEC §10.4).
  // Die Zielzahl ist round(density * C); das Runden kann den erreichbaren Fuellgrad um
  // bis zu 0.5/C unter die Zieldichte druecken, bei C = 25 also um 0.02. Deshalb wird
  // der Median gegen density - 0.02 gefuehrt, das Minimum wie gefordert gegen
  // density - 0.05.
  for (const [schluessel, p] of protokoll) {
    const med = median(p.dichte);
    const min = Math.min(...p.dichte);
    assert.ok(med >= p.soll - 0.02, `${schluessel}: Median-Fuellgrad ${med} < ${p.soll - 0.02}`);
    assert.ok(min >= p.soll - 0.05, `${schluessel}: Mindest-Fuellgrad ${min} < ${p.soll - 0.05}`);
    assert.ok(median(p.parProN) > 0, schluessel + ': par/N');
    assert.ok(p.maxChain <= p.kette, schluessel + ': maxChain');
  }
});

// --- Mutationstest (SPEC §10.4) -----------------------------------------
//
// Fuenf gezielte Verfaelschungen eines gueltigen Levels MUESSEN abgelehnt werden. Das
// beweist, dass verifyLevel tatsaechlich auf der serialisierten Beschreibung arbeitet und
// nicht auf dem Arbeitszustand des Generators.

function klon(level) {
  return JSON.parse(JSON.stringify(level));
}

test('Mutationstest: fuenf Verfaelschungen werden abgelehnt', () => {
  const abbau = generateForLevelNo(4);          // FASSADE / ABBAU
  const befreiung = generateForLevelNo(10);     // FASSADE / BEFREIUNG
  assert.equal(verifyLevel(abbau).ok, true);
  assert.equal(verifyLevel(befreiung).ok, true);
  const board = buildBoard({ mode: abbau.mode, ...abbau.dims });

  // 1. Zellindex verschoben
  const m1 = klon(abbau);
  m1.cubes[0].cell = m1.cubes[0].cell + 1;
  assert.notEqual(m1.cubes[0].cell, abbau.cubes[0].cell);
  assert.equal(verifyLevel(m1).ok, false, 'verschobener Zellindex');

  // 2. Richtung geaendert
  const m2 = klon(abbau);
  const k = Math.floor(m2.cubes.length / 2);
  const dirs = validDirs(board, m2.cubes[k].cell).filter((d) => d !== m2.cubes[k].dir);
  assert.ok(dirs.length > 0);
  m2.cubes[k].dir = dirs[0];
  assert.equal(verifyLevel(m2).ok, false, 'geaenderte Richtung');

  // 3. witness-Eintrag getauscht
  const m3 = klon(abbau);
  const letzte = m3.witness.length - 1;
  const t = m3.witness[0]; m3.witness[0] = m3.witness[letzte]; m3.witness[letzte] = t;
  assert.equal(verifyLevel(m3).ok, false, 'getauschter witness-Eintrag');

  // 4. par verfaelscht
  const m4 = klon(abbau);
  m4.par = m4.par + 1;
  const v4 = verifyLevel(m4);
  assert.equal(v4.ok, false, 'verfaelschter par');
  assert.equal(v4.reason, 'par');

  // 5. targetId geaendert
  const m5 = klon(befreiung);
  m5.targetId = (m5.targetId + 1) % m5.cubes.length;
  const v5 = verifyLevel(m5);
  assert.equal(v5.ok, false, 'geaenderte targetId');
  assert.equal(v5.reason, 'targetId');

  // Zugabe: fremde Versionen werden ohne Pruefung des witness abgelehnt.
  const mR = klon(abbau); mR.ruleVersion = RULE_VERSION + 1;
  assert.deepEqual(verifyLevel(mR), { ok: false, checked: 0, reason: 'ruleVersion' });
  const mG = klon(abbau); mG.genVersion = GEN_VERSION + 1;
  assert.deepEqual(verifyLevel(mG), { ok: false, checked: 0, reason: 'genVersion' });
  const mD = klon(abbau); mD.dims = { W: 2, H: 2, D: 2 };
  assert.equal(verifyLevel(mD).reason, 'dims');
  const mS = klon(abbau);
  mS.cubes = [mS.cubes[1], mS.cubes[0]].concat(mS.cubes.slice(2));
  assert.equal(verifyLevel(mS).ok, false, 'Wuerfelliste nicht aufsteigend');
  const mA = klon(abbau); mA.targetId = 0;
  assert.equal(verifyLevel(mA).reason, 'targetId', 'ABBAU hat keinen Zielwuerfel');

  // Eine Verfaelschung faellt auch dem Replay des Workers auf.
  assert.equal(replayTaps(m1, abbau.witness).solved, false);
});

// --- Regressionsfixtures N1 bis N6 (SPEC §6.2) --------------------------
//
// Die ausfuehrliche, benannte Fassung steht in tests/generator.test.js (SPEC §10.3.1).
// Hier laeuft dieselbe Tabelle noch einmal kompakt mit, weil der Fuzz-Harness und die
// sechs Ausfallarten zusammen die Loesbarkeitsgarantie tragen: der Harness zeigt, dass
// kein erzeugtes Level durchfaellt, die Fixtures zeigen, warum.

const V = (b, x, y, z) => cellIndexOf(b, `V:${x}:${y}:${z}`);
const PX = 0, PY = 2;

test('Regressionsfixtures N1 bis N6: der Kandidatentest verwirft jeden naiven Kandidaten', () => {
  const b = buildBoard({ mode: 'VOLUMEN', W: 5, H: 2, D: 3 });
  const X = (x) => V(b, x, 0, 0);
  const st = (cubes) => createState(b, cubes, 'ABBAU');

  // N1 Ketten-Ueberschuss: die Kette laeuft ueber B hinaus bis X4.
  const n1 = st([{ cell: X(1), dir: PX }, { cell: X(2), dir: PX }, { cell: X(3), dir: PX }]);
  const r1 = pruefeUnRelocate(b, n1, 1, X(0), X(2), 4);
  assert.equal(r1.ok, false);
  assert.equal(r1.move.to, X(4));

  // N2 Ketten-Unterschuss: die Kette endet auf X2 statt auf B = X4.
  const n2 = st([{ cell: X(1), dir: PX }, { cell: X(4), dir: PX }]);
  const r2 = pruefeUnRelocate(b, n2, 1, X(0), X(4), 4);
  assert.equal(r2.ok, false);
  assert.equal(r2.move.to, X(2));

  // N3 Schritt statt Sprung.
  const n3 = st([{ cell: X(2), dir: PX }]);
  const r3 = pruefeUnRelocate(b, n3, 0, X(0), X(2), 4);
  assert.equal(r3.ok, false);
  assert.equal(r3.move.kind, 'STEP');

  // N4 Feste Pfeile: die Richtung des Wuerfels wird nie neu gewaehlt.
  const b4 = buildBoard({ mode: 'VOLUMEN', W: 5, H: 3, D: 3 });
  const nach = V(b4, 2, 1, 0), von = V(b4, 1, 1, 0);
  assert.equal(pruefeUnRelocate(b4, createState(b4, [{ cell: nach, dir: PY }], 'ABBAU'), 0, von, nach, 4).ok, false);
  assert.equal(pruefeUnRelocate(b4, createState(b4, [{ cell: nach, dir: PX }], 'ABBAU'), 0, von, nach, 4).ok, true);

  // N5 Zustandsdrift: im Zustand zur Zugzeit nur ein Schritt, im Endzustand ein Austritt.
  assert.equal(pruefeUnExit(b, emptyState(b, b.C, 'ABBAU'), X(3), PX, 4).ok, false);
  assert.equal(pruefeUnExit(b, st([{ cell: X(4), dir: PX }]), X(3), PX, 4).ok, true);

  // N6 Austritts-Umkehr: derselbe Wuerfel tritt im dichteren Zustand nicht mehr aus.
  assert.equal(pruefeUnExit(b, st([{ cell: X(2), dir: PX }, { cell: X(4), dir: PX }]), X(1), PX, 4).ok, true);
  const n6 = st([{ cell: X(2), dir: PX }, { cell: X(3), dir: PX }, { cell: X(4), dir: PX }]);
  const r6 = pruefeUnExit(b, n6, X(1), PX, 4);
  assert.equal(r6.ok, false);
  assert.equal(r6.move.reason, 'BLOCKED');
});

// --- Der Beweis, dass die Garantie nicht trivial ist --------------------

test('Sackgassen existieren: die Garantie gilt nur ab dem Startzustand', () => {
  // Vollbelegtes Gitter, alle Pfeile nach innen: kein Zug moeglich (SPEC §10.2.5).
  const b = buildBoard({ mode: 'VOLUMEN', W: 5, H: 5, D: 5 });
  const cubes = [];
  for (let c = 0; c < b.C; c++) {
    // Pfeil zur jeweils weiter entfernten Wand, also nach innen.
    let dir = 0, tiefe = -1;
    for (let d = 0; d < 6; d++) {
      const t = b.depthOf[c * 6 + d];
      if (t > tiefe) { tiefe = t; dir = d; }
    }
    cubes.push({ cell: c, dir, target: false });
  }
  const state = createState(b, cubes, 'ABBAU');
  let beweglich = 0;
  for (let c = 0; c < b.C; c++)
    if (state.occ[c] !== EMPTY && resolveMove(b, state, c).kind !== 'INVALID') beweglich++;
  assert.ok(beweglich < b.C, 'ein solcher Turm ist nicht frei beweglich');

  // Und ein echtes Level laesst sich festfahren, ohne dass verifyLevel etwas verspricht.
  const level = generateForLevelNo(6);
  const board = buildBoard({ mode: level.mode, ...level.dims });
  const s = createState(board, level.cubes, level.goal);
  const m = resolveMove(board, s, level.witness[level.witness.length - 1]);
  if (m.kind !== 'INVALID') applyMove(s, m);
  assert.equal(verifyLevel(level).ok, true, 'die Garantie gilt weiterhin ab dem Startzustand');
});
