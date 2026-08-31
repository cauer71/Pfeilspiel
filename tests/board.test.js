// SPEC §10.1 — Geometrie des Bretts.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoard, cellKey, cellIndexOf, latticeOf, worldPosOf, dirWorldOf,
  validDirs, depthOf, minDepthOf, bestExitDirs,
  DIR6, DIR6_NAMES, CELL, OUT, MAX_CUBES
} from '../public/src/game.js';

/** Normalisiert -0 auf 0, damit strikte Vergleiche nicht an der Null scheitern. */
function n0(v) { return v === 0 ? 0 : v; }

/** Alle im Test benutzten Dimensionen (SPEC §10.1.2). */
function alleDims() {
  const res = [];
  for (let W = 3; W <= 8; W++)
    for (let H = 2; H <= 8; H++)
      for (let D = 3; D <= 8; D++) res.push({ W, H, D });
  return res;
}

test('1. buildBoard wirft RangeError unterhalb der Mindestmasse', () => {
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 2, H: 3, D: 3 }), RangeError);
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 3, H: 3, D: 2 }), RangeError);
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 3, H: 1, D: 3 }), RangeError);
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 0, H: 0, D: 0 }), RangeError);
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 3.5, H: 3, D: 3 }), RangeError);
});

test('1b. buildBoard wirft RangeError oberhalb der Obergrenzen', () => {
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 17, H: 3, D: 3 }), RangeError);
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 3, H: 25, D: 3 }), RangeError);
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 3, H: 3, D: 17 }), RangeError);
  // Innerhalb der Dimensionsgrenzen, aber ueber MAX_CUBES.
  assert.ok(16 * 24 * 16 > MAX_CUBES);
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 16, H: 24, D: 16 }), RangeError);
});

test('1c. Ein anderer Modus als VOLUMEN wird abgewiesen', () => {
  // Die frueher waehlbare Schalenvariante FASSADE ist entfallen (SPEC §1.4). Ein Levelcode
  // oder ein Aufruf, der sie noch verlangt, darf nicht stillschweigend als VOLUMEN gelten.
  for (const mode of ['FASSADE', 'QUATSCH', 'volumen', ''])
    assert.throws(() => buildBoard({ mode, W: 4, H: 4, D: 4 }), RangeError);
  // Ohne Angabe gilt VOLUMEN.
  assert.equal(buildBoard({ W: 4, H: 4, D: 4 }).mode, 'VOLUMEN');
});

test('2. Zellzahl folgt der Formel', () => {
  for (const { W, H, D } of alleDims())
    assert.equal(buildBoard({ mode: 'VOLUMEN', W, H, D }).C, W * H * D, `VOLUMEN ${W}x${H}x${D}`);
});

test('2b. Gitterkoordinaten und Weltpositionen sind paarweise eindeutig und im Bereich', () => {
  for (const { W, H, D } of alleDims()) {
    const b = buildBoard({ mode: 'VOLUMEN', W, H, D });
    const gitter = new Set();
    const welt = new Set();
    for (let i = 0; i < b.C; i++) {
      const [x, y, z] = latticeOf(b, i);
      assert.ok(x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D,
        `${W}x${H}x${D}: lattice ausserhalb bei ${i}`);
      gitter.add(x * 10000 + y * 100 + z);
      const p = worldPosOf(b, i);
      assert.deepEqual(p.map(n0), [
        (x - (W - 1) / 2) * CELL, (y - (H - 1) / 2) * CELL, (z - (D - 1) / 2) * CELL
      ].map(n0));
      welt.add(p.join(','));
    }
    assert.equal(gitter.size, b.C, `${W}x${H}x${D}: Gitterkoordinaten doppelt`);
    assert.equal(welt.size, b.C, `${W}x${H}x${D}: Weltpositionen doppelt`);
  }
});

test('4. step ist unter opp symmetrisch', () => {
  for (const { W, H, D } of alleDims()) {
    const b = buildBoard({ mode: 'VOLUMEN', W, H, D });
    let kanten = 0;
    for (let i = 0; i < b.C; i++) {
      for (let d = 0; d < 6; d++) {
        if (!b.valid[i * 6 + d]) continue;
        const j = b.step[i * 6 + d];
        if (j === OUT) continue;
        kanten++;
        assert.ok(b.valid[j * 6 + b.opp[d]], 'Gegenrichtung im Nachbarn ungueltig');
        assert.equal(b.step[j * 6 + b.opp[d]], i, `${W}x${H}x${D}: Asymmetrie bei ${i}/${d}`);
      }
    }
    assert.ok(kanten > 0);
  }
});

test('4b. step ist mit lattice, worldPos und dirWorld konsistent', () => {
  for (const { W, H, D } of [{ W: 5, H: 6, D: 5 }, { W: 4, H: 5, D: 3 }, { W: 7, H: 7, D: 4 }]) {
    const b = buildBoard({ mode: 'VOLUMEN', W, H, D });
    for (let i = 0; i < b.C; i++) {
      for (let d = 0; d < 6; d++) {
        if (!b.valid[i * 6 + d]) continue;
        const j = b.step[i * 6 + d];
        if (j === OUT) continue;
        const pi = worldPosOf(b, i), pj = worldPosOf(b, j), dw = dirWorldOf(b, i, d);
        for (let k = 0; k < 3; k++)
          assert.equal(n0(pj[k] - pi[k]), n0(dw[k] * CELL),
            `dirWorld passt nicht zum Schritt ${i}->${j} in Richtung ${d}`);
      }
    }
  }
});

