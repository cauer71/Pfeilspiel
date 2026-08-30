// Pfeilspiel — CSS-Tokentests (SPEC §7.1, §7.2, §10.7 Punkt 4).
// Jede in base.css und fx.css benutzte var(--ps-*) MUSS in allen drei Skins
// definiert sein; base.css darf keinen Hexwert und keinen literalen px-Radius tragen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SKIN_IDS, SKINS } from '../public/src/skins.js';

const STYLES = fileURLToPath(new URL('../public/src/styles/', import.meta.url));
const TOKENS_CSS = STYLES + 'tokens.css';
const BASE_CSS = STYLES + 'base.css';
const FX_CSS = STYLES + 'fx.css';

/** Entfernt /* … *\/-Kommentare, damit auskommentierte Beispiele nicht mitzaehlen. */
function strip(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Alle in `var(--ps-…)` gelesenen Tokennamen. */
function usedVars(css) {
  const out = new Set();
  const re = /var\(\s*(--ps-[A-Za-z0-9-]+)/g;
  let m;
  while ((m = re.exec(css)) !== null) out.add(m[1]);
  return out;
}

/** Alle in dieser Datei selbst deklarierten Tokennamen. */
function declaredVars(css) {
  const out = new Set();
  const re = /(--ps-[A-Za-z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(css)) !== null) out.add(m[1]);
  return out;
}

/** Schnittmenge der in allen drei Skins definierten Tokennamen. */
function skinTokenNames() {
  const sets = SKIN_IDS.map((id) => new Set(Object.keys(SKINS[id].css)));
  return new Set([...sets[0]].filter((k) => sets.every((s) => s.has(k))));
}

const TOKENS = skinTokenNames();

function checkUsage(file, css, label) {
  const clean = strip(css);
  const local = declaredVars(clean);
  const missing = [...usedVars(clean)].filter((v) => !TOKENS.has(v) && !local.has(v)).sort();
  assert.deepEqual(missing, [],
    label + ' benutzt Tokens, die weder in allen drei Skins noch in der Datei selbst '
    + 'definiert sind: ' + missing.join(', '));
}

// --- tokens.css -----------------------------------------------------------

test('tokens.css existiert und traegt den Modern-Satz vollstaendig im :root', () => {
  assert.ok(existsSync(TOKENS_CSS), 'tokens.css fehlt');
  const css = strip(readFileSync(TOKENS_CSS, 'utf8'));
  const declared = declaredVars(css);
  const modern = SKINS.modern.css;
  const missing = Object.keys(modern).filter((k) => !declared.has(k)).sort();
  assert.deepEqual(missing, [], 'tokens.css fehlen Defaults: ' + missing.join(', '));

  // Die Werte muessen den Modern-Tokens entsprechen (Vergleich ohne Leerraum).
  const norm = (s) => s.replace(/\s+/g, '');
  for (const key of Object.keys(modern)) {
    const m = css.match(new RegExp('(?:^|[;{])\\s*' + key + '\\s*:([^;]+);'));
    assert.ok(m, 'tokens.css: Deklaration von ' + key + ' nicht lesbar');
    assert.equal(norm(m[1]), norm(modern[key]), 'tokens.css: ' + key + ' weicht von Modern ab');
  }
});

test('tokens.css deklariert keine fremden --ps-Tokens', () => {
  const css = strip(readFileSync(TOKENS_CSS, 'utf8'));
  const extra = [...declaredVars(css)].filter((k) => !TOKENS.has(k)).sort();
  assert.deepEqual(extra, [], 'unbekannte Tokens in tokens.css: ' + extra.join(', '));
});

// --- fx.css ---------------------------------------------------------------

test('fx.css: jede benutzte var(--ps-*) ist in allen drei Skins definiert', () => {
  assert.ok(existsSync(FX_CSS), 'fx.css fehlt');
  checkUsage(FX_CSS, readFileSync(FX_CSS, 'utf8'), 'fx.css');
});

test('fx.css enthaelt das CRT-Overlay und respektiert prefers-reduced-motion', () => {
  const css = readFileSync(FX_CSS, 'utf8');
  assert.match(css, /#ps-crt\s*\{/, 'CRT-Overlay fehlt');
  assert.match(css, /var\(--ps-scanline-opacity/, 'Scanlinien-Opazitaet fehlt');
  assert.match(css, /var\(--ps-scanline-period/, 'Scanlinien-Periode fehlt');
  assert.match(css, /var\(--ps-grille-opacity/, 'Lochmaske fehlt');
  assert.match(css, /var\(--ps-vignette/, 'Vignette fehlt');
  assert.match(css, /@keyframes\s+ps-roll/, 'Rollstreifen fehlt');
  assert.match(css, /@keyframes\s+ps-shake/, 'Shake-Keyframes fehlen');
  assert.match(css, /:root:not\(\[data-skin="arcade"\]\)\s*#ps-crt\s*\{\s*display:\s*none/,
    'CRT-Overlay wird ausserhalb von Arcade nicht abgeschaltet');
  const rm = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/);
  assert.ok(rm, 'prefers-reduced-motion-Block fehlt');
  assert.match(rm[0], /animation:\s*none\s*!important/, 'Animationen werden nicht abgeschaltet');
  assert.match(rm[0], /#ps-crt/, 'CRT-Animation laeuft trotz reduced-motion weiter');
});

test('fx.css legt keinen Vollbildfilter ausser dem Skin-Token auf den Canvas', () => {
  const css = strip(readFileSync(FX_CSS, 'utf8'));
  assert.match(css, /#ps-canvas\s*\{\s*filter:\s*var\(--ps-canvas-filter/,
    'Canvasfilter kommt nicht aus dem Token');
  // drop-shadow/blur pro Bild ist verboten (SPEC §7.6).
  assert.doesNotMatch(css, /filter:[^;]*drop-shadow/, 'drop-shadow auf dem Canvas');
  assert.doesNotMatch(css, /filter:[^;]*\bblur\(/, 'blur auf dem Canvas');
  // Screenshake wirkt auf worldRig, nie als CSS-Transform auf dem Canvas.
  assert.doesNotMatch(css, /#ps-canvas[^{]*\{[^}]*transform/, 'CSS-Transform auf dem Canvas');
});

// --- base.css (schreibt ein anderes Modul) --------------------------------

test('base.css: jede benutzte var(--ps-*) ist in allen drei Skins definiert', (t) => {
  if (!existsSync(BASE_CSS)) {
    t.skip('public/src/styles/base.css existiert noch nicht — Pruefung uebersprungen, '
      + 'sie MUSS nachgeholt werden, sobald die Datei vorliegt.');
    return;
  }
  checkUsage(BASE_CSS, readFileSync(BASE_CSS, 'utf8'), 'base.css');
});

test('base.css enthaelt keine Hexfarbe (SPEC §10.7.4)', (t) => {
  if (!existsSync(BASE_CSS)) {
    t.skip('public/src/styles/base.css existiert noch nicht — Pruefung uebersprungen, '
      + 'sie MUSS nachgeholt werden, sobald die Datei vorliegt.');
    return;
  }
  const css = strip(readFileSync(BASE_CSS, 'utf8'));
  const hits = [];
  const lines = css.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/#[0-9a-fA-F]{3,8}\b/g);
    if (m) hits.push('Zeile ' + (i + 1) + ': ' + m.join(' '));
  }
  assert.deepEqual(hits, [], 'Hexfarben in base.css: ' + hits.join(' | '));
});

test('base.css enthaelt keinen literalen px-Radius (SPEC §10.7.4)', (t) => {
  if (!existsSync(BASE_CSS)) {
    t.skip('public/src/styles/base.css existiert noch nicht — Pruefung uebersprungen, '
      + 'sie MUSS nachgeholt werden, sobald die Datei vorliegt.');
    return;
  }
  const css = strip(readFileSync(BASE_CSS, 'utf8'));
  const hits = [];
  const re = /border(?:-[a-z-]+)?-radius\s*:\s*([^;}]+)/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const rest = m[1].replace(/var\(\s*--[A-Za-z0-9-]+\s*\)/g, '');
    if (/\d\s*px/.test(rest)) hits.push(m[0].trim());
  }
  assert.deepEqual(hits, [], 'literale Radien in base.css: ' + hits.join(' | '));
});
