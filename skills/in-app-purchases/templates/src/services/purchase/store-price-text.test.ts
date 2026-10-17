// src/services/purchase/store-price-text.test.ts
import { storePriceText } from './store-price-text';

import type { StoreProduct } from './purchase-port';

// StoreKit's Decimal arrives as a binary double (1.99 EUR arrived as 1.9899999999999998).
const PREMIUM: StoreProduct = {
  productId: 'p',
  displayPrice: '€1.99',
  price: 1.9899999999999998,
  currency: 'EUR',
};

describe('storePriceText', () => {
  it("shows the store's own text", () => {
    expect(storePriceText(PREMIUM)).toBe('€1.99');
  });

  it('ignores the numeric price (never rebuilds the text)', () => {
    const forint = { ...PREMIUM, displayPrice: '1 190 Ft', price: 1190, currency: 'HUF' };

    expect(storePriceText(forint)).toBe('1 190 Ft');
  });

  it("keeps the store's digits and marks", () => {
    expect(storePriceText({ ...PREMIUM, displayPrice: '‏١٫٩٩ €' })).toBe('‏١٫٩٩ €');
  });

  it('answers null when the store sent no text', () => {
    expect(storePriceText({ ...PREMIUM, displayPrice: '' })).toBeNull();
    expect(storePriceText({ ...PREMIUM, displayPrice: '  ' })).toBeNull();
  });
});
