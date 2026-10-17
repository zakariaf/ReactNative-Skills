// src/core/permissions/permission-state.ts
// The permission states the app acts on, and the one decision every ask makes: what happens when a
// person presses a control that needs a permission. Pure: no React, React Native or Expo imports,
// so every platform rule here is a millisecond test. Owned by the permissions-and-system-prompts
// skill; the adapters (src/services/permissions/) map each OS answer to one of these states.

/**
 * A permission as the app acts on it:
 * - granted: full access;
 * - limited: partial access the person chose (iOS "Select Photos", Android 14 "Allow limited access",
 *   approximate location); the feature works with what it was given and may offer to widen it;
 * - provisional: iOS delivers notifications quietly without having asked (counts as allowed);
 * - undetermined: never asked, so the system dialog can still appear;
 * - denied: refused, but the OS still shows its dialog once more (Android only: after a first
 *   "Don't allow"; iOS never reports this state);
 * - blocked: the system dialog will not appear again (iOS after any refusal, Android after the second
 *   refusal or "Don't ask again"); only the system Settings app can change it;
 * - unavailable: this device or platform has no such capability, or the state could not be read.
 */
export type PermissionState =
  'granted' | 'limited' | 'provisional' | 'undetermined' | 'denied' | 'blocked' | 'unavailable';

/** The states in which the feature may use the capability. */
export type AllowedPermissionState = Extract<
  PermissionState,
  'granted' | 'limited' | 'provisional'
>;

/** True when the feature may use the capability (fully, partly or quietly). */
export function isPermissionAllowed(state: PermissionState): state is AllowedPermissionState {
  return state === 'granted' || state === 'limited' || state === 'provisional';
}

/**
 * The next step after a person pressed a control that needs the permission:
 * - proceed: use the capability now;
 * - ask: show the system dialog now (the control itself explains why);
 * - explain: show the app's explanation first, with one button that opens the system dialog;
 * - rationale: Android's educational screen before asking again, with "Continue" and "No thanks";
 * - settings: explain that only the Settings app can turn it on, and offer to open it;
 * - unavailable: say the feature cannot work on this device.
 */
export type AskStep = 'proceed' | 'ask' | 'explain' | 'rationale' | 'settings' | 'unavailable';

/** Per permission: whether the control alone explains the need (contracts/permissions.json). */
export type AskPolicy = {
  /** True when the app explains the need on its own screen before the first system dialog. */
  readonly shouldExplainFirst: boolean;
};

/** The step for the current state; the state is read fresh at the press, never from a cache. */
export function nextAskStep(state: PermissionState, policy: AskPolicy): AskStep {
  switch (state) {
    case 'granted':
    case 'limited':
    case 'provisional':
      return 'proceed';
    case 'undetermined':
      return policy.shouldExplainFirst ? 'explain' : 'ask';
    case 'denied':
      return 'rationale';
    case 'blocked':
      return 'settings';
    case 'unavailable':
      return 'unavailable';
  }
}
