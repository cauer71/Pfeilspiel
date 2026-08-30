// Bestenlisten-Client. Spricht ausschliesslich /api/records und /api/health an.
// Regel dieses Moduls: es wirft nie. Jeder Fehler - Netz, Zeitueberschreitung,
// unlesbare Antwort, HTTP-Fehlercode - verlaesst das Modul als
// {ok:false, error, message} mit deutschem, direkt anzeigbarem Klartext.
// Kein Import aus game.js, kein three, kein DOM ausser localStorage/navigator.

/**
 * @typedef {Object} ScoreRow
 * @property {number} rank
 * @property {number} id
 * @property {string} name
 * @property {string} dirMode
 * @property {string} goalMode
 * @property {{x:number,y:number,z:number}} size
 * @property {string} sizeKey
 * @property {number} cubes
 * @property {number} moves
 * @property {number} undos
 * @property {number} timeMs
 * @property {boolean} [verified]
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ApiError
 * @property {false} ok
 * @property {string} error            maschinenlesbarer Code, siehe FEHLERTEXTE
 * @property {string} [field]          nur bei error === 'validation'
 * @property {string} message          deutscher Klartext fuer die Oberflaeche
 * @property {number} [retryAfterSec]  nur bei error === 'rate_limited'
 */

// --- Konstanten ------------------------------------------------------------

/** Basispfad der API. public/ ist die Wurzel der Website, daher absolut. */
const API_BASE = '/api';

/** Zeitlimit je Anfrage in Millisekunden. */
const TIMEOUT_GET_MS = 8000;
const TIMEOUT_POST_MS = 12000;

/** Serverseitige Obergrenze des POST-Bodys (§9.3). */
const MAX_BODY_BYTES = 8192;

/** Schluessel der Clientkennung im localStorage. */
const CLIENT_ID_KEY = 'pfeilspiel.clientId';

/** Reihenfolge der GET-Parameter: fest, damit der Cache-Key stabil bleibt (§9.7). */
const QUERY_ORDER = ['dir', 'goal', 'size', 'limit', 'offset', 'bestPerName'];

/** Erlaubte Felder eines RunLog im POST-Body (Allowlist, §9.4). */
const RUN_FIELDS = [
  'name', 'dirMode', 'goalMode', 'size', 'cubes', 'moves', 'undos', 'timeMs',
  'seed', 'levelCode', 'ruleVersion', 'genVersion', 'taps', 'runId',
  'clientId', 'appVersion'
];

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Deutsche Ersatztexte je Fehlercode. Der Server liefert bereits eine
 * UI-taugliche deutsche `message`; diese Tabelle greift nur, wenn keine kommt.
 */
const FEHLERTEXTE = {
  bad_json: 'Der Server konnte die Anfrage nicht lesen.',
  validation: 'Die uebermittelten Angaben sind unvollstaendig oder ungueltig.',
  implausible: 'Der Lauf wurde als spielerisch unmoeglich zurueckgewiesen.',
  name_rejected: 'Dieser Name ist nicht zulaessig. Bitte waehle einen anderen.',
  version_mismatch: 'Diese Spielversion passt nicht mehr zum Server. Bitte lade die Seite neu.',
  method_not_allowed: 'Diese Anfrage ist auf dem Server nicht erlaubt.',
  payload_too_large: 'Der Lauf ist zu gross zum Uebertragen.',
  rate_limited: 'Zu viele Einsendungen in kurzer Zeit. Bitte kurz warten.',
  server_error: 'Der Server hat einen Fehler gemeldet. Bitte spaeter erneut versuchen.',
  not_found: 'Die Bestenliste ist auf diesem Server nicht erreichbar.',
  offline: 'Keine Internetverbindung. Die Bestenliste ist gerade nicht erreichbar.',
  network: 'Keine Verbindung zum Server. Bitte pruefe deine Internetverbindung.',
  timeout: 'Der Server hat nicht rechtzeitig geantwortet.',
  aborted: 'Die Anfrage wurde abgebrochen.',
  bad_response: 'Der Server hat eine unlesbare Antwort geschickt.',
  unsupported: 'Dieser Browser kann die Bestenliste nicht laden.'
};

