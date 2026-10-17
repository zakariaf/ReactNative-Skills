// test/sqlite/sqlite-entitlement-repository.test.ts: the entitlements table on real SQL, through the app's own open path.
import { openAppDatabase } from '@/data/app-database';
import { NOT_OWNED } from '@/data/entitlements/entitlement-repository';
import { createSqliteEntitlementRepository } from '@/data/entitlements/sqlite-entitlement-repository';
import { MIGRATIONS } from '@/data/migrations/migrations';
import { resetAllData } from '@/data/reset-data';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { createNodeDatabaseFiles } from './node-database-files';
import { createNodeSqliteSqlDriver } from './node-sqlite-sql-driver';
import { makeTempDatabaseFolder } from './temp-database-folder';

import type { TempDatabaseFolder } from './temp-database-folder';
import type { AppDatabase } from '@/data/app-database';

const OWNED = { isOwned: true, ownedSinceMs: 1_000, revokedAtMs: null };

describe('createSqliteEntitlementRepository', () => {
  let folder: TempDatabaseFolder;
  const open = (): AppDatabase =>
    openAppDatabase({
      openDriver: (name) =>
        createNodeSqliteSqlDriver(name === ':memory:' ? name : folder.file(name)),
      files: createNodeDatabaseFiles(),
      fileName: 'app.db',
      migrations: MIGRATIONS,
      errorLog: createFakeErrorLog(),
    });
  beforeEach(() => {
    folder = makeTempDatabaseFolder();
  });
  afterEach(() => {
    folder.remove();
  });

  it('reads not owned before the first save', () => {
    const repo = createSqliteEntitlementRepository({
      driver: open().driver,
      errorLog: createFakeErrorLog(),
    });
    expect(repo.premium()).toStrictEqual({ ok: true, value: NOT_OWNED });
  });

  it('saves, overwrites and reads the entitlement back after a reopen', () => {
    const first = createSqliteEntitlementRepository({
      driver: open().driver,
      errorLog: createFakeErrorLog(),
    });
    expect(first.savePremium(OWNED).ok).toBe(true);
    const revoked = { isOwned: false, ownedSinceMs: 1_000, revokedAtMs: 5_000 };
    expect(first.savePremium(revoked).ok).toBe(true);
    const again = createSqliteEntitlementRepository({
      driver: open().driver,
      errorLog: createFakeErrorLog(),
    });
    expect(again.premium()).toStrictEqual({ ok: true, value: revoked });
  });

  it('keeps the entitlement through "Delete all my data"', () => {
    const { driver } = open();
    const repo = createSqliteEntitlementRepository({ driver, errorLog: createFakeErrorLog() });
    expect(repo.savePremium(OWNED).ok).toBe(true);
    resetAllData(driver);
    expect(repo.premium()).toStrictEqual({ ok: true, value: OWNED });
  });

  it('refuses an owned entitlement without its date and writes nothing', () => {
    const repo = createSqliteEntitlementRepository({
      driver: open().driver,
      errorLog: createFakeErrorLog(),
    });
    const invalid = { isOwned: true, ownedSinceMs: null, revokedAtMs: null };
    expect(repo.savePremium(invalid)).toStrictEqual({
      ok: false,
      error: { kind: 'entitlement-invalid' },
    });
    expect(repo.premium()).toStrictEqual({ ok: true, value: NOT_OWNED });
  });

  it('reads an unreadable row as not owned and logs it', () => {
    const { driver } = open();
    driver.run(
      "INSERT INTO entitlements (product, is_owned, owned_since_ms, revoked_at_ms) VALUES ('premium', 1, -5, NULL)",
      [],
    );
    const errorLog = createFakeErrorLog();
    const repo = createSqliteEntitlementRepository({ driver, errorLog });
    expect(repo.premium()).toStrictEqual({ ok: true, value: NOT_OWNED });
    expect(errorLog.entries()).toHaveLength(1);
  });
});
