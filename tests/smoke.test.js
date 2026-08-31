// tests/smoke.test.js — Verdrahtungsprobe (SPEC §4.1 bis §4.7).
//
// Zweck: die Kette levelSpecFor -> buildBoard -> generateLevel -> verifyLevel ->
// createSession -> tap ... -> Sieg fuer beide Richtungsmodi und beide Zielmodi
// ohne Browser durchspielen, und nachweisen, dass jede in SPEC §4.1 bis §4.6
// zugesagte Funktion wirklich exportiert wird.
//
// game.js und levels.js sind rein und werden echt importiert. render.js, skins.js,
// ui.js, api.js und main.js haengen an three bzw. am DOM; sie werden statisch
// gegen ihren Quelltext geprueft, damit dieser Test ohne Browser laeuft.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildBoard, createSession, tap, isSolved, hasAnyMove, resolveMove
} from '../public/src/game.js';
import { levelSpecFor, generateLevel, verifyLevel } from '../public/src/levels.js';

const QUELLE = {
  game: '../public/src/game.js',
  levels: '../public/src/levels.js',
  render: '../public/src/render.js',
  skins: '../public/src/skins.js',
  ui: '../public/src/ui.js',
  api: '../public/src/api.js',
  main: '../public/src/main.js'
};

function quelltext(name) {
  return readFileSync(fileURLToPath(new URL(QUELLE[name], import.meta.url)), 'utf8');
}

/**
 * Namen aller Deklarationsexporte einer Datei.
 * Erfasst `export function`, `export async function`, `export class`,
 * `export const|let|var` — genau die Formen, die der Modulplan vorsieht.
 */
function exporte(name) {
  const re = /^export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  const menge = new Set();
  let m;
  const text = quelltext(name);
  while ((m = re.exec(text)) !== null) menge.add(m[1]);
  return menge;
}

// --- 1. Exportlisten aus SPEC §4.1 bis §4.7 -----------------------------

const ZUGESAGT = {
  game: [
    'OUT', 'EMPTY', 'CELL', 'CUBE_EDGE', 'MAX_CUBES', 'RULE_VERSION',
    'DIR6', 'DIR6_NAMES',
    'buildBoard', 'cellKey', 'cellIndexOf', 'latticeOf', 'worldPosOf', 'dirWorldOf',
    'validDirs', 'depthOf', 'minDepthOf', 'bestExitDirs',
    'createState', 'emptyState', 'cloneState', 'addCube', 'dropCube', 'isFree',
    'resolveMove', 'applyMove', 'revertMove', 'legalCells', 'mobility', 'hasAnyMove',
    'isSolved', 'createSession', 'tap', 'undo', 'restart', 'tickClock', 'toRunLog'
  ],
  levels: [
    'GEN_VERSION', 'generateLevel', 'generateFromCode', 'generateForLevelNo',
    'verifyLevel', 'replayTaps', 'solveGreedy', 'levelSpecFor',
    'encodeLevelCode', 'parseLevelCode', 'encodeHash', 'parseHash', 'measureLevel'
  ],
  render: [
    'LAYER_PICK', 'Ease', 'createRenderer', 'createScene', 'createCamera',
    'createControls', 'fitCamera', 'updateKeyLight', 'attachResize', 'startLoop',
    'TILE', 'ROW', 'buildAtlas', 'buildVariantSet', 'createTowerView',
    'Tween', 'createAnimRunner', 'buildTweens', 'shakeWorld', 'createPointerInput'
  ],
  skins: [
    'SKIN_IDS', 'SKINS', 'getSkin', 'resolveSkinId', 'applySkinDom',
    'applySkinThree', 'easingOf', 'createAudio'
  ],
  ui: ['TEXTE', 'createUI'],
  api: ['getScores', 'postScore', 'newUuid', 'clientId'],
  main: ['boot']
};

test('§4.1-§4.7: jedes Modul exportiert die zugesagten Namen', () => {
  for (const [modul, namen] of Object.entries(ZUGESAGT)) {
    const vorhanden = exporte(modul);
    for (const n of namen) {
      assert.ok(vorhanden.has(n), `${modul}.js exportiert '${n}' nicht`);
    }
  }
});

test('§4.1/§4.2: der reine Kern liefert die Exporte auch zur Laufzeit', async () => {
  const game = await import('../public/src/game.js');
  const levels = await import('../public/src/levels.js');
  for (const n of ZUGESAGT.game) {
    assert.notEqual(game[n], undefined, `game.js: ${n} ist undefined`);
  }
  for (const n of ZUGESAGT.levels) {
    assert.notEqual(levels[n], undefined, `levels.js: ${n} ist undefined`);
  }
  // Regel 0.2: der reine Kern bleibt frei von Browser- und Zufallsquellen.
  for (const modul of ['game', 'levels']) {
    const text = quelltext(modul).replace(/^\s*(\/\/.*|\*.*)$/gm, '');
    for (const verboten of ['Math.random', 'Date.now', 'performance.now',
      'document.', 'window.', "from 'three'"]) {
      assert.ok(!text.includes(verboten), `${modul}.js referenziert ${verboten}`);
    }
  }
});