test('5. depth faellt entlang d um genau 1 und ist 1-Lipschitz', () => {
  for (const { W, H, D } of alleDims()) {
    const b = buildBoard({ mode: 'VOLUMEN', W, H, D });
    for (let i = 0; i < b.C; i++) {
      const dirs = validDirs(b, i);
      for (const d of dirs) {
        const j = b.step[i * 6 + d];
        if (j === OUT) {
          assert.equal(depthOf(b, i, d), 0, 'Randzelle muss Tiefe 0 in Austrittsrichtung haben');
          continue;
        }
        assert.equal(depthOf(b, j, d), depthOf(b, i, d) - 1, 'Tiefe faellt nicht um genau 1');
        // 1-Lipschitz ueber alle anderen Richtungen
        for (const e of dirs) {
          const k = b.step[i * 6 + e];
          if (k === OUT) continue;
          assert.ok(Math.abs(depthOf(b, k, d) - depthOf(b, i, d)) <= 1, 'depth nicht 1-Lipschitz');
        }
      }
      const md = minDepthOf(b, i);
      assert.equal(md, Math.min(...dirs.map(d => depthOf(b, i, d))));
      const best = bestExitDirs(b, i);
      assert.ok(best.length > 0);
      assert.deepEqual(best, [...best].sort((a, c) => a - c));
      for (const d of best) assert.equal(depthOf(b, i, d), md);
      // Entlang d* faellt die Tiefe bis 0 und der Korridor verlaesst danach das Gitter.
      let cur = i, schritte = 0;
      while (b.step[cur * 6 + best[0]] !== OUT) {
        cur = b.step[cur * 6 + best[0]];
        schritte++;
        assert.ok(schritte <= md + 1, 'Korridor laenger als minDepth');
      }
      assert.equal(schritte, md);
    }
  }
});

test('6. cellKey und cellIndexOf sind zueinander invers', () => {
  for (const { W, H, D } of alleDims()) {
    const b = buildBoard({ mode: 'VOLUMEN', W, H, D });
    const keys = new Set();
    for (let i = 0; i < b.C; i++) {
      const k = cellKey(b, i);
      keys.add(k);
      assert.equal(cellIndexOf(b, k), i, `${W}x${H}x${D}: Schluessel ${k}`);
      assert.match(k, /^V:\d+:\d+:\d+$/);
    }
    assert.equal(keys.size, b.C);
    assert.equal(cellIndexOf(b, 'unsinn'), -1);
    assert.equal(cellIndexOf(b, ''), -1);
    assert.equal(cellIndexOf(b, 42), -1);
    // Schluessel der entfallenen Schalenvariante gehoeren nicht auf dieses Brett.
    assert.equal(cellIndexOf(b, 'F0:0:0'), -1);
    assert.equal(cellIndexOf(b, 'F5:0:0'), -1);
    // Ausserhalb liegende Koordinaten liefern -1, nicht etwa einen Nachbarindex.
    assert.equal(cellIndexOf(b, `V:${W}:0:0`), -1);
    assert.equal(cellIndexOf(b, `V:0:${H}:0`), -1);
  }
  assert.throws(() => cellKey(buildBoard({ mode: 'VOLUMEN', W: 3, H: 3, D: 3 }), 27), RangeError);
});

test('7. VOLUMEN kennt sechs echte Raumrichtungen', () => {
  for (const { W, H, D } of alleDims()) {
    const v = buildBoard({ mode: 'VOLUMEN', W, H, D });
    assert.equal(v.dirCount, 6);
    for (let i = 0; i < v.C; i++) {
      assert.deepEqual(validDirs(v, i), [0, 1, 2, 3, 4, 5]);
      for (let d = 0; d < 6; d++) assert.deepEqual(dirWorldOf(v, i, d).map(n0), [...DIR6[d]]);
    }
    assert.deepEqual([...v.opp], [1, 0, 3, 2, 5, 4]);
  }
  assert.deepEqual([...DIR6_NAMES], ['PX', 'NX', 'PY', 'NY', 'PZ', 'NZ']);
});

test('7b. Alle sechs Richtungen sind in JEDER Tabelle brauchbar markiert', () => {
  // `board.valid` ist die Autoritaet, an der createState eine verfaelschte Richtung erkennt
  // (SPEC §2.3). Im einzigen verbliebenen Modus gibt es keine gesperrte Richtung mehr —
  // der Test haelt fest, dass step, dirWorld und depthOf dieselbe Aussage tragen.
  for (const { W, H, D } of alleDims()) {
    const v = buildBoard({ mode: 'VOLUMEN', W, H, D });
    for (let i = 0; i < v.C; i++) {
      for (let d = 0; d < 6; d++)
        assert.equal(v.valid[i * 6 + d], 1, 'VOLUMEN muss alle sechs Richtungen erlauben');
      assert.ok(minDepthOf(v, i) <= v.C, 'minDepth stammt aus einer ungueltigen Richtung');
      const best = bestExitDirs(v, i);
      const gueltig = validDirs(v, i);
      for (const d of best) assert.ok(gueltig.includes(d), 'bestExitDirs nennt eine ungueltige Richtung');
    }
  }
});
