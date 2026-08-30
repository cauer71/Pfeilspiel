// SPEC §10.6 — Anfragebearbeitung des Workers: worker/index.js und worker/api-records.js.
// Kein Netzwerk, kein wrangler, kein D1: Datenbank, Static Assets und Kantenspeicher sind
// Attrappen in dieser Datei. Node 22 kennt Request/Response/Headers, aber kein `caches`;
// der Kantenspeicher wird deshalb nur dort gestellt, wo er geprueft wird.

import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../worker/index.js';
import { RULE_VERSION } from '../public/src/game.js';
import { GEN_VERSION } from '../public/src/levels.js';

const ORIGIN = 'https://pfeilspiel.example';

// --- Attrappen -------------------------------------------------------------

/**
 * D1-Attrappe. Schreibt jede abgesetzte SQL-Zeichenkette samt Bindungen mit und
 * beantwortet sie nach dem Muster der echten Abfragen.
 * @param {Object} [plan] zeilen, zaehl, hits, blockliste, insert, select, rang, gesamt, wirft
 */
function macheDb(plan) {
  const p = plan || {};
  const zeilen = p.zeilen || [];
  const log = [];

  function antwort(sql, bind) {
    if (typeof p.wirft === 'function' && p.wirft(sql, bind)) {
      throw new Error('D1 ist nicht erreichbar');
    }
    if (/rate_limit/.test(sql)) {
      if (/^DELETE/.test(sql.trim())) return { success: true, meta: { changes: 3 } };
      return { results: [{ hits: p.hits === undefined ? 1 : p.hits, window_start: bind[1] }] };
    }
    if (/name_blocklist/.test(sql)) {
      return { results: p.blockliste === undefined ? [{ pattern: 'admin' }] : p.blockliste };
    }
    if (/^INSERT INTO records/.test(sql.trim())) {
      if (p.insert === null) return null;                    // ON CONFLICT DO NOTHING
      if (p.insert) return p.insert;
      return {
        id: 4711, created_at: bind[0], moves: bind[12], time_ms: bind[14],
        verified: bind[20], dir_mode: bind[5], goal_mode: bind[6], size_key: bind[10]
      };
    }
    if (/WHERE run_id = \?1/.test(sql)) return p.select === undefined ? null : p.select;
    if (/moves < \?4/.test(sql)) return { results: [{ n: p.rang === undefined ? 2 : p.rang }] };
    if (/dir_mode = \?1/.test(sql)) return { results: [{ n: p.gesamt === undefined ? 9 : p.gesamt }] };
    if (/COUNT\(/.test(sql)) return { results: [{ n: p.zaehl === undefined ? zeilen.length : p.zaehl }] };
    return { results: zeilen };
  }

  const db = {
    log,
    prepare(sql) {
      const eintrag = { sql: String(sql), bind: [] };
      const stmt = {
        eintrag,
        bind(...args) { eintrag.bind = args; return stmt; },
        async all() { log.push(eintrag); return antwort(eintrag.sql, eintrag.bind); },
        async first() { log.push(eintrag); return antwort(eintrag.sql, eintrag.bind); },
        async run() { log.push(eintrag); return antwort(eintrag.sql, eintrag.bind); }
      };
      return stmt;
    },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) {
        log.push(s.eintrag);
        out.push(antwort(s.eintrag.sql, s.eintrag.bind));
      }
      return out;
    }
  };
  return db;
}

/** ASSETS-Attrappe: merkt sich die durchgereichte Anfrage. */
function macheAssets(antwort) {
  const gesehen = [];
  return {
    gesehen,
    async fetch(request) {
      gesehen.push(request.url);
      if (typeof antwort === 'function') return antwort(request);
      return new Response('<!doctype html>statisch', {
        status: 200, headers: { 'Content-Type': 'text/html' }
      });
    }
  };
}

function macheEnv(plan) {
  const p = plan || {};
  return {
    DB: p.db || macheDb(p),
    ASSETS: p.assets || macheAssets(),
    ALLOWED_ORIGINS: p.origins === undefined ? '' : p.origins,
    IP_SALT: p.ipSalt === undefined ? 'geheimes-testsalz' : p.ipSalt
  };
}

/** ctx-Attrappe mit sammelndem waitUntil. */
function macheCtx() {
  const offen = [];
  return {
    offen,
    waitUntil(p) { offen.push(Promise.resolve(p)); },
    async fertig() { await Promise.all(offen); }
  };
}

function anfrage(pfad, init) {
  return new Request(ORIGIN + pfad, init);
}

/** Eine D1-Zeile, wie sie die Bestenlistenabfrage liefert. */
function dbZeile(aenderungen) {
  return Object.assign({
    id: 17, name: 'Anna', dir_mode: 'fassade', goal_mode: 'abbau',
    size_x: 5, size_y: 7, size_z: 5, size_key: '5x7x5',
    cubes: 121, moves: 121, undos: 3, time_ms: 73210, verified: 1,
    created_at: Date.UTC(2026, 7, 30, 18, 22, 41)
  }, aenderungen || {});
}

