// SPEC §10.6 — Bestenlisten-Client public/src/api.js.
// Kein Netzwerk: fetch, navigator und localStorage sind Attrappen dieser Datei.
// Kernzusage des Moduls: es wirft NIE. Jeder Fehler verlaesst es als
// {ok:false, error, message} mit deutschem Klartext.

import test from 'node:test';
import assert from 'node:assert/strict';

import { getScores, postScore, newUuid, clientId } from '../public/src/api.js';

const ECHTES_FETCH = globalThis.fetch;
const NAV_BESCHREIBUNG = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const CRYPTO_BESCHREIBUNG = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// --- Attrappen -------------------------------------------------------------

/**
 * Setzt eine fetch-Attrappe, ruft `fn(aufrufe)` und raeumt danach auf.
 * @param {(url:any, opts:any, nr:number) => any} stub
 * @param {(aufrufe:{url:string, opts:any}[]) => Promise<any>} fn
 */
async function mitFetch(stub, fn) {
  const aufrufe = [];
  globalThis.fetch = (url, opts) => {
    aufrufe.push({ url: String(url), opts });
    return stub(url, opts, aufrufe.length);
  };
  try {
    return await fn(aufrufe);
  } finally {
    globalThis.fetch = ECHTES_FETCH;
  }
}

function jsonAntwort(body, status, kopf) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status: status === undefined ? 200 : status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, kopf || {})
  });
}

