# Pfeilspiel — Verbindliche technische Spezifikation

**Status:** normativ. Version der Spezifikation: `SPEC v2`, Regelversion `RULE_VERSION = 2`,
Generatorversion `GEN_VERSION = 2`.

**Aenderungen gegenueber v1** (beide auf ausdrueckliche Anforderung, beide veraendern den
Regelkern und damit die Versionsnummern):

1. **Rutschen.** Ist die Bahn in Pfeilrichtung bis zum Rand vollstaendig frei, verlaesst der
   Stein den Turm sofort ganz, statt nur ein Feld vorzuruecken. Der Einzelschritt bleibt fuer
   den Fall, dass die Bahn weiter vorn verstellt ist.
2. **Zweizellige Steine.** Neben 1x1-Wuerfeln gibt es 2x1-Steine, die zwei benachbarte Zellen
   belegen und sich als starre Einheit bewegen. Die Vorlage zeigt sie ebenfalls.

**Basisentwurf:** Entwurf **C** (flacher Zellindex + vorberechnete Schritttabelle) hat alle drei
Urteile gewonnen und ist die Grundlage. Verbindlich eingearbeitet sind die von den Judges
ausdruecklich angeordneten Uebernahmen aus **B** (Vorwaertsverifikation im Produktivpfad,
minDepth-Fuellsatz als beweisbarer Rueckfall, `genVersion`, `jumped`-Zellen, Zugvorschau,
Determinismusregeln, Fuzz-Harness, sechs Regressionsfixtures) und aus **A** (CPU-seitige
Pfeildarstellung statt Shaderinjektion, CSS-CRT statt Postprocessing, Innenkern-Box,
Roentgenmodus, Sackgassen-Overlay, URL-Hash, `par` als Richtwert, harte Dimensionsassertion,
bezifferte Deployment-Artefakte).

Schluesselwoerter MUSS / DARF NICHT / SOLL sind normativ zu lesen. Wo diese Datei und ein
Entwurfstext sich widersprechen, gilt diese Datei.

---

## 0. Unverhandelbare Architekturregeln

Diese sechs Regeln sind Abnahmekriterien. Ein Pull Request, der eine davon verletzt, wird
abgelehnt, auch wenn alle Tests gruen sind.

1. **Eine einzige Regelimplementierung.** `resolveMove()` existiert genau einmal, in
   `src/game.js`. Spiel, Generator, Verifikation, Tests und der Cloudflare-Worker importieren
   dieselbe Funktion. Eine Kopie, ein Sonderpfad oder eine „optimierte“ Zweitfassung bricht die
   Loesbarkeitsgarantie stillschweigend.
2. **Reiner Kern.** `src/game.js` und `src/levels.js` DUERFEN NICHT `three`, `document`, `window`,
   `performance`, `Date`, `Math.random` oder irgendeine DOM-/WebGL-API referenzieren. Sie laufen
   unveraendert in `node --test` und im Worker.
3. **Grenze vor Belegung.** Jede Nachbarschaftsabfrage prueft zuerst „ausserhalb“ und erst dann
   „belegt“. Die Schritttabelle macht die Gegenreihenfolge unrepraesentierbar: ausserhalb der
   Flaeche existiert kein Index, den man nach Belegung fragen koennte.
4. **Determinismus.** Ausschliesslich `mulberry32(seed)`. Verboten im Generator- und Regelpfad:
   `Math.random`, `Date.now`, `performance.now`, Iteration ueber `Map`/`Set`-Reihenfolge als
   Logikquelle, `Array.prototype.sort` ohne totalen Vergleicher, Objekt-Schluesselreihenfolge.
5. **Verifikation im Produktivpfad.** `verifyLevel()` laeuft bei JEDER Levelerzeugung im Client,
   nicht nur im Test, und arbeitet ausschliesslich auf der **serialisierten** Levelbeschreibung.
6. **Geteilte Materialien sind unveraenderlich.** Hover, Selektion und Ausblenden laufen ueber
   Materialtausch bzw. Materialvarianten, niemals ueber Mutation eines geteilten Materials.

---

## 1. Ueberblick und Spielregeln

### 1.1 Spielidee

Ein Turm aus weissen Wuerfeln, jeder Wuerfel traegt einen schwarzen Pfeil mit einer festen,
unveraenderlichen Richtung. Ein Tipp auf einen Wuerfel bewegt genau diesen Wuerfel in seine
Pfeilrichtung. Der Turm ist frei drehbar (Orbit) und zoombar. Es gibt **keine Schwerkraft**:
verbleibende Wuerfel schweben an Ort und Stelle.

### 1.2 Zugregel (Halma-Variante mit Rutschen) — normativ

Ein **Stein** belegt eine Zelle (1x1) oder zwei benachbarte Zellen (2x1) und traegt genau eine
feste Richtung `d`. Sei `Z` die Menge seiner Zellen. `Z+k` bezeichnet die Menge, die entsteht,
wenn jede Zelle aus `Z` genau `k` Schritte in Richtung `d` geht; eine Zelle, die dabei das
Gitter verlaesst, bleibt als `OUT` in der Menge stehen und faellt nicht heraus.

Eine Zielmenge heisst **frei**, wenn jede ihrer Zellen im Gitter unbesetzt ist **oder dem
ziehenden Stein selbst gehoert**. Der Zusatz ist nicht kosmetisch: ohne ihn koennte sich ein
2x1-Stein niemals entlang seiner eigenen Laengsachse bewegen, weil er sich selbst blockierte.

| # | Regel |
|---|---|
| R0 | **RUTSCH.** Ist `Z+1` frei und bleibt die Bahn `Z+2, Z+3, …` frei, bis der Stein das Gitter verlaesst, so verlaesst er den Turm in genau diesem Zug ganz. Ergebnis `EXIT` mit `jumps = 0`. |
| R1 | **SCHRITT.** Ist `Z+1` frei, die Bahn danach aber verstellt, rueckt der Stein genau ein Feld vor. Ein Schritt kettet nie. |
| R2 | **SPRUNG.** Ist `Z+1` nicht frei und `Z+2` frei, springt der Stein ueber die Blocker hinweg auf `Z+2`. |
| R3 | **KETTE.** Nach einem Sprung wird fortgesetzt, solange von der aktuellen Lage aus wieder gesprungen werden kann. Die Kette ist zwingend. |
| R4 | **UNGUELTIG.** Weder R0/R1 noch R2 anwendbar → kein Zug, kein Zaehler, kein Undo-Eintrag, nur Wackelanimation plus rotes Aufblitzen des Blockierers. |
| R5 | **AUSTRITT.** Verlaesst der Stein das Gitter, fliegt er weg und ist aus dem Spiel. Ein Stein bleibt nie halb ausserhalb stehen. |

R0 hat Vorrang vor R1: bei freier Bahn wird nicht geschritten, sondern ausgetreten. Das ist die
Regel der Vorlage und der Grund, warum sich ein Turm ueberhaupt zuegig abbauen laesst.

### 1.3 Randfaelle — abschliessend und normativ

| Fall | Bedingung | Ergebnis |
|---|---|---|
| RF-1 | `Z+1` enthaelt `OUT`, die uebrigen Zellen sind frei | `EXIT`. Grenze vor Belegung: die Belegung ausserhalb wird nie geprueft, es gibt sie nicht. |
| RF-2 | `Z+1` frei, Bahn danach verstellt | `STEP` um genau ein Feld. Keine Verkettung. |
| RF-2b | `Z+1` frei, Bahn bis zum Rand frei | `EXIT` (R0), `jumps = 0`, `path` nennt die durchlaufenen Ankerzellen. |
| RF-3 | `Z+1` besetzt, `Z+2` enthaelt `OUT` und der Rest ist frei | `EXIT`. Der Stein springt ueber den letzten Blocker ins Freie. |
| RF-4 | `Z+1` besetzt, `Z+2` ebenfalls besetzt | `INVALID` (`reason:'BLOCKED'`). |
| RF-4b | `Z+1` enthaelt `OUT`, eine verbleibende Zelle ist besetzt | Sprungpruefung nach R2; schlaegt sie fehl, `INVALID`. |
| RF-5 | Kette: `Z+1` enthaelt `OUT` | Kette endet, Stein bleibt stehen. Ergebnis `JUMP`. |
| RF-6 | Kette: `Z+1` frei | Kette endet. **Es gibt keinen Schritt und kein Rutschen hinter einem Sprung.** Ergebnis `JUMP`. |
| RF-7 | Kette: `Z+1` besetzt, `Z+2` enthaelt `OUT` | `EXIT` mitten aus der Kette heraus. |
| RF-8 | Kette: `Z+1` besetzt, `Z+2` ebenfalls besetzt | Kette endet. Ergebnis `JUMP`. |
| RF-9 | Stein bereits ausgeschieden (`alive == 0`) oder Zellindex entartet | `INVALID` (`reason:'DEAD'`). Tritt nur bei Programmfehlern auf. |
| RF-10 | FASSADE: „ausserhalb“ heisst **ausserhalb des eigenen Wandrechtecks**. Ein Stein einer Nachbarwand existiert fuer die Regel nicht — er blockiert nicht und wird nicht uebersprungen. | Kein Ueberklettern auf die Nachbarwand. |
| RF-11 | Terminierung | `d` ist konstant, die Lage waechst je Iteration um `d` (Rutschen) bzw. `2d` (Kette) auf einem endlichen Strahl. Ein Zaehlerlimit gehoert in die Tests, nicht in den Produktivpfad. |
| RF-12 | Ein Zug veraendert **genau einen** Stein und laesst seine Form unveraendert. Uebersprungene Steine bleiben unberuehrt. | Undo ist deshalb exakt invers und O(1). |
| RF-13 | Ein 2x1-Stein bleibt bei jedem Zug starr: der Ausleger (`extOf`) aendert sich nie. Innerhalb einer Wand bzw. des Quaders ist das Gitter regelmaessig, die beiden Zellen bleiben also auch nach der Verschiebung benachbart. | Testgegenstand, §10.2. |

### 1.4 Modi

**Richtungsmodus** (im Spiel umschaltbar, beide voll funktionsfaehig):

* `FASSADE` — hohle Schale: 4 Seitenwaende plus vollflaechiger Deckel, kein Boden. Jede Wand ist
  ein 2D-Gitter; der Pfeil zeigt in der Ebene seiner Wand (4 Richtungen). Am Wandrand faellt der
  Wuerfel heraus.
* `VOLUMEN` — massiver Quader; jeder Wuerfel hat eine von 6 echten Raumrichtungen. Pfeile zeigen
  auch ins Turminnere.

**Zielmodus** (pro Level konfiguriert):

* `ABBAU` — alle Wuerfel muessen heraus. `isSolved` ⇔ `aliveCount === 0`.
* `BEFREIUNG` — nur der gruene Zielwuerfel muss heraus. `isSolved` ⇔ `alive[targetId] === 0`.
  Der Restturm bleibt stehen.

### 1.5 Laufzeitverhalten

* **Sackgasse:** Nach jedem Zug wird `hasAnyMove(board, state)` geprueft. Ist das Ergebnis `false`
  und `isSolved()` ebenfalls `false`, erscheint ein Overlay „Kein Zug mehr moeglich“ mit
  **Rueckgaengig** und **Neustart**. Es wird **niemals** automatisch zurueckgesetzt.
  Die Loesbarkeitsgarantie gilt nur ab Startzustand; der Spieler kann sich festfahren.
* **Undo:** unbegrenzt tief. Ein Undo dreht Zugzaehler, Zellbelegung, `alive` und die Spieluhr
  zurueck. Undos werden separat gezaehlt (`undos`) und an die Bestenliste gemeldet.
* **`par`:** Laenge der Referenzloesung, also eine **obere Schranke**, kein Optimum. Im HUD MUSS
  es als „Richtwert“ beschriftet werden. Der Server DARF NICHT `moves >= par` verlangen.
* **Zugvorschau:** Desktop-Hover bzw. Longpress ≥ 600 ms zeigt `move.path` als Geisterspur und
  `move.jumped` als aufleuchtende Traeger, bevor der Zug festgeschrieben wird.

---

## 2. Koordinatensystem

### 2.0 Gemeinsame Konstanten

```js
export const CELL      = 1.0;    // Rasterabstand
export const CUBE_EDGE = 0.92;   // Kantenlaenge des Wuerfels -> 0.08 sichtbare Fuge
export const OUT   = -1;         // "ausserhalb" in board.step
export const EMPTY = -1;         // "unbesetzt" in state.occ
export const MAX_CUBES = 1200;   // harte Obergrenze, im Generator durchgesetzt
```

Gitterparameter `W` (x, Breite), `H` (y, Hoehe, +Y = oben), `D` (z, Tiefe). Rechtshaendiges
Koordinatensystem.

**Harte Assertion in `buildBoard()` (aus A uebernommen):**

```js
if (!(W >= 3 && D >= 3 && H >= 2)) throw new RangeError('Dimensionen: W>=3, D>=3, H>=2');
if (!(W <= 16 && H <= 24 && D <= 16)) throw new RangeError('Dimensionen zu gross');
```

`D === 2` oder `W === 2` erzeugte einen entarteten Turm aus zwei physisch aneinanderliegenden
Waenden ohne Seitenflaechen und ist deshalb verboten.

### 2.1 Zellindex und Weltposition

Zellen werden ausschliesslich ueber **flache Ganzzahlindizes** `0..C-1` gefuehrt. Stringschluessel
existieren nur fuer Serialisierung, Debug und Tests.

Weltposition aus Gitterkoordinaten `(x,y,z)` (in beiden Modi identisch):

```js
worldOf(x, y, z) = [ (x - (W-1)/2) * CELL,
                     (y - (H-1)/2) * CELL,
                     (z - (D-1)/2) * CELL ]
```

Der Turm ist damit um den Ursprung zentriert; `controls.target` liegt bei
`(0, H*CELL*0.04, 0)`.

### 2.2 Modus VOLUMEN

Zellen: `x in [0,W)`, `y in [0,H)`, `z in [0,D)`. `C = W*H*D`.

```js
idx(x,y,z) = (x*H + y)*D + z
x = floor(i / (H*D));  y = floor(i / D) % H;  z = i % D
```

Richtungen `d = 0..5`, alle gueltig:

| d | Name | Vektor | opp[d] |
|---|---|---|---|
| 0 | `PX` | `( 1, 0, 0)` | 1 |
| 1 | `NX` | `(-1, 0, 0)` | 0 |
| 2 | `PY` | `( 0, 1, 0)` | 3 |
| 3 | `NY` | `( 0,-1, 0)` | 2 |
| 4 | `PZ` | `( 0, 0, 1)` | 5 |
| 5 | `NZ` | `( 0, 0,-1)` | 4 |

```js
step[i*6+d] = (x+dx in [0,W) && y+dy in [0,H) && z+dz in [0,D)) ? idx(x+dx,y+dy,z+dz) : OUT
valid[i*6+d] = 1 fuer alle d
dirWorld[i][d] = DIR6[d]            // zellunabhaengig
faceOf[i] = 255                     // keine Wandflaeche
outNormal[i] = (0,0,0)              // kein Aussennormalen-Konzept
```

**Austrittstiefe** (fuer den Fuellrueckfall, §6.5):

```
depth(i, 0)= W-1-x   depth(i,1)= x
depth(i, 2)= H-1-y   depth(i,3)= y
depth(i, 4)= D-1-z   depth(i,5)= z
minDepth(i) = min ueber alle 6 d
```

### 2.3 Modus FASSADE

Hohle Schale: 4 Seitenwaende (`v in [0,H-2]`, also `H-1` Reihen) plus **vollflaechiger Deckel**
(`y = H-1`, `W*D` Zellen). Kein Boden. Ost/West sind um je eine Spalte eingerueckt, damit die vier
Eckspalten genau einmal belegt sind.

Fuenf Flaechen `f = 0..4`, jede mit lokalen Koordinaten `(u,v)`, `u` = optisch rechts,
`v` = optisch oben, von aussen betrachtet. Konvention **`U × V = Nout`** (rechtshaendig) gilt fuer
alle fuenf Flaechen und ist Testgegenstand.

| f | Name | uMax | vMax | Abbildung `(u,v) → (x,y,z)` | `U` | `V` | `Nout` |
|---|---|---|---|---|---|---|---|
| 0 | `SUED` (vorn) | `W` | `H-1` | `(W-1-u, v, 0)` | `(-1,0,0)` | `(0,1,0)` | `(0,0,-1)` |
| 1 | `OST` (rechts) | `D-2` | `H-1` | `(W-1, v, D-2-u)` | `(0,0,-1)` | `(0,1,0)` | `(1,0,0)` |
| 2 | `NORD` (hinten) | `W` | `H-1` | `(u, v, D-1)` | `(1,0,0)` | `(0,1,0)` | `(0,0,1)` |
| 3 | `WEST` (links) | `D-2` | `H-1` | `(0, v, 1+u)` | `(0,0,1)` | `(0,1,0)` | `(-1,0,0)` |
| 4 | `DECKEL` | `W` | `D` | `(u, H-1, D-1-v)` | `(1,0,0)` | `(0,0,-1)` | `(0,1,0)` |

`u in [0, uMax-1]`, `v in [0, vMax-1]`.

```js
off[0] = 0
off[f+1] = off[f] + uMax[f] * vMax[f]
idx(f,u,v) = off[f] + v*uMax[f] + u
C = off[5] = 2*W*(H-1) + 2*(D-2)*(H-1) + W*D
```

Kontrollwerte (Pflichttest, alle nachgerechnet):

| W×H×D | C |
|---|---|
| 3×3×3 | 25 |
| 4×4×4 | 52 |
| 5×6×5 | 105 |
| 4×5×3 | 52 |
| 7×7×4 | 136 |
| 5×7×5 | 5·6·2 + 3·6·2 + 25 = 121 |

Richtungen `d = 0..3` flaechenlokal; `d = 4,5` sind ungueltig (`valid[i*6+d] = 0`):

| d | Name | `(du,dv)` | opp[d] |
|---|---|---|---|
| 0 | `RECHTS` | `(+1, 0)` | 2 |
| 1 | `HOCH` | `( 0,+1)` | 3 |
| 2 | `LINKS` | `(-1, 0)` | 0 |
| 3 | `RUNTER` | `( 0,-1)` | 1 |

```js
step[idx(f,u,v)*6+d] =
    (u+du in [0,uMax[f]) && v+dv in [0,vMax[f])) ? idx(f, u+du, v+dv) : OUT
```

Ein Flaechenwechsel findet **nie** statt. Der Rechteck-Test der Wand erledigt „am Wandrand faellt
der Wuerfel heraus“ von selbst (RF-10).

```js
dirWorld[i][d] = du * U[faceOf[i]] + dv * V[faceOf[i]]     // vorberechnet, Float32Array
outNormal[i]   = Nout[faceOf[i]]                            // Aussennormale der Wand
```

**Austrittstiefe** in FASSADE:

```
depth(i,0)= uMax-1-u   depth(i,2)= u
depth(i,1)= vMax-1-v   depth(i,3)= v
minDepth(i) = min ueber d in {0,1,2,3}
```

### 2.4 Nachweisbare Eigenschaften (Testgegenstand, §10)

1. Die fuenf Flaechenrechtecke sind **disjunkt**: `SUED` hat `z=0`, `NORD` hat `z=D-1`;
   `OST`/`WEST` haben `z in [1,D-2]` und `x = W-1` bzw. `x = 0` (verschieden, da `W>=3`);
   `DECKEL` hat `y = H-1`, die Seitenwaende nur `y <= H-2`.
2. Alle Weltpositionen sind **paarweise eindeutig**.
3. `U × V = Nout` fuer alle fuenf Flaechen.
4. `step` ist unter `opp` symmetrisch: `step[step[i*6+d]*6+opp[d]] === i`, wo `step[i*6+d] != OUT`.
5. `depth` ist 1-Lipschitz auf dem Zellgraphen und faellt entlang der Richtung `d*` mit
   `depth(i,d*) === minDepth(i)` um genau 1 pro Schritt (Grundlage des Fuellsatzes §6.5).

---

## 3. Datenmodell

Alle Strukturen sind reine JS-Objekte bzw. TypedArrays. `Level` und `Score` sind
JSON-serialisierbar; `Board` und `State` sind es nicht (TypedArrays) und werden nie uebertragen.

### 3.1 Board (unveraenderlich, pro Groesse einmal gebaut, zwischen Leveln teilbar)

```js
/**
 * @typedef {Object} Board
 * @property {'FASSADE'|'VOLUMEN'} mode
 * @property {number} W @property {number} H @property {number} D
 * @property {number} C                 Zellzahl
 * @property {Int32Array}  step         [C*6]  Nachbarindex oder OUT(-1)
 * @property {Uint8Array}  valid        [C*6]  1 = Richtung in dieser Zelle erlaubt
 * @property {Int8Array}   opp          [6]    Gegenrichtung
 * @property {Uint8Array}  dirCount      Anzahl gueltiger Richtungen: 4 (FASSADE) | 6 (VOLUMEN)
 * @property {Float32Array} worldPos    [C*3]  Weltmittelpunkt jeder Zelle
 * @property {Float32Array} dirWorld    [C*6*3] Weltvektor je (Zelle,Richtung)
 * @property {Uint8Array}  faceOf       [C]    FASSADE 0..4, VOLUMEN 255
 * @property {Float32Array} outNormal   [C*3]  Aussennormale der Wand; VOLUMEN (0,0,0)
 * @property {Int32Array}  lattice      [C*3]  (x,y,z) je Zelle, fuer Darstellung/Serialisierung
 * @property {Int32Array}  depthOf      [C*6]  Austrittstiefe je (Zelle,Richtung)
 * @property {Int32Array}  minDepthOf   [C]    min ueber alle gueltigen Richtungen
 */
```

### 3.2 State (mutabel, TypedArrays, per `.slice()` billig kopierbar)

