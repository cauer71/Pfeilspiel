# Pfeilspiel

Ein dreidimensionales Denkspiel im Browser: ein Turm aus weißen Steinen, jeder mit einem
schwarzen Pfeil. Ein Tipp schickt den Stein in seine Pfeilrichtung aus dem Turm — aber nur,
wenn seine Bahn frei ist. Steht irgendwo davor ein anderer Stein, passiert nichts. Neben
einzelnen Würfeln gibt es längliche Steine, die zwei Felder belegen. Der Turm lässt sich frei
drehen und zoomen.

Kein Build-Schritt, keine Laufzeitabhängigkeiten, reines ES-Modul-JavaScript.
Three.js liegt selbst gehostet im Repository.

---

## Spielregeln

Ein **Stein** belegt ein Feld (1×1) oder zwei benachbarte Felder (2×1) und trägt genau eine
feste Richtung `d`. Er bewegt sich immer als Ganzes.

| | Regel |
|---|---|
| **Austritt** | Die Bahn in Pfeilrichtung ist bis zum Rand frei → der Stein verlässt den Turm ganz, in genau einem Zug. |
| **Ungültig** | Steht irgendwo auf dieser Bahn ein anderer Stein → nichts passiert, der Stein wackelt nur und der Blockierer blitzt rot auf. |

**Es gibt weder Schritt noch Sprung.** Ein blockierter Stein bleibt blockiert, bis sein
Blockierer selbst gegangen ist — genau darin besteht das Spiel.

Ein 2×1-Stein braucht seine **ganze Bahn auf beiden Spuren** frei und blockiert entsprechend
zwei Felder. Längs seiner eigenen Achse steht er sich nicht selbst im Weg.

Es gibt **keine Schwerkraft**: verbleibende Steine schweben an Ort und Stelle.
Ein Zug entfernt genau einen Stein, alle anderen bleiben unberührt — deshalb ist Rückgängig
exakt invers und beliebig tief.

Weil ein Austritt nur Felder freiräumt und nie eines belegt, kann ein Stein, der einmal ziehen
konnte, das immer noch. Ein lösbares Level lässt sich also nicht durch eine ungeschickte
Reihenfolge verderben. Die Schwierigkeit liegt im **Finden**: einem Pfeil ist im dichten Turm
nicht anzusehen, ob seine Bahn frei ist — erst recht nicht im Modus *Volumen*, wo Pfeile ins
Innere zeigen.

### Richtungsmodi

* **Fassade** — der Turm ist eine hohle Schale aus vier Seitenwänden und einem Deckel.
  Der Pfeil zeigt in der Ebene seiner Wand (vier Richtungen), am Wandrand fällt der Würfel
  heraus. Ein Würfel einer Nachbarwand existiert für die Regel nicht: er blockiert nicht
  und wird nicht übersprungen.
* **Volumen** — massiver Quader, sechs echte Raumrichtungen. Pfeile zeigen auch ins Innere.

### Zielmodi

* **Abbau** — alle Steine müssen heraus.
* **Befreiung** — nur der grüne Zielstein muss heraus, der Restturm bleibt stehen.

### Levels

Levels werden prozedural erzeugt und sind **garantiert lösbar**: Der Generator baut rückwärts
und lässt jeden Rückwärtsschritt sofort von derselben Zugregel bestätigen, die auch im Spiel
urteilt. Vor der Ausgabe wird das fertige Level zusätzlich aus seiner *serialisierten* Form neu
aufgebaut und die Referenzlösung Zug für Zug nachgespielt (`verifyLevel`). Das läuft nicht nur
im Test, sondern bei jeder Levelerzeugung im Spiel.

Die Garantie gilt ab dem Startzustand. Wer sich festfährt, bekommt ein Overlay mit
*Rückgängig* und *Neustart* — automatisch zurückgesetzt wird nie.

Die Levelkurve wächst vor allem in der **Höhe** (3×4×3 bis 6×16×6): Das trifft die Silhouette
eines Turms und lässt die Zugzahl linear statt kubisch wachsen.

---

## Skins

Drei Erscheinungsbilder, zur Laufzeit umschaltbar. Jeder Skin ändert beide Ebenen — die
Oberfläche über CSS-Custom-Properties und das 3D-Bild über Material, Licht, Hintergrund,
Pfeilzeichnung, Animationskurven und Klang.

* **Modern** — dunkel, mattweiße Würfel, weiche Schatten, eine dezente Akzentfarbe.
* **Apple** — hell und luftig, Glassmorphism mit Backdrop-Blur, weiche Rundungen, Systemschrift.
* **Arcade** — CRT-Vintage: Scanlines, Neon-Glow, harte Kanten, Screenshake, Chiptune-Beeps.

---

## Lokal starten

```bash
npm install          # nur für die Tests (Playwright)
npm run serve        # http://localhost:8787
```

