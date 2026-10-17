// src/services/haptics/expo-haptics-adapter.ts
// The only file that imports expo-haptics (verified on 57.0.3).
import {
  AndroidHaptics,
  ImpactFeedbackStyle,
  NotificationFeedbackType,
  impactAsync,
  notificationAsync,
  performAndroidHapticsAsync,
  selectionAsync,
} from 'expo-haptics';
import { Platform } from 'react-native';

import { shouldPulse } from './should-pulse';

import type { HapticCue, HapticsPort } from './haptics-port';

/** What the adapter needs to know about the device: read from Platform unless a test passes it. */
export type HapticsDevice = {
  readonly os: 'ios' | 'android' | 'other';
  readonly isPad: boolean;
  /** The Android API level (0 elsewhere). */
  readonly apiLevel: number;
};

export type HapticsDeps = {
  /** The user's haptics preference, read at call time. */
  readonly isEnabled: () => boolean;
  /** ClockPort.nowMs (epoch ms); never Date.now(). */
  readonly nowMs: () => number;
  readonly device?: HapticsDevice;
};

/** iOS (and web): one feedback-generator call per cue. */
function fireIos(cue: HapticCue): Promise<void> {
  switch (cue) {
    case 'selection':
      return selectionAsync();
    case 'light':
      return impactAsync(ImpactFeedbackStyle.Light);
    case 'medium':
      return impactAsync(ImpactFeedbackStyle.Medium);
    case 'heavy':
      return impactAsync(ImpactFeedbackStyle.Heavy);
    case 'success':
      return notificationAsync(NotificationFeedbackType.Success);
    case 'warning':
      return notificationAsync(NotificationFeedbackType.Warning);
    case 'error':
      return notificationAsync(NotificationFeedbackType.Error);
  }
}

/** The API level where every constant of ANDROID_CUES exists (Segment_Tick came with Android 14). */
export const ANDROID_CUES_API = 34;

/** The API level where Confirm and Reject exist (Android 11): the outcome cues keep their meaning. */
export const ANDROID_OUTCOME_CUES_API = 30;

/**
 * Android: View.performHapticFeedback constants by meaning. performAndroidHapticsAsync needs no
 * VIBRATE use and follows the system's touch-feedback setting, as iOS follows System Haptics.
 */
const ANDROID_CUES = {
  selection: AndroidHaptics.Segment_Tick,
  light: AndroidHaptics.Context_Click,
  medium: AndroidHaptics.Virtual_Key,
  heavy: AndroidHaptics.Long_Press,
  success: AndroidHaptics.Confirm,
  warning: AndroidHaptics.Reject,
  error: AndroidHaptics.Reject,
} as const satisfies Readonly<Record<HapticCue, AndroidHaptics>>;

/**
 * API 30 to 33: Confirm and Reject exist, Segment_Tick does not (expo-haptics 57.0.3 looks the
 * constant up by reflection and rejects a newer one).
 */
const ANDROID_API_30_CUES = {
  selection: AndroidHaptics.Clock_Tick,
  light: AndroidHaptics.Context_Click,
  medium: AndroidHaptics.Virtual_Key,
  heavy: AndroidHaptics.Long_Press,
  success: AndroidHaptics.Confirm,
  warning: AndroidHaptics.Reject,
  error: AndroidHaptics.Reject,
} as const satisfies Readonly<Record<HapticCue, AndroidHaptics>>;

/** Below API 30: the nearest constant every supported level (minSdk 24) has. */
const ANDROID_LEGACY_CUES = {
  selection: AndroidHaptics.Clock_Tick,
  light: AndroidHaptics.Context_Click,
  medium: AndroidHaptics.Virtual_Key,
  heavy: AndroidHaptics.Long_Press,
  success: AndroidHaptics.Context_Click,
  warning: AndroidHaptics.Long_Press,
  error: AndroidHaptics.Long_Press,
} as const satisfies Readonly<Record<HapticCue, AndroidHaptics>>;

/** The Android constant for a cue on a device of this API level. */
export function androidHapticFor(cue: HapticCue, apiLevel: number): AndroidHaptics {
  if (apiLevel >= ANDROID_CUES_API) return ANDROID_CUES[cue];
  if (apiLevel >= ANDROID_OUTCOME_CUES_API) return ANDROID_API_30_CUES[cue];
  return ANDROID_LEGACY_CUES[cue];
}

function fire(cue: HapticCue, device: HapticsDevice): Promise<void> {
  if (device.os === 'android') {
    return performAndroidHapticsAsync(androidHapticFor(cue, device.apiLevel));
  }
  return fireIos(cue);
}

/** The running device, read from Platform. */
export function currentHapticsDevice(): HapticsDevice {
  if (Platform.OS === 'ios') return { os: 'ios', isPad: Platform.isPad, apiLevel: 0 };
  if (Platform.OS === 'android') {
    return { os: 'android', isPad: false, apiLevel: Platform.Version };
  }
  return { os: 'other', isPad: false, apiLevel: 0 };
}

export function createExpoHapticsAdapter(deps: HapticsDeps): HapticsPort {
  const device = deps.device ?? currentHapticsDevice();
  // iPads have no haptic engine; phones do (an Android device without a vibrator ignores the call).
  const isSupported = !device.isPad;
  let lastAtMs: number | null = null;
  return {
    isSupported,
    play: (cue) => {
      const nowMs = deps.nowMs();
      if (!isSupported || !shouldPulse({ isEnabled: deps.isEnabled(), lastAtMs, nowMs })) return;
      lastAtMs = nowMs;
      // expo-haptics 57.0.3 rejects when its native module is missing (a build made before it was
      // added) and, on Android, when the React context is gone during a reload or a constant is
      // newer than the device; iOS stays silent in Low Power Mode or while the camera runs.
      // best-effort: haptics are decoration; a missed pulse costs the user nothing.
      fire(cue, device).catch(() => undefined);
    },
  };
}
