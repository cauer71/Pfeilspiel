// /api/records: Bestenliste lesen und schreiben (SPEC §9.3, §9.4, §9.7).
// Die Anti-Cheat-Pruefung benutzt replayTaps aus public/src/levels.js — dieselbe
// Regelimplementierung wie im Client, keine zweite Regellogik im Worker.

import { json, preflight } from './http.js';
import { parseQuery, validateSubmission, MAX_BODY_BYTES } from './validate.js';
import { normalizeName } from './names.js';
import { hashIp, hashText, checkRateLimit, gcRateLimit, GC_WAHRSCHEINLICHKEIT } from './ratelimit.js';
import { generateFromCode, replayTaps } from '../public/src/levels.js';

const CACHE_GET = 'public, max-age=10, s-maxage=30, stale-while-revalidate=60';

const SPALTEN = `id, name, dir_mode, goal_mode, size_x, size_y, size_z, size_key,
  cubes, moves, undos, time_ms, verified, created_at`;

// Feste Sortierung (nicht per Parameter umschaltbar). `verified DESC` setzt unverifizierte
// Eintraege hinter verifizierte gleicher Zugzahl (SPEC §9.4).
const SORTIERUNG = 'moves ASC, verified DESC, time_ms ASC, created_at ASC, id ASC';

/** Einheitliche Fehlerhuelle. */
function fehlerAntwort(e, request, env, extraHeaders) {
  const body = { ok: false, error: e.error, message: e.message };
  if (e.field) body.field = e.field;
  if (e.retryAfterSec !== undefined) body.retryAfterSec = e.retryAfterSec;
  return json(body, e.status || 400, request, env, extraHeaders);
}

function serverFehler(request, env, err, stelle) {
  console.error('api/records', stelle, err && (err.stack || err.message));
  return json({ ok: false, error: 'server_error', message: 'Die Bestenliste ist gerade nicht erreichbar. Bitte spaeter erneut versuchen.' },
    500, request, env);
}

/** Zeile aus D1 in eine ScoreRow der API umsetzen. */
function zeileZuRow(r, rank) {
  return {
    rank,
    id: Number(r.id),
    name: String(r.name),
    dirMode: String(r.dir_mode),
    goalMode: String(r.goal_mode),
    size: { x: Number(r.size_x), y: Number(r.size_y), z: Number(r.size_z) },
    sizeKey: String(r.size_key),
    cubes: Number(r.cubes),
    moves: Number(r.moves),
    undos: Number(r.undos),
    timeMs: Number(r.time_ms),
    verified: Number(r.verified) === 1,
    createdAt: new Date(Number(r.created_at)).toISOString()
  };
}

/** Filterbedingungen aus der geparsten Abfrage. */
function filter(q) {
  const wo = ["status = 'ok'"];
  const bind = [];
  if (q.dir) { wo.push('dir_mode = ?'); bind.push(q.dir); }
  if (q.goal) { wo.push('goal_mode = ?'); bind.push(q.goal); }
  if (q.size) { wo.push('size_key = ?'); bind.push(q.size); }
  return { where: wo.join(' AND '), bind };
}

/** Kanonisierter Cache-Schluessel: feste Parameterreihenfolge, ausgeschriebene Vorgaben. */
function cacheSchluessel(url, q) {
  const roh = url.origin + '/api/records'
    + '?dir=' + (q.dir || 'alle')
    + '&goal=' + (q.goal || 'alle')
    + '&size=' + (q.size || 'alle')
    + '&limit=' + q.limit
    + '&offset=' + q.offset
    + '&bestPerName=' + (q.bestPerName ? '1' : '0');
  return new Request(roh, { method: 'GET' });
}

