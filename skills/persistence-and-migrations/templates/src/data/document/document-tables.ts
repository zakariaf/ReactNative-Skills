// src/data/document/document-tables.ts: the SQL of the document slots: the tables' DDL and the statements the store runs.

/**
 * The tables, created by one of the app's own migrations: paste this text as a literal into
 * src/data/migrations/vNNNN-create-document-slots.ts (a frozen step, like every other). The
 * integration test runs it directly. STRICT: a value of the wrong type is an error, not a coercion.
 */
export const DOCUMENT_SLOTS_DDL = `
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
`;

export const UPSERT_SLOT_SQL = `
INSERT INTO document_slots (slot, schema_version, app_version, written_at_ms, write_count, checksum, payload)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (slot) DO UPDATE SET
  schema_version = excluded.schema_version,
  app_version = excluded.app_version,
  written_at_ms = excluded.written_at_ms,
  write_count = excluded.write_count,
  checksum = excluded.checksum,
  payload = excluded.payload`;

export const SELECT_SLOT_SQL = `
SELECT schema_version, app_version, written_at_ms, write_count, checksum, payload
FROM document_slots WHERE slot = ?`;

/** A copy of the row, never a move: the damaged payload stays as evidence. */
export const QUARANTINE_SLOT_SQL = `
INSERT INTO document_quarantine (quarantined_at_ms, slot, reason, schema_version, payload)
SELECT ?, slot, ?, schema_version, payload FROM document_slots WHERE slot = ?`;

export const TRIM_QUARANTINE_SQL = `
DELETE FROM document_quarantine WHERE id <= (SELECT MAX(id) FROM document_quarantine) - 10`;
