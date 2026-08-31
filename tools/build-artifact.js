// Baut aus dem mehrdateiligen Spiel eine einzelne, netzunabhaengige HTML-Datei,
// damit es sich als Artifact auf claude.ai veroeffentlichen laesst. Das Repository
// selbst bleibt buildfrei — diese Datei ist reines Verpackungswerkzeug.
//
// Verfahren:
//   * die drei Stylesheets werden als <style> eingebettet, die Body-Auszeichnung
//     unveraendert uebernommen;
//   * three wird als CommonJS-Fassung (build/three.cjs, ohne jede require-Abhaengigkeit)
//     in eine Funktion gekapselt und liefert das Objekt THREE. Damit braucht die
//     Einzeldatei weder Importmap noch CDN und laesst sich vollstaendig offline pruefen;
//   * TrackballControls und RoomEnvironment werden von ES-Modul auf denselben
//     Geltungsbereich umgeschrieben (import -> Destrukturierung aus THREE);
//   * die sieben Spielmodule werden in Abhaengigkeitsreihenfolge verkettet; ihre
//     Importe untereinander entfallen, weil alle Namen im selben Geltungsbereich liegen.
//
// Ein Namenskonflikt zwischen zwei Modulen bricht den Bau ab, statt still ein
// kaputtes Bundle zu erzeugen.
//
// Aufruf: node tools/build-artifact.js [ziel.html]
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '..');
const ZIEL = resolve(process.argv[2] || join(WURZEL, 'dist', 'pfeilspiel.html'));

/** Reihenfolge nach Abhaengigkeiten: jedes Modul steht hinter dem, was es benutzt. */
const MODULE = ['game.js', 'levels.js', 'render.js', 'skins.js', 'ui.js', 'api.js', 'main.js'];

const lies = (p) => readFileSync(join(WURZEL, p), 'utf8');

function abbruch(text) {
  console.error('Bau abgebrochen: ' + text);
  process.exit(1);
}

// --- 0. Die Listen unten gegen den Quellstand halten -----------------------
// Eine hier vergessene Datei faellt sonst still aus der Einzeldatei heraus und
// das Erzeugnis veraltet, ohne dass irgendetwas rot wird. Deshalb wird das
// Verzeichnis gelesen und mit der Aufzaehlung verglichen.
function listeAbgleichen(verzeichnis, endung, gefuehrt, was) {
  const vorhanden = readdirSync(join(WURZEL, verzeichnis))
    .filter((n) => n.endsWith(endung)).sort();
  const gefuehrtKurz = gefuehrt.map((p) => p.slice(p.lastIndexOf('/') + 1)).sort();
  const fehlt = vorhanden.filter((n) => !gefuehrtKurz.includes(n));
  const zuviel = gefuehrtKurz.filter((n) => !vorhanden.includes(n));
  if (fehlt.length) abbruch(`${was}: ${verzeichnis} enthaelt ${fehlt.join(', ')}, aber die Liste im Werkzeug nicht.`);
  if (zuviel.length) abbruch(`${was}: die Liste im Werkzeug nennt ${zuviel.join(', ')}, ${verzeichnis} nicht.`);
}

/** Stylesheets in Ladereihenfolge — Tokens zuerst, Effekte zuletzt. */
const STYLES = ['public/src/styles/tokens.css', 'public/src/styles/base.css', 'public/src/styles/fx.css'];

listeAbgleichen('public/src', '.js', MODULE, 'Spielmodule');
listeAbgleichen('public/src/styles', '.css', STYLES, 'Stylesheets');

// --- 1. three als gekapselte CommonJS-Fassung -----------------------------
const dreiQuelle = lies('node_modules/three/build/three.cjs');
if (/\brequire\s*\(/.test(dreiQuelle)) abbruch('three.cjs enthaelt require() und ist nicht eigenstaendig.');

const dreiBlock = `const THREE = (function () {
const exports = {};
${dreiQuelle}
return exports;
})();`;

// --- 2. Addons von ES-Modul auf denselben Geltungsbereich umschreiben ------
const benoetigt = new Set();

function addonUmschreiben(pfad) {
  let s = lies(pfad);
  s = s.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*'three';\s*$/m, (_, namen) => {
    for (const n of namen.split(',').map(x => x.trim()).filter(Boolean)) benoetigt.add(n);
    return '';
  });
  if (/^\s*import\s/m.test(s)) abbruch(`Unerwarteter Import in ${pfad}`);
  s = s.replace(/^export\s*\{[^}]*\};\s*$/gm, '');
  s = s.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
  return `// ===== ${pfad} =====\n${s.trim()}\n`;
}

