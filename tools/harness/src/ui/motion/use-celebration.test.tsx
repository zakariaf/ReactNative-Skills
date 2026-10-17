// src/ui/motion/use-celebration.test.tsx
import { act, renderHook } from '@testing-library/react-native';

import { MotionConfig } from '@/ui/a11y/motion-config';
import { systemA11yStore } from '@/ui/a11y/system-a11y-store';

import { useCelebration } from './use-celebration';

import type { MotionMoment } from './motion-moments';
import type { ReduceMotionPreference } from '@/ui/a11y/use-reduce-motion';
import type { ReactNode } from 'react';

const BURST = {
  kind: 'celebration',
  trigger: 'The last open task of a list is done',
  timing: { duration: 'slow', easing: 'decelerate', delay: 'fast', stagger: 'pressIn' },
  reduced: 'none',
  pieces: 12,
} as const satisfies MotionMoment;

function withMotion(preference: ReduceMotionPreference) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <MotionConfig preference={preference}>{children}</MotionConfig>;
  };
}

async function renderCelebration(preference: ReduceMotionPreference) {
  return renderHook(() => useCelebration(BURST), { wrapper: withMotion(preference) });
}

describe('useCelebration', () => {
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rests at the end state until something plays it', async () => {
    const { result } = await renderCelebration('off');
    expect(result.current.elapsedMs.get()).toBe(result.current.plan.totalMs);
  });

  it('plays from the start and ends within its plan', async () => {
    const { result } = await renderCelebration('off');
    const { totalMs } = result.current.plan;
    await act(() => {
      result.current.play('list-1');
      jest.advanceTimersByTime(totalMs / 2);
    });
    expect(result.current.elapsedMs.get()).toBeLessThan(totalMs);
    await act(() => {
      jest.advanceTimersByTime(totalMs);
    });
    expect(result.current.elapsedMs.get()).toBe(totalMs);
  });

  it('plays once per event key', async () => {
    const { result } = await renderCelebration('off');
    const { totalMs } = result.current.plan;
    await act(() => {
      result.current.play('list-1');
      jest.advanceTimersByTime(totalMs * 2);
      result.current.play('list-1');
    });
    expect(result.current.elapsedMs.get()).toBe(totalMs);
  });

  it('jumps to the end when skipped', async () => {
    const { result } = await renderCelebration('off');
    await act(() => {
      result.current.play('list-1');
      jest.advanceTimersByTime(result.current.plan.totalMs / 4);
      result.current.skip();
    });
    expect(result.current.elapsedMs.get()).toBe(result.current.plan.totalMs);
  });

  it('shows the end state at once while motion is reduced', async () => {
    const { result } = await renderCelebration('on');
    await act(() => {
      result.current.play('list-1');
    });
    expect(result.current.isReduced).toBe(true);
    expect(result.current.elapsedMs.get()).toBe(result.current.plan.totalMs);
  });
});
