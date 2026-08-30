// Pfeilspiel — Levelgenerator, Loesbarkeitsgarantie, Verifikation, Replay (SPEC §6).
//
// Reines ES-Modul ohne Renderer, ohne DOM, ohne Uhr, ohne Zufall aus der Laufzeit.
// Erlaubt ist ausschliesslich mulberry32 (SPEC §0.4, §11). Das Modul laeuft unveraendert
// in node --test und im Cloudflare-Worker.
//
// Es gibt genau eine Regelimplementierung: resolveMove aus ./game.js. Der Generator
// erzeugt Kandidaten und laesst die Regel selbst urteilen; eine Sprungkette wird an
// keiner Stelle analytisch invertiert (SPEC §0.1, §6.1).
//
// NORMATIV (SPEC §6.9): Falls jemals Dekorwuerfel eingefuehrt werden, DUERFEN sie
// ausschliesslich vor allen Verifikationsschritten gesetzt werden. Nachtraegliches
// Auffuellen von Loechern mit statischen Wuerfeln bricht bereits verifizierte Zuege
// (ein Schrittfeld wird belegt, eine Kette schiesst ueber).

import {
  OUT, EMPTY, MAX_CUBES, RULE_VERSION, EXT_NONE,
  buildBoard, validDirs, bestExitDirs,
  emptyState, createState, cloneState, addCube, dropCube,
  resolveMove, applyMove, revertMove,
  legalCells, mobility, isSolved
} from './game.js';

/**
 * Generatorversion 2: der Rueckwaertsbau setzt neben 1x1-Wuerfeln auch 2x1-Steine
 * (SPEC §6.3 A). Levelcodes der Version 1 erzeugen andere Level und sind nicht mehr
 * gueltig — deshalb die Erhoehung.
 */
export const GEN_VERSION = 2;

// --- Zufall (SPEC §11) --------------------------------------------------

/**
 * Der einzige erlaubte Zufallsstrom des Projekts.
 * @param {number} seed uint32
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, in-place. */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** Streuung einer Levelnummer auf einen uint32-Seed; ohne Laufzeitzufall. */
function hash32(n) {
  let h = Math.imul(n >>> 0, 0x9E3779B1) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85EBCA6B) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xC2B2AE35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function runde(x, stellen) {
  const f = Math.pow(10, stellen);
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

// --- Kurve, Gewichte, Baender (SPEC §6.6, §6.11) ------------------------

/** Standardgewichte des Kandidatenscores (SPEC §6.6). */
function standardGewichte() {
  return { wFill: 1.00, wChain: 2.50, wFrag: 0.60, wDiv: 0.90, wSil: 0.35, wRand: 0.25 };
}

/** Standardbaender (SPEC §6.11). */
function standardBaender() {
  return {
    naivePerPar: [1.08, 1.60],
    chainShare: [0.15, 0.70],
    mobility: [0.12, 0.80],
    trivialExit: [0.00, 0.45]
  };
}

/**
 * Kurventabelle aus SPEC §6.11, umgeschluesselt auf (Modus, Ziel, Masse).
 *
 * Der Levelcode traegt nur Modus, Ziel, Masse, Versuch und Seed (SPEC §4.2). Damit der
 * Worker ein Level allein aus dem Code bitgleich nachbauen kann, MUSS jede Kennzahl des
 * Generators aus genau diesen Feldern folgen. Deshalb steht die Tabelle hier nach
 * (Modus, Ziel, Masse) und nicht nach Levelnummer.
 */
const KURVE = Object.freeze([
  { mode: 'FASSADE', goal: 'ABBAU', W: 3, H: 4, D: 3, density: 0.95, maxChain: 1, q: 0, domino: 0, stars: [1.15, 1.35] },
  { mode: 'FASSADE', goal: 'ABBAU', W: 4, H: 6, D: 4, density: 0.92, maxChain: 2, q: 0, domino: 0.18, stars: [1.15, 1.30] },
  { mode: 'FASSADE', goal: 'BEFREIUNG', W: 4, H: 8, D: 4, density: 0.95, maxChain: 2, q: 0.55, domino: 0.30, stars: [1.15, 1.30] },
  { mode: 'FASSADE', goal: 'ABBAU', W: 5, H: 10, D: 5, density: 0.92, maxChain: 3, q: 0, domino: 0.30, stars: [1.12, 1.25] },
  { mode: 'VOLUMEN', goal: 'BEFREIUNG', W: 3, H: 5, D: 3, density: 0.85, maxChain: 2, q: 0.60, domino: 0.30, stars: [1.12, 1.25] },
  { mode: 'VOLUMEN', goal: 'ABBAU', W: 4, H: 6, D: 4, density: 0.85, maxChain: 3, q: 0, domino: 0.30, stars: [1.12, 1.25] },
  { mode: 'VOLUMEN', goal: 'BEFREIUNG', W: 4, H: 8, D: 4, density: 0.90, maxChain: 4, q: 0.80, domino: 0.30, stars: [1.12, 1.25] },
  { mode: 'VOLUMEN', goal: 'ABBAU', W: 5, H: 8, D: 5, density: 0.90, maxChain: 4, q: 0, domino: 0.30, stars: [1.12, 1.25] },
  { mode: 'FASSADE', goal: 'BEFREIUNG', W: 5, H: 12, D: 5, density: 0.90, maxChain: 4, q: 0.70, domino: 0.30, stars: [1.12, 1.25] },
  { mode: 'VOLUMEN', goal: 'BEFREIUNG', W: 5, H: 8, D: 5, density: 0.90, maxChain: 4, q: 0.70, domino: 0.30, stars: [1.12, 1.25] }
]);

/** Freies Spiel und unbekannte Masse: Parameter der Stufe 8. */
const KURVE_STANDARD = Object.freeze({ density: 0.90, maxChain: 4, q: 0.70, domino: 0.30, stars: [1.12, 1.25] });

/** Generatorparameter einer Konfiguration; total, damit Levelcodes umkehrbar bleiben. */
function kurvenParameter(mode, goal, W, H, D) {
  for (let i = 0; i < KURVE.length; i++) {
    const k = KURVE[i];
    if (k.mode === mode && k.goal === goal && k.W === W && k.H === H && k.D === D) return k;
  }
  return KURVE_STANDARD;
}

/** Sternschwellen einer Konfiguration (SPEC §6.11, Spalte "Sterne"). */
function sternFaktoren(mode, goal, W, H, D) {
  return kurvenParameter(mode, goal, W, H, D).stars;
}

/**
 * Vollstaendige LevelSpec aus den identitaetsstiftenden Feldern.
 * @returns {Object} LevelSpec (SPEC §3.6)
 */
function specVon(mode, goal, W, H, D, seed, attempt) {
  const p = kurvenParameter(mode, goal, W, H, D);
  return {
    seed: seed >>> 0,
    attempt: attempt | 0,
    mode, goal, W, H, D,
    density: p.density,
    maxChain: p.maxChain,
    dominoRate: p.domino,
    relocateRate: 0,
    weights: standardGewichte(),
    bands: standardBaender(),
    targetQuantile: p.q
  };
}

/** Ergaenzt eine unvollstaendige Spec um alle Pflichtfelder. */
function normSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('LevelSpec fehlt');
  const mode = spec.mode === 'VOLUMEN' ? 'VOLUMEN' : 'FASSADE';
  const goal = spec.goal === 'BEFREIUNG' ? 'BEFREIUNG' : 'ABBAU';
  const W = spec.W | 0, H = spec.H | 0, D = spec.D | 0;
  const basis = specVon(mode, goal, W, H, D, spec.seed >>> 0, spec.attempt | 0);
  if (Number.isFinite(spec.density)) basis.density = Math.min(1, Math.max(0, spec.density));
  if (Number.isFinite(spec.maxChain)) basis.maxChain = Math.max(0, Math.floor(spec.maxChain));
  if (Number.isFinite(spec.dominoRate)) basis.dominoRate = Math.min(1, Math.max(0, spec.dominoRate));
  if (Number.isFinite(spec.relocateRate)) basis.relocateRate = Math.min(1, Math.max(0, spec.relocateRate));
  if (Number.isFinite(spec.targetQuantile)) basis.targetQuantile = Math.min(1, Math.max(0, spec.targetQuantile));
  if (spec.weights) basis.weights = Object.assign(standardGewichte(), spec.weights);
  if (spec.bands) basis.bands = Object.assign(standardBaender(), spec.bands);
  return basis;
}

