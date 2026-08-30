// Pfeilspiel — Skintests (SPEC §10.7, Punkte 1-3 und 5).
// Prueft die drei Tokensaetze gegen das Schema aus §7.2, ohne DOM und ohne WebGL.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SKIN_IDS, SKINS, getSkin, resolveSkinId, applySkinDom, applySkinThree,
  easingOf, createAudio
} from '../public/src/skins.js';

// --- Schema aus SPEC §7.2 -----------------------------------------------

/** Vollstaendiger CSS-Schluesselsatz, woertlich aus SPEC §7.2. */
const CSS_KEYS = [
  '--ps-bg', '--ps-bg-2', '--ps-panel-bg', '--ps-panel-blur', '--ps-panel-border',
  '--ps-panel-shadow', '--ps-panel-radius', '--ps-fg', '--ps-fg-muted', '--ps-accent',
  '--ps-accent-2', '--ps-accent-soft', '--ps-accent-fg', '--ps-success', '--ps-danger',
  '--ps-btn-bg', '--ps-btn-bg-hover', '--ps-btn-fg', '--ps-btn-border', '--ps-btn-radius',
  '--ps-btn-press', '--ps-font-ui', '--ps-font-num', '--ps-size-hud', '--ps-size-title',
  '--ps-tracking', '--ps-transform', '--ps-text-shadow', '--ps-weight', '--ps-dur-ui',
  '--ps-ease-ui', '--ps-scrim', '--ps-focus-ring', '--ps-scanline-opacity',
  '--ps-scanline-period', '--ps-grille-opacity', '--ps-vignette', '--ps-canvas-filter',
  '--ps-color-scheme', '--ps-gap', '--ps-hud-pad'
];

/** CSS-Schluessel, deren Wert eine Farbe sein MUSS. */
const CSS_COLOR_KEYS = [
  '--ps-bg', '--ps-bg-2', '--ps-panel-bg', '--ps-fg', '--ps-fg-muted', '--ps-accent',
  '--ps-accent-2', '--ps-accent-soft', '--ps-accent-fg', '--ps-success', '--ps-danger',
  '--ps-btn-bg', '--ps-btn-bg-hover', '--ps-btn-fg', '--ps-scrim'
];

const THREE_KEYS = [
  'background', 'hemi', 'key', 'fill', 'envIntensity', 'toneMapping', 'exposure',
  'shadows', 'cube', 'cubeLow', 'target', 'hover', 'ghost', 'coreBox', 'atlas'
];

const ATLAS_KEYS = [
  'tile', 'gutter', 'style', 'body', 'bodyTarget', 'glyph', 'glyphAlpha', 'accent',
  'margin', 'shaft', 'head', 'radius', 'stroke', 'grid', 'glow', 'nearest', 'anisotropy'
];

const MOTION_KEYS = [
  'step', 'jump', 'chain', 'wobble', 'fly', 'spawn', 'spawnStagger', 'shake', 'camera'
];

const FX_KEYS = ['crt', 'canvasFilter', 'screenShake', 'sounds'];

const CRT_KEYS = ['enabled', 'opacity', 'periodPx', 'grille', 'vignette', 'roll', 'flicker'];

const AUDIO_EVENTS = [
  'tap', 'move', 'jump', 'chain', 'invalid', 'fly', 'win', 'undo', 'ui', 'skin'
];

const EASE_NAMES = [
  'linear', 'outCubic', 'inQuad', 'inOutCubic', 'outBack', 'appleSpring',
  'stepped6', 'stepped8'
];

const WAVES = ['sine', 'triangle', 'square', 'sawtooth', 'noise'];
const FILTER_TYPES = ['lowpass', 'bandpass', 'highpass'];
const TONE_MAPPINGS = ['None', 'ACESFilmic', 'Neutral'];
const ATLAS_STYLES = ['solidTriangle', 'softChevron', 'pixelArrow'];

