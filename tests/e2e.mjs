// End-to-End-Lauf im echten Browser: startet den Entwicklungsserver, laedt das
// Spiel in Chromium, spielt Zuege ueber den Testhaken globalThis.__pfeilspiel und
// legt Bildschirmfotos aller drei Skins und beider Richtungsmodi ab.
//
// Aufruf:  node tests/e2e.mjs [--out verzeichnis] [--headed]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '..');
const PORT = Number(process.env.PORT || 8788);
const BASIS = `http://127.0.0.1:${PORT}`;

const args = process.argv.slice(2);
const AUS = join(WURZEL, argWert('--out') || 'test-results');
const HEADED = args.includes('--headed');

function argWert(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const fehler = [];
const schritte = [];
function pruefe(bedingung, text) {
  schritte.push({ ok: !!bedingung, text });
  if (!bedingung) fehler.push(text);
  console.log(`${bedingung ? 'ok  ' : 'FEHL'}  ${text}`);
}

/** Wartet, bis der Animationslauf leer ist — schnelle Tipps werden sonst laut
 *  SPEC §8.9 gepuffert bzw. verworfen und der Test misst die Sperre, nicht die Regel. */
async function warteRuhig(page, ms = 8000) {
  await page.waitForFunction(() => globalThis.__pfeilspiel.beschaeftigt === false, null, { timeout: ms })
    .catch(() => {});
}

async function warteAufServer(ms = 15000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (serverTot) throw new Error(serverTot + ' — laeuft schon ein E2E-Lauf?');
    try {
      const r = await fetch(`${BASIS}/index.html`);
      if (r.ok) return true;
    } catch { /* noch nicht bereit */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

const server = spawn(process.execPath, [join(WURZEL, 'tools', 'serve.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', d => process.env.E2E_VERBOSE && process.stdout.write(`[server] ${d}`));
server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

// Stirbt der eigene Server (typischerweise EADDRINUSE, weil ein Lauf von vorher noch
// laeuft), antwortet auf dem Port ein FREMDER Server. Der Lauf wuerde dann munter
// weiterpruefen und moeglicherweise einen alten Stand testen. Also laut scheitern.
let serverTot = null;
let fertig = false;
server.on('exit', (code, signal) => {
  if (!fertig) serverTot = `Entwicklungsserver beendet (code ${code}, signal ${signal})`;
});

let browser;
try {
  if (!(await warteAufServer())) throw new Error('Entwicklungsserver ist nicht hochgekommen');
  await rm(AUS, { recursive: true, force: true });
  await mkdir(AUS, { recursive: true });

  browser = await chromium.launch({
    headless: !HEADED,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const konsole = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') konsole.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => konsole.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', r => konsole.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText || ''}`));

  // --- Start ------------------------------------------------------------
  await page.goto(`${BASIS}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__pfeilspiel, null, { timeout: 30000 });
  pruefe(true, 'Spiel startet und stellt den Testhaken bereit');

  // Die Einstellungen sind eine Schublade; fuer die Auswahlfelder muss sie offen sein.
  await page.click('#ps-btn-settings');
  await page.waitForTimeout(250);
  pruefe(await page.isVisible('#ps-skin'), 'Einstellungsschublade laesst sich oeffnen');

  const start = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  pruefe(start.lebend > 0, `Turm ist aufgebaut (${start.lebend} Wuerfel lebend)`);
  pruefe(start.moves === 0, 'Zugzaehler startet bei 0');

  const webgl = await page.evaluate(() => {
    const c = document.getElementById('ps-canvas');
    return !!(c && (c.getContext('webgl2') || c.getContext('webgl')));
  });
  pruefe(webgl, 'WebGL-Kontext auf dem Canvas vorhanden');

  const gezeichnet = await page.evaluate(() => {
    const c = document.getElementById('ps-canvas');
    return c ? { w: c.width, h: c.height } : null;
  });
  pruefe(gezeichnet && gezeichnet.w > 100 && gezeichnet.h > 100,
    `Canvas hat eine sinnvolle Groesse (${gezeichnet?.w}x${gezeichnet?.h})`);

  // --- Zuege ueber die Regel --------------------------------------------
  const legal = await page.evaluate(() => globalThis.__pfeilspiel.legaleZellen());
  pruefe(legal.length > 0, `Es gibt gueltige Zuege im Startzustand (${legal.length})`);

  await page.evaluate(cell => globalThis.__pfeilspiel.zug(cell), legal[0]);
  await page.waitForTimeout(700);
  const nach1 = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  pruefe(nach1.moves === 1, 'Ein gueltiger Zug erhoeht den Zugzaehler auf 1');
  pruefe(nach1.lebend <= start.lebend, 'Wuerfelzahl sinkt nicht unplausibel');

  const hudZuege = await page.textContent('#ps-moves');
  pruefe((hudZuege || '').includes('1'), `HUD zeigt den Zug an (#ps-moves = "${hudZuege?.trim()}")`);

  // --- Rueckgaengig ------------------------------------------------------
  await page.click('#ps-btn-undo');
  await page.waitForTimeout(600);
  const nachUndo = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  pruefe(nachUndo.moves === 0, 'Rueckgaengig setzt den Zugzaehler zurueck');
  pruefe(nachUndo.lebend === start.lebend, 'Rueckgaengig stellt den Turm wieder her');
  pruefe(nachUndo.undos === 1, 'Rueckgaengig wird separat gezaehlt');

  // --- mehrere Zuege in Folge -------------------------------------------
  let gespielt = 0;
  for (let i = 0; i < 12; i++) {
    await warteRuhig(page);
    const z = await page.evaluate(() => globalThis.__pfeilspiel.legaleZellen());
    if (!z.length) break;
    await page.evaluate(cell => globalThis.__pfeilspiel.zug(cell), z[Math.floor(z.length / 2)]);
    gespielt++;
  }
  await warteRuhig(page);
  const nachViel = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  pruefe(nachViel.moves === gespielt, `${gespielt} Zuege in Folge werden korrekt gezaehlt`);

  // --- Zeigerklick auf den Turm -----------------------------------------
  const vorKlick = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  const box = await page.locator('#ps-canvas').boundingBox();
  let klickWirkte = false;
  for (const [dx, dy] of [[0.5, 0.45], [0.45, 0.55], [0.55, 0.5], [0.5, 0.62], [0.42, 0.4]]) {
    await page.mouse.click(box.x + box.width * dx, box.y + box.height * dy);
    await page.waitForTimeout(450);
    const s = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
    if (s.moves !== vorKlick.moves) { klickWirkte = true; break; }
  }
  pruefe(klickWirkte, 'Ein echter Mausklick auf den Turm loest einen Zug aus (Raycasting trifft)');

  // --- Drehen darf keinen Zug ausloesen ----------------------------------
  const vorDrag = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + box.width * 0.5 + i * 14, box.y + box.height * 0.5 + i * 3);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const nachDrag = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  pruefe(nachDrag.moves === vorDrag.moves, 'Ziehen dreht den Turm, ohne einen Zug auszuloesen');

  // --- Neustart ----------------------------------------------------------
  await page.click('#ps-btn-restart');
  await page.waitForTimeout(700);
  const nachNeu = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  pruefe(nachNeu.moves === 0 && nachNeu.lebend === start.lebend, 'Neustart stellt den Startzustand her');

  // --- Skins --------------------------------------------------------------
  for (const skin of ['modern', 'apple', 'arcade']) {
    await page.selectOption('#ps-skin', skin).catch(async () => {
      await page.evaluate(id => {
        const el = document.getElementById('ps-skin');
        el.value = id;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, skin);
    });
    await page.waitForTimeout(900);
    const aktiv = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-skin'),
      bg: getComputedStyle(document.body).backgroundColor,
      akzent: getComputedStyle(document.documentElement).getPropertyValue('--ps-accent').trim(),
    }));
    pruefe(aktiv.attr === skin, `Skin "${skin}" ist aktiv (data-skin="${aktiv.attr}")`);
    pruefe(!!aktiv.akzent, `Skin "${skin}" setzt --ps-accent (${aktiv.akzent})`);
    await page.screenshot({ path: join(AUS, `skin-${skin}.png`) });
  }

  // --- Turmgroesse ---------------------------------------------------------
  const groessen = await page.evaluate(() =>
    Array.from(document.getElementById('ps-size').options).map((o) => o.value));
  pruefe(groessen.includes('8x8x8') && groessen.includes('8x16x8'),
    `Groessenwahl reicht bis 8x8 Grundflaeche (${groessen.length} Eintraege)`);

  await page.evaluate(() => {
    const el = document.getElementById('ps-size');
    el.value = '8x8x8';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => globalThis.__pfeilspiel.zustand().groesse === '8x8x8', null, { timeout: 60000 });
  await page.waitForFunction(() => globalThis.__pfeilspiel.beschaeftigt === false, null, { timeout: 30000 });
  const gross = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  pruefe(gross.groesse === '8x8x8' && gross.lebend > 200,
    `Turm 8x8x8 laedt (${gross.lebend} Steine)`);
  const grossLegal = await page.evaluate(() => globalThis.__pfeilspiel.legaleZellen());
  pruefe(grossLegal.length > 0, `8x8x8 hat gueltige Zuege (${grossLegal.length})`);
  await page.screenshot({ path: join(AUS, 'turm-8x8x8.png') });

  // Der einzige Richtungsmodus ist VOLUMEN; die Schalenvariante ist entfallen.
  pruefe(gross.modus === 'VOLUMEN', 'Richtungsmodus ist VOLUMEN');
  pruefe(await page.evaluate(() => document.getElementById('ps-mode') === null),
    'die Modusauswahl ist aus der Oberflaeche verschwunden');

  await page.evaluate(() => {
    const el = document.getElementById('ps-size');
    el.value = '4x6x4';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => globalThis.__pfeilspiel.zustand().groesse === '4x6x4', null, { timeout: 60000 });
  await page.waitForFunction(() => globalThis.__pfeilspiel.beschaeftigt === false, null, { timeout: 30000 });
  pruefe(true, 'Rueckwechsel auf einen kleinen Turm funktioniert');

  // --- 2x1-Steine muessen antippbar sein ---------------------------------
  // Ein 2x1-Stein ist im Szenengraph eine Group aus drei Meshes. Ein nicht rekursiver
  // Strahl trifft eine Group nie — die langen Steine liessen sich dann ueberhaupt nicht
  // entfernen, obwohl die Regel sie erlaubt. Geprueft wird deshalb der ECHTE Strahl.
  //
  // Zwei Feinheiten: legalCells nennt BEIDE Zellen eines langen Steins, die Trefferzelle
  // ist aber immer der Anker; und ein davorstehender Stein darf einen Anker verdecken.
  // Gezaehlt wird also je STEIN, und es genuegt, dass irgendeine seiner Stellen ihn meldet.
  const langePruefung = await page.evaluate(() => {
    const P = globalThis.__pfeilspiel;
    const st = P.session.state;
    const steine = new Map();       // cubeId -> Zellen des Steins
    for (const cell of P.legaleZellen()) {
      const id = st.occ[cell];
      if (id < 0 || st.extOf[id] === 255) continue;
      const anker = st.cellOf[id];
      const zweite = P.board.step[anker * 6 + st.extOf[id]];
      steine.set(id, { anker, zellen: [anker, zweite] });
    }
    let getroffen = 0;
    for (const { anker, zellen } of steine.values()) {
      let ok = false;
      for (const c of zellen) {
        const o = P.ortVonZelle(c);
        if (P.zelleAnPunkt(o.x, o.y) === anker) { ok = true; break; }
      }
      if (ok) getroffen++;
    }
    return { steine: steine.size, getroffen };
  });
  pruefe(langePruefung.steine > 0, `Es gibt ziehbare 2x1-Steine (${langePruefung.steine})`);
  pruefe(langePruefung.getroffen > 0,
    `Der Strahl trifft 2x1-Steine (${langePruefung.getroffen}/${langePruefung.steine} sichtbar)`);

  // Und ein echter Klick auf einen davon entfernt ihn wirklich.
  const ziel = await page.evaluate(() => {
    const P = globalThis.__pfeilspiel;
    const st = P.session.state;
    const gesehen = new Set();
    for (const cell of P.legaleZellen()) {
      const id = st.occ[cell];
      if (id < 0 || st.extOf[id] === 255 || gesehen.has(id)) continue;
      gesehen.add(id);
      const anker = st.cellOf[id];
      for (const c of [anker, P.board.step[anker * 6 + st.extOf[id]]]) {
        const o = P.ortVonZelle(c);
        if (P.zelleAnPunkt(o.x, o.y) === anker) return { anker, x: o.x, y: o.y };
      }
    }
    return null;
  });
  let langWeg = false;
  let langWarum = 'kein sichtbarer 2x1-Stein gefunden';
  if (ziel) {
    const vor = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
    // Die Kamera muss zur Ruhe gekommen sein: ein Tap waehrend des Daempfungsnachlaufs
    // gilt als Wischen und wird absichtlich verworfen (SPEC §8.7).
    await page.waitForTimeout(700);
    await page.mouse.click(ziel.x, ziel.y);
    await page.waitForFunction(() => globalThis.__pfeilspiel.beschaeftigt === false,
      null, { timeout: 15000 });
    const nach = await page.evaluate((z) => {
      const P = globalThis.__pfeilspiel;
      return {
        moves: P.zustand().moves,
        leer: P.session.state.occ[z.anker] === -1,
        jetztDort: P.zelleAnPunkt(z.x, z.y)
      };
    }, ziel);
    langWeg = nach.leer && nach.moves === vor.moves + 1;
    langWarum = `Anker ${ziel.anker}: Zuege ${vor.moves}->${nach.moves}, `
      + `Zelle ${nach.leer ? 'leer' : 'noch belegt'}, Strahl trifft jetzt ${nach.jetztDort}`;
  }
  pruefe(langWeg, 'Ein echter Klick auf einen 2x1-Stein entfernt ihn — ' + langWarum);

  // --- Figuren ------------------------------------------------------------
  // Eine Figur ist eine Setzbeschraenkung, keine Regelaenderung: der Turm wird zur
  // Silhouette, alles andere bleibt (SPEC §2.5).
  const figurListe = await page.evaluate(() =>
    Array.from(document.getElementById('ps-figure').options).map((o) => o.value));
  pruefe(figurListe.length >= 6 && figurListe[0] === 'QUADER',
    `Figurauswahl bietet ${figurListe.length} Formen, Quader zuerst`);

  for (const figur of figurListe.filter((f) => f !== 'QUADER')) {
    await page.evaluate((f) => {
      const el = document.getElementById('ps-figure');
      el.value = f;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, figur);
    await page.waitForFunction((f) => globalThis.__pfeilspiel.zustand().figur === f,
      figur, { timeout: 60000 });
    await page.waitForFunction(() => globalThis.__pfeilspiel.beschaeftigt === false,
      null, { timeout: 30000 });

    const z = await page.evaluate(() => {
      const P = globalThis.__pfeilspiel;
      return { s: P.zustand(), legal: P.legaleZellen().length, C: P.board.C };
    });
    pruefe(z.s.lebend > 40 && z.legal > 0,
      `Figur ${figur} laedt (${z.s.lebend} Steine in ${z.s.groesse}, ${z.legal} Zuege)`);
    // Eine Figur belegt nie den ganzen Kasten — sonst waere es der Quader.
    pruefe(z.s.lebend < z.C,
      `Figur ${figur} laesst Raum frei (${z.s.lebend} von ${z.C} Zellen)`);
    // Bildschirmfoto ist Dokumentation, keine Pruefung: der Softwarerenderer braucht bei
    // grossen Figuren gelegentlich laenger als das Standardzeitlimit. Ein Fehlschlag hier
    // darf den Lauf nicht abbrechen — die Zusagen oben sind bereits geprueft.
    await page.screenshot({ path: join(AUS, `figur-${figur.toLowerCase()}.png`), timeout: 60000 })
      .catch((e) => console.log('      (kein Bild von ' + figur + ': ' + e.message.split('\n')[0] + ')'));
  }

  // Zurueck auf den Quader, damit die folgenden Pruefungen den Turm sehen.
  await page.evaluate(() => {
    const el = document.getElementById('ps-figure');
    el.value = 'QUADER';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => globalThis.__pfeilspiel.zustand().figur === 'QUADER',
    null, { timeout: 60000 });
  await page.waitForFunction(() => globalThis.__pfeilspiel.beschaeftigt === false,
    null, { timeout: 30000 });
  pruefe(true, 'Rueckwechsel auf den vollen Quader funktioniert');

  // --- Drehen um alle drei Achsen -----------------------------------------
  // OrbitControls klemmte den Polarwinkel hart: ueber den Scheitel kam man nie. Mit
  // TrackballControls darf der Turm ueberkopf stehen und rollen (SPEC §8.4).
  const kamVor = await page.evaluate(() => globalThis.__pfeilspiel.kamera());
  const kbox = await page.locator('#ps-canvas').boundingBox();
  const kx = kbox.x + kbox.width / 2, ky = kbox.y + kbox.height / 2;

  await page.mouse.move(kx, ky + 200);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(kx, ky + 200 - i * 12);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const kamUeber = await page.evaluate(() => globalThis.__pfeilspiel.kamera());
  pruefe(kamUeber.hoehenwinkelGrad < -20,
    `Senkrechtes Ziehen fuehrt ueber den Scheitel hinweg (${kamVor.hoehenwinkelGrad}° -> ${kamUeber.hoehenwinkelGrad}°)`);
  pruefe(kamUeber.obenY < 0,
    `Der Turm darf ueberkopf stehen (camera.up.y = ${kamUeber.obenY})`);
  await page.screenshot({ path: join(AUS, 'drehung-ueberkopf.png') });

  // Rollen: waagrecht ziehen weit ausserhalb der Bildmitte.
  await page.mouse.move(kx + 500, ky - 350);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(kx + 500 - i * 20, ky - 350);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const kamRoll = await page.evaluate(() => globalThis.__pfeilspiel.kamera());
  pruefe(Math.abs(kamRoll.obenY) < 0.98,
    `Rollen kippt die Aufrechte (camera.up.y = ${kamRoll.obenY})`);

  // Nach alldem muss das Spiel noch spielbar sein.
  const nachDrehen = await page.evaluate(() => globalThis.__pfeilspiel.legaleZellen().length);
  pruefe(nachDrehen > 0, `Nach freiem Drehen gibt es weiter gueltige Zuege (${nachDrehen})`);
  await page.click('#ps-btn-restart');
  await page.waitForTimeout(700);

  // --- Zielmodus BEFREIUNG -------------------------------------------------
  await page.evaluate(() => {
    const el = document.getElementById('ps-goal');
    el.value = 'BEFREIUNG';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => globalThis.__pfeilspiel.zustand().ziel === 'BEFREIUNG', null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const bef = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
  pruefe(bef.ziel === 'BEFREIUNG' && bef.lebend > 0, 'Zielmodus BEFREIUNG laedt');
  await page.screenshot({ path: join(AUS, 'ziel-befreiung.png') });

  // --- Sieg durchspielen ---------------------------------------------------
  let sieg = false;
  for (let i = 0; i < 600; i++) {
    await warteRuhig(page, 4000);
    const z = await page.evaluate(() => globalThis.__pfeilspiel.legaleZellen());
    if (!z.length) break;
    await page.evaluate(cell => globalThis.__pfeilspiel.zug(cell), z[0]);
    const s = await page.evaluate(() => globalThis.__pfeilspiel.zustand());
    if (s.won) { sieg = true; break; }
  }
  await warteRuhig(page, 8000);
  if (sieg) {
    await page.waitForSelector('#ps-win:not([hidden])', { timeout: 8000 }).catch(() => {});
    const winSichtbar = await page.isVisible('#ps-win');
    pruefe(winSichtbar, 'Sieg-Overlay erscheint nach gewonnenem Level');
    await page.screenshot({ path: join(AUS, 'sieg.png') });
  } else {
    console.log('hinw  Sieg wurde durch gieriges Spiel nicht erreicht (Sackgasse) — kein Fehler der Umsetzung');
    const dead = await page.isVisible('#ps-deadend');
    pruefe(dead, 'Bei Sackgasse erscheint das Sackgassen-Overlay');
    await page.screenshot({ path: join(AUS, 'sackgasse.png') });
  }

  // --- Bestenliste ----------------------------------------------------------
  await page.evaluate(() => {
    document.getElementById('ps-win')?.setAttribute('hidden', '');
    document.getElementById('ps-deadend')?.setAttribute('hidden', '');
  });
  await page.click('#ps-btn-board');
  await page.waitForTimeout(900);
  const boardOffen = await page.isVisible('#ps-board');
  pruefe(boardOffen, 'Bestenlisten-Overlay laesst sich oeffnen');
  await page.screenshot({ path: join(AUS, 'bestenliste.png') });

  // --- Mobilansicht ---------------------------------------------------------
  const mobil = await ctx.newPage();
  await mobil.goto(`${BASIS}/`, { waitUntil: 'domcontentloaded' });
  await mobil.setViewportSize({ width: 390, height: 844 });
  await mobil.waitForFunction(() => !!globalThis.__pfeilspiel, null, { timeout: 30000 });
  await mobil.waitForTimeout(1200);
  const ueberlauf = await mobil.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  pruefe(ueberlauf <= 2, `Hochformat 390px laeuft nicht seitlich ueber (Ueberhang ${ueberlauf}px)`);
  await mobil.screenshot({ path: join(AUS, 'mobil.png') });
  await mobil.close();

  // --- Konsole ---------------------------------------------------------------
  const echte = konsole.filter(z => !/favicon|DevTools|Autofocus|SwiftShader|GroupMarkerNotSet|Fallback to SwiftShader/i.test(z));
  if (echte.length) {
    console.log('\nMeldungen aus der Browserkonsole:');
    for (const z of echte.slice(0, 25)) console.log('   ' + z);
  }
  pruefe(echte.filter(z => z.startsWith('[pageerror]') || z.startsWith('[error]')).length === 0,
    'Keine Fehler in der Browserkonsole');

  await ctx.close();
} catch (e) {
  fehler.push(`Ausnahme: ${e.message}`);
  console.error('\nAbbruch:', e);
} finally {
  fertig = true;
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}

console.log(`\n${schritte.filter(s => s.ok).length}/${schritte.length} Pruefungen bestanden. Bilder in ${AUS}`);
if (fehler.length) {
  console.error(`\n${fehler.length} FEHLGESCHLAGEN:`);
  for (const f of fehler) console.error('  - ' + f);
  process.exit(1);
}
console.log('E2E gruen.');
