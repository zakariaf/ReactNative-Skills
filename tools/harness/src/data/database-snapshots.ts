// src/data/database-snapshots.ts: names, reuses and prunes the migration snapshots that sit beside the database file.
import { readUserVersion } from '@/data/migrations/migration-runner';

import type { DatabaseFiles } from '@/data/database-files';
import type { ClosableSqlDriver } from '@/data/sql-driver';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** Snapshots kept after a successful migration: the one just taken and the one before it. */
export const SNAPSHOTS_KEPT = 2;

export type SnapshotDeps = {
  /** Opens a file of the database's folder by name (the open path's own openDriver). */
  readonly openDriver: (fileName: string) => ClosableSqlDriver;
  readonly files: DatabaseFiles;
  /** The database's name as openDriver takes it ('app.db'). */
  readonly fileName: string;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

const folderOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));
const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * `<database>.v<from>.bak`: one name per version an upgrade starts from, never a time, so a launch
 * that keeps failing reuses one copy instead of writing a new full-size file every time.
 */
export function snapshotPathFor(databasePath: string, from: number): string {
  return `${databasePath}.v${String(from)}.bak`;
}

/** The version in a snapshot name of this database, or null for any other file. */
export function snapshotVersionOf(databaseName: string, name: string): number | null {
  const match = /^\.v(\d+)\.bak$/.exec(name.slice(databaseName.length));
  return name.startsWith(databaseName) && match?.[1] !== undefined ? Number(match[1]) : null;
}

/** user_version of a copy that passes quick_check, or null for a partial or damaged copy. */
function healthyVersionOf(deps: SnapshotDeps, name: string): number | null {
  let copy: ClosableSqlDriver | null = null;
  try {
    copy = deps.openDriver(name);
    const check = copy.get('PRAGMA quick_check', [])?.['quick_check'];
    return check === 'ok' ? readUserVersion(copy) : null;
  } catch (error: unknown) {
    deps.errorLog.record('storage', error);
    return null;
  } finally {
    copy?.close();
  }
}

/**
 * true when `<database>.v<from>.bak` exists and is a healthy database at user_version `from`: an
 * earlier launch took it and its upgrade failed, so the file has not changed since (an in-memory
 * session writes nothing). A copy that is not (a launch killed during VACUUM INTO) is deleted, so
 * a new one can be taken: VACUUM INTO refuses a target that exists and is not empty.
 */
export function reuseSnapshot(deps: SnapshotDeps, databasePath: string, from: number): boolean {
  const path = snapshotPathFor(databasePath, from);
  try {
    if (!deps.files.list(folderOf(databasePath)).includes(baseOf(path))) return false;
    if (healthyVersionOf(deps, `${deps.fileName}.v${String(from)}.bak`) === from) return true;
    deps.files.remove(path);
  } catch (error: unknown) {
    deps.errorLog.record('storage', error);
  }
  return false;
}

/** Deletes all but the newest SNAPSHOTS_KEPT snapshots of this database. Never throws. */
export function pruneSnapshots(deps: SnapshotDeps, databasePath: string): void {
  const folder = folderOf(databasePath);
  try {
    const snapshots = deps.files
      .list(folder)
      .map((name) => ({ name, version: snapshotVersionOf(baseOf(databasePath), name) ?? -1 }))
      .filter((entry) => entry.version >= 0)
      .sort((a, b) => b.version - a.version);
    for (const old of snapshots.slice(SNAPSHOTS_KEPT)) deps.files.remove(`${folder}/${old.name}`);
  } catch (error: unknown) {
    deps.errorLog.record('storage', error);
  }
}
