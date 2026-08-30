// Pfeilspiel — Regelkern (SPEC §2, §3, §4.1, §5).
// Reines ES-Modul: kein three, kein DOM, kein window/document, kein Date/performance,
// kein Math.random. Laeuft unveraendert in node --test und im Cloudflare-Worker.
// Hier steht die EINZIGE Implementierung von resolveMove (SPEC §0.1).

// --- Konstanten ---------------------------------------------------------

export const OUT = -1;        // "ausserhalb" in board.step
export const EMPTY = -1;      // "unbesetzt" in state.occ
export const CELL = 1.0;      // Rasterabstand
export const CUBE_EDGE = 0.92;
export const MAX_CUBES = 1200;
export const RULE_VERSION = 1;

/** Raumrichtungen des Modus VOLUMEN in der Reihenfolge PX,NX,PY,NY,PZ,NZ (SPEC §2.2). */
export const DIR6 = Object.freeze([
  Object.freeze([1, 0, 0]),
  Object.freeze([-1, 0, 0]),
  Object.freeze([0, 1, 0]),
  Object.freeze([0, -1, 0]),
  Object.freeze([0, 0, 1]),
  Object.freeze([0, 0, -1])
]);

export const DIR6_NAMES = Object.freeze(['PX', 'NX', 'PY', 'NY', 'PZ', 'NZ']);
export const FDIR4_NAMES = Object.freeze(['RECHTS', 'HOCH', 'LINKS', 'RUNTER']);

/** Flaechenlokale Schritte (du,dv) zu FDIR4_NAMES (SPEC §2.3). */
const FDIR4 = Object.freeze([
  Object.freeze([1, 0]),
  Object.freeze([0, 1]),
  Object.freeze([-1, 0]),
  Object.freeze([0, -1])
]);

/** Die fuenf Wandflaechen des Modus FASSADE (SPEC §2.3); es gilt U x V = N. */
export const FACES = Object.freeze([
  Object.freeze({ id: 'SUED', U: Object.freeze([-1, 0, 0]), V: Object.freeze([0, 1, 0]), N: Object.freeze([0, 0, -1]) }),
  Object.freeze({ id: 'OST', U: Object.freeze([0, 0, -1]), V: Object.freeze([0, 1, 0]), N: Object.freeze([1, 0, 0]) }),
  Object.freeze({ id: 'NORD', U: Object.freeze([1, 0, 0]), V: Object.freeze([0, 1, 0]), N: Object.freeze([0, 0, 1]) }),
  Object.freeze({ id: 'WEST', U: Object.freeze([0, 0, 1]), V: Object.freeze([0, 1, 0]), N: Object.freeze([-1, 0, 0]) }),
  Object.freeze({ id: 'DECKEL', U: Object.freeze([1, 0, 0]), V: Object.freeze([0, 0, -1]), N: Object.freeze([0, 1, 0]) })
]);

const OPP_VOLUMEN = Object.freeze([1, 0, 3, 2, 5, 4]);
// In FASSADE sind d=4,5 ungueltig; ihre Eintraege zeigen der Sicherheit halber
// auf sich selbst zurueck, damit ein versehentlicher Zugriff in step[] auf OUT laeuft.
const OPP_FASSADE = Object.freeze([2, 3, 0, 1, 5, 4]);

/** Tiefe einer in dieser Zelle ungueltigen Richtung — kann nie das Minimum werden. */
const DEPTH_NONE = 0x7fffffff;

// --- Board --------------------------------------------------------------

/**
 * @typedef {Object} Board
 * @property {'FASSADE'|'VOLUMEN'} mode
 * @property {number} W @property {number} H @property {number} D
 * @property {number} C
 * @property {Int32Array} step        [C*6] Nachbarindex oder OUT
 * @property {Uint8Array} valid       [C*6]
 * @property {Int8Array} opp          [6]
 * @property {number} dirCount        4 (FASSADE) | 6 (VOLUMEN)
 * @property {Float32Array} worldPos  [C*3]
 * @property {Float32Array} dirWorld  [C*6*3]
 * @property {Uint8Array} faceOf      [C]
 * @property {Float32Array} outNormal [C*3]
 * @property {Int32Array} lattice     [C*3]
 * @property {Int32Array} depthOf     [C*6]
 * @property {Int32Array} minDepthOf  [C]
 * @property {Int32Array|null} faceOff  [6] FASSADE-Flaechenoffsets, sonst null
 * @property {Int32Array|null} faceUMax [5]
 * @property {Int32Array|null} faceVMax [5]
 */

