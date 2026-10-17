// src/features/root-navigator/root-motion.tsx
// The root stack's one motion provider (app-startup-and-bootstrap): MotionConfig, or the motion slot
// of the app's registry (src/services/root-kits/root-kit.ts, `motion`) in its place. The preference
// is the one above it: "system" by default, the saved choice once settings-and-preferences'
// PreferencesRoot provides it (ReduceMotionPreferenceContext). With no kit that fills the slot it is
// the app's MotionConfig with that preference; a kit that fills it renders MotionConfig itself with
// the preference it decides (a test build holds every animation still while its switch says so), so
// the app keeps exactly one MotionConfig and Reanimated's global mode has one owner. A
// file of its own (react/no-multi-comp) so the root stack keeps its providers literally nested,
// GestureHandlerRootView > KeyboardProvider > RootMotion > NavigationThemeProvider > AppStack, which
// check-startup's provider-order reads ("MotionConfig|RootMotion" in rootStackOrder).
import { use } from 'react';

import { kitMotion } from '@/services/root-kits/root-kit';
import { MotionConfig } from '@/ui/a11y/motion-config';
import { ReduceMotionPreferenceContext } from '@/ui/a11y/use-reduce-motion';

import type { RootKit } from '@/services/root-kits/root-kit';
import type { ReactNode } from 'react';

export type RootMotionProps = {
  /** The kits AppRoot's startApp created (none: the plain MotionConfig). */
  readonly kits: readonly RootKit[];
  readonly children: ReactNode;
};

/** MotionConfig with the preference above it, or the first kit's motion slot in its place. */
export function RootMotion({ kits, children }: RootMotionProps): ReactNode {
  // "system" until the app has the setting; PreferencesRoot provides the saved choice above.
  const preference = use(ReduceMotionPreferenceContext);
  const motion = kitMotion(kits);
  if (motion === null) return <MotionConfig preference={preference}>{children}</MotionConfig>;
  return motion({ preference, children });
}
