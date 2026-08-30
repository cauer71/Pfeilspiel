// Pfeilspiel — Skins (SPEC §4.4, §7).
// Ein Skin ist eine reine, JSON-serialisierbare Datenstruktur: keine THREE-Konstanten,
// keine Funktionen. Strings wie 'ACESFilmic' oder 'appleSpring' werden erst hier in
// numerische THREE-Enums bzw. Easingfunktionen aufgeloest. Dieses Modul importiert
// bewusst kein 'three' und greift nur innerhalb der Funktionen auf das DOM zu, damit
// SKINS ohne WebGL in `node --test` pruefbar bleibt (SPEC §7.1).

/** @typedef {Object} SkinTokens siehe SPEC §7.2 */

// --- Skinliste ----------------------------------------------------------

/** @type {readonly ['modern','apple','arcade']} */
export const SKIN_IDS = Object.freeze(['modern', 'apple', 'arcade']);

/** Speicherschluessel der zuletzt gewaehlten Skin-Id. */
const STORAGE_KEY = 'pfeilspiel.skin';

// --- Tokensaetze --------------------------------------------------------

export const SKINS = {
  modern: {
    id: 'modern', label: 'Modern',
    meta: { themeColor: '#0E1116', colorScheme: 'dark' },
    css: {
      '--ps-bg': '#0E1116', '--ps-bg-2': '#151A21',
      '--ps-panel-bg': 'rgba(21,26,33,.86)', '--ps-panel-blur': '8px',
      '--ps-panel-border': '1px solid rgba(255,255,255,.08)',
      '--ps-panel-shadow': '0 12px 32px rgba(0,0,0,.45)', '--ps-panel-radius': '14px',
      '--ps-fg': '#ECEEF2', '--ps-fg-muted': '#98A1AE',
      '--ps-accent': '#5B8CFF', '--ps-accent-2': '#5B8CFF',
      '--ps-accent-soft': 'rgba(91,140,255,.16)', '--ps-accent-fg': '#08111F',
      '--ps-success': '#3FBF7F', '--ps-danger': '#E2564A',
      '--ps-btn-bg': '#1C222B', '--ps-btn-bg-hover': '#232B36', '--ps-btn-fg': '#ECEEF2',
      '--ps-btn-border': '1px solid rgba(255,255,255,.10)', '--ps-btn-radius': '10px',
      '--ps-btn-press': 'scale(.97)',
      '--ps-font-ui': 'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      '--ps-font-num': 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      '--ps-size-hud': '14px', '--ps-size-title': '28px',
      '--ps-tracking': '.01em', '--ps-transform': 'none', '--ps-text-shadow': 'none',
      '--ps-weight': '560', '--ps-dur-ui': '160ms', '--ps-ease-ui': 'cubic-bezier(.2,.8,.2,1)',
      '--ps-scrim': 'rgba(6,8,12,.62)', '--ps-focus-ring': '0 0 0 2px rgba(91,140,255,.55)',
      '--ps-scanline-opacity': '0', '--ps-scanline-period': '3px',
      '--ps-grille-opacity': '0', '--ps-vignette': '0',
      '--ps-canvas-filter': 'none', '--ps-color-scheme': 'dark',
      '--ps-gap': '10px', '--ps-hud-pad': '12px 14px'
    },
    three: {
      background: 0x0E1116,
      hemi: { sky: 0x8FA3BD, ground: 0x0A0C10, intensity: 0.55 },
      key: { color: 0xFFFFFF, intensity: 2.2, castShadow: true },
      fill: { color: 0x5B8CFF, intensity: 0.45 },
      envIntensity: 0.50, toneMapping: 'ACESFilmic', exposure: 1.05, shadows: true,
      cube: {
        roughness: 0.62, metalness: 0.0, emissive: 0x000000,
        emissiveIntensity: 0.0, envMapIntensity: 0.5
      },
      cubeLow: { roughness: 0.68, transmission: 0, opacity: 1 },
      target: { color: '#4ADE80', emissive: 0x0F3D24, emissiveIntensity: 0.60 },
      hover: { emissive: 0x5B8CFF, emissiveIntensity: 0.22 },
      ghost: { opacity: 0.16 },
      coreBox: { color: 0x0E1116, opacity: 1.0 },
      atlas: {
        tile: 256, gutter: 16, style: 'solidTriangle',
        body: '#F2F1EE', bodyTarget: '#4ADE80', glyph: '#12151A', glyphAlpha: 1,
        accent: '#5B8CFF', margin: 0.18, shaft: 0.24, head: 0.56, radius: 0.05,
        stroke: 0.11, grid: 16, glow: 0, nearest: false, anisotropy: 8
      }
    },
    motion: {
      step: { dur: 150, ease: 'inOutCubic' },
      jump: { dur: 260, ease: 'inOutCubic', arc: 0.55 },
      chain: { delay: 45 },
      wobble: { dur: 260, ease: 'outCubic', amp: 0.10, cycles: 3 },
      fly: { dur: 420, ease: 'inQuad', spin: 1.5 },
      spawn: { dur: 280, ease: 'outCubic' }, spawnStagger: 14,
      shake: { amp: 0, dur: 0, freq: 0 }, camera: { dur: 500 }
    },
    audio: {
      master: 0.42, bitcrush: 0, reverb: null, events: {
        tap: { wave: 'sine', notes: [660], dur: .05, a: .004, r: .05, gain: .10 },
        move: {
          wave: 'triangle', notes: [440], dur: .09, a: .004, r: .07, gain: .12,
          filter: { type: 'lowpass', freq: 2600, q: .7 }
        },
        jump: { wave: 'triangle', notes: [523, 784], arpMs: 55, dur: .16, a: .004, r: .09, gain: .14 },
        chain: { wave: 'triangle', notes: [659, 988], arpMs: 45, dur: .14, a: .004, r: .08, gain: .15 },
        invalid: { wave: 'sine', notes: [196, 185], arpMs: 60, dur: .16, a: .006, r: .10, gain: .11 },
        fly: { wave: 'sine', notes: [330], glideTo: 120, dur: .42, a: .006, r: .20, gain: .10 },
        win: {
          wave: 'triangle', notes: [523, 659, 784, 1047], arpMs: 110, dur: .70,
          a: .01, r: .25, gain: .16
        },
        undo: { wave: 'sine', notes: [392, 294], arpMs: 70, dur: .16, a: .005, r: .09, gain: .10 },
        ui: { wave: 'sine', notes: [880], dur: .03, a: .002, r: .03, gain: .07 },
        skin: { wave: 'triangle', notes: [587, 880], arpMs: 70, dur: .20, a: .006, r: .12, gain: .12 }
      }
    },
    fx: {
      crt: { enabled: false, opacity: 0, periodPx: 3, grille: 0, vignette: 0, roll: false, flicker: 0 },
      canvasFilter: 'none', screenShake: false, sounds: true
    }
  },

  apple: {
    id: 'apple', label: 'Apple',
    meta: { themeColor: '#F4F5F7', colorScheme: 'light' },
    css: {
      '--ps-bg': '#F4F5F7', '--ps-bg-2': '#FFFFFF',
      '--ps-panel-bg': 'rgba(255,255,255,.58)', '--ps-panel-blur': '24px',
      '--ps-panel-border': '1px solid rgba(255,255,255,.72)',
      '--ps-panel-shadow': '0 10px 34px rgba(16,24,40,.10), 0 1px 2px rgba(16,24,40,.06)',
      '--ps-panel-radius': '22px',
      '--ps-fg': '#1C1C1E', '--ps-fg-muted': '#5A5A5F',
      '--ps-accent': '#0A84FF', '--ps-accent-2': '#5AC8FA',
      '--ps-accent-soft': 'rgba(10,132,255,.12)', '--ps-accent-fg': '#FFFFFF',
      '--ps-success': '#30D158', '--ps-danger': '#FF3B30',
      '--ps-btn-bg': 'rgba(255,255,255,.75)', '--ps-btn-bg-hover': 'rgba(255,255,255,.94)',
      '--ps-btn-fg': '#1C1C1E', '--ps-btn-border': '1px solid rgba(255,255,255,.85)',
      '--ps-btn-radius': '18px', '--ps-btn-press': 'scale(.96)',
      '--ps-font-ui': '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
      '--ps-font-num': 'ui-monospace,SFMono-Regular,Menlo,monospace',
      '--ps-size-hud': '15px', '--ps-size-title': '30px',
      '--ps-tracking': '-.01em', '--ps-transform': 'none', '--ps-text-shadow': 'none',
      '--ps-weight': '590', '--ps-dur-ui': '320ms', '--ps-ease-ui': 'cubic-bezier(.22,1,.36,1)',
      '--ps-scrim': 'rgba(242,242,247,.72)', '--ps-focus-ring': '0 0 0 4px rgba(10,132,255,.28)',
      '--ps-scanline-opacity': '0', '--ps-scanline-period': '3px',
      '--ps-grille-opacity': '0', '--ps-vignette': '0',
      '--ps-canvas-filter': 'none', '--ps-color-scheme': 'light',
      '--ps-gap': '12px', '--ps-hud-pad': '14px 18px'
    },
    three: {
      background: 0xD9E1EB,   // deutlich dunkler als die Wuerfel, sonst verschwinden sie
      hemi: { sky: 0xFFFFFF, ground: 0xA9B7C7, intensity: 1.05 },
      key: { color: 0xFFFFFF, intensity: 1.25, castShadow: true },
      fill: { color: 0xCFE3FF, intensity: 0.28 },
      envIntensity: 0.55, toneMapping: 'Neutral', exposure: 0.96, shadows: true,
      cube: {
        roughness: 0.34, metalness: 0.0, emissive: 0x000000,
        emissiveIntensity: 0.0, envMapIntensity: 0.50
      },
      cubeLow: { roughness: 0.32, transmission: 0, opacity: 0.96 },
      target: { color: '#34C759', emissive: 0x134A25, emissiveIntensity: 0.25 },
      hover: { emissive: 0x0A84FF, emissiveIntensity: 0.12 },
      ghost: { opacity: 0.14 },
      coreBox: { color: 0xD9E1EB, opacity: 1.0 },
      atlas: {
        tile: 256, gutter: 16, style: 'softChevron',
        body: '#FFFFFF', bodyTarget: '#BFF7CE', glyph: '#1C1C1E', glyphAlpha: 0.92,
        accent: '#0A84FF', margin: 0.26, shaft: 0.22, head: 0.50, radius: 0.10,
        stroke: 0.11, grid: 16, glow: 0, nearest: false, anisotropy: 8
      }
    },
    motion: {
      step: { dur: 220, ease: 'appleSpring' },
      jump: { dur: 340, ease: 'appleSpring', arc: 0.62 },
      chain: { delay: 70 },
      wobble: { dur: 360, ease: 'appleSpring', amp: 0.06, cycles: 2 },
      fly: { dur: 620, ease: 'inQuad', spin: 0.8 },
      spawn: { dur: 520, ease: 'appleSpring' }, spawnStagger: 22,
      shake: { amp: 0, dur: 0, freq: 0 }, camera: { dur: 620 }
    },
    audio: {
      master: 0.38, bitcrush: 0, reverb: { wet: 0.25, seconds: 1.4, decay: 3.2 }, events: {
        tap: { wave: 'triangle', notes: [698], dur: .06, a: .008, r: .08, gain: .09 },
        move: {
          wave: 'triangle', notes: [523], dur: .12, a: .010, r: .12, gain: .11,
          filter: { type: 'lowpass', freq: 3000, q: .6 }
        },
        jump: { wave: 'triangle', notes: [587, 880], arpMs: 70, dur: .20, a: .010, r: .14, gain: .12 },
        chain: { wave: 'triangle', notes: [698, 1047], arpMs: 60, dur: .18, a: .010, r: .12, gain: .13 },
        invalid: { wave: 'sine', notes: [262, 247], arpMs: 70, dur: .18, a: .012, r: .14, gain: .10 },
        fly: { wave: 'sine', notes: [440], glideTo: 180, dur: .60, a: .010, r: .30, gain: .10 },
        win: {
          wave: 'triangle', notes: [523, 659, 784, 1047, 1319], arpMs: 130, dur: .90,
          a: .012, r: .35, gain: .14
        },
        undo: { wave: 'triangle', notes: [440, 349], arpMs: 80, dur: .18, a: .010, r: .12, gain: .09 },
        ui: { wave: 'sine', notes: [988], dur: .04, a: .004, r: .05, gain: .06 },
        skin: { wave: 'triangle', notes: [659, 988], arpMs: 90, dur: .25, a: .012, r: .18, gain: .11 }
      }
    },
    fx: {
      crt: { enabled: false, opacity: 0, periodPx: 3, grille: 0, vignette: 0, roll: false, flicker: 0 },
      canvasFilter: 'none', screenShake: false, sounds: true
    }
  },

  arcade: {
    id: 'arcade', label: 'Arcade',
    meta: { themeColor: '#07020F', colorScheme: 'dark' },
    css: {
      '--ps-bg': '#07020F', '--ps-bg-2': '#12042A',
      '--ps-panel-bg': 'rgba(10,2,24,.86)', '--ps-panel-blur': '0px',
      '--ps-panel-border': '2px solid #00F0FF',
      '--ps-panel-shadow': '0 0 0 2px #07020F, 0 0 18px rgba(0,240,255,.55), inset 0 0 24px rgba(255,46,136,.12)',
      '--ps-panel-radius': '0px',
      '--ps-fg': '#E8FBFF', '--ps-fg-muted': '#7FD8E8',
      '--ps-accent': '#FF2E88', '--ps-accent-2': '#00F0FF',
      '--ps-accent-soft': 'rgba(255,46,136,.18)', '--ps-accent-fg': '#07020F',
      '--ps-success': '#39FF14', '--ps-danger': '#FF3131',
      '--ps-btn-bg': '#12042A', '--ps-btn-bg-hover': '#1E0642', '--ps-btn-fg': '#E8FBFF',
      '--ps-btn-border': '2px solid #FF2E88', '--ps-btn-radius': '0px',
      '--ps-btn-press': 'translateY(2px)',
      '--ps-font-ui': 'ui-monospace,"Courier New",monospace',
      '--ps-font-num': 'ui-monospace,"Courier New",monospace',
      '--ps-size-hud': '13px', '--ps-size-title': '26px',
      '--ps-tracking': '.12em', '--ps-transform': 'uppercase',
      '--ps-text-shadow': '0 0 6px currentColor, 0 0 16px rgba(255,46,136,.55)',
      '--ps-weight': '700', '--ps-dur-ui': '90ms', '--ps-ease-ui': 'steps(4,end)',
      '--ps-scrim': 'rgba(7,2,15,.82)', '--ps-focus-ring': '0 0 0 2px #FFE600',
      '--ps-scanline-opacity': '.30', '--ps-scanline-period': '3px',
      '--ps-grille-opacity': '.10', '--ps-vignette': '.55',
      '--ps-canvas-filter': 'saturate(1.20) contrast(1.06)', '--ps-color-scheme': 'dark',
      '--ps-gap': '8px', '--ps-hud-pad': '10px 12px'
    },
    three: {
      background: 0x05070A,
      hemi: { sky: 0x2A1F4A, ground: 0x000814, intensity: 0.35 },
      key: { color: 0xFFFFFF, intensity: 0.90, castShadow: false },
      fill: { color: 0xFF2E88, intensity: 0.60 },
      envIntensity: 0.15, toneMapping: 'None', exposure: 1.00, shadows: false,
      cube: {
        roughness: 1.0, metalness: 0.0, emissive: 0x1A0A2E,
        emissiveIntensity: 1.40, envMapIntensity: 0.15
      },
      cubeLow: { roughness: 1.0, transmission: 0, opacity: 1 },
      target: { color: '#39FF14', emissive: 0x1B4D0C, emissiveIntensity: 1.60 },
      hover: { emissive: 0xFF2E88, emissiveIntensity: 0.50 },
      ghost: { opacity: 0.18 },
      coreBox: { color: 0x05070A, opacity: 1.0 },
      atlas: {
        tile: 128, gutter: 16, style: 'pixelArrow',
        body: '#EDEDF5', bodyTarget: '#39FF14', glyph: '#12021F', glyphAlpha: 1,
        accent: '#FF2E88', margin: 0.125, shaft: 0.25, head: 0.50, radius: 0,
        stroke: 0.12, grid: 16, glow: 1.5, nearest: true, anisotropy: 1
      }
    },
    motion: {
      step: { dur: 120, ease: 'stepped6' },
      jump: { dur: 200, ease: 'stepped8', arc: 0.45 },
      chain: { delay: 35 },
      wobble: { dur: 180, ease: 'stepped6', amp: 0.18, cycles: 4 },
      fly: { dur: 340, ease: 'linear', spin: 6.0 },
      spawn: { dur: 160, ease: 'stepped6' }, spawnStagger: 8,
      shake: { amp: 0.28, dur: 180, freq: 38 }, camera: { dur: 260 }
    },
    audio: {
      master: 0.50, bitcrush: 6, reverb: null, events: {
        tap: { wave: 'square', notes: [880], dur: .045, a: .001, r: .03, gain: .20 },
        move: { wave: 'square', notes: [523, 784], arpMs: 38, dur: .09, a: .001, r: .03, gain: .22 },
        jump: { wave: 'square', notes: [659, 988, 1319], arpMs: 35, dur: .12, a: .001, r: .03, gain: .26 },
        chain: {
          wave: 'square', notes: [988, 1319, 1760], arpMs: 30, dur: .10, a: .001, r: .03,
          gain: .28, detune: 12
        },
        invalid: {
          wave: 'noise', dur: .13, a: .001, r: .05, gain: .25,
          filter: { type: 'bandpass', freq: 520, q: 1.2 }
        },
        fly: { wave: 'sawtooth', notes: [220], glideTo: 60, dur: .35, a: .001, r: .10, gain: .22 },
        win: {
          wave: 'square', notes: [523, 659, 784, 1047, 1319], arpMs: 90, dur: .55,
          a: .001, r: .06, gain: .30
        },
        undo: { wave: 'triangle', notes: [440, 330], arpMs: 60, dur: .12, a: .001, r: .04, gain: .18 },
        ui: { wave: 'square', notes: [1320], dur: .03, a: .001, r: .02, gain: .12 },
        skin: { wave: 'square', notes: [262, 523, 1047], arpMs: 45, dur: .20, a: .001, r: .04, gain: .24 }
      }
    },
    fx: {
      crt: {
        enabled: true, opacity: 0.30, periodPx: 3, grille: 0.10, vignette: 0.55,
        roll: true, flicker: 0.04
      },
      canvasFilter: 'saturate(1.20) contrast(1.06)', screenShake: true, sounds: true
    }
  }
};