const COLOR_RE = /^(#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/;

const skins = () => SKIN_IDS.map((id) => SKINS[id]);

function keysOf(obj) {
  return Object.keys(obj).slice().sort();
}

function isHexNumber(v) {
  return Number.isInteger(v) && v >= 0 && v <= 0xFFFFFF;
}

// --- 1. Liste und Grundform ----------------------------------------------

test('SKIN_IDS und SKINS decken genau modern, apple, arcade ab', () => {
  assert.deepEqual([...SKIN_IDS], ['modern', 'apple', 'arcade']);
  assert.deepEqual(keysOf(SKINS), ['apple', 'arcade', 'modern']);
  for (const id of SKIN_IDS) {
    assert.equal(SKINS[id].id, id);
    assert.equal(typeof SKINS[id].label, 'string');
    assert.ok(SKINS[id].label.length > 0);
  }
});

test('jeder Skin ist rein JSON-serialisierbar (SPEC §7.1)', () => {
  for (const skin of skins()) {
    const round = JSON.parse(JSON.stringify(skin));
    assert.deepEqual(round, skin, 'Skin ' + skin.id + ' enthaelt Nicht-JSON-Werte');
  }
});

test('meta ist vollstaendig und plausibel', () => {
  for (const skin of skins()) {
    assert.deepEqual(keysOf(skin.meta), ['colorScheme', 'themeColor']);
    assert.match(skin.meta.themeColor, COLOR_RE);
    assert.ok(['dark', 'light'].includes(skin.meta.colorScheme));
    assert.equal(skin.css['--ps-color-scheme'], skin.meta.colorScheme);
  }
});

// --- 2. Identische Schluesselmengen (SPEC §10.7.1) ------------------------

test('der CSS-Schluesselsatz aus §7.2 ist in allen drei Skins vollstaendig', () => {
  const want = CSS_KEYS.slice().sort();
  for (const skin of skins()) {
    assert.deepEqual(keysOf(skin.css), want, 'CSS-Schluessel weichen ab: ' + skin.id);
    for (const k of CSS_KEYS) {
      assert.equal(typeof skin.css[k], 'string', skin.id + ' ' + k + ' ist kein String');
      assert.ok(skin.css[k].length > 0, skin.id + ' ' + k + ' ist leer');
    }
  }
});

test('three, three.atlas, motion, audio.events und fx haben identische Schluesselmengen', () => {
  for (const skin of skins()) {
    assert.deepEqual(keysOf(skin.three), THREE_KEYS.slice().sort(), 'three: ' + skin.id);
    assert.deepEqual(keysOf(skin.three.atlas), ATLAS_KEYS.slice().sort(), 'atlas: ' + skin.id);
    assert.deepEqual(keysOf(skin.motion), MOTION_KEYS.slice().sort(), 'motion: ' + skin.id);
    assert.deepEqual(keysOf(skin.fx), FX_KEYS.slice().sort(), 'fx: ' + skin.id);
    assert.deepEqual(keysOf(skin.fx.crt), CRT_KEYS.slice().sort(), 'fx.crt: ' + skin.id);
    assert.deepEqual(keysOf(skin.audio), ['bitcrush', 'events', 'master', 'reverb'],
      'audio: ' + skin.id);
    assert.deepEqual(keysOf(skin.audio.events), AUDIO_EVENTS.slice().sort(),
      'audio.events: ' + skin.id);
  }
});

test('die Unterobjekte von three und motion haben in allen Skins dieselbe Form', () => {
  const ref = SKINS.modern;
  const shape = (o) => (o && typeof o === 'object' && !Array.isArray(o))
    ? Object.keys(o).sort().map((k) => k + ':' + shape(o[k])).join(',')
    : typeof o;
  for (const skin of skins()) {
    assert.equal(shape(skin.three), shape(ref.three), 'three-Form: ' + skin.id);
    assert.equal(shape(skin.motion), shape(ref.motion), 'motion-Form: ' + skin.id);
    assert.equal(shape(skin.fx), shape(ref.fx), 'fx-Form: ' + skin.id);
  }
});

// --- 3. Werte (SPEC §10.7.2) ---------------------------------------------

test('CSS-Farbwerte matchen #rgb, #rrggbb oder rgb(a)()', () => {
  for (const skin of skins()) {
    for (const k of CSS_COLOR_KEYS) {
      assert.match(skin.css[k], COLOR_RE, skin.id + ' ' + k + ' = ' + skin.css[k]);
    }
  }
});

test('three-Farben sind ganzzahlige Hexzahlen, Atlasfarben CSS-Farbstrings', () => {
  for (const skin of skins()) {
    const t = skin.three;
    for (const [name, v] of [
      ['background', t.background], ['hemi.sky', t.hemi.sky], ['hemi.ground', t.hemi.ground],
      ['key.color', t.key.color], ['fill.color', t.fill.color],
      ['cube.emissive', t.cube.emissive], ['target.emissive', t.target.emissive],
      ['hover.emissive', t.hover.emissive], ['coreBox.color', t.coreBox.color]
    ]) {
      assert.ok(isHexNumber(v), skin.id + ' ' + name + ' ist keine Hexzahl: ' + v);
    }
    for (const [name, v] of [
      ['target.color', t.target.color], ['atlas.body', t.atlas.body],
      ['atlas.bodyTarget', t.atlas.bodyTarget], ['atlas.glyph', t.atlas.glyph],
      ['atlas.accent', t.atlas.accent]
    ]) {
      assert.match(v, COLOR_RE, skin.id + ' ' + name);
    }
  }
});

test('three-Kennzahlen liegen in ihren Wertebereichen', () => {
  for (const skin of skins()) {
    const t = skin.three;
    assert.ok(TONE_MAPPINGS.includes(t.toneMapping), skin.id + ' toneMapping');
    assert.ok(t.exposure > 0 && t.exposure <= 3, skin.id + ' exposure');
    assert.equal(typeof t.shadows, 'boolean');
    assert.equal(typeof t.key.castShadow, 'boolean');
    assert.ok(t.envIntensity >= 0 && t.envIntensity <= 4, skin.id + ' envIntensity');
    for (const l of [t.hemi, t.key, t.fill]) assert.ok(l.intensity >= 0 && l.intensity <= 8);
    assert.ok(t.cube.roughness >= 0 && t.cube.roughness <= 1, skin.id + ' roughness');
    assert.ok(t.cube.metalness >= 0 && t.cube.metalness <= 1, skin.id + ' metalness');
    assert.ok(t.ghost.opacity > 0 && t.ghost.opacity < 1, skin.id + ' ghost.opacity');
    assert.ok(t.coreBox.opacity > 0 && t.coreBox.opacity <= 1, skin.id + ' coreBox.opacity');
    // Apple verzichtet bewusst auf transmission (SPEC §7.4).
    assert.equal(t.cubeLow.transmission, 0, skin.id + ' cubeLow.transmission');
  }
});

test('Atlas: Kachelmass, Rand und Geometrie sind konsistent', () => {
  for (const skin of skins()) {
    const a = skin.three.atlas;
    assert.ok([128, 256].includes(a.tile), skin.id + ' atlas.tile');
    assert.ok(a.gutter >= 16, skin.id + ' atlas.gutter >= 16');
    assert.ok(ATLAS_STYLES.includes(a.style), skin.id + ' atlas.style');
    assert.ok(a.margin >= 0 && a.margin <= 0.5, skin.id + ' atlas.margin');
    assert.ok(a.glyphAlpha > 0 && a.glyphAlpha <= 1, skin.id + ' atlas.glyphAlpha');
    assert.ok(a.shaft > 0 && a.shaft < a.head, skin.id + ' atlas.shaft < head');
    assert.ok(a.head > 0 && a.head <= 1, skin.id + ' atlas.head');
    assert.equal(typeof a.nearest, 'boolean');
    assert.ok(a.anisotropy >= 1, skin.id + ' atlas.anisotropy');
    assert.ok(a.grid >= 4 && Number.isInteger(a.grid), skin.id + ' atlas.grid');
    // Arcade zeichnet Pixelpfeile: harte Kanten, keine Anisotropie, kein Radius.
    if (skin.id === 'arcade') {
      assert.equal(a.style, 'pixelArrow');
      assert.equal(a.nearest, true);
      assert.equal(a.radius, 0);
      assert.ok(a.glow > 0);
    }
  }
});

test('motion: Dauern positiv, Easingnamen bekannt (SPEC §10.7.3)', () => {
  for (const skin of skins()) {
    const m = skin.motion;
    for (const key of ['step', 'jump', 'wobble', 'fly', 'spawn', 'camera']) {
      assert.ok(m[key].dur > 0, skin.id + ' motion.' + key + '.dur');
    }
    for (const key of ['step', 'jump', 'wobble', 'fly', 'spawn']) {
      const name = m[key].ease;
      assert.ok(EASE_NAMES.includes(name), skin.id + ' unbekanntes Easing: ' + name);
      const fn = easingOf(name);
      assert.equal(typeof fn, 'function');
      // Nur 'linear' darf mit dem Rueckfall identisch sein.
      if (name !== 'linear') assert.notEqual(fn, easingOf('gibtEsNicht'));
    }
    assert.ok(m.jump.arc > 0 && m.jump.arc < 1.5, skin.id + ' jump.arc');
    assert.ok(m.chain.delay >= 0, skin.id + ' chain.delay');
    assert.ok(m.spawnStagger >= 0, skin.id + ' spawnStagger');
    assert.ok(m.wobble.cycles >= 1, skin.id + ' wobble.cycles');
    assert.ok(m.shake.amp >= 0 && m.shake.dur >= 0 && m.shake.freq >= 0);
    // Der Schritt ist kuerzer als der Sprung: die Dauer kodiert die Zugart (SPEC §8.8).
    assert.ok(m.step.dur < m.jump.dur, skin.id + ' step.dur < jump.dur');
  }
});

test('easingOf: alle Registrynamen sind stetig von 0 nach 1', () => {
  for (const name of EASE_NAMES) {
    const fn = easingOf(name);
    assert.equal(typeof fn, 'function', name);
    assert.ok(Math.abs(fn(0)) < 1e-9, name + '(0) = ' + fn(0));
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, name + '(1) = ' + fn(1));
  }
  assert.equal(easingOf('unbekannt')(0.5), 0.5, 'Rueckfall ist linear');
  assert.equal(easingOf(undefined)(0.25), 0.25);
});

