-- src/data/migrations/fixtures/db-v2.sql: a database written by version 2 of the app. Frozen: never edit it; its checksum is in fixture-checksums.ts.
PRAGMA foreign_keys = OFF;
PRAGMA journal_mode = WAL;
BEGIN;
CREATE TABLE lists (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at_ms INTEGER NOT NULL
) STRICT;
INSERT INTO lists (id, name, created_at_ms) VALUES (1, 'Home', 1790000000000);
INSERT INTO lists (id, name, created_at_ms) VALUES (2, 'Work', 1790000060000);
CREATE TABLE tasks (
  id            INTEGER PRIMARY KEY,
  list_id       INTEGER NOT NULL REFERENCES lists (id),
  title         TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  is_done       INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  created_at_ms INTEGER NOT NULL
, due_on TEXT
  CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')) STRICT;
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms, due_on) VALUES (1, 1, 'Water the plants', 1, 1790000120000, NULL);
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms, due_on) VALUES (2, 1, 'Call the plumber about the kitchen''s tap', 0, 1790000180000, '2026-10-05');
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms, due_on) VALUES (3, 1, 'شراء الحليب', 0, 1790000240000, NULL);
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms, due_on) VALUES (4, 2, 'Send the report 📊', 0, 1790000300000, NULL);
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms, due_on) VALUES (5, 2, 'Book the venue', 0, 1790000700000, '2026-10-12');
CREATE TABLE entitlements (
  product        TEXT    PRIMARY KEY NOT NULL,
  is_owned       INTEGER NOT NULL CHECK (is_owned IN (0, 1)),
  owned_since_ms INTEGER,
  revoked_at_ms  INTEGER
) STRICT;
INSERT INTO entitlements (product, is_owned, owned_since_ms, revoked_at_ms) VALUES ('premium', 1, 1790000360000, NULL);
CREATE TABLE error_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms   INTEGER NOT NULL,
  area    TEXT    NOT NULL,
  message TEXT    NOT NULL,
  details TEXT
) STRICT;
INSERT INTO error_log (id, at_ms, area, message, details) VALUES (1, 1790000420000, 'network', 'request timed out', NULL);
INSERT INTO error_log (id, at_ms, area, message, details) VALUES (2, 1790000480000, 'storage', 'unreadable tasks row: is_done', NULL);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence (name, seq) VALUES ('error_log', 2);
CREATE INDEX tasks_by_list ON tasks (list_id, id);
CREATE INDEX tasks_by_due_date ON tasks (due_on) WHERE due_on IS NOT NULL;
PRAGMA user_version = 2;
COMMIT;