/** Gitterkoordinaten einer FASSADE-Zelle (SPEC §2.3). */
function fassadeLattice(f, u, v, W, H, D) {
  switch (f) {
    case 0: return [W - 1 - u, v, 0];
    case 1: return [W - 1, v, D - 2 - u];
    case 2: return [u, v, D - 1];
    case 3: return [0, v, 1 + u];
    default: return [u, H - 1, D - 1 - v];
  }
}

/**
 * Baut das unveraenderliche Brett samt vorberechneter Schritttabelle.
 * @param {{mode:'FASSADE'|'VOLUMEN', W:number, H:number, D:number}} spec
 * @returns {Board}
 */
export function buildBoard(spec) {
  const mode = spec && spec.mode;
  if (mode !== 'FASSADE' && mode !== 'VOLUMEN') throw new RangeError('Modus: FASSADE oder VOLUMEN');
  const W = spec.W, H = spec.H, D = spec.D;
  if (!Number.isInteger(W) || !Number.isInteger(H) || !Number.isInteger(D))
    throw new RangeError('Dimensionen muessen ganzzahlig sein');
  if (!(W >= 3 && D >= 3 && H >= 2)) throw new RangeError('Dimensionen: W>=3, D>=3, H>=2');
  if (!(W <= 16 && H <= 24 && D <= 16)) throw new RangeError('Dimensionen zu gross');

  const C = mode === 'VOLUMEN'
    ? W * H * D
    : 2 * W * (H - 1) + 2 * (D - 2) * (H - 1) + W * D;
  if (C > MAX_CUBES) throw new RangeError('Zellzahl ueber MAX_CUBES');

  const step = new Int32Array(C * 6).fill(OUT);
  const valid = new Uint8Array(C * 6);
  const worldPos = new Float32Array(C * 3);
  const dirWorld = new Float32Array(C * 6 * 3);
  const faceOf = new Uint8Array(C);
  const outNormal = new Float32Array(C * 3);
  const lattice = new Int32Array(C * 3);
  const depth = new Int32Array(C * 6).fill(DEPTH_NONE);
  const minDepth = new Int32Array(C);

  let faceOff = null, faceUMax = null, faceVMax = null;

  if (mode === 'VOLUMEN') {
    const idx = (x, y, z) => (x * H + y) * D + z;
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < D; z++) {
          const i = idx(x, y, z);
          lattice[i * 3] = x; lattice[i * 3 + 1] = y; lattice[i * 3 + 2] = z;
          faceOf[i] = 255;
          let md = DEPTH_NONE;
          for (let d = 0; d < 6; d++) {
            const dv = DIR6[d];
            const nx = x + dv[0], ny = y + dv[1], nz = z + dv[2];
            const drin = nx >= 0 && nx < W && ny >= 0 && ny < H && nz >= 0 && nz < D;
            step[i * 6 + d] = drin ? idx(nx, ny, nz) : OUT;
            valid[i * 6 + d] = 1;
            dirWorld[(i * 6 + d) * 3] = dv[0];
            dirWorld[(i * 6 + d) * 3 + 1] = dv[1];
            dirWorld[(i * 6 + d) * 3 + 2] = dv[2];
          }
          depth[i * 6 + 0] = W - 1 - x; depth[i * 6 + 1] = x;
          depth[i * 6 + 2] = H - 1 - y; depth[i * 6 + 3] = y;
          depth[i * 6 + 4] = D - 1 - z; depth[i * 6 + 5] = z;
          for (let d = 0; d < 6; d++) if (depth[i * 6 + d] < md) md = depth[i * 6 + d];
          minDepth[i] = md;
        }
      }
    }
  } else {
    faceUMax = Int32Array.of(W, D - 2, W, D - 2, W);
    faceVMax = Int32Array.of(H - 1, H - 1, H - 1, H - 1, D);
    faceOff = new Int32Array(6);
    for (let f = 0; f < 5; f++) faceOff[f + 1] = faceOff[f] + faceUMax[f] * faceVMax[f];

    for (let f = 0; f < 5; f++) {
      const uM = faceUMax[f], vM = faceVMax[f];
      const U = FACES[f].U, V = FACES[f].V, N = FACES[f].N;
      for (let v = 0; v < vM; v++) {
        for (let u = 0; u < uM; u++) {
          const i = faceOff[f] + v * uM + u;
          const xyz = fassadeLattice(f, u, v, W, H, D);
          lattice[i * 3] = xyz[0]; lattice[i * 3 + 1] = xyz[1]; lattice[i * 3 + 2] = xyz[2];
          faceOf[i] = f;
          outNormal[i * 3] = N[0]; outNormal[i * 3 + 1] = N[1]; outNormal[i * 3 + 2] = N[2];
          for (let d = 0; d < 4; d++) {
            const du = FDIR4[d][0], dv = FDIR4[d][1];
            const nu = u + du, nv = v + dv;
            const drin = nu >= 0 && nu < uM && nv >= 0 && nv < vM;
            step[i * 6 + d] = drin ? (faceOff[f] + nv * uM + nu) : OUT;
            valid[i * 6 + d] = 1;
            for (let k = 0; k < 3; k++) dirWorld[(i * 6 + d) * 3 + k] = du * U[k] + dv * V[k];
          }
          depth[i * 6 + 0] = uM - 1 - u; depth[i * 6 + 1] = vM - 1 - v;
          depth[i * 6 + 2] = u; depth[i * 6 + 3] = v;
          let md = DEPTH_NONE;
          for (let d = 0; d < 4; d++) if (depth[i * 6 + d] < md) md = depth[i * 6 + d];
          minDepth[i] = md;
        }
      }
    }
  }

  for (let i = 0; i < C; i++) {
    worldPos[i * 3] = (lattice[i * 3] - (W - 1) / 2) * CELL;
    worldPos[i * 3 + 1] = (lattice[i * 3 + 1] - (H - 1) / 2) * CELL;
    worldPos[i * 3 + 2] = (lattice[i * 3 + 2] - (D - 1) / 2) * CELL;
  }

  return {
    mode, W, H, D, C,
    step, valid,
    opp: Int8Array.from(mode === 'VOLUMEN' ? OPP_VOLUMEN : OPP_FASSADE),
    dirCount: mode === 'VOLUMEN' ? 6 : 4,
    worldPos, dirWorld, faceOf, outNormal, lattice,
    depthOf: depth, minDepthOf: minDepth,
    faceOff, faceUMax, faceVMax
  };
}

