// src/data/backup/read-backup.ts: the whole validation ladder for a picked file; nothing is written until it passes.
import * as v from 'valibot';

import { err, ok } from '@/core/result';
import { checkEnvelope } from '@/data/backup/backup-envelope';
import { BACKUP_PAYLOAD } from '@/data/backup/backup-schema';
import { upgradeBackupPayload } from '@/data/backup/backup-upgrades';

import type { Result } from '@/core/result';
import type { BackupHeader } from '@/data/backup/backup-envelope';
import type { BackupCounts, Inconsistency, RestoreFailure } from '@/data/backup/backup-failures';
import type { BackupPayload } from '@/data/backup/backup-schema';

/** A file that passed every rung: ready to show in the confirmation and to restore. */
export type DecodedBackup = {
  readonly header: BackupHeader;
  /** At the latest schema (upgraded when the file is older). */
  readonly payload: BackupPayload;
  readonly counts: BackupCounts;
};

/** The first repeated id of a table, or null. */
function repeatedId(rows: readonly { readonly id: number }[]): number | null {
  const seen = new Set<number>();
  for (const { id } of rows) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/**
 * Rung 7: the file agrees with itself. Ids are unique per table and every child names a parent
 * that is in the file, so the replace cannot fail half-way on a foreign key (and a file that would
 * is refused with the row named, before anything is written). Export runs it too, so a file that
 * would fail this rung is never published.
 */
export function consistencyFailure(payload: BackupPayload): Inconsistency | null {
  for (const table of ['lists', 'tasks'] as const) {
    const id = repeatedId(payload[table]);
    if (id !== null) return { kind: 'inconsistent', table, id, reason: 'duplicate-id' };
  }
  const listIds = new Set(payload.lists.map((list) => list.id));
  const orphan = payload.tasks.find((task) => !listIds.has(task.list_id));
  return orphan === undefined
    ? null
    : { kind: 'inconsistent', table: 'tasks', id: orphan.id, reason: 'missing-parent' };
}

export function countsOf(payload: BackupPayload): BackupCounts {
  return { lists: payload.lists.length, tasks: payload.tasks.length };
}

/**
 * Rungs 1-5 (checkEnvelope), then 6: the payload, upgraded through the frozen steps when older,
 * matches the latest row schemas; then 7: consistency. Every failure is a typed value, never a throw.
 */
export function readBackup(text: string): Result<DecodedBackup, RestoreFailure> {
  const envelope = checkEnvelope(text);
  if (!envelope.ok) return envelope;
  const { header } = envelope.value;
  const upgraded = upgradeBackupPayload(envelope.value.payload, header.schemaVersion);
  const rows = v.safeParse(BACKUP_PAYLOAD, upgraded);
  if (!rows.success) {
    return err({ kind: 'invalid-row', path: v.getDotPath(rows.issues[0]) ?? '(payload)' });
  }
  const inconsistent = consistencyFailure(rows.output);
  if (inconsistent !== null) return err(inconsistent);
  return ok({ header, payload: rows.output, counts: countsOf(rows.output) });
}