async function handleGet(request, env, ctx, url) {
  const pq = parseQuery(url.searchParams);
  if (!pq.ok) return fehlerAntwort(pq, request, env);
  const q = pq.query;

  // Der Kantenspeicher wird nur ohne Origin benutzt: sonst laege im kanonisierten
  // Schluessel eine Antwort mit fremdem Access-Control-Allow-Origin.
  const cache = typeof caches !== 'undefined' && caches && caches.default
    && !(request.headers && request.headers.get('Origin')) ? caches.default : null;
  const key = cache ? cacheSchluessel(url, q) : null;
  if (cache) {
    const treffer = await cache.match(key);
    if (treffer) return treffer;
  }

  const f = filter(q);
  let zaehlSql, listeSql, listeBind;
  if (q.bestPerName) {
    zaehlSql = 'SELECT COUNT(DISTINCT name_key) AS n FROM records WHERE ' + f.where;
    listeSql = 'SELECT ' + SPALTEN + ' FROM (SELECT ' + SPALTEN + ', ROW_NUMBER() OVER ('
      + 'PARTITION BY name_key ORDER BY ' + SORTIERUNG + ') AS rn FROM records WHERE ' + f.where
      + ') WHERE rn = 1 ORDER BY ' + SORTIERUNG + ' LIMIT ? OFFSET ?';
  } else {
    zaehlSql = 'SELECT COUNT(*) AS n FROM records WHERE ' + f.where;
    listeSql = 'SELECT ' + SPALTEN + ' FROM records WHERE ' + f.where
      + ' ORDER BY ' + SORTIERUNG + ' LIMIT ? OFFSET ?';
  }
  listeBind = f.bind.concat([q.limit, q.offset]);

  let total = 0, zeilen = [];
  try {
    const [zaehlRes, listeRes] = await env.DB.batch([
      env.DB.prepare(zaehlSql).bind(...f.bind),
      env.DB.prepare(listeSql).bind(...listeBind)
    ]);
    const zr = zaehlRes && Array.isArray(zaehlRes.results) ? zaehlRes.results[0] : null;
    total = zr ? Number(zr.n) : 0;
    zeilen = listeRes && Array.isArray(listeRes.results) ? listeRes.results : [];
  } catch (err) {
    return serverFehler(request, env, err, 'get');
  }

  const records = zeilen.map((r, i) => zeileZuRow(r, q.offset + i + 1));
  const body = {
    ok: true,
    query: {
      dir: q.dir, goal: q.goal, size: q.size,
      limit: q.limit, offset: q.offset, bestPerName: q.bestPerName
    },
    total,
    records
  };
  const res = json(body, 200, request, env, { 'Cache-Control': CACHE_GET });
  if (cache && ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(Promise.resolve(cache.put(key, res.clone())).catch((err) => console.error('cache', err && err.message)));
  }
  return res;
}

/** Serverseitige Verifikation: Level aus levelCode regenerieren und Tipps nachspielen. */
function pruefeReplay(v) {
  if (!v.taps || v.taps.length === 0) return 0;
  try {
    const level = generateFromCode(v.levelCode);
    if (level.cubes.length !== v.cubes) return 0;
    const r = replayTaps(level, v.taps);
    if (!r.ok || !r.solved) return 0;
    if (r.moves !== v.moves) return 0;
    if (r.timeLowerMs > v.timeMs) return 0;
    return 1;
  } catch (err) {
    console.error('replay', err && err.message);
    return 0;
  }
}

const INSERT_SQL = `INSERT INTO records
 (created_at, run_id, client_id, name, name_key, dir_mode, goal_mode,
  size_x, size_y, size_z, size_key, cubes, moves, undos, time_ms, seed, level_code,
  rule_version, gen_version, app_version, verified, ip_hash, ua_hash, suspicion, status)
 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,'ok')
 ON CONFLICT(run_id) DO NOTHING
 RETURNING id, created_at, moves, time_ms, verified, dir_mode, goal_mode, size_key`;

const RANG_SQL = `SELECT COUNT(*) AS n FROM records
 WHERE status = 'ok' AND dir_mode = ?1 AND goal_mode = ?2 AND size_key = ?3
   AND ( moves < ?4
      OR (moves = ?4 AND verified > ?5)
      OR (moves = ?4 AND verified = ?5 AND time_ms < ?6)
      OR (moves = ?4 AND verified = ?5 AND time_ms = ?6 AND created_at < ?7)
      OR (moves = ?4 AND verified = ?5 AND time_ms = ?6 AND created_at = ?7 AND id < ?8) )`;

const GESAMT_SQL = `SELECT COUNT(*) AS n FROM records
 WHERE status = 'ok' AND dir_mode = ?1 AND goal_mode = ?2 AND size_key = ?3`;

/** Rang innerhalb des eigenen Brettes plus Gesamtzahl. */
async function rangUndGesamt(env, zeile) {
  const [rangRes, gesamtRes] = await env.DB.batch([
    env.DB.prepare(RANG_SQL).bind(
      zeile.dir_mode, zeile.goal_mode, zeile.size_key,
      Number(zeile.moves), Number(zeile.verified), Number(zeile.time_ms),
      Number(zeile.created_at), Number(zeile.id)
    ),
    env.DB.prepare(GESAMT_SQL).bind(zeile.dir_mode, zeile.goal_mode, zeile.size_key)
  ]);
  const rr = rangRes && Array.isArray(rangRes.results) ? rangRes.results[0] : null;
  const gr = gesamtRes && Array.isArray(gesamtRes.results) ? gesamtRes.results[0] : null;
  return { rank: (rr ? Number(rr.n) : 0) + 1, total: gr ? Number(gr.n) : 1 };
}

