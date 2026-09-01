// Figuren: welche Zellen des Quaders ueberhaupt einen Stein tragen duerfen (SPEC §2.5).
//
// Eine Figur ist eine reine MASKE ueber dem bestehenden Brett, kein zweites Brett. Das
// Brett bleibt der volle Quader mit seiner Schritttabelle, die Zugregel bleibt Wort fuer
// Wort dieselbe; der Generator setzt nur keine Steine ausserhalb der Maske. Ein Stein
// fliegt dabei selbstverstaendlich durch die leeren Zellen neben der Figur hinaus — das
// ist genau der Grund, warum die Regel nichts von Figuren wissen muss.
//
// Rein: kein DOM, kein three, kein Zufall. Dieselbe Maske entsteht im Browser, in Node
// und im Worker aus (Figur, W, H, D) — sonst liesse sich ein eingereichter Lauf nicht
// nachpruefen.

import { MAX_CUBES } from './game.js';

/** Normierte Koordinaten einer Zelle (SPEC §2.5.1). */
function normiert(x, y, z, W, H, D) {
  return {
    u: ((x + 0.5) / W) * 2 - 1,        // links/rechts, (-1, 1)
    v: (y + 0.5) / H,                  // unten/oben,   (0, 1)
    w: ((z + 0.5) / D) * 2 - 1         // vorn/hinten,  (-1, 1)
  };
}

