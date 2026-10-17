// src/services/push/push-port.ts
// The PushPort: what the app needs from the phone's push stack (expo-notifications, APNs on iOS,
// Firebase Cloud Messaging on Android) and nothing more: the notification permission, Android
// channels, this device's push token and its rotations, and taps on notifications. Expected
// failures are Result values; nothing here rejects. Adapter: expo-notifications-push-adapter.ts.
// Fake: fake-push.ts.
import type { Result } from '@/core/result';

/**
 * The notification permission as the app acts on it (the same five states as local-notifications'
 * NotificationPermission, a subset of permissions-and-system-prompts' PermissionState, so this port
 * is a PermissionAccess for the `notifications` kind):
 * - granted: alerts allowed;
 * - provisional: iOS delivers quietly to Notification Center without having asked (counts as allowed);
 * - undetermined: never asked, so the system prompt can still appear;
 * - denied: refused, but Android 13+ may still show the prompt once more;
 * - blocked: the prompt will never appear again (iOS after any refusal, Android after the second);
 *   only the system Settings can turn notifications on.
 */
export type PushPermission = 'granted' | 'provisional' | 'undetermined' | 'denied' | 'blocked';

/** True when the app may register a token (and the OS will deliver, loudly or quietly). */
export function isPushAllowed(permission: PushPermission): boolean {
  return permission === 'granted' || permission === 'provisional';
}

/**
 * This device's address for the push service: an Expo push token (the Expo push service talks to
 * APNs and FCM) or the raw APNs or FCM token (a server that talks to them itself).
 */
export type PushToken = {
  readonly provider: 'expo' | 'apns' | 'fcm';
  readonly value: string;
  readonly platform: 'ios' | 'android';
};

/** Why no token could be fetched. */
export type PushTokenFailure =
  /** The permission is not granted (or provisional): ask in context first. */
  | { readonly kind: 'not-allowed' }
  /** The EAS project id is unknown, so the Expo push service cannot issue a token. */
  | { readonly kind: 'missing-project-id' }
  /** The Expo push service could not be reached (offline, timeout): try again later. */
  | { readonly kind: 'network-unavailable' }
  /**
   * The OS or the push service refused: no google-services.json in the build (Android), no
   * aps-environment entitlement (iOS), a simulator without push, Expo Go on Android. `code` is the
   * native error code when there is one.
   */
  | { readonly kind: 'token-unavailable'; readonly code: string | null };

/** An Android notification channel, with its texts already in the person's language. */
export type NamedPushChannel = {
  /** Stable forever: a channel id the server uses in `channelId` (contracts/push.json). */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Fixed at creation: Android lets an app change only the name and description afterwards. */
  readonly importance: 'high' | 'default' | 'low';
};

/** A person's interaction with a notification. */
export type PushResponse = {
  /** The notification's request id: the same tap can arrive twice (launch read and listener). */
  readonly id: string;
  /** 'open' for a tap on the notification itself, else the action button's identifier. */
  readonly action: string;
  /** The notification's custom data, unchecked: parse it with parsePushData before using it. */
  readonly data: unknown;
};

export type Unsubscribe = () => void;

/** The phone's push stack as the app uses it; expected failures are values, no member rejects. */
export type PushPort = {
  /** Reads the permission; never shows a prompt, never rejects (an SDK failure reads as undetermined). */
  readonly permission: () => Promise<PushPermission>;
  /**
   * Shows the system prompt when the OS still allows one, and resolves with the outcome. Only ever
   * called from a person's action, after the app explained why (never at launch). Never rejects:
   * an SDK failure is recorded and reads as denied.
   */
  readonly requestPermission: () => Promise<PushPermission>;
  /**
   * Creates or renames the Android channels (iOS has none: it resolves at once). Call it before
   * requestPermission and token: Android issues no token before a channel exists, and an app
   * targeting 12L or lower gets no prompt before one. Idempotent; never rejects (a failure is recorded).
   */
  readonly syncChannels: (channels: readonly NamedPushChannel[]) => Promise<void>;
  /** This device's token; `not-allowed` without the permission. Never prompts. */
  readonly token: () => Promise<Result<PushToken, PushTokenFailure>>;
  /** Calls `listener` with the new token whenever APNs or FCM rotates it while the app runs. */
  readonly onTokenChange: (listener: (token: PushToken) => void) => Unsubscribe;
  /** The tap that launched or last resumed the app, or null. */
  readonly lastResponse: () => PushResponse | null;
  /** Forgets the last response once handled, so a remount does not open it again. */
  readonly clearLastResponse: () => void;
  /** Calls `listener` for every tap while the app runs (backgrounded or in the foreground). */
  readonly onResponse: (listener: (response: PushResponse) => void) => Unsubscribe;
};