```js
/**
 * @typedef {Object} State
 * @property {Int32Array} occ        [C]     Stein-Id oder EMPTY(-1). Ein 2x1-Stein steht
 *                                            in BEIDEN Zellen mit derselben Id.
 * @property {Int32Array} cellOf     [nMax]  Stein-Id -> ANKERZELLE, -1 wenn ausgeschieden
 * @property {Uint8Array} dirOf      [nMax]  Richtung, ueber die ganze Partie unveraenderlich
 * @property {Uint8Array} extOf      [nMax]  Richtung zur zweiten Zelle, EXT_NONE(255) bei 1x1.
 *                                            Aendert sich nie (RF-13).
 * @property {Uint8Array} alive      [nMax]
 * @property {number} cubeCount              Anzahl je erzeugter Steine (= nMax genutzt)
 * @property {number} aliveCount             Anzahl lebender STEINE, nicht belegter Zellen
 * @property {number} targetId               BEFREIUNG: Id des gruenen Steins, sonst -1
 * @property {'ABBAU'|'BEFREIUNG'} goal
 * @property {Int32Array} step               Verweis auf board.step. Er erlaubt es, die zweite
 *                                            Zelle eines Steins ohne Board-Parameter zu
 *                                            bestimmen; das Board ist unveraenderlich, der
 *                                            Verweis wandert unveraendert durch cloneState.
 */

**Anker.** Die Ankerzelle eines 2x1-Steins ist normativ die **kleinere** der beiden
Zellindizes. Damit ist die serialisierte Form eindeutig, die Wuerfelliste bleibt streng
aufsteigend sortierbar, und der Zeugenzug nennt stets den Anker.
```

### 3.3 Move — Ergebnis von `resolveMove`, zugleich Undo-Nutzlast und Replay-Element

```js
/**
 * @typedef {Object} Move
 * @property {'STEP'|'JUMP'|'EXIT'|'INVALID'} kind
 * @property {'BLOCKED'|'DEAD'|undefined} reason   nur bei INVALID
 * @property {number} cubeId
 * @property {number} from            Zellindex des Starts
 * @property {number} to              Zellindex des Ziels, oder OUT(-1) bei EXIT/INVALID
 * @property {number} jumps           0 = Schritt, >=1 = Zahl der Sprungglieder
 * @property {number[]} path          [from, ...Landepunkte]; bei EXIT endet er auf dem
 *                                    letzten Landepunkt IM Gitter (der Flug nach aussen
 *                                    wird aus dirWorld[from|last] gerendert)
 * @property {number[]} jumped        uebersprungene, besetzte Zellen (Animation, Sound, Vorschau)
 */
```

`INVALID` liefert `{kind:'INVALID', reason, cubeId, from, to:OUT, jumps:0, path:[from], jumped:[]}`.
Bei `reason:'BLOCKED'` enthaelt `jumped` genau die blockierende Zelle `n1` — sie wird rot
aufblitzen gelassen.

### 3.4 Undo

```js
/**
 * @typedef {Object} UndoEntry
 * @property {Move} move
 * @property {number} moveNo        Zugnummer VOR dem Zug
 * @property {number} clockMs       Spieluhr (Millisekunden) VOR dem Zug
 */
```

`undo()`: `revertMove(state, entry.move)`, `moves = entry.moveNo`, `clockMs = entry.clockMs`,
`undos += 1`.

### 3.5 Level — die serialisierte Levelbeschreibung (JSON, Grundlage von `verifyLevel`)

```js
/**
 * @typedef {Object} Level
 * @property {1} v
 * @property {number} ruleVersion          RULE_VERSION
 * @property {number} genVersion           GEN_VERSION
 * @property {number} seed                 uint32
 * @property {number} attempt              akzeptierter Versuchsindex 0..11 (siehe §6.7)
 * @property {'FASSADE'|'VOLUMEN'} mode
 * @property {'ABBAU'|'BEFREIUNG'} goal
 * @property {{W:number,H:number,D:number}} dims
 * @property {string} levelCode            z.B. "F-A-4x5x4-1-0008FA3C"
 * @property {Array<{cell:number, dir:number, target:boolean}>} cubes
 *           Startaufstellung; Index im Array === cubeId. Aufsteigend nach cell sortiert.
 * @property {number|null} targetId
 * @property {number[]} witness            Zellindizes in Klickreihenfolge (Referenzloesung)
 * @property {number} par                  === witness.length
 * @property {number[]} stars              [par, ceil(par*1.12), ceil(par*1.25)]
 * @property {{density:number, chainShare:number, maxChain:number,
 *             mobility:number, naivePerPar:number, trivialExit:number}} metrics
 */
```

`witness` enthaelt **Zellindizes**, nicht Wuerfel-Ids: das ist genau das, was ein Spieler antippt,
und macht Referenzloesung und Replay formatgleich.

### 3.6 LevelSpec — Eingabe des Generators

```js
/**
 * @typedef {Object} LevelSpec
 * @property {number} seed @property {number} attempt
 * @property {'FASSADE'|'VOLUMEN'} mode @property {'ABBAU'|'BEFREIUNG'} goal
 * @property {number} W @property {number} H @property {number} D
 * @property {number} density        Zieldichte 0..1
 * @property {number} maxChain       maximal erlaubte Sprungglieder je Referenzzug (1..4)
 * @property {number} dominoRate     Anteil der Runden, in denen ein 2x1-Stein statt eines
 *                                   1x1-Wuerfels gesetzt wird (0..1). Folgt wie density aus
 *                                   (Modus, Ziel, Masse), damit ein Level allein aus seinem
 *                                   Levelcode bitgleich nachbaubar bleibt.
 * @property {number} relocateRate   Standard 0
 * @property {{wFill:number,wChain:number,wFrag:number,wDiv:number,wSil:number,wRand:number}} weights
 * @property {{naivePerPar:[number,number], chainShare:[number,number],
 *             mobility:[number,number], trivialExit:[number,number]}} bands
 * @property {number} targetQuantile  nur BEFREIUNG, 0..1
 */
```

### 3.7 RunLog / Score

```js
/** @typedef {Object} RunLog
 *  @property {string} runId          UUID v4, im Client erzeugt, Idempotenzschluessel
 *  @property {string} clientId       UUID v4 aus localStorage
 *  @property {string} levelCode
 *  @property {number} seed @property {number} genVersion @property {number} ruleVersion
 *  @property {'fassade'|'volumen'} dirMode @property {'abbau'|'befreiung'} goalMode
 *  @property {{x:number,y:number,z:number}} size
 *  @property {number} cubes @property {number} moves @property {number} undos
 *  @property {number} timeMs
 *  @property {number[]} taps         angetippte Zellindizes in Reihenfolge (auch ungueltige)
 *  @property {string} name @property {string} appVersion
 */
```

---

## 4. Modulplan

Verbindliche Dateiliste. Es gibt **keinen Build-Schritt**, reines ES-Modul-JavaScript.
Andere Dateien als die hier genannten (plus `src/styles/*.css`, `public/vendor/three/**`,
`worker/*.js`-Hilfsmodule, `migrations/*.sql`, `tests/*`) duerfen nur nach Absprache entstehen.

```
/public/index.html                  Importmap, Canvas, HUD-Geruest, CRT-Overlay
/public/src/game.js                 Board + Regel + Zustand   (rein, kein DOM, kein three)
/public/src/levels.js               Generator + Verifikation + Kurve + Replay (rein)
/public/src/render.js               Three.js-Schicht, Atlas, Animationen, Picking, Orbit
/public/src/skins.js                Skin-Tokens + Anwendung (DOM + Three)
/public/src/ui.js                   HUD, Overlays, deutsche Texte
/public/src/api.js                  Bestenlisten-Client
/public/src/main.js                 Bootstrap und Verdrahtung
/public/src/styles/tokens.css       :root-Defaults (= Modern)
/public/src/styles/base.css         gesamte UI, ausschliesslich var(--ps-*), KEINE Hexwerte
/public/src/styles/fx.css           CRT-Overlay, Shake-Keyframes, prefers-reduced-motion
/public/vendor/three/0.185.1/**     selbst gehostetes three (liegt bereits im Repo)
/public/_headers                    Cache-Regeln
/worker/index.js                    Worker-Entry: /api/* + Static Assets
/worker/{http,validate,names,ratelimit,api-records}.js   Hilfsmodule des Workers
/migrations/0001_init.sql           D1-Schema
/wrangler.jsonc                     Deployment
/tools/serve.js                     lokaler Entwicklungsserver (liegt bereits im Repo)
/tests/*.test.js, /tests/e2e.mjs
```

> **Pfadklarstellung (normativ, loest den Widerspruch zwischen dieser Liste und Paragraph 9.1):**
> `public/` ist die Wurzel der ausgelieferten Website und zugleich das Asset-Verzeichnis des
> Workers. Wo diese Spezifikation sonst `src/game.js` schreibt, ist stets `public/src/game.js`
> gemeint; wo sie `/vendor/...` oder `/src/...` als **URL** schreibt, bleibt es genau diese URL,
> denn `public/` ist die Wurzel. Importe zwischen den Spielmodulen sind relativ
> (`import { resolveMove } from './game.js'`). Tests importieren
> `../public/src/game.js`, der Worker importiert `../public/src/game.js` bzw.
> `../public/src/levels.js`.

### 4.1 `src/game.js` — reiner Regelkern

```js
// --- Konstanten ---------------------------------------------------------
export const OUT: -1;
export const EMPTY: -1;
export const CELL: 1.0;
export const CUBE_EDGE: 0.92;
export const MAX_CUBES: 1200;
export const RULE_VERSION: 2;
export const EXT_NONE: 255;          // extOf-Wert eines einzelligen Steins
export const MAX_STEIN_ZELLEN: 2;    // groesste Zellzahl eines Steins
export const DIR6: ReadonlyArray<[number,number,number]>;          // PX,NX,PY,NY,PZ,NZ
export const DIR6_NAMES: ['PX','NX','PY','NY','PZ','NZ'];
export const FDIR4_NAMES: ['RECHTS','HOCH','LINKS','RUNTER'];
export const FACES: ReadonlyArray<{id:string, U:number[], V:number[], N:number[]}>; // 5 Eintraege

// --- Board -------------------------------------------------------------
export function buildBoard(spec: {mode:'FASSADE'|'VOLUMEN', W:number, H:number, D:number}): Board;
//   wirft RangeError bei W<3 || D<3 || H<2 oder C*? > MAX_CUBES-Grenzen (§2.0)
export function cellKey(board: Board, i: number): string;
//   FASSADE: `F${f}:${u}:${v}`   VOLUMEN: `V:${x}:${y}:${z}`
export function cellIndexOf(board: Board, key: string): number;   // -1 wenn unbekannt
export function latticeOf(board: Board, i: number): [number,number,number];
export function worldPosOf(board: Board, i: number, out?: Float32Array|number[]): number[];
export function dirWorldOf(board: Board, i: number, d: number, out?: number[]): number[];
export function outNormalOf(board: Board, i: number, out?: number[]): number[];
export function validDirs(board: Board, i: number): number[];      // [0..3] oder [0..5]
export function depthOf(board: Board, i: number, d: number): number;
export function minDepthOf(board: Board, i: number): number;
export function bestExitDirs(board: Board, i: number): number[];
//   alle d mit depthOf(i,d) === minDepthOf(i), aufsteigend

// --- Zustand -----------------------------------------------------------
export function createState(board: Board, cubes: ReadonlyArray<{cell:number, dir:number,
                            target?:boolean}>, goal: 'ABBAU'|'BEFREIUNG'): State;
export function emptyState(board: Board, capacity: number,
                           goal: 'ABBAU'|'BEFREIUNG'): State;
export function cloneState(state: State): State;                   // TypedArray .slice()
export function addCube(state: State, cell: number, dir: number,
                        isTarget?: boolean, ext?: number): number; // liefert cubeId
//   ext = EXT_NONE (Vorgabe) erzeugt einen 1x1-Wuerfel. Sonst MUSS die zweite Zelle im
//   Gitter liegen und frei sein; andernfalls RangeError.
export function dropCube(state: State, cubeId: number): void;      // raeumt BEIDE Zellen
export function cellsOfCube(state: State, cubeId: number): number[];  // 1 oder 2 Zellen
export function sizeOfCube(state: State, cubeId: number): number;     // 1 oder 2
export function isFree(state: State, cell: number): boolean;       // cell muss != OUT sein

// --- Regel (die EINZIGE Implementierung) --------------------------------
export function resolveMove(board: Board, state: State, cell: number): Move;
export function applyMove(state: State, move: Move): void;
export function revertMove(state: State, move: Move): void;
export function legalCells(board: Board, state: State): number[];  // aufsteigend, deterministisch
export function mobility(board: Board, state: State): number;      // legalCells().length / aliveCount
export function hasAnyMove(board: Board, state: State): boolean;
export function isSolved(state: State): boolean;

// --- Sitzung (Zugzaehler, Undo, Uhr) ------------------------------------
export function createSession(board: Board, level: Level): Session;
/** @typedef {Object} Session
 *  @property {Board} board @property {Level} level @property {State} state
 *  @property {UndoEntry[]} history
 *  @property {number} moves @property {number} undos
 *  @property {number} clockMs   aufsummierte Spielzeit; die Uhr laeuft ab dem ersten
 *                               gueltigen Zug und wird vom Aufrufer per tickClock gefuettert
 *  @property {number[]} taps    alle angetippten Zellindizes, auch ungueltige
 *  @property {boolean} won */
export function tap(session: Session, cell: number): Move;
//   schreibt bei kind !== 'INVALID' den Zustand SYNCHRON fort, erhoeht moves,
//   legt UndoEntry an, setzt session.won = isSolved(state).
//   Bei INVALID: nur session.taps wird ergaenzt.
export function undo(session: Session): boolean;
export function restart(session: Session): void;                   // Zustand aus level.cubes neu
export function tickClock(session: Session, dtMs: number): void;
export function toRunLog(session: Session, meta: {name, runId, clientId, appVersion}): RunLog;
```

### 4.2 `src/levels.js` — Generator, Verifikation, Kurve

```js
export const GEN_VERSION: 2;

// --- Erzeugung ----------------------------------------------------------
export function generateLevel(spec: LevelSpec): Level;
//   erzeugt, bewertet, VERIFIZIERT und liefert erst dann aus. Wirft Error, wenn nach
//   12 Versuchen + Fuellrueckfall kein verifizierbares Level entsteht (darf nie passieren;
//   Tests decken das ab).
export function generateFromCode(code: string): Level;
export function generateForLevelNo(n: number, override?: Partial<LevelSpec>): Level;

// --- Verifikation (PFLICHT im Produktivpfad) -----------------------------
export function verifyLevel(level: Level): {ok: boolean, checked: number, reason?: string};
//   Baut Board und State AUSSCHLIESSLICH aus der serialisierten Levelbeschreibung neu auf,
//   spielt level.witness Zug fuer Zug mit resolveMove ab und prueft je Zug:
//   kind !== 'INVALID', from === witness[i], und am Ende isSolved(state) === true.
export function replayTaps(level: Level, taps: number[]):
    {ok: boolean, moves: number, invalid: number, solved: boolean, timeLowerMs: number};
//   Vom Worker fuer die Score-Pruefung benutzt. Zaehlt nur gueltige Zuege.
export function solveGreedy(board: Board, state: State, rng: () => number, maxSteps?: number):
    {solved: boolean, moves: number, rest: number};
//   Unabhaengiger Vorwaerts-Solver (kein Bestandteil der Garantie, nur Kennzahl/Debug).

// --- Kurve und Codes ------------------------------------------------------
export function levelSpecFor(n: number): LevelSpec;
export function encodeLevelCode(spec: LevelSpec): string;
//   `${M}-${G}-${W}x${H}x${D}-${attempt}-${seed.toString(16).toUpperCase().padStart(8,'0')}`
//   M in {F,V}, G in {A,B}. Beispiel: "F-A-4x5x4-0-0008FA3C"
export function parseLevelCode(code: string): LevelSpec;           // wirft bei Formatfehler
export function encodeHash(spec: LevelSpec): string;
//   "#s=8fa3c&m=FASSADE&g=ABBAU&d=5x7x5&a=0&r=1&gv=1"   (A-Uebernahme, teilbar per Link)
export function parseHash(hash: string): LevelSpec | null;

// --- Kennzahlen -----------------------------------------------------------
export function measureLevel(board: Board, level: Level, runs?: number): Level['metrics'];
//   runs Standard 200. MUSS in main.js in einem Zeitbudget bzw. requestIdleCallback
//   laufen, niemals synchron im Levelstart-Pfad blockierend (§8.7).
```

### 4.3 `src/render.js` — Three.js-Schicht

```js
export const LAYER_PICK: 1;
export const Ease: {linear, outCubic, inQuad, inOutCubic, outBack, appleSpring,
                    stepped6, stepped8}; // (t:number)=>number

export function createRenderer(canvas: HTMLCanvasElement,
                               opts?: {lowEnd?: boolean}): THREE.WebGLRenderer;
export function createScene(renderer): {
  scene, worldRig, towerGroup, flyingGroup, fxGroup,
  lights: {hemi, key, fill}, coreBox: THREE.Mesh
};
export function createCamera(aspect: number): THREE.PerspectiveCamera;   // fov 45
export function createControls(camera, canvas, opts?: {minPolarDeg?, maxPolarDeg?}): OrbitControls;
export function fitCamera(camera, controls, dims: {W,H,D}, cell?: number,
                          margin?: number, hudFraction?: number): number;   // liefert dist
export function updateKeyLight(key, camera, controls, dist: number): void;
export function attachResize(renderer, camera, container, onResize): () => void;
export function startLoop(renderer, step: (dtMs:number) => boolean):
    {stop(): void, requestRender(): void};

// --- Atlas und Geometrievarianten ---------------------------------------
export const TILE: {PLAIN:0, ARROW:1, TIP:2, TAIL:3};
export const ROW:  {NORMAL:0, TARGET:1, HINT:2};
export function buildAtlas(skin: SkinTokens, maxAnisotropy: number):
    {map, emissiveMap, redraw(skin): void, dispose(): void};
export function buildVariantSet(mode: 'FASSADE'|'VOLUMEN'):
    Map<string, THREE.BufferGeometry>;   // Schluessel `${dirWorldKey}|${rowFromTop}`

// --- Turmansicht ----------------------------------------------------------
export function createTowerView(ctx: {scene, renderer, board: Board, skin: SkinTokens}): TowerView;
/** @typedef {Object} TowerView
 *  @property {THREE.Group} towerGroup @property {THREE.Group} flyingGroup
 *  @property {THREE.MeshStandardMaterial} material
 *  @property {(level:Level)=>void} build
 *  @property {(cubeId:number)=>CubeRef|undefined} get
 *  @property {(cell:number)=>THREE.Vector3} worldOf
 *  @property {(id:number|null)=>void} setHovered
 *  @property {(move:Move|null)=>void} setPreview      Geisterspur + Traegerleuchten
 *  @property {(cell:number)=>void} flashBlocker
 *  @property {(skin:SkinTokens)=>void} setSkin
 *  @property {(on:boolean)=>void} setXray             Roentgen (Longpress / Schalter)
 *  @property {(k:number)=>void} setPeelLayers
 *  @property {(state:State)=>void} snapAll
 *  @property {()=>void} dispose */

// --- Animation -------------------------------------------------------------
export class Tween { constructor(durMs, ease, onUpdate, onDone?); finish(): void }
export function createAnimRunner(opts?: {speed?: number, strictLock?: boolean}): AnimRunner;
/** @typedef {Object} AnimRunner
 *  @property {number} speed @property {boolean} strictLock @property {boolean} busy
 *  @property {(t:Tween)=>void} play
 *  @property {(items:Array<Tween|number>)=>void} playSequence
 *  @property {(dtMs:number)=>boolean} update
 *  @property {(cell:number)=>void} buffer
 *  @property {()=>number|null} takeBuffered
 *  @property {()=>void} finishAll */
export function buildTweens(view: TowerView, board: Board, move: Move,
                            skin: SkinTokens): Array<Tween|number>;
export function shakeWorld(worldRig, amplitude: number, durMs: number): Tween;

// --- Eingabe ---------------------------------------------------------------
export function createPointerInput(opts: {
  canvas, camera, pickRoot,
  onTap: (cell:number, hit) => void,
  onHover?: (cell:number|null) => void,
  onLongPress?: (down:boolean) => void,
  onActivity?: () => void,
  controls?: OrbitControls,        // fuer Daempfungs-Verwurf und Refit-Ausnahme, §8.7
  thresholds?: {moveMouse?:5, moveTouch?:12, maxMs?:600}
}): {update(): void, pickAt(x:number, y:number, spread?:number): object|null, dispose(): void};
```

### 4.4 `src/skins.js`

```js
export const SKIN_IDS: readonly ['modern','apple','arcade'];
export const SKINS: Record<string, SkinTokens>;
export function getSkin(id: string): SkinTokens;                  // wirft bei unbekannter Id
export function resolveSkinId(pref?: string): string;             // ?skin= > localStorage > 'modern'
export function applySkinDom(skin: SkinTokens, root?: HTMLElement): void;
export function applySkinThree(skin: SkinTokens,
    ctx: {renderer, scene, lights, view: TowerView, worldRig}): void;
export function easingOf(name: string): (t:number)=>number;
export function createAudio(): SkinAudio;
/** @typedef {Object} SkinAudio
 *  @property {()=>Promise<void>} unlock          nur aus echter Nutzergeste
 *  @property {(tokens:AudioTokens)=>void} setProfile
 *  @property {(event:AudioEvent, opts?:{gain?:number})=>void} play
 *  @property {(muted:boolean)=>void} setMuted
 *  @property {()=>void} dispose */
```

### 4.5 `src/ui.js`

```js
export const TEXTE: Record<string, string>;        // ALLE deutschen UI-Strings, ein Ort
export function createUI(handlers: {
  onNew, onUndo, onRestart, onSkin, onMode, onGoal, onLevel,
  onSubmitScore, onShowBoard, onXray, onSpeed, onMute
}): UI;
/** @typedef {Object} UI
 *  @property {(n:number)=>void} setMoves
 *  @property {(n:number)=>void} setPar          Beschriftung "Richtwert"
 *  @property {(ms:number)=>void} setTimer
 *  @property {(n:number)=>void} setUndos
 *  @property {(s:{moves,timeMs,par,stars,undos})=>void} showWin
 *  @property {()=>void} hideWin
 *  @property {()=>void} showDeadEnd             Overlay mit Rueckgaengig/Neustart
 *  @property {()=>void} hideDeadEnd             Gegenstueck; loest die Sackgasse von aussen auf
 *  @property {(rows:ScoreRow[])=>void} showBoard
 *  @property {(text:string, kind?:'info'|'error')=>void} toast
 *  @property {(b:boolean)=>void} setBusy
 *  @property {(id:string)=>void} setSkinChip
 *  @property {(v:{skin?:string, mode?:string, goal?:string, level?:number,
 *                 speed?:number, xray?:boolean, muted?:boolean})=>void} setControls
 *    Bringt die Bedienelemente auf den Stand des Spiels (URL-Hash, gespeicherte
 *    Einstellungen), OHNE die Rueckrufe auszuloesen. */
```

