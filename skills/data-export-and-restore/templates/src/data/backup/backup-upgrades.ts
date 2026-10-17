// src/data/backup/backup-upgrades.ts: frozen, pure steps that bring an older backup payload to the latest schema.
import type { JsonObject } from '@/core/portable/canonical-json';
import type { BackupUpgrade } from '@/data/backup/backup-upgrade-step';

/**
 * Ordered and append-only: versions FIRST_BACKUP_SCHEMA_VERSION + 1 .. BACKUP_SCHEMA_VERSION, one
 * step file per version (upgrades/vNNNN-<name>.ts, imported here), each the JSON twin of migration
 * vNNNN. Empty until the first table change after backups shipped.
 */
export const BACKUP_UPGRADES: readonly BackupUpgrade[] = [];

/** What is wrong with the list: versions must run first + 1 .. latest, one step each, in order. */
export function backupUpgradeProblems(
  upgrades: readonly BackupUpgrade[],
  versions: { readonly first: number; readonly latest: number },
): readonly string[] {
  const expected = Array.from(
    { length: Math.max(0, versions.latest - versions.first) },
    (_, index) => versions.first + 1 + index,
  );
  const found = upgrades.map((step) => step.version);
  return JSON.stringify(found) === JSON.stringify(expected)
    ? []
    : [`upgrade versions are [${found.join(', ')}], expected [${expected.join(', ')}]`];
}

/** Applies every step newer than `from`, in order. Pure: the input is not changed. */
export function upgradeBackupPayload(
  payload: JsonObject,
  from: number,
  upgrades: readonly BackupUpgrade[] = BACKUP_UPGRADES,
): JsonObject {
  return upgrades
    .filter((step) => step.version > from)
    .reduce((next, step) => step.up(next), payload);
}
