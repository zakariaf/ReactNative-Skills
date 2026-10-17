// src/ui/motion/use-motion-loop.test.tsx
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { MOTION_MS } from '@/theme/motion';
import { MotionConfig } from '@/ui/a11y/motion-config';
import { systemA11yStore } from '@/ui/a11y/system-a11y-store';

import { loopRunsWhen, useMotionLoop } from './use-motion-loop';

import type { MotionMoment } from './motion-moments';
import type { LoopGates } from './use-motion-loop';
import type { ReduceMotionPreference } from '@/ui/a11y/use-reduce-motion';
import type { ReactNode } from 'react';
import type { AppStateStatus } from 'react-native';

const PULSE = {
  kind: 'attention',
  trigger: 'A list is syncing',
  timing: { duration: 'slow', easing: 'standard' },
  reduced: 'static',
} as const satisfies MotionMoment;

const FOCUSED: LoopGates = { isFocused: true };
const HALF_SWING_MS = MOTION_MS.slow / 2;
const RUNNING = { isFocused: true, isAppActive: true, isReducedMotion: false };

let notifyAppState: () => void = () => undefined;

/** A fake OS: AppState.currentState as given, and the listener the hook registers. */
function setAppState(state: AppStateStatus): void {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
  notifyAppState();
}

function withMotion(preference: ReduceMotionPreference) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <MotionConfig preference={preference}>{children}</MotionConfig>;
  };
}

async function renderLoop(preference: ReduceMotionPreference) {
  return renderHook((gates: LoopGates) => useMotionLoop(PULSE, gates), {
    initialProps: FOCUSED,
    wrapper: withMotion(preference),
  });
}

async function advance(ms: number): Promise<void> {
  await act(() => {
    jest.advanceTimersByTime(ms);
  });
}

describe('loopRunsWhen', () => {
  it('runs only while focused, active and not reduced', () => {
    expect(loopRunsWhen(RUNNING)).toBe(true);
    expect(loopRunsWhen({ ...RUNNING, isReducedMotion: true })).toBe(false);
    expect(loopRunsWhen({ ...RUNNING, isFocused: false })).toBe(false);
    expect(loopRunsWhen({ ...RUNNING, isAppActive: false })).toBe(false);
  });
});

describe('useMotionLoop', () => {
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      notifyAppState = () => {
        listener('active');
      };
      return { remove: jest.fn() };
    });
    setAppState('active');
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('swings the phase while the screen is visible', async () => {
    const { result } = await renderLoop('off');
    await advance(HALF_SWING_MS);
    expect(result.current.get()).toBeGreaterThan(0);
  });

  it('stops at rest when the screen loses focus', async () => {
    const { result, rerender } = await renderLoop('off');
    await advance(HALF_SWING_MS);
    await rerender({ isFocused: false });
    await advance(MOTION_MS.slow * 3);
    expect(result.current.get()).toBe(0);
  });

  it('stops at rest when the app leaves the foreground', async () => {
    const { result } = await renderLoop('off');
    await advance(HALF_SWING_MS);
    await act(() => {
      setAppState('background');
    });
    await advance(MOTION_MS.slow * 3);
    expect(result.current.get()).toBe(0);
  });

  it('holds still while motion is reduced', async () => {
    const { result } = await renderLoop('on');
    await advance(HALF_SWING_MS);
    expect(result.current.get()).toBe(0);
  });

  it('stops a running loop when the phone switch turns reduce motion on', async () => {
    const { result } = await renderLoop('system');
    await advance(HALF_SWING_MS);
    await act(() => {
      systemA11yStore.setState({ isReduceMotionOn: true });
    });
    await advance(MOTION_MS.slow * 3);
    expect(result.current.get()).toBe(0);
  });
});
