// src/data/entitlements/fake-entitlement-repository.ts: an in-memory EntitlementRepository for store and service tests.
import { err, ok } from '@/core/result';
import { NOT_OWNED } from '@/data/entitlements/entitlement-repository';

import type {
  EntitlementFailure,
  EntitlementRepository,
  PremiumEntitlement,
} from '@/data/entitlements/entitlement-repository';

export type FakeEntitlementRepository = EntitlementRepository & {
  /** The next save returns this failure once and writes nothing (a full disk, a lock). */
  failNextSave: EntitlementFailure | null;
  /** Every save that landed, in order. */
  readonly saves: readonly PremiumEntitlement[];
};

/** Starts with `initial` on "disk" (NOT_OWNED by default). */
export function createFakeEntitlementRepository(
  initial: PremiumEntitlement = NOT_OWNED,
): FakeEntitlementRepository {
  let saved = initial;
  const saves: PremiumEntitlement[] = [];
  const fake: FakeEntitlementRepository = {
    failNextSave: null,
    saves,
    premium: () => ok(saved),
    savePremium: (entitlement) => {
      const planned = fake.failNextSave;
      if (planned !== null) {
        fake.failNextSave = null;
        return err(planned);
      }
      saved = entitlement;
      saves.push(entitlement);
      return ok(undefined);
    },
  };
  return fake;
}