function pruefeZelle(board, i) {
  if (!Number.isInteger(i) || i < 0 || i >= board.C) throw new RangeError('Zellindex ausserhalb: ' + i);
}

/** FASSADE: `F${f}:${u}:${v}`, VOLUMEN: `V:${x}:${y}:${z}`. */
export function cellKey(board, i) {
  pruefeZelle(board, i);
  if (board.mode === 'VOLUMEN')
    return 'V:' + board.lattice[i * 3] + ':' + board.lattice[i * 3 + 1] + ':' + board.lattice[i * 3 + 2];
  const f = board.faceOf[i];
  const r = i - board.faceOff[f];
  const uM = board.faceUMax[f];
  return 'F' + f + ':' + (r % uM) + ':' + ((r / uM) | 0);
}

const KEY_FASSADE = /^F([0-4]):(\d{1,3}):(\d{1,3})$/;
const KEY_VOLUMEN = /^V:(\d{1,3}):(\d{1,3}):(\d{1,3})$/;

/** Umkehrung von cellKey; -1 wenn der Schluessel auf diesem Brett nicht existiert. */
export function cellIndexOf(board, key) {
  if (typeof key !== 'string') return -1;
  if (board.mode === 'VOLUMEN') {
    const m = KEY_VOLUMEN.exec(key);
    if (!m) return -1;
    const x = +m[1], y = +m[2], z = +m[3];
    if (x >= board.W || y >= board.H || z >= board.D) return -1;
    return (x * board.H + y) * board.D + z;
  }
  const m = KEY_FASSADE.exec(key);
  if (!m) return -1;
  const f = +m[1], u = +m[2], v = +m[3];
  if (u >= board.faceUMax[f] || v >= board.faceVMax[f]) return -1;
  return board.faceOff[f] + v * board.faceUMax[f] + u;
}

/** @returns {[number,number,number]} */
export function latticeOf(board, i) {
  pruefeZelle(board, i);
  return [board.lattice[i * 3], board.lattice[i * 3 + 1], board.lattice[i * 3 + 2]];
}

