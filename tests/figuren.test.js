// SPEC §10.14 — Figuren: Maske, Mindestmasse, Codes und erzeugte Level.
//
// Der Kern der Sache: eine Figur ist eine Setzbeschraenkung, keine Regelaenderung.
// Geprueft wird deshalb vor allem, dass (a) nie ein Stein ausserhalb der Maske landet,
// (b) die Silhouette dicht genug bleibt, um erkennbar zu sein, und (c) die Garantie
// unangetastet gilt: jedes ausgelieferte Level ist verifiziert und aus seinem Code
// bitgleich nachbaubar.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBoard, createState, EMPTY, EXT_NONE, MAX_CUBES } from '../public/src/game.js';
import {
  FIGUREN, FIGUR_STANDARD, figurVon, istFigur, massFuer, figurMaske, maskenZellen
} from '../public/src/figuren.js';
import {
  generateLevel, verifyLevel, encodeLevelCode, parseLevelCode,
  encodeHash, parseHash, levelSpecFor
} from '../public/src/levels.js';

const ECHTE = FIGUREN.filter((f) => f.id !== FIGUR_STANDARD);

/** Das Level dieser Figur in ihrem Mindestmass. */
function levelFuer(id, goal = 'ABBAU', seed = 7919) {
  const { W, H, D } = massFuer(id, 3, 3, 3);
  return { W, H, D, level: generateLevel({ goal, figure: id, W, H, D, seed, attempt: 0 }) };
}

test('1. die Figurliste ist wohlgeformt und QUADER bleibt der Standard', () => {
  assert.ok(FIGUREN.length >= 6, 'zu wenige Figuren');
  assert.equal(FIGUREN[0].id, FIGUR_STANDARD, 'der Quader steht zuerst');
  const ids = new Set();
  for (const f of FIGUREN) {
    assert.match(f.id, /^[A-Z]{4,12}$/, 'Kennung passt nicht in den Levelcode: ' + f.id);
    assert.ok(!ids.has(f.id), 'doppelte Kennung: ' + f.id);
    ids.add(f.id);
    assert.equal(typeof f.name, 'string');
    assert.ok(f.name.length > 0);
    assert.equal(typeof f.drin, 'function');
    assert.ok(f.min.W >= 3 && f.min.D >= 3 && f.min.H >= 2, 'Mindestmass unter der Brettgrenze');
    assert.ok(f.min.W <= 16 && f.min.D <= 16 && f.min.H <= 24, 'Mindestmass ueber der Brettgrenze');
    const b = buildBoard({ mode: 'VOLUMEN', W: f.min.W, H: f.min.H, D: f.min.D });
    assert.ok(b.C <= MAX_CUBES, f.id + ': Mindestmass ueberschreitet MAX_CUBES');
    assert.ok(istFigur(f.id));
  }
  assert.equal(istFigur('GIBTSNICHT'), false);
  assert.throws(() => figurVon('GIBTSNICHT'), RangeError);
  assert.equal(figurVon(undefined).id, FIGUR_STANDARD, 'ohne Angabe gilt der Quader');
});

test('2. der Quader gibt alles frei, jede Figur einen echten Teil davon', () => {
  const b = buildBoard({ mode: 'VOLUMEN', W: 9, H: 10, D: 9 });
  assert.equal(maskenZellen(figurMaske(b, FIGUR_STANDARD)), b.C);

  for (const f of ECHTE) {
    const { W, H, D } = massFuer(f.id, 3, 3, 3);
    const brett = buildBoard({ mode: 'VOLUMEN', W, H, D });
    const n = maskenZellen(figurMaske(brett, f.id));
    // Eine Figur, die alles freigibt, waere ein Quader unter falschem Namen; eine, die
    // fast nichts freigibt, waere kein Spiel.
    assert.ok(n >= 60, `${f.id}: nur ${n} Zellen — zu wenig fuer ein Level`);
    assert.ok(n < brett.C, `${f.id}: gibt das ganze Brett frei`);
    assert.ok(n / brett.C < 0.85, `${f.id}: fuellt ${(100 * n / brett.C) | 0}% — keine Silhouette`);
  }
});

test('3. die Maske ist deterministisch und haengt nur an (Figur, W, H, D)', () => {
  for (const f of FIGUREN) {
    const { W, H, D } = massFuer(f.id, 5, 5, 5);
    const b1 = buildBoard({ mode: 'VOLUMEN', W, H, D });
    const b2 = buildBoard({ mode: 'VOLUMEN', W, H, D });
    assert.deepEqual([...figurMaske(b1, f.id)], [...figurMaske(b2, f.id)], f.id);
  }
});

