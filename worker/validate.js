// Serverseitige Validierung: Abfrageparameter und Einreichungen (SPEC §9.3, §9.4).
// Reines Modul ohne Cloudflare-Bindungen, damit tests/worker.test.js es ohne Netzwerk laedt.

import { RULE_VERSION } from '../public/src/game.js';
import { GEN_VERSION } from '../public/src/levels.js';

export const MAX_BODY_BYTES = 8192;
export const MAX_TIME_MS = 12 * 60 * 60 * 1000;   // 12 h
export const MAX_TAPS = 20000;
export const MAX_UNDOS = 100000;

/**
 * Beim ABFRAGEN bleiben beide Werte gueltig: in der Datenbank koennen Eintraege aus der
 * Zeit stehen, in der die Schalenvariante FASSADE spielbar war. EINGEREICHT wird nur noch
 * 'volumen' (siehe validateSubmission).
 */
const DIR_MODES = ['fassade', 'volumen'];
const DIR_MODES_EINREICHUNG = ['volumen'];
const GOAL_MODES = ['abbau', 'befreiung'];

const QUERY_KEYS = ['dir', 'goal', 'size', 'limit', 'offset', 'bestPerName'];
const SIZE_RE = /^(\d{1,2})x(\d{1,2})x(\d{1,2})$/;
const UINT_RE = /^\d{1,7}$/;
const LEVELCODE_RE = /^[FV]-[AB]-\d+x\d+x\d+-\d{1,2}-[0-9A-F]{8}$/;
const LEVELCODE_TEILE = /^([FV])-([AB])-(\d+)x(\d+)x(\d+)-(\d{1,2})-([0-9A-F]{8})$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const APPVERSION_RE = /^[A-Za-z0-9._-]{1,16}$/;

/** @typedef {{ok:false, status:number, error:string, field?:string, message:string}} ValidationError */

/** @returns {ValidationError} */
function fehler(error, field, message, status = 400) {
  const e = { ok: false, status, error, message };
  if (field) e.field = field;
  return e;
}

function istInt(v) { return typeof v === 'number' && Number.isInteger(v); }

/**
 * Zellzahl eines Turms. MUSS mit buildBoard(...).C uebereinstimmen (SPEC §9.4, Test §10.6.1).
 * @param {string} dirMode @param {number} x W @param {number} y H @param {number} z D
 * @returns {number}
 */
export function capacity(dirMode, x, y, z) {
  if (dirMode !== 'volumen') return NaN;   // FASSADE ist entfallen
  return x * y * z;
}

/**
 * Beweisbare Untergrenze der Zugzahl. Niemals eine Distanzschranke: eine Sprungkette
 * traegt in EINEM Zug beliebig weit (SPEC §9.4).
 * @param {string} goalMode @param {number} cubes @returns {number}
 */
export function minMoves(goalMode, cubes) {
  return goalMode === 'abbau' ? cubes : 1;
}

/** Obergrenze der Zugzahl: grosszuegig, aber endlich. */
export function maxMoves(cubes) {
  return 40 * cubes + 500;
}

/** Untergrenze der Spielzeit in Millisekunden. */
export function minTimeMs(moves) {
  return Math.max(300, moves * 60);
}

/**
 * Zerlegt die Abfrage der Bestenliste. Unbekannte Parameter, doppelte Parameter und
 * ungueltige Werte werden abgelehnt statt geclampt (SPEC §9.3, Test §10.6.5).
 * @param {URLSearchParams} searchParams
 * @returns {{ok:true, query:{dir:string|null, goal:string|null, size:string|null,
 *            sizeDims:{x:number,y:number,z:number}|null, limit:number, offset:number,
 *            bestPerName:boolean}} | ValidationError}
 */
