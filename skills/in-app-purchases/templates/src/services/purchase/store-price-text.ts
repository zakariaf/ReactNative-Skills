// src/services/purchase/store-price-text.ts: the price to pay, exactly as the store shows it.
import type { StoreProduct } from './purchase-port';

/**
 * The store's own `displayPrice`, unchanged. The App Store and Google Play format it for the
 * device's locale and the storefront's currency, so it is the text the purchase sheet shows. It is
 * never rebuilt from the numeric `price`: Intl's fraction digits and symbol can differ from the
 * store's (HUF shows `1 190 Ft` in the store and `1 190,00 Ft` with the ISO 4217 exponent), and a
 * price is never typed into code or catalogs. Null when the store sent no text: with no price to
 * show, the paywall says "store unavailable".
 */
export function storePriceText(product: StoreProduct): string | null {
  return product.displayPrice.trim() === '' ? null : product.displayPrice;
}