test('4. massFuer haelt Mindestmass und MAX_CUBES zugleich ein', () => {
  for (const f of FIGUREN) {
    const klein = massFuer(f.id, 3, 2, 3);
    assert.deepEqual(klein, { W: f.min.W, H: f.min.H, D: f.min.D }, f.id + ': zu klein');

    // Grosse Wuensche werden nur so weit gekuerzt, wie MAX_CUBES es verlangt — und nie
    // unter das Mindestmass der Figur. Sonst wirft buildBoard beim Umschalten.
    for (const [W, H, D] of [[8, 16, 8], [16, 24, 16], [12, 12, 12]]) {
      const m = massFuer(f.id, W, H, D);
      assert.ok(m.W >= f.min.W && m.H >= f.min.H && m.D >= f.min.D,
        `${f.id} ${W}x${H}x${D}: unter das Mindestmass gekuerzt`);
      assert.ok(m.W <= Math.max(W, f.min.W) && m.H <= Math.max(H, f.min.H)
        && m.D <= Math.max(D, f.min.D), `${f.id}: ueber den Wunsch hinaus gewachsen`);
      const b = buildBoard({ mode: 'VOLUMEN', W: m.W, H: m.H, D: m.D });
      assert.ok(b.C <= MAX_CUBES, `${f.id} ${W}x${H}x${D}: ${b.C} Zellen ueber MAX_CUBES`);
    }
  }
});

test('5. kein Stein liegt je ausserhalb seiner Figur', () => {
  // Das ist die eigentliche Zusage. Faellt sie, sieht man Steine im leeren Raum schweben.
  for (const f of ECHTE) {
    for (const goal of ['ABBAU', 'BEFREIUNG']) {
      for (const seed of [1, 20261, 987654]) {
        const { W, H, D } = massFuer(f.id, 3, 3, 3);
        const level = generateLevel({ goal, figure: f.id, W, H, D, seed, attempt: 0 });
        const board = buildBoard({ mode: 'VOLUMEN', W, H, D });
        const maske = figurMaske(board, f.id);
        const state = createState(board, level.cubes, level.goal);
        let drin = 0;
        for (let c = 0; c < board.C; c++) {
          if (state.occ[c] === EMPTY) continue;
          assert.equal(maske[c], 1,
            `${f.id}/${goal}/${seed}: Stein in Zelle ${c} liegt ausserhalb der Figur`);
          drin++;
        }
        // Und die Silhouette ist geschlossen genug, um die Figur zu erkennen.
        const anteil = drin / maskenZellen(maske);
        assert.ok(anteil >= 0.90,
          `${f.id}/${goal}/${seed}: nur ${(100 * anteil) | 0}% der Figur belegt`);
      }
    }
  }
});

test('6. auch 2x1-Steine ragen nie aus der Figur heraus', () => {
  for (const f of ECHTE) {
    const { W, H, D, level } = levelFuer(f.id);
    const board = buildBoard({ mode: 'VOLUMEN', W, H, D });
    const maske = figurMaske(board, f.id);
    let zwei = 0;
    for (const cu of level.cubes) {
      if (cu.ext === undefined) continue;
      zwei++;
      const zweite = board.step[cu.cell * 6 + cu.ext];
      assert.notEqual(zweite, -1, f.id + ': zweite Zelle ausserhalb des Gitters');
      assert.equal(maske[cu.cell], 1, f.id + ': Anker ausserhalb der Figur');
      assert.equal(maske[zweite], 1, f.id + ': zweite Zelle ausserhalb der Figur');
    }
    assert.ok(zwei > 0, f.id + ': das Level enthaelt ueberhaupt keine 2x1-Steine');
  }
});

test('7. jedes Figurlevel ist verifiziert und aus seinem Code bitgleich nachbaubar', () => {
  for (const f of FIGUREN) {
    for (const goal of ['ABBAU', 'BEFREIUNG']) {
      const { W, H, D } = massFuer(f.id, 3, 3, 3);
      const spec = { goal, figure: f.id, W, H, D, seed: 4711, attempt: 0 };
      const level = generateLevel(spec);
      const ver = verifyLevel(level);
      assert.equal(ver.ok, true, `${f.id}/${goal}: ${ver.reason}`);
      assert.equal(ver.checked, level.witness.length);

      // Der Code traegt die Figur, und aus ihm entsteht dieselbe Spec zurueck.
      const code = level.levelCode;
      const zurueck = parseLevelCode(code);
      assert.equal(zurueck.figure, f.id, 'Figur ging im Levelcode verloren: ' + code);
      assert.equal(zurueck.goal, level.goal, 'Zielmodus im Code: ' + code);
      assert.equal(zurueck.seed, level.seed, 'Seed im Code: ' + code);
      assert.equal(zurueck.attempt, level.attempt, 'Versuchsindex im Code: ' + code);
      assert.deepEqual({ W: zurueck.W, H: zurueck.H, D: zurueck.D }, level.dims,
        'Masse im Code: ' + code);
      assert.equal(encodeLevelCode(zurueck), code, 'Levelcode ist nicht rundlaufend');
      const ausHash = parseHash(encodeHash(zurueck));
      assert.notEqual(ausHash, null, 'Hash liess sich nicht zurueckwandeln');
      assert.equal(ausHash.figure, f.id, 'Figur ging im Hash verloren');
    }
  }
});

