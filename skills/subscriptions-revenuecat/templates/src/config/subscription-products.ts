// src/config/subscription-products.ts: the subscription ids, equal to contracts/subscriptions.json.
// Written once: the RevenueCat dashboard, both store consoles, the contract and this file agree.

/** The RevenueCat entitlement that unlocks Premium. */
export const PREMIUM_ENTITLEMENT_ID = '__ENTITLEMENT_ID__';

/** The packages of the default offering, by RevenueCat's standard package ids. */
export const SUBSCRIPTION_PACKAGE_IDS = {
  monthly: '$rc_monthly',
  annual: '$rc_annual',
} as const;
