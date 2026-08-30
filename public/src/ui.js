// Pfeilspiel — HUD, Overlays und alle deutschen Texte (SPEC 4.5, 1.4, 1.5).
//
// Diese Datei ist die einzige Quelle der deutschen Oberflaechentexte: index.html
// traegt nur das Geruest, jedes sichtbare Wort wird hier aus TEXTE gesetzt
// (data-ps-t = Textinhalt, data-ps-ta = aria-label, data-ps-tp = Platzhalter,
// data-ps-tt = title).
//
// Kein Framework, kein three, kein innerHTML: Namen aus der Bestenliste landen
// ausschliesslich per textContent im Dokument.

/**
 * Alle deutschen Zeichenketten der Oberflaeche.
 * Platzhalter der Form {name} werden von fmt() ersetzt.
 * @type {Record<string, string>}
 */
export const TEXTE = {
  // Titel und Beschriftungen des Geruests
  appTitle: 'Pfeilspiel',
  canvasLabel: 'Turm aus Pfeilwürfeln, drehbar und zoombar',
  navLabel: 'Spielsteuerung',
  settingsLabel: 'Einstellungen',

  // Kopfzeile
  labelMoves: 'Züge',
  labelTime: 'Zeit',
  labelPar: 'Richtwert',
  labelUndos: 'Rückgängig',

  // Schaltflaechen
  btnNew: 'Neues Level',
  btnUndo: 'Rückgängig',
  btnRestart: 'Neustart',
  btnBoard: 'Bestenliste',
  btnSettings: 'Einstellungen',
  btnClose: 'Schließen',
  btnNext: 'Weiter',
  btnSubmit: 'Eintragen',

  // Einstellungen
  labelSkin: 'Erscheinungsbild',
  skinModern: 'Modern',
  skinApple: 'Apple',
  skinArcade: 'Arcade',
  labelMode: 'Richtungsmodus',
  modeFassade: 'Fassade',
  modeVolumen: 'Volumen',
  labelGoal: 'Zielmodus',
  goalAbbau: 'Abbau',
  goalBefreiung: 'Befreiung',
  labelLevel: 'Levelnummer',
  labelSpeed: 'Tempo',
  speedSlow: 'Ruhig (0,5×)',
  speedNormal: 'Normal (1×)',
  speedFast: 'Flott (1,5×)',
  speedTurbo: 'Schnell (2×)',
  labelXray: 'Röntgen',
  labelMute: 'Ton aus',

  // Sieg
  winTitle: 'Geschafft!',
  winSub3: 'Drei Sterne: {moves} Züge, der Richtwert liegt bei {par}.',
  winSub2: 'Zwei Sterne: {moves} Züge, der Richtwert liegt bei {par}.',
  winSub1: 'Ein Stern: {moves} Züge, der Richtwert liegt bei {par}.',
  winSub0: 'Gelöst in {moves} Zügen. Der Richtwert liegt bei {par}.',
  labelName: 'Name für die Bestenliste',
  namePlaceholder: 'Name eingeben',
  hinweisNameKurz: 'Bitte einen Namen mit mindestens zwei Zeichen eingeben.',
  hinweisSenden: 'Eintrag wird gesendet …',
  hinweisGesendet: 'Eintrag gespeichert.',
  hinweisGesendetPlatz: 'Eintrag gespeichert: Platz {rank} von {total}.',
  hinweisSendenFehler: 'Der Eintrag konnte nicht gespeichert werden.',

  // Sackgasse
  deadEndTitle: 'Kein Zug mehr möglich',
  deadEndText: 'Von hier führt kein gültiger Zug mehr weiter. '
    + 'Nimm den letzten Zug zurück oder starte das Level neu. '
    + 'Zurückgesetzt wird nie von selbst.',

  // Bestenliste
  boardTitle: 'Bestenliste',
  colRank: 'Platz',
  colName: 'Name',
  colMoves: 'Züge',
  colTime: 'Zeit',
  colUndos: 'Zurück',
  colSize: 'Größe',
  colMode: 'Modus',
  boardEmpty: 'Noch keine Einträge vorhanden.',
  boardLade: 'Bestenliste wird geladen …',

  // Meldungen
  meldungBlockiert: 'Dieser Würfel ist blockiert.',
  meldungKeinUndo: 'Es gibt nichts zum Rückgängigmachen.',
  meldungUndo: 'Zug zurückgenommen.',
  meldungNeustart: 'Level neu gestartet.',
  meldungNeuesLevel: 'Neues Level geladen.',
  meldungLevelFehler: 'Dieses Level konnte nicht erzeugt werden.',
  meldungFehler: 'Da ist etwas schiefgegangen.',
  meldungRoentgenAn: 'Röntgen an.',
  meldungRoentgenAus: 'Röntgen aus.',
  meldungTonAn: 'Ton an.',
  meldungTonAus: 'Ton aus.',
  meldungLinkKopiert: 'Link zum Level kopiert.',

  // Kurzformen fuer Tabellenzellen
  kurzFassade: 'Fassade',
  kurzVolumen: 'Volumen',
  kurzAbbau: 'Abbau',
  kurzBefreiung: 'Befreiung',
  trennerModus: ' · ',
  leerwert: '–'
};