/** navigator.onLine voruebergehend setzen. */
async function mitNavigator(wert, fn) {
  Object.defineProperty(globalThis, 'navigator', { value: wert, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (NAV_BESCHREIBUNG) Object.defineProperty(globalThis, 'navigator', NAV_BESCHREIBUNG);
    else delete globalThis.navigator;
  }
}

/** localStorage-Attrappe; `modus` steuert Lesen und Schreiben. */
function macheStorage(modus, anfangswert) {
  const daten = new Map();
  if (anfangswert !== undefined) daten.set('pfeilspiel.clientId', anfangswert);
  const log = [];
  return {
    log, daten,
    getItem(k) {
      log.push(['get', k]);
      if (modus === 'wirft' || modus === 'wirft-lesen') throw new Error('SecurityError');
      return daten.has(k) ? daten.get(k) : null;
    },
    setItem(k, v) {
      log.push(['set', k, v]);
      if (modus === 'wirft' || modus === 'wirft-schreiben') throw new Error('QuotaExceededError');
      daten.set(k, v);
    }
  };
}

let importZaehler = 0;
/** Laedt api.js als frische Modulinstanz (der clientId-Zwischenspeicher ist modullokal). */
function frischesModul() {
  importZaehler += 1;
  return import('../public/src/api.js?fall=' + importZaehler);
}

/**
 * Laesst lange Zeitlimits (>= 1 s) sofort ablaufen, damit der Zeitlimit-Pfad
 * ohne acht Sekunden Wartezeit geprueft werden kann.
 */
async function mitKurzemZeitlimit(fn) {
  const echt = globalThis.setTimeout;
  globalThis.setTimeout = (cb, ms, ...rest) => echt(cb, ms >= 1000 ? 0 : ms, ...rest);
  try {
    return await fn();
  } finally {
    globalThis.setTimeout = echt;
  }
}

function gueltigerLauf(aenderungen) {
  return Object.assign({
    name: 'Anna', dirMode: 'fassade', goalMode: 'abbau',
    size: { x: 5, y: 7, z: 5 }, cubes: 121, moves: 121, undos: 3, timeMs: 73210,
    seed: 589116, levelCode: 'F-A-5x7x5-0-0008FA3C', ruleVersion: 1, genVersion: 1,
    runId: '3f6d1c2a-9b41-4a77-8a0e-1d5b7c9e2f04',
    clientId: '7c2e5b18-0d33-4f9a-9c11-a2b3c4d5e6f7', appVersion: '1.0.0'
  }, aenderungen || {});
}

/** Jede Antwort des Moduls hat entweder ok:true oder eine vollstaendige Fehlerhuelle. */
function pruefeHuelle(r) {
  assert.equal(typeof r, 'object');
  assert.notEqual(r, null);
  if (r.ok === true) return;
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(typeof r.error, 'string');
  assert.ok(r.error.length > 0);
  assert.equal(typeof r.message, 'string');
  assert.ok(r.message.trim().length > 0, 'deutscher Klartext vorhanden');
  if (r.retryAfterSec !== undefined) assert.ok(Number.isInteger(r.retryAfterSec));
}

// --- 1. GET ----------------------------------------------------------------

test('1. getScores baut die Abfrage in fester Reihenfolge', async () => {
  await mitFetch(() => jsonAntwort({ ok: true, total: 0, records: [] }), async (aufrufe) => {
    await getScores();
    assert.equal(aufrufe[0].url, '/api/records');

    await getScores({});
    assert.equal(aufrufe[1].url, '/api/records');

    await getScores({
      bestPerName: true, offset: 5, limit: 10,
      size: { x: 5, y: 7, z: 5 }, goal: 'ABBAU', dir: '  Fassade  '
    });
    assert.equal(aufrufe[2].url,
      '/api/records?dir=fassade&goal=abbau&size=5x7x5&limit=10&offset=5&bestPerName=1');

    await getScores({ size: '5X7X5', limit: '12.9', offset: -0.4, bestPerName: '1' });
    assert.equal(aufrufe[3].url, '/api/records?size=5x7x5&limit=12&offset=0&bestPerName=1');

    await getScores({ dir: '', goal: '   ', size: null, limit: 'viele', bestPerName: false });
    assert.equal(aufrufe[4].url, '/api/records');
  });
});

test('2. getScores schickt GET ohne Zugangsdaten und mit Accept-Kopf', async () => {
  await mitFetch(() => jsonAntwort({ ok: true, total: 3, records: [] }), async (aufrufe) => {
    const r = await getScores();
    assert.deepEqual(r, { ok: true, total: 3, records: [] });
    const o = aufrufe[0].opts;
    assert.equal(o.method, 'GET');
    assert.equal(o.credentials, 'omit');
    assert.equal(o.redirect, 'follow');
    assert.equal(o.headers.Accept, 'application/json');
  });
});

test('3. getScores reicht Datensaetze und total durch', async () => {
  const zeile = {
    rank: 1, id: 4711, name: 'Anna', dirMode: 'fassade', goalMode: 'abbau',
    size: { x: 5, y: 7, z: 5 }, sizeKey: '5x7x5', cubes: 121, moves: 121,
    undos: 3, timeMs: 73210, verified: true, createdAt: '2026-08-30T18:22:41.000Z'
  };
  await mitFetch(() => jsonAntwort({ ok: true, total: 137, records: [zeile] }), async () => {
    const r = await getScores({ limit: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.total, 137);
    assert.deepEqual(r.records, [zeile]);
  });
  // Fehlt total, zaehlt die Liste selbst.
  await mitFetch(() => jsonAntwort({ ok: true, records: [zeile, zeile] }), async () => {
    const r = await getScores();
    assert.equal(r.total, 2);
  });
});

// --- 4. Fehlerabbildung ----------------------------------------------------

test('4. der Fehlercode des Servers gewinnt vor dem HTTP-Status', async () => {
  await mitFetch(() => jsonAntwort(
    { ok: false, error: 'implausible', field: 'moves', message: 'Mit so wenigen Zuegen geht das nicht.' },
    400), async () => {
    const r = await getScores();
    pruefeHuelle(r);
    assert.equal(r.error, 'implausible');
    assert.equal(r.field, 'moves');
    assert.equal(r.message, 'Mit so wenigen Zuegen geht das nicht.');
  });
});

test('5. ohne Fehlercode im Rumpf entscheidet der HTTP-Status', async () => {
  const faelle = [
    [400, 'validation'], [404, 'not_found'], [405, 'method_not_allowed'],
    [413, 'payload_too_large'], [429, 'rate_limited'],
    [500, 'server_error'], [502, 'server_error'], [503, 'server_error'],
    [418, 'bad_response'], [451, 'bad_response']
  ];
  for (const [status, code] of faelle) {
    await mitFetch(() => new Response('<html>Fehler</html>', { status }), async () => {
      const r = await getScores();
      pruefeHuelle(r);
      assert.equal(r.error, code, 'HTTP ' + status);
      assert.ok(r.message.length > 10, 'Ersatztext gesetzt fuer ' + status);
    });
  }
});

test('6. ein Rumpf mit ok:false ist auch bei HTTP 200 ein Fehler', async () => {
  await mitFetch(() => jsonAntwort({ ok: false, error: 'name_rejected', field: 'name' }, 200), async () => {
    const r = await getScores();
    pruefeHuelle(r);
    assert.equal(r.error, 'name_rejected');
    assert.equal(r.field, 'name');
    assert.match(r.message, /Name/);            // Ersatztext aus FEHLERTEXTE
  });
});

test('7. retryAfterSec: Rumpf schlaegt Kopfzeile, sonst greift die Kopfzeile', async () => {
  await mitFetch(() => jsonAntwort({ ok: false, error: 'rate_limited', retryAfterSec: 12 }, 429,
    { 'Retry-After': '30' }), async () => {
    const r = await getScores();
    assert.equal(r.retryAfterSec, 12);
  });
  await mitFetch(() => jsonAntwort({ ok: false, error: 'rate_limited' }, 429,
    { 'Retry-After': '45' }), async () => {
    const r = await getScores();
    assert.equal(r.retryAfterSec, 45);
  });
  await mitFetch(() => jsonAntwort({ ok: false, error: 'rate_limited', retryAfterSec: 12.6 }, 429), async () => {
    const r = await getScores();
    assert.equal(r.retryAfterSec, 13);
  });
  await mitFetch(() => jsonAntwort({ ok: false, error: 'rate_limited' }, 429,
    { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }), async () => {
    const r = await getScores();
    assert.equal(r.retryAfterSec, undefined, 'ein Datum ist keine Sekundenzahl');
  });
  await mitFetch(() => jsonAntwort({ ok: false, error: 'rate_limited' }, 429), async () => {
    const r = await getScores();
    assert.equal(r.retryAfterSec, undefined);
    pruefeHuelle(r);
  });
});

test('8. unlesbare Antworten werden zu bad_response, nicht zu einer Ausnahme', async () => {
  const faelle = [
    () => new Response('kein json', { status: 200 }),
    () => jsonAntwort([1, 2, 3], 200),
    () => jsonAntwort('"nur ein string"', 200),
    () => jsonAntwort({ ok: true, total: 1 }, 200),          // records fehlt
    () => jsonAntwort({ ok: true, records: 'keine liste' }, 200),
    () => new Response('', { status: 200 })
  ];
  for (let i = 0; i < faelle.length; i++) {
    await mitFetch(faelle[i], async () => {
      const r = await getScores();
      pruefeHuelle(r);
      assert.equal(r.ok, false, 'Fall ' + i);
      assert.equal(r.error, 'bad_response', 'Fall ' + i);
    });
  }
});

test('9. ein Netzfehler wird zu network, ein synchroner Wurf ebenso', async () => {
  await mitFetch(() => Promise.reject(new TypeError('Failed to fetch')), async () => {
    const r = await getScores();
    pruefeHuelle(r);
    assert.equal(r.error, 'network');
  });
  await mitFetch(() => { throw new TypeError('sofortiger Wurf'); }, async () => {
    const r = await getScores();
    pruefeHuelle(r);
    assert.equal(r.error, 'network');
  });
  // Auch ein Wurf beim Lesen des Rumpfs darf nicht nach aussen dringen.
  await mitFetch(() => ({
    ok: true, status: 200,
    headers: new Headers(),
    text() { return Promise.reject(new Error('Verbindung abgebrochen')); }
  }), async () => {
    const r = await getScores();
    pruefeHuelle(r);
    assert.equal(r.error, 'network');
  });
});

test('10. das Zeitlimit greift und wird als timeout gemeldet', async () => {
  await mitKurzemZeitlimit(async () => {
    await mitFetch((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => {
        const e = new Error('Die Anfrage wurde abgebrochen.');
        e.name = 'AbortError';
        reject(e);
      });
    }), async () => {
      const r = await getScores();
      pruefeHuelle(r);
      assert.equal(r.error, 'timeout');
      assert.match(r.message, /rechtzeitig/);

      const p = await postScore(gueltigerLauf());
      pruefeHuelle(p);
      assert.equal(p.error, 'timeout');
    });
  });
});

