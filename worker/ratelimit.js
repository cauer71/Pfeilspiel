// Rate-Limit und IP-Hashing, ausschliesslich mit D1-Bordmitteln (SPEC §9.4).
// Die Roh-IP wird niemals gespeichert; es geht nur ein gesalzener HMAC-Praefix in die Datenbank.

/** Fenster in der Reihenfolge eng -> weit. Retry-After stammt vom engsten verletzten Fenster. */
export const FENSTER = Object.freeze([
  { suffix: ':m', ms: 60 * 1000, limit: 5 },
  { suffix: ':h', ms: 60 * 60 * 1000, limit: 30 },
  { suffix: ':d', ms: 24 * 60 * 60 * 1000, limit: 120 }
]);
export const GLOBAL_FENSTER = Object.freeze({ bucket: 'global:m', ms: 60 * 1000, limit: 600 });

export const GC_ALTER_MS = 25 * 60 * 60 * 1000;
export const GC_WAHRSCHEINLICHKEIT = 0.02;

const UPSERT = `INSERT INTO rate_limit (bucket, window_start, hits, updated_at)
VALUES (?1, ?2, 1, ?3)
ON CONFLICT(bucket) DO UPDATE SET
  hits = CASE WHEN rate_limit.window_start = excluded.window_start
              THEN rate_limit.hits + 1 ELSE 1 END,
  window_start = excluded.window_start,
  updated_at   = excluded.updated_at
RETURNING hits, window_start`;

const HEX = '0123456789abcdef';

function zuHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return s;
}

/**
 * HMAC-SHA-256 ueber `text` mit `env.IP_SALT`, auf `hexLen` Hexzeichen gekuerzt.
 * Fehlt das Geheimnis, wird geworfen — es gibt keinen stillen Ersatzsalt.
 * @param {string} text @param {any} env @param {number} [hexLen]
 * @returns {Promise<string>}
 */
export async function hashText(text, env, hexLen = 16) {
  const salt = env && typeof env.IP_SALT === 'string' ? env.IP_SALT : '';
  if (salt.length === 0) throw new Error('IP_SALT fehlt');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(text)));
  return zuHex(sig).slice(0, hexLen);
}

/** Kuerzt IPv6 auf /64, laesst IPv4 unveraendert. */
export function ipPraefix(ip) {
  const roh = typeof ip === 'string' ? ip.trim() : '';
  if (roh.length === 0) return 'unbekannt';
  if (roh.indexOf(':') === -1) return roh;                 // IPv4
  const teile = roh.split('::');
  let gruppen;
  if (teile.length > 1) {
    const links = teile[0] ? teile[0].split(':') : [];
    const rechts = teile[1] ? teile[1].split(':') : [];
    const luecke = Math.max(0, 8 - links.length - rechts.length);
    gruppen = links.concat(new Array(luecke).fill('0'), rechts);
  } else {
    gruppen = roh.split(':');
  }
  const vier = gruppen.slice(0, 4).map((g) => (g === '' ? '0' : g.toLowerCase()));
  while (vier.length < 4) vier.push('0');
  return vier.join(':') + '::/64';
}

/**
 * Gesalzener Hash der anfragenden IP (16 Hexzeichen).
 * @param {Request} request @param {any} env @returns {Promise<string>}
 */
export async function hashIp(request, env) {
  const roh = request && request.headers ? request.headers.get('CF-Connecting-IP') : null;
  return hashText(ipPraefix(roh || ''), env, 16);
}

/**
 * Zaehlt den POST in vier Fenstern hoch und meldet, ob eines ueberschritten ist.
 * Der Zaehler laeuft VOR der Validierung und wird auch von abgelehnten POSTs verbraucht.
 * @param {any} env @param {string} ipHash
 * @returns {Promise<{ok:true, degraded?:boolean}|{ok:false, retryAfterSec:number}>}
 */
export async function checkRateLimit(env, ipHash) {
  const jetzt = Date.now();
  const eimer = FENSTER.map((f) => ({
    bucket: ipHash + f.suffix, ms: f.ms, limit: f.limit
  }));
  eimer.push({ bucket: GLOBAL_FENSTER.bucket, ms: GLOBAL_FENSTER.ms, limit: GLOBAL_FENSTER.limit });

  let ergebnisse;
  try {
    ergebnisse = await env.DB.batch(eimer.map((e) => {
      const start = Math.floor(jetzt / e.ms) * e.ms;
      return env.DB.prepare(UPSERT).bind(e.bucket, start, jetzt);
    }));
  } catch (err) {
    // Ein Fehler der Zaehlertabelle darf die Bestenliste nicht lahmlegen; ein echter
    // D1-Ausfall faellt spaetestens beim INSERT des Datensatzes als 500 auf.
    console.error('rate_limit', err && err.message);
    return { ok: true, degraded: true };
  }

  for (let i = 0; i < eimer.length; i++) {
    const e = eimer[i];
    const res = ergebnisse[i];
    const zeile = res && Array.isArray(res.results) && res.results.length > 0 ? res.results[0] : null;
    const hits = zeile ? Number(zeile.hits) : 0;
    const start = zeile ? Number(zeile.window_start) : Math.floor(jetzt / e.ms) * e.ms;
    if (hits > e.limit) {
      const rest = Math.ceil((start + e.ms - jetzt) / 1000);
      return { ok: false, retryAfterSec: Math.max(1, rest) };
    }
  }
  return { ok: true };
}

/**
 * Muellabfuhr der Zaehlertabelle. Wird mit kleiner Wahrscheinlichkeit in ctx.waitUntil gehaengt.
 * @param {any} env @returns {Promise<any>}
 */
export function gcRateLimit(env) {
  const grenze = Date.now() - GC_ALTER_MS;
  return env.DB.prepare('DELETE FROM rate_limit WHERE updated_at < ?1').bind(grenze).run();
}
