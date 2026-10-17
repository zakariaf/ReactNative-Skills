// src/services/purchase/product-price.ts
// Example: the purchase adapter turns a store product's price into Money once. expo-iap 5.8.0
// gives every product `displayPrice` (the store's text), `currency` (the storefront code) and
// `price`, a double, on iOS and Android alike: a one-time product has no top-level micros. Exact
// micros exist only inside Android subscription offers
// (`subscriptionOffers[].pricingPhasesAndroid.pricingPhaseList[].priceAmountMicros`), so a
// subscription reads them there and everything else converts the double.
// The Premium screen shows `displayPrice`, the store's own localized text, as the price to pay; the
// Money value is for arithmetic ("save 40 % yearly") and comparisons, formatted with formatMoney.
import { parseCurrencyCode } from '@/core/money/currency';
import { moneyFromMicros, moneyFromStoreDouble } from '@/core/money/store-price';
import { err } from '@/core/result';

import type { Money } from '@/core/money/money';
import type { Result } from '@/core/result';

type PricingPhaseFields = { readonly priceAmountMicros: string };

/** The fields the adapter reads from an expo-iap Product or ProductSubscription (they have more). */
export type StoreProductFields = {
  readonly displayPrice: string;
  readonly currency: string;
  // value-objects-allow float-money: expo-iap's own field (a double on both platforms), converted once below.
  readonly price?: number | null;
  /** Android subscriptions only: each offer's phases, the last one being the recurring price. */
  readonly subscriptionOffers?:
    | readonly {
        readonly pricingPhasesAndroid?: {
          readonly pricingPhaseList: readonly PricingPhaseFields[];
        } | null;
      }[]
    | null;
};

export type ProductPriceFailure =
  | { readonly kind: 'unknown-currency'; readonly code: string }
  | { readonly kind: 'no-price' }
  | { readonly kind: 'not-a-decimal' | 'too-many-decimals' | 'out-of-range' };

/** The recurring price of an Android subscription's first offer, in micros, or null. */
function subscriptionMicros(product: StoreProductFields): string | null {
  const phases = product.subscriptionOffers?.[0]?.pricingPhasesAndroid?.pricingPhaseList ?? [];
  return phases.at(-1)?.priceAmountMicros ?? null;
}

/** Micros when an Android subscription gives them (exact), else the double (rounded only within double noise). */
export function productPrice(product: StoreProductFields): Result<Money, ProductPriceFailure> {
  const currency = parseCurrencyCode(product.currency);
  if (!currency.ok) return currency;
  const micros = subscriptionMicros(product);
  if (micros !== null) return moneyFromMicros(micros, currency.value);
  const double = product.price ?? null;
  if (double === null) return err({ kind: 'no-price' });
  return moneyFromStoreDouble(double, currency.value);
}
