// scripts/clock/system-clock.test.ts
// The tooling wall clock: the release-age check reads todayIso(), the App Store Connect JWT reads
// nowEpochSeconds(). Both are read here, so the two exports stay used and proven in every repo,
// with or without the App Store Connect client.
import { nowEpochSeconds, todayIso } from './system-clock.ts';

/** 2026-09-30T00:00:00Z, the day this clock was last changed: the clock never runs behind it. */
const WRITTEN_AT_SECONDS = 1_790_726_400;

describe('the tooling wall clock', () => {
  it('gives today as a UTC date', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayIso() >= '2026-09-30').toBe(true);
  });

  it('gives whole seconds since the epoch', () => {
    const seconds = nowEpochSeconds();
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(WRITTEN_AT_SECONDS);
  });
});