// --- Zugriff ------------------------------------------------------------

/**
 * Liefert den Tokensatz zu einer Skin-Id.
 * @param {string} id
 * @returns {SkinTokens}
 */
export function getSkin(id) {
  const skin = Object.prototype.hasOwnProperty.call(SKINS, id) ? SKINS[id] : null;
  if (!skin) throw new Error('Unbekannter Skin: ' + String(id));
  return skin;
}

/**
 * Rangfolge nach SPEC §4.4: `?skin=` schlaegt localStorage, localStorage schlaegt das
 * uebergebene `pref`, danach greift 'modern'. Ungueltige Werte werden uebersprungen,
 * nie geworfen: ein kaputter Link darf den Start nicht verhindern.
 * @param {string} [pref]
 * @returns {string}
 */
export function resolveSkinId(pref) {
  const candidates = [queryParamSkin(), storedSkinId(), pref];
  for (const c of candidates) {
    if (typeof c === 'string' && Object.prototype.hasOwnProperty.call(SKINS, c)) return c;
  }
  return 'modern';
}

/** Liest `?skin=` aus der aktuellen URL; null ausserhalb des Browsers. */
function queryParamSkin() {
  try {
    if (typeof location === 'undefined' || !location.search) return null;
    return new URLSearchParams(location.search).get('skin');
  } catch (err) {
    return null;
  }
}

