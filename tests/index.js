// Sammeleinstieg fuer `node --test tests/`.
//
// Node 22.22 loest ein Verzeichnis als Positionsargument von `--test` ueber die
// Modulaufloesung auf und bricht ohne Einstiegsdatei mit MODULE_NOT_FOUND ab
// (nachvollziehbar auch in einem leeren Projekt). Diese Datei ist genau dieser
// Einstieg: sie laedt alle Testdateien, damit der in SPEC §10 genannte Aufruf
// funktioniert. `node --test tests/*.test.js` laeuft unveraendert daneben und
// laesst diese Datei ungenutzt.

import './board.test.js';
import './rules.test.js';
import './generator.test.js';
import './verify.test.js';
import './session.test.js';
import './skins.test.js';
import './css-tokens.test.js';
import './worker.test.js';
import './smoke.test.js';
