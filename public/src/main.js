// Pfeilspiel — Bootstrap und Verdrahtung (SPEC §4.7).
//
// Diese Datei ist die einzige Stelle, an der Regelkern, Generator, Renderschicht,
// Skins, Oberflaeche und Bestenlisten-Client zusammenkommen. Sie haelt keinen
// eigenen Regelcode: jede Zugentscheidung kommt aus game.js, jedes Level aus
// levels.js (samt Pflichtverifikation), jede Darstellung aus render.js.

import {
  buildBoard, createSession, tap, undo, restart, tickClock, toRunLog,
  resolveMove, hasAnyMove, legalCells
} from './game.js';
import {
  levelSpecFor, generateLevel, parseHash, encodeHash, measureLevel, GROESSEN
} from './levels.js';
import {
  createRenderer, createScene, createCamera, createControls, fitCamera,
  updateKeyLight, attachResize, startLoop, createTowerView, createAnimRunner,
  buildTweens, shakeWorld, createPointerInput
} from './render.js';
import { getSkin, resolveSkinId, applySkinDom, applySkinThree, createAudio } from './skins.js';
import { TEXTE, createUI } from './ui.js';
import { getScores, postScore, newUuid, clientId } from './api.js';

/** Version dieser Auslieferung; geht als appVersion an die Bestenliste (§9.4). */
const APP_VERSION = '1.0.0';

const SPEICHER = Object.freeze({
  level: 'pfeilspiel.levelNo',
  tempo: 'pfeilspiel.speed',
  ton: 'pfeilspiel.muted',
  xray: 'pfeilspiel.xray'
});

// --- kleine Helfer ------------------------------------------------------

function lies(schluessel) {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(schluessel);
  } catch (fehler) {
    return null;
  }
}

function schreib(schluessel, wert) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(schluessel, String(wert));
  } catch (fehler) {
    /* Privater Modus: dann wird eben nichts gemerkt. */
  }
}

function zahlAus(text, ersatz) {
  const n = Number(text);
  return Number.isFinite(n) ? n : ersatz;
}

/** Neuer Startwert fuer den Generator; kein Bestandteil des deterministischen Pfads. */
function neuerSeed() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] >>> 0;
    }
  } catch (fehler) {
    /* weiter unten */
  }
  return (Date.now() ^ (Math.floor(Math.random() * 0xffffffff))) >>> 0;
}

/**
 * Identitaetsstiftende Felder einer LevelSpec und sonst nichts.
 *
 * Wichtig fuer die Nachpruefbarkeit: der Levelcode (§4.2) traegt nur Modus, Ziel,
 * Masse, Versuch und Seed. Wuerde main.js zusaetzlich Dichte oder Steinanteil setzen,
 * koennte der Worker das Level aus dem Code nicht mehr bitgleich regenerieren
 * (§9.4). levels.js ergaenzt die Kurvenparameter selbst.
 */
function basisSpec(mode, goal, W, H, D, seed) {
  return { mode, goal, W, H, D, seed: seed >>> 0, attempt: 0 };
}

function naechstesBild() {
  return new Promise((fertig) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fertig());
    else setTimeout(fertig, 0);
  });
}

function beiLeerlauf(fn) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 0);
}

/**
 * Motion-Token fuer prefers-reduced-motion: Bogen, Spin und Screenshake aus (§8.8).
 * Die Renderschicht liest die Medienabfrage nicht selbst, sie folgt nur den Token.
 */
function ruhigeBewegung(skin) {
  const m = skin.motion;
  return Object.assign({}, skin, {
    motion: Object.assign({}, m, {
      jump: Object.assign({}, m.jump, { arc: 0 }),
      fly: Object.assign({}, m.fly, { spin: 0 }),
      shake: Object.assign({}, m.shake, { amp: 0, dur: 0 })
    })
  });
}

// --- Bootstrap ----------------------------------------------------------

