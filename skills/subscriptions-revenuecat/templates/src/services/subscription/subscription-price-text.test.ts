// src/services/subscription/subscription-price-text.test.ts
import { monthlyEquivalentText, packagePriceText } from './subscription-price-text';

import type { SubscriptionPackage } from './subscription-port';

function pkg(overrides: Partial<SubscriptionPackage>): SubscriptionPackage {
  return {
    packageId: '$rc_annual',
    productId: 'com.example.tasks.premium.annual',
    period: 'annual',
    priceText: '1 190 Ft',
    pricePerMonthText: '99 Ft',
    ...overrides,
  };
}

describe('packagePriceText', () => {
  it('returns the store string unchanged, digits and marks kept', () => {
    expect(packagePriceText(pkg({}))).toBe('1 190 Ft');
  });

  it('returns null without a store string', () => {
    expect(packagePriceText(pkg({ priceText: ' ' }))).toBeNull();
  });
});

describe('monthlyEquivalentText', () => {
  it('uses the SDK per-month string for a longer period', () => {
    expect(monthlyEquivalentText(pkg({}))).toBe('99 Ft');
  });

  it('shows none for the monthly package or without an SDK string', () => {
    expect(monthlyEquivalentText(pkg({ period: 'monthly' }))).toBeNull();
    expect(monthlyEquivalentText(pkg({ pricePerMonthText: null }))).toBeNull();
  });
});