**Overlays sind ein Stapel, kein Schalter — normativ.**

Die Overlays (Sieg, Sackgasse, Bestenliste) liegen uebereinander, nicht nebeneinander. Aus dem
Sieg-Overlay fuehrt ein Knopf in die Bestenliste; kehrte man von dort ins Nichts zurueck, waere
der Sieg samt Eintragefeld verloren. Deshalb gilt:

* Oeffnet ein Overlay, waehrend eines offen ist, wird das bisherige **verdeckt** (`hidden`), nicht
  geschlossen. Sein Rueckweg (`vorher`) und der zuletzt fokussierte Knoten (`zurueck`) bleiben
  erhalten.
* Schliesst das oberste Overlay, kommt das darunterliegende **samt Fokus** zurueck. Ist der
  gemerkte Knoten nicht mehr im Dokument, faengt das erste fokussierbare Element des
  wiederkehrenden Overlays den Fokus.
* Wird ein Overlay geoeffnet, das im Rueckweg schon vorkommt, wird alles **darueber** geschlossen,
  statt einen zweiten Eintrag anzulegen. Der Stapel DARF NIE einen Kreis enthalten.
* `hideWin`/`hideDeadEnd` DUERFEN ein **verdecktes** Overlay treffen. Dann wird nur der Rueckweg
  dorthin gekappt: das Overlay kehrt spaeter nicht wieder, das obenliegende bleibt unberuehrt.
* Escape und die Tabulatorschleife gelten immer nur fuer das **oberste** Overlay. Die Sackgasse
  wird mit `{escape:false}` geoeffnet: sie ist nie durch Wegklicken aufloesbar, sondern nur ueber
  Rueckgaengig, Neustart oder `hideDeadEnd` von aussen. Ein Blick in die Bestenliste MUSS sie
  danach unveraendert zurueckbringen.

Testgegenstand: §10.9 (`tests/ui.test.js`) gegen ein minimales DOM-Modell, ohne Browser.

### 4.6 `src/api.js`

```js
export async function getScores(q: {dir?, goal?, size?, limit?: number, offset?: number,
                                    bestPerName?: boolean}):
    Promise<{ok: true, total: number, records: ScoreRow[]} | {ok: false, error: string, message: string}>;
export async function postScore(run: RunLog):
    Promise<{ok: true, id: number, rank: number, total: number, duplicate: boolean}
          | {ok: false, error: string, field?: string, message: string, retryAfterSec?: number}>;
export function newUuid(): string;                 // crypto.randomUUID mit Fallback
export function clientId(): string;                // aus localStorage, try/catch-gekapselt
/** @typedef {Object} ScoreRow
 *  @property {number} rank @property {number} id @property {string} name
 *  @property {string} dirMode @property {string} goalMode
 *  @property {{x,y,z}} size @property {string} sizeKey
 *  @property {number} cubes @property {number} moves @property {number} undos
 *  @property {number} timeMs @property {string} createdAt */
```

### 4.7 `src/main.js`

```js
export function boot(): Promise<void>;             // wird am Modulende selbst aufgerufen
```

Ablauf von `boot()`:

1. `parseHash(location.hash)` → `LevelSpec`, sonst `levelSpecFor(gespeicherteLevelNr)`.
2. `buildBoard` → `generateLevel` (enthaelt `verifyLevel`, §6.8).
3. `createRenderer`/`createScene`/`createCamera`/`createControls`/`fitCamera`.
4. `resolveSkinId` → `applySkinDom` + `applySkinThree`.
5. `createTowerView().build(level)`, `createUI`, `createPointerInput`, `createAnimRunner`.
6. `startLoop(step)`; `step` ruft `controls.update(dt)`, `anim.update(dt)`,
   `tickClock(session, dt)` (nur wenn die Uhr laeuft), `updateKeyLight`, rendert bei Bedarf.
7. Nach jedem gueltigen Zug: `ui.setMoves`, Siegpruefung, `hasAnyMove`-Pruefung,
   `history.replaceState` mit `encodeHash(spec)`.
8. `measureLevel` laeuft **nach** dem ersten gerenderten Frame in `requestIdleCallback`
   (Fallback `setTimeout(...,0)`), niemals blockierend vor dem Levelstart.

### 4.8 `worker/index.js`

```js
export default { async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> };
/** Env = {ASSETS: Fetcher, DB: D1Database, ALLOWED_ORIGINS: string, IP_SALT: string} */
```

Hilfsmodule (Signaturen in §9.5):
`worker/http.js` → `corsHeaders`, `preflight`, `json`;
`worker/validate.js` → `capacity`, `minMoves`, `parseQuery`, `validateSubmission`;
`worker/names.js` → `normalizeName`;
`worker/ratelimit.js` → `hashIp`, `hashText`, `checkRateLimit`, `gcRateLimit`;
`worker/api-records.js` → `handleRecords`.

---

## 5. Zugalgorithmus

Eine einzige Implementierung in `src/game.js`. Sie liest ausschliesslich
`(board.step, board.valid, state.occ, state.dirOf, state.alive)` und ist seiteneffektfrei.

```js
export function resolveMove(board, state, cell) {
  const id = state.occ[cell];
  if (id === EMPTY || !state.alive[id])
    return { kind:'INVALID', reason:'DEAD', cubeId:id, from:cell, to:OUT,
             jumps:0, path:[cell], jumped:[] };

  const d  = state.dirOf[id];
  const st = board.step;                       // Int32Array, OUT = -1

  // --- Phase 1: erster Zug -------------------------------------------------
  const n1 = st[cell*6 + d];
  if (n1 === OUT)                              // RF-1
    return { kind:'EXIT', cubeId:id, from:cell, to:OUT, jumps:0,
             path:[cell], jumped:[] };
  if (state.occ[n1] === EMPTY)                 // RF-2, Regel R1
    return { kind:'STEP', cubeId:id, from:cell, to:n1, jumps:0,
             path:[cell, n1], jumped:[] };

  const n2 = st[n1*6 + d];
  if (n2 === OUT)                              // RF-3: Sprung ueber den Rand hinaus
    return { kind:'EXIT', cubeId:id, from:cell, to:OUT, jumps:1,
             path:[cell], jumped:[n1] };
  if (state.occ[n2] !== EMPTY)                 // RF-4, Regel R4
    return { kind:'INVALID', reason:'BLOCKED', cubeId:id, from:cell, to:OUT,
             jumps:0, path:[cell], jumped:[n1] };

  // Regel R2: erster Sprung ist vollzogen
  let cur = n2, jumps = 1;
  const path = [cell, n2], jumped = [n1];

  // --- Phase 2: Kette, NUR weitere Spruenge (Regel R3) ---------------------
  for (;;) {
    const over = st[cur*6 + d];
    if (over === OUT) break;                          // RF-5
    if (state.occ[over] === EMPTY) break;             // RF-6: kein Schritt hinter dem Sprung
    const land = st[over*6 + d];
    if (land === OUT) {                               // RF-7
      jumped.push(over);
      return { kind:'EXIT', cubeId:id, from:cell, to:OUT, jumps:jumps+1, path, jumped };
    }
    if (state.occ[land] !== EMPTY) break;             // RF-8
    cur = land; jumps++; path.push(land); jumped.push(over);
  }
  return { kind:'JUMP', cubeId:id, from:cell, to:cur, jumps, path, jumped };
}
```

### 5.1 Zustandsuebergang

```js
export function applyMove(state, move) {
  if (move.kind === 'INVALID') return;
  const id = move.cubeId;
  state.occ[move.from] = EMPTY;
  if (move.to === OUT) {
    state.alive[id] = 0; state.cellOf[id] = -1; state.aliveCount--;
  } else {
    state.occ[move.to] = id; state.cellOf[id] = move.to;
  }
}

export function revertMove(state, move) {
  if (move.kind === 'INVALID') return;
  const id = move.cubeId;
  if (move.to === OUT) { state.alive[id] = 1; state.aliveCount++; }
  else                 { state.occ[move.to] = EMPTY; }
  state.occ[move.from] = id; state.cellOf[id] = move.from;
}
```

`applyMove` gefolgt von `revertMove` ist die Identitaet auf `(occ, cellOf, alive, aliveCount)`.
Das ist Testgegenstand (§10, `rules.test.js`).

### 5.2 Ableitungen

```js
export function legalCells(board, state) {          // deterministisch, aufsteigend
  const out = [];
  for (let c = 0; c < board.C; c++)
    if (state.occ[c] !== EMPTY && resolveMove(board, state, c).kind !== 'INVALID') out.push(c);
  return out;
}
export function hasAnyMove(board, state) {
  for (let c = 0; c < board.C; c++)
    if (state.occ[c] !== EMPTY && resolveMove(board, state, c).kind !== 'INVALID') return true;
  return false;
}
export function isSolved(state) {
  return state.goal === 'ABBAU' ? state.aliveCount === 0
                                : state.alive[state.targetId] === 0;
}
```

### 5.3 Zugbuchhaltung (`tap`)

```js
export function tap(session, cell) {
  session.taps.push(cell);
  const m = resolveMove(session.board, session.state, cell);
  if (m.kind === 'INVALID') return m;                 // kein Zaehler, kein Undo-Eintrag
  session.history.push({ move: m, moveNo: session.moves, clockMs: session.clockMs });
  applyMove(session.state, m);
  session.moves += 1;                                 // LOGISCHER Commit, nicht Animationsende
  session.won = isSolved(session.state);
  return m;
}
```

Zugzaehler und Spieluhr werden **am logischen Commit** genommen, nie am Animationsende. Sonst
flossen Animationsdauer, `SPEED`-Regler und `prefers-reduced-motion` in die Bestenliste ein.

---

## 6. Levelgenerator, Loesbarkeitsgarantie und Solver

### 6.1 Verfahren

Rueckwaertsbau vom leeren Turm mit **sofortiger Vorwaertsverifikation durch genau dieselbe
`resolveMove`**. Es wird an keiner Stelle versucht, eine Sprungkette analytisch zu invertieren.
Der Generator erzeugt Kandidaten und laesst die Regel selbst urteilen.

Erzeugt wird die Zustandsfolge `S_k` (leer) → `S_{k-1}` → … → `S_0` (Startturm) samt der
zugehoerigen Vorwaertszuege. Neue Zuege werden der Referenzliste **vorangestellt** (`unshift`,
Prepend-Semantik). Ein `push` statt `unshift` erzeugt Level, die meistens trotzdem loesbar
aussehen und gelegentlich unloesbar sind — das ist der teuerste denkbare Fehler in diesem
Projekt und wird durch `verifyLevel` im Produktivpfad (§6.8) abgefangen.

### 6.2 Warum naive Rueckwaertserzeugung falsch ist (sechs Ausfallarten)

Diese sechs Faelle sind als benannte Regressionsfixtures in `tests/generator.test.js` zu fuehren;
jede MUSS vom Kandidatentest **verworfen** werden (§10.3).

| # | Name | Beschreibung |
|---|---|---|
| N1 | Ketten-Ueberschuss | Von `A` laeuft die Kette ueber das geplante Ziel `B` hinaus, weil `B+d` besetzt und `B+2d` frei ist. `resolveMove(...).to !== B` → verworfen. |
| N2 | Ketten-Unterschuss | Die Kette stoppt vor `B`, weil eine Huepfzelle frei oder eine Landezelle besetzt ist. |
| N3 | Schritt statt Sprung | `A+d` ist frei → `resolveMove` liefert `STEP` statt der geplanten Kette. |
| N4 | Feste Pfeile | Pro Rueckwaertszug wird eine Richtung frei gewaehlt → Wuerfel mit widerspruechlichen Pfeilen. Verboten: bei `unRelocate` gilt die **bestehende** Richtung des Wuerfels. |
| N5 | Zustandsdrift | Verifikation gegen den Endzustand statt gegen den Zustand, der zur Spielzeit vorliegt. |
| N6 | Austritts-Umkehr | Ein ausgeflogener Wuerfel wird an einer Stelle wieder eingesetzt, an der er im dann aktuellen, dichteren Zustand nicht austritt. |

### 6.3 Die beiden Rueckwaertsoperationen

**(A) `unExit` — Einschleusen eines neuen Steins.** Erhoeht die Steinzahl; jeder Stein des
Turms entsteht so.

```
waehle Form: 1x1 oder 2x1 (je Runde vorab, mit Wahrscheinlichkeit spec.dominoRate)
waehle freie Zelle a und Richtung d mit board.valid[a*6+d] === 1
bei 2x1 zusaetzlich Ausleger e mit
    board.valid[a*6+e] === 1
    z = board.step[a*6+e] ist im Gitter, FREI und z > a      // Anker = kleinere Zelle
    board.valid[z*6+d] === 1                                  // beide Zellen tragen d
id = addCube(state, a, d, false, e)
m  = resolveMove(board, state, a)
akzeptiere gdw. m.kind === 'EXIT' && m.jumps <= spec.maxChain
sonst: dropCube(state, id), naechster Kandidat
akzeptiert: ref.unshift(a)   // Ankerzelle des Klicks
```

Die Form wird **je Runde vorab** gewaehlt und die Kandidatensuche dann auf sie beschraenkt.
Andernfalls waechst die Suche um den Faktor der moeglichen Ausleger, ohne dass der Anteil der
2x1-Steine steuerbar waere. Findet eine 2x1-Runde keinen Kandidaten, faellt sie auf 1x1
zurueck — die Garantie haengt an der Regel, nicht an der Form.

Die Loesbarkeitsgarantie bleibt davon unberuehrt: akzeptiert wird ausschliesslich, was
`resolveMove` im **dann gueltigen** Zustand als Austritt bestaetigt. Die Form des Steins geht
nur in die Kandidatenwahl ein, nie in die Beurteilung.

**(B) `unRelocate` — Zurueckziehen eines vorhandenen Wuerfels.** Erzeugt `par > N`. Standardmaessig
abgeschaltet (`relocateRate = 0`).

```
waehle lebenden Wuerfel q auf Zelle b; d = state.dirOf[q]   // FESTE Richtung, nie neu waehlen (N4)
hebe q von b ab (occ[b] = EMPTY)
fuer t = 1..(max(W,H,D)+2):
   a = step[a_{t-1}*6 + opp[d]]   (a_0 = b);  Abbruch bei OUT
   wenn occ[a] === EMPTY:
       setze q auf a
       m = resolveMove(board, state, a)
       akzeptiere gdw. (m.kind === 'STEP' || m.kind === 'JUMP')
                    && m.to === b && m.jumps <= spec.maxChain
       bei Ablehnung: q wieder abheben, weiter
akzeptiert: ref.unshift(a)
alle abgelehnt: q zurueck auf b, Operation schlaegt folgenlos fehl
```

Der Kandidatenraum ist **genau der eindimensionale Rueckwaertsstrahl** von `b` entlang `opp[d]`,
weil die Richtung waehrend einer Kette konstant ist. Man muss die Kettenlaenge nicht raten.

### 6.4 Induktionsbeweis der Loesbarkeit

**Invariante.** Nach jedem Rueckwaertsschritt ist
`S_{i-1} --m_i--> S_i --m_{i+1}--> … --m_k--> S_k` eine Folge legaler Vorwaertszuege, und `S_k`
ist der Zielzustand.

1. **Verankerung.** `S_k` ist der Zielzustand (`ABBAU`: leer; `BEFREIUNG`: Zielwuerfel draussen),
   die leere Zugfolge ist legal.
2. **Schritt.** `m_i` wird per Konstruktion in exakt dem Zustand `S_{i-1}` geprueft, der spaeter
   real im Spielverlauf vorliegt, mit derselben Funktion `resolveMove`, die auch das Spiel
   benutzt. `resolveMove` ist deterministisch in `(board, occ, dirOf, cell)`; die Pruefung
   `resolveMove(S_{i-1}, a).to === b` bzw. `=== OUT` ist daher notwendig **und** hinreichend.
3. **Nichteinmischung.** Ein Un-Zug veraendert ausschliesslich `S_{i-1}`: er fuegt genau einen
   Wuerfel hinzu oder verschiebt genau einen Wuerfel von `b` nach `a`. Da ein Zug ohne Schwerkraft
   nur den bewegten Wuerfel aendert, bleiben `S_i … S_k` unangetastet und alle frueher
   verifizierten Uebergaenge verifiziert. Genau hier scheitert der naive Ansatz, der Spruenge
   analytisch umkehrt und die uebersprungenen Wuerfel nachtraeglich platziert. ∎

### 6.5 Fuellrueckfall mit bewiesener Terminierung (minDepth, aus B)

Der score-gierige Kandidatenlauf kann bei hoher Zieldichte und engem `maxChain` stocken. Statt
eines Backtracking-Zweigs (ungetesteter Code auf dem einzigen Rettungspfad) wird dann auf die
**tiefenmonotone Fuellung** umgeschaltet:

```
cellOrderByDepth(board, rng):
   alle noch freien Zellen, absteigend nach board.minDepthOf[i] sortiert;
   Gleichstand per Fisher-Yates mit rng gemischt; totaler Vergleicher (Index als Tiebreak).

fillByDepth(board, state, ref, rng):
   fuer jede Zelle q in dieser Ordnung:
      d* = ein Element von bestExitDirs(board, q)   (per rng gewaehlt)
      id = addCube(state, q, d*)
      m  = resolveMove(board, state, q)
      ASSERT m.kind === 'EXIT'                       // siehe Satz
      ref.unshift(q)
```

**Satz.** In dieser Ordnung und mit dieser Richtungswahl liefert `resolveMove(q, d*)` immer
`EXIT`, und das Gitter wird zu 100 % gefuellt.

**Beweis.** `depth` ist 1-Lipschitz auf dem Zellgraphen und faellt entlang `d*` um genau 1 pro
Schritt. Der Korridor `q, q+d*, …` besteht daher aus Zellen der Tiefen `k-1, k-2, …, 0` mit
`k = minDepth(q)`, alle **strikt kleiner** als `k`. Zellen kleinerer Tiefe stehen in der
absteigenden Ordnung spaeter, sind also noch leer; Zellen gleicher Tiefe liegen nicht auf dem
Korridor. Damit ist `q+d*` frei und liegt entweder noch im Gitter (`STEP`-Korridor) oder
ausserhalb. Der erste Zug ist somit nie blockiert, und die Zellen des Korridors bleiben leer, bis
der Wuerfel ausgetreten ist. ∎

Der Fuellrueckfall wird auch benutzt, wenn nach dem Hauptlauf die Zieldichte verfehlt wird
(**`fillRim`-Ersatz aus A**): jeder so eingeschleuste Wuerfel wird per `unshift` vorangestellt und
fliegt in der Referenzloesung als erster wieder heraus, beruehrt also keinen bereits verifizierten
Folgezug.

### 6.6 Hauptschleife

```js
function tryGenerate(board, spec, rng) {
  const state = emptyState(board, board.C, spec.goal);
  const ref = [];                                  // Zellindizes, Klickreihenfolge
  const N = Math.min(MAX_CUBES, Math.round(spec.density * board.C));
  let guard = 60 * N;

  while (state.aliveCount < N && guard-- > 0) {
    const useRelocate = state.aliveCount > 2 && rng() < spec.relocateRate;
    let cands = useRelocate ? unRelocateCandidates(board, state, rng, spec)
                            : unExitCandidates(board, state, rng, spec);
    if (cands.length === 0)
      cands = useRelocate ? unExitCandidates(board, state, rng, spec)
                          : unRelocateCandidates(board, state, rng, spec);
    if (cands.length === 0) break;                 // -> Fuellrueckfall
    applyUnMove(state, pickMax(cands, c => score(board, state, c, spec, rng)), ref);
  }

  if (state.aliveCount < N) fillByDepth(board, state, ref, rng);   // §6.5, bewiesen
  return { state, ref };
}
```

Kandidatensuche ist gedeckelt: freie Zellen gemischt, hoechstens 80 Zellen betrachtet, Abbruch bei
200 Kandidaten; bei `unRelocate` hoechstens 40 Wuerfel, Abbruch bei 60 Kandidaten. `maxChain` wird
**im Kandidatenfilter** durchgesetzt, nie als Nachfilter.

```js
score(board, state, c, spec, rng) =
    spec.weights.wFill  * belegteNachbarn(board, state, c.cell) / 6
  + spec.weights.wChain * Math.min(c.move.jumps, spec.maxChain)
  + spec.weights.wFrag  * frischeDerTraeger(state, c.move.jumped)   // 1 - mittleres Alter/normiert
  + spec.weights.wDiv   * richtungsVielfalt(board, state, c.cell, c.dir)
  + spec.weights.wSil   * silhouettenBonus(board, c.cell)
  + spec.weights.wRand  * rng();
```

Standardgewichte (`levelSpecFor`): `wFill 1.00`, `wChain 2.50`, `wFrag 0.60`, `wDiv 0.90`,
`wSil 0.35`, `wRand 0.25`. `richtungsVielfalt` ist nicht kosmetisch: ohne sie waehlt der
Rueckwaertsbau bevorzugt „Randzelle, Pfeil nach aussen“ und erzeugt Waende identischer Pfeile.

### 6.7 Versuchsschleife, Baender und Levelcode

```js
export function generateLevel(spec) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const rng = mulberry32((spec.seed ^ (attempt * 0x9E3779B1)) >>> 0);
    const raw = tryGenerate(buildBoard(spec), { ...spec, attempt }, rng);
    const level = toLevel(raw, { ...spec, attempt });
    const ver = verifyLevel(level);
    if (!ver.ok) continue;                          // darf nie passieren; Test deckt das ab
    if (attempt === 11 || inBands(level.metrics, spec.bands)) return level;
    keepBest(level);
  }
  return best;                                      // Loesbarkeit haengt nicht an den Baendern
}
```

Der akzeptierte `attempt` steht **im `levelCode` und im `Level`**. Ohne ihn muesste der Worker
fuer jede Score-Pruefung bis zu 12 Erzeugungen samt Bewertungsprobe nachfahren und sprengte sein
CPU-Budget. `measureLevel` (200 Playouts) laeuft im Client **ausserhalb** des Levelstart-Pfads;
der Worker fuehrt sie nie aus — er regeneriert deterministisch mit bekanntem `attempt` und
verifiziert per `replayTaps`.