/** Ersetzt {schluessel} in einer Vorlage. */
function fmt(vorlage, werte) {
  const w = werte || {};
  return String(vorlage).replace(/\{(\w+)\}/g, (treffer, name) =>
    Object.prototype.hasOwnProperty.call(w, name) ? String(w[name]) : treffer);
}

/** Millisekunden als m:ss beziehungsweise h:mm:ss. */
function formatZeit(ms) {
  const gesamt = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
  const s = Math.floor(gesamt % 60);
  const m = Math.floor((gesamt / 60) % 60);
  const h = Math.floor(gesamt / 3600);
  const zwei = (n) => (n < 10 ? '0' + n : String(n));
  return h > 0 ? h + ':' + zwei(m) + ':' + zwei(s) : m + ':' + zwei(s);
}

/** Ganze Zahl oder Gedankenstrich. */
function formatZahl(n) {
  return Number.isFinite(Number(n)) ? String(Math.trunc(Number(n))) : TEXTE.leerwert;
}

/** Anzahl der Sterne aus Zugzahl und Schwellen [par, ~1.12par, ~1.25par]. */
function sterneFuer(moves, stars, par) {
  const s = Array.isArray(stars) && stars.length === 3
    ? stars
    : [par, Math.ceil(par * 1.12), Math.ceil(par * 1.25)];
  if (!Number.isFinite(moves)) return 0;
  if (moves <= s[0]) return 3;
  if (moves <= s[1]) return 2;
  if (moves <= s[2]) return 1;
  return 0;
}

/** Beschriftung eines Richtungs- oder Zielmodus, gross- und kleingeschrieben. */
function modusText(wert) {
  const k = String(wert || '').toUpperCase();
  if (k === 'FASSADE') return TEXTE.kurzFassade;
  if (k === 'VOLUMEN') return TEXTE.kurzVolumen;
  if (k === 'ABBAU') return TEXTE.kurzAbbau;
  if (k === 'BEFREIUNG') return TEXTE.kurzBefreiung;
  return String(wert || TEXTE.leerwert);
}

/** Groessenschluessel einer Bestenlistenzeile. */
function groesseText(row) {
  if (row && typeof row.sizeKey === 'string' && row.sizeKey) return row.sizeKey;
  const s = row && row.size;
  if (s && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)) {
    return s.x + '×' + s.y + '×' + s.z;
  }
  return TEXTE.leerwert;
}

const SPEICHER_NAME = 'pfeilspiel.name';

function leseName() {
  try {
    return window.localStorage.getItem(SPEICHER_NAME) || '';
  } catch {
    return '';
  }
}

function schreibeName(name) {
  try {
    window.localStorage.setItem(SPEICHER_NAME, name);
  } catch {
    /* Privater Modus: der Name wird dann eben nicht gemerkt. */
  }
}

/** Fokussierbare Elemente eines Overlays, fuer die Tabulatorschleife. */
const FOKUS_SELEKTOR = 'button:not([disabled]), [href], input:not([disabled]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Baut die Oberflaeche auf und verdrahtet sie mit den Rueckrufen.
 *
 * @param {{
 *   onNew?: function, onUndo?: function, onRestart?: function,
 *   onSkin?: function, onMode?: function, onGoal?: function, onLevel?: function,
 *   onSubmitScore?: function, onShowBoard?: function,
 *   onXray?: function, onSpeed?: function, onMute?: function
 * }} [handlers]
 * @returns {object} UI
 */
