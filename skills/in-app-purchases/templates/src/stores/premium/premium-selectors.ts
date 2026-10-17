// src/stores/premium/premium-selectors.ts: what the rest of the app reads of the entitlement.
import type { PremiumState } from './premium-reducer';

/** The one input ads, the paywall, Settings and perks read: a primitive, no useShallow needed. */
export function selectIsPremium(state: PremiumState): boolean {
  return state.entitlement.isOwned;
}
