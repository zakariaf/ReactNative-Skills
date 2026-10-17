// src/services/test-hooks/debug-premium-target.ts
// Shape to imitate (not a template): what an app adds to debug-menu-and-test-hooks' debug deep link
// so the StoreKit flows (.maestro/storekit/) can open `<scheme>://debug/setup?premium=0&open=paywall`.
// That skill's registry ships date, offline, motion, probe, lang, theme and open=tasks|debug; the
// purchase parameters are the app's own. Three pieces, changed in one commit:
//
// 1. The registry, src/features/debug/debug-links.ts:
//      export const DEBUG_SCREENS = { tasks: '/', debug: '/debug', paywall: '/paywall' } as const;
//      // in DEBUG_LINK_PARAMS:
//      premium: { kind: 'values', values: ['0', '1'], effect: 'the saved Premium entitlement' },
//      // in DebugRequest:            readonly isPremium?: boolean;
//      // in withValue:               case 'premium': return { ...request, isPremium: value === '1' };
//    and in debug-setup-plan.ts a step { kind: 'premium', isPremium } after the overrides and before
//    the screen, which use-debug-setup-model.ts applies with hooks.premium.apply(step.isPremium); a
//    link that says premium= while hooks.premium is null is refused (debug-link-premium-not-wired),
//    the same way lang= is refused without a settings target. Tests first (debug-links.test.ts,
//    debug-setup-plan.test.ts), as that skill's "Adding a parameter" says.
//
// 2. The mirror the E2E flows read, contracts/debug-links.json (its check-test-hooks fails when the
//    two differ):
//      "premium": { "values": ["0", "1"], "effect": "the saved Premium entitlement" },
//      "open": { "values": ["tasks", "debug", "paywall"], "effect": "the screen to open last" }
//
// 3. This handler. It lives in a test-only folder (contracts/architecture.json testOnlyFolders lists
//    src/services/test-hooks/), reached only through the TEST_ONLY gate, so production bundles never
//    hold it; contracts/in-app-purchases.json entitlementWritersAllowedIn lists the folder, so
//    check-purchases accepts its grantPremium/revokePremium calls. The startup passes it to
//    createTestHooks next to the settings target:
//      createTestHooks({ ..., premium: createDebugPremiumTarget({ premium: stores.premium, clock }) })
//    The debug menu's Premium switch calls the same apply(), so the link and the menu agree. Its test,
//    debug-premium-target.test.ts, opens the real stores over createFakeEntitlementRepository() and
//    proves premium=1 saves Premium and premium=0 saves a revocation dated by the clock (tdd-workflow's
//    check-tests reports a test-only module without one).
//
// It writes through the premium store (save, then publish), never the entitlements table: Settings,
// ads and the paywall then change at once, exactly as after a real purchase. A revoke carries the
// clock's now, because the store ignores a revoke without a positive date.
import type { Result } from '@/core/result';
import type { EntitlementFailure } from '@/data/entitlements/entitlement-repository';
import type { ClockPort } from '@/services/clock/clock-port';
import type { PremiumStore } from '@/stores/premium/premium-store';

export type DebugPremiumTarget = {
  /** premium=1 saves Premium, premium=0 saves a revocation dated now. */
  readonly apply: (isPremium: boolean) => Result<void, EntitlementFailure>;
};

export type DebugPremiumTargetDeps = {
  readonly premium: Pick<PremiumStore, 'getState'>;
  readonly clock: Pick<ClockPort, 'nowMs'>;
};

export function createDebugPremiumTarget(deps: DebugPremiumTargetDeps): DebugPremiumTarget {
  return {
    apply: (isPremium) => {
      const store = deps.premium.getState();
      const nowMs = deps.clock.nowMs();
      return isPremium ? store.grantPremium({ ownedSinceMs: nowMs }) : store.revokePremium(nowMs);
    },
  };
}
