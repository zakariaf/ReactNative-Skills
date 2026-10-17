// src/ui/motion/use-screen-animation.test.tsx
import { renderHook } from '@testing-library/react-native';

import { MotionConfig } from '@/ui/a11y/motion-config';
import { systemA11yStore } from '@/ui/a11y/system-a11y-store';

import { screenAnimationFor, useScreenAnimation } from './use-screen-animation';

import type { ReduceMotionPreference } from '@/ui/a11y/use-reduce-motion';
import type { ReactNode } from 'react';

function withMotion(preference: ReduceMotionPreference) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return <MotionConfig preference={preference}>{children}</MotionConfig>;
  };
}

describe('screenAnimationFor', () => {
  it('keeps the normal animation while motion is not reduced', () => {
    expect(screenAnimationFor(false)).toBe('default');
    expect(screenAnimationFor(false, 'slide_from_bottom')).toBe('slide_from_bottom');
  });

  it('cross-fades instead of moving while motion is reduced', () => {
    expect(screenAnimationFor(true)).toBe('fade');
    expect(screenAnimationFor(true, 'slide_from_bottom')).toBe('fade');
    expect(screenAnimationFor(true, 'none')).toBe('none');
  });
});

describe('useScreenAnimation', () => {
  beforeEach(() => {
    systemA11yStore.setState({ isReduceMotionOn: false });
  });

  it('follows the in-app reduce-motion preference', async () => {
    const { result: reduced } = await renderHook(() => useScreenAnimation(), {
      wrapper: withMotion('on'),
    });
    const { result: moving } = await renderHook(() => useScreenAnimation('slide_from_bottom'), {
      wrapper: withMotion('off'),
    });
    expect(reduced.current).toBe('fade');
    expect(moving.current).toBe('slide_from_bottom');
  });
});
