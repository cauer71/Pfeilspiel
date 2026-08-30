// SPEC §10.1 — Geometrie des Bretts.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoard, cellKey, cellIndexOf, latticeOf, worldPosOf, dirWorldOf, outNormalOf,
  validDirs, depthOf, minDepthOf, bestExitDirs,
  FACES, DIR6, DIR6_NAMES, FDIR4_NAMES, CELL, OUT, MAX_CUBES
} from '../public/src/game.js';

const MODI = ['FASSADE', 'VOLUMEN'];

function cFassade(W, H, D) { return 2 * W * (H - 1) + 2 * (D - 2) * (H - 1) + W * D; }
/** Normalisiert -0 auf 0, damit strikte Vergleiche nicht an der Null scheitern. */
function n0(v) { return v === 0 ? 0 : v; }
function kreuz(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map(n0);
}

/** Alle im Test benutzten Dimensionen (SPEC §10.1.2). */
function alleDims() {
  const res = [];
  for (let W = 3; W <= 8; W++)
    for (let H = 2; H <= 8; H++)
      for (let D = 3; D <= 8; D++) res.push({ W, H, D });
  return res;
}

test('1. buildBoard wirft RangeError unterhalb der Mindestmasse', () => {
  for (const mode of MODI) {
    assert.throws(() => buildBoard({ mode, W: 2, H: 3, D: 3 }), RangeError);
    assert.throws(() => buildBoard({ mode, W: 3, H: 3, D: 2 }), RangeError);
    assert.throws(() => buildBoard({ mode, W: 3, H: 1, D: 3 }), RangeError);
    assert.throws(() => buildBoard({ mode, W: 0, H: 0, D: 0 }), RangeError);
    assert.throws(() => buildBoard({ mode, W: 3.5, H: 3, D: 3 }), RangeError);
  }
  // Der entartete Zweiwandturm ist ausdruecklich verboten (SPEC §2.0).
  assert.throws(() => buildBoard({ mode: 'FASSADE', W: 3, H: 4, D: 2 }), RangeError);
});

test('1b. buildBoard wirft RangeError oberhalb der Obergrenzen', () => {
  for (const mode of MODI) {
    assert.throws(() => buildBoard({ mode, W: 17, H: 3, D: 3 }), RangeError);
    assert.throws(() => buildBoard({ mode, W: 3, H: 25, D: 3 }), RangeError);
    assert.throws(() => buildBoard({ mode, W: 3, H: 3, D: 17 }), RangeError);
  }
  // Innerhalb der Dimensionsgrenzen, aber ueber MAX_CUBES.
  assert.ok(16 * 24 * 16 > MAX_CUBES);
  assert.throws(() => buildBoard({ mode: 'VOLUMEN', W: 16, H: 24, D: 16 }), RangeError);
  assert.throws(() => buildBoard({ mode: 'FASSADE', W: 16, H: 24, D: 16 }), RangeError);
  assert.throws(() => buildBoard({ mode: 'QUATSCH', W: 4, H: 4, D: 4 }), RangeError);
});

test('2. Zellzahl folgt der Formel, Kontrollwerte aus §2.3 stimmen', () => {
  for (const { W, H, D } of alleDims()) {
    assert.equal(buildBoard({ mode: 'VOLUMEN', W, H, D }).C, W * H * D, `VOLUMEN ${W}x${H}x${D}`);
    assert.equal(buildBoard({ mode: 'FASSADE', W, H, D }).C, cFassade(W, H, D), `FASSADE ${W}x${H}x${D}`);
  }
  const kontrolle = [
    ['3x3x3', 3, 3, 3, 25],
    ['4x4x4', 4, 4, 4, 52],
    ['5x6x5', 5, 6, 5, 105],
    ['4x5x3', 4, 5, 3, 52],
    ['7x7x4', 7, 7, 4, 136],
    ['5x7x5', 5, 7, 5, 121]
  ];
  for (const [name, W, H, D, C] of kontrolle)
    assert.equal(buildBoard({ mode: 'FASSADE', W, H, D }).C, C, `Kontrollwert FASSADE ${name}`);
});

test('2b. Gitterkoordinaten und Weltpositionen sind paarweise eindeutig und im Bereich', () => {
  for (const { W, H, D } of alleDims()) {
    for (const mode of MODI) {
      const b = buildBoard({ mode, W, H, D });
      const gitter = new Set();
      const welt = new Set();
      for (let i = 0; i < b.C; i++) {
        const [x, y, z] = latticeOf(b, i);
        assert.ok(x >= 0 && x < W && y >= 0 && y < H && z >= 0 && z < D,
          `${mode} ${W}x${H}x${D}: lattice ausserhalb bei ${i}`);
        gitter.add(x * 10000 + y * 100 + z);
        const p = worldPosOf(b, i);
        assert.deepEqual(p.map(n0), [
          (x - (W - 1) / 2) * CELL, (y - (H - 1) / 2) * CELL, (z - (D - 1) / 2) * CELL
        ].map(n0));
        welt.add(p.join(','));
      }
      assert.equal(gitter.size, b.C, `${mode} ${W}x${H}x${D}: Gitterkoordinaten doppelt`);
      assert.equal(welt.size, b.C, `${mode} ${W}x${H}x${D}: Weltpositionen doppelt`);
    }
  }
});

