// src/services/haptics/haptics-port.ts
/**
 * The app's haptic vocabulary, by meaning. The adapter maps each cue to the platform: iOS feedback
 * generators, Android View.performHapticFeedback constants. A canvas track's cue uses the same
 * names.
 */
export type HapticCue =
  'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

/** The only haptics API the app uses. Adapter: expo-haptics-adapter.ts. Fake: fake-haptics.ts. */
export type HapticsPort = {
  /** False on devices without a haptic engine (iPad): the haptics preference row is hidden. */
  readonly isSupported: boolean;
  /** Fire-and-forget: gated by the user's preference and throttled; never throws. */
  readonly play: (cue: HapticCue) => void;
};