export function parseQuery(searchParams) {
  const sp = searchParams instanceof URLSearchParams
    ? searchParams
    : new URLSearchParams(searchParams || '');

  for (const key of sp.keys()) {
    if (QUERY_KEYS.indexOf(key) === -1)
      return fehler('validation', key, 'Unbekannter Abfrageparameter: ' + key);
    if (sp.getAll(key).length > 1)
      return fehler('validation', key, 'Parameter mehrfach angegeben: ' + key);
  }

  const q = { dir: null, goal: null, size: null, sizeDims: null, limit: 20, offset: 0, bestPerName: false };

  if (sp.has('dir')) {
    const v = sp.get('dir');
    if (DIR_MODES.indexOf(v) === -1)
      return fehler('validation', 'dir', 'dir muss fassade oder volumen sein.');
    q.dir = v;
  }
  if (sp.has('goal')) {
    const v = sp.get('goal');
    if (GOAL_MODES.indexOf(v) === -1)
      return fehler('validation', 'goal', 'goal muss abbau oder befreiung sein.');
    q.goal = v;
  }
  if (sp.has('size')) {
    const v = sp.get('size');
    const m = SIZE_RE.exec(v || '');
    if (!m) return fehler('validation', 'size', 'size muss die Form BreitexHoehexTiefe haben.');
    const x = parseInt(m[1], 10), y = parseInt(m[2], 10), z = parseInt(m[3], 10);
    if (!masseImRahmen(x, y, z))
      return fehler('validation', 'size', 'size liegt ausserhalb der erlaubten Masse.');
    q.size = x + 'x' + y + 'x' + z;
    q.sizeDims = { x, y, z };
  }
  if (sp.has('limit')) {
    const v = sp.get('limit');
    if (!UINT_RE.test(v || '')) return fehler('validation', 'limit', 'limit muss eine ganze Zahl sein.');
    const n = parseInt(v, 10);
    if (n < 1 || n > 100) return fehler('validation', 'limit', 'limit muss zwischen 1 und 100 liegen.');
    q.limit = n;
  }
  if (sp.has('offset')) {
    const v = sp.get('offset');
    if (!UINT_RE.test(v || '')) return fehler('validation', 'offset', 'offset muss eine ganze Zahl sein.');
    const n = parseInt(v, 10);
    if (n > 1000) return fehler('validation', 'offset', 'offset darf hoechstens 1000 sein.');
    q.offset = n;
  }
  if (sp.has('bestPerName')) {
    const v = sp.get('bestPerName');
    if (v !== '1') return fehler('validation', 'bestPerName', 'bestPerName darf nur 1 sein.');
    q.bestPerName = true;
  }
  return { ok: true, query: q };
}

/** Masse gemaess §2.0: W,D in [3,16], H in [2,24]. */
function masseImRahmen(x, y, z) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
    && x >= 3 && x <= 16 && y >= 2 && y <= 24 && z >= 3 && z <= 16;
}

/**
 * Prueft eine POST-Nutzlast vollstaendig gegen Typen, Grenzen und Spiellogik.
 * Unbekannte Felder werden verworfen (Allowlist).
 * @param {any} payload
 * @returns {{ok:true, value:Object} | ValidationError}
 */