export function createUI(handlers) {
  const h = handlers || {};
  const doc = document;
  const id = (name) => doc.getElementById(name);

  const E = {
    hud: id('ps-hud'),
    moves: id('ps-moves'),
    timer: id('ps-timer'),
    par: id('ps-par'),
    undos: id('ps-undos'),
    btnNew: id('ps-btn-new'),
    btnUndo: id('ps-btn-undo'),
    btnRestart: id('ps-btn-restart'),
    btnBoard: id('ps-btn-board'),
    btnSettings: id('ps-btn-settings'),
    settings: id('ps-settings'),
    skin: id('ps-skin'),
    skinChip: id('ps-skin-chip'),
    mode: id('ps-mode'),
    goal: id('ps-goal'),
    level: id('ps-level'),
    speed: id('ps-speed'),
    xray: id('ps-xray'),
    xrayLabel: id('ps-xray-label'),
    mute: id('ps-mute'),
    muteLabel: id('ps-mute-label'),
    busy: id('ps-busy'),
    win: id('ps-win'),
    winStarsOn: id('ps-win-stars-on'),
    winStarsOff: id('ps-win-stars-off'),
    winSub: id('ps-win-sub'),
    winMoves: id('ps-win-moves'),
    winTime: id('ps-win-time'),
    winPar: id('ps-win-par'),
    winUndos: id('ps-win-undos'),
    winForm: id('ps-win-form'),
    winNote: id('ps-win-note'),
    name: id('ps-name'),
    btnSubmit: id('ps-btn-submit'),
    btnWinNext: id('ps-btn-win-next'),
    btnWinBoard: id('ps-btn-win-board'),
    btnWinClose: id('ps-btn-win-close'),
    deadend: id('ps-deadend'),
    btnDeadUndo: id('ps-btn-dead-undo'),
    btnDeadRestart: id('ps-btn-dead-restart'),
    board: id('ps-board'),
    boardRows: id('ps-board-rows'),
    boardEmpty: id('ps-board-empty'),
    btnBoardClose: id('ps-btn-board-close'),
    toast: id('ps-toast')
  };

  // --- kleine Helfer ----------------------------------------------------

  const setzeText = (node, text) => { if (node) node.textContent = text; };
  const on = (node, typ, fn) => { if (node) node.addEventListener(typ, fn); };

  function rufe(name, ...args) {
    const fn = h[name];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn(...args);
    } catch (fehler) {
      console.error('[Pfeilspiel] ' + name, fehler);
      toast(TEXTE.meldungFehler, 'error');
      return undefined;
    }
  }

  // --- Texte einsetzen --------------------------------------------------

  function setzeTexte() {
    for (const node of doc.querySelectorAll('[data-ps-t]')) {
      const key = node.getAttribute('data-ps-t');
      if (key && key in TEXTE) node.textContent = TEXTE[key];
    }
    for (const node of doc.querySelectorAll('[data-ps-ta]')) {
      const key = node.getAttribute('data-ps-ta');
      if (key && key in TEXTE) node.setAttribute('aria-label', TEXTE[key]);
    }
    for (const node of doc.querySelectorAll('[data-ps-tp]')) {
      const key = node.getAttribute('data-ps-tp');
      if (key && key in TEXTE) node.setAttribute('placeholder', TEXTE[key]);
    }
    for (const node of doc.querySelectorAll('[data-ps-tt]')) {
      const key = node.getAttribute('data-ps-tt');
      if (key && key in TEXTE) node.setAttribute('title', TEXTE[key]);
    }
  }

  setzeTexte();

  // --- Overlaysteuerung -------------------------------------------------

  /**
   * Das oberste offene Overlay. `vorher` haelt den Rueckweg zu dem Overlay,
   * das dafuer verdeckt wurde (Sieg -> Bestenliste -> zurueck zum Sieg).
   * @type {{node: HTMLElement, zurueck: Element|null, escape: boolean,
   *         vorher: object|null}|null}
   */
  let offen = null;

  function oeffne(node, opt) {
    if (!node) return;
    const o = opt || {};
    let vorher = null;
    if (offen) {
      // Das bisherige Overlay wird nur verdeckt, nicht geschlossen: beim
      // Schliessen des neuen kommt es samt Fokus zurueck. Liegt node schon
      // im Rueckweg, wird stattdessen alles darueber geschlossen (kein Kreis).
      let e = offen;
      while (e && e.node !== node) { e.node.hidden = true; e = e.vorher; }
      vorher = e ? e.vorher : offen;
    }
    offen = {
      node,
      zurueck: doc.activeElement instanceof HTMLElement ? doc.activeElement : null,
      escape: o.escape !== false,
      vorher
    };
    node.hidden = false;
    const ziel = o.fokus && !o.fokus.disabled
      ? o.fokus
      : node.querySelector(FOKUS_SELEKTOR);
    if (ziel && typeof ziel.focus === 'function') ziel.focus();
  }

  function schliesse(node) {
    if (!node) return;
    if (offen && offen.node !== node) {
      // Ein verdecktes Overlay schliessen (etwa hideWin(), waehrend die
      // Bestenliste davorliegt): nur den Rueckweg dorthin kappen.
      for (let e = offen; e; e = e.vorher) {
        if (e.vorher && e.vorher.node === node) {
          e.vorher.node.hidden = true;
          e.vorher = e.vorher.vorher;
          break;
        }
      }
    }
    if (node.hidden) return;
    node.hidden = true;
    if (!offen || offen.node !== node) return;
    const zurueck = offen.zurueck;
    offen = offen.vorher;
    if (offen) offen.node.hidden = false;
    if (zurueck && typeof zurueck.focus === 'function' && doc.contains(zurueck)) {
      zurueck.focus();
    } else if (offen) {
      const ziel = offen.node.querySelector(FOKUS_SELEKTOR);
      if (ziel && typeof ziel.focus === 'function') ziel.focus();
    }
  }

  // Tabulatorschleife und Escape fuer das jeweils offene Overlay.
  doc.addEventListener('keydown', (ev) => {
    if (!offen) return;
    if (ev.key === 'Escape' && offen.escape) {
      ev.preventDefault();
      schliesse(offen.node);
      return;
    }
    if (ev.key !== 'Tab') return;
    const felder = Array.from(offen.node.querySelectorAll(FOKUS_SELEKTOR))
      .filter((n) => n.offsetParent !== null || n === doc.activeElement);
    if (felder.length === 0) return;
    const erstes = felder[0];
    const letztes = felder[felder.length - 1];
    if (ev.shiftKey && doc.activeElement === erstes) {
      ev.preventDefault();
      letztes.focus();
    } else if (!ev.shiftKey && doc.activeElement === letztes) {
      ev.preventDefault();
      erstes.focus();
    }
  });

  // --- Toast ------------------------------------------------------------

  let toastTimer = 0;

  function toast(text, kind) {
    if (!E.toast) return;
    E.toast.textContent = String(text == null ? '' : text);
    E.toast.classList.toggle('is-error', kind === 'error');
    E.toast.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      E.toast.hidden = true;
      toastTimer = 0;
    }, kind === 'error' ? 4200 : 2600);
  }

  // --- Kopfzeile --------------------------------------------------------

  on(E.btnNew, 'click', () => rufe('onNew'));
  on(E.btnUndo, 'click', () => {
    schliesse(E.deadend);
    rufe('onUndo');
  });
  on(E.btnRestart, 'click', () => {
    schliesse(E.deadend);
    rufe('onRestart');
  });
  on(E.btnBoard, 'click', () => rufe('onShowBoard'));

  on(E.btnSettings, 'click', () => {
    if (!E.settings) return;
    const jetztOffen = E.settings.classList.toggle('is-open');
    E.btnSettings.setAttribute('aria-expanded', jetztOffen ? 'true' : 'false');
  });

  // --- Einstellungen ----------------------------------------------------

  on(E.skin, 'change', () => {
    setSkinChip(E.skin.value);
    rufe('onSkin', E.skin.value);
  });
  on(E.mode, 'change', () => rufe('onMode', E.mode.value));
  on(E.goal, 'change', () => rufe('onGoal', E.goal.value));

  on(E.level, 'change', () => {
    const n = Math.trunc(Number(E.level.value));
    const min = Number(E.level.min) || 1;
    const max = Number(E.level.max) || 999;
    const geklemmt = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
    E.level.value = String(geklemmt);
    rufe('onLevel', geklemmt);
  });

  on(E.speed, 'change', () => rufe('onSpeed', Number(E.speed.value) || 1));

  on(E.xray, 'change', () => {
    if (E.xrayLabel) E.xrayLabel.classList.toggle('is-on', E.xray.checked);
    rufe('onXray', E.xray.checked);
  });

  on(E.mute, 'change', () => {
    if (E.muteLabel) E.muteLabel.classList.toggle('is-on', E.mute.checked);
    rufe('onMute', E.mute.checked);
  });

  // --- Sieg-Overlay -----------------------------------------------------

  function setzeHinweis(text, art) {
    if (!E.winNote) return;
    E.winNote.textContent = text || '';
    E.winNote.classList.toggle('is-ok', art === 'ok');
    E.winNote.classList.toggle('is-error', art === 'error');
  }

  on(E.winForm, 'submit', (ev) => {
    ev.preventDefault();
    const name = (E.name ? E.name.value : '').trim().replace(/\s+/g, ' ');
    if (name.length < 2) {
      setzeHinweis(TEXTE.hinweisNameKurz, 'error');
      if (E.name) E.name.focus();
      return;
    }
    schreibeName(name);
    setzeHinweis(TEXTE.hinweisSenden, null);
    if (E.btnSubmit) E.btnSubmit.disabled = true;

    const ergebnis = rufe('onSubmitScore', name);
    if (ergebnis && typeof ergebnis.then === 'function') {
      ergebnis.then((antwort) => {
        if (antwort && antwort.ok === false) {
          setzeHinweis(antwort.message || TEXTE.hinweisSendenFehler, 'error');
        } else if (antwort && Number.isFinite(antwort.rank)) {
          setzeHinweis(fmt(TEXTE.hinweisGesendetPlatz, {
            rank: antwort.rank,
            total: Number.isFinite(antwort.total) ? antwort.total : antwort.rank
          }), 'ok');
        } else {
          setzeHinweis(TEXTE.hinweisGesendet, 'ok');
        }
      }, () => {
        setzeHinweis(TEXTE.hinweisSendenFehler, 'error');
      }).then(() => {
        if (E.btnSubmit) E.btnSubmit.disabled = false;
      });
    } else {
      setzeHinweis(TEXTE.hinweisGesendet, 'ok');
      if (E.btnSubmit) E.btnSubmit.disabled = false;
    }
  });

  on(E.btnWinNext, 'click', () => {
    schliesse(E.win);
    rufe('onNew');
  });
  on(E.btnWinBoard, 'click', () => rufe('onShowBoard'));
  on(E.btnWinClose, 'click', () => schliesse(E.win));

  // --- Sackgassen-Overlay ----------------------------------------------

  on(E.btnDeadUndo, 'click', () => {
    schliesse(E.deadend);
    rufe('onUndo');
  });
  on(E.btnDeadRestart, 'click', () => {
    schliesse(E.deadend);
    rufe('onRestart');
  });

  // --- Bestenlisten-Overlay --------------------------------------------

  on(E.btnBoardClose, 'click', () => schliesse(E.board));

  // --- oeffentliche Schnittstelle --------------------------------------

  function setMoves(n) { setzeText(E.moves, formatZahl(n)); }
  function setPar(n) { setzeText(E.par, formatZahl(n)); }
  function setUndos(n) { setzeText(E.undos, formatZahl(n)); }
  function setTimer(ms) { setzeText(E.timer, formatZeit(ms)); }

  function showWin(s) {
    const daten = s || {};
    const moves = Number(daten.moves) || 0;
    const par = Number(daten.par) || 0;
    const anzahl = sterneFuer(moves, daten.stars, par);
    setzeText(E.winStarsOn, '★'.repeat(anzahl));
    setzeText(E.winStarsOff, '☆'.repeat(3 - anzahl));
    setzeText(E.winSub, fmt(TEXTE['winSub' + anzahl], { moves, par }));
    setzeText(E.winMoves, formatZahl(moves));
    setzeText(E.winTime, formatZeit(daten.timeMs));
    setzeText(E.winPar, formatZahl(par));
    setzeText(E.winUndos, formatZahl(daten.undos || 0));
    setzeHinweis('', null);
    if (E.btnSubmit) E.btnSubmit.disabled = false;
    if (E.name && !E.name.value) E.name.value = leseName();
    oeffne(E.win, { fokus: E.name });
  }

  function hideWin() { schliesse(E.win); }

  function showDeadEnd() {
    // Die Sackgasse wird nie automatisch aufgeloest: kein Escape, kein Schliessen.
    oeffne(E.deadend, { escape: false, fokus: E.btnDeadUndo });
  }

  function hideDeadEnd() { schliesse(E.deadend); }

  function showBoard(rows) {
    const liste = Array.isArray(rows) ? rows : [];
    const eigener = leseName();
    if (E.boardRows) {
      while (E.boardRows.firstChild) E.boardRows.removeChild(E.boardRows.firstChild);
      for (let i = 0; i < liste.length; i++) {
        const r = liste[i] || {};
        const tr = doc.createElement('tr');
        // Eigene Eintraege werden hervorgehoben.
        if (eigener && r.name === eigener) tr.className = 'is-self';

        const zelle = (text, klasse) => {
          const td = doc.createElement('td');
          // Namen und alle anderen Serverdaten ausschliesslich als Text.
          td.textContent = text;
          if (klasse) td.className = klasse;
          tr.appendChild(td);
        };

        zelle(formatZahl(Number.isFinite(r.rank) ? r.rank : i + 1), 'ps-num');
        zelle(String(r.name == null ? '' : r.name), 'ps-cell-name');
        zelle(formatZahl(r.moves), 'ps-num');
        zelle(formatZeit(r.timeMs), 'ps-num');
        zelle(formatZahl(r.undos), 'ps-num ps-col-opt');
        zelle(groesseText(r), 'ps-col-opt');
        zelle(modusText(r.dirMode) + TEXTE.trennerModus + modusText(r.goalMode), 'ps-col-opt');

        E.boardRows.appendChild(tr);
      }
    }
    if (E.boardEmpty) E.boardEmpty.hidden = liste.length > 0;
    oeffne(E.board, { fokus: E.btnBoardClose });
  }

  function setBusy(b) {
    const an = !!b;
    if (E.busy) E.busy.hidden = !an;
    doc.documentElement.setAttribute('aria-busy', an ? 'true' : 'false');
    for (const knopf of [E.btnNew, E.btnUndo, E.btnRestart, E.btnBoard]) {
      if (knopf) knopf.disabled = an;
    }
  }

  function setSkinChip(skinId) {
    const key = 'skin' + String(skinId || '').charAt(0).toUpperCase()
      + String(skinId || '').slice(1);
    setzeText(E.skinChip, key in TEXTE ? TEXTE[key] : String(skinId || ''));
    if (E.skin && skinId) E.skin.value = String(skinId);
  }

  /**
   * Bringt die Bedienelemente auf den Stand des laufenden Spiels
   * (Erweiterung ueber SPEC 4.5 hinaus, damit URL-Hash und gespeicherte
   * Einstellungen sichtbar werden, ohne Rueckrufe auszuloesen).
   */
  function setControls(werte) {
    const v = werte || {};
    if (E.skin && typeof v.skin === 'string') setSkinChip(v.skin);
    if (E.mode && typeof v.mode === 'string') E.mode.value = v.mode;
    if (E.goal && typeof v.goal === 'string') E.goal.value = v.goal;
    if (E.level && Number.isFinite(v.level)) E.level.value = String(Math.trunc(v.level));
    if (E.speed && Number.isFinite(v.speed)) E.speed.value = String(v.speed);
    if (E.xray && typeof v.xray === 'boolean') {
      E.xray.checked = v.xray;
      if (E.xrayLabel) E.xrayLabel.classList.toggle('is-on', v.xray);
    }
    if (E.mute && typeof v.muted === 'boolean') {
      E.mute.checked = v.muted;
      if (E.muteLabel) E.muteLabel.classList.toggle('is-on', v.muted);
    }
  }

  // Startwerte des Geruests
  setSkinChip(E.skin ? E.skin.value : 'modern');
  setBusy(false);

  return {
    setMoves,
    setPar,
    setTimer,
    setUndos,
    showWin,
    hideWin,
    showDeadEnd,
    hideDeadEnd,
    showBoard,
    toast,
    setBusy,
    setSkinChip,
    setControls
  };
}
