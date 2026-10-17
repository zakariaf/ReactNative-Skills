// src/ui/a11y/use-reduce-motion.test.tsx
// no-providers: the first hook test proves the no-provider default (without MotionConfig the hook
// follows the phone); the others pass their own ReduceMotionPreferenceContext wrapper.
import { act, renderHook } from '@testing-library/react-native';

import { systemA11yStore } from './system-a11y-store';
import {
  ReduceMotionPreferenceContext,
  resolveReduceMotion,
  useReduceMotion,
} from './use-reduce-motion';

import type { ReduceMotionPreference } from './use-reduce-motion';
import type { ReactNode } from 'react';

function withPreference(preference: ReduceMotionPreference) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <ReduceMotionPreferenceContext value={preference}>{children}</ReduceMotionPreferenceContext>
    );
  };
}

describe('resolveReduceMotion', () => {
  it('follows the phone while the preference is system', () => {
    expect(resolveReduceMotion('system', true)).toBe(true);
    expect(resolveReduceMotion('system', false)).toBe(false);
  });

  it('lets an explicit choice win over the phone', () => {
    expect(resolveReduceMotion('off', true)).toBe(false);
    expect(resolveReduceMotion('on', false)).toBe(true);
  });
});

describe('useReduceMotion', () => {
  // Reset before rendering, never after: RNTL unmounts in its own afterEach, which runs after this
  // block's, so a reset there would update a mounted hook outside act().
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false });
  });

  it('follows the live phone switch without a provider', async () => {
    const { result } = await renderHook(() => useReduceMotion());
    expect(result.current).toBe(false);

    await act(() => {
      systemA11yStore.setState({ isReduceMotionOn: true });
    });
    expect(result.current).toBe(true);
  });

  it('uses the in-app preference from MotionConfig', async () => {
    systemA11yStore.setState({ isReduceMotionOn: true });
    const { result: forcedOff } = await renderHook(() => useReduceMotion(), {
      wrapper: withPreference('off'),
    });
    const { result: forcedOn } = await renderHook(() => useReduceMotion(), {
      wrapper: withPreference('on'),
    });

    expect(forcedOff.current).toBe(false);
    expect(forcedOn.current).toBe(true);
  });
});