/**
 * Levelkurve (SPEC §6.11).
 * @param {number} n Levelnummer ab 1
 * @returns {Object} LevelSpec
 */
export function levelSpecFor(n) {
  const stufe = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  let mode, goal, W, H, D;
  if (stufe <= 3) { mode = 'FASSADE'; goal = 'ABBAU'; W = 3; H = 4; D = 3; }
  else if (stufe <= 8) { mode = 'FASSADE'; goal = 'ABBAU'; W = 4; H = 6; D = 4; }
  else if (stufe <= 12) { mode = 'FASSADE'; goal = 'BEFREIUNG'; W = 4; H = 8; D = 4; }
  else if (stufe <= 18) { mode = 'FASSADE'; goal = 'ABBAU'; W = 5; H = 10; D = 5; }
  else if (stufe <= 22) { mode = 'VOLUMEN'; goal = 'BEFREIUNG'; W = 3; H = 5; D = 3; }
  else if (stufe <= 30) { mode = 'VOLUMEN'; goal = 'ABBAU'; W = 4; H = 6; D = 4; }
  else if (stufe <= 40) { mode = 'VOLUMEN'; goal = 'BEFREIUNG'; W = 4; H = 8; D = 4; }
  else {
    // Stufe 8: abwechselnd Modus und Zielmodus. Die Grundflaeche waechst nur langsam,
    // die Hoehe traegt den Zuwachs - so bleibt die Silhouette ein Turm und die Zugzahl
    // waechst linear statt kubisch (SPEC §6.11).
    const k = stufe - 41;
    mode = (k % 2 === 0) ? 'VOLUMEN' : 'FASSADE';
    goal = (Math.floor(k / 2) % 2 === 0) ? 'ABBAU' : 'BEFREIUNG';
    W = Math.min(6, 5 + Math.floor(k / 30));
    D = W;
    H = mode === 'VOLUMEN'
      ? Math.min(10, 6 + Math.floor(k / 8))
      : Math.min(16, 10 + Math.floor(k / 6));
  }
  return specVon(mode, goal, W, H, D, hash32(stufe), 0);
}

// --- Levelcode und URL-Hash (SPEC §4.2) ---------------------------------

const CODE_RE = /^([FV])-([AB])-(\d{1,2})x(\d{1,2})x(\d{1,2})-(\d{1,2})-([0-9A-F]{8})$/;