export function worldPosOf(board, i, out) {
  pruefeZelle(board, i);
  const o = out || [0, 0, 0];
  o[0] = board.worldPos[i * 3]; o[1] = board.worldPos[i * 3 + 1]; o[2] = board.worldPos[i * 3 + 2];
  return o;
}

export function dirWorldOf(board, i, d, out) {
  pruefeZelle(board, i);
  const o = out || [0, 0, 0];
  const b = (i * 6 + d) * 3;
  o[0] = board.dirWorld[b]; o[1] = board.dirWorld[b + 1]; o[2] = board.dirWorld[b + 2];
  return o;
}

export function outNormalOf(board, i, out) {
  pruefeZelle(board, i);
  const o = out || [0, 0, 0];
  o[0] = board.outNormal[i * 3]; o[1] = board.outNormal[i * 3 + 1]; o[2] = board.outNormal[i * 3 + 2];
  return o;
}

/** Gueltige Richtungen dieser Zelle, aufsteigend. */
export function validDirs(board, i) {
  pruefeZelle(board, i);
  const res = [];
  for (let d = 0; d < 6; d++) if (board.valid[i * 6 + d]) res.push(d);
  return res;
}

/** Austrittstiefe: Zahl der Schritte in Richtung d bis zum Verlassen des Gitters minus eins. */
export function depthOf(board, i, d) {
  pruefeZelle(board, i);
  return board.depthOf[i * 6 + d];
}

export function minDepthOf(board, i) {
  pruefeZelle(board, i);
  return board.minDepthOf[i];
}

/** Alle Richtungen mit kuerzestem Austritt, aufsteigend (Grundlage des Fuellsatzes §6.5). */
export function bestExitDirs(board, i) {
  pruefeZelle(board, i);
  const md = board.minDepthOf[i];
  const res = [];
  for (let d = 0; d < 6; d++) if (board.valid[i * 6 + d] && board.depthOf[i * 6 + d] === md) res.push(d);
  return res;
}

// --- Zustand ------------------------------------------------------------

/**
 * @typedef {Object} State
 * @property {Int32Array} occ @property {Int32Array} cellOf
 * @property {Uint8Array} dirOf @property {Uint8Array} alive
 * @property {number} cubeCount @property {number} aliveCount
 * @property {number} targetId @property {'ABBAU'|'BEFREIUNG'} goal
 */

function pruefeZiel(goal) {
  if (goal !== 'ABBAU' && goal !== 'BEFREIUNG') throw new RangeError('Zielmodus: ABBAU oder BEFREIUNG');
}

export function emptyState(board, capacity, goal) {
  pruefeZiel(goal);
  const cap = Math.max(0, capacity | 0);
  return {
    occ: new Int32Array(board.C).fill(EMPTY),
    cellOf: new Int32Array(cap).fill(-1),
    dirOf: new Uint8Array(cap),
    alive: new Uint8Array(cap),
    cubeCount: 0,
    aliveCount: 0,
    targetId: -1,
    goal
  };
}

/**
 * Startzustand aus der serialisierten Wuerfelliste; Arrayindex === cubeId.
 * Bewusst nachsichtig: unbrauchbare Eintraege erzeugen einen bereits ausgeschiedenen Wuerfel,
 * doppelt belegte Zellen verdecken einander (der spaetere Eintrag gewinnt die Zelle). So kann
 * verifyLevel verfaelschte Level ablehnen, statt an einer Ausnahme abzubrechen (SPEC §6.8).
 * Unbrauchbar ist ein Eintrag, dessen Zelle ausserhalb liegt ODER dessen Richtung in genau
 * dieser Zelle nicht erlaubt ist (`board.valid`). Letzteres ist in FASSADE der Fall fuer d=4
 * und d=5 (SPEC §2.3): ohne diese Pruefung wuerde ein auf 4 gedrehter Pfeil bei jedem Tipp
 * sofort EXIT liefern und ein so verfaelschtes Level trivial loesbar machen.
 */