test('audio: alle zehn Ereignisse in allen Skins, Stimmen wohlgeformt', () => {
  for (const skin of skins()) {
    const a = skin.audio;
    assert.ok(a.master > 0 && a.master <= 1, skin.id + ' audio.master');
    assert.ok(a.bitcrush >= 0 && a.bitcrush <= 16, skin.id + ' audio.bitcrush');
    if (a.reverb !== null) {
      assert.deepEqual(keysOf(a.reverb), ['decay', 'seconds', 'wet']);
      assert.ok(a.reverb.wet > 0 && a.reverb.wet <= 1, skin.id + ' reverb.wet');
      assert.ok(a.reverb.seconds > 0 && a.reverb.decay > 0);
    }
    for (const ev of AUDIO_EVENTS) {
      const v = a.events[ev];
      assert.ok(v, skin.id + ' fehlendes Ereignis: ' + ev);
      assert.ok(WAVES.includes(v.wave), skin.id + '.' + ev + ' wave: ' + v.wave);
      assert.ok(v.dur > 0 && v.dur <= 2, skin.id + '.' + ev + ' dur');
      assert.ok(v.a >= 0 && v.r >= 0, skin.id + '.' + ev + ' Huellkurve');
      assert.ok(v.gain > 0 && v.gain <= 1, skin.id + '.' + ev + ' gain');
      if (v.wave === 'noise') {
        assert.equal(v.notes, undefined, skin.id + '.' + ev + ': Rauschen hat keine Noten');
      } else {
        assert.ok(Array.isArray(v.notes) && v.notes.length >= 1,
          skin.id + '.' + ev + ' notes');
        for (const n of v.notes) assert.ok(n >= 20 && n <= 20000, skin.id + '.' + ev + ' Note');
        if (v.notes.length > 1) assert.ok(v.arpMs > 0, skin.id + '.' + ev + ' arpMs');
      }
      if (v.filter) {
        assert.ok(FILTER_TYPES.includes(v.filter.type), skin.id + '.' + ev + ' filter.type');
        assert.ok(v.filter.freq > 0 && v.filter.q > 0);
      }
      if (v.glideTo !== undefined) assert.ok(v.glideTo > 0);
      if (v.detune !== undefined) assert.equal(typeof v.detune, 'number');
    }
  }
});

