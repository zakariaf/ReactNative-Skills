// src/features/paywall/plan-row-text.ts
import { monthlyEquivalentText, packagePriceText } from '@/services/subscription/subscription-price-text';

import type { SubscriptionPackage } from '@/services/subscription/subscription-port';

/** The message key and values of one plan row; the price is the store's own string. */
export function planRowText(pkg: SubscriptionPackage): { readonly key: string; readonly priceText: string | null; readonly perMonth: string | null } {
  const key = pkg.period === 'annual' ? 'paywall.plan.annual' : 'paywall.plan.monthly';
  return { key, priceText: packagePriceText(pkg), perMonth: monthlyEquivalentText(pkg) };
}
