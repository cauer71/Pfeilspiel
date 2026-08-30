// Pfeilspiel — Frischepruefung.
//
// Zwei Dinge koennen in diesem Projekt still veralten, ohne dass ein anderer
// Test es merkt:
//
//  1. die Einzeldatei-Fassung `dist/pfeilspiel.html`. Sie entsteht aus
//     `tools/build-artifact.js`, liegt bewusst nicht in git und ist deshalb
//     schon einmal mit laengst behobenen Fehlern liegengeblieben. Dieser Test
//     baut sie im Testlauf selbst neu — in ein eigenes Verzeichnis unter
//     os.tmpdir(), ohne Netz und ohne jede Ruecksicht darauf, ob unter dist/
//     ueberhaupt etwas liegt — und prueft, dass das Erzeugnis den heutigen
//     Quellstand traegt. Damit ist zwar nicht die Datei auf einer fremden
//     Platte frisch, wohl aber die Zusage, dass ein Neubau (npm run
//     build:artifact, unter einer Sekunde) jederzeit genau die aktuellen
//     Quellen liefert. Bricht das Werkzeug, faellt es hier auf, nicht erst
//     beim Veroeffentlichen.
//
//  2. der Testlauf selbst. `npm test` sammelt ueber den Glob
//     `tests/*.test.js`, `node --test tests/` ueber tests/index.js. Der
//     letzte Abschnitt haelt beide Wege deckungsgleich, damit keine Testdatei
//     unbemerkt aus einem der beiden Laeufe faellt.
//
// Die Frischepruefung selbst ist bewusst grob koerniger als ein Bytevergleich
// und trotzdem scharf: JEDE nicht triviale Zeile jeder Datei unter public/src/
// MUSS sich im Erzeugnis wiederfinden. Bleibt eine Quelldatei beim Verpacken
// aussen vor, veraltet die Modulliste im Werkzeug oder frisst eine der
// Umschreibungen mehr weg als gedacht, schlaegt das hier fehl.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = fileURLToPath(new URL('../', import.meta.url));
const WERKZEUG = join(WURZEL, 'tools', 'build-artifact.js');
const QUELLVERZEICHNIS = join(WURZEL, 'public', 'src');

/** Die sieben Spielmodule aus SPEC §3 — Reihenfolge egal, Vollstaendigkeit nicht. */
const SPIELMODULE = ['game.js', 'levels.js', 'render.js', 'skins.js', 'ui.js', 'api.js', 'main.js'];

// --- Bau -------------------------------------------------------------------
// Einmal je Testdatei, in ein frisches Verzeichnis. Kein Zugriff auf dist/:
// weder lesend (der Test darf nicht von einer alten Datei abhaengen) noch
// schreibend (parallele Laeufe sollen sich nicht ins Gehege kommen).

const ARBEITSVERZEICHNIS = mkdtempSync(join(tmpdir(), 'pfeilspiel-bundle-'));
const ZIEL = join(ARBEITSVERZEICHNIS, 'pfeilspiel.html');

const BAU = spawnSync(process.execPath, [WERKZEUG, ZIEL], {
  cwd: WURZEL,
  encoding: 'utf8',
  timeout: 120000
});

const ERZEUGNIS = BAU.status === 0 && existsSync(ZIEL) ? readFileSync(ZIEL, 'utf8') : '';

/** Alle Zeilen des Erzeugnisses, getrimmt — fuer die zeilenweise Frischepruefung. */
const ERZEUGNISZEILEN = new Set(ERZEUGNIS.split('\n').map((z) => z.trim()));

after(() => rmSync(ARBEITSVERZEICHNIS, { recursive: true, force: true }));

/** Alle Dateien unter public/src/, rekursiv, als Pfad relativ zur Projektwurzel. */
function quelldateien(verzeichnis = QUELLVERZEICHNIS, gesammelt = []) {
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) quelldateien(pfad, gesammelt);
    else gesammelt.push(pfad.slice(WURZEL.length));
  }
  return gesammelt;
}