test('fx.canvasFilter enthaelt nur saturate/contrast (SPEC §10.7.5)', () => {
  for (const skin of skins()) {
    const f = skin.fx.canvasFilter;
    assert.equal(typeof f, 'string');
    assert.doesNotMatch(f, /drop-shadow|blur|brightness|hue-rotate/, skin.id + ' canvasFilter');
    if (f !== 'none') {
      const parts = f.match(/[a-zA-Z-]+\(/g) || [];
      for (const p of parts) {
        assert.ok(['saturate(', 'contrast('].includes(p), skin.id + ' canvasFilter: ' + p);
      }
    }
    assert.equal(skin.css['--ps-canvas-filter'], f, skin.id + ': Token und fx weichen ab');
    assert.equal(typeof skin.fx.screenShake, 'boolean');
    assert.equal(typeof skin.fx.sounds, 'boolean');
  }
});

test('CRT: nur Arcade schaltet die Roehre ein, Tokens passen zu fx.crt', () => {
  for (const skin of skins()) {
    const crt = skin.fx.crt;
    const on = crt.enabled;
    assert.equal(on, skin.id === 'arcade', skin.id + ' fx.crt.enabled');
    assert.equal(parseFloat(skin.css['--ps-scanline-opacity']), crt.opacity, skin.id);
    assert.equal(parseFloat(skin.css['--ps-grille-opacity']), crt.grille, skin.id);
    assert.equal(parseFloat(skin.css['--ps-vignette']), crt.vignette, skin.id);
    assert.equal(parseFloat(skin.css['--ps-scanline-period']), crt.periodPx, skin.id);
    if (!on) {
      assert.equal(crt.opacity, 0);
      assert.equal(crt.flicker, 0);
      assert.equal(crt.roll, false);
    } else {
      assert.ok(crt.opacity > 0 && crt.opacity <= 1);
      assert.ok(crt.flicker >= 0 && crt.flicker < 0.5);
    }
    // Screenshake nur dort, wo auch eine Amplitude hinterlegt ist.
    assert.equal(skin.fx.screenShake, skin.motion.shake.amp > 0, skin.id + ' screenShake');
  }
});

test('die drei Skins unterscheiden sich in beiden Ebenen deutlich', () => {
  const ids = [...SKIN_IDS];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = SKINS[ids[i]], b = SKINS[ids[j]];
      let diff = 0;
      for (const k of CSS_KEYS) if (a.css[k] !== b.css[k]) diff++;
      assert.ok(diff >= 20, ids[i] + ' vs ' + ids[j] + ': nur ' + diff + ' CSS-Unterschiede');
      assert.notEqual(a.three.background, b.three.background);
      assert.notEqual(a.three.atlas.style, b.three.atlas.style);
      assert.notEqual(a.motion.step.dur, b.motion.step.dur);
      assert.notEqual(JSON.stringify(a.audio.events), JSON.stringify(b.audio.events));
    }
  }
  // Grundcharakter laut SPEC §7.3-§7.5.
  assert.equal(SKINS.modern.meta.colorScheme, 'dark');
  assert.equal(SKINS.apple.meta.colorScheme, 'light');
  assert.ok(parseFloat(SKINS.apple.css['--ps-panel-blur']) >= 16, 'Apple: backdrop-filter');
  assert.equal(SKINS.arcade.css['--ps-panel-radius'], '0px');
  assert.equal(SKINS.arcade.css['--ps-transform'], 'uppercase');
  assert.match(SKINS.arcade.css['--ps-font-ui'], /monospace/);
  assert.equal(SKINS.arcade.three.shadows, false);
});

