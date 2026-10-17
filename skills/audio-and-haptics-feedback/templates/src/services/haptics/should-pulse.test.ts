// src/services/haptics/should-pulse.test.ts
import { MIN_HAPTIC_GAP_MS, shouldPulse } from './should-pulse';

describe('shouldPulse', () => {
  it('stays silent when the haptics preference is off', () => {
    expect(shouldPulse({ isEnabled: false, lastAtMs: null, nowMs: 0 })).toBe(false);
  });

  it('throttles pulses closer than the minimum gap', () => {
    expect(
      shouldPulse({ isEnabled: true, lastAtMs: 1000, nowMs: 1000 + MIN_HAPTIC_GAP_MS - 1 }),
    ).toBe(false);
    expect(shouldPulse({ isEnabled: true, lastAtMs: 1000, nowMs: 1000 + MIN_HAPTIC_GAP_MS })).toBe(
      true,
    );
  });

  it('pulses again after the wall clock jumps backwards', () => {
    expect(shouldPulse({ isEnabled: true, lastAtMs: 5000, nowMs: 1000 })).toBe(true);
  });
});
