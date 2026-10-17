// src/ui/feedback/use-delayed-visibility.test.ts
// no-providers: the hook reads no React context; its timing rule is covered by delayed-flag.test.ts,
// this test proves the React wiring (real timers through jest's fake clock, cleanup on unmount).
import { act, renderHook } from '@testing-library/react-native';

import { PLACEHOLDER_TIMING } from './feedback-timing';
import { useDelayedVisibility } from './use-delayed-visibility';

import type { Schedule } from './delayed-flag';

describe('useDelayedVisibility', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('turns true only after the show delay, and holds after the work ends', async () => {
    const view = await renderHook(
      (props: { isActive: boolean }) => useDelayedVisibility(props.isActive),
      {
        initialProps: { isActive: true },
      },
    );
    expect(view.result.current).toBe(false);
    await act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(view.result.current).toBe(true);
    await view.rerender({ isActive: false });
    expect(view.result.current).toBe(true);
    await act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(view.result.current).toBe(false);
  });

  it('leaves no timer behind when it unmounts while waiting', async () => {
    // React's own scheduler also uses timers, so the hook's timers are counted through its seam.
    const pending = new Set<() => void>();
    const schedule: Schedule = (task) => {
      pending.add(task);
      return () => {
        pending.delete(task);
      };
    };
    const view = await renderHook(() => useDelayedVisibility(true, PLACEHOLDER_TIMING, schedule));
    expect(pending.size).toBe(1);
    await view.unmount();
    expect(pending.size).toBe(0);
  });
});