export function validateSubmission(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return fehler('validation', undefined, 'Der Rumpf muss ein JSON-Objekt sein.');

  // --- Pflichtfelder: Vorhandensein -------------------------------------
  const pflicht = ['name', 'dirMode', 'goalMode', 'size', 'cubes', 'moves', 'timeMs',
    'runId', 'levelCode', 'ruleVersion', 'genVersion'];
  for (const f of pflicht) {
    if (payload[f] === undefined || payload[f] === null)
      return fehler('validation', f, 'Pflichtfeld fehlt: ' + f);
  }

  // --- Versionen ---------------------------------------------------------
  if (payload.ruleVersion !== RULE_VERSION)
    return fehler('version_mismatch', 'ruleVersion', 'Diese Spielversion passt nicht mehr zum Server. Bitte Seite neu laden.');
  if (payload.genVersion !== GEN_VERSION)
    return fehler('version_mismatch', 'genVersion', 'Diese Spielversion passt nicht mehr zum Server. Bitte Seite neu laden.');

  // --- Name (Rohform; Feinfilter in names.js) ----------------------------
  if (typeof payload.name !== 'string')
    return fehler('validation', 'name', 'name muss eine Zeichenkette sein.');
  if (payload.name.length > 64)
    return fehler('validation', 'name', 'name ist zu lang.');

  // --- Modi --------------------------------------------------------------
  if (typeof payload.dirMode !== 'string' || DIR_MODES_EINREICHUNG.indexOf(payload.dirMode) === -1)
    return fehler('validation', 'dirMode', 'dirMode muss volumen sein.');
  if (typeof payload.goalMode !== 'string' || GOAL_MODES.indexOf(payload.goalMode) === -1)
    return fehler('validation', 'goalMode', 'goalMode muss abbau oder befreiung sein.');

  // --- Groesse -----------------------------------------------------------
  const size = payload.size;
  if (!size || typeof size !== 'object' || Array.isArray(size)
    || !istInt(size.x) || !istInt(size.y) || !istInt(size.z))
    return fehler('validation', 'size', 'size muss {x,y,z} als ganze Zahlen enthalten.');
  if (!masseImRahmen(size.x, size.y, size.z))
    return fehler('validation', 'size', 'Die Turmmasse liegen ausserhalb des erlaubten Bereichs.');
  const sizeKey = size.x + 'x' + size.y + 'x' + size.z;
  const kap = capacity(payload.dirMode, size.x, size.y, size.z);

  // --- Zahlenfelder ------------------------------------------------------
  if (!istInt(payload.cubes)) return fehler('validation', 'cubes', 'cubes muss eine ganze Zahl sein.');
  if (!istInt(payload.moves)) return fehler('validation', 'moves', 'moves muss eine ganze Zahl sein.');
  if (!istInt(payload.timeMs)) return fehler('validation', 'timeMs', 'timeMs muss eine ganze Zahl sein.');

  let undos = 0;
  if (payload.undos !== undefined && payload.undos !== null) {
    if (!istInt(payload.undos)) return fehler('validation', 'undos', 'undos muss eine ganze Zahl sein.');
    if (payload.undos < 0 || payload.undos > MAX_UNDOS)
      return fehler('validation', 'undos', 'undos liegt ausserhalb des erlaubten Bereichs.');
    undos = payload.undos;
  }

  if (payload.cubes < 1 || payload.cubes > kap)
    return fehler('implausible', 'cubes', 'Die Wuerfelzahl passt nicht zu dieser Turmgroesse.');
  if (payload.moves < minMoves(payload.goalMode, payload.cubes))
    return fehler('implausible', 'moves', 'Mit so wenigen Zuegen ist dieser Turm nicht loesbar.');
  if (payload.moves > maxMoves(payload.cubes))
    return fehler('implausible', 'moves', 'Die Zugzahl ist unglaubwuerdig hoch.');
  if (payload.timeMs < minTimeMs(payload.moves))
    return fehler('implausible', 'timeMs', 'Die Spielzeit ist fuer diese Zugzahl zu kurz.');
  if (payload.timeMs > MAX_TIME_MS)
    return fehler('implausible', 'timeMs', 'Die Spielzeit ist zu lang.');

  // --- Levelcode ---------------------------------------------------------
  if (typeof payload.levelCode !== 'string' || !LEVELCODE_RE.test(payload.levelCode))
    return fehler('validation', 'levelCode', 'levelCode hat ein ungueltiges Format.');
  const lc = LEVELCODE_TEILE.exec(payload.levelCode);
  if (lc[1] !== 'V') return fehler('implausible', 'levelCode', 'levelCode nennt einen entfallenen Modus.');
  const lcDir = 'volumen';
  const lcGoal = lc[2] === 'B' ? 'befreiung' : 'abbau';
  if (lcDir !== payload.dirMode || lcGoal !== payload.goalMode
    || parseInt(lc[3], 10) !== size.x || parseInt(lc[4], 10) !== size.y
    || parseInt(lc[5], 10) !== size.z || parseInt(lc[6], 10) > 11)
    return fehler('implausible', 'levelCode', 'levelCode passt nicht zu Modus und Turmmassen.');

  // --- Kennungen ---------------------------------------------------------
  if (typeof payload.runId !== 'string' || !UUID_RE.test(payload.runId))
    return fehler('validation', 'runId', 'runId muss eine UUID sein.');
  let clientId = null;
  if (payload.clientId !== undefined && payload.clientId !== null) {
    if (typeof payload.clientId !== 'string' || !UUID_RE.test(payload.clientId))
      return fehler('validation', 'clientId', 'clientId muss eine UUID sein.');
    clientId = payload.clientId;
  }
  let appVersion = null;
  if (payload.appVersion !== undefined && payload.appVersion !== null) {
    if (typeof payload.appVersion !== 'string' || !APPVERSION_RE.test(payload.appVersion))
      return fehler('validation', 'appVersion', 'appVersion hat ein ungueltiges Format.');
    appVersion = payload.appVersion;
  }
  let seed = null;
  if (payload.seed !== undefined && payload.seed !== null) {
    if (!istInt(payload.seed) || payload.seed < 0 || payload.seed > 0xFFFFFFFF)
      return fehler('validation', 'seed', 'seed muss eine vorzeichenlose 32-Bit-Zahl sein.');
    seed = payload.seed;
  }

  // --- Tippfolge ---------------------------------------------------------
  let taps = null;
  if (payload.taps !== undefined && payload.taps !== null) {
    if (!Array.isArray(payload.taps))
      return fehler('validation', 'taps', 'taps muss eine Liste sein.');
    if (payload.taps.length > MAX_TAPS)
      return fehler('validation', 'taps', 'taps ist zu lang.');
    for (let i = 0; i < payload.taps.length; i++) {
      const t = payload.taps[i];
      if (!istInt(t) || t < 0)
        return fehler('validation', 'taps', 'taps enthaelt einen ungueltigen Eintrag an Position ' + i + '.');
    }
    taps = payload.taps;
    if (taps.length < payload.moves)
      return fehler('implausible', 'taps', 'Es wurden weniger Tipps als Zuege gemeldet.');
  }

  // --- Weiche Verdachtsbits (markieren, nie ablehnen) --------------------
  let suspicion = 0;
  if (payload.cubes < 0.25 * kap) suspicion |= 1;
  if (payload.timeMs / payload.moves < 200) suspicion |= 2;
  if (payload.goalMode === 'abbau' && payload.moves === payload.cubes) suspicion |= 4;
  if (undos > 5 * payload.moves) suspicion |= 8;

  return {
    ok: true,
    value: {
      name: payload.name,
      dirMode: payload.dirMode,
      goalMode: payload.goalMode,
      size: { x: size.x, y: size.y, z: size.z },
      sizeKey,
      capacity: kap,
      cubes: payload.cubes,
      moves: payload.moves,
      undos,
      timeMs: payload.timeMs,
      seed,
      levelCode: payload.levelCode,
      ruleVersion: payload.ruleVersion,
      genVersion: payload.genVersion,
      taps,
      runId: payload.runId,
      clientId,
      appVersion,
      suspicion
    }
  };
}
