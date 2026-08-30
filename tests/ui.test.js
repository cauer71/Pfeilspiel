// tests/ui.test.js — Overlaysteuerung von public/src/ui.js (SPEC §4.5).
//
// ui.js haengt am DOM, nicht an three. Statt eines Browsers steht hier ein
// winziges DOM-Modell: genau die Knoten und Methoden, die createUI benutzt
// (getElementById, querySelector(All), textContent, hidden, focus, classList,
// addEventListener). Damit laesst sich der Weg Sieg -> Bestenliste -> zurueck
// ohne Playwright pruefen.

import test from 'node:test';
import assert from 'node:assert/strict';

// --- winziges DOM -------------------------------------------------------

/** Ein Selektorteil wie `input:not([disabled])` gegen ein Element pruefen. */
function passt(el, teil) {
  const s = teil.trim();
  const i = s.indexOf(':not(');
  if (i >= 0) {
    const basis = s.slice(0, i);
    const innen = s.slice(i + 5, s.lastIndexOf(')'));
    return passtEinfach(el, basis) && !passtEinfach(el, innen);
  }
  return passtEinfach(el, s);
}

function passtEinfach(el, s) {
  if (!s) return true;
  if (s.charAt(0) === '[') {
    const roh = s.slice(1, s.lastIndexOf(']'));
    const eq = roh.indexOf('=');
    const name = eq < 0 ? roh : roh.slice(0, eq);
    if (name === 'disabled') return !!el.disabled;
    const wert = el.getAttribute(name);
    if (wert == null) return false;
    if (eq < 0) return true;
    return wert === roh.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return el.tagName === s.toUpperCase();
}

class HTMLElementStub {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attribute = new Map();
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.text = '';
    this.klassen = new Set();
    this.horcher = new Map();
    const self = this;
    this.classList = {
      toggle(name, an) {
        const soll = an === undefined ? !self.klassen.has(name) : !!an;
        if (soll) self.klassen.add(name); else self.klassen.delete(name);
        return soll;
      },
      contains: (name) => self.klassen.has(name),
      add: (name) => self.klassen.add(name),
      remove: (name) => self.klassen.delete(name)
    };
  }

  get offsetParent() {
    for (let n = this; n; n = n.parentNode) if (n.hidden) return null;
    return this.parentNode || null;
  }

  get textContent() { return this.text; }
  set textContent(v) { this.text = String(v); this.children.length = 0; }

  get firstChild() { return this.children[0] || null; }

  getAttribute(name) {
    return this.attribute.has(name) ? this.attribute.get(name) : null;
  }

  setAttribute(name, wert) { this.attribute.set(name, String(wert)); }

  appendChild(kind) { kind.parentNode = this; this.children.push(kind); return kind; }

  removeChild(kind) {
    const i = this.children.indexOf(kind);
    if (i >= 0) this.children.splice(i, 1);
    kind.parentNode = null;
    return kind;
  }

  /** Alle Nachfahren in Dokumentreihenfolge. */
  alle(sammlung) {
    const res = sammlung || [];
    for (const kind of this.children) { res.push(kind); kind.alle(res); }
    return res;
  }

  querySelectorAll(selektor) {
    const teile = String(selektor).split(',');
    return this.alle().filter((el) => teile.some((t) => passt(el, t)));
  }

  querySelector(selektor) { return this.querySelectorAll(selektor)[0] || null; }

  focus() { dokument.activeElement = this; }

  addEventListener(typ, fn) {
    if (!this.horcher.has(typ)) this.horcher.set(typ, []);
    this.horcher.get(typ).push(fn);
  }

  /** Ereignis auslösen; ohne Bubbling, das braucht ui.js nicht. */
  feuere(typ, ereignis) {
    const ev = Object.assign({ type: typ, preventDefault() {} }, ereignis || {});
    for (const fn of this.horcher.get(typ) || []) fn(ev);
    return ev;
  }
}

let dokument = null;

/** Baut ein Dokument aus einer verschachtelten Beschreibung. */
function baue(beschreibung, index) {
  const el = new HTMLElementStub(beschreibung.tag || 'div');
  if (beschreibung.id) { el.setAttribute('id', beschreibung.id); index.set(beschreibung.id, el); }
  if (beschreibung.hidden) el.hidden = true;
  if (beschreibung.attr) {
    for (const [k, v] of Object.entries(beschreibung.attr)) el.setAttribute(k, v);
  }
  for (const kind of beschreibung.kinder || []) el.appendChild(baue(kind, index));
  return el;
}