/** Ordnet einen HTTP-Status einem Fehlercode zu, wenn der Body keinen nennt. */
const STATUS_FEHLER = {
  400: 'validation',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  429: 'rate_limited'
};

// --- kleine Helfer ---------------------------------------------------------

/**
 * Baut eine Fehlerhuelle mit garantiert gefuelltem deutschen Text.
 * @param {string} error
 * @param {string} [message]
 * @param {{field?:string, retryAfterSec?:number}} [extra]
 * @returns {ApiError}
 */
function fehler(error, message, extra) {
  const code = typeof error === 'string' && error ? error : 'server_error';
  const text = (typeof message === 'string' && message.trim())
    ? message.trim()
    : (FEHLERTEXTE[code] || FEHLERTEXTE.server_error);
  /** @type {ApiError} */
  const out = { ok: false, error: code, message: text };
  if (extra && typeof extra.field === 'string' && extra.field) out.field = extra.field;
  if (extra && Number.isFinite(extra.retryAfterSec)) {
    out.retryAfterSec = Math.max(0, Math.round(extra.retryAfterSec));
  }
  return out;
}

/** true, wenn der Browser sich sicher als offline meldet. */
function istOffline() {
  try {
    return typeof navigator === 'object' && navigator !== null && navigator.onLine === false;
  } catch (_e) {
    return false;
  }
}

/** Laenge eines Strings in Bytes (UTF-8), mit Rueckfall ohne TextEncoder. */
function byteLaenge(text) {
  try {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  } catch (_e) { /* faellt unten durch */ }
  // Grobe, stets nicht zu kleine Schaetzung.
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return n;
}