/** Liest die gespeicherte Skin-Id; localStorage kann geworfen haben (Privatmodus). */
function storedSkinId() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return null;
  }
}

// --- Easing -------------------------------------------------------------

function stepped(n) {
  return (t) => (t >= 1 ? 1 : Math.floor(t * n) / n);
}

/**
 * Registry aller in `skin.motion` zulaessigen Easingnamen. Sie ist deckungsgleich mit
 * `Ease` aus render.js; hier steht sie eigenstaendig, damit skins.js three-frei bleibt.
 */
const EASING = Object.freeze({
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inQuad: (t) => t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // Gedaempfte Feder mit leichtem Ueberschwingen, endet exakt auf 1.
  appleSpring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(7.0 * t)),
  stepped6: stepped(6),
  stepped8: stepped(8)
});

/**
 * Loest einen Easingnamen aus `skin.motion` auf; unbekannte Namen liefern `linear`.
 * @param {string} name
 * @returns {(t:number)=>number}
 */
export function easingOf(name) {
  return (typeof name === 'string' && typeof EASING[name] === 'function')
    ? EASING[name] : EASING.linear;
}

// --- DOM ----------------------------------------------------------------

/** Zuletzt bespielte Wurzel; die Scanlinien-Periode haengt an der Fensterhoehe. */
let periodRoot = null;
let periodListenerAttached = false;

