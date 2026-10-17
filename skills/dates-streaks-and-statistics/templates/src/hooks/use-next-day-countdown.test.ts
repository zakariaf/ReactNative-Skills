// src/hooks/use-next-day-countdown.test.ts
// The hook's own timer is the unit under test, so Jest's fake timers drive it; the time left comes
// from the fake clock, moved in step with the timers.
import { act } from '@testing-library/react-native';

import { createFakeClock } from '@/services/clock/fake-clock';
import { renderHookWithProviders } from '@test/render-with-providers';

import { msUntilMinuteChange, useNextDayCountdown } from './use-next-day-countdown';

const MINUTE_MS = 60_000;

describe('useNextDayCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the time left to local midnight and follows the clock', async () => {
    const clock = createFakeClock({
      nowMs: 1_790_424_000_000,
      today: '2026-09-26',
      msUntilNextLocalDay: 11_100_000,
    });
    const { result } = await renderHookWithProviders(() => useNextDayCountdown(), {
      services: { clock },
    });

    expect(result.current).toStrictEqual({ hours: 3, minutes: 5 });

    await act(() => {
      clock.advance(11_070_000);
      jest.advanceTimersByTime(MINUTE_MS);
    });

    expect(result.current).toStrictEqual({ hours: 0, minutes: 1 });
  });

  it('changes exactly when the shown minute changes', async () => {
    const clock = createFakeClock({ nowMs: 0, today: '2026-09-26', msUntilNextLocalDay: 180_001 });
    const { result } = await renderHookWithProviders(() => useNextDayCountdown(), {
      services: { clock },
    });

    expect(result.current).toStrictEqual({ hours: 0, minutes: 4 });

    await act(() => {
      clock.advance(1);
      jest.advanceTimersByTime(1);
    });

    expect(result.current).toStrictEqual({ hours: 0, minutes: 3 });
  });
});

describe('msUntilMinuteChange', () => {
  it('waits until the rounded-up minute turns', () => {
    expect([180_001, 180_000, 59_999, 1].map(msUntilMinuteChange)).toStrictEqual([
      1, 60_000, 59_999, 1,
    ]);
  });
});