/** Geruest mit genau den Knoten, die createUI anspricht. */
const GERUEST = {
  tag: 'body',
  kinder: [
    { tag: 'div', id: 'ps-hud', kinder: [
      { tag: 'span', id: 'ps-moves' }, { tag: 'span', id: 'ps-timer' },
      { tag: 'span', id: 'ps-par' }, { tag: 'span', id: 'ps-undos' },
      { tag: 'button', id: 'ps-btn-new' }, { tag: 'button', id: 'ps-btn-undo' },
      { tag: 'button', id: 'ps-btn-restart' }, { tag: 'button', id: 'ps-btn-board' },
      { tag: 'button', id: 'ps-btn-settings' }
    ] },
    { tag: 'div', id: 'ps-settings', kinder: [
      { tag: 'select', id: 'ps-skin' }, { tag: 'span', id: 'ps-skin-chip' },
      { tag: 'select', id: 'ps-mode' }, { tag: 'select', id: 'ps-goal' },
      { tag: 'input', id: 'ps-level' }, { tag: 'select', id: 'ps-speed' },
      { tag: 'input', id: 'ps-xray' }, { tag: 'span', id: 'ps-xray-label' },
      { tag: 'input', id: 'ps-mute' }, { tag: 'span', id: 'ps-mute-label' }
    ] },
    { tag: 'div', id: 'ps-busy', hidden: true },
    { tag: 'div', id: 'ps-win', hidden: true, kinder: [
      { tag: 'span', id: 'ps-win-stars-on' }, { tag: 'span', id: 'ps-win-stars-off' },
      { tag: 'p', id: 'ps-win-sub' }, { tag: 'dd', id: 'ps-win-moves' },
      { tag: 'dd', id: 'ps-win-time' }, { tag: 'dd', id: 'ps-win-par' },
      { tag: 'dd', id: 'ps-win-undos' },
      { tag: 'form', id: 'ps-win-form', kinder: [
        { tag: 'input', id: 'ps-name' }, { tag: 'button', id: 'ps-btn-submit' }
      ] },
      { tag: 'p', id: 'ps-win-note' },
      { tag: 'button', id: 'ps-btn-win-next' }, { tag: 'button', id: 'ps-btn-win-board' },
      { tag: 'button', id: 'ps-btn-win-close' }
    ] },
    { tag: 'div', id: 'ps-deadend', hidden: true, kinder: [
      { tag: 'button', id: 'ps-btn-dead-undo' }, { tag: 'button', id: 'ps-btn-dead-restart' }
    ] },
    { tag: 'div', id: 'ps-board', hidden: true, kinder: [
      { tag: 'tbody', id: 'ps-board-rows' }, { tag: 'p', id: 'ps-board-empty', hidden: true },
      { tag: 'button', id: 'ps-btn-board-close' }
    ] },
    { tag: 'div', id: 'ps-toast', hidden: true }
  ]
};

/** Setzt globale DOM-Attrappen und liefert Zugriff auf Knoten und Ereignisse. */
function dom() {
  const index = new Map();
  const body = baue(GERUEST, index);
  const wurzel = new HTMLElementStub('html');
  wurzel.appendChild(body);

  dokument = {
    body,
    documentElement: wurzel,
    activeElement: body,
    getElementById: (name) => index.get(name) || null,
    createElement: (tag) => new HTMLElementStub(tag),
    querySelectorAll: (sel) => wurzel.querySelectorAll(sel),
    querySelector: (sel) => wurzel.querySelector(sel),
    contains: (node) => {
      for (let n = node; n; n = n.parentNode) if (n === wurzel) return true;
      return false;
    },
    addEventListener: (typ, fn) => wurzel.addEventListener(typ, fn),
    feuere: (typ, ev) => wurzel.feuere(typ, ev)
  };

  const speicher = new Map();
  globalThis.document = dokument;
  globalThis.HTMLElement = HTMLElementStub;
  globalThis.window = {
    localStorage: {
      getItem: (k) => (speicher.has(k) ? speicher.get(k) : null),
      setItem: (k, v) => speicher.set(k, String(v))
    },
    setTimeout: () => 1,
    clearTimeout: () => {}
  };

  return { index, id: (name) => index.get(name), dokument };
}

import { createUI } from '../public/src/ui.js';

// --- Proben -------------------------------------------------------------

