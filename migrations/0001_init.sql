-- Pfeilspiel D1-Schema (SPEC §9.2). Laeuft unveraendert auf einer frischen D1-Datenbank.

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
