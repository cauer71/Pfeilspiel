// Worker-Einstieg: /api/* selbst beantworten, alles andere an die Static Assets geben.
// Der Fallback ist ausdruecklich (env.ASSETS.fetch), damit eine spaetere Routenaenderung
// nicht die ganze Seite auf 404 setzt (SPEC §9.5).

import { json, preflight } from './http.js';
import { handleRecords } from './api-records.js';

/** @typedef {{ASSETS: {fetch: (r: Request) => Promise<Response>}, DB: any,
 *             ALLOWED_ORIGINS: string, IP_SALT: string}} Env */

function health(request, env) {
  const m = request.method.toUpperCase();
  if (m === 'OPTIONS') return preflight(request, env);
  if (m !== 'GET' && m !== 'HEAD') {
    return json({ ok: false, error: 'method_not_allowed', message: 'Diese Methode ist hier nicht erlaubt.' },
      405, request, env, { Allow: 'GET, OPTIONS' });
  }
  return json({ ok: true, ts: Date.now() }, 200, request, env);
}

export default {
  /**
   * @param {Request} request @param {Env} env @param {any} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    let url;
    try {
      url = new URL(request.url);
    } catch (err) {
      return json({ ok: false, error: 'not_found', message: 'Unbekannte Adresse.' }, 404, request, env);
    }
    const pfad = url.pathname;

    try {
      if (pfad === '/api/records') return await handleRecords(request, env, ctx, url);
      if (pfad === '/api/health') return health(request, env);
      if (pfad === '/api' || pfad.startsWith('/api/')) {
        return json({ ok: false, error: 'not_found', message: 'Diese Schnittstelle gibt es nicht.' },
          404, request, env);
      }
      return await env.ASSETS.fetch(request);
    } catch (err) {
      console.error('worker', pfad, err && (err.stack || err.message));
      return json({ ok: false, error: 'server_error', message: 'Unerwarteter Serverfehler.' },
        500, request, env);
    }
  }
};