test('11. ein Abbruch ohne Zeitlimit wird als aborted gemeldet', async () => {
  await mitFetch(() => {
    const e = new Error('abgebrochen');
    e.name = 'AbortError';
    return Promise.reject(e);
  }, async () => {
    const r = await getScores();
    pruefeHuelle(r);
    assert.equal(r.error, 'aborted');
  });
});

test('12. offline meldet sich ohne einen einzigen fetch-Aufruf', async () => {
  await mitNavigator({ onLine: false }, async () => {
    await mitFetch(() => { throw new Error('haette nicht gerufen werden duerfen'); }, async (aufrufe) => {
      const g = await getScores();
      pruefeHuelle(g);
      assert.equal(g.error, 'offline');
      const p = await postScore(gueltigerLauf());
      pruefeHuelle(p);
      assert.equal(p.error, 'offline');
      assert.equal(aufrufe.length, 0);
    });
  });
  // onLine true oder fehlend heisst nicht offline.
  await mitNavigator({ onLine: true }, async () => {
    await mitFetch(() => jsonAntwort({ ok: true, total: 0, records: [] }), async (aufrufe) => {
      assert.equal((await getScores()).ok, true);
      assert.equal(aufrufe.length, 1);
    });
  });
});

test('13. ohne fetch meldet das Modul unsupported statt zu werfen', async () => {
  delete globalThis.fetch;
  try {
    const g = await getScores();
    pruefeHuelle(g);
    assert.equal(g.error, 'unsupported');
    const p = await postScore(gueltigerLauf());
    pruefeHuelle(p);
    assert.equal(p.error, 'unsupported');
  } finally {
    globalThis.fetch = ECHTES_FETCH;
  }
});

