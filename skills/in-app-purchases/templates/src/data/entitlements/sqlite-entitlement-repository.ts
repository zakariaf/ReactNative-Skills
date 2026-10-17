// src/data/entitlements/sqlite-entitlement-repository.ts: the entitlements table, the only code that reads or writes it.
import * as v from 'valibot';

import { attempt, err, ok } from '@/core/result';
import { NOT_OWNED } from '@/data/entitlements/entitlement-repository';
import { toStorageFailure } from '@/data/to-storage-failure';

import type {
  EntitlementFailure,
  EntitlementRepository,
  PremiumEntitlement,
} from '@/data/entitlements/entitlement-repository';
import type { SqlDriver } from '@/data/sql-driver';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

/** The row key of the Premium entitlement (one row per entitlement the app sells). */
const PREMIUM = 'premium';
const SELECT_SQL =
  'SELECT is_owned, owned_since_ms, revoked_at_ms FROM entitlements WHERE product = ?';
const UPSERT_SQL = `INSERT INTO entitlements (product, is_owned, owned_since_ms, revoked_at_ms)
VALUES (?, ?, ?, ?)
ON CONFLICT (product) DO UPDATE SET
  is_owned = excluded.is_owned,
  owned_since_ms = excluded.owned_since_ms,
  revoked_at_ms = excluded.revoked_at_ms`;

const MS = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const ENTITLEMENT_ROW = v.object({
  is_owned: v.picklist([0, 1]),
  owned_since_ms: v.nullable(MS),
  revoked_at_ms: v.nullable(MS),
});

/** What may be saved: an owned entitlement has its date; a revoked one keeps the store's date. */
const PREMIUM_ENTITLEMENT = v.pipe(
  v.object({ isOwned: v.boolean(), ownedSinceMs: v.nullable(MS), revokedAtMs: v.nullable(MS) }),
  v.check((value) => !value.isOwned || (value.ownedSinceMs !== null && value.revokedAtMs === null)),
);

export type SqliteEntitlementRepositoryDeps = {
  readonly driver: SqlDriver;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
};

/** Total. Unexpected failures are logged with the raw error first; a full disk is the app's to explain. */
function entitlementFailureOf(
  errorLog: Pick<ErrorLogPort, 'record'>,
): (thrown: unknown) => EntitlementFailure {
  return (thrown) => {
    const storage = toStorageFailure(thrown);
    if (storage.kind === 'full') return { kind: 'storage-full' };
    if (storage.kind === 'busy') return { kind: 'storage-busy' };
    errorLog.record('storage', thrown);
    return { kind: 'storage-unavailable', code: storage.kind === 'unknown' ? storage.code : null };
  };
}

/** Builds the repository over the open database (persistence-and-migrations creates the table). */
export function createSqliteEntitlementRepository(
  deps: SqliteEntitlementRepositoryDeps,
): EntitlementRepository {
  const { driver, errorLog } = deps;
  const fail = entitlementFailureOf(errorLog);
  return {
    premium: () => {
      const read = attempt(() => driver.get(SELECT_SQL, [PREMIUM]), fail);
      if (!read.ok) return read;
      if (read.value === null) return ok(NOT_OWNED);
      const row = v.safeParse(ENTITLEMENT_ROW, read.value);
      if (!row.success) {
        errorLog.record('storage', new Error('unreadable entitlements row'));
        return ok(NOT_OWNED); // the launch re-check restores it from the store's evidence
      }
      const entitlement: PremiumEntitlement = {
        isOwned: row.output.is_owned === 1,
        ownedSinceMs: row.output.owned_since_ms,
        revokedAtMs: row.output.revoked_at_ms,
      };
      return ok(entitlement);
    },
    savePremium: (entitlement) => {
      const parsed = v.safeParse(PREMIUM_ENTITLEMENT, entitlement);
      if (!parsed.success) return err({ kind: 'entitlement-invalid' });
      const { isOwned, ownedSinceMs, revokedAtMs } = parsed.output;
      return attempt(() => {
        driver.run(UPSERT_SQL, [PREMIUM, isOwned ? 1 : 0, ownedSinceMs, revokedAtMs]);
      }, fail);
    },
  };
}
