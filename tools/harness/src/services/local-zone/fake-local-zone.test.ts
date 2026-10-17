// src/services/local-zone/fake-local-zone.test.ts
import { berlin2026, newYork2026 } from '@test/reminders/rule-zone';

import { createFakeLocalZone } from './fake-local-zone';

const JULY = Date.UTC(2026, 6, 15, 12);

describe('createFakeLocalZone', () => {
  it('is UTC by default', () => {
    expect(createFakeLocalZone().offsetAt(JULY)).toBe(0);
  });

  it('answers from the rules it was given, and from new rules after travel', () => {
    const zone = createFakeLocalZone(berlin2026);
    const before = zone.offsetAt(JULY);
    zone.travel(newYork2026);

    expect([before, zone.offsetAt(JULY)]).toStrictEqual([7_200_000, -14_400_000]);
  });
});