const addons = [
  'node_modules/three/examples/jsm/controls/TrackballControls.js',
  'node_modules/three/examples/jsm/environments/RoomEnvironment.js',
].map(addonUmschreiben).join('\n\n');

const entnahme = `const { ${[...benoetigt].sort().join(', ')} } = THREE;`;

// --- 3. Spielmodule -------------------------------------------------------
/** Entfernt die Importe und das Schluesselwort export. */
function entflechten(name, src) {
  let s = src;

  // three und die Addons stehen bereits im Geltungsbereich
  s = s.replace(/^import\s+\*\s+as\s+THREE\s+from\s+'three';\s*$/gm, '');
  s = s.replace(/^import\s*\{[^}]*\}\s*from\s*'three\/addons\/[^']+';\s*$/gm, '');

  // Importe zwischen den Spielmodulen entfallen ersatzlos
  s = s.replace(/^import\s*\{[\s\S]*?\}\s*from\s*'\.\/[A-Za-z0-9_.-]+\.js';\s*$/gm, '');
  s = s.replace(/^import\s+[A-Za-z_$][\w$]*\s+from\s+'\.\/[A-Za-z0-9_.-]+\.js';\s*$/gm, '');

  s = s.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
  s = s.replace(/^export\s*\{[^}]*\};\s*$/gm, '');

  // einzige Namenskollision zwischen zwei Spielmodulen
  if (name === 'skins.js') s = s.replace(/\bstepped\b(?!\d)/g, 'steppedSkin');

  return `// ===== public/src/${name} =====\n${s.trim()}\n`;
}

const teile = MODULE.map(m => ({ name: m, code: entflechten(m, lies('public/src/' + m)) }));

// --- 3b. Einzeldatei-Ersatz fuer die Bestenliste ---------------------------
// Die Einzeldatei laeuft ohne Server; /api/records gibt es dort nicht. getScores
// und postScore werden deshalb auf eine rein oertliche Liste im Browser des
// Spielers umgelenkt. Die geteilte Bestenliste gehoert zur Cloudflare-Fassung.
const BESTENLISTE_OERTLICH = `// ===== Einzeldatei: oertliche Bestenliste =====
const PS_LISTE_SCHLUESSEL = 'pfeilspiel.bestenliste.oertlich';

function psListeLesen() {
  try {
    const roh = localStorage.getItem(PS_LISTE_SCHLUESSEL);
    const arr = roh ? JSON.parse(roh) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_e) { return []; }
}

function psListeSchreiben(arr) {
  try { localStorage.setItem(PS_LISTE_SCHLUESSEL, JSON.stringify(arr.slice(0, 500))); }
  catch (_e) { /* Privatmodus: die Liste bleibt fluechtig */ }
}

function psGroesseText(g) {
  return g && Number.isFinite(g.x) ? g.x + 'x' + g.y + 'x' + g.z : '';
}

/** Sortierung wie im Worker: wenige Zuege zuerst, bei Gleichstand die kuerzere Zeit. */
function psRang(a, b) {
  return (a.moves - b.moves) || (a.timeMs - b.timeMs) || (a.id - b.id);
}

getScores = async function (q) {
  const src = (q && typeof q === 'object') ? q : {};
  const dir = typeof src.dir === 'string' ? src.dir.toLowerCase() : null;
  const goal = typeof src.goal === 'string' ? src.goal.toLowerCase() : null;
  const size = psGroesseText(src.size);
  const limit = Number.isFinite(Number(src.limit)) ? Math.max(1, Math.trunc(Number(src.limit))) : 20;

  let rows = psListeLesen().filter((r) =>
    (!dir || r.dirMode === dir) &&
    (!goal || r.goalMode === goal) &&
    (!size || r.sizeKey === size));

  rows.sort(psRang);

  if (src.bestPerName === true) {
    const gesehen = new Set();
    rows = rows.filter((r) => {
      const k = String(r.name || '').toLowerCase();
      if (gesehen.has(k)) return false;
      gesehen.add(k);
      return true;
    });
  }

  const total = rows.length;
  return {
    ok: true,
    total,
    records: rows.slice(0, limit).map((r, i) => Object.assign({}, r, { rank: i + 1 }))
  };
};

postScore = async function (run) {
  if (!run || typeof run !== 'object') {
    return { ok: false, error: 'validation', message: 'Der Lauf ist unvollstaendig.' };
  }
  const name = String(run.name || '').trim().slice(0, 16);
  if (name.length < 2) {
    return { ok: false, error: 'validation', field: 'name', message: 'Der Name braucht mindestens zwei Zeichen.' };
  }

  const liste = psListeLesen();
  const schonDa = liste.find((r) => r.runId && r.runId === run.runId);
  if (schonDa) {
    const sortiert = liste.slice().sort(psRang);
    return { ok: true, id: schonDa.id, rank: sortiert.indexOf(schonDa) + 1, total: liste.length, duplicate: true };
  }

  const eintrag = {
    id: liste.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1,
    runId: run.runId,
    name,
    dirMode: run.dirMode,
    goalMode: run.goalMode,
    size: run.size,
    sizeKey: psGroesseText(run.size),
    cubes: run.cubes | 0,
    moves: run.moves | 0,
    undos: run.undos | 0,
    timeMs: Math.max(1, Math.round(run.timeMs || 0)),
    createdAt: new Date().toISOString()
  };

  liste.push(eintrag);
  liste.sort(psRang);
  psListeSchreiben(liste);

  const gefiltert = liste.filter((r) =>
    r.dirMode === eintrag.dirMode && r.goalMode === eintrag.goalMode && r.sizeKey === eintrag.sizeKey);
  return {
    ok: true,
    id: eintrag.id,
    rank: gefiltert.indexOf(eintrag) + 1,
    total: gefiltert.length,
    duplicate: false
  };
};
`;