`tools/serve.js` liefert `public/` aus und hält eine flüchtige Bestenliste unter
`/api/records` bereit, damit sich das Spiel ohne Cloudflare vollständig testen lässt.

## Tests

```bash
npm test             # 217 Node-Tests: Geometrie, Zugregel, Generator, Verifikation,
                     # Sitzung, Zeigereingabe, Overlays, Skins samt Kontrastproben,
                     # Worker-Validierung und -Anfragebearbeitung, API-Klient,
                     # Einzeldatei-Frischeprüfung, Rauchtest
npm run e2e          # 31 Prüfungen im echten Browser (Playwright + Chromium)
```

Der E2E-Lauf legt Bildschirmfotos aller drei Skins und beider Modi unter `test-results/` ab.

## Einzeldatei-Fassung

```bash
npm run build:artifact
```

Erzeugt `dist/pfeilspiel.html` — das komplette Spiel in einer netzunabhängigen HTML-Datei
(Three.js eingebettet). Diese Fassung hat keine Server-API und führt die Bestenliste
örtlich im Browser des Spielers.

---

## Cloudflare

Das Spiel läuft als Cloudflare Worker: der Worker beantwortet `/api/*` selbst, alles andere
kommt als Static Asset aus `public/`. Die Bestenliste liegt in D1.

**Bereits eingerichtet:**

* D1-Datenbank `pfeilspiel` (`5586dcd4-d715-4130-ba03-dc98fb08cba6`, Region WEUR),
  Schema aus `migrations/0001_init.sql` ist angewendet — Tabellen `records`, `rate_limit`,
  `name_blocklist` samt Indizes stehen.
* `wrangler.jsonc` mit Asset-Binding, D1-Binding und `run_worker_first` für `/api/*`.

**Noch zu tun (einmalig, im Dashboard):**

1. **Workers → Create → Connect Git** und dieses Repository verbinden. Build-Command bleibt
   leer, Deploy-Command `npx wrangler deploy`. Danach deployt Cloudflare bei jedem Push.
2. **Settings → Variables and Secrets:** Secret `IP_SALT` anlegen (beliebige lange
   Zufallszeichenkette). Der Worker speichert IP-Adressen ausschließlich als gesalzenen
   Hash — ohne dieses Secret lehnt er Einträge ab.

Alternativ mit lokalem Wrangler und eigenem API-Token:

```bash
npx wrangler deploy
npx wrangler secret put IP_SALT
```

### Bestenliste

`GET /api/records?dir=…&goal=…&size=…&limit=…` liefert die Top-Einträge,
`POST /api/records` nimmt einen Lauf entgegen. Ohne Login, nur mit frei gewähltem Namen.

Der Worker prüft serverseitig: Feldtypen und Wertebereiche, Kapazitätsgrenze der Turmgröße,
Zugzahl-Untergrenze, Namensfilter, Idempotenz über `run_id` und ein Rate-Limit pro IP-Hash.
Die eingereichte Tippfolge wird mit **derselben** Regelimplementierung nachgespielt, die auch
im Browser läuft (`replayTaps` aus `public/src/levels.js`) — nur ein Lauf, der dabei
tatsächlich zum Sieg führt, wird als `verified` markiert.

---

## Aufbau

```
public/index.html              Importmap, Canvas, HUD-Gerüst, CRT-Overlay
public/src/game.js             Board, Zugregel, Zustand      (rein: kein DOM, kein three)
public/src/levels.js           Generator, Verifikation, Replay (rein)
public/src/render.js           Three.js-Schicht, Pfeilatlas, Animationen, Picking, Orbit
public/src/skins.js            Skin-Tokens und ihre Anwendung
public/src/ui.js               HUD, Overlays, alle deutschen Texte
public/src/api.js              Bestenlisten-Client
public/src/main.js             Bootstrap und Verdrahtung
public/vendor/three/0.185.1/   selbst gehostetes Three.js
worker/                        Worker-Entry und Hilfsmodule
migrations/0001_init.sql       D1-Schema
tools/serve.js                 Entwicklungsserver
tools/build-artifact.js        Einzeldatei-Bau
tests/                         Node-Tests und der Playwright-Lauf
SPEC.md                        verbindliche technische Spezifikation
```

`game.js` und `levels.js` referenzieren weder `three` noch `document`, `window`, `Date` oder
`Math.random` — sie laufen unverändert in Node und im Worker. Es gibt genau **eine**
Regelimplementierung: `resolveMove` in `game.js`. Spiel, Generator, Verifikation, Tests und
Worker benutzen dieselbe Funktion; alles andere würde die Lösbarkeitsgarantie stillschweigend
brechen.

Zufall kommt ausschließlich aus `mulberry32(seed)`. Jedes Level ist damit aus seinem Levelcode
bitgleich reproduzierbar — auch im Worker, der einen eingereichten Lauf nachprüfen muss.

---

## Lizenz

Three.js steht unter der MIT-Lizenz (siehe `public/vendor/three/0.185.1/`).
