// src/data/backup/backup-upgrade-step.ts: the shape of one backup upgrade step and the one helper a step may use.
import { isJsonArray, isJsonObject } from '@/core/portable/canonical-json';

import type { JsonObject } from '@/core/portable/canonical-json';

/**
 * One step per database migration after FIRST_BACKUP_SCHEMA_VERSION: `up` turns a payload of
 * `version - 1` into `version`, doing to the JSON rows exactly what migration `version` does to
 * the tables (an added column gets its default, a renamed column its new name). Frozen once it
 * ships, like the migration: literal names, no imports but types and mapRows, no clock. The
 * parity test (test/sqlite/backup-round-trip.test.ts) proves step and migration agree.
 */
export type BackupUpgrade = {
  readonly version: number;
  readonly name: string;
  readonly up: (payload: JsonObject) => JsonObject;
};

/** A copy of `payload` with `change` applied to every row of `table` (rows that are not objects stay). */
export function mapRows(
  payload: JsonObject,
  table: string,
  change: (row: JsonObject) => JsonObject,
): JsonObject {
  const rows = payload[table];
  if (!isJsonArray(rows)) return payload;
  const changed = rows.map((row) => (isJsonObject(row) ? change(row) : row));
  return { ...payload, [table]: changed };
}