/** Gueltige POST-Nutzlast (identisch zur Basis aus tests/worker.test.js). */
function nutzlast(aenderungen) {
  return Object.assign({
    name: 'Anna',
    dirMode: 'fassade',
    goalMode: 'abbau',
    size: { x: 4, y: 4, z: 4 },
    cubes: 20,
    moves: 25,
    undos: 3,
    timeMs: 60000,
    seed: 589116,
    levelCode: 'F-A-4x4x4-0-0008FA3C',
    ruleVersion: RULE_VERSION,
    genVersion: GEN_VERSION,
    runId: '3f6d1c2a-9b41-4a77-8a0e-1d5b7c9e2f04',
    clientId: '7c2e5b18-0d33-4f9a-9c11-a2b3c4d5e6f7',
    appVersion: '1.0.0'
  }, aenderungen || {});
}

function postAnfrage(koerper, kopf) {
  return anfrage('/api/records', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' }, kopf || {}),
    body: typeof koerper === 'string' ? koerper : JSON.stringify(koerper)
  });
}

/** Prueft die Kopfzeilen, die auf JEDER JSON-Antwort stehen muessen (SPEC §9.5, §9.7). */
function pruefeJsonKopf(res) {
  assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Vary'), 'Origin');
}

async function jsonVon(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    assert.fail('Antwort war kein JSON: ' + JSON.stringify(text.slice(0, 200)));
  }
}

/** Findet den zuletzt abgesetzten Befehl, dessen SQL zum Muster passt. */
function letztesSql(db, muster) {
  for (let i = db.log.length - 1; i >= 0; i--) {
    if (muster.test(db.log[i].sql)) return db.log[i];
  }
  return null;
}

// --- 1. GET /api/records ---------------------------------------------------

test('1. GET /api/records liefert die in §9.3 beschriebene JSON-Form', async () => {
  const db = macheDb({ zeilen: [dbZeile(), dbZeile({ id: 18, name: 'Bo', moves: 130, verified: 0 })], zaehl: 137 });
  const res = await worker.fetch(anfrage('/api/records'), macheEnv({ db }), macheCtx());

  assert.equal(res.status, 200);
  pruefeJsonKopf(res);
  assert.equal(res.headers.get('Cache-Control'),
    'public, max-age=10, s-maxage=30, stale-while-revalidate=60');

  const body = await jsonVon(res);
  assert.equal(body.ok, true);
  assert.deepEqual(body.query,
    { dir: null, goal: null, size: null, limit: 20, offset: 0, bestPerName: false });
  assert.equal(body.total, 137);
  assert.equal(body.records.length, 2);
  assert.deepEqual(body.records[0], {
    rank: 1, id: 17, name: 'Anna', dirMode: 'fassade', goalMode: 'abbau',
    size: { x: 5, y: 7, z: 5 }, sizeKey: '5x7x5',
    cubes: 121, moves: 121, undos: 3, timeMs: 73210, verified: true,
    createdAt: '2026-08-30T18:22:41.000Z'
  });
  assert.equal(body.records[1].rank, 2);
  assert.equal(body.records[1].verified, false);
});

test('2. GET achtet limit und offset: Bindung und Rangzaehlung', async () => {
  const zeilen = [dbZeile({ id: 40 }), dbZeile({ id: 41 }), dbZeile({ id: 42 })];
  const db = macheDb({ zeilen, zaehl: 500 });
  const res = await worker.fetch(anfrage('/api/records?limit=3&offset=10'), macheEnv({ db }), macheCtx());
  const body = await jsonVon(res);

  assert.equal(res.status, 200);
  assert.equal(body.query.limit, 3);
  assert.equal(body.query.offset, 10);
  assert.deepEqual(body.records.map((r) => r.rank), [11, 12, 13]);

  const liste = letztesSql(db, /LIMIT \? OFFSET \?/);
  assert.ok(liste, 'Listenabfrage mit LIMIT/OFFSET gefunden');
  assert.deepEqual(liste.bind, [3, 10]);
  assert.match(liste.sql, /ORDER BY moves ASC, verified DESC, time_ms ASC, created_at ASC, id ASC/);
});