// --- 14. POST --------------------------------------------------------------

test('14. postScore sendet nur die erlaubten Felder', async () => {
  await mitFetch(() => jsonAntwort({ ok: true, id: 1, rank: 1, total: 1, duplicate: false, verified: true }),
    async (aufrufe) => {
      await postScore(gueltigerLauf({
        status: 'hidden', ipHash: 'geheim', verified: true, rank: 1,
        undos: null, seed: undefined,
        taps: [3, -1, 2.5, 7, '4', null, 0],
        size: { x: 5, y: 7, z: 5, w: 9 }
      }));
      const o = aufrufe[0].opts;
      assert.equal(aufrufe[0].url, '/api/records');
      assert.equal(o.method, 'POST');
      assert.equal(o.headers['Content-Type'], 'application/json');
      assert.equal(o.credentials, 'omit');

      const gesendet = JSON.parse(o.body);
      assert.deepEqual(Object.keys(gesendet).sort(), [
        'appVersion', 'clientId', 'cubes', 'dirMode', 'genVersion', 'goalMode',
        'levelCode', 'moves', 'name', 'ruleVersion', 'runId', 'size', 'taps', 'timeMs'
      ]);
      assert.equal(gesendet.status, undefined);
      assert.equal(gesendet.ipHash, undefined);
      assert.equal(gesendet.undos, undefined, 'null wird weggelassen, nicht als null gesendet');
      assert.deepEqual(gesendet.taps, [3, 7, 0], 'nur nichtnegative ganze Zahlen bleiben');
      assert.deepEqual(gesendet.size, { x: 5, y: 7, z: 5 });
    });
});

