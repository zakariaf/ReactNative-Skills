// src/core/push/foreground-presentation.ts
// What a notification does while the app is open in the foreground. The OS shows nothing by itself
// then: expo-notifications asks the one handler the push adapter installs, and a missing handler
// (or one slower than 3 s) means "show nothing" (expo-notifications 57). This policy decides it
// once, for remote pushes and for the app's own local notifications alike, so the app states its
// choice instead of inheriting a default.
import type { PushMessage } from './push-message';

/** The four switches iOS and Android understand while the app is in the foreground. */
export type ForegroundPresentation = {
  /** A banner (iOS) or heads-up notification (Android) over the app. */
  readonly banner: boolean;
  /** An entry in Notification Center / the notification shade. */
  readonly list: boolean;
  readonly sound: boolean;
  /** iOS only: apply the badge number the payload carries. */
  readonly badge: boolean;
};

/** What the handler knows about an incoming notification. */
export type ForegroundFacts = {
  /** True for a remote push, false for a notification the app scheduled itself. */
  readonly isRemote: boolean;
  /** The checked data (parsePushData), or null for data this build does not understand. */
  readonly message: PushMessage | null;
};

const LOUD: ForegroundPresentation = { banner: true, list: true, sound: true, badge: true };
const QUIET: ForegroundPresentation = { banner: false, list: true, sound: false, badge: true };

/**
 * A reminder the person scheduled and work handed to them interrupt; a broadcast and anything this
 * build does not understand (a newer server's kind) wait quietly in the list.
 */
export function foregroundPresentation({
  isRemote,
  message,
}: ForegroundFacts): ForegroundPresentation {
  if (!isRemote) return LOUD;
  if (message === null) return QUIET;
  switch (message.kind) {
    case 'task-assigned':
    case 'list-shared':
      return LOUD;
    case 'announcement':
      return QUIET;
  }
}