### 6.8 `verifyLevel` — Pflichtschritt im Produktivpfad

```js
export function verifyLevel(level) {
  if (level.ruleVersion !== RULE_VERSION) return {ok:false, checked:0, reason:'ruleVersion'};
  if (level.genVersion  !== GEN_VERSION)  return {ok:false, checked:0, reason:'genVersion'};
  const board = buildBoard({ mode: level.mode, ...level.dims });     // NEU aus dem Level
  const state = createState(board, level.cubes, level.goal);         // NEU aus level.cubes
  for (let i = 0; i < level.witness.length; i++) {
    const cell = level.witness[i];
    const m = resolveMove(board, state, cell);
    if (m.kind === 'INVALID') return {ok:false, checked:i, reason:`invalid@${i}`};
    if (m.from !== cell)      return {ok:false, checked:i, reason:`from@${i}`};
    applyMove(state, m);
  }
  if (!isSolved(state)) return {ok:false, checked:level.witness.length, reason:'unsolved'};
  if (level.par !== level.witness.length) return {ok:false, checked:-1, reason:'par'};
  return {ok:true, checked:level.witness.length};
}
```

Der Zustand wird **ausschliesslich aus der serialisierten Levelbeschreibung** neu aufgebaut, nie
aus dem Arbeitszustand des Generators. Nur so werden zusaetzlich Serialisierungsfehler
(Zellindex, Richtung, Zielmarkierung, Sortierung) gefunden, die eine konstruktive Garantie
prinzipiell nicht sehen kann. Schlaegt die Pruefung fehl, wird das Level **nicht ausgeliefert**;
`generateLevel` geht zum naechsten Versuch.

### 6.9 Zielmodus BEFREIUNG

Keine eigene Erzeugung, **keine Dekorwuerfel**. Nach dem Hauptlauf wird der gruene Zielwuerfel als
derjenige gewaehlt, dessen Austrittsindex in `ref` beim Quantil `spec.targetQuantile` liegt.
Die Referenzloesung ist das bereits verifizierte Praefix `ref[0..g]`, an dessen Ende der gruene
Wuerfel draussen ist; `witness = ref.slice(0, g+1)`, `par = g+1`. Der Restturm bleibt stehen.

> **Normativ:** Falls jemals Dekorwuerfel eingefuehrt werden, DUERFEN sie ausschliesslich **vor**
> allen Verifikationsschritten gesetzt werden. Nachtraegliches Auffuellen von Loechern mit
> statischen Wuerfeln bricht bereits verifizierte Zuege (ein Schrittfeld wird belegt, eine Kette
> schiesst ueber). Dieser Kommentar gehoert woertlich in `src/levels.js`.

### 6.10 Unabhaengiger Solver (`solveGreedy`)

`solveGreedy` ist **nicht** Teil der Garantie, sondern liefert die Kennzahl `naivePerPar` und
dient als zweite Meinung im Test: er spielt mit einer der Politiken `zufall` / `gierig`
(bevorzugt Zuege mit `kind === 'EXIT'`) / `weit` (bevorzugt grosses `jumps`) bis zum Sieg oder bis
`hasAnyMove() === false`. In `tests/generator.test.js` MUSS er ueber alle Fixtures hinweg an
Generatorleveln **niemals** in einer Sackgasse enden, bevor er mindestens einen Zug getan hat, und
`naivePerPar = zuegeNaiv / par` wird als Kennzahl protokolliert.

### 6.11 Levelkurve (`levelSpecFor`, explizite Tabelle)

| Stufe | Level | Modus | Ziel | W×H×D | Dichte | 2×1-Anteil | maxChain | q | Sterne |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1–3 | FASSADE | ABBAU | 3×4×3 | 0.95 | 0 | 1 | – | par / 1.15 / 1.35 |
| 2 | 4–8 | FASSADE | ABBAU | 4×6×4 | 0.92 | 0.18 | 2 | – | par / 1.15 / 1.30 |
| 3 | 9–12 | FASSADE | BEFREIUNG | 4×8×4 | 0.95 | 0.30 | 2 | 0.55 | par / 1.15 / 1.30 |
| 4 | 13–18 | FASSADE | ABBAU | 5×10×5 | 0.92 | 0.30 | 3 | – | par / 1.12 / 1.25 |
| 5 | 19–22 | VOLUMEN | BEFREIUNG | 3×5×3 | 0.85 | 0.30 | 2 | 0.60 | par / 1.12 / 1.25 |
| 6 | 23–30 | VOLUMEN | ABBAU | 4×6×4 | 0.85 | 0.30 | 3 | – | par / 1.12 / 1.25 |
| 7 | 31–40 | VOLUMEN | BEFREIUNG | 4×8×4 | 0.90 | 0.30 | 4 | 0.80 | par / 1.12 / 1.25 |
| 8 | 41+ | abwechselnd | abwechselnd | wachsend, **gedeckelt** | 0.90 | 0.30 | 4 | 0.70 | par / 1.12 / 1.25 |

Stufe 8, mit `k = n - 41`: `W = D = min(6, 5 + floor(k/30))`,
`H = min(16, 10 + floor(k/6))` in FASSADE und `H = min(10, 6 + floor(k/8))` in VOLUMEN.

**Die Hoehe traegt den Schwierigkeitszuwachs, nicht die Grundflaeche.** Das hat zwei Gruende.
Erstens die Silhouette: die Vorlage ist ein hoher Turm, kein Wuerfel; eine Grundflaeche von 3 bis 6
Zellen bei 4 bis 16 Etagen trifft dieses Bild. Zweitens die Zugzahl: bei fester Grundflaeche
waechst sie in FASSADE wie `2(W+D-2)·(H-1) + W·D`, also **linear** in der Hoehe, waehrend eine
wachsende Grundflaeche sie kubisch treibt und das Spielgefuehl von Raetsel zu Fleissarbeit kippt.
Harte Deckel: 6×16×6 in FASSADE (336 Zellen), 6×10×6 in VOLUMEN (360 Zellen), dazu
`MAX_CUBES = 1200`. Im freien Spiel gelten dieselben Deckel.

**Dichte** ist normativ der Anteil **belegter Zellen**, nicht die Steinzahl je Zelle. Ein
2x1-Stein belegt zwei Zellen; die Steinzahl allein waere von der Steinform abhaengig und als
Fuellmass unbrauchbar. `metrics.density`, die Zielzahl des Rueckwaertsbaus und die Baender
beziehen sich alle auf belegte Zellen.

`relocateRate = 0` in allen Stufen. Damit ist `par` exakt die Steinzahl („ein Tipp pro
Stein“), die lesbarste Par-Definition, die dieses Spiel haben kann. Sprungketten (`maxChain`,
`wChain`) sind die einzige Schwierigkeitsquelle; die Sterneschwellen sind deshalb eng und stehen
in dieser Tabelle, nicht im Code.

Baender (`spec.bands`): `naivePerPar [1.08, 1.60]`, `chainShare [0.15, 0.70]`,
`mobility [0.12, 0.80]`, `trivialExit [0.00, 0.45]`.

---

## 7. Skins

### 7.1 Grundsatz

Ein Skin ist eine **reine, JSON-serialisierbare Datenstruktur** ohne THREE-Konstanten und ohne
Funktionen. Strings wie `'ACESFilmic'`, `'additive'`, `'appleSpring'` werden erst in `src/skins.js`
in THREE-Enums bzw. Easing-Funktionen aufgeloest. Damit ist `SKINS` ohne WebGL in `node --test`
pruefbar.

`src/styles/base.css` DARF KEINEN Hexwert und keinen literalen Radius enthalten — alles kommt aus
`var(--ps-*)`. `[data-skin="…"]`-Selektoren sind nur fuer Dinge zulaessig, die eine Custom Property
nicht ausdruecken kann (Existenz des CRT-Overlays, Dekor-Pseudoelemente, Textrenderer).

**Kontrast — normativ.** Jede Textfarbe eines Skins MUSS gegen den Grund, auf dem sie
**tatsaechlich** steht, mindestens **4,5:1** nach WCAG 2.1 halten (AA, Normaltext). Das gilt
fuer `--ps-fg`, `--ps-fg-muted`, `--ps-success`, `--ps-danger`, `--ps-btn-fg` und
`--ps-accent-fg`, und zwar so gerechnet:

1. **Der Grund ist die gestapelte Flaeche, nicht `--ps-bg`.** Halbdeckende Flaechen
   (`--ps-panel-bg`, `--ps-btn-bg`, `--ps-btn-bg-hover`, `--ps-accent-soft`) werden ueber den
   darunterliegenden deckenden Grund **alphakompositiert**, in derselben Schachtelung, die
   `base.css` aufbaut (Knopf im Panel auf der Seite).
2. **Glaspanels werden im schlechtesten Fall gerechnet.** Hinter `backdrop-filter` steht nicht
   `--ps-bg`, sondern die gerenderte Szene. Jeder Panelgrund wird deshalb sowohl ueber `--ps-bg`
   als auch ueber `--ps-bg-2` kompositiert; der ungueltigste der beiden Werte entscheidet.
3. **Deckende Akzentflaechen zaehlen als eigener Grund.** `--ps-accent-fg` wird gegen `--ps-accent`
   (`.ps-btn-primary`) **und** gegen `--ps-accent-2` (`:hover`) geprueft.

Diese Anforderung gilt ausschliesslich fuer **Text im DOM**. Die Farben unter `three` sind
Bildfarben und ausdruecklich **ausgenommen**: `target.color`, `atlas.bodyTarget`, `atlas.glyph`,
`hover.emissive` und `flash.emissive` faerben Wuerfel, nicht Buchstaben. Ein Skin DARF deshalb im
Bild ein leuchtendes Systemgruen fuehren und zugleich ein abgedunkeltes `--ps-success` — genau so
ist „Apple“ gebaut (§7.4). Damit die Abdunklung nicht ins Bild durchschlaegt, hat der
Ungueltig-Blitz mit `three.flash` einen **eigenen** Token und haengt nicht mehr an `--ps-danger`.

Reine Flaechen- und Ringfarben ohne Text (`--ps-accent-soft` als Flaeche, `--ps-focus-ring`,
`--ps-panel-border`, `--ps-scrim`) tragen keine Kontrastforderung; sie DUERFEN von der
Akzentfarbe abweichen. Testgegenstand: §10.7.

### 7.2 Schema

```js
/** @typedef {Object} SkinTokens
 *  @property {'modern'|'apple'|'arcade'} id
 *  @property {string} label                               deutscher Anzeigename
 *  @property {{themeColor:string, colorScheme:'dark'|'light'}} meta
 *  @property {Record<string,string>} css                  flach, Schluessel mit '--ps-'
 *  @property {ThreeTokens} three
 *  @property {MotionTokens} motion
 *  @property {AudioTokens} audio
 *  @property {FxTokens} fx */

/** @typedef {Object} ThreeTokens
 *  @property {number} background                          Hexzahl
 *  @property {{sky:number, ground:number, intensity:number}} hemi
 *  @property {{color:number, intensity:number, castShadow:boolean}} key
 *  @property {{color:number, intensity:number}} fill
 *  @property {number} envIntensity
 *  @property {'None'|'ACESFilmic'|'Neutral'} toneMapping
 *  @property {number} exposure
 *  @property {boolean} shadows
 *  @property {{roughness:number, metalness:number, emissive:number,
 *              emissiveIntensity:number, envMapIntensity:number}} cube
 *  @property {{roughness:number, transmission:number, opacity:number}} cubeLow  Override quality 'low'
 *  @property {{color:string, emissive:number, emissiveIntensity:number}} target
 *  @property {{emissive:number, emissiveIntensity:number}} hover
 *  @property {{emissive:number, emissiveIntensity:number}} flash   Ungueltig-Blitz (§4.3)
 *  @property {{opacity:number}} ghost                     Roentgenmodus
 *  @property {{color:number, opacity:number}} coreBox     Innenkern-Quader (FASSADE)
 *  @property {AtlasTokens} atlas */

/** @typedef {Object} AtlasTokens
 *  @property {number} tile                                Kachelkante in px (256 | 128)
 *  @property {number} gutter                              Rand je Kachel in px (>= 16)
 *  @property {'solidTriangle'|'softChevron'|'pixelArrow'} style
 *  @property {string} body                                CSS-Farbe der Wuerfelflaeche
 *  @property {string} bodyTarget                          Flaeche des Zielwuerfels
 *  @property {string} glyph                               CSS-Farbe des Pfeils
 *  @property {number} glyphAlpha
 *  @property {string} accent
 *  @property {number} margin                              0..0.5, relativ zur Kachel
 *  @property {number} shaft @property {number} head @property {number} radius
 *  @property {number} stroke                              nur softChevron
 *  @property {number} grid                                nur pixelArrow (Zellen je Kante)
 *  @property {number} glow                                shadowBlur-Faktor
 *  @property {boolean} nearest @property {number} anisotropy */

/** @typedef {Object} MotionTokens
 *  @property {{dur:number, ease:string}} step
 *  @property {{dur:number, ease:string, arc:number}} jump
 *  @property {{delay:number}} chain
 *  @property {{dur:number, ease:string, amp:number, cycles:number}} wobble
 *  @property {{dur:number, ease:string, spin:number}} fly
 *  @property {{dur:number, ease:string}} spawn @property {number} spawnStagger
 *  @property {{amp:number, dur:number, freq:number}} shake
 *  @property {{dur:number}} camera */

/** @typedef {Object} AudioTokens
 *  @property {number} master @property {number} bitcrush
 *  @property {{wet:number, seconds:number, decay:number}|null} reverb
 *  @property {Record<AudioEvent, VoiceToken>} events
 *  AudioEvent = 'tap'|'move'|'jump'|'chain'|'invalid'|'fly'|'win'|'undo'|'ui'|'skin'
 *  VoiceToken = {wave:'sine'|'triangle'|'square'|'sawtooth'|'noise', notes?:number[],
 *                arpMs?:number, glideTo?:number, dur:number, a:number, r:number,
 *                gain:number, detune?:number,
 *                filter?:{type:'lowpass'|'bandpass'|'highpass', freq:number, q:number}} */

/** @typedef {Object} FxTokens
 *  @property {{enabled:boolean, opacity:number, periodPx:number, grille:number,
 *              vignette:number, roll:boolean, flicker:number}} crt
 *  @property {string} canvasFilter                        nur saturate/contrast, NIE drop-shadow
 *  @property {boolean} screenShake @property {boolean} sounds */
```

**CSS-Schluesselsatz — in allen drei Skins vollstaendig und identisch besetzt:**
`--ps-bg`, `--ps-bg-2`, `--ps-panel-bg`, `--ps-panel-blur`, `--ps-panel-border`,
`--ps-panel-shadow`, `--ps-panel-radius`, `--ps-fg`, `--ps-fg-muted`, `--ps-accent`,
`--ps-accent-2`, `--ps-accent-soft`, `--ps-accent-fg`, `--ps-success`, `--ps-danger`,
`--ps-btn-bg`, `--ps-btn-bg-hover`, `--ps-btn-fg`, `--ps-btn-border`, `--ps-btn-radius`,
`--ps-btn-press`, `--ps-font-ui`, `--ps-font-num`, `--ps-size-hud`, `--ps-size-title`,
`--ps-tracking`, `--ps-transform`, `--ps-text-shadow`, `--ps-weight`, `--ps-dur-ui`,
`--ps-ease-ui`, `--ps-scrim`, `--ps-focus-ring`, `--ps-scanline-opacity`,
`--ps-scanline-period`, `--ps-grille-opacity`, `--ps-vignette`, `--ps-canvas-filter`,
`--ps-color-scheme`, `--ps-gap`, `--ps-hud-pad`.

### 7.3 Skin „Modern“ (dunkel, mattweiss, dezenter Akzent)

```js
export const SKINS = { modern: {
  id:'modern', label:'Modern',
  meta:{ themeColor:'#0E1116', colorScheme:'dark' },
  css:{
    '--ps-bg':'#0E1116', '--ps-bg-2':'#151A21',
    '--ps-panel-bg':'rgba(21,26,33,.86)', '--ps-panel-blur':'8px',
    '--ps-panel-border':'1px solid rgba(255,255,255,.08)',
    '--ps-panel-shadow':'0 12px 32px rgba(0,0,0,.45)', '--ps-panel-radius':'14px',
    '--ps-fg':'#ECEEF2', '--ps-fg-muted':'#98A1AE',
    '--ps-accent':'#5B8CFF', '--ps-accent-2':'#5B8CFF',
    '--ps-accent-soft':'rgba(91,140,255,.16)', '--ps-accent-fg':'#08111F',
    '--ps-success':'#3FBF7F', '--ps-danger':'#E2564A',
    '--ps-btn-bg':'#1C222B', '--ps-btn-bg-hover':'#232B36', '--ps-btn-fg':'#ECEEF2',
    '--ps-btn-border':'1px solid rgba(255,255,255,.10)', '--ps-btn-radius':'10px',
    '--ps-btn-press':'scale(.97)',
    '--ps-font-ui':'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
    '--ps-font-num':'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    '--ps-size-hud':'14px', '--ps-size-title':'28px',
    '--ps-tracking':'.01em', '--ps-transform':'none', '--ps-text-shadow':'none',
    '--ps-weight':'560', '--ps-dur-ui':'160ms', '--ps-ease-ui':'cubic-bezier(.2,.8,.2,1)',
    '--ps-scrim':'rgba(6,8,12,.62)', '--ps-focus-ring':'0 0 0 2px rgba(91,140,255,.55)',
    '--ps-scanline-opacity':'0', '--ps-scanline-period':'3px',
    '--ps-grille-opacity':'0', '--ps-vignette':'0',
    '--ps-canvas-filter':'none', '--ps-color-scheme':'dark',
    '--ps-gap':'10px', '--ps-hud-pad':'12px 14px'
  },
  three:{
    background:0x0E1116,
    hemi:{ sky:0x8FA3BD, ground:0x0A0C10, intensity:0.55 },
    key:{ color:0xFFFFFF, intensity:2.2, castShadow:true },
    fill:{ color:0x5B8CFF, intensity:0.45 },
    envIntensity:0.50, toneMapping:'ACESFilmic', exposure:1.05, shadows:true,
    cube:{ roughness:0.62, metalness:0.0, emissive:0x000000,
           emissiveIntensity:0.0, envMapIntensity:0.5 },
    cubeLow:{ roughness:0.68, transmission:0, opacity:1 },
    target:{ color:'#4ADE80', emissive:0x0F3D24, emissiveIntensity:0.60 },
    hover:{ emissive:0x5B8CFF, emissiveIntensity:0.22 },
    flash:{ emissive:0xE2564A, emissiveIntensity:0.90 },
    ghost:{ opacity:0.16 },
    coreBox:{ color:0x0E1116, opacity:1.0 },
    atlas:{ tile:256, gutter:16, style:'solidTriangle',
            body:'#F2F1EE', bodyTarget:'#4ADE80', glyph:'#12151A', glyphAlpha:1,
            accent:'#5B8CFF', margin:0.18, shaft:0.24, head:0.56, radius:0.05,
            stroke:0.11, grid:16, glow:0, nearest:false, anisotropy:8 }
  },
  motion:{
    step:{ dur:150, ease:'inOutCubic' },
    jump:{ dur:260, ease:'inOutCubic', arc:0.55 },
    chain:{ delay:45 },
    wobble:{ dur:260, ease:'outCubic', amp:0.10, cycles:3 },
    fly:{ dur:420, ease:'inQuad', spin:1.5 },
    spawn:{ dur:280, ease:'outCubic' }, spawnStagger:14,
    shake:{ amp:0, dur:0, freq:0 }, camera:{ dur:500 }
  },
  audio:{ master:0.42, bitcrush:0, reverb:null, events:{
    tap:    { wave:'sine',     notes:[660], dur:.05, a:.004, r:.05, gain:.10 },
    move:   { wave:'triangle', notes:[440], dur:.09, a:.004, r:.07, gain:.12,
              filter:{type:'lowpass',freq:2600,q:.7} },
    jump:   { wave:'triangle', notes:[523,784],  arpMs:55, dur:.16, a:.004, r:.09, gain:.14 },
    chain:  { wave:'triangle', notes:[659,988],  arpMs:45, dur:.14, a:.004, r:.08, gain:.15 },
    invalid:{ wave:'sine',     notes:[196,185],  arpMs:60, dur:.16, a:.006, r:.10, gain:.11 },
    fly:    { wave:'sine',     notes:[330], glideTo:120, dur:.42, a:.006, r:.20, gain:.10 },
    win:    { wave:'triangle', notes:[523,659,784,1047], arpMs:110, dur:.70, a:.01, r:.25, gain:.16 },
    undo:   { wave:'sine',     notes:[392,294],  arpMs:70, dur:.16, a:.005, r:.09, gain:.10 },
    ui:     { wave:'sine',     notes:[880], dur:.03, a:.002, r:.03, gain:.07 },
    skin:   { wave:'triangle', notes:[587,880],  arpMs:70, dur:.20, a:.006, r:.12, gain:.12 } } },
  fx:{ crt:{ enabled:false, opacity:0, periodPx:3, grille:0, vignette:0, roll:false, flicker:0 },
       canvasFilter:'none', screenShake:false, sounds:true }
},
```

### 7.4 Skin „Apple“ (hell, luftig, Glassmorphism, Systemschrift)

