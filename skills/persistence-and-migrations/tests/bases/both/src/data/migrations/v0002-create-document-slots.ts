// src/data/migrations/v0002-create-document-slots.ts: version 2 of the app database: the save-document slots. Frozen once it ships.
import type { Migration } from '@/data/migrations/migration-runner';

/** The DOCUMENT_SLOTS_DDL text of document-tables.ts, pasted as a literal (a step never imports it). */
export const CREATE_DOCUMENT_SLOTS: Migration = {
  version: 2,
  name: 'create-document-slots',
  up: (driver) => {
    driver.exec(`
CREATE TABLE document_slots (
  slot           TEXT    PRIMARY KEY NOT NULL CHECK (slot IN ('current', 'backup')),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  app_version    TEXT    NOT NULL,
  written_at_ms  INTEGER NOT NULL,
  write_count    INTEGER NOT NULL,
  checksum       TEXT    NOT NULL,
  payload        TEXT    NOT NULL
) STRICT;
CREATE TABLE document_quarantine (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  quarantined_at_ms INTEGER NOT NULL,
  slot           TEXT    NOT NULL,
  reason         TEXT    NOT NULL,
  schema_version INTEGER,
  payload        TEXT
) STRICT;
`);
  },
};