const QUELLDATEIEN = quelldateien();

/**
 * Die Zeilen einer Quelldatei, so wie sie im Erzeugnis stehen MUESSEN.
 *
 * Das Werkzeug nimmt den Inhalt unveraendert auf; nur drei Dinge verschiebt es,
 * und genau die werden hier nachvollzogen:
 *   * Importe entfallen (auch mehrzeilige) — alles liegt im selben Geltungsbereich;
 *   * `export ` faellt vor Deklarationen weg, `export { … };` ganz;
 *   * in skins.js weicht `stepped` der Umbenennung `steppedSkin` (Namenskollision).
 * Sehr kurze Zeilen (Klammern, Kommentarraender) bleiben aussen vor: sie sagen
 * nichts ueber Frische aus und stehen ohnehin tausendfach im Erzeugnis.
 */
function pflichtzeilen(relativerPfad, quelltext) {
  const raus = [];
  let inMehrzeiler = false;

  for (const roh of quelltext.split('\n')) {
    let zeile = roh.trim();

    if (inMehrzeiler) {
      if (zeile.endsWith(';')) inMehrzeiler = false;
      continue;
    }
    if (/^(?:import|export)\s*[{*]/.test(zeile) || /^import\s/.test(zeile)) {
      if (!zeile.endsWith(';')) inMehrzeiler = true;
      continue;
    }

    zeile = zeile.replace(/^export\s+/, '');
    if (zeile.length < 12) continue;
    if (relativerPfad.endsWith('skins.js')) zeile = zeile.replace(/\bstepped\b(?!\d)/g, 'steppedSkin');
    raus.push(zeile);
  }
  return raus;
}

// --- 1. Der Bau selbst -----------------------------------------------------

test('tools/build-artifact.js laeuft ohne Netz und ohne vorhandene dist-Datei durch', () => {
  assert.equal(BAU.error, undefined, 'Der Bau liess sich nicht starten: ' + (BAU.error && BAU.error.message));
  assert.equal(BAU.status, 0,
    'Der Bau brach ab (Status ' + BAU.status + '):\n' + (BAU.stderr || '').trim());
  assert.ok(existsSync(ZIEL), 'Das Werkzeug hat kein Erzeugnis geschrieben.');
  // Das Erzeugnis traegt three vollstaendig in sich; alles deutlich Kleinere
  // waere ein Zeichen dafuer, dass ein Teil beim Verpacken verlorenging.
  assert.ok(ERZEUGNIS.length > 1.5 * 1024 * 1024,
    'Das Erzeugnis ist mit ' + (ERZEUGNIS.length / 1048576).toFixed(2) + ' MiB auffaellig klein.');
});

// --- 2. Nichts Unaufgeloestes ---------------------------------------------

test('das Erzeugnis traegt keine unaufgeloeste import- oder export-Zeile', () => {
  const importe = ERZEUGNIS.match(/^\s*import\s.*$/gm) || [];
  const exporte = ERZEUGNIS.match(/^\s*export\s.*$/gm) || [];
  assert.deepEqual(importe, [], 'stehengebliebene Importe:\n' + importe.join('\n'));
  assert.deepEqual(exporte, [], 'stehengebliebene Exporte:\n' + exporte.join('\n'));
  assert.ok(!/@import\b/.test(ERZEUGNIS), 'Ein CSS-@import wuerde die Einzeldatei ans Netz binden.');
});

// --- 3. three eingebettet, nichts nachzuladen ------------------------------

test('three steckt eingebettet in der Einzeldatei, nicht hinter einem Verweis', () => {
  assert.ok(ERZEUGNIS.includes('const THREE = (function ()'),
    'Die three-Kapsel fehlt — ohne sie hat die Einzeldatei kein THREE.');
  assert.ok(!/\brequire\s*\(/.test(ERZEUGNIS),
    'Ein require() im Erzeugnis liefe im Browser ins Leere.');
  // Kennzeichnende Bausteine aus three selbst: die Kapsel ist gefuellt, nicht leer.
  for (const marke of ['class WebGLRenderer', 'class BufferGeometry', 'class Vector3']) {
    assert.ok(ERZEUGNIS.includes(marke), 'three unvollstaendig: "' + marke + '" fehlt.');
  }
  // Die Addons wurden auf denselben Geltungsbereich umgeschrieben.
  assert.ok(ERZEUGNIS.includes('class OrbitControls'), 'OrbitControls fehlt.');
  assert.ok(ERZEUGNIS.includes('RoomEnvironment'), 'RoomEnvironment fehlt.');
});

test('die Einzeldatei laedt nichts nach: kein Skriptverweis, keine Importmap, kein vendor-Pfad', () => {
  assert.ok(!/<script[^>]+\ssrc\s*=/i.test(ERZEUGNIS), 'Ein <script src=…> macht die Datei netzabhaengig.');
  assert.ok(!/<link[^>]+stylesheet/i.test(ERZEUGNIS), 'Ein Stylesheet-Verweis macht die Datei netzabhaengig.');
  assert.ok(!/importmap/i.test(ERZEUGNIS), 'Eine Importmap braucht die Einzeldatei nicht mehr.');
  assert.ok(!/vendor\//.test(ERZEUGNIS), 'Ein Verweis auf public/vendor/ gehoert nicht ins Erzeugnis.');
});

// --- 4. Alle Spielmodule ---------------------------------------------------

test('alle sieben Spielmodule sind eingesetzt — und kein weiteres blieb liegen', () => {
  const marken = [...ERZEUGNIS.matchAll(/^\/\/ ===== public\/src\/([A-Za-z0-9_.-]+) =====$/gm)]
    .map((m) => m[1]);

  for (const modul of SPIELMODULE) {
    assert.ok(marken.includes(modul), 'Das Spielmodul ' + modul + ' fehlt im Erzeugnis.');
  }

  // Was unter public/src/ als Modul liegt, MUSS auch verpackt sein. Diese
  // Gleichheit ist der Wachposten gegen eine veraltete Modulliste im Werkzeug.
  const vorhanden = QUELLDATEIEN
    .filter((p) => p.startsWith('public/src/') && p.endsWith('.js') && !p.slice('public/src/'.length).includes('/'))
    .map((p) => p.slice('public/src/'.length))
    .sort();
  assert.deepEqual([...marken].sort(), vorhanden,
    'Verpackte Module und public/src/*.js gehen auseinander.');

  // main.js startet das Spiel und MUSS hinter allem stehen, was es benutzt.
  assert.equal(marken[marken.length - 1], 'main.js', 'main.js steht nicht am Ende.');
});

// --- 5. Oertliche Bestenliste ---------------------------------------------

test('die oertliche Bestenliste ersetzt in der Einzeldatei die Netz-Bestenliste', () => {
  const marke = ERZEUGNIS.indexOf('// ===== Einzeldatei: oertliche Bestenliste =====');
  assert.ok(marke > -1, 'Der Ersatzblock fuer die Bestenliste fehlt.');

  assert.match(ERZEUGNIS, /^getScores = async function \(q\) \{$/m, 'getScores wird nicht umgelenkt.');
  assert.match(ERZEUGNIS, /^postScore = async function \(run\) \{$/m, 'postScore wird nicht umgelenkt.');
  assert.ok(ERZEUGNIS.includes("'pfeilspiel.bestenliste.oertlich'"),
    'Der localStorage-Schluessel der oertlichen Liste fehlt.');

  // Die Umlenkung wirkt nur, wenn sie hinter api.js und vor main.js steht.
  const api = ERZEUGNIS.indexOf('// ===== public/src/api.js =====');
  const main = ERZEUGNIS.indexOf('// ===== public/src/main.js =====');
  assert.ok(api > -1 && main > -1, 'api.js oder main.js fehlt im Erzeugnis.');
  assert.ok(api < marke && marke < main,
    'Der Ersatzblock steht nicht zwischen api.js und main.js und bliebe damit wirkungslos.');
});

// --- 6. Frische: der heutige Quellstand steckt wirklich drin ---------------

for (const relativerPfad of QUELLDATEIEN) {
  test('das Erzeugnis traegt den heutigen Inhalt von ' + relativerPfad, () => {
    const zeilen = pflichtzeilen(relativerPfad, readFileSync(join(WURZEL, relativerPfad), 'utf8'));
    assert.ok(zeilen.length > 20,
      relativerPfad + ' liefert nur ' + zeilen.length + ' pruefbare Zeilen — die Pruefung waere wertlos.');

    const fehlend = zeilen.filter((z) => !ERZEUGNISZEILEN.has(z));
    assert.deepEqual(fehlend.slice(0, 5), [],
      fehlend.length + ' von ' + zeilen.length + ' Zeilen aus ' + relativerPfad
      + ' fehlen im Erzeugnis — die Einzeldatei ist gegenueber der Quelle veraltet '
      + 'oder das Verpacken frisst zu viel weg. Erste Fundstellen oben.');
  });
}

test('auch die Auszeichnung aus public/index.html steckt unveraendert im Erzeugnis', () => {
  const html = readFileSync(join(WURZEL, 'public', 'index.html'), 'utf8');
  const koerper = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
  const zeilen = koerper.split('\n').map((z) => z.trim()).filter((z) => z.length >= 12);
  assert.ok(zeilen.length > 20, 'Der Koerper von public/index.html liess sich nicht sinnvoll lesen.');

  const fehlend = zeilen.filter((z) => !ERZEUGNISZEILEN.has(z));
  assert.deepEqual(fehlend.slice(0, 5), [],
    fehlend.length + ' Zeilen der Auszeichnung fehlen im Erzeugnis.');
});

// --- 7. Der Testlauf selbst darf nicht loechrig werden ---------------------
// `npm test` sammelt ueber den Glob, `node --test tests/` ueber tests/index.js.
// Sobald einer der beiden Wege eine Auswahl trifft, die der andere nicht kennt,
// laeuft eine Testdatei still nicht mehr mit — genau das soll hier auffliegen.

test('tests/index.js erfasst jede Testdatei, statt eine Liste von Hand zu fuehren', () => {
  const pfad = join(WURZEL, 'tests', 'index.js');
  assert.ok(existsSync(pfad),
    'Ohne tests/index.js bricht `node --test tests/` mit MODULE_NOT_FOUND ab.');

  const quelle = readFileSync(pfad, 'utf8');
  assert.match(quelle, /readdirSync/,
    'tests/index.js liest das Testverzeichnis nicht mehr ein.');

  const handListe = quelle.match(/^\s*import\s+['"]\.\/[^'"]*\.test\.js['"]/gm) || [];
  assert.deepEqual(handListe, [],
    'tests/index.js zaehlt Testdateien wieder von Hand auf. Diese Liste veraltet still, '
    + 'sobald jemand eine Testdatei anlegt und den Eintrag vergisst:\n' + handListe.join('\n'));

  const gefunden = readdirSync(join(WURZEL, 'tests')).filter((n) => n.endsWith('.test.js'));
  assert.ok(gefunden.includes('bundle.test.js'),
    'Selbstprobe fehlgeschlagen: diese Datei findet sich nicht im Testverzeichnis.');
  assert.ok(gefunden.length >= 2, 'Im Testverzeichnis steht kaum eine Testdatei.');
});

test('npm test laesst jede Testdatei mitlaufen', () => {
  const paket = JSON.parse(readFileSync(join(WURZEL, 'package.json'), 'utf8'));
  const befehl = (paket.scripts && paket.scripts.test) || '';
  assert.ok(/node --test .*tests\/(\*\.test\.js|\s|$)/.test(befehl.trim() + ' '),
    'Das Skript "test" muss das ganze Testverzeichnis erfassen '
    + '(node --test tests/*.test.js oder node --test tests/), steht aber auf: ' + befehl);
});