// --- 4. Namenskonflikte im gemeinsamen Geltungsbereich ausschliessen -------
const DEKL = /^(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const gesehen = new Map();
for (const n of benoetigt) gesehen.set(n, 'three-Addons');
for (const t of teile) {
  const eigene = new Set();
  let m; DEKL.lastIndex = 0;
  while ((m = DEKL.exec(t.code))) eigene.add(m[1]);
  for (const n of eigene) {
    if (gesehen.has(n)) abbruch(`Namenskonflikt "${n}": ${gesehen.get(n)} und ${t.name}`);
    gesehen.set(n, t.name);
  }
}

const eingesetzt = [];
for (const t of teile) {
  if (t.name === 'main.js') eingesetzt.push(BESTENLISTE_OERTLICH);
  eingesetzt.push(t.code);
}
const spiel = eingesetzt.join('\n\n');
const uebrig = spiel.match(/^\s*import\s.*$/gm);
if (uebrig) abbruch('nicht aufgeloeste Importe:\n' + uebrig.join('\n'));
if (/^\s*export\s/m.test(spiel)) abbruch('nicht entferntes export im Bundle');

// --- 5. Auszeichnung und Stylesheets --------------------------------------
const html = lies('public/index.html');
const koerper = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>')).trim();

const css = STYLES
  .map(p => `/* ===== ${p} ===== */\n${lies(p)}`)
  .join('\n\n');

// --- 6. Zusammensetzen ----------------------------------------------------
// Die Artifact-Auslieferung ergaenzt doctype, html, head und body selbst; hier
// steht deshalb nur der Seiteninhalt. Ein einziges klassisches Skript genuegt,
// weil nach dem Entflechten keine Modulsemantik mehr gebraucht wird.
const seite = `<title>Pfeilspiel</title>
<meta name="theme-color" content="#0E1116">

<style>
${css}
</style>

${koerper}

<script>
${dreiBlock}

${entnahme}

${addons}

${spiel}
<\/script>
`;

mkdirSync(dirname(ZIEL), { recursive: true });
writeFileSync(ZIEL, seite, 'utf8');
console.log(`Einzeldatei geschrieben: ${ZIEL} (${(Buffer.byteLength(seite) / 1024 / 1024).toFixed(2)} MiB)`);
console.log(`  three: eingebettet (build/three.cjs), ${benoetigt.size} Symbole an die Addons gereicht`);
console.log(`  Spielmodule: ${MODULE.join(', ')}`);
