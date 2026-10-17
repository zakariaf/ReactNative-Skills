// src/ui/a11y/motion-config.tsx
// Mounted once around the app (root layout). Owned by the accessibility-as-code skill. It gives
// useReduceMotion() the in-app preference and sets Reanimated's global reduce-motion mode, so
// every withTiming, withSpring and layout animation that keeps the default
// reduceMotion: ReduceMotion.System follows the live phone switch and the setting together.
// Functional timers (a hold-to-confirm fill) pass reduceMotion: ReduceMotion.Never themselves.
// Anything that reads useReduceMotion() renders below this provider, never in the component that
// mounts it (that read misses the preference; motion-and-animation's check-motion flags it). It
// does not reach Reanimated CSS animations or native stack transitions (motion-and-animation).
import { ReducedMotionConfig, ReduceMotion } from 'react-native-reanimated';
import { useStore } from 'zustand';

import { systemA11yStore } from './system-a11y-store';
import { ReduceMotionPreferenceContext, resolveReduceMotion } from './use-reduce-motion';

import type { ReduceMotionPreference } from './use-reduce-motion';
import type { ReactNode } from 'react';

export type MotionConfigProps = {
  /** The saved "Reduce motion" choice, or 'system' when the app has no such setting. */
  readonly preference: ReduceMotionPreference;
  readonly children: ReactNode;
};

export function MotionConfig({ preference, children }: MotionConfigProps): ReactNode {
  const isSystemOn = useStore(systemA11yStore, (state) => state.isReduceMotionOn);
  const isReduced = resolveReduceMotion(preference, isSystemOn);
  return (
    <ReduceMotionPreferenceContext value={preference}>
      <ReducedMotionConfig mode={isReduced ? ReduceMotion.Always : ReduceMotion.Never} />
      {children}
    </ReduceMotionPreferenceContext>
  );
}
