// src/services/clock/fake-clock.test.ts
import { createFakeClock } from './fake-clock';

describe('createFakeClock', () => {
  it('returns the time it was given', () => {
    expect(createFakeClock(5).nowMs()).toBe(5);
  });
});