```js
apple: {
  id:'apple', label:'Apple',
  meta:{ themeColor:'#F4F5F7', colorScheme:'light' },
  css:{
    '--ps-bg':'#F4F5F7', '--ps-bg-2':'#FFFFFF',
    '--ps-panel-bg':'rgba(255,255,255,.58)', '--ps-panel-blur':'24px',
    '--ps-panel-border':'1px solid rgba(255,255,255,.72)',
    '--ps-panel-shadow':'0 10px 34px rgba(16,24,40,.10), 0 1px 2px rgba(16,24,40,.06)',
    '--ps-panel-radius':'22px',
    '--ps-fg':'#1C1C1E', '--ps-fg-muted':'#5A5A5F',
    // Weisse Beschriftung auf .ps-btn-primary: 4,70:1 im Ruhezustand, 5,98:1 im :hover.
    '--ps-accent':'#0071E3', '--ps-accent-2':'#005FCC',
    // Reine Flaechen-/Ringfarbe, ohne Text darauf: der alte Blauton bleibt (§7.1).
    '--ps-accent-soft':'rgba(10,132,255,.12)', '--ps-accent-fg':'#FFFFFF',
    // Auf dem Glaspanel: 5,07:1 (.ps-note.is-ok) bzw. 5,19:1 (.ps-note.is-error, .ps-toast).
    '--ps-success':'#1C7C3C', '--ps-danger':'#D70015',
    '--ps-btn-bg':'rgba(255,255,255,.75)', '--ps-btn-bg-hover':'rgba(255,255,255,.94)',
    '--ps-btn-fg':'#1C1C1E', '--ps-btn-border':'1px solid rgba(255,255,255,.85)',
    '--ps-btn-radius':'18px', '--ps-btn-press':'scale(.96)',
    '--ps-font-ui':'-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
    '--ps-font-num':'ui-monospace,SFMono-Regular,Menlo,monospace',
    '--ps-size-hud':'15px', '--ps-size-title':'30px',
    '--ps-tracking':'-.01em', '--ps-transform':'none', '--ps-text-shadow':'none',
    '--ps-weight':'590', '--ps-dur-ui':'320ms', '--ps-ease-ui':'cubic-bezier(.22,1,.36,1)',
    '--ps-scrim':'rgba(242,242,247,.72)', '--ps-focus-ring':'0 0 0 4px rgba(10,132,255,.28)',
    '--ps-scanline-opacity':'0', '--ps-scanline-period':'3px',
    '--ps-grille-opacity':'0', '--ps-vignette':'0',
    '--ps-canvas-filter':'none', '--ps-color-scheme':'light',
    '--ps-gap':'12px', '--ps-hud-pad':'14px 18px'
  },
  three:{
    background:0xD9E1EB,          // deutlich dunkler als die Wuerfel, sonst verschwinden sie
    hemi:{ sky:0xFFFFFF, ground:0xA9B7C7, intensity:1.05 },
    key:{ color:0xFFFFFF, intensity:1.25, castShadow:true },
    fill:{ color:0xCFE3FF, intensity:0.28 },
    envIntensity:0.55, toneMapping:'Neutral', exposure:0.96, shadows:true,
    cube:{ roughness:0.34, metalness:0.0, emissive:0x000000,
           emissiveIntensity:0.0, envMapIntensity:0.50 },
    cubeLow:{ roughness:0.32, transmission:0, opacity:0.96 },
    target:{ color:'#34C759', emissive:0x134A25, emissiveIntensity:0.25 },
    hover:{ emissive:0x0A84FF, emissiveIntensity:0.12 },
    flash:{ emissive:0xFF3B30, emissiveIntensity:0.90 },
    ghost:{ opacity:0.14 },
    coreBox:{ color:0xD9E1EB, opacity:1.0 },
    atlas:{ tile:256, gutter:16, style:'softChevron',
            body:'#FFFFFF', bodyTarget:'#BFF7CE', glyph:'#1C1C1E', glyphAlpha:0.92,
            accent:'#0A84FF', margin:0.26, shaft:0.22, head:0.50, radius:0.10,
            stroke:0.11, grid:16, glow:0, nearest:false, anisotropy:8 }
  },
  motion:{
    step:{ dur:220, ease:'appleSpring' },
    jump:{ dur:340, ease:'appleSpring', arc:0.62 },
    chain:{ delay:70 },
    wobble:{ dur:360, ease:'appleSpring', amp:0.06, cycles:2 },
    fly:{ dur:620, ease:'inQuad', spin:0.8 },
    spawn:{ dur:520, ease:'appleSpring' }, spawnStagger:22,
    shake:{ amp:0, dur:0, freq:0 }, camera:{ dur:620 }
  },
  audio:{ master:0.38, bitcrush:0, reverb:{ wet:0.25, seconds:1.4, decay:3.2 }, events:{
    tap:    { wave:'triangle', notes:[698], dur:.06, a:.008, r:.08, gain:.09 },
    move:   { wave:'triangle', notes:[523], dur:.12, a:.010, r:.12, gain:.11,
              filter:{type:'lowpass',freq:3000,q:.6} },
    jump:   { wave:'triangle', notes:[587,880],  arpMs:70, dur:.20, a:.010, r:.14, gain:.12 },
    chain:  { wave:'triangle', notes:[698,1047], arpMs:60, dur:.18, a:.010, r:.12, gain:.13 },
    invalid:{ wave:'sine',     notes:[262,247],  arpMs:70, dur:.18, a:.012, r:.14, gain:.10 },
    fly:    { wave:'sine',     notes:[440], glideTo:180, dur:.60, a:.010, r:.30, gain:.10 },
    win:    { wave:'triangle', notes:[523,659,784,1047,1319], arpMs:130, dur:.90,
              a:.012, r:.35, gain:.14 },
    undo:   { wave:'triangle', notes:[440,349],  arpMs:80, dur:.18, a:.010, r:.12, gain:.09 },
    ui:     { wave:'sine',     notes:[988], dur:.04, a:.004, r:.05, gain:.06 },
    skin:   { wave:'triangle', notes:[659,988],  arpMs:90, dur:.25, a:.012, r:.18, gain:.11 } } },
  fx:{ crt:{ enabled:false, opacity:0, periodPx:3, grille:0, vignette:0, roll:false, flicker:0 },
       canvasFilter:'none', screenShake:false, sounds:true }
},
```

> **Festlegung:** Der Skin ist in sich absichtlich **zweigeteilt**. Im DOM stehen die
> abgedunkelten Werte (`--ps-success` `#1C7C3C`, `--ps-danger` `#D70015`, `--ps-accent` `#0071E3`),
> weil dort Text darauf liegt und §7.1 gilt. Im Bild bleiben das helle Systemgruen
> (`target.color` `#34C759`, `atlas.bodyTarget` `#BFF7CE`) und das satte Systemrot
> (`flash.emissive` `0xFF3B30`) — Wuerfelfarben tragen keinen Text und sind von §7.1 ausgenommen.
> Diese Trennung ist der Grund fuer den eigenen Token `three.flash`: ohne ihn zoege jede
> Abdunklung von `--ps-danger` den Ungueltig-Blitz mit ins Stumpfe.
>
> **Festlegung:** Apple verwendet **kein** `MeshPhysicalMaterial` mit `transmission`. Der
> Glaseindruck entsteht aus `--ps-panel-blur` im DOM, hoher `envIntensity`, niedriger `roughness`
> und weichen Schatten. Grund: `transmission` rendert pro Frame einen zusaetzlichen Buffer, ist
> ohne WebGL2 gar nicht verfuegbar und bricht auf Mittelklasse-Mobilgeraeten ein.

### 7.5 Skin „Arcade“ (CRT-Vintage, Neon, Pixelfont, Screenshake, Sounds)

```js
arcade: {
  id:'arcade', label:'Arcade',
  meta:{ themeColor:'#07020F', colorScheme:'dark' },
  css:{
    '--ps-bg':'#07020F', '--ps-bg-2':'#12042A',
    '--ps-panel-bg':'rgba(10,2,24,.86)', '--ps-panel-blur':'0px',
    '--ps-panel-border':'2px solid #00F0FF',
    '--ps-panel-shadow':'0 0 0 2px #07020F, 0 0 18px rgba(0,240,255,.55), inset 0 0 24px rgba(255,46,136,.12)',
    '--ps-panel-radius':'0px',
    '--ps-fg':'#E8FBFF', '--ps-fg-muted':'#7FD8E8',
    '--ps-accent':'#FF2E88', '--ps-accent-2':'#00F0FF',
    '--ps-accent-soft':'rgba(255,46,136,.18)', '--ps-accent-fg':'#07020F',
    '--ps-success':'#39FF14', '--ps-danger':'#FF3131',
    '--ps-btn-bg':'#12042A', '--ps-btn-bg-hover':'#1E0642', '--ps-btn-fg':'#E8FBFF',
    '--ps-btn-border':'2px solid #FF2E88', '--ps-btn-radius':'0px',
    '--ps-btn-press':'translateY(2px)',
    '--ps-font-ui':'ui-monospace,"Courier New",monospace',
    '--ps-font-num':'ui-monospace,"Courier New",monospace',
    '--ps-size-hud':'13px', '--ps-size-title':'26px',
    '--ps-tracking':'.12em', '--ps-transform':'uppercase',
    '--ps-text-shadow':'0 0 6px currentColor, 0 0 16px rgba(255,46,136,.55)',
    '--ps-weight':'700', '--ps-dur-ui':'90ms', '--ps-ease-ui':'steps(4,end)',
    '--ps-scrim':'rgba(7,2,15,.82)', '--ps-focus-ring':'0 0 0 2px #FFE600',
    '--ps-scanline-opacity':'.30', '--ps-scanline-period':'3px',
    '--ps-grille-opacity':'.10', '--ps-vignette':'.55',
    '--ps-canvas-filter':'saturate(1.20) contrast(1.06)', '--ps-color-scheme':'dark',
    '--ps-gap':'8px', '--ps-hud-pad':'10px 12px'
  },
  three:{
    background:0x05070A,
    hemi:{ sky:0x2A1F4A, ground:0x000814, intensity:0.35 },
    key:{ color:0xFFFFFF, intensity:0.90, castShadow:false },
    fill:{ color:0xFF2E88, intensity:0.60 },
    envIntensity:0.15, toneMapping:'None', exposure:1.00, shadows:false,
    cube:{ roughness:1.0, metalness:0.0, emissive:0x1A0A2E,
           emissiveIntensity:1.40, envMapIntensity:0.15 },
    cubeLow:{ roughness:1.0, transmission:0, opacity:1 },
    target:{ color:'#39FF14', emissive:0x1B4D0C, emissiveIntensity:1.60 },
    hover:{ emissive:0xFF2E88, emissiveIntensity:0.50 },
    flash:{ emissive:0xFF3131, emissiveIntensity:0.90 },
    ghost:{ opacity:0.18 },
    coreBox:{ color:0x05070A, opacity:1.0 },
    atlas:{ tile:128, gutter:16, style:'pixelArrow',
            body:'#EDEDF5', bodyTarget:'#39FF14', glyph:'#12021F', glyphAlpha:1,
            accent:'#FF2E88', margin:0.125, shaft:0.25, head:0.50, radius:0,
            stroke:0.12, grid:16, glow:1.5, nearest:true, anisotropy:1 }
  },
  motion:{
    step:{ dur:120, ease:'stepped6' },
    jump:{ dur:200, ease:'stepped8', arc:0.45 },
    chain:{ delay:35 },
    wobble:{ dur:180, ease:'stepped6', amp:0.18, cycles:4 },
    fly:{ dur:340, ease:'linear', spin:6.0 },
    spawn:{ dur:160, ease:'stepped6' }, spawnStagger:8,
    shake:{ amp:0.28, dur:180, freq:38 }, camera:{ dur:260 }
  },
  audio:{ master:0.50, bitcrush:6, reverb:null, events:{
    tap:    { wave:'square',   notes:[880], dur:.045, a:.001, r:.03, gain:.20 },
    move:   { wave:'square',   notes:[523,784],      arpMs:38, dur:.09, a:.001, r:.03, gain:.22 },
    jump:   { wave:'square',   notes:[659,988,1319], arpMs:35, dur:.12, a:.001, r:.03, gain:.26 },
    chain:  { wave:'square',   notes:[988,1319,1760],arpMs:30, dur:.10, a:.001, r:.03,
              gain:.28, detune:12 },
    invalid:{ wave:'noise', dur:.13, a:.001, r:.05, gain:.25,
              filter:{type:'bandpass',freq:520,q:1.2} },
    fly:    { wave:'sawtooth', notes:[220], glideTo:60, dur:.35, a:.001, r:.10, gain:.22 },
    win:    { wave:'square',   notes:[523,659,784,1047,1319], arpMs:90, dur:.55,
              a:.001, r:.06, gain:.30 },
    undo:   { wave:'triangle', notes:[440,330], arpMs:60, dur:.12, a:.001, r:.04, gain:.18 },
    ui:     { wave:'square',   notes:[1320], dur:.03, a:.001, r:.02, gain:.12 },
    skin:   { wave:'square',   notes:[262,523,1047], arpMs:45, dur:.20, a:.001, r:.04, gain:.24 } } },
  fx:{ crt:{ enabled:true, opacity:0.30, periodPx:3, grille:0.10, vignette:0.55,
             roll:true, flicker:0.04 },
       canvasFilter:'saturate(1.20) contrast(1.06)', screenShake:true, sounds:true }
} };
```

### 7.6 Arcade-CRT: reines CSS, kein Postprocessing

Der CRT-Look wird **ohne** `EffectComposer`, `UnrealBloomPass` oder sonstige `three/addons`-Passes
gebaut. Ein einziges, immer vorhandenes Overlay:

```html
<div id="ps-crt" aria-hidden="true"></div>
```

```css
#ps-crt{
  position:fixed; inset:0; pointer-events:none; z-index:60;
  opacity:var(--ps-scanline-opacity,0);
  background:
    repeating-linear-gradient(to bottom,
      rgba(0,0,0,.62) 0 1px, rgba(0,0,0,0) 1px var(--ps-scanline-period,3px)),
    repeating-linear-gradient(to right,
      rgba(255,0,0,var(--ps-grille-opacity,0)) 0 1px,
      rgba(0,255,0,var(--ps-grille-opacity,0)) 1px 2px,
      rgba(0,0,255,var(--ps-grille-opacity,0)) 2px 3px);
  mix-blend-mode:multiply;
}
#ps-crt::before{ content:""; position:absolute; inset:0;
  background:radial-gradient(125% 100% at 50% 50%,
    transparent 52%, rgba(0,0,0,var(--ps-vignette,0)) 100%); }
#ps-crt::after{ content:""; position:absolute; left:0; right:0; height:22vh;
  background:linear-gradient(to bottom, rgba(255,255,255,0) 0%,
    rgba(255,255,255,.055) 45%, rgba(255,255,255,0) 100%);
  animation:ps-roll 7.5s linear infinite;
  animation-play-state:var(--ps-crt-anim,paused); }
@keyframes ps-roll{ from{transform:translateY(-25vh)} to{transform:translateY(105vh)} }
:root:not([data-skin="arcade"]) #ps-crt{ display:none }
:root[data-skin="arcade"] #ps-crt{ --ps-crt-anim:running }
#ps-canvas{ filter:var(--ps-canvas-filter,none) }
@media (prefers-reduced-motion: reduce){ #ps-crt, #ps-crt::after{ animation:none !important } }
```

* `--ps-scanline-period` wird bei Skinwechsel und `resize` auf
  `max(2, round(innerHeight/220)) + 'px'` gesetzt.
* Der Neonglow der 3D-Wuerfel kommt aus `emissiveMap` + `emissiveIntensity`, **niemals** aus
  `filter: drop-shadow()` auf dem Canvas (Vollbild-Blur pro Frame). `canvasFilter` darf nur
  `saturate`/`contrast` enthalten.
* **Screenshake wirkt auf `worldRig.position`**, nie auf die Kamera und nie als CSS-Transform auf
  dem Canvas. OrbitControls besitzt `camera.position`; ein CSS-Transform wuerde ausserdem die
  NDC-Berechnung des Raycasts verschieben und Tipps auf falsche Wuerfel lenken.
* Der Pixelfont-Look entsteht ueber `--ps-font-ui: ui-monospace`, `--ps-transform: uppercase`,
  `--ps-tracking: .12em` und `--ps-text-shadow`. Es wird **kein** `@font-face` geladen und kein
  Canvas-Bitmapfont gerendert; damit bleibt der gesamte Text kopierbar und vorlesbar, und
  HUD-Layouts brechen nicht an unerwarteten Textbreiten.

### 7.7 Skinwechsel

Reihenfolge in `applySkinThree`: **erst neu bauen, dann tauschen, dann nach einem gerenderten
Frame freigeben.**

1. Neue Materialien, neuer Atlas und neue Lichter erzeugen (altes bleibt intakt).
2. `applySkinDom` (Custom Properties, `data-skin`, `color-scheme`, `theme-color`).
3. Renderer (`toneMapping`, `exposure`, `shadowMap.enabled`), Szene (`background`, `environment`),
   `view.setSkin(skin)` → alle registrierten Wuerfel bekommen die neuen Materialreferenzen.
4. `requestAnimationFrame(() => alt.dispose())`.

`anim.finishAll()` MUSS vor jedem Skinwechsel laufen. Freizugeben sind Materialien, Texturen,
`light.shadow.map` und der PMREM-RenderTarget; **nicht** freizugeben sind Geometrien
(skinunabhaengig) und der Renderer. Pfeiltexturen haben genau einen Besitzer (den Atlas-Cache);
ein zweiter `dispose()`-Pfad ist verboten.

---

## 8. Renderschicht

### 8.1 Importmap — exakt gepinnt, selbst gehostet

`three@0.185.1`. Die Version wird an **genau einer Stelle** (`index.html`) gepinnt. Ein
Range-Specifier (`@latest`, `@0.185`) ist verboten: three.js ist auf `0.x` und bricht die API
praktisch jedes Release, und ohne Build-Schritt gibt es kein Lockfile als Netz.

**Ausliefungsstand (verbindlich): selbst gehostet.** Die vier Dateien liegen als Static Assets im
Worker. Das entfernt den Third-Party-SPOF und den Abfluss der Spieler-IP an ein CDN.

```
public/vendor/three/0.185.1/build/three.module.min.js
public/vendor/three/0.185.1/build/three.core.min.js        (relativ nachgeladen, MUSS existieren)
public/vendor/three/0.185.1/examples/jsm/controls/OrbitControls.js
public/vendor/three/0.185.1/examples/jsm/environments/RoomEnvironment.js
```

```html
<script type="importmap">
{ "imports": {
    "three":         "/vendor/three/0.185.1/build/three.module.min.js",
    "three/addons/": "/vendor/three/0.185.1/examples/jsm/"
} }
</script>
<script type="module" src="/src/main.js"></script>
```

Bezugsquelle fuer das Vendoring (nur zum Kopieren, nicht zur Laufzeit):

```
https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js
https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.core.min.js
https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/controls/OrbitControls.js
https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/environments/RoomEnvironment.js
```

Bei `"three/addons/"` muessen Schluessel **und** Wert auf `/` enden, sonst greift das
Praefix-Matching nicht. Die Importmap MUSS vor dem ersten `<script type="module">` stehen; es
darf nur eine pro Dokument geben.

### 8.2 Renderer und Szenengraph

```js
new THREE.WebGLRenderer({ canvas, antialias: !lowEnd, alpha:false, stencil:false,
                          depth:true, powerPreference:'high-performance',
                          preserveDrawingBuffer:false });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lowEnd ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.type   = THREE.PCFSoftShadowMap;
```

`lowEnd = navigator.hardwareConcurrency <= 4 || (/Android/.test(ua) && devicePixelRatio > 2.5)`.
Adaptiv: rollierender Mittelwert der Frame-Zeit ueber 60 Frames > 22 ms → `setPixelRatio` um
0.25 senken, Untergrenze 1.0.

```
scene
├── worldRig      (Group)   <- Screenshake wirkt HIER
│   ├── towerGroup(Group)   <- Gitterwuerfel, Picking-Layer 1
│   ├── coreBox   (Mesh)    <- Innenkern (nur FASSADE, s. 8.6)
│   ├── flyingGroup(Group)  <- ausgeschiedene Wuerfel, KEIN Picking
│   └── fxGroup   (Group)   <- Geisterspur, Traegerleuchten, Partikel
├── hemi, key, key.target, fill
└── scene.background / scene.environment
```

`scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture`
— weiches Specular ohne HDR-Datei und ohne Build-Schritt.

Resize ueber `ResizeObserver` auf dem Canvas-Container (nicht `window.resize`; mobile
Adressleisten-Kollapse feuern unzuverlaessig), plus einmaliger `matchMedia('(resolution: Xdppx)')`-
Listener fuer DPR-Wechsel.

### 8.3 Kamera und Framing

`PerspectiveCamera(45, aspect, near, far)`. Framing ueber den **gieren-invarianten
Halbdiagonal-Radius der Grundflaeche**, damit beim Drehen um Y nichts anschneidet:

```js
const vFov = degToRad(camera.fov);
const hFov = 2 * Math.atan(Math.tan(vFov/2) * camera.aspect);
const halfH = (H * CELL) / 2;
const Rxz   = 0.5 * Math.hypot(W * CELL, D * CELL);
const dist  = Math.max(halfH / Math.tan(vFov/2) + Rxz,
                       Rxz   / Math.tan(hFov/2) + Rxz) * margin;   // margin 1.15
controls.target.set(0, H * CELL * 0.04, 0);
controls.minDistance = Math.max(2 * CELL, dist * 0.35);
controls.maxDistance = dist * 2.2;
camera.position.setFromSpherical(new THREE.Spherical(dist, degToRad(62), degToRad(35)))
      .add(controls.target);
camera.near = Math.max(0.1, dist * 0.01);
camera.far  = dist * 6;
```

`hudFraction` (Standard 0.18 auf Mobil im Hochformat) verkuerzt die effektive Viewport-Hoehe und
hebt `controls.target.y` an, damit der Turm in der freien Flaeche zentriert bleibt.

`fitCamera` laeuft bei Resize, Levelstart und Modus-/Groessenwechsel. Bei laufendem Spiel als
500-ms-`Spherical`-Tween mit `controls.enabled = false` waehrend der Bewegung.

### 8.4 OrbitControls

```js
controls.enableDamping = true;  controls.dampingFactor = 0.08;
controls.enablePan     = false;                       // Turm bleibt zentriert
controls.rotateSpeed   = 0.85;  controls.zoomSpeed = 0.9;  controls.zoomToCursor = false;
controls.minPolarAngle = degToRad(18);   controls.maxPolarAngle = degToRad(102);
controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
controls.touches      = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
```

Mit `enablePan = false` degeneriert `TOUCH.DOLLY_PAN` zu reinem Pinch-Dolly — genau das gewuenschte
Verhalten, ohne eigene Touch-Behandlung. `minPolarAngle = 18°` verhindert das Ueberklappen am Pol;
`102°` erlaubt den Blick leicht von unten.

**Renderloop mit On-Demand-Rendering:**

```js
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05) * 1000;
  const camMoved = controls.update(dt / 1000);
  const animBusy = anim.update(dt);
  if (needsRender || camMoved || animBusy) {
    updateKeyLight(key, camera, controls, dist);
    renderer.render(scene, camera);
    needsRender = false;
  }
});
```