// --- getSkin / resolveSkinId ---------------------------------------------

test('getSkin liefert den Tokensatz und wirft bei unbekannter Id', () => {
  for (const id of SKIN_IDS) assert.equal(getSkin(id), SKINS[id]);
  assert.throws(() => getSkin('retro'), /Unbekannter Skin/);
  assert.throws(() => getSkin(undefined), /Unbekannter Skin/);
  assert.throws(() => getSkin('constructor'), /Unbekannter Skin/);
});

test('resolveSkinId faellt ohne Browserumgebung auf modern zurueck', () => {
  assert.equal(resolveSkinId(), 'modern');
  assert.equal(resolveSkinId('arcade'), 'arcade');
  assert.equal(resolveSkinId('apple'), 'apple');
  assert.equal(resolveSkinId('quatsch'), 'modern');
  assert.equal(resolveSkinId(42), 'modern');
});

// --- Anwendung auf DOM und Three (mit Attrappen) -------------------------

function fakeRoot() {
  const props = new Map();
  const attrs = new Map();
  return {
    props, attrs,
    style: {
      colorScheme: '',
      setProperty(k, v) { props.set(k, v); }
    },
    setAttribute(k, v) { attrs.set(k, v); }
  };
}

test('applySkinDom schreibt alle Tokens, data-skin und color-scheme', () => {
  for (const skin of skins()) {
    const root = fakeRoot();
    applySkinDom(skin, root);
    for (const k of CSS_KEYS) {
      assert.ok(root.props.has(k), skin.id + ': Token fehlt ' + k);
    }
    // --ps-scanline-period wird aus der Fensterhoehe nachgezogen (SPEC §7.6).
    assert.match(root.props.get('--ps-scanline-period'), /^\d+px$/);
    assert.equal(root.attrs.get('data-skin'), skin.id);
    assert.equal(root.style.colorScheme, skin.meta.colorScheme);
    assert.equal(root.props.get('--ps-crt-anim'), skin.fx.crt.roll ? 'running' : 'paused');
    assert.equal(root.props.get('--ps-crt-flicker'), String(skin.fx.crt.flicker));
    assert.equal(root.props.get('--ps-canvas-filter'), skin.fx.canvasFilter);
  }
});