test('8. der Levelcode des Quaders bleibt figurfrei — alte Codes gelten weiter', () => {
  const quader = { goal: 'ABBAU', figure: FIGUR_STANDARD, W: 4, H: 6, D: 4, attempt: 0, seed: 0x0008FA3C };
  assert.equal(encodeLevelCode(quader), 'V-A-4x6x4-0-0008FA3C');
  assert.equal(parseLevelCode('V-A-4x6x4-0-0008FA3C').figure, FIGUR_STANDARD,
    'ein Code ohne Figursegment muss der volle Quader sein');
  assert.equal(parseHash('#s=1&m=VOLUMEN&g=ABBAU&d=4x6x4&a=0&r=3&gv=4').figure, FIGUR_STANDARD);

  assert.equal(encodeLevelCode({ ...quader, figure: 'HERZ', W: 9, H: 9, D: 5 }),
    'V-A-HERZ-9x9x5-0-0008FA3C');
  assert.throws(() => parseLevelCode('V-A-GIBTSNICHT-9x9x5-0-0008FA3C'), Error);
  assert.equal(parseHash('#s=1&m=VOLUMEN&g=ABBAU&f=GIBTSNICHT&d=9x9x5&a=0&r=3&gv=4'), null);
});

test('9. ein Code unter dem Mindestmass der Figur wird abgewiesen', () => {
  // Sonst bezeichnete derselbe Code zwei verschiedene Level: der Browser hoebe die
  // Masse an, der Worker regenerierte etwas anderes — und ein ehrlicher Lauf faellt
  // als unverifiziert durch.
  assert.throws(() => parseLevelCode('V-A-HERZ-4x6x4-0-0008FA3C'), RangeError);
  assert.equal(parseHash('#s=1&m=VOLUMEN&g=ABBAU&f=HERZ&d=4x6x4&a=0&r=3&gv=4'), null);
});

test('10. die Levelkurve bleibt beim vollen Quader', () => {
  // Die Schwierigkeit der Kampagne soll an Groesse und Dichte haengen, nicht daran,
  // welche Figur gerade an der Reihe ist. Figuren sind freies Spiel.
  for (let n = 1; n <= 120; n++)
    assert.equal(levelSpecFor(n).figure, FIGUR_STANDARD, 'Level ' + n);
});

test('11. jede Figur bleibt unter MAX_CUBES, auch im groessten Kasten', () => {
  for (const f of FIGUREN) {
    const { W, H, D } = massFuer(f.id, 8, 16, 8);
    const board = buildBoard({ mode: 'VOLUMEN', W, H, D });
    const n = maskenZellen(figurMaske(board, f.id));
    assert.ok(n <= MAX_CUBES, `${f.id}: ${n} Zellen ueber MAX_CUBES`);
  }
});

test('12. EXT_NONE bleibt der vereinbarte Wert (Vertrag mit game.js)', () => {
  assert.equal(EXT_NONE, 255);
});

test('13. ein Figurlauf kommt durch die Worker-Validierung und das Nachspielen', async () => {
  // Die Kette, an der ein Bestenlisteneintrag haengt: Levelcode -> Regeneration im
  // Worker -> Nachspielen der Tippfolge. Bricht sie fuer Figuren, gilt jeder ehrliche
  // Figurlauf als unverifiziert — und das faellt sonst erst in der Bestenliste auf.
  const { validateSubmission } = await import('../worker/validate.js');
  const { generateFromCode, replayTaps, GEN_VERSION } = await import('../public/src/levels.js');
  const { RULE_VERSION } = await import('../public/src/game.js');

  for (const f of FIGUREN) {
    const { W, H, D } = massFuer(f.id, 3, 3, 3);
    const level = generateLevel({ goal: 'ABBAU', figure: f.id, W, H, D, seed: 4711, attempt: 0 });
    const nutzlast = {
      name: 'Anna', dirMode: 'volumen', goalMode: 'abbau',
      size: { x: W, y: H, z: D },
      cubes: level.cubes.length, moves: level.par, undos: 0, timeMs: level.par * 1000,
      seed: level.seed, levelCode: level.levelCode,
      ruleVersion: RULE_VERSION, genVersion: GEN_VERSION,
      runId: '3f6d1c2a-9b41-4a77-8a0e-1d5b7c9e2f04',
      clientId: '7c2e5b18-0d33-4f9a-9c11-a2b3c4d5e6f7',
      appVersion: '1.0.0', taps: level.witness.slice()
    };
    const res = validateSubmission(nutzlast);
    assert.equal(res.ok, true, `${f.id}: abgelehnt — ${JSON.stringify(res)}`);

    const wieder = generateFromCode(level.levelCode);
    assert.deepEqual(wieder.cubes, level.cubes, f.id + ': Regeneration weicht ab');
    const r = replayTaps(wieder, res.value.taps);
    assert.equal(r.solved, true, f.id + ': der Zeugenlauf gewinnt im Worker nicht');
    assert.equal(r.invalid, 0, f.id + ': ungueltige Zuege beim Nachspielen');
    assert.equal(r.moves, level.par, f.id + ': Zugzahl weicht ab');
  }
});
