// src/data/document/sqlite-document-store.ts: the DocumentStore on the app database's document_slots table.
import {
  QUARANTINE_SLOT_SQL,
  SELECT_SLOT_SQL,
  TRIM_QUARANTINE_SQL,
  UPSERT_SLOT_SQL,
} from '@/data/document/document-tables';

import type { DocumentStore, SlotName, SlotRecord } from '@/data/document/document-store';
import type { SqlDriver, SqlRow } from '@/data/sql-driver';

/** A row of an unexpected shape reads as no row: the load plan then treats the slot as missing. */
function toSlotRecord(row: SqlRow | null): SlotRecord | null {
  if (row === null) return null;
  const { schema_version, app_version, written_at_ms, write_count, checksum, payload } = row;
  if (
    typeof schema_version !== 'number' ||
    typeof app_version !== 'string' ||
    typeof written_at_ms !== 'number' ||
    typeof write_count !== 'number' ||
    typeof checksum !== 'string' ||
    typeof payload !== 'string'
  ) {
    return null;
  }
  return {
    schemaVersion: schema_version,
    appVersion: app_version,
    writtenAtMs: written_at_ms,
    writeCount: write_count,
    checksum,
    payload,
  };
}

function upsert(driver: SqlDriver, slot: SlotName, record: SlotRecord): void {
  driver.run(UPSERT_SLOT_SQL, [
    slot,
    record.schemaVersion,
    record.appVersion,
    record.writtenAtMs,
    record.writeCount,
    record.checksum,
    record.payload,
  ]);
}

/** The tables come from the app's migrations; openAppDatabase already ran them (or runs in memory). */
export function createSqliteDocumentStore(driver: SqlDriver): DocumentStore {
  return {
    read: (slot) => toSlotRecord(driver.get(SELECT_SLOT_SQL, [slot])),
    write: (slots) => {
      driver.transaction(() => {
        if (slots.current !== undefined) upsert(driver, 'current', slots.current);
        if (slots.backup !== undefined) upsert(driver, 'backup', slots.backup);
      });
    },
    quarantine: (slot, reason, atMs) => {
      driver.transaction(() => {
        driver.run(QUARANTINE_SLOT_SQL, [atMs, reason, slot]);
        driver.run(TRIM_QUARANTINE_SQL, []);
      });
    },
  };
}