export function createState(board, cubes, goal) {
  const n = cubes.length;
  const state = emptyState(board, n, goal);
  for (let id = 0; id < n; id++) {
    const c = cubes[id];
    state.cubeCount = id + 1;
    const cell = c ? c.cell : -1;
    const dir = c ? c.dir : -1;
    const brauchbar = Number.isInteger(cell) && cell >= 0 && cell < board.C
      && Number.isInteger(dir) && dir >= 0 && dir <= 5
      && board.valid[cell * 6 + dir] === 1;
    if (!brauchbar) continue;
    state.dirOf[id] = dir;
    state.cellOf[id] = cell;
    state.alive[id] = 1;
    state.aliveCount++;
    state.occ[cell] = id;
    if (c.target) state.targetId = id;
  }
  return state;
}

export function cloneState(state) {
  return {
    occ: state.occ.slice(),
    cellOf: state.cellOf.slice(),
    dirOf: state.dirOf.slice(),
    alive: state.alive.slice(),
    cubeCount: state.cubeCount,
    aliveCount: state.aliveCount,
    targetId: state.targetId,
    goal: state.goal
  };
}

function wachse(state, mindestens) {
  let cap = Math.max(8, state.alive.length);
  while (cap < mindestens) cap *= 2;
  const cellOf = new Int32Array(cap).fill(-1);
  const dirOf = new Uint8Array(cap);
  const alive = new Uint8Array(cap);
  cellOf.set(state.cellOf); dirOf.set(state.dirOf); alive.set(state.alive);
  state.cellOf = cellOf; state.dirOf = dirOf; state.alive = alive;
}

/** Setzt einen neuen Wuerfel auf eine freie Zelle; liefert die Wuerfel-Id. */
export function addCube(state, cell, dir, isTarget = false) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.occ.length)
    throw new RangeError('addCube: Zellindex ausserhalb');
  if (state.occ[cell] !== EMPTY) throw new RangeError('addCube: Zelle bereits belegt');
  if (!Number.isInteger(dir) || dir < 0 || dir > 5) throw new RangeError('addCube: Richtung ungueltig');
  const id = state.cubeCount;
  if (id >= state.alive.length) wachse(state, id + 1);
  state.occ[cell] = id;
  state.cellOf[id] = cell;
  state.dirOf[id] = dir;
  state.alive[id] = 1;
  state.cubeCount = id + 1;
  state.aliveCount++;
  if (isTarget) state.targetId = id;
  return id;
}

/**
 * Entfernt einen Wuerfel vollstaendig. War es der zuletzt erzeugte, wird seine Id wieder frei
 * (LIFO) — genau das braucht der Rueckwaertsbau beim Verwerfen eines Kandidaten (SPEC §6.3).
 */
export function dropCube(state, cubeId) {
  if (!Number.isInteger(cubeId) || cubeId < 0 || cubeId >= state.cubeCount)
    throw new RangeError('dropCube: unbekannte Wuerfel-Id');
  if (state.alive[cubeId]) {
    const c = state.cellOf[cubeId];
    if (c >= 0 && state.occ[c] === cubeId) state.occ[c] = EMPTY;
    state.aliveCount--;
  }
  state.alive[cubeId] = 0;
  state.cellOf[cubeId] = -1;
  state.dirOf[cubeId] = 0;
  if (state.targetId === cubeId) state.targetId = -1;
  if (cubeId === state.cubeCount - 1) state.cubeCount--;
}

export function isFree(state, cell) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.occ.length)
    throw new RangeError('isFree: Zellindex ausserhalb');
  return state.occ[cell] === EMPTY;
}

// --- Regel (die EINZIGE Implementierung, SPEC §5) ------------------------

/**
 * @typedef {Object} Move
 * @property {'STEP'|'JUMP'|'EXIT'|'INVALID'} kind
 * @property {'BLOCKED'|'DEAD'|undefined} reason
 * @property {number} cubeId @property {number} from @property {number} to
 * @property {number} jumps @property {number[]} path @property {number[]} jumped
 */

/**
 * Loest den Zug fuer die angetippte Zelle auf. Seiteneffektfrei; liest nur
 * board.step, state.occ, state.dirOf, state.alive.
 * @returns {Move}
 */
