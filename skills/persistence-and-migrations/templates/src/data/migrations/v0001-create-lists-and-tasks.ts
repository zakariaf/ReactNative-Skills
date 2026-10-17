// src/data/migrations/v0001-create-lists-and-tasks.ts: version 1 of the app database. Frozen once it ships.
import type { Migration } from '@/data/migrations/migration-runner';

/**
 * Literal SQL only: no imported table names or constants, so a later rename elsewhere can never
 * change what an old install runs. STRICT tables reject a value of the wrong type.
 */
export const CREATE_LISTS_AND_TASKS: Migration = {
  version: 1,
  name: 'create-lists-and-tasks',
  up: (driver) => {
    driver.exec(`
CREATE TABLE lists (
  id            INTEGER PRIMARY KEY,
  name          TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE tasks (
  id            INTEGER PRIMARY KEY,
  list_id       INTEGER NOT NULL REFERENCES lists (id),
  title         TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  is_done       INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX tasks_by_list ON tasks (list_id, id);
CREATE TABLE entitlements (
  product        TEXT    PRIMARY KEY NOT NULL,
  is_owned       INTEGER NOT NULL CHECK (is_owned IN (0, 1)),
  owned_since_ms INTEGER,
  revoked_at_ms  INTEGER
) STRICT;
CREATE TABLE error_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms   INTEGER NOT NULL,
  area    TEXT    NOT NULL,
  message TEXT    NOT NULL,
  details TEXT
) STRICT;
`);
  },
};