test('applySkinDom ist ohne DOM und ohne Wurzel wirkungslos statt fehlerhaft', () => {
  assert.doesNotThrow(() => applySkinDom(SKINS.modern));
  assert.doesNotThrow(() => applySkinDom(SKINS.arcade, null));
});

function fakeColor() {
  return { hex: null, setHex(h) { this.hex = h; } };
}

function fakeThreeCtx() {
  const calls = [];
  return {
    calls,
    renderer: {
      toneMapping: -1, toneMappingExposure: -1, shadowMap: { enabled: null },
      setClearColor() { calls.push('clear'); }
    },
    scene: { background: fakeColor(), environmentIntensity: -1 },
    lights: {
      hemi: { color: fakeColor(), groundColor: fakeColor(), intensity: -1 },
      key: { color: fakeColor(), intensity: -1, castShadow: null },
      fill: { color: fakeColor(), intensity: -1 }
    },
    view: { setSkin(s) { calls.push('setSkin:' + s.id); } },
    worldRig: { position: { x: 1, y: 2, z: 3, set(x, y, z) { this.x = x; this.y = y; this.z = z; } } }
  };
}

test('applySkinThree loest toneMapping auf und setzt Renderer, Szene, Lichter', () => {
  const expected = { None: 0, ACESFilmic: 4, Neutral: 7 };
  for (const skin of skins()) {
    const ctx = fakeThreeCtx();
    applySkinThree(skin, ctx);
    const t = skin.three;
    assert.equal(ctx.renderer.toneMapping, expected[t.toneMapping], skin.id + ' toneMapping');
    assert.equal(ctx.renderer.toneMappingExposure, t.exposure);
    assert.equal(ctx.renderer.shadowMap.enabled, t.shadows);
    assert.equal(ctx.scene.background.hex, t.background);
    assert.equal(ctx.scene.environmentIntensity, t.envIntensity);
    assert.equal(ctx.lights.hemi.color.hex, t.hemi.sky);
    assert.equal(ctx.lights.hemi.groundColor.hex, t.hemi.ground);
    assert.equal(ctx.lights.hemi.intensity, t.hemi.intensity);
    assert.equal(ctx.lights.key.color.hex, t.key.color);
    assert.equal(ctx.lights.key.intensity, t.key.intensity);
    assert.equal(ctx.lights.key.castShadow, t.key.castShadow && t.shadows);
    assert.equal(ctx.lights.fill.color.hex, t.fill.color);
    assert.equal(ctx.lights.fill.intensity, t.fill.intensity);
    // Screenshake-Versatz darf den Wechsel nicht ueberleben.
    assert.deepEqual(
      [ctx.worldRig.position.x, ctx.worldRig.position.y, ctx.worldRig.position.z], [0, 0, 0]);
    assert.deepEqual(ctx.calls, ['setSkin:' + skin.id]);
  }
});