/** SPEC §7.6: max(2, round(innerHeight/220)) px, bei Skinwechsel und Resize. */
function updateScanlinePeriod() {
  if (!periodRoot || !periodRoot.style) return;
  const h = (typeof innerHeight === 'number' && innerHeight > 0) ? innerHeight : 880;
  periodRoot.style.setProperty('--ps-scanline-period', Math.max(2, Math.round(h / 220)) + 'px');
}

/**
 * Schreibt die CSS-Custom-Properties, `data-skin`, `color-scheme` und `theme-color`.
 * Reihenfolge beim Skinwechsel: applySkinThree baut neu, ruft applySkinDom und gibt
 * erst nach einem gerenderten Bild frei (SPEC §7.7).
 * @param {SkinTokens} skin
 * @param {HTMLElement} [root] Standard: documentElement
 */
export function applySkinDom(skin, root) {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el || !el.style) return;

  for (const key of Object.keys(skin.css)) el.style.setProperty(key, skin.css[key]);

  // Werte, die kein statisches Token ausdruecken kann.
  el.style.setProperty('--ps-crt-anim', skin.fx.crt.roll ? 'running' : 'paused');
  el.style.setProperty('--ps-crt-flicker', String(skin.fx.crt.flicker));
  el.style.setProperty('--ps-canvas-filter', sanitizeCanvasFilter(skin.fx.canvasFilter));

  if (typeof el.setAttribute === 'function') el.setAttribute('data-skin', skin.id);
  el.style.colorScheme = skin.meta.colorScheme;

  periodRoot = el;
  updateScanlinePeriod();
  if (!periodListenerAttached && typeof addEventListener === 'function') {
    addEventListener('resize', updateScanlinePeriod, { passive: true });
    periodListenerAttached = true;
  }

  setThemeColor(skin.meta.themeColor);
  rememberSkinId(skin.id);
}