test('2c. FASSADE: die fuenf Wandrechtecke liegen dort, wo §2.4 sie behauptet', () => {
  for (const { W, H, D } of alleDims()) {
    const b = buildBoard({ mode: 'FASSADE', W, H, D });
    const proFlaeche = [0, 0, 0, 0, 0];
    for (let i = 0; i < b.C; i++) {
      const f = b.faceOf[i];
      const [x, y, z] = latticeOf(b, i);
      proFlaeche[f]++;
      if (f === 4) assert.equal(y, H - 1);
      else assert.ok(y <= H - 2, 'Seitenwand ragt in den Deckel');
      if (f === 0) assert.equal(z, 0);
      if (f === 2) assert.equal(z, D - 1);
      if (f === 1) { assert.equal(x, W - 1); assert.ok(z >= 1 && z <= D - 2); }
      if (f === 3) { assert.equal(x, 0); assert.ok(z >= 1 && z <= D - 2); }
    }
    assert.deepEqual(proFlaeche,
      [W * (H - 1), (D - 2) * (H - 1), W * (H - 1), (D - 2) * (H - 1), W * D]);
  }
});

test('3. U x V = Nout fuer alle fuenf FASSADE-Flaechen', () => {
  assert.equal(FACES.length, 5);
  assert.deepEqual(FACES.map(f => f.id), ['SUED', 'OST', 'NORD', 'WEST', 'DECKEL']);
  for (const f of FACES)
    assert.deepEqual(kreuz(f.U, f.V), [...f.N], `U x V = N verletzt fuer ${f.id}`);
  // Die Aussennormale steht senkrecht auf beiden Achsen und ist ein Einheitsvektor.
  for (const f of FACES) {
    assert.equal(f.U[0] * f.V[0] + f.U[1] * f.V[1] + f.U[2] * f.V[2], 0);
    assert.equal(f.N.reduce((s, v) => s + v * v, 0), 1);
  }
});

test('4. step ist unter opp symmetrisch', () => {
  for (const { W, H, D } of alleDims()) {
    for (const mode of MODI) {
      const b = buildBoard({ mode, W, H, D });
      let kanten = 0;
      for (let i = 0; i < b.C; i++) {
        for (let d = 0; d < 6; d++) {
          if (!b.valid[i * 6 + d]) continue;
          const j = b.step[i * 6 + d];
          if (j === OUT) continue;
          kanten++;
          assert.ok(b.valid[j * 6 + b.opp[d]], 'Gegenrichtung im Nachbarn ungueltig');
          assert.equal(b.step[j * 6 + b.opp[d]], i, `${mode} ${W}x${H}x${D}: Asymmetrie bei ${i}/${d}`);
        }
      }
      assert.ok(kanten > 0);
    }
  }
});

test('4b. step ist mit lattice, worldPos und dirWorld konsistent', () => {
  for (const { W, H, D } of [{ W: 5, H: 6, D: 5 }, { W: 4, H: 5, D: 3 }, { W: 7, H: 7, D: 4 }]) {
    for (const mode of MODI) {
      const b = buildBoard({ mode, W, H, D });
      for (let i = 0; i < b.C; i++) {
        for (let d = 0; d < 6; d++) {
          if (!b.valid[i * 6 + d]) continue;
          const j = b.step[i * 6 + d];
          if (j === OUT) continue;
          const pi = worldPosOf(b, i), pj = worldPosOf(b, j), dw = dirWorldOf(b, i, d);
          for (let k = 0; k < 3; k++)
            assert.equal(n0(pj[k] - pi[k]), n0(dw[k] * CELL),
              `${mode}: dirWorld passt nicht zum Schritt ${i}->${j} in Richtung ${d}`);
          if (mode === 'FASSADE') assert.equal(b.faceOf[j], b.faceOf[i], 'Flaechenwechsel');
        }
      }
    }
  }
});