test('applySkinThree bleibt bei fehlenden Bausteinen still', () => {
  assert.doesNotThrow(() => applySkinThree(SKINS.arcade, {}));
  assert.doesNotThrow(() => applySkinThree(SKINS.apple, undefined));
  const ctx = fakeThreeCtx();
  ctx.scene.background = null;
  applySkinThree(SKINS.modern, ctx);
  assert.ok(ctx.calls.includes('clear'), 'ohne Color-Objekt greift setClearColor');
});

// --- Audio ---------------------------------------------------------------

/** Minimalattrappe der WebAudio-API; zaehlt gestartete Quellen. */
function installFakeAudio() {
  const log = { started: 0, stopped: 0, closed: false, buffers: 0, resumed: 0 };
  const param = () => ({
    value: 0,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; }
  });
  const node = (extra) => Object.assign({
    connect() { return this; }, disconnect() { return this; }
  }, extra);
  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.state = 'suspended';
      this.destination = node({});
    }
    async resume() { this.state = 'running'; log.resumed++; }
    async close() { log.closed = true; this.state = 'closed'; }
    createGain() { return node({ gain: param() }); }
    createOscillator() {
      return node({
        type: 'sine', frequency: param(), detune: param(), onended: null,
        start() { log.started++; }, stop() { log.stopped++; }
      });
    }
    createBufferSource() {
      return node({
        buffer: null, loop: false, onended: null,
        start() { log.started++; }, stop() { log.stopped++; }
      });
    }
    createBuffer(ch, len) {
      log.buffers++;
      const data = new Float32Array(len);
      return { length: len, getChannelData: () => data };
    }
    createBiquadFilter() {
      return node({ type: 'lowpass', frequency: param(), Q: param() });
    }
    createConvolver() { return node({ buffer: null }); }
    createWaveShaper() { return node({ curve: null, oversample: 'none' }); }
  }
  const prev = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  return { log, restore() { globalThis.AudioContext = prev; } };
}

test('createAudio erzeugt Stimmen erst nach unlock und beachtet stumm', async () => {
  const fake = installFakeAudio();
  try {
    const audio = createAudio();
    audio.setProfile(SKINS.arcade.audio);
    audio.play('jump');
    assert.equal(fake.log.started, 0, 'ohne Nutzergeste darf nichts klingen');

    await audio.unlock();
    assert.ok(fake.log.resumed >= 1, 'unlock muss den Kontext fortsetzen');
    const afterUnlock = fake.log.started;   // stumme Freischaltprobe
    audio.play('jump');                     // Arcade: drei Noten
    assert.equal(fake.log.started - afterUnlock, 3, 'Arpeggio erzeugt drei Quellen');

    audio.play('invalid');                  // Rauschstimme mit Bandpass
    assert.equal(fake.log.started - afterUnlock, 4);

    audio.setMuted(true);
    audio.play('win');
    assert.equal(fake.log.started - afterUnlock, 4, 'stumm heisst stumm');
    audio.setMuted(false);

    audio.setProfile(SKINS.apple.audio);    // mit Hall
    audio.play('win');                      // Apple: fuenf Noten
    assert.equal(fake.log.started - afterUnlock, 9);

    audio.dispose();
    assert.equal(fake.log.closed, true, 'dispose schliesst den Kontext');
    audio.play('tap');
    assert.equal(fake.log.started - afterUnlock, 9, 'nach dispose bleibt es still');
  } finally {
    fake.restore();
  }
});

test('createAudio bleibt ohne WebAudio und ohne Nutzergeste stumm', async () => {
  const audio = createAudio();
  assert.deepEqual(Object.keys(audio).sort(),
    ['dispose', 'play', 'setMuted', 'setProfile', 'unlock']);
  audio.setProfile(SKINS.arcade.audio);
  // Ohne unlock() darf play() nichts anfassen; ohne AudioContext auch danach nicht.
  assert.doesNotThrow(() => audio.play('tap'));
  await audio.unlock();
  for (const ev of AUDIO_EVENTS) assert.doesNotThrow(() => audio.play(ev, { gain: 0.5 }));
  assert.doesNotThrow(() => audio.play('gibtEsNicht'));
  audio.setMuted(true);
  audio.setMuted(false);
  audio.setProfile(SKINS.modern.audio);
  audio.dispose();
  assert.doesNotThrow(() => audio.play('win'));
});
