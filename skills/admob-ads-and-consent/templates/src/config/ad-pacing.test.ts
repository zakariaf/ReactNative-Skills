// src/config/ad-pacing.test.ts — the pacing is well formed: whole, non-negative numbers and unique
// banner screens named like their slot's testID prefix.
import { AD_PACING } from './ad-pacing';

describe('AD_PACING', () => {
  it('holds whole, non-negative pacing numbers', () => {
    const numbers = [
      AD_PACING.minBreaksBeforeFirst,
      AD_PACING.minMsBetweenInterstitials,
      AD_PACING.minBreaksBetween,
    ];
    for (const value of numbers) expect(Number.isSafeInteger(value) && value >= 0).toBe(true);
  });

  it('names each banner screen once, in kebab case', () => {
    expect(new Set(AD_PACING.bannerScreens).size).toBe(AD_PACING.bannerScreens.length);
    for (const screen of AD_PACING.bannerScreens) expect(screen).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});
