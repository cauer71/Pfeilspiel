// Namensfilter der Bestenliste (SPEC §9.4). Ein abgelehnter Name blockiert die Einreichung,
// er wird niemals still umbenannt.

// Steuerzeichen, Zero-Width-Zeichen, weiche Trennzeichen und Bidi-Overrides.
const STEUERZEICHEN = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/gu;
const ERLAUBT = /^[\p{L}\p{N} _.\-]+$/u;
const NICHT_ALNUM = /[^\p{L}\p{N}]/gu;

const LEET = { '4': 'a', '3': 'e', '1': 'i', '0': 'o', '5': 's', '7': 't', '$': 's', '@': 'a' };

const URL_SCHEMA = /(^|[^\p{L}\p{N}])(www|https?|ftp)([^\p{L}\p{N}]|$)/iu;
const URL_TLD = /\.(com|net|org|de|at|ch|io|co|uk|ru|xyz|info|shop|app|dev|me|tv|eu|it|fr|es|nl|pl|se|no|dk|fi|cz|link|online|site|club|top)($|[^\p{L}\p{N}])/iu;

/** Notliste, falls D1 keine Blockliste liefert. Entspricht dem Saatgut aus 0001_init.sql. */
const NOTLISTE = ['admin', 'moderator', 'cloudflare', 'pfeilspiel', 'system'];

const CACHE_MS = 5 * 60 * 1000;
const cacheProEnv = new WeakMap();
let cacheOhneEnv = null;

/** Faltet eine Zeichenkette auf den Vergleichsschluessel (klein, Leet, nur alphanumerisch). */
function faltung(text) {
  const s = text.normalize('NFKC').toLowerCase();
  let g = '';
  for (const ch of s) g += Object.prototype.hasOwnProperty.call(LEET, ch) ? LEET[ch] : ch;
  return g.replace(NICHT_ALNUM, '');
}

/**
 * Blockliste aus D1, im Isolate fuenf Minuten gecacht.
 * @param {any} env @returns {Promise<string[]>}
 */
async function blockliste(env) {
  const jetzt = Date.now();
  const alt = env && typeof env === 'object' ? cacheProEnv.get(env) : cacheOhneEnv;
  if (alt && jetzt - alt.at < CACHE_MS) return alt.list;

  let liste = NOTLISTE;
  try {
    if (env && env.DB && typeof env.DB.prepare === 'function') {
      const res = await env.DB.prepare('SELECT pattern FROM name_blocklist').all();
      const zeilen = res && Array.isArray(res.results) ? res.results : [];
      const gefaltet = zeilen
        .map((r) => faltung(String(r && r.pattern !== undefined ? r.pattern : '')))
        .filter((p) => p.length > 0);
      if (gefaltet.length > 0) liste = gefaltet;
    }
  } catch {
    liste = NOTLISTE;
  }
  const eintrag = { at: jetzt, list: liste };
  if (env && typeof env === 'object') cacheProEnv.set(env, eintrag); else cacheOhneEnv = eintrag;
  return liste;
}

/**
 * Normalisiert und prueft einen Spielernamen.
 * @param {string} raw @param {any} env
 * @returns {Promise<{ok:true, name:string, key:string} | {ok:false, message:string}>}
 */
export async function normalizeName(raw, env) {
  if (typeof raw !== 'string') return { ok: false, message: 'Bitte einen Namen eingeben.' };

  let name = raw.normalize('NFKC').replace(STEUERZEICHEN, '');
  name = name.replace(/\s+/gu, ' ').trim();

  if (name.length === 0) return { ok: false, message: 'Bitte einen Namen eingeben.' };
  if (!ERLAUBT.test(name)) {
    return { ok: false, message: 'Im Namen sind nur Buchstaben, Ziffern, Leerzeichen, Punkt, Bindestrich und Unterstrich erlaubt.' };
  }

  const laenge = Array.from(name).length;
  if (laenge < 2) return { ok: false, message: 'Der Name muss mindestens 2 Zeichen haben.' };
  if (laenge > 16) return { ok: false, message: 'Der Name darf hoechstens 16 Zeichen haben.' };

  const key = faltung(name);
  if (key.length === 0) return { ok: false, message: 'Dieser Name besteht nur aus Sonderzeichen.' };

  if (name.indexOf('@') !== -1 || URL_SCHEMA.test(name) || URL_TLD.test(name))
    return { ok: false, message: 'Adressen und Links sind als Name nicht erlaubt.' };

  const liste = await blockliste(env);
  for (const muster of liste) {
    if (muster.length > 0 && key.indexOf(muster) !== -1)
      return { ok: false, message: 'Dieser Name ist nicht erlaubt.' };
  }

  return { ok: true, name, key };
}
