// src/services/subscription/subscription-price-text.ts: the price to pay, exactly as the store shows it.
import type { SubscriptionPackage } from './subscription-port';

/**
 * The store's localized price string, unchanged, or null when the store sent none (the paywall
 * then shows "store unavailable": nothing is sold without a price). Never typed into code or
 * catalogs, never rebuilt from a number.
 */
export function packagePriceText(pkg: SubscriptionPackage): string | null {
  return pkg.priceText.trim() === '' ? null : pkg.priceText;
}

/**
 * The per-month string the SDK computed for a longer period ("annual, about X a month"), or null.
 * The app never divides a price itself: rounding and currency rules belong to the store.
 */
export function monthlyEquivalentText(pkg: SubscriptionPackage): string | null {
  if (pkg.period === 'monthly' || pkg.pricePerMonthText === null) return null;
  return pkg.pricePerMonthText.trim() === '' ? null : pkg.pricePerMonthText;
}