export function resolveMove(board, state, cell) {
  if (!Number.isInteger(cell) || cell < 0 || cell >= board.C)   // RF-9, entartete Eingabe
    return {
      kind: 'INVALID', reason: 'DEAD', cubeId: EMPTY, from: cell, to: OUT,
      jumps: 0, path: [cell], jumped: []
    };

  const id = state.occ[cell];
  if (id === EMPTY || !state.alive[id])        // RF-9
    return {
      kind: 'INVALID', reason: 'DEAD', cubeId: id, from: cell, to: OUT,
      jumps: 0, path: [cell], jumped: []
    };

  const d = state.dirOf[id];
  const st = board.step;

  // --- Phase 1: erster Zug ---------------------------------------------
  const n1 = st[cell * 6 + d];
  if (n1 === OUT)                              // RF-1: Grenze vor Belegung
    return { kind: 'EXIT', cubeId: id, from: cell, to: OUT, jumps: 0, path: [cell], jumped: [] };
  if (state.occ[n1] === EMPTY)                 // RF-2, Regel R1
    return { kind: 'STEP', cubeId: id, from: cell, to: n1, jumps: 0, path: [cell, n1], jumped: [] };

  const n2 = st[n1 * 6 + d];
  if (n2 === OUT)                              // RF-3: Sprung ueber den Rand hinaus
    return { kind: 'EXIT', cubeId: id, from: cell, to: OUT, jumps: 1, path: [cell], jumped: [n1] };
  if (state.occ[n2] !== EMPTY)                 // RF-4, Regel R4
    return {
      kind: 'INVALID', reason: 'BLOCKED', cubeId: id, from: cell, to: OUT,
      jumps: 0, path: [cell], jumped: [n1]
    };

  // Regel R2: erster Sprung ist vollzogen
  let cur = n2, jumps = 1;
  const path = [cell, n2], jumped = [n1];

  // --- Phase 2: Kette, NUR weitere Spruenge (Regel R3) ------------------
  for (;;) {
    const over = st[cur * 6 + d];
    if (over === OUT) break;                          // RF-5
    if (state.occ[over] === EMPTY) break;             // RF-6: kein Schritt hinter dem Sprung
    const land = st[over * 6 + d];
    if (land === OUT) {                               // RF-7
      jumped.push(over);
      return { kind: 'EXIT', cubeId: id, from: cell, to: OUT, jumps: jumps + 1, path, jumped };
    }
    if (state.occ[land] !== EMPTY) break;             // RF-8
    cur = land; jumps++; path.push(land); jumped.push(over);
  }
  return { kind: 'JUMP', cubeId: id, from: cell, to: cur, jumps, path, jumped };
}

/** Ein Zug veraendert genau einen Wuerfel (RF-12). */
export function applyMove(state, move) {
  if (move.kind === 'INVALID') return;
  const id = move.cubeId;
  state.occ[move.from] = EMPTY;
  if (move.to === OUT) {
    state.alive[id] = 0; state.cellOf[id] = -1; state.aliveCount--;
  } else {
    state.occ[move.to] = id; state.cellOf[id] = move.to;
  }
}

/** Exakt invers zu applyMove. */
export function revertMove(state, move) {
  if (move.kind === 'INVALID') return;
  const id = move.cubeId;
  if (move.to === OUT) { state.alive[id] = 1; state.aliveCount++; }
  else { state.occ[move.to] = EMPTY; }
  state.occ[move.from] = id;
  state.cellOf[id] = move.from;
}

/** Alle antippbaren Zellen mit gueltigem Zug, aufsteigend sortiert. */
export function legalCells(board, state) {
  const out = [];
  for (let c = 0; c < board.C; c++)
    if (state.occ[c] !== EMPTY && resolveMove(board, state, c).kind !== 'INVALID') out.push(c);
  return out;
}

export function mobility(board, state) {
  if (state.aliveCount === 0) return 0;
  return legalCells(board, state).length / state.aliveCount;
}

export function hasAnyMove(board, state) {
  for (let c = 0; c < board.C; c++)
    if (state.occ[c] !== EMPTY && resolveMove(board, state, c).kind !== 'INVALID') return true;
  return false;
}

export function isSolved(state) {
  if (state.goal === 'ABBAU') return state.aliveCount === 0;
  if (state.targetId < 0 || state.targetId >= state.cubeCount) return false;
  return state.alive[state.targetId] === 0;
}

// --- Sitzung (Zugzaehler, Undo, Uhr) ------------------------------------

/**
 * @typedef {Object} UndoEntry
 * @property {Move} move @property {number} moveNo @property {number} clockMs
 * @property {number} tapNo  Laenge von session.taps VOR dem Tipp; nur so laesst sich die
 *                           Tippliste beim Undo wieder auf den damaligen Stand kuerzen.
 */