test('15. postScore normalisiert die Antwort', async () => {
  await mitFetch(() => jsonAntwort(
    { ok: true, id: 4711, rank: 3, total: 138, duplicate: true, verified: true }, 200), async () => {
    const r = await postScore(gueltigerLauf());
    assert.deepEqual(r, { ok: true, id: 4711, rank: 3, total: 138, duplicate: true, verified: true });
  });
  await mitFetch(() => jsonAntwort({ ok: true, id: 12, rank: 1 }, 201), async () => {
    const r = await postScore(gueltigerLauf());
    assert.deepEqual(r, { ok: true, id: 12, rank: 1, total: 0, duplicate: false, verified: false });
  });
  await mitFetch(() => jsonAntwort({ ok: true, id: 'vier', rank: 1 }, 201), async () => {
    const r = await postScore(gueltigerLauf());
    pruefeHuelle(r);
    assert.equal(r.error, 'bad_response');
  });
});

test('16. ein zu grosser Lauf verliert erst die taps, dann die Uebertragung', async () => {
  const vieleTaps = [];
  for (let i = 0; i < 3000; i++) vieleTaps.push(100000 + i);

  await mitFetch(() => jsonAntwort({ ok: true, id: 1, rank: 1, total: 1, duplicate: false, verified: false }),
    async (aufrufe) => {
      const r = await postScore(gueltigerLauf({ taps: vieleTaps }));
      assert.equal(r.ok, true);
      assert.equal(r.verified, false);
      const gesendet = JSON.parse(aufrufe[0].opts.body);
      assert.equal(gesendet.taps, undefined, 'die Tippfolge wird geopfert, nicht der Eintrag');
      assert.ok(aufrufe[0].opts.body.length <= 8192);
    });

  // Auch ohne taps zu gross: gar nicht erst senden.
  await mitFetch(() => { throw new Error('haette nicht gesendet werden duerfen'); }, async (aufrufe) => {
    const r = await postScore(gueltigerLauf({ name: 'x'.repeat(9000) }));
    pruefeHuelle(r);
    assert.equal(r.error, 'payload_too_large');
    assert.equal(aufrufe.length, 0);
  });
});

test('17. ein nicht serialisierbarer Lauf endet als Fehlerhuelle', async () => {
  const zirkulaer = { tief: null };
  zirkulaer.tief = zirkulaer;
  await mitFetch(() => { throw new Error('haette nicht gesendet werden duerfen'); }, async (aufrufe) => {
    const r = await postScore(gueltigerLauf({ name: zirkulaer }));
    pruefeHuelle(r);
    assert.equal(r.error, 'validation');
    assert.equal(aufrufe.length, 0);
  });
});

test('18. postScore ohne Argument liefert eine Huelle statt einer Ausnahme', async () => {
  await mitFetch(() => jsonAntwort({ ok: false, error: 'validation', field: 'name', message: 'Pflichtfeld fehlt: name' }, 400),
    async () => {
      for (const arg of [undefined, null, 42, 'text', []]) {
        const r = await postScore(arg);
        pruefeHuelle(r);
        assert.equal(r.ok, false);
        assert.equal(r.error, 'validation');
      }
    });
});

// --- 19. newUuid -----------------------------------------------------------

test('19. newUuid liefert gueltige v4-Kennungen, auch ohne crypto', async () => {
  const gesehen = new Set();
  for (let i = 0; i < 200; i++) {
    const id = newUuid();
    assert.match(id, UUID_RE, id);
    gesehen.add(id);
  }
  assert.equal(gesehen.size, 200, 'keine Wiederholungen');

  // Ohne randomUUID, nur mit getRandomValues.
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 0xff; return a; } },
    configurable: true, writable: true
  });
  try {
    assert.match(newUuid(), UUID_RE);
  } finally {
    Object.defineProperty(globalThis, 'crypto', CRYPTO_BESCHREIBUNG);
  }

  // Ganz ohne crypto.
  delete globalThis.crypto;
  try {
    const ids = [newUuid(), newUuid(), newUuid()];
    for (const id of ids) assert.match(id, UUID_RE, id);
    assert.equal(new Set(ids).size, 3);
  } finally {
    Object.defineProperty(globalThis, 'crypto', CRYPTO_BESCHREIBUNG);
  }

  // Ein kaputtes randomUUID darf nicht nach aussen wirken.
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID() { throw new Error('blockiert'); } },
    configurable: true, writable: true
  });
  try {
    assert.match(newUuid(), UUID_RE);
  } finally {
    Object.defineProperty(globalThis, 'crypto', CRYPTO_BESCHREIBUNG);
  }
});