/** Liest `Retry-After` (Sekunden) aus den Kopfzeilen, sonst null. */
function retryAfterAusHeader(res) {
  try {
    const raw = res.headers && typeof res.headers.get === 'function'
      ? res.headers.get('Retry-After') : null;
    if (raw === null || raw === undefined) return null;
    const sec = Number.parseInt(String(raw).trim(), 10);
    return Number.isFinite(sec) && sec >= 0 ? sec : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Fuehrt eine Anfrage mit Zeitlimit aus und wertet die Antwort aus.
 * Wirft nie; liefert entweder {ok:true, status, data} oder eine Fehlerhuelle.
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @returns {Promise<{ok:true, status:number, data:any} | ApiError>}
 */
async function anfrage(url, init, timeoutMs) {
  if (typeof fetch !== 'function') return fehler('unsupported');
  if (istOffline()) return fehler('offline');

  let ctrl = null;
  let timer = null;
  let abgelaufen = false;
  try {
    if (typeof AbortController === 'function') ctrl = new AbortController();
  } catch (_e) {
    ctrl = null;
  }

  const opts = Object.assign({ credentials: 'omit', redirect: 'follow' }, init);
  if (ctrl) opts.signal = ctrl.signal;

  let res;
  try {
    if (ctrl) {
      timer = setTimeout(() => { abgelaufen = true; try { ctrl.abort(); } catch (_e) { /* egal */ } },
        timeoutMs);
    }
    res = await fetch(url, opts);
  } catch (err) {
    if (abgelaufen) return fehler('timeout');
    const name = err && err.name ? String(err.name) : '';
    if (name === 'AbortError') return fehler('aborted');
    if (istOffline()) return fehler('offline');
    return fehler('network');
  } finally {
    if (timer !== null) clearTimeout(timer);
  }

  let text = '';
  try {
    text = await res.text();
  } catch (err) {
    if (abgelaufen) return fehler('timeout');
    return fehler('network');
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_e) {
      data = null;
    }
  }
  const istObjekt = data !== null && typeof data === 'object' && !Array.isArray(data);

  if (!res.ok || (istObjekt && data.ok === false)) {
    const code = (istObjekt && typeof data.error === 'string' && data.error)
      ? data.error
      : (STATUS_FEHLER[res.status] || (res.status >= 500 ? 'server_error' : 'bad_response'));
    const kopfSek = retryAfterAusHeader(res);
    const bodySek = istObjekt && Number.isFinite(data.retryAfterSec) ? data.retryAfterSec : null;
    return fehler(code, istObjekt ? data.message : undefined, {
      field: istObjekt && typeof data.field === 'string' ? data.field : undefined,
      retryAfterSec: bodySek !== null ? bodySek : (kopfSek !== null ? kopfSek : undefined)
    });
  }

  if (!istObjekt) return fehler('bad_response');
  return { ok: true, status: res.status, data };
}

/**
 * Normalisiert die Groesse zu "WxHxD". Nimmt String oder {x,y,z} entgegen.
 * @returns {string|null}
 */
function groesseAlsText(size) {
  if (typeof size === 'string') {
    const s = size.trim();
    return s ? s : null;
  }
  if (size && typeof size === 'object'
      && Number.isFinite(size.x) && Number.isFinite(size.y) && Number.isFinite(size.z)) {
    return `${size.x}x${size.y}x${size.z}`;
  }
  return null;
}

/** Baut die Abfragezeichenkette in fester Reihenfolge (Cache-Key-Stabilitaet). */
function abfrageString(q) {
  const src = (q && typeof q === 'object') ? q : {};
  /** @type {Record<string,string>} */
  const werte = {};

  if (typeof src.dir === 'string' && src.dir.trim()) werte.dir = src.dir.trim().toLowerCase();
  if (typeof src.goal === 'string' && src.goal.trim()) werte.goal = src.goal.trim().toLowerCase();

  const size = groesseAlsText(src.size);
  if (size !== null) werte.size = size.toLowerCase();

  if (src.limit !== undefined && src.limit !== null && Number.isFinite(Number(src.limit))) {
    werte.limit = String(Math.trunc(Number(src.limit)));
  }
  if (src.offset !== undefined && src.offset !== null && Number.isFinite(Number(src.offset))) {
    werte.offset = String(Math.trunc(Number(src.offset)));
  }
  if (src.bestPerName === true || src.bestPerName === 1 || src.bestPerName === '1') {
    werte.bestPerName = '1';
  }

  const teile = [];
  for (let i = 0; i < QUERY_ORDER.length; i++) {
    const k = QUERY_ORDER[i];
    if (Object.prototype.hasOwnProperty.call(werte, k)) {
      teile.push(`${encodeURIComponent(k)}=${encodeURIComponent(werte[k])}`);
    }
  }
  return teile.length ? `?${teile.join('&')}` : '';
}

/** Uebernimmt nur die erlaubten Felder eines RunLog. */
function nutzlastAus(run) {
  const src = (run && typeof run === 'object') ? run : {};
  /** @type {Record<string, any>} */
  const body = {};
  for (let i = 0; i < RUN_FIELDS.length; i++) {
    const k = RUN_FIELDS[i];
    const v = src[k];
    if (v === undefined || v === null) continue;
    body[k] = v;
  }
  if (Array.isArray(body.taps)) {
    body.taps = body.taps.filter((t) => Number.isInteger(t) && t >= 0);
  }
  if (body.size && typeof body.size === 'object') {
    body.size = { x: body.size.x, y: body.size.y, z: body.size.z };
  }
  return body;
}

// --- oeffentliche API ------------------------------------------------------

/**
 * Holt eine Seite der Bestenliste.
 * @param {{dir?:string, goal?:string, size?:string|{x:number,y:number,z:number},
 *          limit?:number, offset?:number, bestPerName?:boolean}} [q]
 * @returns {Promise<{ok:true, total:number, records:ScoreRow[]} | ApiError>}
 */
export async function getScores(q) {
  const url = `${API_BASE}/records${abfrageString(q)}`;
  const res = await anfrage(url, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  }, TIMEOUT_GET_MS);

  if (res.ok !== true) return res;

  const data = res.data;
  if (!Array.isArray(data.records)) return fehler('bad_response');
  const total = Number.isFinite(data.total) ? data.total : data.records.length;
  return { ok: true, total, records: data.records };
}