/** @returns {Promise<void>} */
export async function boot() {
  const canvas = document.getElementById('ps-canvas');
  const stage = document.getElementById('ps-stage') || document.body;
  const hudNode = document.getElementById('ps-hud');
  if (!canvas) throw new Error('boot: #ps-canvas fehlt');

  // 1. Levelwahl: URL-Hash schlaegt gespeicherte Levelnummer (§4.7.1).
  let levelNo = Math.max(1, Math.trunc(zahlAus(lies(SPEICHER.level), 1)));
  const hashSpec = parseHash(typeof location !== 'undefined' ? location.hash : '');
  let spec = hashSpec || levelSpecFor(levelNo);
  let aufKurve = !hashSpec;

  // 2. Board und Level. verifyLevel steckt in generateLevel (§6.8).
  const boards = new Map();
  function boardFuer(s) {
    const key = s.mode + '|' + s.W + 'x' + s.H + 'x' + s.D;
    let b = boards.get(key);
    if (!b) { b = buildBoard({ mode: s.mode, W: s.W, H: s.H, D: s.D }); boards.set(key, b); }
    return b;
  }

  let board = boardFuer(spec);
  let level = generateLevel(spec);
  let session = createSession(board, level);

  // 3. Renderer, Szene, Kamera, Controls, Framing (§4.7.3).
  const renderer = createRenderer(canvas);
  const welt = createScene(renderer);
  const scene = welt.scene;
  const lights = welt.lights;
  const camera = createCamera(Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight));
  const controls = createControls(camera, canvas);
  let dist = fitCamera(camera, controls, level.dims, 1.0, 1.15, hudAnteil());

  // 4. Skin (§4.7.4).
  let skinId = resolveSkinId(lies('pfeilspiel.skin') || undefined);
  let skin = getSkin(skinId);
  applySkinDom(skin);

  // 5. Ansicht, Oberflaeche, Eingabe, Animationslauf (§4.7.5).
  let neuZeichnen = true;
  const anfordern = () => { neuZeichnen = true; };

  let view = createTowerView({ scene, renderer, board, skin, requestRender: anfordern });
  view.build(level);
  applySkinThree(skin, { renderer, scene, lights, view, worldRig: welt.worldRig });

  const anim = createAnimRunner();
  const audio = createAudio();
  audio.setProfile(skin.audio);

  const reduziertMq = (typeof matchMedia === 'function')
    ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduziert = reduziertMq ? reduziertMq.matches : false;
  let tempo = zahlAus(lies(SPEICHER.tempo), 1);
  if (![0.5, 1, 1.5, 2].includes(tempo)) tempo = 1;
  let stumm = lies(SPEICHER.ton) === '1';
  let roentgen = lies(SPEICHER.xray) === '1';

  function tempoAnwenden() {
    anim.speed = reduziert ? 0.35 : tempo;
  }
  tempoAnwenden();
  audio.setMuted(stumm);
  if (roentgen) view.setXray(true);

  if (reduziertMq && typeof reduziertMq.addEventListener === 'function') {
    reduziertMq.addEventListener('change', (ev) => { reduziert = !!ev.matches; tempoAnwenden(); });
  }

  /** Skin, dessen Bewegungstoken der Nutzervorgabe folgen. */
  function bewegungsSkin() {
    return reduziert ? ruhigeBewegung(skin) : skin;
  }

  const ui = createUI({
    onNew: () => { klang('ui'); neuesLevel(); },
    onUndo: () => zuruecknehmen(),
    onRestart: () => neustart(),
    onSkin: (id) => skinWechseln(id),
    onSize: (g) => groesseWechseln(g),
    onGoal: (g) => zielWechseln(g),
    onLevel: (n) => levelWaehlen(n),
    onSpeed: (f) => { tempo = f; schreib(SPEICHER.tempo, f); tempoAnwenden(); },
    onXray: (an) => {
      roentgen = !!an;
      schreib(SPEICHER.xray, roentgen ? '1' : '0');
      view.setXray(roentgen);
      ui.toast(roentgen ? TEXTE.meldungRoentgenAn : TEXTE.meldungRoentgenAus);
    },
    onMute: (aus) => {
      stumm = !!aus;
      schreib(SPEICHER.ton, stumm ? '1' : '0');
      audio.setMuted(stumm);
      ui.toast(stumm ? TEXTE.meldungTonAus : TEXTE.meldungTonAn);
    },
    onShowBoard: () => { klang('ui'); bestenlisteZeigen(); },
    onSubmitScore: (name) => eintragSenden(name)
  });

  ui.setSizes(GROESSEN, spec.W + 'x' + spec.H + 'x' + spec.D);
  ui.setControls({
    skin: skinId, size: spec.W + 'x' + spec.H + 'x' + spec.D, goal: spec.goal, level: levelNo,
    speed: tempo, xray: roentgen, muted: stumm
  });

  const input = createPointerInput({
    canvas,
    camera,
    pickRoot: welt.towerGroup,
    controls,
    onTap: (cell) => spielZug(cell),
    onHover: (cell) => vorschau(cell),
    onLongPress: (unten) => view.setXray(roentgen || unten),
    onActivity: () => tonFreischalten()
  });

  const resizeAb = attachResize(renderer, camera, stage, () => {
    // TrackballControls rechnet in Bildschirmkoordinaten und merkt sich die Flaeche
    // des Canvas. Ohne handleResize() nach jeder Groessenaenderung dreht der Turm
    // schief oder gar nicht mehr.
    controls.handleResize();
    // Refit ohne Blickwinkelverlust: getweent wird nur die Distanz.
    dist = fitCamera(camera, controls, level.dims, 1.0, 1.15, hudAnteil(),
      { anim, durMs: 0 });
    anfordern();
  });

  /** Rundungsfehler koennen |v| minimal ueber 1 treiben; asin lieferte dann NaN. */
  function clampEins(v) { return v < -1 ? -1 : (v > 1 ? 1 : v); }

  // --- HUD-Anteil des Bildschirms --------------------------------------
  function hudAnteil() {
    const h = Math.max(1, stage.clientHeight || 1);
    const hud = hudNode ? hudNode.offsetHeight : 0;
    return Math.min(0.4, Math.max(0, (hud + 12) / h));
  }

  // --- Klang ------------------------------------------------------------
  let tonBereit = false;

  function tonFreischalten() {
    if (tonBereit) return;
    tonBereit = true;
    audio.unlock().then(() => audio.setProfile(skin.audio), () => { tonBereit = false; });
  }

  function klang(ereignis) {
    if (!skin.fx || !skin.fx.sounds) return;
    audio.play(ereignis);
  }

  // --- Zugverarbeitung --------------------------------------------------
  let siegGezeigt = false;
  let sackgasseGezeigt = true;
  let runId = newUuid();
  let letzteSekunde = -1;

  function spielZug(cell) {
    if (!Number.isInteger(cell) || cell < 0) return;
    if (session.won) return;
    if (anim.strictLock && anim.busy) { anim.buffer(cell); return; }

    // Pro-Wuerfel-Sperre (§8.9.2) plus Ein-Slot-Puffer (§8.9.3).
    const id = session.state.occ[cell];
    if (id >= 0) {
      const ref = view.get(id);
      if (ref && ref.busy) { anim.buffer(cell); return; }
    }

    view.setPreview(null);
    const move = tap(session, cell);

    anim.playSequence(buildTweens(view, board, move, bewegungsSkin()));

    if (move.kind === 'INVALID') {
      klang('invalid');
      anfordern();
      return;
    }

    if (move.kind === 'EXIT') {
      klang('fly');
      if (skin.fx && skin.fx.screenShake && !reduziert && skin.motion.shake.amp > 0) {
        anim.play(shakeWorld(welt.worldRig, skin.motion.shake.amp, skin.motion.shake.dur));
      }
    }

    ui.setMoves(session.moves);
    ui.setUndos(session.undos);
    hashSchreiben();

    if (!session.won && !hasAnyMove(board, session.state)) sackgasseGezeigt = false;
    anfordern();
  }

  function vorschau(cell) {
    if (cell === null || cell === undefined || cell < 0) {
      view.setHovered(null);
      view.setPreview(null);
      return;
    }
    const id = session.state.occ[cell];
    view.setHovered(id >= 0 ? id : null);
    if (id < 0) { view.setPreview(null); return; }
    const m = resolveMove(board, session.state, cell);
    view.setPreview(m.kind === 'INVALID' ? null : m);
  }

  /** Overlays erst zeigen, wenn die Animation durch ist — sonst sieht man den Zug nicht. */
  function overlaysPruefen() {
    if (anim.busy) return;
    if (session.won) {
      if (siegGezeigt) return;
      siegGezeigt = true;
      klang('win');
      ui.showWin({
        moves: session.moves,
        timeMs: Math.round(session.clockMs),
        par: level.par,
        stars: level.stars,
        undos: session.undos
      });
      return;
    }
    if (!sackgasseGezeigt && !hasAnyMove(board, session.state)) {
      sackgasseGezeigt = true;
      ui.showDeadEnd();
    }
  }

  function zuruecknehmen() {
    anim.finishAll();
    if (!undo(session)) { ui.toast(TEXTE.meldungKeinUndo); return; }
    view.snapAll(session.state);
    if (roentgen) view.setXray(true);
    siegGezeigt = false;
    sackgasseGezeigt = true;
    ui.hideWin();
    ui.hideDeadEnd();
    ui.setMoves(session.moves);
    ui.setUndos(session.undos);
    ui.setTimer(session.clockMs);
    letzteSekunde = Math.floor(session.clockMs / 1000);
    klang('undo');
    ui.toast(TEXTE.meldungUndo);
    anfordern();
  }

  function neustart() {
    anim.finishAll();
    restart(session);
    view.build(level);
    if (roentgen) view.setXray(true);
    siegGezeigt = false;
    sackgasseGezeigt = true;
    runId = newUuid();
    ui.hideWin();
    ui.hideDeadEnd();
    ui.setMoves(0);
    ui.setUndos(session.undos);
    ui.setTimer(0);
    letzteSekunde = 0;
    klang('ui');
    ui.toast(TEXTE.meldungNeustart);
    anfordern();
  }

  // --- Levelwechsel -----------------------------------------------------
  let laedt = false;

  async function ladeLevel(neueSpec, meldung) {
    if (laedt) return;
    laedt = true;
    anim.finishAll();
    ui.setBusy(true);
    ui.hideWin();
    ui.hideDeadEnd();
    view.setPreview(null);
    view.setHovered(null);
    await naechstesBild();      // Ladeanzeige sichtbar machen, dann erst rechnen

    let neuesBoard, neuesLevel;
    try {
      neuesBoard = boardFuer(neueSpec);
      neuesLevel = generateLevel(neueSpec);
    } catch (fehler) {
      console.error('[Pfeilspiel] Levelerzeugung', fehler);
      ui.setBusy(false);
      laedt = false;
      ui.toast(TEXTE.meldungLevelFehler, 'error');
      return;
    }

    spec = neueSpec;
    level = neuesLevel;

    if (neuesBoard !== board) {
      // Variantengeometrien und Innenkern haengen am Board: Ansicht neu bauen.
      board = neuesBoard;
      view.dispose();
      view = createTowerView({ scene, renderer, board, skin, requestRender: anfordern });
      applySkinThree(skin, { renderer, scene, lights, view, worldRig: welt.worldRig });
    }

    session = createSession(board, level);
    view.build(level);
    if (roentgen) view.setXray(true);
    dist = fitCamera(camera, controls, level.dims, 1.0, 1.15, hudAnteil(), { anim, durMs: 500 });

    siegGezeigt = false;
    sackgasseGezeigt = true;
    runId = newUuid();
    letzteSekunde = 0;
    ui.setMoves(0);
    ui.setUndos(0);
    ui.setTimer(0);
    ui.setPar(level.par);
    ui.setControls({ size: spec.W + 'x' + spec.H + 'x' + spec.D, goal: spec.goal, level: levelNo });
    hashSchreiben();
    ui.setBusy(false);
    laedt = false;
    if (meldung) ui.toast(meldung);
    anfordern();
    kennzahlenNachtragen();
  }

  function neuesLevel() {
    if (aufKurve) {
      levelNo += 1;
      schreib(SPEICHER.level, levelNo);
      ladeLevel(levelSpecFor(levelNo), TEXTE.meldungNeuesLevel);
    } else {
      ladeLevel(basisSpec(spec.mode, spec.goal, spec.W, spec.H, spec.D, neuerSeed()),
        TEXTE.meldungNeuesLevel);
    }
  }

  function levelWaehlen(n) {
    const nr = Math.max(1, Math.trunc(Number(n) || 1));
    levelNo = nr;
    aufKurve = true;
    schreib(SPEICHER.level, levelNo);
    ladeLevel(levelSpecFor(levelNo), TEXTE.meldungNeuesLevel);
  }

  /**
   * Freies Spiel in der gewaehlten Turmgroesse. Die Levelkurve wird dabei verlassen: der
   * Spieler hat die Masse selbst gesetzt, eine Levelnummer waere dann irrefuehrend.
   */
  function groesseWechseln(text) {
    const teile = String(text || '').split('x').map((t) => parseInt(t, 10));
    if (teile.length !== 3 || teile.some((n) => !Number.isFinite(n))) return;
    aufKurve = false;
    ladeLevel(basisSpec('VOLUMEN', spec.goal, teile[0], teile[1], teile[2], neuerSeed()),
      TEXTE.meldungNeuesLevel);
  }

  function zielWechseln(goal) {
    aufKurve = false;
    ladeLevel(basisSpec('VOLUMEN', goal || spec.goal, spec.W, spec.H, spec.D, neuerSeed()),
      TEXTE.meldungNeuesLevel);
  }

  function skinWechseln(id) {
    let neu;
    try { neu = getSkin(id); } catch (fehler) { return; }
    anim.finishAll();
    view.snapAll(session.state);
    skinId = id;
    skin = neu;
    applySkinDom(skin);
    applySkinThree(skin, { renderer, scene, lights, view, worldRig: welt.worldRig });
    audio.setProfile(skin.audio);
    if (roentgen) view.setXray(true);
    klang('skin');
    anfordern();
  }

  function kennzahlenNachtragen() {
    // Volle Playoutzahl niemals im Levelstart-Pfad (§4.7.8, §6.7).
    const gemessen = level;
    beiLeerlauf(() => {
      if (gemessen !== level) return;
      try { gemessen.metrics = measureLevel(board, gemessen); }
      catch (fehler) { /* Kennzahlen sind Beiwerk */ }
    });
  }

  function hashSchreiben() {
    const h = encodeHash(spec);
    if (typeof history === 'undefined' || typeof history.replaceState !== 'function') return;
    if (location.hash === h) return;
    try { history.replaceState(null, '', h); } catch (fehler) { /* egal */ }
  }

  // --- Bestenliste ------------------------------------------------------
  function bestenlisteZeigen() {
    ui.toast(TEXTE.boardLade);
    getScores({
      dir: board.mode.toLowerCase(),
      goal: level.goal.toLowerCase(),
      size: { x: board.W, y: board.H, z: board.D },
      limit: 20,
      offset: 0,
      bestPerName: true
    }).then((antwort) => {
      if (antwort.ok) ui.showBoard(antwort.records);
      else ui.toast(antwort.message, 'error');
    }, () => ui.toast(TEXTE.meldungFehler, 'error'));
  }

  function eintragSenden(name) {
    const lauf = toRunLog(session, {
      name,
      runId,
      clientId: clientId(),
      appVersion: APP_VERSION
    });
    return postScore(lauf);
  }

  // --- Schleife (§4.7.6) ------------------------------------------------
  function step(dtMs, forced) {
    const kamera = controls.update(dtMs / 1000);
    const warBusy = anim.busy;
    const laeuft = anim.update(dtMs);
    input.update();

    if (!session.won) tickClock(session, dtMs);
    const sek = Math.floor(session.clockMs / 1000);
    if (sek !== letzteSekunde) { letzteSekunde = sek; ui.setTimer(session.clockMs); }

    if (warBusy && !laeuft) {
      const gepuffert = anim.takeBuffered();
      if (gepuffert !== null) spielZug(gepuffert);
    }
    overlaysPruefen();

    const zeichnen = forced || neuZeichnen || kamera || laeuft || warBusy;
    neuZeichnen = false;
    if (!zeichnen) return false;

    updateKeyLight(lights.key, camera, controls, dist);
    renderer.render(scene, camera);
    return true;
  }

  const loop = startLoop(renderer, step);

  // Startwerte des HUD
  ui.setMoves(0);
  ui.setUndos(0);
  ui.setTimer(0);
  ui.setPar(level.par);
  hashSchreiben();

  // 8. Kennzahlen erst nach dem ersten gezeichneten Bild (§4.7.8).
  await naechstesBild();
  kennzahlenNachtragen();

  // Testhaken fuer den E2E-Lauf. Nur lesende Kennzahlen plus ein Zugausloeser;
  // die Spiellogik haengt nicht davon ab.
  globalThis.__pfeilspiel = {
    get session() { return session; },
    get board() { return board; },
    get level() { return level; },
    get spec() { return spec; },
    zug: (cell) => spielZug(cell),
    get beschaeftigt() { return anim.busy; },
    legaleZellen: () => legalCells(board, session.state),
    /** Lesende Kamerakennzahlen fuer den E2E-Lauf: Hoehenwinkel und Rollen. */
    kamera: () => ({
      hoehenwinkelGrad: Math.round(Math.asin(clampEins(
        (camera.position.y - controls.target.y)
        / Math.max(1e-6, camera.position.distanceTo(controls.target))
      )) * 180 / Math.PI),
      obenY: Math.round(camera.up.y * 1000) / 1000
    }),
    /**
     * Welche Zelle meldet der ECHTE Zeigerstrahl an dieser Bildschirmstelle? Und wo
     * liegt eine Zelle auf dem Bildschirm? Beides nur lesend, fuer den E2E-Lauf: nur
     * damit laesst sich pruefen, dass ein 2x1-Stein (eine Group aus drei Meshes)
     * ueberhaupt getroffen wird und nicht bloss die Regel ihn erlauben wuerde.
     */
    zelleAnPunkt: (x, y) => {
      const hit = input.pickAt(x, y, 0);
      const c = hit && hit.object && hit.object.userData ? hit.object.userData.cell : -1;
      return Number.isInteger(c) ? c : -1;
    },
    ortVonZelle: (cell) => {
      const p = view.worldOf(cell).clone();
      const cube = view.get(session.state.occ[cell]);
      if (cube && cube.offset) p.add(cube.offset);
      welt.towerGroup.localToWorld(p);
      p.project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
    },
    zustand: () => ({
      moves: session.moves,
      undos: session.undos,
      won: session.won,
      lebend: session.state.aliveCount,
      par: level.par,
      modus: spec.mode,
      ziel: spec.goal,
      groesse: spec.W + 'x' + spec.H + 'x' + spec.D,
    }),
  };

  if (typeof addEventListener === 'function') {
    addEventListener('hashchange', () => {
      const s = parseHash(location.hash);
      if (!s) return;
      if (encodeHash(s) === encodeHash(spec)) return;
      aufKurve = false;
      ladeLevel(s, TEXTE.meldungNeuesLevel);
    });
    addEventListener('pagehide', () => {
      loop.stop();
      resizeAb();
      input.dispose();
      audio.dispose();
    }, { once: true });
  }
}

// --- Selbstaufruf am Modulende (§4.7) -----------------------------------

boot().catch((fehler) => {
  console.error('[Pfeilspiel] Start fehlgeschlagen', fehler);
  const hinweis = document.createElement('div');
  hinweis.className = 'ps-noscript';
  hinweis.textContent = TEXTE.meldungFehler;
  document.body.appendChild(hinweis);
});