export function encodeLevelCode(spec) {
  const m = spec.mode === 'VOLUMEN' ? 'V' : 'F';
  const g = spec.goal === 'BEFREIUNG' ? 'B' : 'A';
  const seed = (spec.seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return m + '-' + g + '-' + spec.W + 'x' + spec.H + 'x' + spec.D + '-' + (spec.attempt | 0) + '-' + seed;
}

/** @returns {Object} LevelSpec; wirft bei Formatfehler. */
export function parseLevelCode(code) {
  if (typeof code !== 'string') throw new TypeError('Levelcode: Zeichenkette erwartet');
  const m = CODE_RE.exec(code);
  if (!m) throw new Error('Levelcode: Formatfehler: ' + code);
  const attempt = parseInt(m[6], 10);
  if (attempt < 0 || attempt > 11) throw new Error('Levelcode: Versuchsindex ausserhalb 0..11');
  const W = parseInt(m[3], 10), H = parseInt(m[4], 10), D = parseInt(m[5], 10);
  const mode = m[1] === 'V' ? 'VOLUMEN' : 'FASSADE';
  const goal = m[2] === 'B' ? 'BEFREIUNG' : 'ABBAU';
  buildBoard({ mode, W, H, D });   // Masse pruefen, wirft RangeError
  return specVon(mode, goal, W, H, D, parseInt(m[7], 16) >>> 0, attempt);
}

export function encodeHash(spec) {
  return '#s=' + (spec.seed >>> 0).toString(16)
    + '&m=' + spec.mode
    + '&g=' + spec.goal
    + '&d=' + spec.W + 'x' + spec.H + 'x' + spec.D
    + '&a=' + (spec.attempt | 0)
    + '&r=' + RULE_VERSION
    + '&gv=' + GEN_VERSION;
}

const HASH_DIMS = /^(\d{1,2})x(\d{1,2})x(\d{1,2})$/;

/** @returns {Object|null} LevelSpec oder null bei Formatfehler bzw. fremder Version. */
export function parseHash(hash) {
  if (typeof hash !== 'string') return null;
  const roh = hash.replace(/^[#?]/, '');
  if (roh.length === 0) return null;
  const feld = Object.create(null);
  for (const teil of roh.split('&')) {
    if (teil.length === 0) continue;
    const p = teil.indexOf('=');
    if (p <= 0) return null;
    feld[teil.slice(0, p)] = teil.slice(p + 1);
  }
  if (!feld.s || !feld.m || !feld.g || !feld.d || feld.a === undefined) return null;
  if (feld.r !== undefined && +feld.r !== RULE_VERSION) return null;
  if (feld.gv !== undefined && +feld.gv !== GEN_VERSION) return null;
  if (feld.m !== 'FASSADE' && feld.m !== 'VOLUMEN') return null;
  if (feld.g !== 'ABBAU' && feld.g !== 'BEFREIUNG') return null;
  if (!/^[0-9a-fA-F]{1,8}$/.test(feld.s)) return null;
  if (!/^\d{1,2}$/.test(feld.a)) return null;
  const dm = HASH_DIMS.exec(feld.d);
  if (!dm) return null;
  const W = +dm[1], H = +dm[2], D = +dm[3];
  const attempt = +feld.a;
  if (attempt > 11) return null;
  try { buildBoard({ mode: feld.m, W, H, D }); } catch { return null; }
  return specVon(feld.m, feld.g, W, H, D, parseInt(feld.s, 16) >>> 0, attempt);
}

// --- Kandidatentests: die einzige Stelle, an der ein Un-Zug akzeptiert wird ---

/**
 * (A) unExit — Einschleusen eines neuen Wuerfels (SPEC §6.3 A).
 *
 * Der Wuerfel wird probeweise gesetzt, die Regel entscheidet, danach wird der Zustand
 * exakt wiederhergestellt. Akzeptiert wird nur ein echter Austritt aus GENAU dem Zustand,
 * der zur Spielzeit vorliegt (Ausfallarten N5 und N6 aus SPEC §6.2).
 *
 * @returns {{ok:boolean, move:Object|null}}
 */
export function pruefeUnExit(board, state, cell, dir, maxChain, ext = EXT_NONE) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= board.C) return { ok: false, move: null };
  if (state.occ[cell] !== EMPTY) return { ok: false, move: null };
  if (!Number.isInteger(dir) || dir < 0 || dir > 5 || board.valid[cell * 6 + dir] !== 1)
    return { ok: false, move: null };

  if (ext !== EXT_NONE) {
    // Der Anker ist stets die KLEINERE der beiden Zellen. Damit ist die serialisierte
    // Form eines 2x1-Steins eindeutig und der Zeugenzug nennt immer den Anker.
    if (!Number.isInteger(ext) || ext < 0 || ext > 5 || board.valid[cell * 6 + ext] !== 1)
      return { ok: false, move: null };
    const zweite = board.step[cell * 6 + ext];
    if (zweite === OUT || zweite <= cell) return { ok: false, move: null };
    if (state.occ[zweite] !== EMPTY) return { ok: false, move: null };
    if (board.valid[zweite * 6 + dir] !== 1) return { ok: false, move: null };
  }

  const id = addCube(state, cell, dir, false, ext);
  const m = resolveMove(board, state, cell);
  dropCube(state, id);
  return { ok: m.kind === 'EXIT' && m.jumps <= maxChain, move: m };
}

/**
 * (B) unRelocate — Zurueckziehen eines vorhandenen Wuerfels (SPEC §6.3 B).
 *
 * Die Richtung ist die BESTEHENDE Richtung des Wuerfels und wird nie neu gewaehlt
 * (Ausfallart N4). Akzeptiert wird nur, wenn die Regel den Wuerfel von `von` aus exakt
 * auf `nach` bringt — nicht davor (N2), nicht darueber hinaus (N1) und nicht als
 * Schritt statt der geplanten Kette (N3).
 *
 * @returns {{ok:boolean, move:Object|null}}
 */
export function pruefeUnRelocate(board, state, cubeId, von, nach, maxChain) {
  if (!Number.isInteger(cubeId) || cubeId < 0 || cubeId >= state.cubeCount) return { ok: false, move: null };
  if (!state.alive[cubeId] || state.cellOf[cubeId] !== nach) return { ok: false, move: null };
  if (!Number.isInteger(von) || von < 0 || von >= board.C || von === nach) return { ok: false, move: null };
  if (state.occ[von] !== EMPTY) return { ok: false, move: null };

  // Der Stein wird probeweise nach `von` zurueckgezogen. Bei einem 2x1-Stein wandert
  // die zweite Zelle mit; liegt sie ausserhalb oder ist sie belegt, ist der Kandidat
  // unbrauchbar.
  const ext = state.extOf[cubeId];
  const zweiNach = ext === EXT_NONE ? OUT : board.step[nach * 6 + ext];
  const zweiVon = ext === EXT_NONE ? OUT : board.step[von * 6 + ext];
  if (ext !== EXT_NONE) {
    if (zweiVon === OUT) return { ok: false, move: null };
    if (state.occ[zweiVon] !== EMPTY && state.occ[zweiVon] !== cubeId) return { ok: false, move: null };
    if (board.valid[zweiVon * 6 + state.dirOf[cubeId]] !== 1) return { ok: false, move: null };
  }

  state.occ[nach] = EMPTY;
  if (zweiNach !== OUT) state.occ[zweiNach] = EMPTY;
  state.occ[von] = cubeId;
  if (zweiVon !== OUT) state.occ[zweiVon] = cubeId;
  state.cellOf[cubeId] = von;
  const m = resolveMove(board, state, von);
  state.occ[von] = EMPTY;
  if (zweiVon !== OUT) state.occ[zweiVon] = EMPTY;
  state.occ[nach] = cubeId;
  if (zweiNach !== OUT) state.occ[zweiNach] = cubeId;
  state.cellOf[cubeId] = nach;

  const ok = (m.kind === 'STEP' || m.kind === 'JUMP') && m.to === nach && m.jumps <= maxChain;
  return { ok, move: m };
}

// --- Kandidatensuche (SPEC §6.6) ----------------------------------------

const MAX_ZELLEN = 80;      // hoechstens so viele freie Zellen betrachten (grosse Bretter)
const MAX_KANDIDATEN = 200; // Abbruch der Suche (grosse Bretter)
const MAX_WUERFEL = 40;     // hoechstens so viele Wuerfel fuer unRelocate
const MAX_REL_KANDIDATEN = 60;
/** Ab dieser Zellzahl greift die Deckelung aus SPEC §6.6. */
const VOLLSUCHE_BIS = 400;

function freieZellen(board, state) {
  const res = [];
  for (let c = 0; c < board.C; c++) if (state.occ[c] === EMPTY) res.push(c);
  return res;
}

/**
 * Alle Un-Austritte, die die Regel im aktuellen Zustand akzeptiert.
 *
 * Abweichung von SPEC §6.6, gemessen begruendet: die dortige Deckelung (80 Zellen, 200
 * Kandidaten) schneidet bei den Brettgroessen der Levelkurve (C <= 150) genau die seltenen
 * Kandidaten mit langen Sprungketten weg — in Messungen sank die laengste Kette des
 * Referenzzuges damit auf 1, obwohl SPEC §6.11 Sprungketten als EINZIGE
 * Schwierigkeitsquelle benennt. Bis `VOLLSUCHE_BIS` Zellen wird deshalb vollstaendig
 * gesucht; die Kosten bleiben gleich, weil die Zahl freier Zellen mit jeder Platzierung
 * faellt. Oberhalb dieser Grenze gilt die Deckelung unveraendert.
 */
/**
 * Moegliche Ausleger einer Zelle: nur zur groesseren Zellnummer hin, damit der Anker
 * eines 2x1-Steins eindeutig die kleinere Zelle ist.
 */
function auslegerVon(board, state, cell) {
  const res = [];
  for (let e = 0; e < 6; e++) {
    if (board.valid[cell * 6 + e] !== 1) continue;
    const z = board.step[cell * 6 + e];
    if (z === OUT || z <= cell) continue;
    if (state.occ[z] !== EMPTY) continue;
    res.push(e);
  }
  return res;
}

/**
 * @param {number} ext EXT_NONE fuer 1x1-Wuerfel, sonst werden ausschliesslich
 *        2x1-Steine aufgezaehlt. Die Form wird je Runde vorab gewaehlt (tryGenerate),
 *        damit die Kandidatensuche nicht um den Faktor der Auslegerzahl waechst.
 */
function unExitCandidates(board, state, rng, spec, zweizellig = false) {
  const cands = [];
  const formen = (cell) => zweizellig ? auslegerVon(board, state, cell) : [EXT_NONE];

  if (board.C <= VOLLSUCHE_BIS) {
    for (let c = 0; c < board.C; c++) {
      if (state.occ[c] !== EMPTY) continue;
      const exts = formen(c);
      for (let e = 0; e < exts.length; e++) {
        for (let d = 0; d < 6; d++) {
          if (board.valid[c * 6 + d] !== 1) continue;
          const pr = pruefeUnExit(board, state, c, d, spec.maxChain, exts[e]);
          if (pr.ok) cands.push({ art: 'exit', cell: c, dir: d, ext: exts[e], move: pr.move });
        }
      }
    }
    return cands;
  }
  const frei = shuffle(freieZellen(board, state), rng);
  const n = Math.min(frei.length, MAX_ZELLEN);
  for (let k = 0; k < n && cands.length < MAX_KANDIDATEN; k++) {
    const cell = frei[k];
    const dirs = validDirs(board, cell);
    const exts = formen(cell);
    for (let e = 0; e < exts.length && cands.length < MAX_KANDIDATEN; e++) {
      for (let j = 0; j < dirs.length; j++) {
        const pr = pruefeUnExit(board, state, cell, dirs[j], spec.maxChain, exts[e]);
        if (pr.ok) {
          cands.push({ art: 'exit', cell, dir: dirs[j], ext: exts[e], move: pr.move });
          if (cands.length >= MAX_KANDIDATEN) break;
        }
      }
    }
  }
  return cands;
}

function unRelocateCandidates(board, state, rng, spec) {
  const lebende = [];
  for (let id = 0; id < state.cubeCount; id++) if (state.alive[id]) lebende.push(id);
  shuffle(lebende, rng);
  const cands = [];
  const n = Math.min(lebende.length, MAX_WUERFEL);
  const reichweite = Math.max(board.W, board.H, board.D) + 2;
  for (let k = 0; k < n && cands.length < MAX_REL_KANDIDATEN; k++) {
    const q = lebende[k];
    const nach = state.cellOf[q];
    const gegen = board.opp[state.dirOf[q]];
    // Der Kandidatenraum ist genau der eindimensionale Rueckwaertsstrahl (SPEC §6.3 B).
    let a = nach;
    for (let t = 1; t <= reichweite; t++) {
      a = board.step[a * 6 + gegen];
      if (a === OUT) break;
      if (state.occ[a] !== EMPTY) continue;
      const pr = pruefeUnRelocate(board, state, q, a, nach, spec.maxChain);
      if (pr.ok) {
        cands.push({ art: 'relocate', cubeId: q, cell: a, nach, dir: state.dirOf[q], move: pr.move });
        if (cands.length >= MAX_REL_KANDIDATEN) break;
      }
    }
  }
  return cands;
}

// --- Bewertung (SPEC §6.6) ----------------------------------------------

function belegteNachbarn(board, state, cell) {
  let n = 0;
  for (let d = 0; d < 6; d++) {
    if (board.valid[cell * 6 + d] !== 1) continue;
    const s = board.step[cell * 6 + d];
    if (s !== OUT && state.occ[s] !== EMPTY) n++;
  }
  return n / 6;
}

/** 1 minus mittleres, normiertes Alter der uebersprungenen Traeger. */
function frischeDerTraeger(state, jumped) {
  if (!jumped || jumped.length === 0) return 0;
  const n = Math.max(1, state.cubeCount);
  let s = 0;
  for (let i = 0; i < jumped.length; i++) {
    const id = state.occ[jumped[i]];
    if (id !== EMPTY) s += (id + 1) / n;
  }
  return s / jumped.length;
}

/** Anteil der belegten Nachbarn mit ABWEICHENDER Pfeilrichtung (SPEC §6.6). */
function richtungsVielfalt(board, state, cell, dir) {
  let gleich = 0, ges = 0;
  for (let d = 0; d < 6; d++) {
    if (board.valid[cell * 6 + d] !== 1) continue;
    const s = board.step[cell * 6 + d];
    if (s === OUT) continue;
    const id = state.occ[s];
    if (id === EMPTY) continue;
    ges++;
    if (state.dirOf[id] === dir) gleich++;
  }
  return ges === 0 ? 1 : 1 - gleich / ges;
}

/** Randlage der Zelle: belohnt eine klare Silhouette statt eines Klumpens in der Mitte. */
function silhouettenBonus(board, cell) {
  let rand = 0, ges = 0;
  for (let d = 0; d < 6; d++) {
    if (board.valid[cell * 6 + d] !== 1) continue;
    ges++;
    if (board.step[cell * 6 + d] === OUT) rand++;
  }
  return ges === 0 ? 0 : rand / ges;
}

function score(board, state, c, spec, rng) {
  const w = spec.weights;
  return w.wFill * belegteNachbarn(board, state, c.cell)
    + w.wChain * Math.min(c.move.jumps, spec.maxChain)
    + w.wFrag * frischeDerTraeger(state, c.move.jumped)
    + w.wDiv * richtungsVielfalt(board, state, c.cell, c.dir)
    + w.wSil * silhouettenBonus(board, c.cell)
    + w.wRand * rng();
}

/** Deterministische Maximumswahl: erster Kandidat mit strikt groesstem Score. */
function waehleBesten(board, state, cands, spec, rng) {
  let best = cands[0], bestW = -Infinity;
  for (let i = 0; i < cands.length; i++) {
    const s = score(board, state, cands[i], spec, rng);
    if (s > bestW) { bestW = s; best = cands[i]; }
  }
  return best;
}

/** Schreibt den akzeptierten Un-Zug fort und stellt ihn der Referenzliste VORAN. */
function applyUnMove(state, cand, ref, info) {
  if (cand.art === 'exit') {
    const id = addCube(state, cand.cell, cand.dir, false,
      cand.ext === undefined ? EXT_NONE : cand.ext);
    ref.unshift(cand.cell);
    info.unshift({ cell: cand.cell, cubeId: id, kind: 'EXIT' });
    return;
  }
  const ext = state.extOf[cand.cubeId];
  const zweiNach = ext === EXT_NONE ? OUT : state.step[cand.nach * 6 + ext];
  const zweiCell = ext === EXT_NONE ? OUT : state.step[cand.cell * 6 + ext];
  state.occ[cand.nach] = EMPTY;
  if (zweiNach !== OUT) state.occ[zweiNach] = EMPTY;
  state.occ[cand.cell] = cand.cubeId;
  if (zweiCell !== OUT) state.occ[zweiCell] = cand.cubeId;
  state.cellOf[cand.cubeId] = cand.cell;
  ref.unshift(cand.cell);
  info.unshift({ cell: cand.cell, cubeId: cand.cubeId, kind: cand.move.kind });
}

// --- Fuellrueckfall (SPEC §6.5) -----------------------------------------

/**
 * Sucht fuer einen frisch gesetzten Wuerfel auf `q` eine Richtung, in der er das Gitter
 * nachweislich verlaesst, und liefert die zugehoerige Tippfolge.
 *
 * Abweichung von SPEC §6.5, bewusst und begruendet: der dortige Satz behauptet
 * `resolveMove(q, d*) === 'EXIT'` in einem einzigen Zug. Das ist fuer minDepth(q) >= 1
 * nachweislich falsch — der Korridor vor `q` ist in der absteigenden Tiefenordnung noch
 * leer, die Regel liefert also einen SCHRITT, keinen Austritt. Ein einzuegiger Austritt
 * ist ueberdies fuer Zellen, deren Austrittstiefe in jeder Richtung gerade und groesser
 * als null ist, in KEINEM Zustand moeglich (Beispiel: Mittelzelle eines 5x5x5-Quaders;
 * ein Sprung landet dort stets im Gitter). Statt der falschen Zusicherung wird hier die
 * bewiesene Aussage benutzt: der Korridor `q, q+d*, ...` besteht aus Zellen strikt
 * kleinerer Tiefe, ist in dieser Ordnung noch frei und bleibt frei, bis der Wuerfel
 * ausgetreten ist. Der Wuerfel laeuft ihn in genau minDepth(q) Schritten ab und tritt im
 * letzten Zug aus. Jeder dieser Zuege wird einzeln von resolveMove im dann gueltigen
 * Zustand geprueft; die Loesbarkeitsgarantie bleibt damit unveraendert.
 *
 * Ein einzuegiger Austritt wird bevorzugt, wenn es ihn gibt: dann bleibt `par` bei einem
 * Tipp je Wuerfel (SPEC §6.11).
 */
function austrittsfolge(board, state, q, rng, maxChain) {
  const beste = bestExitDirs(board, q);
  const uebrige = validDirs(board, q).filter((d) => beste.indexOf(d) < 0);
  const reihenfolge = shuffle(beste.slice(), rng).concat(shuffle(uebrige, rng));
  const grenze = board.W + board.H + board.D + 4;   // der Wuerfel laeuft monoton auf einem Strahl

  for (let k = 0; k < reihenfolge.length; k++) {
    const d = reihenfolge[k];
    const id = addCube(state, q, d);
    const zellen = [], zuege = [];
    let cur = q, fertig = false;
    for (let t = 0; t < grenze; t++) {
      const m = resolveMove(board, state, cur);
      if (m.kind === 'INVALID' || m.jumps > maxChain) break;
      zellen.push(cur); zuege.push(m);
      applyMove(state, m);
      if (m.kind === 'EXIT') { fertig = true; break; }
      cur = m.to;
    }
    for (let i = zuege.length - 1; i >= 0; i--) revertMove(state, zuege[i]);
    if (fertig) {
      const info = [];
      for (let i = 0; i < zellen.length; i++) info.push({ cell: zellen[i], cubeId: id, kind: zuege[i].kind });
      return { zellen, info, cubeId: id };
    }
    dropCube(state, id);
  }
  return null;
}

/**
 * Tiefenmonotone Fuellung (SPEC §6.5). Fuellt die freien Zellen absteigend nach
 * `minDepthOf`; Gleichstand per Fisher-Yates gemischt, Vergleicher total (Rang als
 * Tiebreak). Jeder eingeschleuste Wuerfel wird der Referenzliste vorangestellt und
 * fliegt in der Referenzloesung als erster wieder heraus, beruehrt also keinen bereits
 * verifizierten Folgezug.
 *
 * @param {Object} board @param {Object} state
 * @param {number[]} ref Zellindizes in Klickreihenfolge; wird vorne ergaenzt
 * @param {() => number} rng
 * @param {{maxChain?:number, limit?:number, info?:Array}} [opts]
 * @returns {{added:number, moves:number}}
 */
export function fillByDepth(board, state, ref, rng, opts = {}) {
  const maxChain = Number.isFinite(opts.maxChain) ? opts.maxChain : 6;
  const limit = Number.isFinite(opts.limit) ? opts.limit : Infinity;
  const info = Array.isArray(opts.info) ? opts.info : null;

  const frei = shuffle(freieZellen(board, state), rng);
  const rang = new Int32Array(board.C).fill(-1);
  for (let k = 0; k < frei.length; k++) rang[frei[k]] = k;
  frei.sort((a, b) => (board.minDepthOf[b] - board.minDepthOf[a]) || (rang[a] - rang[b]));

  let gesetzt = 0, zuege = 0;
  for (let k = 0; k < frei.length; k++) {
    if (state.aliveCount >= limit) break;
    const q = frei[k];
    if (state.occ[q] !== EMPTY) continue;
    const folge = austrittsfolge(board, state, q, rng, maxChain);
    if (!folge) continue;
    ref.unshift(...folge.zellen);
    if (info) info.unshift(...folge.info);
    gesetzt++;
    zuege += folge.zellen.length;
  }
  return { added: gesetzt, moves: zuege };
}

// --- Hauptschleife (SPEC §6.6) ------------------------------------------

function tryGenerate(board, spec, rng) {
  const state = emptyState(board, board.C, spec.goal);
  const ref = [];      // Zellindizes in Klickreihenfolge
  const info = [];     // parallel dazu: {cell, cubeId, kind}
  const N = Math.min(MAX_CUBES, board.C, Math.round(spec.density * board.C));
  let guard = 60 * N + 60;

  // Belegte Zellen statt Steinzahl als Abbruchmass: ein 2x1-Stein fuellt zwei Zellen,
  // sonst waere die Dichte von der Steinform abhaengig.
  const belegt = () => {
    let n = 0;
    for (let c = 0; c < board.C; c++) if (state.occ[c] !== EMPTY) n++;
    return n;
  };

  let voll = belegt();
  while (voll < N && guard-- > 0) {
    const useRelocate = state.aliveCount > 2 && rng() < spec.relocateRate;
    // Form der Runde vorab waehlen; ein 2x1-Stein braucht zwei freie Zellen.
    const willZwei = !useRelocate && (N - voll) >= 2 && rng() < (spec.dominoRate || 0);

    let cands = useRelocate ? unRelocateCandidates(board, state, rng, spec)
      : unExitCandidates(board, state, rng, spec, willZwei);
    if (cands.length === 0 && willZwei)
      cands = unExitCandidates(board, state, rng, spec, false);
    if (cands.length === 0)
      cands = useRelocate ? unExitCandidates(board, state, rng, spec, false)
        : unRelocateCandidates(board, state, rng, spec);
    if (cands.length === 0) break;   // -> Fuellrueckfall
    applyUnMove(state, waehleBesten(board, state, cands, spec, rng), ref, info);
    voll = belegt();
  }

  if (voll < N)
    fillByDepth(board, state, ref, rng, { maxChain: spec.maxChain, limit: N, info });

  return { state, ref, info };
}

// --- Kennzahlen (SPEC §3.5, §6.10) --------------------------------------

/** Playouts je Erzeugung; klein gehalten, weil generateLevel im Client blockiert. */
const GEN_PLAYOUTS = 4;

function kennzahlen(board, level, runs, rng) {
  const start = createState(board, level.cubes, level.goal);
  // Dichte = Anteil BELEGTER ZELLEN, nicht Steine je Zelle. Ein 2x1-Stein fuellt zwei
  // Zellen; die Steinzahl allein waere von der Steinform abhaengig und als Fuellmass
  // unbrauchbar (SPEC §3.5).
  let belegteZellen = 0;
  for (let c = 0; c < board.C; c++) if (start.occ[c] !== EMPTY) belegteZellen++;
  const dichte = board.C > 0 ? belegteZellen / board.C : 0;

  // Referenzloesung einmal durchspielen: Kettenanteil, laengste Kette, triviale Austritte.
  let ketten = 0, maxK = 0, trivial = 0;
  const s = createState(board, level.cubes, level.goal);
  for (let i = 0; i < level.witness.length; i++) {
    const m = resolveMove(board, s, level.witness[i]);
    if (m.kind === 'INVALID') break;
    if (m.jumps >= 1) ketten++;
    if (m.jumps > maxK) maxK = m.jumps;
    if (m.kind === 'EXIT' && m.jumps === 0) trivial++;
    applyMove(s, m);
  }
  const chainShare = level.witness.length > 0 ? ketten / level.witness.length : 0;
  // Anteil der Tipps, die ohne jeden Traeger ins Freie fuehren ("geschenkte" Zuege).
  const trivialExit = level.witness.length > 0 ? trivial / level.witness.length : 0;

  const laeufe = Math.max(1, runs | 0);
  let summe = 0;
  for (let r = 0; r < laeufe; r++) summe += solveGreedy(board, start, rng).moves;
  const naivePerPar = level.par > 0 ? (summe / laeufe) / level.par : 0;

  return {
    density: runde(dichte, 4),
    chainShare: runde(chainShare, 4),
    maxChain: maxK,
    mobility: runde(mobility(board, start), 4),
    naivePerPar: runde(naivePerPar, 4),
    trivialExit: runde(trivialExit, 4)
  };
}

/**
 * Kennzahlen mit vollem Playoutbudget. Laeuft im Client ausserhalb des Levelstart-Pfads;
 * der Worker fuehrt sie nie aus (SPEC §6.7).
 */
export function measureLevel(board, level, runs = 200) {
  return kennzahlen(board, level, runs, mulberry32((level.seed ^ 0x5DEECE66) >>> 0));
}

/**
 * Unabhaengiger Vorwaerts-Solver (SPEC §6.10). Kein Bestandteil der Garantie.
 * Politik je Lauf: zufall / gierig (bevorzugt EXIT) / weit (bevorzugt grosses jumps).
 * @returns {{solved:boolean, moves:number, rest:number}}
 */
export function solveGreedy(board, state, rng, maxSteps) {
  const s = cloneState(state);
  const grenze = Number.isFinite(maxSteps) ? maxSteps : 40 * board.C + 500;
  const politik = Math.min(2, Math.floor(rng() * 3));   // 0 zufall, 1 gierig, 2 weit
  let moves = 0;
  while (moves < grenze && !isSolved(s)) {
    const zellen = legalCells(board, s);
    if (zellen.length === 0) break;
    let wahl = zellen[0];
    if (politik === 0) {
      wahl = zellen[Math.min(zellen.length - 1, Math.floor(rng() * zellen.length))];
    } else {
      let bestW = -Infinity;
      for (let i = 0; i < zellen.length; i++) {
        const m = resolveMove(board, s, zellen[i]);
        const w = politik === 1
          ? (m.kind === 'EXIT' ? 1000 : 0) + m.jumps
          : m.jumps * 10 + (m.kind === 'EXIT' ? 5 : 0);
        if (w > bestW) { bestW = w; wahl = zellen[i]; }
      }
    }
    applyMove(s, resolveMove(board, s, wahl));
    moves++;
  }
  return { solved: isSolved(s), moves, rest: s.aliveCount };
}

// --- Serialisierung eines Rohlaufs --------------------------------------

function toLevel(board, roh, spec) {
  const state = roh.state;
  const cubes = [];
  const neueId = new Int32Array(Math.max(1, state.cubeCount)).fill(-1);
  // Aufsteigend nach Zellindex — die Schleife liefert die geforderte Sortierung direkt.
  for (let c = 0; c < board.C; c++) {
    const id = state.occ[c];
    if (id === EMPTY || !state.alive[id]) continue;
    if (state.cellOf[id] !== c) continue;   // zweite Zelle eines 2x1-Steins
    neueId[id] = cubes.length;
    const stein = { cell: c, dir: state.dirOf[id], target: false };
    if (state.extOf[id] !== EXT_NONE) stein.ext = state.extOf[id];
    cubes.push(stein);
  }
  if (cubes.length === 0) return null;

  let witness = roh.ref.slice();
  let targetId = null;

  if (spec.goal === 'BEFREIUNG') {
    // Der gruene Wuerfel ist der, dessen Austritt in ref beim Quantil liegt (SPEC §6.9).
    const austritte = [];
    for (let i = 0; i < roh.info.length; i++) if (roh.info[i].kind === 'EXIT') austritte.push(i);
    if (austritte.length === 0) return null;
    const q = Math.min(1, Math.max(0, spec.targetQuantile));
    let k = Math.round(q * (austritte.length - 1));
    if (k < 0) k = 0;
    if (k > austritte.length - 1) k = austritte.length - 1;
    const pos = austritte[k];
    const neu = neueId[roh.info[pos].cubeId];
    if (neu < 0) return null;
    targetId = neu;
    cubes[targetId].target = true;
    witness = roh.ref.slice(0, pos + 1);
  }

  const f = sternFaktoren(spec.mode, spec.goal, board.W, board.H, board.D);
  const par = witness.length;
  const level = {
    v: 1,
    ruleVersion: RULE_VERSION,
    genVersion: GEN_VERSION,
    seed: spec.seed >>> 0,
    attempt: spec.attempt | 0,
    mode: spec.mode,
    goal: spec.goal,
    dims: { W: board.W, H: board.H, D: board.D },
    levelCode: encodeLevelCode(spec),
    cubes,
    targetId,
    witness,
    par,
    stars: [par, Math.ceil(par * f[0]), Math.ceil(par * f[1])],
    metrics: null
  };
  level.metrics = kennzahlen(board, level, GEN_PLAYOUTS,
    mulberry32(hash32((spec.seed ^ ((spec.attempt + 1) * 0x9E3779B1)) >>> 0)));
  return level;
}

function erzeugeVersuch(board, spec) {
  const rng = mulberry32((spec.seed ^ (spec.attempt * 0x9E3779B1)) >>> 0);
  return toLevel(board, tryGenerate(board, spec, rng), spec);
}

function imBand(x, band) {
  return Number.isFinite(x) && x >= band[0] && x <= band[1];
}

function inBands(m, b) {
  return imBand(m.naivePerPar, b.naivePerPar)
    && imBand(m.chainShare, b.chainShare)
    && imBand(m.mobility, b.mobility)
    && imBand(m.trivialExit, b.trivialExit);
}

function bandAbstand(x, band) {
  if (!Number.isFinite(x)) return 1e6;
  if (x < band[0]) return band[0] - x;
  if (x > band[1]) return x - band[1];
  return 0;
}

function bandStrafe(m, b) {
  return bandAbstand(m.naivePerPar, b.naivePerPar)
    + bandAbstand(m.chainShare, b.chainShare)
    + bandAbstand(m.mobility, b.mobility)
    + bandAbstand(m.trivialExit, b.trivialExit);
}

// --- Erzeugung (SPEC §6.7) ----------------------------------------------

/**
 * Erzeugt, bewertet, VERIFIZIERT und liefert erst dann aus.
 * @param {Object} spec LevelSpec
 * @returns {Object} Level
 */
export function generateLevel(spec) {
  const basis = normSpec(spec);
  const board = buildBoard({ mode: basis.mode, W: basis.W, H: basis.H, D: basis.D });
  let bester = null, besteStrafe = Infinity;

  for (let attempt = 0; attempt < 12; attempt++) {
    const versuch = Object.assign({}, basis, { attempt });
    const level = erzeugeVersuch(board, versuch);
    if (!level) continue;
    const ver = verifyLevel(level);
    if (!ver.ok) continue;                       // darf nie passieren; Tests decken das ab
    if (attempt === 11 || inBands(level.metrics, versuch.bands)) return level;
    const strafe = bandStrafe(level.metrics, versuch.bands);
    if (strafe < besteStrafe) { besteStrafe = strafe; bester = level; }
  }
  if (bester) return bester;                     // Loesbarkeit haengt nicht an den Baendern
  throw new Error('generateLevel: kein verifizierbares Level nach 12 Versuchen');
}

/**
 * Regeneriert ein Level bitgleich aus seinem Code. Der Versuchsindex steht im Code,
 * deshalb genuegt genau ein Durchlauf ohne Bewertungsprobe (SPEC §6.7).
 */
export function generateFromCode(code) {
  const spec = parseLevelCode(code);
  const board = buildBoard({ mode: spec.mode, W: spec.W, H: spec.H, D: spec.D });
  const level = erzeugeVersuch(board, spec);
  if (!level) throw new Error('generateFromCode: kein Level zu ' + code);
  const ver = verifyLevel(level);
  if (!ver.ok) throw new Error('generateFromCode: Verifikation fehlgeschlagen (' + ver.reason + ')');
  return level;
}

/** Level der Kurve; `override` erlaubt freies Spiel mit abweichenden Parametern. */
export function generateForLevelNo(n, override) {
  const spec = levelSpecFor(n);
  return generateLevel(override ? Object.assign({}, spec, override) : spec);
}

// --- Verifikation (PFLICHT im Produktivpfad, SPEC §6.8) -----------------

/**
 * Strukturpruefung der serialisierten Beschreibung. Findet Serialisierungsfehler
 * (Zellindex, Richtung, Zielmarkierung, Sortierung), die eine konstruktive Garantie
 * prinzipiell nicht sehen kann.
 * @returns {{ok:boolean, reason?:string, board?:Object}}
 */
function pruefeStruktur(level) {
  if (!level || typeof level !== 'object') return { ok: false, reason: 'level' };
  if (level.v !== 1) return { ok: false, reason: 'v' };
  if (level.ruleVersion !== RULE_VERSION) return { ok: false, reason: 'ruleVersion' };
  if (level.genVersion !== GEN_VERSION) return { ok: false, reason: 'genVersion' };
  if (level.mode !== 'FASSADE' && level.mode !== 'VOLUMEN') return { ok: false, reason: 'mode' };
  if (level.goal !== 'ABBAU' && level.goal !== 'BEFREIUNG') return { ok: false, reason: 'goal' };

  const dims = level.dims;
  if (!dims || !Number.isInteger(dims.W) || !Number.isInteger(dims.H) || !Number.isInteger(dims.D))
    return { ok: false, reason: 'dims' };
  let board;
  try { board = buildBoard({ mode: level.mode, W: dims.W, H: dims.H, D: dims.D }); }
  catch { return { ok: false, reason: 'dims' }; }

  if (!Array.isArray(level.cubes) || level.cubes.length === 0) return { ok: false, reason: 'cubes' };
  if (level.cubes.length > MAX_CUBES || level.cubes.length > board.C) return { ok: false, reason: 'cubes' };

  let vorher = -1, ziele = 0;
  const zellenBelegt = new Set();
  for (let i = 0; i < level.cubes.length; i++) {
    const cu = level.cubes[i];
    if (!cu || typeof cu !== 'object') return { ok: false, reason: 'cube@' + i };
    if (!Number.isInteger(cu.cell) || cu.cell <= vorher || cu.cell >= board.C)
      return { ok: false, reason: 'cell@' + i };
    if (!Number.isInteger(cu.dir) || cu.dir < 0 || cu.dir > 5 || board.valid[cu.cell * 6 + cu.dir] !== 1)
      return { ok: false, reason: 'dir@' + i };

    // 2x1-Stein: der Anker MUSS die kleinere der beiden Zellen sein, damit die
    // Beschreibung eindeutig ist und der Zeugenzug den Anker nennt.
    if (cu.ext !== undefined) {
      if (!Number.isInteger(cu.ext) || cu.ext < 0 || cu.ext > 5) return { ok: false, reason: 'ext@' + i };
      if (board.valid[cu.cell * 6 + cu.ext] !== 1) return { ok: false, reason: 'ext@' + i };
      const zweite = board.step[cu.cell * 6 + cu.ext];
      if (zweite === OUT || zweite <= cu.cell) return { ok: false, reason: 'ext@' + i };
      if (board.valid[zweite * 6 + cu.dir] !== 1) return { ok: false, reason: 'ext@' + i };
      if (zellenBelegt.has(zweite)) return { ok: false, reason: 'ext@' + i };
      zellenBelegt.add(zweite);
    }
    if (zellenBelegt.has(cu.cell)) return { ok: false, reason: 'cell@' + i };
    zellenBelegt.add(cu.cell);

    vorher = cu.cell;
    if (cu.target) { ziele++; if (level.targetId !== i) return { ok: false, reason: 'targetId' }; }
  }
  if (level.goal === 'BEFREIUNG') {
    if (ziele !== 1 || !Number.isInteger(level.targetId)) return { ok: false, reason: 'targetId' };
  } else if (ziele !== 0 || level.targetId !== null) {
    return { ok: false, reason: 'targetId' };
  }

  if (!Array.isArray(level.witness)) return { ok: false, reason: 'witness' };
  for (let i = 0; i < level.witness.length; i++)
    if (!Number.isInteger(level.witness[i])) return { ok: false, reason: 'witness@' + i };

  return { ok: true, board };
}

/**
 * Baut Board und State AUSSCHLIESSLICH aus der serialisierten Levelbeschreibung neu auf
 * und spielt den witness Zug fuer Zug mit resolveMove ab (SPEC §6.8).
 * @returns {{ok:boolean, checked:number, reason?:string}}
 */
export function verifyLevel(level) {
  const st = pruefeStruktur(level);
  if (!st.ok) return { ok: false, checked: 0, reason: st.reason };
  const board = st.board;
  if (level.par !== level.witness.length) return { ok: false, checked: -1, reason: 'par' };

  const state = createState(board, level.cubes, level.goal);
  if (level.goal === 'BEFREIUNG' && state.targetId !== level.targetId)
    return { ok: false, checked: 0, reason: 'targetId' };

  for (let i = 0; i < level.witness.length; i++) {
    const cell = level.witness[i];
    const m = resolveMove(board, state, cell);
    if (m.kind === 'INVALID') return { ok: false, checked: i, reason: 'invalid@' + i };
    if (m.from !== cell) return { ok: false, checked: i, reason: 'from@' + i };
    applyMove(state, m);
  }
  if (!isSolved(state)) return { ok: false, checked: level.witness.length, reason: 'unsolved' };
  return { ok: true, checked: level.witness.length };
}

/**
 * Spielt eine Tippfolge auf der serialisierten Beschreibung nach. Zaehlt nur gueltige
 * Zuege; vom Worker fuer die Score-Pruefung benutzt (SPEC §9.4).
 * @returns {{ok:boolean, moves:number, invalid:number, solved:boolean, timeLowerMs:number}}
 */
export function replayTaps(level, taps) {
  const st = pruefeStruktur(level);
  if (!st.ok) return { ok: false, moves: 0, invalid: 0, solved: false, timeLowerMs: 0 };
  const board = st.board;
  const state = createState(board, level.cubes, level.goal);
  const liste = Array.isArray(taps) ? taps : [];
  let moves = 0, invalid = 0;
  for (let i = 0; i < liste.length; i++) {
    const m = resolveMove(board, state, liste[i]);
    if (m.kind === 'INVALID') { invalid++; continue; }
    applyMove(state, m);
    moves++;
  }
  return {
    ok: true,
    moves,
    invalid,
    solved: isSolved(state),
    timeLowerMs: Math.max(300, moves * 60)
  };
}
