// src/stores/premium/upsell-line.test.ts
import { upsellPrice } from './upsell-line';

import type { UpsellInput } from './upsell-line';

const TODAY = '2026-10-10';
const FIRST: UpsellInput = {
  isPremium: false,
  priceText: '$2.99',
  lastShownOn: null,
  today: TODAY,
};

describe('upsellPrice', () => {
  it('shows the store price the first time', () => {
    expect(upsellPrice(FIRST)).toBe('$2.99');
  });

  it('shows at most once per local day', () => {
    expect(upsellPrice({ ...FIRST, lastShownOn: TODAY })).toBeNull();
    expect(upsellPrice({ ...FIRST, lastShownOn: '2026-10-09' })).toBe('$2.99');
  });

  it('hides the line from an owner and without a store price', () => {
    expect(upsellPrice({ ...FIRST, isPremium: true })).toBeNull();
    expect(upsellPrice({ ...FIRST, priceText: null })).toBeNull();
  });
});