async function handlePost(request, env, ctx, url) {
  // --- Groessenriegel vor allem anderen ----------------------------------
  const cl = request.headers.get('Content-Length');
  if (cl && Number(cl) > MAX_BODY_BYTES) {
    return fehlerAntwort({ status: 413, error: 'payload_too_large', message: 'Die Uebertragung ist zu gross.' }, request, env);
  }

  // --- Rate-Limit laeuft VOR der Validierung -----------------------------
  let ipHash;
  try {
    ipHash = await hashIp(request, env);
  } catch (err) {
    return serverFehler(request, env, err, 'ip_salt');
  }
  let grenze;
  try {
    grenze = await checkRateLimit(env, ipHash);
  } catch (err) {
    return serverFehler(request, env, err, 'ratelimit');
  }
  if (ctx && typeof ctx.waitUntil === 'function' && Math.random() < GC_WAHRSCHEINLICHKEIT) {
    ctx.waitUntil(Promise.resolve(gcRateLimit(env)).catch((err) => console.error('gc', err && err.message)));
  }
  if (!grenze.ok) {
    return fehlerAntwort(
      { status: 429, error: 'rate_limited', message: 'Zu viele Einreichungen. Bitte kurz warten.', retryAfterSec: grenze.retryAfterSec },
      request, env, { 'Retry-After': String(grenze.retryAfterSec) }
    );
  }

  // --- Rumpf -------------------------------------------------------------
  let text;
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) {
      return fehlerAntwort({ status: 413, error: 'payload_too_large', message: 'Die Uebertragung ist zu gross.' }, request, env);
    }
    text = new TextDecoder().decode(buf);
  } catch (err) {
    return fehlerAntwort({ status: 400, error: 'bad_json', message: 'Der Rumpf konnte nicht gelesen werden.' }, request, env);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    return fehlerAntwort({ status: 400, error: 'bad_json', message: 'Die Daten sind kein gueltiges JSON.' }, request, env);
  }

  const geprueft = validateSubmission(payload);
  if (!geprueft.ok) return fehlerAntwort(geprueft, request, env);
  const v = geprueft.value;

  const nam = await normalizeName(v.name, env);
  if (!nam.ok) {
    return fehlerAntwort({ status: 400, error: 'name_rejected', field: 'name', message: nam.message }, request, env);
  }

  const verified = pruefeReplay(v);

  let uaHash = null;
  try {
    const ua = request.headers.get('User-Agent');
    if (ua) uaHash = await hashText(ua, env, 16);
  } catch (err) {
    uaHash = null;
  }

  const jetzt = Date.now();
  let zeile;
  try {
    zeile = await env.DB.prepare(INSERT_SQL).bind(
      jetzt, v.runId, v.clientId, nam.name, nam.key, v.dirMode, v.goalMode,
      v.size.x, v.size.y, v.size.z, v.sizeKey, v.cubes, v.moves, v.undos, v.timeMs,
      v.seed, v.levelCode, v.ruleVersion, v.genVersion, v.appVersion, verified,
      ipHash, uaHash, v.suspicion
    ).first();
  } catch (err) {
    return serverFehler(request, env, err, 'insert');
  }

  let duplicate = false;
  if (!zeile) {
    duplicate = true;
    try {
      zeile = await env.DB.prepare(
        'SELECT id, created_at, moves, time_ms, verified, dir_mode, goal_mode, size_key FROM records WHERE run_id = ?1'
      ).bind(v.runId).first();
    } catch (err) {
      return serverFehler(request, env, err, 'duplicate');
    }
    if (!zeile) return serverFehler(request, env, new Error('run_id weder eingefuegt noch gefunden'), 'duplicate');
  }

  let rang;
  try {
    rang = await rangUndGesamt(env, zeile);
  } catch (err) {
    return serverFehler(request, env, err, 'rank');
  }

  return json({
    ok: true,
    id: Number(zeile.id),
    rank: rang.rank,
    total: rang.total,
    duplicate,
    verified: Number(zeile.verified) === 1
  }, duplicate ? 200 : 201, request, env);
}

/**
 * Einstieg fuer /api/records.
 * @param {Request} request @param {any} env @param {any} ctx @param {URL} url
 * @returns {Promise<Response>}
 */
export async function handleRecords(request, env, ctx, url) {
  const m = request.method.toUpperCase();
  if (m === 'OPTIONS') return preflight(request, env);
  if (m === 'GET' || m === 'HEAD') return handleGet(request, env, ctx, url);
  if (m === 'POST') return handlePost(request, env, ctx, url);
  return fehlerAntwort(
    { status: 405, error: 'method_not_allowed', message: 'Diese Methode ist hier nicht erlaubt.' },
    request, env, { Allow: 'GET, POST, OPTIONS' }
  );
}