test('3. GET-Filter landen als Bindungen in WHERE, nicht im SQL-Text', async () => {
  const db = macheDb({ zeilen: [dbZeile()] });
  const res = await worker.fetch(
    anfrage('/api/records?dir=volumen&goal=befreiung&size=5x7x5&limit=7&offset=2'),
    macheEnv({ db }), macheCtx());
  const body = await jsonVon(res);

  assert.equal(res.status, 200);
  assert.deepEqual(body.query,
    { dir: 'volumen', goal: 'befreiung', size: '5x7x5', limit: 7, offset: 2, bestPerName: false });

  const zaehl = letztesSql(db, /COUNT\(\*\)/);
  assert.deepEqual(zaehl.bind, ['volumen', 'befreiung', '5x7x5']);
  assert.match(zaehl.sql, /WHERE status = 'ok' AND dir_mode = \? AND goal_mode = \? AND size_key = \?/);

  const liste = letztesSql(db, /LIMIT \? OFFSET \?/);
  assert.deepEqual(liste.bind, ['volumen', 'befreiung', '5x7x5', 7, 2]);
  for (const wert of ['volumen', 'befreiung', '5x7x5']) {
    assert.equal(liste.sql.indexOf(wert), -1, 'Wert steht nicht im SQL-Text: ' + wert);
  }
});

test('4. bestPerName=1 waehlt je Namensschluessel genau eine Zeile', async () => {
  const db = macheDb({ zeilen: [dbZeile()], zaehl: 12 });
  const res = await worker.fetch(anfrage('/api/records?bestPerName=1&limit=5'), macheEnv({ db }), macheCtx());
  const body = await jsonVon(res);

  assert.equal(res.status, 200);
  assert.equal(body.query.bestPerName, true);
  assert.equal(body.total, 12);

  const zaehl = letztesSql(db, /COUNT\(DISTINCT name_key\)/);
  assert.ok(zaehl, 'Zaehlabfrage zaehlt verschiedene name_key');
  const liste = letztesSql(db, /ROW_NUMBER\(\) OVER/);
  assert.ok(liste, 'Listenabfrage benutzt ROW_NUMBER()');
  assert.match(liste.sql, /PARTITION BY name_key ORDER BY moves ASC/);
  assert.match(liste.sql, /WHERE rn = 1/);
  assert.deepEqual(liste.bind, [5, 0]);
});

test('5. ungueltiger Abfrageparameter ergibt 400 validation mit Feldnamen', async () => {
  const db = macheDb();
  const faelle = [
    ['/api/records?limit=0', 'limit'],
    ['/api/records?limit=101', 'limit'],
    ['/api/records?offset=1001', 'offset'],
    ['/api/records?dir=diagonal', 'dir'],
    ['/api/records?bestPerName=0', 'bestPerName'],
    ['/api/records?sortiere=nach_zeit', 'sortiere']
  ];
  for (const [pfad, feld] of faelle) {
    const res = await worker.fetch(anfrage(pfad), macheEnv({ db }), macheCtx());
    assert.equal(res.status, 400, pfad);
    pruefeJsonKopf(res);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', pfad);
    const body = await jsonVon(res);
    assert.equal(body.ok, false, pfad);
    assert.equal(body.error, 'validation', pfad);
    assert.equal(body.field, feld, pfad);
    assert.ok(body.message.length > 0, pfad);
  }
  assert.equal(db.log.length, 0, 'ungueltige Abfragen erreichen die Datenbank nie');
});

test('6. eine Ausnahme aus D1 endet im GET als sauberer 500er mit JSON', async () => {
  const db = macheDb({ wirft: () => true });
  const alt = console.error;
  console.error = () => {};
  let res;
  try {
    res = await worker.fetch(anfrage('/api/records'), macheEnv({ db }), macheCtx());
  } finally {
    console.error = alt;
  }
  assert.equal(res.status, 500);
  pruefeJsonKopf(res);
  const body = await jsonVon(res);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'server_error');
  assert.match(body.message, /Bestenliste/);
  assert.equal(body.stack, undefined, 'kein Innenleben in der Antwort');
});

test('7. HEAD /api/records wird wie GET behandelt', async () => {
  const db = macheDb({ zeilen: [dbZeile()], zaehl: 1 });
  const res = await worker.fetch(anfrage('/api/records', { method: 'HEAD' }), macheEnv({ db }), macheCtx());
  assert.equal(res.status, 200);
  pruefeJsonKopf(res);
  assert.ok(letztesSql(db, /LIMIT \? OFFSET \?/));
});

// --- 8. Kantenspeicher -----------------------------------------------------

