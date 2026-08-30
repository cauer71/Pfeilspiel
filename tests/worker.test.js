// SPEC §10.6 — Validierung des Workers ohne Netzwerk und ohne wrangler.
// Es werden ausschliesslich die reinen Hilfsmodule geladen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildBoard, RULE_VERSION } from '../public/src/game.js';
import { GEN_VERSION, generateForLevelNo, generateFromCode, replayTaps } from '../public/src/levels.js';

import { capacity, minMoves, maxMoves, minTimeMs, parseQuery, validateSubmission } from '../worker/validate.js';
import { normalizeName } from '../worker/names.js';
import { corsHeaders, preflight, json } from '../worker/http.js';
import { ipPraefix, hashText, checkRateLimit, FENSTER } from '../worker/ratelimit.js';

/** Alle Dimensionen aus §10.1. */
function alleDims() {
  const res = [];
  for (let W = 3; W <= 8; W++)
    for (let H = 2; H <= 8; H++)
      for (let D = 3; D <= 8; D++) res.push({ W, H, D });
  return res;
}

/** Gueltige Nutzlast als Ausgangspunkt; einzelne Felder werden je Test verbogen. */
function gueltigeNutzlast(aenderungen) {
  const basis = {
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
  };
  return Object.assign(basis, aenderungen || {});
}

// --- 1. Kapazitaetsgleichheit -------------------------------------------

test('1. capacity() stimmt fuer alle Dimensionen mit buildBoard().C ueberein', () => {
  const dims = alleDims();
  assert.ok(dims.length > 100);
  for (const { W, H, D } of dims) {
    const cF = buildBoard({ mode: 'FASSADE', W, H, D }).C;
    assert.equal(capacity('fassade', W, H, D), cF, `FASSADE ${W}x${H}x${D}`);
    const cV = buildBoard({ mode: 'VOLUMEN', W, H, D }).C;
    assert.equal(capacity('volumen', W, H, D), cV, `VOLUMEN ${W}x${H}x${D}`);
    assert.equal(cV, W * H * D);
  }
});

test('1b. capacity() trifft die Kontrollwerte aus §2.3', () => {
  assert.equal(capacity('fassade', 3, 3, 3), 25);
  assert.equal(capacity('fassade', 4, 4, 4), 52);
  assert.equal(capacity('fassade', 5, 6, 5), 105);
  assert.equal(capacity('fassade', 4, 5, 3), 52);
  assert.equal(capacity('fassade', 7, 7, 4), 136);
  assert.equal(capacity('fassade', 5, 7, 5), 121);
});

// --- 2. Untere Zugschranke ----------------------------------------------

test('2. minMoves: ABBAU = Wuerfelzahl, BEFREIUNG = 1', () => {
  for (const n of [1, 7, 25, 121, 1200]) {
    assert.equal(minMoves('abbau', n), n);
    assert.equal(minMoves('befreiung', n), 1);
  }
});

test('2b. Negativtest: keine Distanzschranke im Validierungspfad', () => {
  // Eine Sprungkette traegt in EINEM Zug beliebig weit. Ein einziger Zug auf einem
  // grossen Turm MUSS in BEFREIUNG akzeptiert werden.
  const res = validateSubmission(gueltigeNutzlast({
    goalMode: 'befreiung',
    size: { x: 5, y: 7, z: 5 },
    cubes: 121,
    moves: 1,
    timeMs: 5000,
    levelCode: 'F-B-5x7x5-0-0008FA3C'
  }));
  assert.equal(res.ok, true);
  // Und die Quelle enthaelt an keiner Stelle eine Distanzhalbierung.
  const quelle = readFileSync(fileURLToPath(new URL('../worker/validate.js', import.meta.url)), 'utf8');
  assert.equal(/ceil/i.test(quelle), false, 'validate.js darf keine aufgerundete Schranke enthalten');
  assert.equal(minMoves.length, 2);
});

// --- 3. validateSubmission ----------------------------------------------