Das Key-Light wird der Kamera nachgefuehrt (35° seitlich versetzt, `y >= 0.55 * |v|`), sonst steht
der Spieler nach einer halben Drehung im Gegenlicht und liest keinen Pfeil mehr.

### 8.5 Pfeildarstellung — Atlas und UV-Varianten (kein Shaderpatch)

**Ausliefungsstand:** die Pfeile stecken in der `map` eines geteilten
`MeshStandardMaterial`, adressiert ueber **UV-umgeschriebene `BoxGeometry`-Varianten**. Es wird
**kein** `onBeforeCompile` und keine Shader-Chunk-Injektion verwendet: der Ausfallmodus eines
three-Updates waere sonst stumm weisse, pfeillose Wuerfel.

**Richtungssignatur auf allen sechs Flaechen** (Konvention der technischen Zeichnung). Fuer
Richtung `d` (Weltvektor aus `board.dirWorld`) und Flaechennormale `n`:

| Bedingung | Kachel | Bedeutung |
|---|---|---|
| `n·d = +1` | `TIP` (Ring mit Punkt) | Pfeil tritt aus dieser Flaeche aus |
| `n·d = -1` | `TAIL` (Kreuz im Ring) | Pfeil tritt in diese Flaeche ein |
| `n·d = 0` | `ARROW`, in der Flaechenebene gedreht | zeigt lateral nach `d` |

In FASSADE liegt `d` immer in der Wandebene, also bekommen Aussen- **und** Innenflaeche den
lateralen Pfeil, korrekt orientiert — man liest den Pfeil eines fernen Wandwuerfels auch durch ein
Loch in der nahen Wand hindurch. Ein Variantenbauer bedient beide Modi.

`BoxGeometry` hat 24 Positionen und 24 UVs (4 pro Flaeche, Flaeche `f` belegt `f*4 … f*4+3`).
Gemessene UV-Tangentenbasis in r185 (alle rechtshaendig, `Tu × Tv = n`):

| f | `n` | `Tu` | `Tv` |
|---|---|---|---|
| 0 | `+X` | `(0,0,-1)` | `(0,1,0)` |
| 1 | `-X` | `(0,0,+1)` | `(0,1,0)` |
| 2 | `+Y` | `(+1,0,0)` | `(0,0,-1)` |
| 3 | `-Y` | `(+1,0,0)` | `(0,0,+1)` |
| 4 | `+Z` | `(+1,0,0)` | `(0,1,0)` |
| 5 | `-Z` | `(-1,0,0)` | `(0,1,0)` |

Basis-UVs pro Flaeche in der Reihenfolge `k = 0..3`: `(0,1) (1,1) (0,0) (1,0)`.

```js
const COLS = 4, ROWS = 4;
const DIR4 = [[0,1],[-1,0],[0,-1],[1,0]];        // (a,b) fuer rot = 0,1,2,3

function inPlaneRotation(f, d) {                  // d = Weltrichtung
  const a = Math.round(dot(d, FACE_TU[f]));
  const b = Math.round(dot(d, FACE_TV[f]));
  for (let r = 0; r < 4; r++) if (DIR4[r][0] === a && DIR4[r][1] === b) return r;
  return 0;
}

function writeFaceUV(uv, f, col, rowFromTop, rot) {
  for (let k = 0; k < 4; k++) {
    let [u, v] = BASE_UV[k];
    for (let i = 0; i < rot; i++) { const nu = 1 - v, nv = u; u = nu; v = nv; }
    const row = ROWS - 1 - rowFromTop;            // CanvasTexture hat flipY = true!
    uv.setXY(f*4 + k, (col + u) / COLS, (row + v) / ROWS);
  }
}

export function buildVariant(dirWorld, rowFromTop) {
  const g = new THREE.BoxGeometry(CUBE_EDGE, CUBE_EDGE, CUBE_EDGE);
  const uv = g.getAttribute('uv');
  for (let f = 0; f < 6; f++) {
    const t = dot(dirWorld, FACE_N[f]);
    if      (t >  0.5) writeFaceUV(uv, f, TILE.TIP,   rowFromTop, 0);
    else if (t < -0.5) writeFaceUV(uv, f, TILE.TAIL,  rowFromTop, 0);
    else               writeFaceUV(uv, f, TILE.ARROW, rowFromTop, inPlaneRotation(f, dirWorld));
  }
  uv.needsUpdate = true;
  g.clearGroups(); g.addGroup(0, 36, 0);          // EIN Material -> EIN Draw Call je Wuerfel
  return g;
}
```

Variantenzahl: 6 Weltrichtungen × {`NORMAL`, `TARGET`} = **12 Geometrien, 1 Material, 1 Textur**
fuer den gesamten Turm. Der gruene Zielwuerfel ist eine andere **Atlas-Zeile**, kein zweites
Material.

**Pflichtpunkte:**

* `flipY` der `CanvasTexture` ist `true`, `v = 0` liegt an der **unteren** Canvas-Kante. Die
  Atlas-Zeile MUSS als `ROWS - 1 - rowFromTop` gerechnet werden.
* Atlas 1024×1024, 4×4 Kacheln à 256 px, Glyph in den inneren 224 px, **≥ 16 px Gutter je
  Kachel** gegen Mipmap-Bleeding.
* `tex.colorSpace = THREE.SRGBColorSpace`, `minFilter = LinearMipmapLinearFilter`
  (Arcade: `NearestMipmapNearestFilter`, `anisotropy = 1`), `generateMipmaps = true`.
* Die Drehrichtung von `writeFaceUV` MUSS einmal visuell verifiziert werden (Debug-Turm mit allen
  sechs Richtungen nebeneinander, erreichbar unter `?debug=arrows`). Bei Spiegelung wird die
  innere Schleife auf `nu = v, nv = 1 - u` umgestellt. Das ist die einzige Stelle, die nicht rein
  rechnerisch festnagelbar ist.
* Wuerfelinstanzen werden **nie skinbedingt rotiert**; die Zuordnung Flaeche→Weltnormale bleibt
  fest. Die Kippbewegung der Sprunganimation ist temporaer und endet bei `t = 1` wieder auf
  Identitaet.

**Kein `InstancedMesh`.** Ein Mesh pro Wuerfel, geteilte Geometrie pro Variante, ein geteiltes
Material. Gemessen (headless Chromium, SwiftShader-Software-Rasterisierung, DPR 1, 900×1400):
896 Einzelmeshes = 896 Draw Calls, **1.64 ms/Frame**; 2000 Meshes = 5.26 ms; Raycast 0.49 ms bei
896 Objekten. Auf echter GPU-Hardware ist das um Faktor 5–20 billiger. Gruende gegen
`InstancedMesh`: keine Pro-Instanz-Opazitaet, Index-Umschichtung beim Entfernen zerstoert die
Zuordnung fuer Undo und Picking, Atlas-Offset pro Instanz braucht doch wieder einen Shaderpatch.

Statische Wuerfel: `mesh.matrixAutoUpdate = false`, `mesh.updateMatrix()` einmal. Nur animierte
Wuerfel aktualisieren ihre Matrix.

**Dokumentierter Fallback**, erst bei nachgewiesenem Problem auf echter Mobilhardware: alle
statischen Wuerfel einer Variante per `mergeGeometries()` batchen (gemessen: 2 Draw Calls,
0.11 ms/Frame, Re-Merge 2.4 ms pro Zug bei 896 Wuerfeln), den animierten Wuerfel als echtes Mesh
herausziehen.

#### 8.5.1 Darstellung eines 2x1-Steins

Ein 2x1-Stein wird **nicht** als eigene, laengliche Geometrie gebaut, sondern als
`THREE.Group` aus **zwei** Teilwuerfeln derselben Variantengeometrie. Das hat drei Gruende:
die 12 Variantengeometrien aus §8.5 bleiben unveraendert wiederverwendbar, jede Zelle traegt
ihren eigenen, unverzerrten Pfeil, und das Auswahl- und Animationswerk arbeitet unveraendert
auf einem einzigen Objekt.

Damit die Fuge zwischen den Haelften verschwindet und der Stein als EIN Klotz gelesen wird,
werden die Haelften entlang der Auslegerachse gestreckt und aufeinander zu geschoben:

```
halb   = (CELL + CUBE_EDGE) / 2                  // Laenge einer Haelfte, 0.96
skala  = halb / CUBE_EDGE                        // nur auf der Auslegerachse, 1.0435
teil.position = ±ev * halb / 2                   // ±0.48 statt ±0.50
gruppe.position = worldPos(anker) + ev * CELL/2  // Mittelpunkt zwischen beiden Zellen
```

Der Gruppenursprung liegt also im **Mittelpunkt des Steins**, nicht auf der Ankerzelle. Jede
Zielposition einer Animation MUSS diesen Versatz mitfuehren (`cube.offset`). Material,
Schattenflags und die Auswahlebene werden auf den **Teilwuerfeln** gesetzt, nicht auf der
Gruppe: `THREE.Group` kennt kein `material`, und der Raycaster prueft die Ebenen je Objekt.

### 8.6 Sichtbarkeit

* **Innenkern (FASSADE, aus A):** eine Box `(W-1.1, H-1.1, D-1.1)` in
  `skin.three.coreBox.color`, damit man durch entstehende Luecken nicht in den hohlen Turm sieht.
  Wird ausgeblendet, sobald `state.aliveCount < 8`.
* **Roentgen (VOLUMEN und FASSADE):** Longpress ≥ 600 ms bzw. ein HUD-Schalter setzt alle Wuerfel
  der aeusseren Schale auf ein zweites geteiltes Material `matGhost`
  (`transparent:true, opacity: skin.three.ghost.opacity, depthWrite:false`).
* **Schichtenregler (VOLUMEN):** `setPeelLayers(k)` blendet die aeusseren `k` Schalen aus.
  Ausgeblendete Wuerfel MUESSEN `mesh.layers.disable(LAYER_PICK)` bekommen — sonst faengt man
  Klicks auf Dinge ab, die man nicht sieht.
* `material.side = THREE.FrontSide` (Default): Rueckseiten werden weggeculled, man schaut durch die
  nahe Wand und sieht dank Richtungssignatur auch dort korrekte Pfeile.

### 8.7 Auswahl (Picking) und Eingabe

```js
raycaster.layers.set(LAYER_PICK);
const r = canvas.getBoundingClientRect();       // NICHT innerWidth
ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
raycaster.setFromCamera(ndc, camera);
const hit = raycaster.intersectObjects(towerGroup.children, false)[0];
// -> hit.object.userData.cell  (Zellindex, nicht cubeId: das Spiel tippt Zellen an)
```

Dicke-Finger-Fallback auf Touch: trifft der zentrale Strahl nichts, vier Zusatzstrahlen bei
±10 CSS-px, naechstliegender Treffer gewinnt.

**Tap gegen Drag — normativ:**

* **Kein `click`-Event.** Nur Pointer Events.
* OrbitControls setzt selbst `canvas.style.touchAction = 'none'` und ruft `setPointerCapture`.
  Alle eigenen Listener MUESSEN `{passive:true}` sein; `preventDefault()` ist verboten.
  `pointermove`/`pointerup`/`pointercancel` gehoeren an `window`, `pointerdown` ans Canvas.
* Schwellen: Bewegung > **5 px** (Maus) bzw. **12 px** (Touch), gemessen **einmal absolut gegen
  den Startpunkt**, disqualifiziert den Tap dauerhaft (`moved` bleibt gesetzt, auch wenn der Finger
  zurueckwandert). Dauer > **600 ms** disqualifiziert ebenfalls (und loest stattdessen den
  Roentgenmodus aus).
* `active.size > 1` (zweiter Finger, Pinch) disqualifiziert den Tap **sofort**.
* Der Tap MUSS auf **derselben Zelle** enden, die beim `pointerdown` getroffen wurde.
* **Zittertoleranz.** Neben `moved` fuehrt die Eingabe ein zweites, weicheres Merkmal `movedAny`.
  Es wird gesetzt, sobald die Bewegung die **halbe** Schwelle ueberschreitet — mehr als 2,5 px
  mit der Maus, mehr als 6 px auf Touch —, und NICHT schon bei `dist > 0`. Begruendung: ein
  ruhig gehaltener Finger wandert
  auf jedem Geraet um ein bis zwei Pixel. Mit `dist > 0` setzte praktisch jeder Tipp `movedAny`
  und lief damit in den Verwurf des naechsten Punktes — gueltige Tipps gingen reihenweise
  verloren. Erst die halbe Schwelle trennt Zittern von bewusstem Wischen.
* Ein Tap waehrend nachlaufender Kamera-Daempfung wird verworfen: `movedAny` gesetzt **und**
  letztes `change`-Ereignis der `controls` weniger als **80 ms** her. `moved` disqualifiziert
  ohnehin fuer sich allein; der Verwurf greift also genau im Band zwischen halber und ganzer
  Schwelle — dort, wo der Zeiger die Kamera bereits gedreht hat, ohne den Tap formal zu verlieren.
* **Refit-Ausnahme.** `change`-Ereignisse zaehlen nur, solange `controls.enabled !== false`.
  Waehrend eines **programmatischen** Kamerawechsels (`fitCamera` als Spherical-Tween, §8.3,
  schaltet `controls.enabled` ab und bewegt `camera.position` von aussen) meldet
  `controls.update()` in **jedem Bild** eine Aenderung, ohne dass der Spieler die Kamera
  angefasst haette. Wuerde sie mitgezaehlt, verschluckte der Verwurf jeden Tap waehrend eines
  Refits und noch 80 ms danach — also nach jedem Levelstart, jedem Moduswechsel und jedem
  Resize. `createPointerInput` MUSS die `controls` deshalb uebergeben bekommen; ohne sie ist die
  Ausnahme nicht entscheidbar.
* Hover-Raycast nur bei `matchMedia('(hover:hover) and (pointer:fine)')`, hoechstens einmal pro
  `requestAnimationFrame`, und nur wenn kein Pointer aktiv ist.

Testgegenstand: §10.9 (`tests/render.test.js`) prueft alle fuenf Faelle einzeln — sauberer Tap,
Wischen ueber der Schwelle, Zittern unter der Toleranz bei laufender Daempfung, Tap waehrend
eines Refits, Schieben im Zwischenband mit und ohne Kamerabewegung.

Begleitendes CSS:

```css
html, body { overscroll-behavior:none; touch-action:none; }
#app { position:fixed; inset:0; }
canvas { display:block; width:100%; height:100%; touch-action:none;
  -webkit-user-select:none; user-select:none;
  -webkit-tap-highlight-color:transparent; -webkit-touch-callout:none; }
```

### 8.8 Animationen

Eigener Tween-Runner (~60 Zeilen), keine externe Bibliothek. Alle Dauern werden mit dem globalen
Faktor `SPEED` skaliert (Optionen 0.5× / 1× / 2×; `prefers-reduced-motion: reduce` erzwingt 0.35
und schaltet Bogen, Spin und Screenshake ab). Die Werte stehen in `skin.motion`; die folgende
Tabelle nennt die Modern-Referenz.

| Animation | Dauer | Easing | Aufbau |
|---|---|---|---|
| **Schritt** | 150 ms | `inOutCubic` | `lerpVectors(from, to, e)` |
| **Sprung** (je Glied) | 260 ms | horizontal `inOutCubic`, Bogen `4t(1-t)` mit **rohem** `t` | Bogenhoehe `arc * CELL`, zusaetzlich ±12° Kippen um `dir × up`, bei `t = 1` wieder 0 |
| **Kettenpause** | 45 ms | – | zwischen zwei Sprungglieder, damit die Kette zaehlbar bleibt |
| **Wegfliegen** | 420 ms | Position `inQuad`, Scale `outCubic` 1→0.55, Alpha linear ab `t = 0.35` | plus Zufalls-Spin ≈1.5 Umdrehungen |
| **Wackeln** (ungueltig) | 260 ms | gedaempfter Sinus | `amp * CELL * sin(2π·cycles·t) * (1-t)` **entlang der Pfeilrichtung**, dazu 220 ms rotes Aufblitzen von `move.jumped[0]` |
| **Kamera-Refit** | 500 ms | `inOutCubic` | `Spherical`-Lerp, `controls.enabled = false` |
| **Vorschau** | 120 ms Einblenden | `outCubic` | Geisterspur entlang `move.path`, Traeger aus `move.jumped` leuchten |

Eine 3er-Kette dauert `3·260 + 2·45 = 870 ms` und bleibt damit unter der Sekunde. Der Schritt ist
bewusst schneller als der Sprung: die Dauer kodiert die Zugart.

**Sprungbogen radial nach aussen, nicht nach Weltoben** — in VOLUMEN kann der Sprung entlang ±Y
laufen, ein Bogen „nach oben“ waere dann kollinear zur Bewegung und unsichtbar:

```js
export function arcAxis(from, dir, center) {
  const radial = from.clone().sub(center);
  radial.addScaledVector(dir, -radial.dot(dir));
  if (radial.lengthSq() < 1e-6) radial.copy(WORLD_UP).addScaledVector(dir, -WORLD_UP.dot(dir));
  if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
  return radial.normalize();
}
```

**Pro-Wuerfel-Opazitaet:** ein Pool von 8 Fade-Materialien (Klone des Skin-Materials mit
`transparent:true, depthWrite:false`), reihum vergeben (`acquire`) und nach der Animation
zurueckgegeben (`release`). `view.material.opacity` zu setzen ist verboten — das blendet den
gesamten Turm aus. `depthWrite:false` verhindert, dass der ausblendende Wuerfel ein Loch in den
dahinterliegenden Turm stanzt.

### 8.9 Eingaben waehrend laufender Animationen

Kein globaler Lock. Verbindlich:

1. Der Spielzustand wird **synchron** im Moment des gueltigen Taps mutiert (`tap()`), die Animation
   zieht nur visuell nach. Ein zweiter Tap wird damit gegen das bereits aktualisierte
   Belegungsgitter geprueft und kann logisch nie kollidieren.
2. **Pro-Wuerfel-Sperre** `cube.busy`: Taps auf einen Wuerfel, der noch gleitet, springt oder
   fliegt, werden abgewiesen.
3. **Ein-Slot-Eingabepuffer:** ein Tap in den letzten 140 ms einer Animation wird gespeichert und
   beim Animationsende genau einmal wiederholt.
4. Die **Kamera wird nie gesperrt**. Orbit und Zoom laufen waehrend jeder Animation weiter.
5. **Harte Synchronisationspunkte:** Undo, Neustart, Skinwechsel, Moduswechsel, Levelwechsel rufen
   zuerst `anim.finishAll()`.
6. Zugzaehler und Uhr am logischen Commit (§5.3).
7. Optionales Flag `strictLock` (Turniermodus): globale Sperre bis `anim.busy === false`, Zaehler
   bleiben trotzdem am logischen Commit.

---

## 9. Cloudflare: Worker, Static Assets, D1

### 9.1 Dateilayout

```
/wrangler.jsonc
/worker/index.js  api-records.js  validate.js  names.js  ratelimit.js  http.js
/migrations/0001_init.sql
/public/            <- Static Assets: index.html, src/**, styles/**, vendor/**, _headers
```

`public/` ist das Asset-Verzeichnis; das gesamte Spiel liegt dort. Kein Build-Schritt.

### 9.2 D1-Schema (`migrations/0001_init.sql`)

```sql
CREATE TABLE IF NOT EXISTS records (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at   INTEGER NOT NULL,              -- Unix-ms, SERVERZEIT
  run_id       TEXT    NOT NULL,              -- UUID je Lauf -> Idempotenz
  client_id    TEXT,
  name         TEXT    NOT NULL,              -- normalisiert, 2..16 Zeichen
  name_key     TEXT    NOT NULL,              -- casefold + entleetet, Dedup und Filter
  dir_mode     TEXT    NOT NULL CHECK (dir_mode  IN ('fassade','volumen')),
  goal_mode    TEXT    NOT NULL CHECK (goal_mode IN ('abbau','befreiung')),
  size_x       INTEGER NOT NULL CHECK (size_x BETWEEN 3 AND 16),
  size_y       INTEGER NOT NULL CHECK (size_y BETWEEN 2 AND 24),
  size_z       INTEGER NOT NULL CHECK (size_z BETWEEN 3 AND 16),
  size_key     TEXT    NOT NULL,              -- "5x7x5", serverseitig erzeugt
  cubes        INTEGER NOT NULL CHECK (cubes  > 0),
  moves        INTEGER NOT NULL CHECK (moves  > 0),
  undos        INTEGER NOT NULL DEFAULT 0,
  time_ms      INTEGER NOT NULL CHECK (time_ms > 0),
  seed         INTEGER,
  level_code   TEXT,
  rule_version INTEGER NOT NULL,
  gen_version  INTEGER NOT NULL,
  app_version  TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,    -- 1 = Replay serverseitig bestanden
  ip_hash      TEXT    NOT NULL,              -- HMAC-SHA256(IP-Praefix, IP_SALT), 16 hex
  ua_hash      TEXT,
  suspicion    INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','hidden'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_records_run ON records (run_id);
CREATE INDEX IF NOT EXISTS ix_records_board
  ON records (dir_mode, goal_mode, size_key, status, moves, time_ms, created_at);
CREATE INDEX IF NOT EXISTS ix_records_board_anysize
  ON records (dir_mode, goal_mode, status, moves, time_ms, created_at);
CREATE INDEX IF NOT EXISTS ix_records_recent ON records (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_records_ip_time ON records (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_records_name
  ON records (name_key, dir_mode, goal_mode, size_key, moves, time_ms);

CREATE TABLE IF NOT EXISTS rate_limit (
  bucket       TEXT    PRIMARY KEY,       -- "<ip>:m" | "<ip>:h" | "<ip>:d" | "global:m"
  window_start INTEGER NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_rate_limit_gc ON rate_limit (updated_at);

CREATE TABLE IF NOT EXISTS name_blocklist (
  pattern  TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
) WITHOUT ROWID;
INSERT OR IGNORE INTO name_blocklist (pattern, added_at) VALUES
  ('admin',0),('moderator',0),('cloudflare',0),('pfeilspiel',0),('system',0);
```

**Einspielen:** Workers Builds wendet Migrationen **nicht** automatisch an. Weg 1 (verbindlich fuer
den ersten Deploy): Inhalt von `0001_init.sql` in der D1-Konsole des Dashboards ausfuehren.
Weg 2 (optional): Deploy-Command auf
`npx wrangler d1 migrations apply pfeilspiel --remote && npx wrangler deploy` setzen; scheitert der
Migrationsschritt an fehlenden D1-Rechten des Build-Tokens, auf Weg 1 zurueckfallen. Ein
Lazy-Bootstrap im Worker ist verboten.