/** Kleinster Winkelabstand zweier Winkel, in Radiant. */
function winkelAbstand(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

// --- Die Figuren ---------------------------------------------------------
//
// `min` ist die kleinste Kantenlaenge, bei der die Figur noch als solche zu erkennen
// ist. Kleinere Wuensche werden nach oben gezogen (siehe massFuer). `dichte` ist die
// Zieldichte INNERHALB der Maske: bei einer Figur soll die Silhouette geschlossen
// wirken, deshalb liegt sie hoeher als beim Quader.
//
// `mobility` ist das erlaubte Band der Beweglichkeit (Anteil im Startzustand ziehbarer
// Steine). Beim Quader haelt es Level fern, in denen ohnehin fast alles geht. Eine duenne
// Figur ist aber VON NATUR AUS beweglich — ein Weinglas hat einen ein Feld dicken Stiel,
// da kann fast jeder Stein sofort heraus. Mit dem Turmband faellt jeder Versuch durch
// und der Generator laeuft zwoelfmal umsonst. Deshalb traegt jede Figur ihr eigenes Band;
// `null` heisst: das der Levelkurve.

const HERZ = {
  id: 'HERZ',
  name: 'Herz',
  min: { W: 9, H: 9, D: 5 },
  dichte: 0.97,
  mobility: [0.10, 0.90],
  drin(u, v, w) {
    // Zwei Lappen plus Spitze statt der klassischen Herzkurve: deren Einkerbung ist so
    // flach, dass sie im Raster erst ab etwa 20 Zellen Breite sichtbar wird. Aus Kreisen
    // und Dreieck gebaut, steht die Kerbe schon bei neun Zellen.
    if (Math.abs(w) > 0.95) return false;
    const s = 1 - 0.40 * w * w;              // zur Vorder- und Rueckseite schlanker
    const cu = u / s, cv = (v * 2 - 1) / s;
    if (cv > 0.34) {
      return Math.hypot(cu - 0.40, cv - 0.34) <= 0.50
          || Math.hypot(cu + 0.40, cv - 0.34) <= 0.50;
    }
    return Math.abs(cu) <= 0.90 * ((cv + 1.0) / 1.34);
  }
};

const WEINGLAS = {
  id: 'WEINGLAS',
  name: 'Weinglas',
  min: { W: 7, H: 12, D: 7 },
  dichte: 0.98,
  mobility: [0.10, 0.95],
  drin(u, v, w) {
    const r = Math.hypot(u, w);
    // Rotationskoerper: Fuss, Stiel, Kelch. R(v) ist der Aussenradius auf Hoehe v.
    let R;
    if (v < 0.07) R = 0.86;                                  // Fuss
    else if (v < 0.13) R = 0.86 - ((v - 0.07) / 0.06) * 0.68; // Uebergang zum Stiel
    else if (v < 0.46) R = 0.18;                              // Stiel
    else R = 0.18 + 0.78 * Math.sqrt((v - 0.46) / 0.54);      // Kelch
    if (r > R) return false;
    // Der Kelch ist oben hohl. Bei kleinen Kaesten wird die Aushoehlung von selbst
    // negativ und faellt weg, statt die Figur zu zerloechern.
    if (v > 0.70 && r <= R - 0.30) return false;
    return true;
  }
};

const PYRAMIDE = {
  id: 'PYRAMIDE',
  name: 'Stufenpyramide',
  min: { W: 9, H: 10, D: 9 },
  dichte: 0.97,
  mobility: [0.10, 0.85],
  drin(u, v, w) {
    // Zikkurat aus fuenf Stufen: quadratischer Grundriss, der stufenweise einrueckt.
    // Die Hoehe ist ein Vielfaches von fuenf, damit jede Stufe gleich hoch ausfaellt
    // und die Treppe nicht zur schiefen Rampe verwaschen wird.
    const stufe = Math.min(4, Math.floor(v * 5));
    return Math.max(Math.abs(u), Math.abs(w)) <= 1.0 - stufe * 0.22;
  }
};

const DREISTERN = {
  id: 'DREISTERN',
  name: 'Dreistern im Ring',
  min: { W: 11, H: 11, D: 3 },
  dichte: 0.98,
  mobility: [0.10, 0.90],
  drin(u, v, w) {
    // Flaches Medaillon, aufrecht stehend: Ring, Nabe, drei Zacken. Bewusst eine
    // eigene, freie Geometrie und kein fremdes Markenzeichen.
    if (Math.abs(w) > 0.7) return false;
    const cu = u, cv = v * 2 - 1;
    const rr = Math.hypot(cu, cv);
    if (rr > 1.0) return false;
    if (rr >= 0.80) return true;                       // Ring
    if (rr <= 0.17) return true;                       // Nabe
    const ang = Math.atan2(cv, cu);
    for (let k = 0; k < 3; k++) {
      const ziel = Math.PI / 2 + (k * 2 * Math.PI) / 3;
      // Die Zacken laufen nach aussen schmaler zu.
      if (winkelAbstand(ang, ziel) <= 0.30 - 0.10 * rr) return true;
    }
    return false;
  }
};

const BAUM = {
  id: 'BAUM',
  name: 'Baum',
  min: { W: 9, H: 13, D: 9 },
  dichte: 0.97,
  mobility: [0.10, 0.90],
  drin(u, v, w) {
    const r = Math.hypot(u, w);
    if (v < 0.42) return r <= 0.16;                    // Stamm, bewusst duenn
    // Runde Krone auf langem Stamm. Ein KEGEL waere auch ein Baum, saehe aber aus dem
    // Standardblickwinkel der Stufenpyramide zum Verwechseln aehnlich; die Kugel auf dem
    // sichtbaren Stamm haelt die beiden Figuren auseinander.
    const dv = (v - 0.72) * 2.40;
    return Math.hypot(r, dv) <= 0.72;
  }
};

const QUADER = {
  id: 'QUADER',
  name: 'Turm (voller Quader)',
  min: { W: 3, H: 2, D: 3 },
  dichte: null,          // der Quader behaelt die Dichte der Levelkurve
  mobility: null,      // ebenso das Band
  drin() { return true; }
};

export const FIGUREN = Object.freeze([QUADER, HERZ, WEINGLAS, PYRAMIDE, DREISTERN, BAUM]
  .map((f) => Object.freeze(f)));

export const FIGUR_STANDARD = 'QUADER';

/** @returns {Object} die Figur zu dieser Kennung; wirft, statt still auf QUADER zu fallen. */
export function figurVon(id) {
  const gesucht = id === undefined || id === null ? FIGUR_STANDARD : String(id);
  for (const f of FIGUREN) if (f.id === gesucht) return f;
  throw new RangeError('Unbekannte Figur: ' + gesucht);
}

/** @returns {boolean} ohne zu werfen. */
export function istFigur(id) {
  for (const f of FIGUREN) if (f.id === id) return true;
  return false;
}

/**
 * Masse, mit denen diese Figur gebaut wird.
 *
 * Zwei Schranken, in dieser Reihenfolge: nie unter das Mindestmass der Figur (ein Herz
 * in einem 3x4x3-Kasten waere ein Klumpen aus neun Steinen), und nie ueber MAX_CUBES —
 * sonst wirft buildBoard, sobald jemand eine grosse Groesse mit einer breiten Figur
 * kombiniert. Gekuerzt wird dabei immer die Dimension mit dem groessten Vorsprung vor
 * ihrem eigenen Mindestmass, damit die Figur ihre Proportionen behaelt.
 *
 * Dass das Mindestmass selbst passt, sichert §10.14 Test 1 ab.
 * @returns {{W:number, H:number, D:number}}
 */
export function massFuer(id, W, H, D) {
  const f = figurVon(id);
  const m = {
    W: Math.max(f.min.W, W | 0),
    H: Math.max(f.min.H, H | 0),
    D: Math.max(f.min.D, D | 0)
  };
  const achsen = ['W', 'H', 'D'];
  let schutz = 3 * 24;
  while (m.W * m.H * m.D > MAX_CUBES && schutz-- > 0) {
    let beste = null, bester = 0;
    for (const a of achsen) {
      const luft = m[a] - f.min[a];
      if (luft > bester) { bester = luft; beste = a; }
    }
    if (beste === null) break;      // schon auf dem Mindestmass: §10.14 faengt das ab
    m[beste]--;
  }
  return m;
}

/**
 * Die Maske der Figur auf diesem Brett: 1 = diese Zelle darf einen Stein tragen.
 *
 * Deterministisch aus (Figur, W, H, D) — kein Zufall, keine Zeit, keine Umgebung. Der
 * Worker baut dieselbe Maske aus demselben Levelcode, sonst liesse sich ein
 * eingereichter Lauf nicht nachspielen (SPEC §9.5).
 *
 * @param {Object} board @param {string} id
 * @returns {Uint8Array} Laenge board.C
 */
export function figurMaske(board, id) {
  const f = figurVon(id);
  const maske = new Uint8Array(board.C);
  if (f.id === FIGUR_STANDARD) { maske.fill(1); return maske; }

  const W = board.W, H = board.H, D = board.D;
  for (let i = 0; i < board.C; i++) {
    const x = board.lattice[i * 3], y = board.lattice[i * 3 + 1], z = board.lattice[i * 3 + 2];
    const n = normiert(x, y, z, W, H, D);
    if (f.drin(n.u, n.v, n.w)) maske[i] = 1;
  }
  return maske;
}

/** Zahl der Zellen, die die Maske freigibt. */
export function maskenZellen(maske) {
  let n = 0;
  for (let i = 0; i < maske.length; i++) if (maske[i]) n++;
  return n;
}
