// src/services/time-change/fake-time-change.test.ts
import { createFakeTimeChange } from '@/services/time-change/fake-time-change';

import type { TimeChangeEvent } from '@/services/time-change/time-change-port';

describe('createFakeTimeChange', () => {
  it('answers the configured zone and automatic-time value', async () => {
    const fake = createFakeTimeChange({ timeZoneId: 'America/New_York', automaticTime: false });
    expect(fake.timeZoneId()).toStrictEqual({ ok: true, value: 'America/New_York' });
    await expect(fake.isAutomaticTimeEnabled()).resolves.toStrictEqual({ ok: true, value: false });
  });

  it('answers a configured failure, as iOS does for automatic time', async () => {
    const fake = createFakeTimeChange({ automaticTime: { kind: 'time-change-unsupported' } });
    await expect(fake.isAutomaticTimeEnabled()).resolves.toStrictEqual({
      ok: false,
      error: { kind: 'time-change-unsupported' },
    });
  });

  it('delivers emitted events, moves the zone and logs every call', () => {
    const fake = createFakeTimeChange();
    const seen: TimeChangeEvent[] = [];
    const unsubscribe = fake.subscribe((event) => {
      seen.push(event);
    });
    fake.emit({ reason: 'time-zone', timeZoneId: 'Asia/Tokyo' });
    expect(seen).toStrictEqual([{ reason: 'time-zone', timeZoneId: 'Asia/Tokyo' }]);
    expect(fake.timeZoneId()).toStrictEqual({ ok: true, value: 'Asia/Tokyo' });
    expect(fake.listenerCount()).toBe(1);
    unsubscribe();
    fake.emit({ reason: 'day-change', timeZoneId: 'Asia/Tokyo' });
    expect(seen).toHaveLength(1);
    expect(fake.listenerCount()).toBe(0);
    expect(fake.calls).toStrictEqual(['subscribe', 'timeZoneId', 'unsubscribe']);
  });
});