test('8. caches.default wird ohne Origin benutzt und mit Origin umgangen', async () => {
  const speicher = new Map();
  globalThis.caches = {
    default: {
      async match(key) { const r = speicher.get(key.url); return r ? r.clone() : undefined; },
      async put(key, res) { speicher.set(key.url, res); }
    }
  };
  try {
    const db1 = macheDb({ zeilen: [dbZeile()], zaehl: 1 });
    const ctx1 = macheCtx();
    const res1 = await worker.fetch(anfrage('/api/records?limit=5'), macheEnv({ db: db1 }), ctx1);
    const body1 = await jsonVon(res1);
    await ctx1.fertig();

    assert.equal(speicher.size, 1, 'genau ein kanonisierter Schluessel');
    const schluessel = [...speicher.keys()][0];
    assert.equal(schluessel,
      ORIGIN + '/api/records?dir=alle&goal=alle&size=alle&limit=5&offset=0&bestPerName=0');

    // Zweiter Aufruf: die Datenbank wuerde werfen, der Treffer kommt aus dem Speicher.
    const db2 = macheDb({ wirft: () => true });
    const res2 = await worker.fetch(anfrage('/api/records?limit=5'), macheEnv({ db: db2 }), macheCtx());
    assert.equal(res2.status, 200);
    assert.equal(db2.log.length, 0, 'kein D1-Zugriff beim Treffer');
    assert.deepEqual(await jsonVon(res2), body1);

    // Mit Origin-Kopf wird der Speicher weder gelesen noch geschrieben.
    const db3 = macheDb({ zeilen: [dbZeile({ id: 99 })], zaehl: 1 });
    const ctx3 = macheCtx();
    const res3 = await worker.fetch(
      anfrage('/api/records?limit=5', { headers: { Origin: ORIGIN } }),
      macheEnv({ db: db3, origins: ORIGIN }), ctx3);
    await ctx3.fertig();
    assert.equal(res3.status, 200);
    assert.equal(res3.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.ok(db3.log.length > 0, 'mit Origin wird wieder D1 gefragt');
    assert.equal(speicher.size, 1, 'die Origin-Antwort landet nicht im geteilten Speicher');
    const body3 = await jsonVon(res3);
    assert.equal(body3.records[0].id, 99);
  } finally {
    delete globalThis.caches;
  }
});

// --- 9. Methoden und Routing ----------------------------------------------

test('9. unbekannte Methode auf /api/records ergibt 405 mit Allow-Kopf', async () => {
  const db = macheDb();
  for (const m of ['PUT', 'DELETE', 'PATCH']) {
    const res = await worker.fetch(anfrage('/api/records', { method: m, body: m === 'DELETE' ? undefined : '{}' }),
      macheEnv({ db }), macheCtx());
    assert.equal(res.status, 405, m);
    assert.equal(res.headers.get('Allow'), 'GET, POST, OPTIONS', m);
    pruefeJsonKopf(res);
    const body = await jsonVon(res);
    assert.equal(body.ok, false, m);
    assert.equal(body.error, 'method_not_allowed', m);
  }
  assert.equal(db.log.length, 0);
});

test('10. OPTIONS /api/records ergibt 204 ohne Rumpf und mit Allow', async () => {
  const res = await worker.fetch(
    anfrage('/api/records', { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
    macheEnv({ origins: ORIGIN + ' https://andere.example' }), macheCtx());

  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Allow'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal(res.headers.get('Vary'), 'Origin');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(await res.text(), '');
});

test('11. ein fremder Origin bekommt keine Freigabe, aber Vary: Origin', async () => {
  const db = macheDb({ zeilen: [], zaehl: 0 });
  const res = await worker.fetch(
    anfrage('/api/records', { headers: { Origin: 'https://boese.example' } }),
    macheEnv({ db, origins: ORIGIN }), macheCtx());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(res.headers.get('Vary'), 'Origin');
});

test('12. /api/health antwortet auf GET und weist andere Methoden ab', async () => {
  const env = macheEnv();
  const vorher = Date.now();
  const res = await worker.fetch(anfrage('/api/health'), env, macheCtx());
  assert.equal(res.status, 200);
  pruefeJsonKopf(res);
  const body = await jsonVon(res);
  assert.equal(body.ok, true);
  assert.equal(typeof body.ts, 'number');
  assert.ok(body.ts >= vorher);

  const post = await worker.fetch(anfrage('/api/health', { method: 'POST', body: '{}' }), env, macheCtx());
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, OPTIONS');
  assert.equal((await jsonVon(post)).error, 'method_not_allowed');

  const opt = await worker.fetch(anfrage('/api/health', { method: 'OPTIONS' }), env, macheCtx());
  assert.equal(opt.status, 204);
});

test('13. unbekanntes /api/* ergibt 404 JSON statt eines Static Asset', async () => {
  const assets = macheAssets();
  const env = macheEnv({ assets });
  for (const pfad of ['/api', '/api/', '/api/records/17', '/api/scores', '/api/records2']) {
    const res = await worker.fetch(anfrage(pfad), env, macheCtx());
    assert.equal(res.status, 404, pfad);
    pruefeJsonKopf(res);
    const body = await jsonVon(res);
    assert.equal(body.ok, false, pfad);
    assert.equal(body.error, 'not_found', pfad);
  }
  assert.deepEqual(assets.gesehen, [], 'kein /api/*-Pfad faellt auf ASSETS durch');
});

test('14. alles ausserhalb von /api geht unveraendert an ASSETS', async () => {
  const assets = macheAssets();
  const env = macheEnv({ assets });
  for (const pfad of ['/', '/index.html', '/src/main.js', '/vendor/three.module.js', '/apiary']) {
    const res = await worker.fetch(anfrage(pfad), env, macheCtx());
    assert.equal(res.status, 200, pfad);
    assert.equal(await res.text(), '<!doctype html>statisch', pfad);
  }
  assert.deepEqual(assets.gesehen, [
    ORIGIN + '/', ORIGIN + '/index.html', ORIGIN + '/src/main.js',
    ORIGIN + '/vendor/three.module.js', ORIGIN + '/apiary'
  ]);
});

test('15. wirft ASSETS, faengt der 500er-Faenger in index.js', async () => {
  const assets = { async fetch() { throw new Error('Assets-Bindung fehlt'); } };
  const alt = console.error;
  console.error = () => {};
  let res;
  try {
    res = await worker.fetch(anfrage('/index.html'), macheEnv({ assets }), macheCtx());
  } finally {
    console.error = alt;
  }
  assert.equal(res.status, 500);
  pruefeJsonKopf(res);
  const body = await jsonVon(res);
  assert.equal(body.error, 'server_error');
  assert.match(body.message, /Serverfehler/);
});

// --- 16. POST /api/records -------------------------------------------------

test('16. gueltiger POST ergibt 201 mit Rang und vollstaendiger INSERT-Bindung', async () => {
  const db = macheDb({ rang: 2, gesamt: 137 });
  const res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db }), {});

  assert.equal(res.status, 201);
  pruefeJsonKopf(res);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await jsonVon(res);
  assert.deepEqual(body, { ok: true, id: 4711, rank: 3, total: 137, duplicate: false, verified: false });

  const ins = letztesSql(db, /^INSERT INTO records/m);
  assert.ok(ins, 'INSERT abgesetzt');
  assert.equal(ins.bind.length, 24, '24 Werte gebunden');
  assert.equal(typeof ins.bind[0], 'number');                       // created_at: Serverzeit
  assert.equal(ins.bind[1], '3f6d1c2a-9b41-4a77-8a0e-1d5b7c9e2f04'); // run_id
  assert.equal(ins.bind[2], '7c2e5b18-0d33-4f9a-9c11-a2b3c4d5e6f7'); // client_id
  assert.equal(ins.bind[3], 'Anna');                                 // name
  assert.equal(ins.bind[4], 'anna');                                 // name_key
  assert.equal(ins.bind[5], 'fassade');
  assert.equal(ins.bind[6], 'abbau');
  assert.deepEqual(ins.bind.slice(7, 11), [4, 4, 4, '4x4x4']);
  assert.deepEqual(ins.bind.slice(11, 15), [20, 25, 3, 60000]);
  assert.equal(ins.bind[16], 'F-A-4x4x4-0-0008FA3C');
  assert.equal(ins.bind[20], 0, 'ohne taps keine Verifikation');
  assert.match(String(ins.bind[21]), /^[0-9a-f]{16}$/, 'ip_hash ist ein 16-stelliger Hex-Praefix');
  assert.equal(ins.bind[21].indexOf('203.0.113.7'), -1, 'die Roh-IP wird nie gespeichert');
  assert.match(ins.sql, /ON CONFLICT\(run_id\) DO NOTHING/);

  const rang = letztesSql(db, /moves < \?4/);
  assert.deepEqual(rang.bind.slice(0, 3), ['fassade', 'abbau', '4x4x4']);
});