test('3. validateSubmission akzeptiert eine gueltige Nutzlast', () => {
  const res = validateSubmission(gueltigeNutzlast());
  assert.equal(res.ok, true);
  assert.equal(res.value.sizeKey, '4x4x4');
  assert.equal(res.value.capacity, capacity('fassade', 4, 4, 4));
  assert.equal(res.value.undos, 3);
  assert.equal(res.value.taps, null);
  assert.equal(res.value.suspicion, 0, 'unauffaellige Nutzlast, kein Verdachtsbit');
});

test('3a. Verdachtsbits werden gesetzt, aber nie abgelehnt', () => {
  const wenig = validateSubmission(gueltigeNutzlast({ cubes: 10, moves: 12, timeMs: 60000 }));
  assert.equal(wenig.ok, true);
  assert.equal(wenig.value.suspicion & 1, 1, 'Bit 1: sehr wenige Wuerfel');
  const schnell = validateSubmission(gueltigeNutzlast({ moves: 25, timeMs: 2000 }));
  assert.equal(schnell.ok, true);
  assert.equal(schnell.value.suspicion & 2, 2, 'Bit 2: unter 200 ms je Zug');
  const perfekt = validateSubmission(gueltigeNutzlast({ cubes: 25, moves: 25 }));
  assert.equal(perfekt.ok, true);
  assert.equal(perfekt.value.suspicion & 4, 4, 'Bit 4: ABBAU mit moves === cubes');
  const undos = validateSubmission(gueltigeNutzlast({ undos: 200 }));
  assert.equal(undos.ok, true);
  assert.equal(undos.value.suspicion & 8, 8, 'Bit 8: sehr viele Undos');
});

test('3b. validateSubmission lehnt je Fehlerklasse ab', () => {
  const faelle = [
    ['fehlendes Feld', (p) => { delete p.name; }, 'validation', 'name'],
    ['fehlendes Feld', (p) => { delete p.runId; }, 'validation', 'runId'],
    ['falscher Typ', (p) => { p.moves = '25'; }, 'validation', 'moves'],
    ['falscher Typ', (p) => { p.size = '4x4x4'; }, 'validation', 'size'],
    ['moves < cubes bei ABBAU', (p) => { p.cubes = 20; p.moves = 19; }, 'implausible', 'moves'],
    ['moves ueber 40*cubes+500', (p) => { p.moves = 40 * 20 + 501; p.timeMs = 3600000; }, 'implausible', 'moves'],
    ['timeMs unter moves*60', (p) => { p.timeMs = 25 * 60 - 1; }, 'implausible', 'timeMs'],
    ['Groesse ausserhalb', (p) => { p.size = { x: 2, y: 4, z: 4 }; }, 'validation', 'size'],
    ['Hoehe ausserhalb', (p) => { p.size = { x: 4, y: 25, z: 4 }; }, 'validation', 'size'],
    ['kaputter levelCode', (p) => { p.levelCode = 'X-A-4x4x4-0-0008FA3C'; }, 'validation', 'levelCode'],
    ['levelCode passt nicht', (p) => { p.levelCode = 'V-A-4x4x4-0-0008FA3C'; }, 'implausible', 'levelCode'],
    ['falsche ruleVersion', (p) => { p.ruleVersion = RULE_VERSION + 1; }, 'version_mismatch', 'ruleVersion'],
    ['falsche genVersion', (p) => { p.genVersion = GEN_VERSION + 1; }, 'version_mismatch', 'genVersion'],
    ['cubes ueber Kapazitaet', (p) => { p.cubes = 53; p.moves = 60; }, 'implausible', 'cubes'],
    ['kaputte runId', (p) => { p.runId = 'nicht-uuid'; }, 'validation', 'runId'],
    ['taps kuerzer als moves', (p) => { p.taps = [1, 2, 3]; }, 'implausible', 'taps'],
    ['taps mit Unsinn', (p) => { p.taps = new Array(25).fill(0); p.taps[3] = -1; }, 'validation', 'taps'],
    ['appVersion kaputt', (p) => { p.appVersion = 'ganz sicher zu lang und falsch'; }, 'validation', 'appVersion']
  ];
  for (const [titel, verbiegen, error, field] of faelle) {
    const p = gueltigeNutzlast();
    verbiegen(p);
    const res = validateSubmission(p);
    assert.equal(res.ok, false, titel + ' muesste abgelehnt werden');
    assert.equal(res.error, error, titel);
    assert.equal(res.field, field, titel);
    assert.equal(res.status, 400, titel);
    assert.equal(typeof res.message, 'string');
    assert.ok(res.message.length > 0);
  }
});