/**
 * `canvasFilter` darf nur saturate/contrast enthalten (SPEC §7.6): ein Vollbild-Blur
 * oder drop-shadow pro Bild kostet mehr als der gesamte Rest der Szene.
 */
function sanitizeCanvasFilter(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.trim() === 'none') return 'none';
  const parts = value.match(/[a-zA-Z-]+\([^()]*\)/g) || [];
  const kept = parts.filter((p) => /^(saturate|contrast)\(/.test(p));
  return kept.length ? kept.join(' ') : 'none';
}

function setThemeColor(color) {
  if (typeof document === 'undefined' || !document.head) return;
  let meta = document.head.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', color);
}

function rememberSkinId(id) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, id);
  } catch (err) {
    // Privatmodus oder blockierter Speicher: der Skin gilt dann nur fuer diese Sitzung.
  }
}

// --- Three --------------------------------------------------------------

/** Numerische THREE-Enums; hier aufgeloest, damit skins.js three-frei bleibt. */
const TONE_MAPPING = Object.freeze({ None: 0, ACESFilmic: 4, Neutral: 7 });

/**
 * Uebertraegt den Skin auf Renderer, Szene, Lichter und Turmansicht.
 * `view.setSkin` baut Atlas und Materialien zuerst neu und gibt die alten erst nach
 * einem gerenderten Bild frei (SPEC §7.7). Vorher MUSS `anim.finishAll()` gelaufen sein.
 * @param {SkinTokens} skin
 * @param {{renderer?:any, scene?:any, lights?:any, view?:any, worldRig?:any}} ctx
 */