test('17. zweiter POST mit derselben run_id ist idempotent (200, duplicate)', async () => {
  const bestehend = {
    id: 4711, created_at: 1756500000000, moves: 25, time_ms: 60000,
    verified: 1, dir_mode: 'fassade', goal_mode: 'abbau', size_key: '4x4x4'
  };
  const db = macheDb({ insert: null, select: bestehend, rang: 2, gesamt: 137 });
  const res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db }), {});

  assert.equal(res.status, 200);
  const body = await jsonVon(res);
  assert.deepEqual(body, { ok: true, id: 4711, rank: 3, total: 137, duplicate: true, verified: true });

  const nach = letztesSql(db, /WHERE run_id = \?1/);
  assert.ok(nach, 'bestehender Datensatz wird nachgeschlagen');
  assert.deepEqual(nach.bind, ['3f6d1c2a-9b41-4a77-8a0e-1d5b7c9e2f04']);
});

test('18. verschwundener Datensatz nach Konflikt endet als sauberer 500er', async () => {
  const db = macheDb({ insert: null, select: null });
  const alt = console.error;
  console.error = () => {};
  let res;
  try {
    res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db }), {});
  } finally {
    console.error = alt;
  }
  assert.equal(res.status, 500);
  pruefeJsonKopf(res);
  assert.equal((await jsonVon(res)).error, 'server_error');
});

