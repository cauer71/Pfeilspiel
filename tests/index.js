// Sammeleinstieg fuer `node --test tests/` (SPEC §10: "Ausfuehrung: npm test →
// node --test tests/").
//
// Warum diese Datei bleibt — und warum sie nichts von Hand aufzaehlen darf:
//
// Node 22 behandelt ein Verzeichnis als Positionsargument von `--test` NICHT als
// Suchraum, sondern loest es ueber die Modulaufloesung auf. `node --test tests/`
// laedt also genau diese Einstiegsdatei und sonst keine; ohne sie bricht der
// Aufruf mit MODULE_NOT_FOUND ab (in einem leeren Projekt nachvollziehbar).
// Die Datei ist damit nicht wirkungslos: sie IST der Lauf.
//
// Genau deshalb war die frueher hier gefuehrte Importliste die gefaehrlichste
// Stelle im Testaufbau. Wer eine Testdatei anlegte und den Eintrag vergass,
// bekam von `npm test` (Glob `tests/*.test.js`) noch gruene Zahlen, waehrend
// `node --test tests/` die neue Datei still ueberging — und umgekehrt fiel eine
// hier eingetragene, aber falsch benannte Datei aus `npm test`. Statt der Liste
// wird das Verzeichnis gelesen: beide Laufarten erfassen damit dieselbe Menge,
// naemlich jede Datei `tests/*.test.js`.
//
// Hier bitte KEINE einzelnen `import './x.test.js'`-Zeilen nachtragen — eine
// neue Testdatei laeuft allein durch ihren Namen mit. tests/bundle.test.js
// wacht darueber.
//
// `tests/e2e.mjs` bleibt bewusst aussen vor: der Playwright-Lauf braucht einen
// Browser und laeuft ueber `npm run e2e`.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HIER = new URL('./', import.meta.url);

const testdateien = readdirSync(fileURLToPath(HIER))
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (testdateien.length === 0) {
  throw new Error(
    'tests/index.js: im Testverzeichnis steht keine einzige *.test.js. '
    + 'Das ist kein leerer, sondern ein kaputter Lauf.'
  );
}

for (const name of testdateien) {
  await import(new URL(name, HIER).href);
}