// --- 2. main.js ist gegen die tatsaechlichen Exporte verdrahtet ---------

test('§4.7: jeder benannte Import in main.js existiert im Zielmodul', () => {
  const text = quelltext('main');
  const re = /import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.]+)\.js'/g;
  let m;
  let geprueft = 0;
  while ((m = re.exec(text)) !== null) {
    const modul = m[2];
    assert.ok(Object.prototype.hasOwnProperty.call(QUELLE, modul),
      `main.js importiert aus unbekanntem Modul ${modul}.js`);
    const vorhanden = exporte(modul);
    for (const roh of m[1].split(',')) {
      const name = roh.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      assert.ok(vorhanden.has(name), `main.js importiert ${name} aus ${modul}.js — nicht exportiert`);
      geprueft++;
    }
  }
  assert.ok(geprueft >= 25, 'main.js verdrahtet zu wenige Module (' + geprueft + ')');
});

test('§4.7/§0.5: main.js ruft boot() selbst auf und nutzt den Pflichtpfad', () => {
  const text = quelltext('main');
  for (const noetig of ['boot()', 'parseHash(', 'levelSpecFor(', 'buildBoard(',
    'generateLevel(', 'createSession(', 'startLoop(', 'encodeHash(',
    'measureLevel(', 'anim.finishAll()', 'hasAnyMove(']) {
    assert.ok(text.includes(noetig), `main.js enthaelt '${noetig}' nicht`);
  }
  // Kennzahlen niemals blockierend im Levelstart-Pfad (§4.7.8).
  assert.ok(/requestIdleCallback/.test(text), 'main.js misst nicht im Leerlauf');
});

// --- 3. Die Kette bis zum Sieg, beide Zielmodi ------------------------

/** Levelnummern der Kurve, die je einen Zielmodus in kleiner und grosser Form liefern (§6.11). */
const FAELLE = [
  { n: 1, mode: 'VOLUMEN', goal: 'ABBAU' },
  { n: 9, mode: 'VOLUMEN', goal: 'BEFREIUNG' },
  { n: 19, mode: 'VOLUMEN', goal: 'ABBAU' },
  { n: 23, mode: 'VOLUMEN', goal: 'BEFREIUNG' }
];

for (const fall of FAELLE) {
  test(`Kette bis zum Sieg: ${fall.mode} / ${fall.goal} (Level ${fall.n})`, () => {
    const spec = levelSpecFor(fall.n);
    assert.equal(spec.mode, fall.mode);
    assert.equal(spec.goal, fall.goal);

    const board = buildBoard({ mode: spec.mode, W: spec.W, H: spec.H, D: spec.D });
    assert.equal(board.mode, spec.mode);
    assert.ok(board.C > 0);

    const level = generateLevel(spec);
    assert.equal(level.mode, spec.mode);
    assert.equal(level.goal, spec.goal);
    assert.deepEqual(level.dims, { W: spec.W, H: spec.H, D: spec.D });
    assert.ok(level.cubes.length > 0);
    assert.equal(level.par, level.witness.length);
    assert.equal(level.stars.length, 3);
    assert.ok(level.stars[0] <= level.stars[1] && level.stars[1] <= level.stars[2]);

    const geprueft = verifyLevel(level);
    assert.equal(geprueft.ok, true, 'verifyLevel: ' + geprueft.reason);
    assert.equal(geprueft.checked, level.witness.length);

    const session = createSession(board, level);
    assert.equal(session.moves, 0);
    assert.equal(session.won, false);
    assert.equal(hasAnyMove(board, session.state), true);
    if (spec.goal === 'BEFREIUNG') assert.equal(session.state.targetId, level.targetId);

    // Ein Tipp ins Leere ist ungueltig und darf nichts zaehlen (RF-9, §5.3).
    let leer = -1;
    for (let c = 0; c < board.C && leer < 0; c++) if (session.state.occ[c] < 0) leer = c;
    if (leer >= 0) {
      const ungueltig = tap(session, leer);
      assert.equal(ungueltig.kind, 'INVALID');
      assert.equal(session.moves, 0);
      assert.equal(session.history.length, 0);
    }

    // Die Referenzloesung Zug fuer Zug ueber tap() spielen.
    for (let i = 0; i < level.witness.length; i++) {
      const cell = level.witness[i];
      const vorher = resolveMove(board, session.state, cell);
      assert.notEqual(vorher.kind, 'INVALID', `Referenzzug ${i} ist ungueltig`);
      const m = tap(session, cell);
      assert.equal(m.kind, vorher.kind);
      assert.equal(m.from, cell, `Referenzzug ${i} startet woanders`);
      assert.equal(session.moves, i + 1);
    }

    assert.equal(session.won, true, 'Referenzloesung fuehrt nicht zum Sieg');
    assert.equal(isSolved(session.state), true);
    assert.equal(session.moves, level.par);
    if (spec.goal === 'ABBAU') assert.equal(session.state.aliveCount, 0);
    else assert.equal(session.state.alive[level.targetId], 0);
  });
}