test('19. fehlerhafte Nutzlast ergibt einen sauberen Fehler statt 500', async () => {
  const db = macheDb();
  const env = macheEnv({ db });

  const kaputt = await worker.fetch(postAnfrage('{"name": "Anna",'), env, {});
  assert.equal(kaputt.status, 400);
  pruefeJsonKopf(kaputt);
  assert.equal((await jsonVon(kaputt)).error, 'bad_json');

  const leer = await worker.fetch(postAnfrage(''), env, {});
  assert.equal(leer.status, 400);
  assert.equal((await jsonVon(leer)).error, 'bad_json');

  const liste = await worker.fetch(postAnfrage('[1,2,3]'), env, {});
  assert.equal(liste.status, 400);
  assert.equal((await jsonVon(liste)).error, 'validation');

  const nix = await worker.fetch(postAnfrage('null'), env, {});
  assert.equal(nix.status, 400);
  assert.equal((await jsonVon(nix)).error, 'validation');

  assert.equal(letztesSql(db, /^INSERT INTO records/m), null, 'nichts davon erreicht die Tabelle');
});

test('20. Feldfehler, Version und Name kommen als eigene Fehlercodes zurueck', async () => {
  const db = macheDb();
  const env = macheEnv({ db });
  const faelle = [
    [nutzlast({ moves: undefined }), 400, 'validation', 'moves'],
    [nutzlast({ cubes: 'zwanzig' }), 400, 'validation', 'cubes'],
    [nutzlast({ cubes: 4000 }), 400, 'implausible', 'cubes'],
    [nutzlast({ timeMs: 10 }), 400, 'implausible', 'timeMs'],
    [nutzlast({ runId: 'keine-uuid' }), 400, 'validation', 'runId'],
    [nutzlast({ ruleVersion: RULE_VERSION + 99 }), 400, 'version_mismatch', 'ruleVersion'],
    [nutzlast({ genVersion: GEN_VERSION + 99 }), 400, 'version_mismatch', 'genVersion'],
    [nutzlast({ name: 'Admin' }), 400, 'name_rejected', 'name'],
    [nutzlast({ name: 'a' }), 400, 'name_rejected', 'name'],
    [nutzlast({ name: 'anna@example.com' }), 400, 'name_rejected', 'name']
  ];
  for (const [p, status, code, feld] of faelle) {
    const res = await worker.fetch(postAnfrage(p), env, {});
    const body = await jsonVon(res);
    assert.equal(res.status, status, code + '/' + feld);
    pruefeJsonKopf(res);
    assert.equal(body.ok, false, code);
    assert.equal(body.error, code, JSON.stringify(body));
    assert.equal(body.field, feld, JSON.stringify(body));
    assert.ok(typeof body.message === 'string' && body.message.length > 0, code);
  }
  assert.equal(letztesSql(db, /^INSERT INTO records/m), null);
});

test('21. eine Ausnahme beim INSERT endet als sauberer 500er mit JSON', async () => {
  const db = macheDb({ wirft: (sql) => /^INSERT INTO records/.test(sql.trim()) });
  const alt = console.error;
  console.error = () => {};
  let res;
  try {
    res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db }), {});
  } finally {
    console.error = alt;
  }
  assert.equal(res.status, 500);
  pruefeJsonKopf(res);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await jsonVon(res);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'server_error');
  assert.equal(body.message.indexOf('D1'), -1, 'keine Innenansicht im Klartext');
});

test('22. auch die Rangabfrage darf nur einen sauberen 500er ausloesen', async () => {
  const db = macheDb({ wirft: (sql) => /moves < \?4/.test(sql) });
  const alt = console.error;
  console.error = () => {};
  let res;
  try {
    res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db }), {});
  } finally {
    console.error = alt;
  }
  assert.equal(res.status, 500);
  assert.equal((await jsonVon(res)).error, 'server_error');
});

test('23. zu grosser Rumpf ergibt 413 - per Content-Length und per Messung', async () => {
  const db = macheDb();
  const env = macheEnv({ db });

  const angekuendigt = await worker.fetch(
    postAnfrage(nutzlast(), { 'Content-Length': '9000' }), env, {});
  assert.equal(angekuendigt.status, 413);
  pruefeJsonKopf(angekuendigt);
  assert.equal((await jsonVon(angekuendigt)).error, 'payload_too_large');
  assert.equal(db.log.length, 0, 'die Ankuendigung stoppt vor jedem D1-Zugriff');

  const gross = nutzlast({ taps: new Array(4000).fill(123456) });
  const gemessen = await worker.fetch(postAnfrage(gross), env, {});
  assert.equal(gemessen.status, 413);
  assert.equal((await jsonVon(gemessen)).error, 'payload_too_large');
  assert.equal(letztesSql(db, /^INSERT INTO records/m), null);
});

