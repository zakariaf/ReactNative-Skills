// src/services/clock/fake-clock.test.ts
import { createFakeClock } from './fake-clock';

describe('createFakeClock', () => {
  it('starts at the given time and day, twelve hours before midnight by default', () => {
    const clock = createFakeClock({ nowMs: 1000, today: '2026-09-28' });

    expect([clock.nowMs(), clock.today(), clock.msUntilNextLocalDay()]).toStrictEqual([
      1000,
      '2026-09-28',
      43_200_000,
    ]);
  });

  it('moves time only when advanced', () => {
    const clock = createFakeClock({ nowMs: 1000, today: '2026-09-28' });
    clock.advance(180_000);

    expect([clock.nowMs(), clock.msUntilNextLocalDay()]).toStrictEqual([181_000, 43_020_000]);
  });

  it('jumps to another day', () => {
    const clock = createFakeClock({ nowMs: 0, today: '2026-09-28' });
    clock.setToday('2026-09-29');

    expect(clock.today()).toBe('2026-09-29');
  });

  it('moves to the next day when time passes local midnight', () => {
    const clock = createFakeClock({
      nowMs: 0,
      today: '2026-12-31',
      msUntilNextLocalDay: 60_000,
    });
    clock.advance(59_999);

    expect([clock.today(), clock.msUntilNextLocalDay()]).toStrictEqual(['2026-12-31', 1]);

    clock.advance(1);

    expect([clock.today(), clock.msUntilNextLocalDay()]).toStrictEqual(['2027-01-01', 86_400_000]);
  });

  it('goes back a day when the phone clock is set back past midnight', () => {
    const clock = createFakeClock({
      nowMs: 0,
      today: '2026-09-28',
      msUntilNextLocalDay: 60_000,
    });
    clock.advance(-86_400_000);

    expect([clock.today(), clock.msUntilNextLocalDay()]).toStrictEqual(['2026-09-27', 60_000]);
  });

  it('rejects a countdown longer than a day', () => {
    expect(() =>
      createFakeClock({
        nowMs: 0,
        today: '2026-09-28',
        msUntilNextLocalDay: 86_400_001,
      }),
    ).toThrow(RangeError);
  });
});