### 9.3 API

```
GET  /api/records?dir={fassade|volumen}&goal={abbau|befreiung}&size={WxHxD}
                 &limit={1..100=20}&offset={0..1000=0}&bestPerName={1}
POST /api/records                       Content-Type: application/json, Body <= 8192 Byte
OPTIONS /api/records                    -> 204, Allow-Methods: GET, POST, OPTIONS
GET  /api/health                        -> 200 {ok:true, ts:number}
GET  /api/*   (sonst)                   -> 404 {ok:false, error:"not_found", message}
*             (sonst)                   -> env.ASSETS.fetch(request)
```

Sortierung fest: `moves ASC, time_ms ASC, created_at ASC`. Nicht per Query-Parameter umschaltbar
(Cache-Key-Raum und Indexpassung). Unbekannte Parameter werden verworfen, ungueltige Werte mit
`400 validation` beantwortet — **nicht** stillschweigend geclampt, sonst cacht man Muell unter
vielen Schluesseln.

**GET 200:**

```json
{ "ok": true,
  "query": {"dir":"fassade","goal":"abbau","size":"5x7x5","limit":20,"offset":0,"bestPerName":false},
  "total": 137,
  "records": [{
    "rank":1, "id":4711, "name":"Anna",
    "dirMode":"fassade", "goalMode":"abbau",
    "size":{"x":5,"y":7,"z":5}, "sizeKey":"5x7x5",
    "cubes":121, "moves":121, "undos":3, "timeMs":73210, "verified":true,
    "createdAt":"2026-08-30T18:22:41.000Z" }] }
```

**POST Body:**

```json
{ "name":"Anna",
  "dirMode":"fassade", "goalMode":"abbau",
  "size":{"x":5,"y":7,"z":5},
  "cubes":121, "moves":121, "undos":3, "timeMs":73210,
  "seed":589116, "levelCode":"F-A-5x7x5-0-0008FA3C",
  "ruleVersion":1, "genVersion":1,
  "taps":[12,47,3,...],
  "runId":"3f6d1c2a-9b41-4a77-8a0e-1d5b7c9e2f04",
  "clientId":"7c2e5b18-0d33-4f9a-9c11-a2b3c4d5e6f7",
  "appVersion":"1.0.0" }
```

Pflicht: `name`, `dirMode`, `goalMode`, `size`, `cubes`, `moves`, `timeMs`, `runId`, `levelCode`,
`ruleVersion`, `genVersion`. Optional: `taps`, `undos`, `seed`, `clientId`, `appVersion`.

**POST-Antworten:**

```json
201 { "ok":true, "id":4711, "rank":3, "total":138, "duplicate":false, "verified":true }
200 { "ok":true, "id":4711, "rank":3, "total":138, "duplicate":true,  "verified":true }
```

| HTTP | `error` | Anlass |
|---|---|---|
| 400 | `bad_json` | Body nicht parsebar |
| 400 | `validation` | Feld fehlt, falscher Typ, ausserhalb der Grenzen |
| 400 | `implausible` | formal ok, spiellogisch unmoeglich |
| 400 | `name_rejected` | Name nach Filter leer oder auf Blockliste |
| 400 | `version_mismatch` | `ruleVersion`/`genVersion` passt nicht zum Server |
| 405 | `method_not_allowed` | mit `Allow: GET, POST, OPTIONS` |
| 413 | `payload_too_large` | Body > 8192 Byte |
| 429 | `rate_limited` | mit `Retry-After` und `retryAfterSec` |
| 500 | `server_error` | D1-Fehler; Details nur ins Log |

Fehlerhuelle einheitlich: `{ok:false, error, field?, message}`; `message` ist deutsch und direkt
UI-tauglich.

### 9.4 Validierung und Missbrauchsschutz

**Kapazitaetsformeln — MUESSEN mit `buildBoard` uebereinstimmen (Testgegenstand, §10.6):**

```js
export function capacity(dirMode, x, y, z) {          // x=W, y=H, z=D
  return dirMode === 'volumen'
    ? x * y * z
    : 2 * (y - 1) * (x + z - 2) + x * z;              // 4 Waende (H-1 Reihen) + voller Deckel
}
```

Kontrolle: `capacity('fassade',3,3,3) = 2*2*4 + 9 = 25` ✓ (identisch zu §2.3).

**Untere Zugschranke:**

```js
export function minMoves(goalMode, cubes) {
  // ABBAU: jeder Wuerfel muss das Gitter verlassen und bewegt sich nur, wenn er getippt wird
  //        -> moves >= cubes ist beweisbar.
  // BEFREIUNG: nur der gruene Wuerfel muss raus -> beweisbar nur >= 1.
  // NIEMALS ceil(Distanz/2) verwenden: eine Sprungkette traegt in EINEM Zug beliebig weit.
  return goalMode === 'abbau' ? cubes : 1;
}
```

`moves >= par` DARF NICHT verlangt werden — `par` ist nur eine obere Schranke.

Weitere Grenzen: `1 <= cubes <= capacity(...)`; `moves <= 40*cubes + 500`;
`timeMs >= max(300, moves*60)`; `timeMs <= 12 h`; `undos in [0, 100000]`;
`taps.length <= 20000` und jeder Eintrag ein nichtnegativer Integer;
`size.x,z in [3,16]`, `size.y in [2,24]`; `runId`/`clientId` UUID-Form;
`levelCode` gegen `/^[FV]-[AB]-\d+x\d+x\d+-\d{1,2}-[0-9A-F]{8}$/`;
`appVersion` gegen `/^[A-Za-z0-9._-]{1,16}$/`. Unbekannte Felder werden verworfen (Allowlist).

**Serverseitige Verifikation (der eigentliche Anti-Cheat).** Sind `taps` vorhanden und stimmen
`ruleVersion`/`genVersion`, regeneriert der Worker das Level deterministisch aus `levelCode`
(inklusive `attempt`, deshalb keine Bewertungsprobe noetig) und ruft
`replayTaps(level, taps)` aus `src/levels.js` auf. Bedingungen fuer `verified = 1`:
`result.solved === true` und `result.moves === payload.moves` und
`result.timeLowerMs <= payload.timeMs`. Andernfalls wird der Eintrag mit `verified = 0`
gespeichert und in der Bestenliste hinter verifizierten Eintraegen gleicher Zugzahl gefuehrt.
Fehlen `taps`, gilt ebenfalls `verified = 0`.

Weiche Verdachtsbits (nur markieren, nie ablehnen):
`1` `cubes < 0.25*capacity`; `2` `timeMs/moves < 200`; `4` ABBAU und `moves === cubes`;
`8` `undos > 5*moves`.

**Rate-Limit, ausschliesslich mit D1.** IP aus `CF-Connecting-IP`, IPv6 auf `/64` gekuerzt, dann
`HMAC-SHA-256(praefix, env.IP_SALT)`, 16 Hexzeichen. Die Roh-IP wird nie gespeichert. Fehlt
`IP_SALT`, endet jeder POST in `500` — kein stiller Fallback-Salt.

```sql
INSERT INTO rate_limit (bucket, window_start, hits, updated_at)
VALUES (?1, ?2, 1, ?3)
ON CONFLICT(bucket) DO UPDATE SET
  hits = CASE WHEN rate_limit.window_start = excluded.window_start
              THEN rate_limit.hits + 1 ELSE 1 END,
  window_start = excluded.window_start,
  updated_at   = excluded.updated_at
RETURNING hits, window_start;
```

Vier Fenster in einem `env.DB.batch([...])`: `<ip>:m` 60 s / 5 POSTs, `<ip>:h` 1 h / 30,
`<ip>:d` 24 h / 120, `global:m` 60 s / 600. Der Zaehler laeuft **vor** der Validierung und wird
auch von abgelehnten POSTs verbraucht. `Retry-After` = Restsekunden des engsten verletzten
Fensters. Muellabfuhr: mit 2 % Wahrscheinlichkeit je POST in `ctx.waitUntil`
`DELETE FROM rate_limit WHERE updated_at < now - 25h`. GET wird nicht D1-ratenbegrenzt.

**Namensfilter** in dieser Reihenfolge: `normalize('NFKC')` → Steuerzeichen, Zero-Width und
Bidi-Overrides entfernen → Whitespace kollabieren und trimmen → Allowlist
`/^[\p{L}\p{N} _.\-]+$/u` → Laenge 2..16 → `name_key` (kleinschreiben, Leet-Faltung
`4→a 3→e 1→i 0→o 5→s 7→t $→s @→a`, Nicht-Alphanumerisches entfernen) → URL-/Mail-artige Namen
ablehnen → Teilstringtest gegen `name_blocklist` (im Isolate 5 Minuten gecacht). Ein abgelehnter
Name blockiert die Einreichung, statt still umbenannt zu werden. Im DOM wird jeder Name
ausschliesslich per `textContent` gesetzt.

**Idempotenz:** `run_id` ist UNIQUE; bei Kollision `ON CONFLICT DO NOTHING` und Rueckgabe des
bestehenden Datensatzes samt Rang mit `duplicate: true` und HTTP 200.

### 9.5 Worker-Modul-API

```js
// worker/index.js
export default { async fetch(request, env, ctx): Promise<Response> }
// worker/http.js
export function corsHeaders(request, env): Headers          // setzt IMMER Vary: Origin
export function preflight(request, env): Response
export function json(body, status, request, env, extraHeaders?): Response
// worker/api-records.js
export async function handleRecords(request, env, ctx, url): Promise<Response>
// worker/validate.js
export function capacity(dirMode, x, y, z): number
export function minMoves(goalMode, cubes): number
export function parseQuery(searchParams): ParsedQuery | ValidationError
export function validateSubmission(payload): Validated | ValidationError
// worker/names.js
export async function normalizeName(raw, env):
  Promise<{ok:true, name:string, key:string} | {ok:false, message:string}>
// worker/ratelimit.js
export async function hashIp(request, env): Promise<string>
export async function hashText(text, env, hexLen): Promise<string>
export async function checkRateLimit(env, ipHash): Promise<{ok:true}|{ok:false, retryAfterSec:number}>
export function gcRateLimit(env): Promise<D1Result>
```

Routing in `fetch`: `/api/records` → `handleRecords`; `/api/health` → JSON; `/api/*` → 404 JSON;
alles andere → `env.ASSETS.fetch(request)` (expliziter Fallback, damit eine spaetere
Routen-Aenderung nicht die ganze Seite auf 404 setzt).