test('24. ueberschrittenes Rate-Limit ergibt 429 mit Retry-After und retryAfterSec', async () => {
  const db = macheDb({ hits: 6 });
  const res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db }), {});

  assert.equal(res.status, 429);
  pruefeJsonKopf(res);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const kopf = Number(res.headers.get('Retry-After'));
  assert.ok(Number.isInteger(kopf) && kopf >= 1 && kopf <= 60, 'Retry-After: ' + kopf);

  const body = await jsonVon(res);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'rate_limited');
  assert.equal(body.retryAfterSec, kopf);
  assert.equal(letztesSql(db, /^INSERT INTO records/m), null, 'gedrosselte POSTs schreiben nichts');
});

test('25. faellt die Zaehlertabelle aus, wird der POST trotzdem bedient', async () => {
  const db = macheDb({ wirft: (sql) => /rate_limit/.test(sql) });
  const alt = console.error;
  console.error = () => {};
  let res;
  try {
    res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db }), {});
  } finally {
    console.error = alt;
  }
  assert.equal(res.status, 201, 'ein Ausfall der Drossel legt die Bestenliste nicht lahm');
});

test('26. fehlendes IP_SALT beantwortet den POST verstaendlich statt zu werfen', async () => {
  const alt = console.error;
  console.error = () => {};
  const ohne = macheDb();
  const mit = macheDb();
  let res, vergleich;
  try {
    res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db: ohne, ipSalt: '' }), {});
    // Derselbe POST, nur mit gesetztem Geheimnis: er laeuft durch. Der Unterschied
    // liegt also allein am fehlenden IP_SALT.
    vergleich = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db: mit }), {});
  } finally {
    console.error = alt;
  }
  assert.equal(res.status, 500);
  pruefeJsonKopf(res);
  const body = await jsonVon(res);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'server_error');
  assert.match(body.message, /Bestenliste ist gerade nicht erreichbar/);
  assert.equal(body.message.indexOf('IP_SALT'), -1, 'der Name des Geheimnisses steht nicht in der Antwort');
  assert.equal(ohne.log.length, 0, 'ohne Salz wird nichts gezaehlt und nichts geschrieben');
  assert.equal(vergleich.status, 201);
});

test('27. GET bleibt ohne IP_SALT bedienbar', async () => {
  const db = macheDb({ zeilen: [dbZeile()], zaehl: 1 });
  const res = await worker.fetch(anfrage('/api/records'), macheEnv({ db, ipSalt: '' }), macheCtx());
  assert.equal(res.status, 200, 'die Bestenliste wird nicht vom POST-Geheimnis abhaengig gemacht');
});

test('28. taps, die nicht zum Level passen, ergeben verified=false statt eines Fehlers', async () => {
  const db = macheDb();
  const alt = console.error;
  console.error = () => {};
  let res;
  try {
    res = await worker.fetch(postAnfrage(nutzlast({ taps: new Array(30).fill(0) })), macheEnv({ db }), {});
  } finally {
    console.error = alt;
  }
  assert.equal(res.status, 201);
  const body = await jsonVon(res);
  assert.equal(body.verified, false);
  const ins = letztesSql(db, /^INSERT INTO records/m);
  assert.equal(ins.bind[20], 0);
});

test('29. der Zaehlerputz haengt an ctx.waitUntil und nie am Antwortpfad', async () => {
  const db = macheDb();
  const ctx = macheCtx();
  const zufall = Math.random;
  Math.random = () => 0;
  let res;
  try {
    res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db }), ctx);
    await ctx.fertig();
  } finally {
    Math.random = zufall;
  }
  assert.equal(res.status, 201);
  assert.equal(ctx.offen.length, 1, 'genau eine Hintergrundaufgabe');
  const gc = letztesSql(db, /DELETE FROM rate_limit/);
  assert.ok(gc, 'Muellabfuhr abgesetzt');
  assert.equal(gc.bind.length, 1);
  assert.ok(gc.bind[0] < Date.now(), 'die Grenze liegt in der Vergangenheit');
});

// --- 30. SQL-Hygiene -------------------------------------------------------

/** Zahl der Platzhalter: `?1..?n` zaehlt verschiedene Nummern, `?` jedes Vorkommen. */
function platzhalterZahl(sql) {
  const treffer = sql.match(/\?\d*/g) || [];
  const nummeriert = treffer.filter((t) => t.length > 1);
  if (nummeriert.length === treffer.length && treffer.length > 0) {
    return new Set(nummeriert).size;
  }
  assert.equal(nummeriert.length, 0, 'nummerierte und anonyme Platzhalter nicht mischen: ' + sql);
  return treffer.length;
}