// --- 20. clientId ----------------------------------------------------------

test('20. clientId liest eine gespeicherte Kennung und schreibt nicht neu', async () => {
  const s = macheStorage('ok', '7C2E5B18-0D33-4F9A-9C11-A2B3C4D5E6F7');
  globalThis.localStorage = s;
  try {
    const m = await frischesModul();
    const id = m.clientId();
    assert.equal(id, '7c2e5b18-0d33-4f9a-9c11-a2b3c4d5e6f7');
    assert.equal(m.clientId(), id, 'zweiter Aufruf ist stabil');
    assert.equal(s.log.filter((e) => e[0] === 'set').length, 0, 'nichts neu geschrieben');
    assert.equal(s.log.filter((e) => e[0] === 'get').length, 1, 'nur einmal gelesen');
  } finally {
    delete globalThis.localStorage;
  }
});

test('21. clientId legt eine neue Kennung an und speichert sie', async () => {
  const s = macheStorage('ok');
  globalThis.localStorage = s;
  try {
    const m = await frischesModul();
    const id = m.clientId();
    assert.match(id, UUID_RE);
    assert.deepEqual(s.log.filter((e) => e[0] === 'set'), [['set', 'pfeilspiel.clientId', id]]);
    assert.equal(s.daten.get('pfeilspiel.clientId'), id);
  } finally {
    delete globalThis.localStorage;
  }
});

test('22. eine unbrauchbare gespeicherte Kennung wird ersetzt', async () => {
  const s = macheStorage('ok', 'kaputt-kein-uuid');
  globalThis.localStorage = s;
  try {
    const m = await frischesModul();
    const id = m.clientId();
    assert.match(id, UUID_RE);
    assert.equal(s.daten.get('pfeilspiel.clientId'), id);
  } finally {
    delete globalThis.localStorage;
  }
});

test('23. im Privatmodus bleibt die Kennung sitzungslokal statt zu werfen', async () => {
  const s = macheStorage('wirft');
  globalThis.localStorage = s;
  try {
    const m = await frischesModul();
    const id = m.clientId();
    assert.match(id, UUID_RE);
    assert.equal(m.clientId(), id, 'innerhalb der Sitzung stabil');
    assert.equal(m.clientId(), id);
  } finally {
    delete globalThis.localStorage;
  }
});

test('24. ganz ohne localStorage arbeitet clientId weiter', async () => {
  delete globalThis.localStorage;
  const m1 = await frischesModul();
  const a = m1.clientId();
  assert.match(a, UUID_RE);
  assert.equal(m1.clientId(), a);

  const m2 = await frischesModul();
  const b = m2.clientId();
  assert.match(b, UUID_RE);
  assert.notEqual(b, a, 'ohne Speicher ist jede Sitzung eine neue Kennung');

  // Der Standardexport dieser Datei bleibt unabhaengig davon benutzbar.
  assert.match(clientId(), UUID_RE);
});

test('25. ein localStorage, das nur beim Schreiben wirft, liefert trotzdem eine Kennung', async () => {
  const s = macheStorage('wirft-schreiben');
  globalThis.localStorage = s;
  try {
    const m = await frischesModul();
    const id = m.clientId();
    assert.match(id, UUID_RE);
    assert.equal(m.clientId(), id);
  } finally {
    delete globalThis.localStorage;
  }
});