test('5. depth faellt entlang d um genau 1 und ist 1-Lipschitz', () => {
  for (const { W, H, D } of alleDims()) {
    for (const mode of MODI) {
      const b = buildBoard({ mode, W, H, D });
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
  }
});

test('6. cellKey und cellIndexOf sind zueinander invers', () => {
  for (const { W, H, D } of alleDims()) {
    for (const mode of MODI) {
      const b = buildBoard({ mode, W, H, D });
      const keys = new Set();
      for (let i = 0; i < b.C; i++) {
        const k = cellKey(b, i);
        keys.add(k);
        assert.equal(cellIndexOf(b, k), i, `${mode} ${W}x${H}x${D}: Schluessel ${k}`);
        assert.match(k, mode === 'VOLUMEN' ? /^V:\d+:\d+:\d+$/ : /^F[0-4]:\d+:\d+$/);
      }
      assert.equal(keys.size, b.C);
      assert.equal(cellIndexOf(b, 'unsinn'), -1);
      assert.equal(cellIndexOf(b, ''), -1);
      assert.equal(cellIndexOf(b, 42), -1);
      // Schluessel des jeweils anderen Modus gehoeren nicht auf dieses Brett.
      assert.equal(cellIndexOf(b, mode === 'VOLUMEN' ? 'F0:0:0' : 'V:0:0:0'), -1);
      // Ausserhalb liegende Koordinaten liefern -1, nicht etwa einen Nachbarindex.
      assert.equal(cellIndexOf(b, mode === 'VOLUMEN' ? `V:${W}:0:0` : `F0:${W}:0`), -1);
      assert.equal(cellIndexOf(b, mode === 'VOLUMEN' ? `V:0:${H}:0` : `F0:0:${H - 1}`), -1);
      assert.equal(cellIndexOf(b, 'F5:0:0'), -1);
    }
  }
  assert.throws(() => cellKey(buildBoard({ mode: 'VOLUMEN', W: 3, H: 3, D: 3 }), 27), RangeError);
});

test('7. FASSADE kennt nur vier Richtungen, VOLUMEN sechs', () => {
  for (const { W, H, D } of alleDims()) {
    const f = buildBoard({ mode: 'FASSADE', W, H, D });
    assert.equal(f.dirCount, 4);
    for (let i = 0; i < f.C; i++) {
      assert.equal(f.valid[i * 6 + 4], 0);
      assert.equal(f.valid[i * 6 + 5], 0);
      assert.equal(f.step[i * 6 + 4], OUT);
      assert.equal(f.step[i * 6 + 5], OUT);
      assert.deepEqual(validDirs(f, i), [0, 1, 2, 3]);
      assert.deepEqual(outNormalOf(f, i).map(n0), [...FACES[f.faceOf[i]].N]);
    }
    const v = buildBoard({ mode: 'VOLUMEN', W, H, D });
    assert.equal(v.dirCount, 6);
    for (let i = 0; i < v.C; i++) {
      assert.deepEqual(validDirs(v, i), [0, 1, 2, 3, 4, 5]);
      assert.equal(v.faceOf[i], 255);
      assert.deepEqual(outNormalOf(v, i).map(n0), [0, 0, 0]);
      for (let d = 0; d < 6; d++) assert.deepEqual(dirWorldOf(v, i, d).map(n0), [...DIR6[d]]);
    }
    assert.deepEqual([...v.opp], [1, 0, 3, 2, 5, 4]);
    assert.deepEqual([...f.opp].slice(0, 4), [2, 3, 0, 1]);
  }
  assert.deepEqual([...DIR6_NAMES], ['PX', 'NX', 'PY', 'NY', 'PZ', 'NZ']);
  assert.deepEqual([...FDIR4_NAMES], ['RECHTS', 'HOCH', 'LINKS', 'RUNTER']);
});

test('7b. Ungueltige Richtungen sind in JEDER Tabelle als unbrauchbar markiert', () => {
  // `board.valid` ist die Autoritaet, an der createState eine verfaelschte Richtung erkennt
  // (SPEC §2.3). Deshalb muessen step, dirWorld und depthOf dieselbe Aussage tragen: eine in
  // dieser Zelle ungueltige Richtung darf weder einen Nachbarn noch einen Weltvektor noch
  // eine erreichbare Austrittstiefe liefern.
  for (const { W, H, D } of alleDims()) {
    const f = buildBoard({ mode: 'FASSADE', W, H, D });
    for (let i = 0; i < f.C; i++) {
      for (let d = 0; d < 4; d++) assert.equal(f.valid[i * 6 + d], 1, 'Wandrichtung fehlt');
      for (const d of [4, 5]) {
        assert.equal(f.valid[i * 6 + d], 0);
        assert.equal(f.step[i * 6 + d], OUT);
        assert.deepEqual(dirWorldOf(f, i, d).map(n0), [0, 0, 0], 'ungueltige Richtung hat Weltvektor');
        assert.ok(depthOf(f, i, d) > f.C, 'ungueltige Richtung kann minDepth werden');
      }
      const best = bestExitDirs(f, i);
      const gueltig = validDirs(f, i);
      for (const d of best) assert.ok(gueltig.includes(d), 'bestExitDirs nennt eine ungueltige Richtung');
      assert.ok(minDepthOf(f, i) <= f.C, 'minDepth stammt aus einer ungueltigen Richtung');
    }
    const v = buildBoard({ mode: 'VOLUMEN', W, H, D });
    for (let i = 0; i < v.C; i++)
      for (let d = 0; d < 6; d++)
        assert.equal(v.valid[i * 6 + d], 1, 'VOLUMEN muss alle sechs Richtungen erlauben');
  }
});
