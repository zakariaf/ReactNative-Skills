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
) STRICT;
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms) VALUES (1, 1, 'Water the plants', 1, 1790000120000);
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms) VALUES (2, 1, 'Call the plumber about the kitchen''s tap', 0, 1790000180000);
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms) VALUES (3, 1, 'شراء الحليب', 0, 1790000240000);
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms) VALUES (4, 2, 'Send the report 📊', 0, 1790000300000);
INSERT INTO tasks (id, list_id, title, is_done, created_at_ms) VALUES (5, 2, 'Plan the offsite', 0, 1790000660000);
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
CREATE TABLE document_slots (
  slot           TEXT    PRIMARY KEY NOT NULL CHECK (slot IN ('current', 'backup')),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  app_version    TEXT    NOT NULL,
  written_at_ms  INTEGER NOT NULL,
  write_count    INTEGER NOT NULL,
  checksum       TEXT    NOT NULL,
  payload        TEXT    NOT NULL
) STRICT;
INSERT INTO document_slots (slot, schema_version, app_version, written_at_ms, write_count, checksum, payload) VALUES ('current', 1, '1.1.0', 1790000600000, 7, 'f98df6f5', '{"schemaVersion":1,"appId":"tasks-app","settings":{"theme":"dark","language":"ar","reminderHour":7,"soundEnabled":false,"reduceMotion":"on"},"onboarding":{"completed":true,"seenTips":["swipe-to-complete","lists-in-sidebar"]},"stats":{"tasksCompleted":412,"streak":{"lastDate":"2026-09-30","length":12},"bestStreak":40,"days":{"2026-09-28":5,"2026-09-29":3,"2026-09-30":7}},"premium":{"owned":true,"ownedSinceMs":1788000000000,"lastCheckedAtMs":1790000000000,"revokedAtMs":null}}');
INSERT INTO document_slots (slot, schema_version, app_version, written_at_ms, write_count, checksum, payload) VALUES ('backup', 1, '1.1.0', 1790000540000, 6, 'f98df6f5', '{"schemaVersion":1,"appId":"tasks-app","settings":{"theme":"dark","language":"ar","reminderHour":7,"soundEnabled":false,"reduceMotion":"on"},"onboarding":{"completed":true,"seenTips":["swipe-to-complete","lists-in-sidebar"]},"stats":{"tasksCompleted":412,"streak":{"lastDate":"2026-09-30","length":12},"bestStreak":40,"days":{"2026-09-28":5,"2026-09-29":3,"2026-09-30":7}},"premium":{"owned":true,"ownedSinceMs":1788000000000,"lastCheckedAtMs":1790000000000,"revokedAtMs":null}}');
CREATE TABLE document_quarantine (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  quarantined_at_ms INTEGER NOT NULL,
  slot           TEXT    NOT NULL,
  reason         TEXT    NOT NULL,
  schema_version INTEGER,
  payload        TEXT
) STRICT;
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence (name, seq) VALUES ('error_log', 2);
CREATE INDEX tasks_by_list ON tasks (list_id, id);
PRAGMA user_version = 2;
COMMIT;