export function applySkinThree(skin, ctx) {
  const t = skin.three;
  const c = ctx || {};

  if (c.renderer) {
    const tm = TONE_MAPPING[t.toneMapping];
    c.renderer.toneMapping = (typeof tm === 'number') ? tm : TONE_MAPPING.None;
    c.renderer.toneMappingExposure = t.exposure;
    if (c.renderer.shadowMap) c.renderer.shadowMap.enabled = !!t.shadows;
  }

  if (c.scene) {
    const bg = c.scene.background;
    if (bg && typeof bg.setHex === 'function') bg.setHex(t.background);
    else if (c.renderer && typeof c.renderer.setClearColor === 'function') {
      c.renderer.setClearColor(t.background, 1);
    }
    c.scene.environmentIntensity = t.envIntensity;
  }

  const lights = c.lights || {};
  if (lights.hemi) {
    if (lights.hemi.color) lights.hemi.color.setHex(t.hemi.sky);
    if (lights.hemi.groundColor) lights.hemi.groundColor.setHex(t.hemi.ground);
    lights.hemi.intensity = t.hemi.intensity;
  }
  if (lights.key) {
    if (lights.key.color) lights.key.color.setHex(t.key.color);
    lights.key.intensity = t.key.intensity;
    lights.key.castShadow = !!t.key.castShadow && !!t.shadows;
  }
  if (lights.fill) {
    if (lights.fill.color) lights.fill.color.setHex(t.fill.color);
    lights.fill.intensity = t.fill.intensity;
  }

  // Screenshake wirkt auf worldRig (SPEC §7.6); beim Wechsel bleibt kein Versatz stehen.
  if (c.worldRig && c.worldRig.position && typeof c.worldRig.position.set === 'function') {
    c.worldRig.position.set(0, 0, 0);
  }

  if (c.view && typeof c.view.setSkin === 'function') c.view.setSkin(skin);
}