test('3c. taps werden uebernommen, wenn sie zur Zugzahl passen', () => {
  const taps = new Array(30).fill(0).map((_, i) => i);
  const res = validateSubmission(gueltigeNutzlast({ taps }));
  assert.equal(res.ok, true);
  assert.equal(res.value.taps.length, 30);
  assert.equal(maxMoves(20), 1300);
  assert.equal(minTimeMs(25), 1500);
  assert.equal(minTimeMs(1), 300);
});

// --- 4. Namensfilter ------------------------------------------------------

test('4. normalizeName: Normalisierung, Filter und Blockliste', async () => {
  const ok = await normalizeName('  Anna  ', undefined);
  assert.deepEqual(ok, { ok: true, name: 'Anna', key: 'anna' });

  // NFKC: Breitzeichen werden zu ASCII gefaltet.
  const nfkc = await normalizeName('Ａnna', undefined);
  assert.equal(nfkc.ok, true);
  assert.equal(nfkc.name, 'Anna');

  // Zero-Width-Zeichen werden entfernt und tarnen keinen Blocklistentreffer.
  const zw = await normalizeName('ad​min', undefined);
  assert.equal(zw.ok, false);

  // Leet-Faltung
  const leet = await normalizeName('4dm1n', undefined);
  assert.equal(leet.ok, false);
  const leet2 = await normalizeName('$y5t3m', undefined);
  assert.equal(leet2.ok, false);

  // Blockliste direkt
  for (const wort of ['Admin', 'moderator', 'Cloudflare', 'Pfeilspiel', 'SYSTEM']) {
    const r = await normalizeName(wort, undefined);
    assert.equal(r.ok, false, wort);
  }

  // URL- und Mail-artige Namen
  for (const wort of ['www.pfeil.de', 'anna@post.it', 'http foo', 'shop.com']) {
    const r = await normalizeName(wort, undefined);
    assert.equal(r.ok, false, wort);
  }

  // Laengengrenzen
  assert.equal((await normalizeName('A', undefined)).ok, false);
  assert.equal((await normalizeName('a'.repeat(17), undefined)).ok, false);
  assert.equal((await normalizeName('a'.repeat(16), undefined)).ok, true);
  assert.equal((await normalizeName('  ', undefined)).ok, false);
  assert.equal((await normalizeName(42, undefined)).ok, false);

  // Umlaute erlaubt, Emoji abgelehnt
  const umlaut = await normalizeName('Jörg Öz', undefined);
  assert.equal(umlaut.ok, true);
  assert.equal(umlaut.name, 'Jörg Öz');
  assert.equal(umlaut.key, 'jörgöz');
  assert.equal((await normalizeName('Anna 😀', undefined)).ok, false);
  assert.equal((await normalizeName('Anna B', undefined)).ok, true);

  // Nur Sonderzeichen -> leerer Schluessel
  assert.equal((await normalizeName('..--', undefined)).ok, false);
});

