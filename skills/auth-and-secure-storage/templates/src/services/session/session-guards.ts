// src/services/session/session-guards.ts
// The three booleans a navigator's Stack.Protected guards read. While the session is restoring (or
// the keychain is locked) neither group is open: only the "checking your session" route is, so no
// protected screen renders, not even for one frame, before the stored session is known. The splash
// is app-startup-and-bootstrap's (one hold, one release after the startup gate); auth never touches it.
import type { SessionSnapshot } from './session-types';

export type SessionGuards = {
  /** The session is unknown: open only the checking-session route, no route group. */
  readonly isRestoring: boolean;
  /** Opens the signed-in group, e.g. Stack.Protected guard={isSignedIn} around "(app)". */
  readonly isSignedIn: boolean;
  /** Opens the signed-out routes (sign-in, sign-up). */
  readonly isSignedOut: boolean;
};

export function sessionGuards(snapshot: SessionSnapshot): SessionGuards {
  return {
    isRestoring: snapshot.status === 'restoring' || snapshot.status === 'unavailable',
    isSignedIn: snapshot.status === 'signed-in',
    isSignedOut: snapshot.status === 'signed-out',
  };
}
