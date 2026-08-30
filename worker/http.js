// HTTP-Huelle des Workers: CORS, Preflight, JSON-Antworten (SPEC §9.5, §9.7).
// Normalfall ist Same-Origin ohne CORS; nur exakt gelistete Origins werden zurueckgeechot,
// niemals '*' und niemals Allow-Credentials.

const CORS_METHODS = 'GET, POST, OPTIONS';
const CORS_REQ_HEADERS = 'Content-Type';

/** @param {any} env @returns {string[]} */
function erlaubteOrigins(env) {
  const roh = env && typeof env.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS : '';
  return roh.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Kopfzeilen fuer jede API-Antwort. `Vary: Origin` wird IMMER gesetzt, auch ohne Freigabe,
 * damit kein Zwischenspeicher eine Antwort ueber Origin-Grenzen hinweg wiederverwendet.
 * @param {Request} request @param {any} env @returns {Headers}
 */
export function corsHeaders(request, env) {
  const h = new Headers();
  h.set('Vary', 'Origin');
  const origin = request && request.headers ? request.headers.get('Origin') : null;
  if (origin && erlaubteOrigins(env).indexOf(origin) !== -1) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Methods', CORS_METHODS);
    h.set('Access-Control-Allow-Headers', CORS_REQ_HEADERS);
    h.set('Access-Control-Max-Age', '600');
  }
  return h;
}

/**
 * Antwort auf OPTIONS: 204 ohne Rumpf.
 * @param {Request} request @param {any} env @returns {Response}
 */
export function preflight(request, env) {
  const h = corsHeaders(request, env);
  h.set('Allow', CORS_METHODS);
  h.set('Cache-Control', 'no-store');
  if (!h.has('Access-Control-Allow-Methods')) h.set('Access-Control-Allow-Methods', CORS_METHODS);
  return new Response(null, { status: 204, headers: h });
}

/**
 * JSON-Antwort mit CORS-Kopf. Vorgabe ist `no-store`; GET-Bestenlisten ueberschreiben das
 * ueber extraHeaders.
 * @param {any} body @param {number} status @param {Request} request @param {any} env
 * @param {Headers|Record<string,string>} [extraHeaders]
 * @returns {Response}
 */
export function json(body, status, request, env, extraHeaders) {
  const h = corsHeaders(request, env);
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  if (extraHeaders) {
    if (typeof extraHeaders.forEach === 'function' && typeof extraHeaders.get === 'function') {
      extraHeaders.forEach((v, k) => h.set(k, v));
    } else {
      for (const k of Object.keys(extraHeaders)) h.set(k, String(extraHeaders[k]));
    }
  }
  return new Response(JSON.stringify(body), { status, headers: h });
}
