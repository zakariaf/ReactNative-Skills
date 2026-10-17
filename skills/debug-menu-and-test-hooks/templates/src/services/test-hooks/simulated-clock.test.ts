// src/services/test-hooks/simulated-clock.test.ts
import { createFakeClock } from '@/services/clock/fake-clock';

import { createSimulatedClock } from './simulated-clock';

import type { DateKey } from '@/core/dates/date-key';

describe('createSimulatedClock', () => {
  it('answers the real day while nothing is simulated', () => {
    const real = createFakeClock({ nowMs: 1_000, today: '2030-01-10' });

    expect(createSimulatedClock(real, () => null).today()).toBe('2030-01-10');
  });

  it('changes today() only, at once, and keeps time and the countdown real', () => {
    const real = createFakeClock({ nowMs: 5_000, today: '2030-01-10', msUntilNextLocalDay: 600 });
    let simulated: DateKey | null = null;
    const clock = createSimulatedClock(real, () => simulated);

    simulated = '2030-03-01';

    expect(clock.today()).toBe('2030-03-01');
    expect(clock.nowMs()).toBe(5_000);
    expect(clock.msUntilNextLocalDay()).toBe(600);
  });

  it('follows the real clock when time moves', () => {
    const real = createFakeClock({ nowMs: 0, today: '2030-01-10', msUntilNextLocalDay: 100 });
    const clock = createSimulatedClock(real, () => null);

    real.advance(150);

    expect(clock.nowMs()).toBe(150);
    expect(clock.today()).toBe('2030-01-11');
  });
});
