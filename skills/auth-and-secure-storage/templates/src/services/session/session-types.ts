// src/services/session/session-types.ts
// The session's public shapes: what the UI reads (SessionSnapshot), what a token call can answer
// (SessionFailure), what the manager needs (SessionManagerDeps) and what it offers (SessionManager).
import type { Result } from '@/core/result';
import type { Account, RefreshFailure, TokenGrant } from '@/core/session/token-set';
import type { ClockPort } from '@/services/clock/clock-port';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';
import type { InstallMarkerPort } from '@/services/install-marker/install-marker-port';
import type {
  SecureStorageFailure,
  SecureStoragePort,
} from '@/services/secure-storage/secure-storage-port';

/** Why someone was signed out by the app or by themselves. */
export type SignOutReason = 'user' | 'session-expired' | 'unauthorized' | 'account-deleted';

/**
 * Why the session reads signed-out: a sign-out, a fresh install's wipe, an unreadable session, a
 * secure store that failed twice while the phone was unlocked (values kept), or nothing stored.
 */
export type SignedOutReason =
  SignOutReason | 'fresh-install' | 'corrupt' | 'storage-unavailable' | null;

/** What the UI shows. The route guards read `status`; nothing secret is in here. */
export type SessionSnapshot =
  /** Before restore() finished: show no route that depends on it (the checking-session route). */
  | { readonly status: 'restoring' }
  /**
   * The secure store could not be read in the background (a keychain locked since the restart):
   * not signed out; the provider restores again in the foreground.
   */
  | { readonly status: 'unavailable' }
  | { readonly status: 'signed-out'; readonly reason: SignedOutReason }
  | { readonly status: 'signed-in'; readonly account: Account };

/** A failure that ends the session is handled inside the manager: callers see only these. */
export type SessionFailure =
  | { readonly kind: 'signed-out' }
  | Exclude<RefreshFailure, { readonly kind: 'invalid-grant' } | { readonly kind: 'rejected' }>;

/** Sign-in lost a race with a sign-out (the wipe ran after its write): nothing was published. */
export type SignInFailure = SecureStorageFailure | { readonly kind: 'sign-in-superseded' };

/** The token endpoint, as the session needs it (an OAuth adapter or the app's own API satisfies it). */
export type TokenRefresher = {
  /** Never rejects; RefreshFailure says whether the session is over. */
  readonly refresh: (refreshToken: string) => Promise<Result<TokenGrant, RefreshFailure>>;
  /** Best effort at sign-out (RFC 7009); its answer changes nothing on this device. */
  readonly revoke?: (refreshToken: string) => Promise<Result<void, { readonly kind: string }>>;
};

/** One thing sign-out clears besides the tokens (a cache, account data, scheduled work). */
export type SignOutStep = {
  /** Named in contracts/auth.json signOutSteps; the checker looks for it. */
  readonly name: string;
  readonly run: () => Promise<void> | void;
};

/** What a server sign-out step gets: the still-valid access token and the deadline's signal. */
export type ServerSignOutContext = {
  readonly accessToken: string;
  /** Aborts when the shared deadline passes: pass it to the request. */
  readonly signal: AbortSignal;
};

/**
 * One call to the app's server that needs the session while it is still valid (unregister this
 * device's push token, end the server session). Runs before the wipe, on a sign-out the person asked
 * for, best effort under one short deadline.
 */
export type ServerSignOutStep = {
  /** Named in contracts/auth.json serverSignOutSteps; the checker looks for it. */
  readonly name: string;
  readonly run: (context: ServerSignOutContext) => Promise<void> | void;
};

export type SessionManagerDeps = {
  readonly secureStorage: SecureStoragePort;
  readonly installMarker: InstallMarkerPort;
  readonly refresher: TokenRefresher;
  readonly clock: Pick<ClockPort, 'nowMs'>;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  /** Run in order on every sign-out, after the tokens are gone; one failing never stops the rest. */
  readonly signOutSteps: readonly SignOutStep[];
  /** Run together before the wipe on signOut('user'), with the token; default none. */
  readonly serverSignOutSteps?: readonly ServerSignOutStep[];
};

/** Where restore() runs: in the foreground the phone is unlocked, so a failed read is no lock. */
export type RestoreOptions = { readonly isForeground: boolean };

export type SignInInput = { readonly grant: TokenGrant; readonly account: Account };

/** The one owner of the session. Created once by the composition root; read through useSession(). */
export type SessionManager = {
  /** A stable object until the next change (useSyncExternalStore compares by reference). */
  readonly getSnapshot: () => SessionSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Reads the stored session once (again after `unavailable`); never rejects. A failed read in the
   * background is `unavailable`; in the foreground it is read once more, then `signed-out` with
   * reason `storage-unavailable` (values kept). Default: not in the foreground.
   */
  readonly restore: (options?: RestoreOptions) => Promise<SessionSnapshot>;
  /** restore() for code that holds no promise (an effect): failures are recorded. */
  readonly start: (options?: RestoreOptions) => void;
  /** Writes the tokens, then publishes `signed-in`. */
  readonly signIn: (input: SignInInput) => Promise<Result<void, SignInFailure>>;
  /** A token to send now, refreshed first when it is about to expire (one refresh at a time). */
  readonly accessToken: () => Promise<Result<string, SessionFailure>>;
  /** The token in memory, without refreshing (what a request is about to send). */
  readonly peekAccessToken: () => string | null;
  /** After a 401 for `rejected`: refreshes unless another call already replaced that token. */
  readonly renewAfterUnauthorized: (rejected: string) => Promise<Result<string, SessionFailure>>;
  /**
   * Runs the server steps (reason 'user'), clears the tokens, publishes `signed-out`, runs every
   * sign-out step, then revokes.
   */
  readonly signOut: (reason: SignOutReason) => Promise<void>;
};