### 9.6 `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "pfeilspiel",
  "main": "worker/index.js",
  "compatibility_date": "2025-09-15",

  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page",
    "run_worker_first": ["/api/*"]
  },

  "d1_databases": [
    { "binding": "DB",
      "database_name": "pfeilspiel",
      "database_id": "5586dcd4-d715-4130-ba03-dc98fb08cba6",
      "migrations_dir": "migrations" }
  ],

  "vars": { "ALLOWED_ORIGINS": "" },
  "observability": { "enabled": true }
}
```

* **Kein** `run_worker_first: true` (global). Sonst laeuft jeder Asset-Request durch den Worker und
  die Regeln aus `public/_headers` gelten fuer diese Antworten nicht mehr.
* `not_found_handling: "404-page"`, **nicht** `single-page-application`: das Spiel hat keinen
  Client-Router.
* Secret `IP_SALT` im Dashboard unter Settings → Variables and Secrets anlegen, nicht in
  `wrangler.jsonc`.
* `package.json` bekommt `"wrangler": "^4"` als devDependency; Build-Command bleibt leer.

### 9.7 CORS und Caching

* Normalfall ist **kein CORS** (Same-Origin). `ALLOWED_ORIGINS` bleibt leer; nur exakt gelistete
  Origins werden zurueckgeechot, nie `*` bei POST, nie `Allow-Credentials`.
* `Vary: Origin` wird auf **jeder** API-Antwort gesetzt, auch ohne Freigabe.
* `GET /api/records`: `Cache-Control: public, max-age=10, s-maxage=30, stale-while-revalidate=60`,
  zusaetzlich `caches.default` unter einem **kanonisierten** Cache-Key (feste Parameterreihenfolge,
  ausgeschriebene Defaults).
* `POST` und alle Fehlerantworten: `Cache-Control: no-store`. Auf 429 **kein** `s-maxage`.
* Den eigenen Rang sieht der Spieler sofort aus der POST-Antwort, nicht aus einem Nachladen.

`public/_headers`:

```txt
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/vendor/*
  Cache-Control: public, max-age=31536000, immutable
```

`immutable` gilt nur unter `/vendor/` (Pfad enthaelt die Versionsnummer). Fuer `/src/` und
`/styles/` bleibt es ohne Fingerprint bei `public, max-age=0, must-revalidate` plus ETag —
sonst sehen wiederkehrende Spieler nach einem Deploy ein Jahr lang die alte Version.

### 9.8 Einzeldatei-Fassung (`tools/build-artifact.js`)

Neben der Cloudflare-Fassung gibt es eine **zweite Auslieferungsform**: eine einzige,
netzunabhaengige HTML-Datei (`dist/pfeilspiel.html`), erzeugt ueber
`npm run build:artifact` → `node tools/build-artifact.js [ziel.html]`.

* **Das Repository bleibt buildfrei.** Die Zusage aus §9.1 gilt unveraendert: `public/` wird so
  ausgeliefert, wie es dasteht, und laeuft ohne Werkzeug. Kein Modul, kein Stylesheet und keine
  Testdatei DARF eine Verpackung voraussetzen. `tools/build-artifact.js` ist reines
  Verpackungswerkzeug, liest die Quellen nur und schreibt ausschliesslich in sein Ziel. Es DARF NICHT Bestandteil des
  Ladepfads der Cloudflare-Fassung werden.
* **Verfahren:** die drei Stylesheets als `<style>`, der Koerper aus `public/index.html`
  unveraendert; `three` als gekapselte CommonJS-Fassung (`node_modules/three/build/three.cjs`,
  ohne jedes `require`) hinter einer Funktion, die das Objekt `THREE` liefert; `OrbitControls`
  und `RoomEnvironment` von ES-Modul auf denselben Geltungsbereich umgeschrieben
  (`import` → Destrukturierung aus `THREE`); die sieben Spielmodule in
  Abhaengigkeitsreihenfolge verkettet, ihre gegenseitigen Importe entfallen.
* Die Einzeldatei laedt **nichts** nach: keine Importmap, kein `<script src>`, kein
  Stylesheet-Verweis, kein `vendor/`-Pfad, kein CDN. Sie MUSS vollstaendig offline laufen.
* Ein **Namenskonflikt** zwischen zwei Modulen bricht den Bau ab, statt still ein kaputtes
  Buendel zu schreiben. Ebenso ein uebrig gebliebener `import`/`export`.
* Das Werkzeug fuehrt zwei Aufzaehlungen (`MODULE`, `STYLES`) und gleicht sie bei **jedem** Lauf
  gegen `public/src/*.js` und `public/src/styles/*.css` ab. Eine dort neu angelegte Datei, die in
  der Aufzaehlung fehlt — und umgekehrt —, bricht den Bau ab, statt stumm aus dem Erzeugnis zu
  fallen.
* **Keine Server-API.** In der Einzeldatei gibt es `/api/records` nicht. `getScores` und
  `postScore` werden auf eine rein **oertliche Bestenliste** im `localStorage` des Spielers
  umgelenkt (Schluessel `pfeilspiel.bestenliste.oertlich`, hoechstens 500 Zeilen, Sortierung wie
  im Worker: wenige Zuege, dann kuerzere Zeit, dann `id`; `localStorage`-Ausfall im Privatmodus
  bleibt fluechtig statt fehlerhaft). Der Ersatz wird zwischen `api.js` und `main.js` eingesetzt,
  wo er beide Namen ueberschreiben kann. D1, Ratenbegrenzung, Namenspruefung und
  Replay-Verifikation aus §9.2 bis §9.7 gelten ausschliesslich fuer die Cloudflare-Fassung. Eine
  oertliche Liste ist unverifiziert und nicht vergleichbar; sie DARF NICHT als geteilte
  Bestenliste ausgegeben oder in die D1-Tabelle uebernommen werden.
* `dist/` ist gitignoriert; das Erzeugnis wird **nicht** versioniert. Frisch ist es per Definition
  erst nach einem Neubau. Dass ein Neubau jederzeit genau den aktuellen Quellstand liefert, ist
  Testgegenstand (§10.11) — der Test baut dafuer selbst, in ein eigenes Verzeichnis, und liest
  `dist/` nicht an.

---

## 10. Teststrategie

Ausfuehrung: `npm test` → `node --test tests/*.test.js`; gleichwertig `node --test tests/`. Beide
Laufarten MUESSEN **dieselbe Menge** erfassen. Node loest ein Verzeichnis als Positionsargument
von `--test` nicht als Suchraum auf, sondern ueber die Modulaufloesung: `node --test tests/` laedt
genau `tests/index.js` und sonst nichts. Diese Datei DARF deshalb keine Importliste von Hand
fuehren — sie liest ihr eigenes Verzeichnis (`readdirSync`, jede `*.test.js`, sortiert) und
importiert dynamisch. Eine handgefuehrte Liste hat genau eine Fehlerform, und sie ist stumm: eine
neue Testdatei laeuft unter `npm test` mit und unter `node --test tests/` nicht. Die
Deckungsgleichheit beider Wege ist selbst Testgegenstand (§10.11).

Die Tests laufen **ohne Browser und ohne WebGL**, weil `src/game.js` und `src/levels.js` reine
Module sind; alles Weitere wird gegen Attrappen oder gegen den Quelltext geprueft. `tests/e2e.mjs`
(Playwright) traegt bewusst **nicht** die Endung `.test.js` und laeuft separat ueber
`npm run e2e`.

**Der vollstaendige Bestand — jede Datei unter `tests/` ist hier genannt:**

| Datei | Gegenstand | Abschnitt |
|---|---|---|
| `board.test.js` | Geometrie, Schritttabelle, Tiefen | §10.1 |
| `rules.test.js` | Zugregel, RF-1 bis RF-12, Involution | §10.2 |
| `generator.test.js` | Generator, Loesbarkeitsgarantie, Codes | §10.3 |
| `verify.test.js` | Fuzz-Harness und Mutationstest | §10.4 |
| `session.test.js` | Sitzung, Undo, Replay | §10.5 |
| `worker.test.js` | Validierung und Namen, ohne Netzwerk | §10.6 |
| `skins.test.js` | Tokensaetze, Audio, **Kontrastprobe** | §10.7 |
| `css-tokens.test.js` | `tokens.css`, `base.css`, `fx.css` gegen die Skins | §10.7 |
| `smoke.test.js` | Modulschnittstellen aus §4, Durchstich bis zum Sieg | §10.8 |
| `render.test.js` | Zeigerlogik aus §8.7 (Tap, Zittern, Refit) | §10.9 |
| `ui.test.js` | Overlaystapel aus §4.5 | §10.9 |
| `api.test.js` | `src/api.js` gegen `fetch`-Attrappen | §10.10 |
| `worker-api.test.js` | Anfragebearbeitung des Workers gegen D1-Attrappe | §10.10 |
| `bundle.test.js` | Frischepruefung der Einzeldatei, Deckung beider Laufarten | §10.11 |
| `index.js` | Sammeleinstieg, liest das Verzeichnis (keine Testdatei) | — |
| `e2e.mjs` | Playwright, separat ueber `npm run e2e` | §10.12 |

Eine neu angelegte Testdatei MUSS in dieser Tabelle auftauchen; eine hier genannte MUSS
existieren.

### 10.1 `tests/board.test.js` — Geometrie

1. `buildBoard` wirft `RangeError` fuer `W<3`, `D<3`, `H<2` und fuer Dimensionen ueber der
   Obergrenze.
2. Fuer **alle** zulaessigen Dimensionen `W,D in [3,8]`, `H in [2,8]` (beide Modi):
   * `board.C` stimmt mit der Formel `2*W*(H-1) + 2*(D-2)*(H-1) + W*D` bzw. `W*H*D` ueberein;
   * die Kontrollwerte aus §2.3 (25 / 52 / 105 / 52 / 136 / 121) werden namentlich geprueft;
   * alle Gitterkoordinaten `lattice[i]` sind **paarweise eindeutig** (Disjunktheit der
     Wandrechtecke) — als `Set` ueber `x*10000 + y*100 + z`;
   * alle Weltpositionen sind paarweise eindeutig;
   * kein Wert von `lattice` liegt ausserhalb `[0,W)×[0,H)×[0,D)`.
3. `U × V = Nout` fuer alle fuenf FASSADE-Flaechen.
4. Symmetrie: fuer alle `i`, `d` mit `valid[i*6+d] && step[i*6+d] !== OUT` gilt
   `step[step[i*6+d]*6 + opp[d]] === i`.
5. `depthOf` ist 1-Lipschitz: `|depth(i,d) - depth(step[i*6+d], d)| === 1` fuer jeden Schritt im
   Gitter; und `depth(i,d*) === minDepth(i)` faellt entlang `d*` um genau 1.
6. `cellKey`/`cellIndexOf` sind zueinander invers ueber alle Zellen.
7. In FASSADE ist `valid[i*6+4] === 0` und `valid[i*6+5] === 0` fuer alle `i`.

### 10.2 `tests/rules.test.js` — Zugregel

Tabellengetriebene Fixtures, je ein benannter Fall fuer **RF-1 bis RF-12** aus §1.3. Verbindliche
Zusatzfaelle:

1. **Rand vor Belegung:** ein Wuerfel an der Wandkante mit Pfeil zur Kante liefert `EXIT`,
   unabhaengig davon, ob die geometrisch benachbarte Zelle der **Nachbarwand** belegt ist. Zwei
   Fixtures (Nachbarwandzelle leer / belegt) MUESSEN dasselbe `Move` liefern.
2. **Kein Schritt hinter dem Sprung** (RF-6): geplante Kette endet, obwohl das naechste Feld frei
   und im Gitter waere.
3. **Sprung ueber den Rand hinaus** (RF-3) als benannter Testfall — diese Auslegung ist Teil von
   `RULE_VERSION` und darf nicht stillschweigend geaendert werden.
4. **Terminierung:** vollbelegte Reihe mit alternierendem Muster, Kette laeuft maximal
   `ceil(max(W,H,D)/2)` Glieder; ein zusaetzlicher Zaehler im Test bricht bei
   `2*max(W,H,D)` mit Fehler ab.
5. **Sackgasse existiert:** vollbelegtes Gitter mit allen Pfeilen nach innen ergibt
   `legalCells().length === 0` (VOLUMEN 5×5×5 und FASSADE 6×6×6). Damit ist bewiesen, dass die
   Loesbarkeitsgarantie nicht trivial ist.
6. **Involution:** fuer 10 000 zufaellige (seed-gesteuerte) Zustaende und Zuege gilt
   `applyMove` gefolgt von `revertMove` === Identitaet auf `occ`, `cellOf`, `alive`, `aliveCount`.
7. `move.jumped` enthaelt genau die uebersprungenen, besetzten Zellen; `move.path[0] === from`;
   `path.length === jumps + 1` bei `JUMP`, `=== 2` bei `STEP`.
8. `isSolved` fuer beide Zielmodi; `hasAnyMove` konsistent zu `legalCells().length > 0`.

### 10.3 `tests/generator.test.js` — Generator und Garantie

1. **Sechs Regressionsfixtures** fuer die Ausfallarten N1–N6 aus §6.2. Jede konstruiert einen
   Zustand, in dem der naive Kandidat plausibel aussieht, und prueft, dass der Kandidatentest
   (`resolveMove(...).to === b` bzw. `=== OUT`) ihn **verwirft**. Diese sechs Tests sind die
   einzige Absicherung dagegen, dass ein spaeterer Umbau des Generators die Garantie stumm bricht.
2. **Prepend-Semantik:** ein Test, der `ref.push` statt `ref.unshift` simuliert und nachweist,
   dass `verifyLevel` das Ergebnis ablehnt.
3. **Fuellsatz:** `fillByDepth` auf leerem Board fuellt zu **exakt 100 %**
   (`aliveCount === board.C`), fuer alle Dimensionen aus 10.1 und beide Modi; jeder erzeugte
   Referenzzug hat `kind === 'EXIT'`.
4. **Kennzahlen:** je 100 Level pro Modus und Zielmodus — `maxChain <= spec.maxChain`,
   `dichte >= spec.density - 0.02`, ABBAU-Referenz raeumt den Turm restlos ab
   (`aliveCount === 0`), BEFREIUNG-Praefix endet mit dem Austritt des Zielwuerfels.
5. **Backtracking-/Stockungspfad:** ein Test mit erzwungener Sackgasse (Dichte 1.0, `maxChain 1`,
   Silhouettenzwang) MUSS den Fuellrueckfall aus §6.5 ausloesen und trotzdem ein verifiziertes
   Level liefern. Der Pfad darf nicht ungetestet bleiben.
6. **Codes:** `parseLevelCode(encodeLevelCode(spec))` ist die Identitaet auf allen Feldern, die den
   Levelinhalt bestimmen (`mode, goal, W, H, D, attempt, seed`); `parseHash(encodeHash(spec))`
   ebenso. `attempt` ist im Code enthalten.
7. **Determinismus:** derselbe Seed erzeugt bitgleiche Level (Vergleich ueber
   `JSON.stringify(level)`), auch nach einem Zwischenlauf mit anderem Seed. Ein Grep-Test ueber
   `src/game.js` und `src/levels.js` verbietet `Math.random`, `Date.`, `performance.`,
   `document`, `window`, `three`.
8. **MAX_CUBES:** `levelSpecFor(n)` erzeugt fuer `n in [1, 500]` nie ein Level mit mehr als 1200
   Wuerfeln und nie eine Groesse ueber dem Deckel aus §6.11.

### 10.4 `tests/verify.test.js` — Fuzz-Harness (die zentrale Garantiepruefung)

```
fuer seed in 0 .. 9999:
  fuer mode in {FASSADE, VOLUMEN}:
    fuer goal in {ABBAU, BEFREIUNG}:
      fuer dims in {3x3x3, 4x5x4, 5x6x5}:
         level = generateLevel(spec)
         assert verifyLevel(level).ok === true
         protokolliere dichte, par/N, chainShare, maxChain
```

`verifyLevel().ok` MUSS in **allen 120 000 Faellen** `true` liefern. Der Fuellgrad wird als
Kennzahl **getrackt und als Untergrenze fixiert** (nicht nur behauptet): Median `>= spec.density`,
Minimum `>= spec.density - 0.05`. Der Lauf ist als `npm run test:fuzz` separat ausfuehrbar
(Laufzeit im Minutenbereich) und laeuft in CI nightly; `npm test` fuehrt eine verkleinerte
Variante mit 500 Seeds aus.

Zusaetzlich: **Mutationstest.** Fuenf gezielte Verfaelschungen eines gueltigen Levels
(Zellindex verschoben, Richtung geaendert, `witness`-Eintrag getauscht, `par` verfaelscht,
`targetId` geaendert) MUESSEN von `verifyLevel` abgelehnt werden. Das beweist, dass die Pruefung
tatsaechlich auf der serialisierten Beschreibung arbeitet und nicht auf dem Generatorzustand.

### 10.5 `tests/session.test.js` — Sitzung, Undo, Replay

1. `tap` erhoeht `moves` nur bei `kind !== 'INVALID'`; `taps` enthaelt auch ungueltige Tipps.
2. Vollstaendiges Undo: `witness` abspielen, dann alle Zuege zuruecknehmen → `state` ist
   feldweise identisch mit dem Startzustand aus `createState(board, level.cubes, goal)`;
   `moves === 0`, `clockMs` zurueckgedreht.
3. `restart` stellt den Startzustand her; `undos` bleibt erhalten.
4. `replayTaps(level, level.witness)` liefert `{ok:true, solved:true, moves:par, invalid:0}`.
5. `replayTaps` mit eingestreuten ungueltigen Tipps zaehlt `invalid` korrekt hoch und aendert
   `moves` nicht.
6. `replayTaps` mit einer manipulierten Zugliste (`moves` kleiner als `par`) liefert
   `solved:false` — das ist der serverseitige Anti-Cheat-Test.

### 10.6 `tests/worker.test.js` — Validierung ohne Netzwerk

1. `capacity('fassade',W,H,D)` stimmt fuer alle Dimensionen aus 10.1 **exakt** mit
   `buildBoard({mode:'FASSADE',W,H,D}).C` ueberein; ebenso `capacity('volumen',...)` mit `W*H*D`.
   Divergenz wuerde gueltige Einreichungen als `implausible` ablehnen.
2. `minMoves('abbau', n) === n`, `minMoves('befreiung', n) === 1`. Ein expliziter Negativtest
   stellt sicher, dass **nirgends** eine Distanzschranke (`ceil(Distanz/2)`) eingebaut ist.
3. `validateSubmission` akzeptiert einen gueltigen Payload und lehnt je einen Payload pro
   Fehlerklasse ab (fehlendes Feld, falscher Typ, `moves < cubes` bei ABBAU, `moves > 40*cubes+500`,
   `timeMs < moves*60`, Groesse ausserhalb, kaputter `levelCode`, falsche `ruleVersion`).
4. `normalizeName`: NFKC-Normalisierung, Zero-Width-Entfernung, Leet-Faltung, Blocklistentreffer,
   URL-/Mail-Ablehnung, Laengengrenzen, Umlaute erlaubt, Emoji abgelehnt.
5. `parseQuery` lehnt unbekannte und ungueltige Parameter mit `400` ab, statt zu clampen.

### 10.7 `tests/skins.test.js` und `tests/css-tokens.test.js`

1. Alle drei Skins haben **identische Schluesselmengen** in `css`, `three`, `three.atlas`,
   `motion`, `audio.events` und `fx`; der CSS-Schluesselsatz aus §7.2 ist vollstaendig besetzt.
2. Alle Farbwerte matchen `#rgb|#rrggbb|rgba(...)` bzw. sind bei `three` ganzzahlige Hexzahlen.
3. Jeder `ease`-Name existiert in der `EASING`-Registry; jeder `AudioEvent` ist in allen drei
   Skins definiert.
4. `src/styles/base.css` enthaelt **keine** Hexfarbe (`/#[0-9a-fA-F]{3,8}\b/`) und keinen
   literalen `px`-Radius ausserhalb von `var()`. Dieser Grep-Test steht ab dem ersten Commit.
5. `fx.canvasFilter` enthaelt ausschliesslich `saturate`/`contrast`, nie `drop-shadow` oder `blur`.
6. **Kontrastprobe zu §7.1.** Nicht ein einzelnes Token wird geprueft, sondern **jedes**
   Text-auf-Hintergrund-Paar, das `base.css` bildet, in **allen drei** Skins: `--ps-fg` und
   `--ps-fg-muted` auf Seitengrund, Glaspanel, Knopfflaeche und `--ps-accent-soft`;
   `--ps-success` und `--ps-danger` auf dem Glaspanel; `--ps-accent-fg` auf `--ps-accent` und
   `--ps-accent-2`; `--ps-btn-fg` auf `--ps-btn-bg` und `--ps-btn-bg-hover`. Halbdeckende
   Flaechen werden alphakompositiert, Glasgruende ueber `--ps-bg` **und** `--ps-bg-2` gerechnet.
   Jedes Paar MUSS `>= 4,5:1` halten. Ein eigener Test haelt fest, dass die Paarliste die in
   `base.css` vorkommenden Kombinationen vollstaendig abdeckt — sonst verkaeme die Probe still zu
   einer Teilpruefung.
7. **Regression gegen die behobenen Altwerte.** Jeder frueher ausgelieferte Wert
   (`--ps-success` `#30D158`, `--ps-danger` `#FF3B30`, `--ps-accent` `#0A84FF`,
   `--ps-accent-2` `#5AC8FA`) wird einzeln in eine Kopie der Apple-Tokens gesetzt; die Probe MUSS
   ihn namentlich beanstanden. Damit kann kein Skin-Umbau die Kontrastkorrektur stumm
   zurueckdrehen.
8. Die Kontrasthilfen selbst (Alphakompositierung, Leuchtdichte, Verhaeltnis) werden gegen
   bekannte WCAG-2.1-Werte geprueft (Schwarz auf Weiss = 21:1, Farbe auf sich selbst = 1:1).

### 10.8 `tests/smoke.test.js` — Modulschnittstellen und Durchstich

1. Jedes Modul exportiert die in §4.1 bis §4.7 zugesagten Namen. `game.js` und `levels.js` werden
   echt importiert (reine Module), die uebrigen fuenf gegen ihren Quelltext geprueft, damit der
   Test ohne Browser laeuft.
2. Jeder benannte Import in `main.js` existiert im Zielmodul; `main.js` ruft `boot()` selbst auf
   und geht ueber den Pflichtpfad aus §0.5 (`verifyLevel` im Produktivcode).
3. Durchstich ohne Browser: `levelSpecFor` → `buildBoard` → `generateLevel` → `verifyLevel` →
   `createSession` → `tap` … bis zum Sieg, je einmal fuer beide Richtungs- und beide Zielmodi.

### 10.9 `tests/render.test.js` und `tests/ui.test.js` — Eingabe und Overlaystapel

`render.test.js` prueft ausschliesslich `createPointerInput` (§8.7) gegen einen winzigen
Ereignisverteiler, eine `OrbitControls`-Attrappe und eine einzige antippbare Zelle. Laesst sich
`three` nicht aufloesen, meldet sich die Datei als **uebersprungen**, nicht als rot.

1. Sauberer Tap ohne Kamerabewegung loest `onTap` aus.
2. Wischen ueber die Touch-Schwelle loest keinen Tap aus.
3. Fingerzittern **unter** der halben Schwelle ueberlebt den Daempfungsnachlauf — der Fall, den
   die Zittertoleranz aus §8.7 rettet.
4. Ein Tap waehrend eines programmatischen Refits (`controls.enabled === false`, `change` in
   jedem Bild) wird **nicht** verworfen.
5. Bewusstes Schieben im Band zwischen halber und ganzer Schwelle wird bei frischer
   Kamerabewegung verworfen — und ohne Kamerabewegung eben nicht.

`ui.test.js` prueft die Overlaysteuerung aus §4.5 gegen ein minimales DOM-Modell (genau die
Knoten und Methoden, die `createUI` benutzt), ohne Playwright:

1. Sieg → Bestenliste → schliessen: der Siegdialog kommt samt Fokus zurueck.
2. Nach diesem Umweg ist das Eintragen weiterhin moeglich (kein zerstoerter Dialogzustand).
3. Die Bestenliste allein gibt den Fokus an ihren Ausloeser zurueck.
4. `hideWin` waehrend der Bestenliste kappt den Rueckweg: der Siegdialog kehrt nicht wieder.
5. Die Sackgasse ueberlebt einen Blick in die Bestenliste unveraendert.
6. Zweimal dasselbe Overlay oeffnen legt keinen Kreis im Stapel an.

### 10.10 `tests/api.test.js` und `tests/worker-api.test.js` — Anfragebearbeitung

Beide Dateien laufen **ohne Netzwerk, ohne `wrangler` und ohne neue Abhaengigkeit**, gegen
Attrappen, die im Test selbst stehen.

`worker-api.test.js` deckt `worker/index.js` und `worker/api-records.js` ab. Die D1-Attrappe
schreibt jede abgesetzte SQL-Zeichenkette samt Bindungen mit; dazu kommen eine `ASSETS`-Attrappe
und ein `caches.default`-Ersatz, der nur fuer den Cache-Test gestellt wird.

1. Die JSON-Form aus §9.3 samt `Cache-Control`; `limit`/`offset` als **Bindungen**, Rang als
   `offset+i+1`; Filter `dir`/`goal`/`size`; `bestPerName` ueber `ROW_NUMBER() OVER (PARTITION BY
   name_key)`.
2. `400 validation` mit Feldnamen **ohne jeden D1-Zugriff**; `HEAD` wie `GET`; `405` mit `Allow`;
   `OPTIONS` als `204`; Origin-Echo nur fuer gelistete Origins, `Vary: Origin` immer (§9.7).
3. Der Kantenspeicher: kanonisierter Schluessel, Treffer ohne D1-Zugriff.
4. Ein gueltiger POST als `201` mit allen 24 INSERT-Bindungen in der richtigen Reihenfolge —
   einschliesslich des Nachweises, dass **nur** der gehashte, nie der rohe IP-Wert gespeichert
   wird. Idempotenz: derselbe `runId` liefert `200`, `duplicate:true` und dieselbe `id`.
5. Fehlerpfade als saubere Antworten statt als `500`: kaputtes JSON, leerer Rumpf, Array, `null`;
   `413` per `Content-Length` **und** per Messung; `429` mit `Retry-After` und `retryAfterSec`;
   fehlendes `IP_SALT` als verstaendliche `500`, die den Namen des Geheimnisses nicht nennt und
   nichts schreibt; D1-Ausnahmen ohne Innenansicht im Klartext.
6. **SQL-Hygiene** ueber alle in einem Durchlauf beobachteten Befehle: kein Nutzerwert (Name,
   `runId`, `clientId`, `levelCode`, Modi, Groesse, IP) steht als Text im SQL, und die Zahl der
   Platzhalter stimmt in jedem Befehl exakt mit der Zahl der Bindungen ueberein.

`api.test.js` deckt `public/src/api.js` gegen `fetch`-, `navigator`-, `localStorage`- und
`crypto`-Attrappen ab: feste Parameterreihenfolge der Abfragezeichenkette; die vollstaendige
Fehlerabbildung (Fehlercode des Servers schlaegt HTTP-Status, `ok:false` ist auch bei `200` ein
Fehler); `retryAfterSec` aus Rumpf vor Kopfzeile; `network`, `timeout`, `aborted`, `offline`,
`unsupported`; die Allowlist von `postScore` samt Opfern der Tippfolge bei zu grossem Rumpf;
`newUuid` mit und ohne `crypto.randomUUID`; die `localStorage`-Kapselung von `clientId()` in
fuenf Faellen. Jeder Fehlerfall MUSS eine vollstaendige Huelle mit nichtleerem deutschem
Klartext tragen.

### 10.11 `tests/bundle.test.js` — Frischepruefung der Einzeldatei

Zwei Dinge koennen still veralten, ohne dass ein anderer Test es merkt: das gitignorierte
Erzeugnis aus §9.8 und der Testlauf selbst.

1. Der Test **baut im Testlauf selbst** — `tools/build-artifact.js` in ein frisches Verzeichnis
   unter `os.tmpdir()`, ohne Netz. Er liest `dist/` **nicht** und schreibt nicht dorthin: er
   sichert nicht die Frische einer fremden Datei zu, sondern dass ein Neubau jederzeit den
   aktuellen Quellstand liefert.
2. Das Erzeugnis traegt keine unaufgeloeste `import`-/`export`-Zeile und kein CSS-`@import`;
   `three` steckt eingebettet (`THREE`-Kapsel, `OrbitControls`, `RoomEnvironment`, kein
   `require`); es wird nichts nachgeladen (kein Skriptverweis, keine Importmap, kein
   `vendor/`-Pfad).
3. Alle sieben Spielmodule sind eingesetzt, die Modulmenge deckt sich **exakt** mit
   `public/src/*.js`, `main.js` steht am Ende, und die oertliche Bestenliste steht zwischen
   `api.js` und `main.js`, wo sie ueberhaupt wirken kann.
4. **Zeilenweise Frischepruefung** ueber alle zehn Dateien unter `public/src/` (sieben Module,
   drei Stylesheets) und den Koerper aus `public/index.html`: jede nicht triviale Quellzeile MUSS
   sich — unter Nachvollzug der Umschreibungen des Werkzeugs — im Erzeugnis wiederfinden. Eine
   Negativprobe verbiegt eine einzige Zeile und verlangt, dass die Pruefung anschlaegt.
5. **Deckung beider Laufarten:** `tests/index.js` MUSS sein Verzeichnis lesen und DARF KEINE
   einzelnen `import './x.test.js'`-Zeilen fuehren; `package.json` → `scripts.test` MUSS das
   ganze Testverzeichnis erfassen. Damit kann keine Testdatei aus einem der beiden Wege fallen.

### 10.12 `tests/pieces.test.js` — Rutschen und zweizellige Steine

Deckt genau die beiden Erweiterungen ab, die `RULE_VERSION = 2` ausmachen. Pflichtgegenstaende:

1. **R0** — freie Bahn ergibt `EXIT` mit `jumps === 0`; `path` nennt jede durchlaufene Zelle,
   die Startzelle eingeschlossen, und endet am Rand.
2. **Vorrang von R0 vor R1** — ein Blocker an jeder Position der Bahn erzwingt `STEP` um genau
   ein Feld, ein freier Rest erzwingt den Austritt.
3. **RF-6 bleibt in Kraft** — hinter einem Sprung wird nicht weitergerutscht.
4. **Belegung** — ein 2x1-Stein steht in beiden Zellen, zaehlt als EIN lebender Stein,
   `dropCube` raeumt beide Zellen.
5. **Abwehr** — `addCube` wirft, wenn die zweite Zelle ausserhalb oder belegt ist;
   `verifyLevel` lehnt einen Stein mit falschem (groesserem) Anker und eine doppelt belegte
   Zelle ab.
6. **Bewegung** — laengs der eigenen Achse (der Stein darf sich nicht selbst blockieren), quer
   dazu (beide Zielfelder noetig), Sprung, Kette und Ungueltig.
7. **RF-13** — ueber mindestens 200 zufaellige Zuege bleibt `extOf` unveraendert und die
   beiden Zellen bleiben benachbart.
8. **Umkehrbarkeit** — `applyMove` gefolgt von `revertMove` ist ueber mindestens 500 Zuege mit
   gemischten Steinformen feldweise die Identitaet.
9. **FASSADE** — kein 2x1-Stein liegt ueber zwei Waenden; der Anker ist stets die kleinere Zelle.
10. **Generator** — die Level der Kurve enthalten tatsaechlich 2x1-Steine und sind verifiziert.

### 10.13 `tests/e2e.mjs` — Playwright

1. Level laden, `witness` per JS-Bridge abspielen, Sieg-Overlay erscheint, Zugzaehler `=== par`.
2. Tippen gegen Ziehen: ein simulierter Drag von 40 px loest **keinen** Zug aus; ein Tap
   (< 5 px, < 600 ms) loest genau einen aus; ein Zwei-Finger-Pinch loest keinen aus.
3. Undo, Neustart, Sackgassen-Overlay.
4. Skinwechsel 50-fach; danach liegen `renderer.info.memory.textures` und `.geometries` innerhalb
   einer Toleranz von ±2 zum Startwert (Leak-Test fuer §7.7).
5. Roentgen-Longpress und Schichtenregler: ausgeblendete Wuerfel sind nicht klickbar.
6. Je ein Referenz-Screenshot pro Skin und Modus.
7. `?debug=arrows`: Turm mit allen sechs Richtungen; visuelle Referenz fuer die
   UV-Drehrichtung (§8.5).

### 10.13 Abnahmekriterien

Ein Release ist abnahmefaehig, wenn:

* `npm test` gruen ist,
* `npm run test:fuzz` (10 000 Seeds × 2 Modi × 2 Zielmodi × 3 Groessen) `verifyLevel().ok === true`
  in **100 %** der Faelle liefert,
* der Mutationstest aus §10.4 alle fuenf Verfaelschungen ablehnt,
* `capacity()` im Worker und `buildBoard().C` fuer alle Dimensionen uebereinstimmen,
* die Kontrastprobe aus §10.7 fuer alle drei Skins ohne Beanstandung durchlaeuft und die
  Regression gegen die behobenen Altwerte anschlaegt,
* `npm run build:artifact` durchlaeuft und die Frischepruefung aus §10.11 gruen ist,
* der Leak-Test aus §10.12 besteht,
* die visuelle Pfeilkontrolle unter `?debug=arrows` in beiden Modi korrekt ist.

---

## 11. Anhang: RNG und Versionierung

```js
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rng) {          // Fisher-Yates, in-place
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
```

`RULE_VERSION` wird erhoeht, sobald sich das Verhalten von `resolveMove` aendert — insbesondere
bei einer Aenderung der Auslegung RF-3 („Sprung ueber den Rand hinaus“). `GEN_VERSION` wird
erhoeht, sobald sich `generateLevel`, `levelSpecFor`, die Gewichte oder die Baender aendern. Beide
Versionen stehen in `Level`, im `levelCode`-Umfeld (URL-Hash) und in jeder Bestenlistenzeile.
Ohne sie werden geteilte Levelcodes stumm zu anderen Leveln und Altscores stumm unverifizierbar.