test('1. Bestenliste aus dem Sieg-Overlay: der Siegdialog kommt zurueck', () => {
  const d = dom();
  const ui = createUI({ onShowBoard: () => ui.showBoard([]) });

  ui.showWin({ moves: 10, par: 10, timeMs: 1000, undos: 0 });
  assert.equal(d.id('ps-win').hidden, false);

  // Klick auf "Bestenliste" im Siegdialog.
  d.id('ps-btn-win-board').focus();
  d.id('ps-btn-win-board').feuere('click');
  assert.equal(d.id('ps-board').hidden, false, 'Bestenliste ist offen');
  assert.equal(d.id('ps-win').hidden, true, 'Siegdialog liegt darunter');

  // Klick auf "Schliessen" in der Bestenliste.
  d.id('ps-btn-board-close').feuere('click');
  assert.equal(d.id('ps-board').hidden, true, 'Bestenliste ist zu');
  assert.equal(d.id('ps-win').hidden, false, 'Siegdialog ist wieder da');
  assert.notEqual(d.id('ps-btn-submit').offsetParent, null, '"Eintragen" ist sichtbar');
  assert.notEqual(d.id('ps-btn-win-next').offsetParent, null, '"Weiter" ist sichtbar');
  assert.equal(dokument.activeElement, d.id('ps-btn-win-board'),
    'der Fokus liegt wieder auf dem ausloesenden Knopf, nicht im Dokumentkoerper');

  // Der zurueckgekehrte Siegdialog reagiert weiter auf Escape.
  dokument.feuere('keydown', { key: 'Escape' });
  assert.equal(d.id('ps-win').hidden, true);
});

test('2. Eintragen bleibt nach dem Umweg ueber die Bestenliste moeglich', () => {
  const d = dom();
  const gesendet = [];
  const ui = createUI({
    onShowBoard: () => ui.showBoard([]),
    onSubmitScore: (name) => { gesendet.push(name); return { ok: true }; }
  });

  ui.showWin({ moves: 8, par: 8, timeMs: 2000, undos: 1 });
  d.id('ps-btn-win-board').focus();
  d.id('ps-btn-win-board').feuere('click');
  d.id('ps-btn-board-close').feuere('click');

  d.id('ps-name').value = 'Ada';
  d.id('ps-win-form').feuere('submit');
  assert.deepEqual(gesendet, ['Ada']);
  assert.equal(d.id('ps-btn-submit').disabled, false);
});

test('3. Bestenliste allein: Schliessen gibt den Fokus an den Ausloeser zurueck', () => {
  const d = dom();
  const ui = createUI({ onShowBoard: () => ui.showBoard([{ name: 'Ada', moves: 7 }]) });

  d.id('ps-btn-board').focus();
  d.id('ps-btn-board').feuere('click');
  assert.equal(d.id('ps-board').hidden, false);
  assert.equal(d.id('ps-board-rows').children.length, 1);

  d.id('ps-btn-board-close').feuere('click');
  assert.equal(d.id('ps-board').hidden, true);
  assert.equal(d.id('ps-win').hidden, true, 'ohne Sieg kommt kein Siegdialog hoch');
  assert.equal(dokument.activeElement, d.id('ps-btn-board'));
});

test('4. hideWin waehrend der Bestenliste laesst den Siegdialog nicht wiederkehren', () => {
  const d = dom();
  const ui = createUI({ onShowBoard: () => ui.showBoard([]) });

  ui.showWin({ moves: 5, par: 5, timeMs: 0, undos: 0 });
  d.id('ps-btn-win-board').feuere('click');
  ui.hideWin();                       // main.js: Rueckgaengig oder Neustart
  d.id('ps-btn-board-close').feuere('click');

  assert.equal(d.id('ps-board').hidden, true);
  assert.equal(d.id('ps-win').hidden, true);
});

test('5. Die Sackgasse ueberlebt einen Blick in die Bestenliste', () => {
  const d = dom();
  const ui = createUI({ onShowBoard: () => ui.showBoard([]) });

  ui.showDeadEnd();
  assert.equal(d.id('ps-deadend').hidden, false);

  ui.showBoard([]);
  assert.equal(d.id('ps-deadend').hidden, true);
  d.id('ps-btn-board-close').feuere('click');
  assert.equal(d.id('ps-deadend').hidden, false, 'die Sackgasse loest sich nie von selbst auf');

  // Und sie bleibt gegen Escape gesperrt (SPEC §4.5).
  dokument.feuere('keydown', { key: 'Escape' });
  assert.equal(d.id('ps-deadend').hidden, false);

  ui.hideDeadEnd();
  assert.equal(d.id('ps-deadend').hidden, true);
});

test('6. Zweimal dasselbe Overlay oeffnen legt keinen Kreis an', () => {
  const d = dom();
  const ui = createUI({ onShowBoard: () => ui.showBoard([]) });

  ui.showWin({ moves: 3, par: 3, timeMs: 0, undos: 0 });
  ui.showBoard([]);
  ui.showWin({ moves: 3, par: 3, timeMs: 0, undos: 0 });   // erneuter Sieg-Aufruf
  assert.equal(d.id('ps-win').hidden, false);
  assert.equal(d.id('ps-board').hidden, true);

  ui.hideWin();
  assert.equal(d.id('ps-win').hidden, true);
  assert.equal(d.id('ps-board').hidden, true, 'die Bestenliste kehrt nicht als Geist zurueck');
});