/**
 * @typedef {Object} Session
 * @property {Board} board @property {Object} level @property {State} state
 * @property {UndoEntry[]} history
 * @property {number} moves @property {number} undos @property {number} clockMs
 * @property {number[]} taps @property {boolean} won
 */

export function createSession(board, level) {
  const state = createState(board, level.cubes, level.goal);
  return {
    board, level, state,
    history: [],
    moves: 0,
    undos: 0,
    clockMs: 0,
    taps: [],
    won: isSolved(state)
  };
}

/**
 * Zugbuchhaltung. Bei kind !== 'INVALID' wird der Zustand synchron fortgeschrieben;
 * Zugzaehler und Uhr stehen am logischen Commit, nie am Animationsende (SPEC §5.3).
 */
export function tap(session, cell) {
  const tapNo = session.taps.length;
  session.taps.push(cell);
  const m = resolveMove(session.board, session.state, cell);
  if (m.kind === 'INVALID') return m;
  session.history.push({ move: m, moveNo: session.moves, clockMs: session.clockMs, tapNo });
  applyMove(session.state, m);
  session.moves += 1;
  session.won = isSolved(session.state);
  return m;
}

/**
 * Nimmt den letzten gueltigen Zug zurueck (SPEC §3.4) und kuerzt dabei die Tippliste auf den
 * Stand vor diesem Zug.
 *
 * Die Kuerzung geht ueber den Wortlaut von §3.4/§5.3 hinaus und loest einen Widerspruch der
 * Spezifikation: §1.5 fuehrt Undo als legitimes, separat gezaehltes Merkmal, §9.4 verlangt fuer
 * `verified = 1` aber `replayTaps(level, taps).moves === moves`. Bliebe der zurueckgenommene
 * Tipp stehen, waere jeder Lauf mit Undo grundsaetzlich unverifizierbar, denn das Replay
 * spielte einen Zug mit, den es nicht mehr gibt, und alle spaeteren Tipps traefen einen anderen
 * Zustand. Verworfen werden genau der Tipp des zurueckgenommenen Zuges und die danach
 * gefolgten Tipps — das sind ausschliesslich ungueltige, denn jeder gueltige haette einen
 * spaeteren Eintrag in `history` und muesste zuerst zurueckgenommen werden. Damit gilt die
 * Invariante: `session.taps` ist stets eine Tippfolge, die vom Startzustand aus genau
 * `session.moves` gueltige Zuege ergibt und zu `session.state` fuehrt.
 */
export function undo(session) {
  if (session.history.length === 0) return false;
  const entry = session.history.pop();
  revertMove(session.state, entry.move);
  session.moves = entry.moveNo;
  session.clockMs = entry.clockMs;
  if (Number.isInteger(entry.tapNo) && entry.tapNo >= 0 && entry.tapNo < session.taps.length)
    session.taps.length = entry.tapNo;
  session.undos += 1;
  session.won = isSolved(session.state);
  return true;
}

/** Neustart derselben Aufstellung; undos bleibt erhalten, taps beginnt neu. */
export function restart(session) {
  session.state = createState(session.board, session.level.cubes, session.level.goal);
  session.history.length = 0;
  session.moves = 0;
  session.clockMs = 0;
  session.taps.length = 0;
  session.won = isSolved(session.state);
}

/** Die Uhr laeuft erst ab dem ersten gueltigen Zug. */
export function tickClock(session, dtMs) {
  if (!(dtMs > 0)) return;
  if (session.moves === 0) return;
  session.clockMs += dtMs;
}

export function toRunLog(session, meta) {
  const b = session.board, l = session.level;
  return {
    runId: meta.runId,
    clientId: meta.clientId,
    levelCode: l.levelCode,
    seed: l.seed,
    genVersion: l.genVersion,
    ruleVersion: l.ruleVersion,
    dirMode: b.mode === 'VOLUMEN' ? 'volumen' : 'fassade',
    goalMode: session.state.goal === 'BEFREIUNG' ? 'befreiung' : 'abbau',
    size: { x: b.W, y: b.H, z: b.D },
    cubes: l.cubes.length,
    moves: session.moves,
    undos: session.undos,
    timeMs: Math.round(session.clockMs),
    taps: session.taps.slice(),
    name: meta.name,
    appVersion: meta.appVersion
  };
}