/**
 * Sendet einen Lauf an die Bestenliste. `runId` macht den Aufruf idempotent:
 * ein wiederholter POST liefert denselben Datensatz mit duplicate === true.
 * @param {Object} run RunLog (§3.7)
 * @returns {Promise<{ok:true, id:number, rank:number, total:number,
 *                    duplicate:boolean, verified:boolean} | ApiError>}
 */
export async function postScore(run) {
  const body = nutzlastAus(run);

  let text;
  try {
    text = JSON.stringify(body);
  } catch (_e) {
    return fehler('validation', 'Der Lauf konnte nicht in JSON umgewandelt werden.');
  }

  // Der Server nimmt hoechstens 8192 Byte an. Die Tippfolge ist optional; ist der
  // Lauf zu gross, wird sie weggelassen. Der Eintrag zaehlt dann als unverifiziert,
  // statt gar nicht in der Bestenliste zu landen.
  if (byteLaenge(text) > MAX_BODY_BYTES && Array.isArray(body.taps)) {
    delete body.taps;
    try {
      text = JSON.stringify(body);
    } catch (_e) {
      return fehler('validation', 'Der Lauf konnte nicht in JSON umgewandelt werden.');
    }
  }
  if (byteLaenge(text) > MAX_BODY_BYTES) return fehler('payload_too_large');

  const res = await anfrage(`${API_BASE}/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: text
  }, TIMEOUT_POST_MS);

  if (res.ok !== true) return res;

  const data = res.data;
  if (!Number.isFinite(data.id) || !Number.isFinite(data.rank)) return fehler('bad_response');
  return {
    ok: true,
    id: data.id,
    rank: data.rank,
    total: Number.isFinite(data.total) ? data.total : 0,
    duplicate: data.duplicate === true,
    verified: data.verified === true
  };
}

/**
 * Erzeugt eine UUID v4. Bevorzugt crypto.randomUUID, sonst crypto.getRandomValues,
 * zuletzt ein Rueckfall ohne Krypto - die Kennung ist reiner Idempotenzschluessel,
 * kein Geheimnis, und darf unter keinen Umstaenden werfen.
 * @returns {string}
 */
export function newUuid() {
  try {
    if (typeof crypto === 'object' && crypto !== null && typeof crypto.randomUUID === 'function') {
      const id = crypto.randomUUID();
      if (UUID_RE.test(id)) return id;
    }
  } catch (_e) { /* naechste Stufe */ }

  const bytes = new Uint8Array(16);
  let gefuellt = false;
  try {
    if (typeof crypto === 'object' && crypto !== null
        && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
      gefuellt = true;
    }
  } catch (_e) {
    gefuellt = false;
  }
  if (!gefuellt) {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) & 0xff;
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;   // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;   // Variante 10xx

  const hex = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-`
       + `${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/** Zwischenspeicher, damit die Kennung auch ohne nutzbaren localStorage stabil bleibt. */
let clientIdCache = null;

/**
 * Dauerhafte Clientkennung aus dem localStorage. Im Privatmodus wirft der Zugriff;
 * dann gilt eine nur fuer diese Sitzung gueltige Kennung.
 * @returns {string}
 */
export function clientId() {
  if (clientIdCache !== null) return clientIdCache;

  let gespeichert = null;
  try {
    if (typeof localStorage === 'object' && localStorage !== null) {
      gespeichert = localStorage.getItem(CLIENT_ID_KEY);
    }
  } catch (_e) {
    gespeichert = null;
  }

  if (typeof gespeichert === 'string' && UUID_RE.test(gespeichert)) {
    clientIdCache = gespeichert.toLowerCase();
    return clientIdCache;
  }

  const id = newUuid();
  try {
    if (typeof localStorage === 'object' && localStorage !== null) {
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
  } catch (_e) { /* Privatmodus: Kennung bleibt sitzungslokal */ }

  clientIdCache = id;
  return clientIdCache;
}
