// src/ui/a11y/use-reduce-motion.ts
// The one reduce-motion answer every animation reads. Owned by the accessibility-as-code skill.
// The phone's switch comes from systemA11yStore; an in-app override (a "Reduce motion" setting)
// arrives through MotionConfig's preference prop. Never read Reanimated's useReducedMotion(): it
// returns a value captured when the module loaded, so it misses live changes and the setting.
import { createContext, use } from 'react';
import { useStore } from 'zustand';

import { systemA11yStore } from './system-a11y-store';

/** The in-app choice: follow the phone ('system'), or force reduced motion on or off. */
export type ReduceMotionPreference = 'system' | 'on' | 'off';

/** Pure: an explicit choice wins; 'system' follows the phone's switch. */
export function resolveReduceMotion(
  preference: ReduceMotionPreference,
  isSystemOn: boolean,
): boolean {
  if (preference === 'system') return isSystemOn;
  return preference === 'on';
}

/** Provided by MotionConfig at the root; without a provider the app follows the phone. */
export const ReduceMotionPreferenceContext = createContext<ReduceMotionPreference>('system');

/** True when animations must use their reduced alternative (fade, instant, static). */
export function useReduceMotion(): boolean {
  const preference = use(ReduceMotionPreferenceContext);
  const isSystemOn = useStore(systemA11yStore, (state) => state.isReduceMotionOn);
  return resolveReduceMotion(preference, isSystemOn);
}
