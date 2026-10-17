// src/services/local-zone/system-local-zone-adapter.test.ts
// Jest runs with TZ=UTC (jest.config.js), so the device zone here is UTC all year. Daylight saving
// is proved with rule zones in src/core/reminders/wall-clock.test.ts and on a device
// (references/testing-and-devices.md, the zone probe).
import { createSystemLocalZoneAdapter } from './system-local-zone-adapter';

const JANUARY = Date.UTC(2026, 0, 15, 12);
const JULY = Date.UTC(2026, 6, 15, 12);

describe('createSystemLocalZoneAdapter', () => {
  it('reports the engine offset as milliseconds east of UTC', () => {
    const zone = createSystemLocalZoneAdapter();

    expect([JANUARY, JULY].map(zone.offsetAt)).toStrictEqual(
      [JANUARY, JULY].map((instantMs) => 0 - new Date(instantMs).getTimezoneOffset() * 60_000),
    );
  });

  it('answers 0 under the UTC test zone, never minus zero', () => {
    expect(Object.is(createSystemLocalZoneAdapter().offsetAt(Date.UTC(2026, 9, 14)), 0)).toBe(true);
  });
});
