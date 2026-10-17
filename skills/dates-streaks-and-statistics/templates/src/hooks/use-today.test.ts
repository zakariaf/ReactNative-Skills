// src/hooks/use-today.test.ts
// The hook's own timers are the unit under test, so Jest's fake timers drive them; the day itself
// comes from the fake clock, moved in step with the timers.
import { act } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { createFakeClock } from '@/services/clock/fake-clock';
import { renderHookWithProviders } from '@test/render-with-providers';

import { TODAY_RECHECK_MS, useToday } from './use-today';

const MINUTE_MS = 60_000;

/** Captures the hook's AppState listener and counts removals. */
function captureAppState(): { readonly change: () => void; readonly removed: number[] } {
  let listener: () => void = () => undefined;
  const removed: number[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, next) => {
    listener = next;
    return { remove: () => removed.push(1) };
  });
  return {
    change: () => {
      listener();
    },
    removed,
  };
}

describe('useToday', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('turns to the next day at local midnight while the screen stays open', async () => {
    captureAppState();
    const clock = createFakeClock({
      nowMs: 1_790_424_000_000,
      today: '2026-09-26',
      msUntilNextLocalDay: 5 * MINUTE_MS,
    });
    const { result } = await renderHookWithProviders(() => useToday(), { services: { clock } });

    expect(result.current).toBe('2026-09-26');

    await act(() => {
      clock.advance(5 * MINUTE_MS);
      jest.advanceTimersByTime(5 * MINUTE_MS);
    });

    expect(result.current).toBe('2026-09-27');
  });

  it('reads the day again when the app comes back to the foreground', async () => {
    const appState = captureAppState();
    const clock = createFakeClock({ nowMs: 0, today: '2026-09-26' });
    const { result } = await renderHookWithProviders(() => useToday(), { services: { clock } });

    clock.setToday('2026-09-28');
    await act(() => {
      appState.change();
    });

    expect(result.current).toBe('2026-09-28');
  });

  it('notices a clock changed by hand within a minute, with no long timer', async () => {
    captureAppState();
    const clock = createFakeClock({ nowMs: 0, today: '2026-09-26' });
    const { result } = await renderHookWithProviders(() => useToday(), { services: { clock } });

    clock.setToday('2026-10-02');
    await act(() => {
      jest.advanceTimersByTime(TODAY_RECHECK_MS);
    });

    expect(result.current).toBe('2026-10-02');
  });

  it('stops its timer and its listener on unmount', async () => {
    const appState = captureAppState();
    const fake = createFakeClock({ nowMs: 0, today: '2026-09-26' });
    let timerReads = 0;
    const clock = {
      ...fake,
      msUntilNextLocalDay: () => {
        timerReads += 1;
        return fake.msUntilNextLocalDay();
      },
    };
    const { unmount } = await renderHookWithProviders(() => useToday(), { services: { clock } });

    await unmount();
    const readsAtUnmount = timerReads;
    await act(() => {
      jest.advanceTimersByTime(5 * TODAY_RECHECK_MS);
    });

    expect([timerReads - readsAtUnmount, appState.removed.length]).toStrictEqual([0, 1]);
  });
});