test('4b. normalizeName liest die Blockliste aus D1 und cacht sie je Umgebung', async () => {
  let abfragen = 0;
  const env = {
    DB: {
      prepare() {
        return { all() { abfragen++; return Promise.resolve({ results: [{ pattern: 'testwort' }] }); } };
      }
    }
  };
  const a = await normalizeName('Testwort', env);
  assert.equal(a.ok, false);
  const b = await normalizeName('te5tw0rt', env);       // Leet-Faltung trifft dieselbe Regel
  assert.equal(b.ok, false);
  const c = await normalizeName('Anna', env);
  assert.equal(c.ok, true);
  assert.equal(abfragen, 1, 'die Blockliste wird nur einmal je Umgebung geladen');

  // Faellt D1 aus, greift die Notliste statt eines offenen Filters.
  const kaputt = { DB: { prepare() { return { all() { return Promise.reject(new Error('D1')); } }; } } };
  assert.equal((await normalizeName('admin', kaputt)).ok, false);
  assert.equal((await normalizeName('Berta', kaputt)).ok, true);
});

// --- 5. parseQuery --------------------------------------------------------

test('5. parseQuery liefert Vorgaben und uebernimmt gueltige Werte', () => {
  const leer = parseQuery(new URLSearchParams(''));
  assert.equal(leer.ok, true);
  assert.deepEqual(leer.query, {
    dir: null, goal: null, size: null, sizeDims: null, limit: 20, offset: 0, bestPerName: false
  });

  const voll = parseQuery(new URLSearchParams('dir=fassade&goal=abbau&size=5x7x5&limit=50&offset=100&bestPerName=1'));
  assert.equal(voll.ok, true);
  assert.equal(voll.query.dir, 'fassade');
  assert.equal(voll.query.goal, 'abbau');
  assert.equal(voll.query.size, '5x7x5');
  assert.deepEqual(voll.query.sizeDims, { x: 5, y: 7, z: 5 });
  assert.equal(voll.query.limit, 50);
  assert.equal(voll.query.offset, 100);
  assert.equal(voll.query.bestPerName, true);
});

test('5b. parseQuery lehnt ab, statt zu clampen', () => {
  const schlecht = [
    'sort=time',                 // unbekannter Parameter
    'dir=fassade&dir=volumen',   // doppelt
    'dir=Fassade',
    'goal=alles',
    'size=5-7-5',
    'size=2x7x5',                // Breite unter 3
    'size=5x99x5',
    'limit=0',
    'limit=101',
    'limit=20.0',
    'limit=-1',
    'offset=1001',
    'offset=x',
    'bestPerName=0',
    'bestPerName=true'
  ];
  for (const s of schlecht) {
    const res = parseQuery(new URLSearchParams(s));
    assert.equal(res.ok, false, s + ' muesste abgelehnt werden');
    assert.equal(res.error, 'validation', s);
    assert.equal(res.status, 400, s);
    assert.ok(res.message.length > 0, s);
  }
});

// --- 6. HTTP-Huelle -------------------------------------------------------