// --- Klang --------------------------------------------------------------

/**
 * WebAudio-Stimmen aus `skin.audio`. Der Kontext entsteht erst in `unlock()`, also
 * ausschliesslich aus einer echten Nutzergeste; vorher ist `play()` ein No-Op.
 * @returns {{unlock:()=>Promise<void>, setProfile:(t:any)=>void,
 *            play:(event:string, opts?:{gain?:number})=>void,
 *            setMuted:(m:boolean)=>void, dispose:()=>void}}
 */
export function createAudio() {
  let ctx = null;
  let profile = null;
  let muted = false;
  let unlocked = false;
  let bus = null;          // { input, master, nodes: [] }
  let noiseBuffer = null;

  function AudioCtor() {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.AudioContext || globalThis.webkitAudioContext || null;
  }

  async function unlock() {
    if (unlocked && ctx) {
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (err) { /* egal */ } }
      return;
    }
    const Ctor = AudioCtor();
    if (!Ctor) return;
    try {
      if (!ctx) ctx = new Ctor();
      if (ctx.state === 'suspended') await ctx.resume();
      // Eine stumme Probe schaltet iOS endgueltig frei.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
      unlocked = true;
      buildBus();
    } catch (err) {
      unlocked = false;
    }
  }

  function setProfile(tokens) {
    profile = tokens || null;
    if (ctx) buildBus();
  }

  function setMuted(m) {
    muted = !!m;
    if (bus && bus.master) bus.master.gain.value = muted ? 0 : masterGain();
  }

  function masterGain() {
    const g = profile && typeof profile.master === 'number' ? profile.master : 0.4;
    return Math.max(0, Math.min(1, g));
  }

  /** Baut Summenweg, Hall und Bitcrusher neu; der alte Weg wird getrennt. */
  function buildBus() {
    if (!ctx) return;
    teardownBus();
    const nodes = [];
    const master = ctx.createGain();
    master.gain.value = muted ? 0 : masterGain();
    nodes.push(master);

    let tail = master;
    const bits = profile && profile.bitcrush ? Math.max(1, Math.min(16, profile.bitcrush)) : 0;
    if (bits > 0) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = crushCurve(bits);
      shaper.oversample = 'none';
      master.connect(shaper);
      nodes.push(shaper);
      tail = shaper;
    }
    tail.connect(ctx.destination);

    const input = ctx.createGain();
    input.gain.value = 1;
    input.connect(master);
    nodes.push(input);

    const rev = profile && profile.reverb;
    if (rev && rev.wet > 0) {
      const conv = ctx.createConvolver();
      conv.buffer = impulse(rev.seconds, rev.decay);
      const wet = ctx.createGain();
      wet.gain.value = Math.max(0, Math.min(1, rev.wet));
      input.connect(conv);
      conv.connect(wet);
      wet.connect(master);
      nodes.push(conv, wet);
    }

    bus = { input, master, nodes };
  }

  function teardownBus() {
    if (!bus) return;
    for (const n of bus.nodes) { try { n.disconnect(); } catch (err) { /* egal */ } }
    bus = null;
  }

  /** Deterministisches Rauschen; kein Math.random, damit Klang reproduzierbar bleibt. */
  function rngNoise(len, fill) {
    let a = 0x9E3779B9 >>> 0;
    for (let i = 0; i < len; i++) {
      a = (a + 0x6D2B79F5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      fill(i, ((x ^ (x >>> 14)) >>> 0) / 4294967296 * 2 - 1);
    }
  }

  function getNoise() {
    if (noiseBuffer || !ctx) return noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 1.0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    rngNoise(len, (i, v) => { data[i] = v; });
    noiseBuffer = buf;
    return noiseBuffer;
  }

  function impulse(seconds, decay) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * (seconds || 1)));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      rngNoise(len, (i, v) => { data[i] = v * Math.pow(1 - i / len, decay || 3); });
    }
    return buf;
  }

  function crushCurve(bits) {
    const steps = Math.pow(2, bits);
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  }

  /**
   * @param {string} event AudioEvent aus SPEC §7.2
   * @param {{gain?:number}} [opts]
   */
  function play(event, opts) {
    if (!ctx || !unlocked || muted || !profile || !bus) return;
    const voice = profile.events ? profile.events[event] : null;
    if (!voice) return;
    const scale = (opts && typeof opts.gain === 'number') ? opts.gain : 1;
    try {
      const t0 = ctx.currentTime + 0.005;
      const arp = (voice.arpMs || 0) / 1000;
      const notes = (voice.notes && voice.notes.length) ? voice.notes : [0];
      for (let i = 0; i < notes.length; i++) {
        const at = t0 + i * arp;
        const rest = Math.max(0.03, (voice.dur || 0.1) - i * arp);
        voiceOnce(voice, notes[i], at, rest, scale);
      }
    } catch (err) {
      // Klang ist Beiwerk; ein Fehler hier darf den Zug nicht verschlucken.
    }
  }

  function voiceOnce(voice, note, at, dur, scale) {
    const isNoise = voice.wave === 'noise';
    let src;
    if (isNoise) {
      src = ctx.createBufferSource();
      src.buffer = getNoise();
      src.loop = true;
    } else {
      src = ctx.createOscillator();
      src.type = voice.wave || 'sine';
      const f = Math.max(1, note || 440);
      src.frequency.setValueAtTime(f, at);
      if (typeof voice.detune === 'number' && src.detune) src.detune.setValueAtTime(voice.detune, at);
      if (typeof voice.glideTo === 'number') {
        src.frequency.exponentialRampToValueAtTime(Math.max(1, voice.glideTo), at + dur);
      }
    }

    let node = src;
    if (voice.filter) {
      const biq = ctx.createBiquadFilter();
      biq.type = voice.filter.type || 'lowpass';
      biq.frequency.setValueAtTime(Math.max(20, voice.filter.freq || 1000), at);
      biq.Q.setValueAtTime(Math.max(0.0001, voice.filter.q || 1), at);
      node.connect(biq);
      node = biq;
    }

    const env = ctx.createGain();
    const peak = Math.max(0.0001, (voice.gain || 0.1) * scale);
    const a = Math.max(0.001, voice.a || 0.005);
    const r = Math.max(0.005, voice.r || 0.05);
    const hold = Math.max(a, dur - r);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + a);
    env.gain.setValueAtTime(peak, at + hold);
    env.gain.linearRampToValueAtTime(0, at + hold + r);
    node.connect(env);
    env.connect(bus.input);

    const stopAt = at + hold + r + 0.02;
    src.start(at);
    src.stop(stopAt);
    src.onended = () => {
      try { env.disconnect(); src.disconnect(); } catch (err) { /* egal */ }
    };
  }

  function dispose() {
    teardownBus();
    noiseBuffer = null;
    profile = null;
    unlocked = false;
    if (ctx && typeof ctx.close === 'function') {
      try { ctx.close(); } catch (err) { /* egal */ }
    }
    ctx = null;
  }

  return { unlock, setProfile, play, setMuted, dispose };
}
