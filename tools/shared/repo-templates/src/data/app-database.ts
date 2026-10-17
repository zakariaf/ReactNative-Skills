// src/data/app-database.ts: opens the app database (version check, adoption, pragmas, snapshot, migrations) and never throws.
import { attempt } from '@/core/result';
import { isSameSchema, schemaOf, userTables } from '@/data/database-schema';
import { pruneSnapshots, reuseSnapshot, snapshotPathFor } from '@/data/database-snapshots';
import { migrateDatabase, readUserVersion } from '@/data/migrations/migration-runner';
import { toStorageFailure } from '@/data/to-storage-failure';

import type { DatabaseFiles } from '@/data/database-files';
import type { Migration } from '@/data/migrations/migration-runner';
import type { ClosableSqlDriver, SqlDriver, SqlRow } from '@/data/sql-driver';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** File name inside expo-sqlite's default directory. */
export const APP_DB_FILE = 'app.db';

/**
 * Run on every open, after the version check. journal_mode is stored in the file; synchronous and
 * foreign_keys belong to the connection, so all three are set every time. WAL plus FULL: a
 * committed transaction survives a kill or a power cut. foreign_keys: SQLite ships with them off.
 */
export const APP_DB_PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
`;

export type DatabaseOutcome =
  | { readonly kind: 'fresh'; readonly version: number }
  | { readonly kind: 'ready'; readonly version: number }
  /** Upgraded; `snapshot` is the copy taken before the first step ran. */
  | {
      readonly kind: 'migrated';
      readonly from: number;
      readonly to: number;
      readonly snapshot: string;
    }
  /** An unversioned file whose schema is the baseline or one of its variants: stamped, then upgraded. */
  | {
      readonly kind: 'adopted';
      readonly baseline: number;
      readonly to: number;
      readonly snapshot: string;
    }
  /** The file comes from a newer build: left untouched; this session runs in memory. */
  | { readonly kind: 'newer-version'; readonly found: number }
  /** user_version 0 but holding tables this build does not recognise: left untouched; in memory. */
  | { readonly kind: 'unversioned'; readonly tables: readonly string[] }
  /** A step or its snapshot failed: the file keeps its last complete version; in memory. */
  | { readonly kind: 'migration-failed'; readonly from: number; readonly reason: string }
  /**
   * As migration-failed, but the device is out of space (SQLITE_FULL; VACUUM INTO needs about the
   * file's size free): the user can fix it by freeing space, so the first screen says that.
   */
  | { readonly kind: 'storage-full'; readonly from: number; readonly reason: string }
  /** Not a readable SQLite file: left in place for support; this session runs in memory. */
  | { readonly kind: 'unreadable'; readonly reason: string };

export type AppDatabase = {
  readonly driver: SqlDriver;
  readonly outcome: DatabaseOutcome;
  /** false for an in-memory session: nothing written survives a restart. */
  readonly isPersistent: boolean;
  /** PRAGMA wal_checkpoint(TRUNCATE), called when the app goes to the background. Never throws. */
  readonly checkpoint: () => void;
};

/**
 * What the rest of the app may see of the database (AppData.database): the outcome, the in-memory
 * flag and the checkpoint, never the driver. Features reach data through repositories (rule 1).
 */
export type DatabaseStatus = Pick<AppDatabase, 'outcome' | 'isPersistent' | 'checkpoint'>;

/** A new object without the driver, so not even a cast reaches the SqlDriver from a feature. */
export function databaseStatusOf(database: AppDatabase): DatabaseStatus {
  const { outcome, isPersistent, checkpoint } = database;
  return { outcome, isPersistent, checkpoint };
}

/**
 * Only for an app adopting a database that older builds wrote without versions (references/
 * tables-and-repositories.md, "Adopting"). A user_version 0 file is stamped `version` when its schema
 * is exactly what migrations 1..version create, or exactly one of `variants`.
 */
export type Baseline = {
  readonly version: number;
  /**
   * Other schemas old builds left (an ALTER TABLE leaves other text than a fresh CREATE): each is
   * the CREATE statements of a frozen db-v0-<variant>.sql dump, verbatim. The step after `version`
   * rebuilds every table a variant differs in, so every population ends with one schema.
   */
  readonly variants?: readonly string[];
};

export type OpenAppDatabaseDeps = {
  /** createExpoSqliteSqlDriver on a device, createNodeSqliteSqlDriver(<temp dir>/<name>) in tests. */
  readonly openDriver: (fileName: string) => ClosableSqlDriver;
  /**
   * Lists and deletes this database's own snapshots (createExpoFileSystemDatabaseFilesAdapter on a
   * device, createNodeDatabaseFiles in tests).
   */
  readonly files: DatabaseFiles;
  readonly fileName: string;
  readonly migrations: readonly Migration[];
  /** Gets every raw error before it becomes an outcome (the session's memory log at startup). */
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  /** BASELINE from migrations.ts: null unless the app adopts an unversioned database. */
  readonly baseline?: Baseline | null;
};

type AdoptionDeps = Pick<OpenAppDatabaseDeps, 'openDriver' | 'migrations' | 'baseline'>;

type Upgrade = { readonly outcome: DatabaseOutcome; readonly isUsable: boolean };

type UpgradePlan = {
  readonly hasData: boolean;
  /** Where the copy goes ('' for a file without tables: nothing to keep). */
  readonly snapshot: string;
  readonly needsSnapshot: boolean;
  /** The version an adopted unversioned file is stamped with first, or 0. */
  readonly baseline: number;
};

/** The message of an Error from any realm (a node:sqlite error inside Jest fails instanceof Error). */
function messageOf(error: unknown): string {
  const message: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : undefined;
  return typeof message === 'string' ? message : String(error);
}

/** The latest schema in memory: the app keeps working, the outcome tells the user, nothing is lost. */
function inMemory(deps: OpenAppDatabaseDeps, outcome: DatabaseOutcome): AppDatabase {
  const driver = deps.openDriver(':memory:');
  driver.exec('PRAGMA foreign_keys = ON');
  migrateDatabase(driver, deps.migrations);
  return { driver, outcome, isPersistent: false, checkpoint: () => undefined };
}

/** Closes the file without having written it, and runs the session in memory. */
function leave(
  driver: ClosableSqlDriver,
  deps: OpenAppDatabaseDeps,
  outcome: DatabaseOutcome,
): AppDatabase {
  driver.close();
  return inMemory(deps, outcome);
}

function onDisk(
  driver: SqlDriver,
  deps: OpenAppDatabaseDeps,
  outcome: DatabaseOutcome,
): AppDatabase {
  const checkpoint = (): void => {
    try {
      driver.get('PRAGMA wal_checkpoint(TRUNCATE)', []);
    } catch (error: unknown) {
      deps.errorLog.record('storage', error);
    }
  };
  return { driver, outcome, isPersistent: true, checkpoint };
}

/**
 * The schema `build` leaves in a new in-memory database, or null when it fails. A variant whose DDL
 * does not execute is an expected answer (it matches nothing; the fixtures test names it), so the
 * throw is converted, not caught.
 */
function schemaBuiltBy(
  deps: AdoptionDeps,
  build: (reference: SqlDriver) => boolean,
): readonly SqlRow[] | null {
  const reference = deps.openDriver(':memory:');
  try {
    const built = attempt(
      () => (build(reference) ? schemaOf(reference) : null),
      () => ({ kind: 'reference-build-failed' }) as const,
    );
    return built.ok ? built.value : null;
  } finally {
    reference.close();
  }
}

/**
 * true when an unversioned file's schema is exactly what migrations 1..baseline.version create, or
 * exactly one of the baseline's variants. Reads the file only.
 */
export function isAdoptable(driver: SqlDriver, deps: AdoptionDeps): boolean {
  const version = deps.baseline?.version ?? 0;
  if (version < 1 || version > deps.migrations.length) return false;
  const found = schemaOf(driver);
  const steps = deps.migrations.slice(0, version);
  const builds = [
    (reference: SqlDriver) => migrateDatabase(reference, steps).kind === 'migrated',
    ...(deps.baseline?.variants ?? []).map((ddl) => (reference: SqlDriver) => {
      reference.exec(ddl);
      return true;
    }),
  ];
  return builds.some((build) => {
    const schema = schemaBuiltBy(deps, build);
    return schema !== null && isSameSchema(schema, found);
  });
}

/** SQLITE_FULL in the error, or in the cause a wrapped snapshot error keeps. */
function isStorageFull(error: unknown): boolean {
  const cause: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'cause') : undefined;
  return [error, cause].some((each) => toStorageFailure(each).kind === 'full');
}

/** A full disk is its own outcome: the user can fix it by freeing space. */
function migrationFailed(deps: OpenAppDatabaseDeps, from: number, error: unknown): Upgrade {
  deps.errorLog.record('storage', error);
  const reason = messageOf(error);
  const outcome: DatabaseOutcome = isStorageFull(error)
    ? { kind: 'storage-full', from, reason }
    : { kind: 'migration-failed', from, reason };
  return { outcome, isUsable: false };
}

function planUpgrade(
  driver: ClosableSqlDriver,
  deps: OpenAppDatabaseDeps,
  from: number,
): UpgradePlan {
  const hasData = userTables(driver).length > 0;
  return {
    hasData,
    snapshot: hasData ? snapshotPathFor(driver.path, from) : '',
    needsSnapshot: hasData && !reuseSnapshot(deps, driver.path, from),
    baseline: from === 0 && hasData ? (deps.baseline?.version ?? 0) : 0,
  };
}

function upgradedOutcome(plan: UpgradePlan, from: number, to: number): DatabaseOutcome {
  if (plan.baseline > 0) {
    return { kind: 'adopted', baseline: plan.baseline, to, snapshot: plan.snapshot };
  }
  if (!plan.hasData) return { kind: 'fresh', version: to };
  return { kind: 'migrated', from, to, snapshot: plan.snapshot };
}

/** Snapshot first (no copy, no migration), stamp an adopted baseline, migrate, prune old copies. */
function upgrade(driver: ClosableSqlDriver, deps: OpenAppDatabaseDeps, from: number): Upgrade {
  const plan = planUpgrade(driver, deps, from);
  if (plan.needsSnapshot) {
    try {
      driver.run('VACUUM INTO ?', [plan.snapshot]);
    } catch (error) {
      return migrationFailed(
        deps,
        from,
        new Error(`snapshot: ${messageOf(error)}`, { cause: error }),
      );
    }
  }
  if (plan.baseline > 0) driver.exec(`PRAGMA user_version = ${String(plan.baseline)}`);
  const result = migrateDatabase(driver, deps.migrations);
  if (result.kind === 'failed') return migrationFailed(deps, from, result.error);
  if (result.kind === 'newer') {
    return migrationFailed(deps, from, new Error(`version ${String(result.found)} appeared`));
  }
  pruneSnapshots(deps, driver.path);
  return { outcome: upgradedOutcome(plan, from, deps.migrations.length), isUsable: true };
}

function openFile(deps: OpenAppDatabaseDeps): AppDatabase {
  const driver = deps.openDriver(deps.fileName);
  try {
    // The version comes first: pragmas write to the file, and a newer build's file is never touched.
    const found = readUserVersion(driver);
    const latest = deps.migrations.length;
    if (found > latest) return leave(driver, deps, { kind: 'newer-version', found });
    const tables = userTables(driver);
    if (found === 0 && tables.length > 0 && !isAdoptable(driver, deps)) {
      deps.errorLog.record('storage', new Error(`unversioned database holds ${tables.join(', ')}`));
      return leave(driver, deps, { kind: 'unversioned', tables });
    }
    driver.exec(APP_DB_PRAGMAS);
    if (found === latest) return onDisk(driver, deps, { kind: 'ready', version: latest });
    const { outcome, isUsable } = upgrade(driver, deps, found);
    return isUsable ? onDisk(driver, deps, outcome) : leave(driver, deps, outcome);
  } catch (error) {
    deps.errorLog.record('storage', error);
    return leave(driver, deps, { kind: 'unreadable', reason: messageOf(error) });
  }
}

/**
 * Opens and migrates synchronously, before the first screen renders. Never throws for a data
 * reason: a newer, unversioned, damaged or unmigratable file is left as it is (beside its
 * snapshot) and the session runs in memory with an outcome the first screen explains.
 */
export function openAppDatabase(deps: OpenAppDatabaseDeps): AppDatabase {
  try {
    return openFile(deps);
  } catch (error) {
    deps.errorLog.record('storage', error);
    return inMemory(deps, { kind: 'unreadable', reason: messageOf(error) });
  }
}