test('6. corsHeaders setzt immer Vary und echot nur gelistete Origins', () => {
  const req = new Request('https://pfeilspiel.example/api/records', {
    headers: { Origin: 'https://fremd.example' }
  });
  const ohne = corsHeaders(req, { ALLOWED_ORIGINS: '' });
  assert.equal(ohne.get('Vary'), 'Origin');
  assert.equal(ohne.get('Access-Control-Allow-Origin'), null);

  const mit = corsHeaders(req, { ALLOWED_ORIGINS: 'https://a.example, https://fremd.example' });
  assert.equal(mit.get('Access-Control-Allow-Origin'), 'https://fremd.example');
  assert.equal(mit.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(mit.get('Access-Control-Allow-Credentials'), null);

  const pf = preflight(new Request('https://pfeilspiel.example/api/records', { method: 'OPTIONS' }), { ALLOWED_ORIGINS: '' });
  assert.equal(pf.status, 204);
  assert.equal(pf.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(pf.headers.get('Vary'), 'Origin');
});

test('6b. json() antwortet ohne Zwischenspeicherung, sofern nichts anderes gesetzt wird', async () => {
  const req = new Request('https://pfeilspiel.example/api/records');
  const res = json({ ok: false, error: 'validation', message: 'Test' }, 400, req, {});
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.deepEqual(await res.json(), { ok: false, error: 'validation', message: 'Test' });

  const gecacht = json({ ok: true }, 200, req, {}, { 'Cache-Control': 'public, max-age=10' });
  assert.equal(gecacht.headers.get('Cache-Control'), 'public, max-age=10');
});

// --- 7. Rate-Limit ohne Netzwerk -----------------------------------------

/** Minimale D1-Nachbildung fuer die Upsert-Semantik aus §9.4. */
function fakeD1() {
  const tabelle = new Map();
  function fuehreAus(sql, args) {
    if (sql.indexOf('INSERT INTO rate_limit') === 0) {
      const [bucket, start, jetzt] = args;
      const alt = tabelle.get(bucket);
      const hits = alt && alt.window_start === start ? alt.hits + 1 : 1;
      tabelle.set(bucket, { window_start: start, hits, updated_at: jetzt });
      return { results: [{ hits, window_start: start }] };
    }
    if (sql.indexOf('DELETE FROM rate_limit') === 0) {
      for (const [k, v] of Array.from(tabelle)) if (v.updated_at < args[0]) tabelle.delete(k);
      return { results: [] };
    }
    throw new Error('unbekanntes SQL: ' + sql);
  }
  return {
    tabelle,
    prepare(sql) {
      return { bind: (...args) => ({ sql, args }) };
    },
    batch(stmts) {
      return Promise.resolve(stmts.map((s) => fuehreAus(s.sql, s.args)));
    }
  };
}

test('7. checkRateLimit sperrt nach dem fuenften POST je Minute', async () => {
  const env = { DB: fakeD1(), IP_SALT: 'test-salt' };
  const ip = 'aabbccdd00112233';
  for (let i = 0; i < FENSTER[0].limit; i++) {
    const r = await checkRateLimit(env, ip);
    assert.equal(r.ok, true, 'POST ' + (i + 1));
  }
  const zuviel = await checkRateLimit(env, ip);
  assert.equal(zuviel.ok, false);
  assert.ok(zuviel.retryAfterSec >= 1 && zuviel.retryAfterSec <= 60, 'Retry-After im Minutenfenster');

  // Eine andere IP ist davon unberuehrt.
  assert.equal((await checkRateLimit(env, 'ffffffff00000000')).ok, true);
});

test('7b. hashText und ipPraefix speichern nie die Roh-IP', async () => {
  assert.equal(ipPraefix('203.0.113.7'), '203.0.113.7');
  assert.equal(ipPraefix('2001:db8:1234:5678:9abc:def0:1111:2222'), '2001:db8:1234:5678::/64');
  assert.equal(ipPraefix('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipPraefix(''), 'unbekannt');

  const env = { IP_SALT: 'geheim' };
  const a = await hashText(ipPraefix('203.0.113.7'), env, 16);
  const b = await hashText(ipPraefix('203.0.113.8'), env, 16);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.notEqual(a, b);
  assert.equal(a, await hashText('203.0.113.7', env, 16));
  assert.notEqual(a, await hashText('203.0.113.7', { IP_SALT: 'anders' }, 16));
  await assert.rejects(() => hashText('203.0.113.7', {}, 16), /IP_SALT/);
});

// --- 8. Anti-Cheat-Pfad des Workers --------------------------------------

test('8. Der Worker regeneriert das Level aus dem Levelcode und prueft mit replayTaps', () => {
  const level = generateForLevelNo(3);
  const wieder = generateFromCode(level.levelCode);
  assert.deepEqual(wieder.cubes, level.cubes);
  assert.deepEqual(wieder.witness, level.witness);

  const echt = replayTaps(wieder, level.witness);
  assert.equal(echt.ok, true);
  assert.equal(echt.solved, true);
  assert.equal(echt.moves, level.witness.length);
  assert.equal(echt.timeLowerMs, Math.max(300, echt.moves * 60));

  // Gekuerzte Zugliste: der Anti-Cheat-Pfad erkennt sie.
  const gekuerzt = replayTaps(wieder, level.witness.slice(0, level.witness.length - 1));
  assert.equal(gekuerzt.solved, false);
});