test('30. jeder Nutzerwert kommt als Bindung, nicht per Zeichenkettenverkettung', async () => {
  const db = macheDb({ zeilen: [dbZeile()], zaehl: 1, rang: 0, gesamt: 1 });
  const env = macheEnv({ db });
  const ctx = macheCtx();
  const zufall = Math.random;
  Math.random = () => 0;                       // erzwingt zusaetzlich die Muellabfuhr

  const geheim = {
    name: 'Zora_Test-9',
    runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    clientId: 'ffffffff-1111-4222-8333-444444444444',
    levelCode: 'V-B-5x7x5-3-00ABCDEF'
  };
  try {
    await worker.fetch(anfrage('/api/records?dir=volumen&goal=befreiung&size=5x7x5&limit=9&offset=4'), env, ctx);
    await worker.fetch(anfrage('/api/records?bestPerName=1&dir=fassade'), env, ctx);
    await worker.fetch(postAnfrage(nutzlast({
      name: geheim.name, runId: geheim.runId, clientId: geheim.clientId,
      dirMode: 'volumen', goalMode: 'befreiung', size: { x: 5, y: 7, z: 5 },
      cubes: 121, moves: 121, timeMs: 73210, levelCode: geheim.levelCode
    })), env, ctx);
    await ctx.fertig();
  } finally {
    Math.random = zufall;
  }

  assert.ok(db.log.length >= 10, 'genug Befehle beobachtet: ' + db.log.length);
  const erlaubteLiterale = new Set(["'ok'"]);

  for (const eintrag of db.log) {
    const sql = eintrag.sql;

    // a) Kein Nutzerwert steht als Text im SQL.
    for (const wert of Object.values(geheim).concat(['volumen', 'befreiung', '5x7x5', '203.0.113.7'])) {
      assert.equal(sql.indexOf(wert), -1, 'unverbundener Wert "' + wert + '" in: ' + sql);
    }

    // b) Die einzigen Zeichenkettenliterale sind feste Konstanten des Schemas.
    for (const literal of sql.match(/'[^']*'/g) || []) {
      assert.ok(erlaubteLiterale.has(literal), 'unerwartetes SQL-Literal ' + literal + ' in: ' + sql);
    }

    // c) Jede Bindung hat genau einen Platzhalter und umgekehrt.
    assert.equal(platzhalterZahl(sql), eintrag.bind.length,
      'Platzhalter und Bindungen passen nicht zusammen: ' + sql);

    // d) Kein zusammengesetzter Vergleich mit einem Literal.
    assert.equal(/=\s*"[^"]*"/.test(sql), false, 'doppelte Anfuehrungszeichen als Wert: ' + sql);
    assert.equal(/;/.test(sql.trim().replace(/;$/, '')), false, 'mehrere Anweisungen in einem Befehl: ' + sql);
  }
});

// --- 31. Rangberechnung ----------------------------------------------------

test('31. der Rang benutzt dieselbe Tiebreak-Reihenfolge wie die Bestenliste', async () => {
  for (const [n, erwartet] of [[0, 1], [2, 3], [136, 137]]) {
    const db = macheDb({ rang: n, gesamt: 500 });
    const res = await worker.fetch(postAnfrage(nutzlast()), macheEnv({ db }), {});
    const body = await jsonVon(res);
    assert.equal(body.rank, erwartet, 'Rang ist die Zahl der besseren Eintraege plus eins');
    assert.equal(body.total, 500);

    const ins = letztesSql(db, /^INSERT INTO records/m);
    const rang = letztesSql(db, /moves < \?4/);
    assert.equal(rang.bind.length, 8);
    assert.deepEqual(rang.bind, [
      'fassade', 'abbau', '4x4x4',
      25,               // moves
      0,                // verified
      60000,            // time_ms
      ins.bind[0],      // created_at: dieselbe Serverzeit wie im INSERT
      4711              // id
    ]);

    // Die Reihenfolge der Kriterien MUSS der Sortierung der Liste entsprechen:
    // moves ASC, verified DESC, time_ms ASC, created_at ASC, id ASC.
    assert.match(rang.sql, /moves < \?4/);
    assert.match(rang.sql, /moves = \?4 AND verified > \?5/);
    assert.match(rang.sql, /moves = \?4 AND verified = \?5 AND time_ms < \?6/);
    assert.match(rang.sql, /moves = \?4 AND verified = \?5 AND time_ms = \?6 AND created_at < \?7/);
    assert.match(rang.sql, /moves = \?4 AND verified = \?5 AND time_ms = \?6 AND created_at = \?7 AND id < \?8/);
    assert.match(rang.sql, /status = 'ok'/);

    // Die Gesamtzahl zaehlt dasselbe Brett ohne die Rangbedingungen.
    const gesamt = letztesSql(db, /^SELECT COUNT\(\*\) AS n FROM records\n WHERE status = 'ok' AND dir_mode = \?1/);
    assert.ok(gesamt, 'Gesamtabfrage abgesetzt');
    assert.deepEqual(gesamt.bind, ['fassade', 'abbau', '4x4x4']);
  }
});
