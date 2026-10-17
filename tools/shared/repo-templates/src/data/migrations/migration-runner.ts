// src/data/migrations/migration-runner.ts: forward-only schema migrations, versioned by PRAGMA user_version.
import type { SqlDriver } from '@/data/sql-driver';

/**
 * One frozen step: `up` turns a database at `version - 1` into `version`. Written once and never
 * edited after it ships; it imports nothing but this type, reads no clock and no randomness, and
 * has no down step (an installed app only ever moves forward).
 */
export type Migration = {
  /** 1 for the first step; a list holds 1..N in order. */
  readonly version: number;
  /** kebab-case, for example 'create-lists-and-tasks' (error messages, the debug view). */
  readonly name: string;
  readonly up: (driver: SqlDriver) => void;
  /**
   * true when the step rebuilds a table (create new, copy, drop old, rename). The runner turns
   * foreign keys off around the transaction and checks them before COMMIT, because dropping a
   * parent table while foreign keys are on deletes its ON DELETE CASCADE children.
   */
  readonly rebuildsTables?: boolean;
};

export type MigrationResult =
  | { readonly kind: 'up-to-date'; readonly version: number }
  | { readonly kind: 'migrated'; readonly from: number; readonly to: number }
  /** The file comes from a newer app: nothing was read beyond the version, nothing was written. */
  | { readonly kind: 'newer'; readonly found: number; readonly latest: number }
  /** A step threw: its transaction rolled back, the file stays at the last completed version. */
  | {
      readonly kind: 'failed';
      readonly from: number;
      readonly at: number;
      readonly reason: string;
      /** What the step threw (an Error naming the list problem for a broken list), for the error log. */
      readonly error: unknown;
    };

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** PRAGMA user_version: 0 for a new file. Reading it changes nothing. */
export function readUserVersion(driver: Pick<SqlDriver, 'get'>): number {
  const value = driver.get('PRAGMA user_version', [])?.['user_version'];
  return typeof value === 'number' ? value : 0;
}

/** What is wrong with the list itself: versions must run 1..N in order, names must be kebab-case. */
export function migrationListProblems(migrations: readonly Migration[]): readonly string[] {
  return migrations.flatMap((migration, index) => {
    const problems: string[] = [];
    if (migration.version !== index + 1) {
      problems.push(`position ${String(index + 1)} holds version ${String(migration.version)}`);
    }
    if (!KEBAB.test(migration.name)) {
      problems.push(`version ${String(migration.version)} is named "${migration.name}"`);
    }
    return problems;
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertForeignKeys(driver: SqlDriver): void {
  const broken = driver.all('PRAGMA foreign_key_check', []);
  if (broken.length > 0) {
    throw new Error(`foreign key check failed: ${JSON.stringify(broken[0])}`);
  }
}

/** One step and its version stamp in one transaction: both commit, or neither does. */
function applyStep(driver: SqlDriver, migration: Migration): void {
  const isRebuild = migration.rebuildsTables === true;
  if (isRebuild) driver.exec('PRAGMA foreign_keys = OFF');
  try {
    driver.transaction(() => {
      migration.up(driver);
      if (isRebuild) assertForeignKeys(driver);
      driver.exec(`PRAGMA user_version = ${String(migration.version)}`);
    });
  } finally {
    if (isRebuild) driver.exec('PRAGMA foreign_keys = ON');
  }
}

/**
 * Applies every pending step in order. Never throws: a newer file is reported and left untouched,
 * and a failing step is reported with its reason after its transaction rolled back.
 */
export function migrateDatabase(
  driver: SqlDriver,
  migrations: readonly Migration[],
): MigrationResult {
  const from = readUserVersion(driver);
  const problems = migrationListProblems(migrations);
  if (problems.length > 0) {
    const reason = `migration list: ${problems.join('; ')}`;
    return { kind: 'failed', from, at: 0, reason, error: new Error(reason) };
  }
  const latest = migrations.length;
  if (from > latest) return { kind: 'newer', found: from, latest };
  if (from === latest) return { kind: 'up-to-date', version: from };
  for (const migration of migrations.slice(from)) {
    try {
      applyStep(driver, migration);
    } catch (error) {
      const reason = `${migration.name}: ${messageOf(error)}`;
      return { kind: 'failed', from, at: migration.version, reason, error };
    }
  }
  return { kind: 'migrated', from, to: latest };
}
