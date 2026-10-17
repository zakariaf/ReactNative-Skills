// test/sqlite/restore-snapshot-files.ts: the snapshot restore the runbook performs on a device, on node:fs, so the drill test proves the same steps.
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';

export type RestoredFiles = {
  /** The folder that now holds the replaced database files. */
  readonly keptIn: string;
  /** Names of the files moved there ('app.db', 'app.db-wal', ...). */
  readonly kept: readonly string[];
};

/**
 * Restores `<database>.v<from>.bak` over the database. Run it only while nothing has the database
 * open (the app is stopped): the current file and its -wal and -shm are moved into `keepDir`
 * first (a restore discards every write since the upgrade, so the replaced files stay
 * recoverable), then the snapshot is copied over the database name. A -wal left beside the
 * restored file would be replayed into it on the next open, so it is never left behind.
 */
export function restoreSnapshotFiles(
  databasePath: string,
  snapshotPath: string,
  keepDir: string,
): RestoredFiles {
  if (!existsSync(snapshotPath)) throw new Error(`no snapshot at ${snapshotPath}`);
  mkdirSync(keepDir, { recursive: true });
  const kept = ['', '-wal', '-shm']
    .map((suffix) => `${databasePath}${suffix}`)
    .filter((path) => existsSync(path));
  for (const path of kept) renameSync(path, join(keepDir, basename(path)));
  copyFileSync(snapshotPath, databasePath);
  return { keptIn: keepDir, kept: kept.map((path) => basename(path)) };
}
