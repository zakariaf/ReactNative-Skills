// src/services/session/session-manager.ts
// The one owner of the signed-in session. It restores the session at startup (wiping what a previous
// install left in the Keychain), hands out access tokens and refreshes them one at a time, ends the
// session only when the server says the refresh token is dead, and signs out completely. Every
// secure-store write runs through one queue and re-checks a generation number, so a refresh that
// finishes after a sign-out can never write tokens back. State changes are published to subscribers
// (useSessionSnapshot() reads them with useSyncExternalStore); tokens never leave this object and the
// vault, except the access token a server sign-out step sends before the wipe.
import { err, ok } from '@/core/result';
import {
  isAccessTokenFresh,
  isAccessTokenUnexpired,
  isSessionEnding,
  tokenSetFromGrant,
} from '@/core/session/token-set';

import {
  createMachine,
  markInstall,
  nextGeneration,
  publish,
  publishSignedOut,
  serial,
  SIGNED_OUT,
} from './session-machine';
import { readSession, wipeSession, writeSession } from './session-vault';
import { runServerSignOutSteps, runSignOutSteps } from './sign-out-steps';
import { cell, singleFlight } from './single-flight';

import type { Machine, SignOutRun, TokenResult } from './session-machine';
import type {
  RestoreOptions,
  SessionFailure,
  SessionManager,
  SessionManagerDeps,
  SessionSnapshot,
  SignInFailure,
  SignInInput,
  SignOutReason,
} from './session-types';
import type { StoredSession } from './session-vault';
import type { Cell } from './single-flight';
import type { Result } from '@/core/result';
import type { RefreshFailure } from '@/core/session/token-set';

async function startFreshInstall(m: Machine): Promise<SessionSnapshot> {
  const wiped = await wipeSession(m.deps.secureStorage);
  // Marked only once the wipe worked: a failed wipe is tried again at the next launch.
  if (wiped.ok) markInstall(m, true);
  return publishSignedOut(m, 'fresh-install');
}

/** In the foreground the phone is unlocked, so a lock cannot explain a failed read: read once more. */
async function readForRestore(m: Machine, isForeground: boolean): ReturnType<typeof readSession> {
  const first = await readSession(m.deps.secureStorage);
  if (first.ok || !isForeground) return first;
  return readSession(m.deps.secureStorage);
}

async function restoreOnce(m: Machine, isForeground: boolean): Promise<SessionSnapshot> {
  const marker = m.deps.installMarker.isPresent();
  // An unreadable marker is not a fresh install: never wipe on a doubt.
  if (marker.ok && !marker.value) return startFreshInstall(m);
  const read = await readForRestore(m, isForeground);
  // In the background: a keychain locked since the restart; the foreground restores again.
  if (!read.ok && !isForeground) return publish(m, { status: 'unavailable' });
  if (!read.ok) {
    // Unlocked and still unreadable (a Keystore or Keychain error): waiting would keep the app on
    // "checking your session" forever. Signed out so the person can sign in again; the values are
    // kept, not wiped, and the next sign-in overwrites every key.
    m.deps.errorLog.record(
      'storage',
      new Error(
        `the secure store could not be ${read.error.operation} in the foreground; signed out`,
      ),
    );
    return publishSignedOut(m, 'storage-unavailable');
  }
  if (read.value.kind === 'empty') return publishSignedOut(m, null);
  if (read.value.kind === 'corrupt') {
    // Kept, not wiped: a build that reads it again restores it; the next sign-in overwrites it.
    m.deps.errorLog.record('storage', new Error('the stored session was unreadable; signed out'));
    return publishSignedOut(m, 'corrupt');
  }
  m.current.set(read.value.session);
  return publish(m, { status: 'signed-in', account: read.value.session.account });
}

/** Restores once per app run; only `unavailable` (a locked keychain) lets the next call try again. */
function restore(m: Machine, options: RestoreOptions | undefined): Promise<SessionSnapshot> {
  const pending = m.restoring.get();
  if (pending !== null) return pending;
  const isForeground = options?.isForeground ?? false;
  const started = serial(m, () => restoreOnce(m, isForeground)).then((snapshot) => {
    if (snapshot.status === 'unavailable') m.restoring.set(null);
    return snapshot;
  });
  m.restoring.set(started);
  return started;
}

async function writeSignIn(
  m: Machine,
  { grant, account }: SignInInput,
): Promise<Result<void, SignInFailure>> {
  const generation = nextGeneration(m);
  const session = { tokens: tokenSetFromGrant(grant, m.deps.clock.nowMs(), null), account };
  const written = await serial(m, () => writeSession(m.deps.secureStorage, session));
  if (generation !== m.generation.get()) return err({ kind: 'sign-in-superseded' });
  // A half-written session reads as corrupt (signed out) at the next launch; nothing is published.
  if (!written.ok) return written;
  // Every key was just overwritten, so nothing stale remains: this install is known from now on.
  markInstall(m, true);
  m.current.set(session);
  publish(m, { status: 'signed-in', account });
  return ok(undefined);
}

/**
 * The server steps, while the session is still valid. Only on a sign-out the person asked for: when
 * the server ended the session (or deleted the account) it accepts no token from this device, and it
 * drops what belonged to that session itself.
 */
async function runServerPhase(m: Machine, reason: SignOutReason): Promise<void> {
  const steps = m.deps.serverSignOutSteps ?? [];
  const ending = m.current.get();
  if (reason !== 'user' || ending === null || steps.length === 0) return;
  await runServerSignOutSteps(steps, {
    accessToken: ending.tokens.accessToken,
    errorLog: m.deps.errorLog,
  });
}

async function endSession(
  m: Machine,
  reason: SignOutReason,
  endedAt: Cell<number | null>,
): Promise<void> {
  // A restore still reading would put the stored session back into memory after the wipe below:
  // let it finish first, so this sign-out ends whatever it restored (its token included). It never
  // rejects (its ports answer with Results); if a bug makes it, the log keeps it and the sign-out goes on.
  await m.restoring.get()?.catch((error: unknown) => {
    m.deps.errorLog.record('storage', error);
  });
  await runServerPhase(m, reason);
  // From here on, work started before this sign-out (a refresh, a sign-in's write) is dropped.
  endedAt.set(nextGeneration(m));
  const refreshToken = m.current.get()?.tokens.refreshToken ?? null;
  m.current.set(null);
  const wiped = await serial(m, () => wipeSession(m.deps.secureStorage));
  // A key that would not go away is wiped at the next launch instead (the install marker check).
  if (!wiped.ok) markInstall(m, false);
  // Published before the steps: protected screens leave first, then their caches are cleared.
  publishSignedOut(m, reason);
  await runSignOutSteps(m.deps.signOutSteps, m.deps.errorLog);
  if (refreshToken !== null && m.deps.refresher.revoke !== undefined) {
    // Best effort: this device is signed out either way; the server lets the token expire.
    const revoked = await m.deps.refresher.revoke(refreshToken);
    if (!revoked.ok && revoked.error.kind !== 'network-unavailable') {
      m.deps.errorLog.record('service', new Error(`token revoke failed: ${revoked.error.kind}`));
    }
  }
}

function signIn(m: Machine, input: SignInInput): Promise<Result<void, SignInFailure>> {
  m.signInsInFlight.set(m.signInsInFlight.get() + 1);
  return writeSignIn(m, input).finally(() => {
    m.signInsInFlight.set(m.signInsInFlight.get() - 1);
  });
}

/** A sign-in since the running sign-out wiped: that sign-out cannot end the new session. */
function hasSignedInSince(m: Machine, run: SignOutRun): boolean {
  const endedAt = run.endedAt.get();
  return endedAt !== null && endedAt !== m.generation.get();
}

/**
 * Two sign-outs at once run once. The shared run is keyed on the generation its wipe ended: after
 * a sign-in meanwhile (its steps or revoke still running), a new sign-out wipes the new session.
 */
function signOut(m: Machine, reason: SignOutReason): Promise<void> {
  const isSignedOutAlready =
    m.current.get() === null &&
    m.snapshot.get().status === SIGNED_OUT.kind &&
    m.signInsInFlight.get() === 0;
  if (isSignedOutAlready) return Promise.resolve();
  const running = m.signingOut.get();
  if (running !== null && !hasSignedInSince(m, running)) return running.done;
  const endedAt = cell<number | null>(null);
  const done = endSession(m, reason, endedAt).finally(() => {
    // Only this run's own slot: a newer sign-out may have replaced it.
    if (m.signingOut.get()?.endedAt === endedAt) m.signingOut.set(null);
  });
  m.signingOut.set({ done, endedAt });
  return done;
}

async function refreshFailed(m: Machine, failure: RefreshFailure): Promise<TokenResult> {
  if (!isSessionEnding(failure)) return err(failure);
  if (failure.kind === 'rejected') {
    m.deps.errorLog.record('service', new Error(`token refresh rejected: ${failure.code}`));
  }
  await signOut(m, 'session-expired');
  return err(SIGNED_OUT);
}

async function saveRefreshed(
  m: Machine,
  session: StoredSession,
  generation: number,
): Promise<void> {
  const saved = await serial(m, () =>
    generation === m.generation.get()
      ? writeSession(m.deps.secureStorage, session)
      : Promise.resolve(ok(undefined)),
  );
  // Kept in memory for this run; after a rotation the next launch's refresh fails and signs out.
  if (!saved.ok) m.deps.errorLog.record('storage', new Error('refreshed tokens were not saved'));
}

async function runRefresh(m: Machine): Promise<TokenResult> {
  const start = m.current.get();
  const generation = m.generation.get();
  if (start === null) return err(SIGNED_OUT);
  if (start.tokens.refreshToken === null) {
    await signOut(m, 'session-expired');
    return err(SIGNED_OUT);
  }
  const answer = await m.deps.refresher.refresh(start.tokens.refreshToken);
  // Signed out (or in as someone else) meanwhile: this answer belongs to a session that is gone.
  if (generation !== m.generation.get()) return err(SIGNED_OUT);
  if (!answer.ok) return refreshFailed(m, answer.error);
  const tokens = tokenSetFromGrant(answer.value, m.deps.clock.nowMs(), start.tokens);
  const next = { tokens, account: start.account };
  await saveRefreshed(m, next, generation);
  if (generation !== m.generation.get()) return err(SIGNED_OUT);
  m.current.set(next);
  return ok(tokens);
}

/** One refresh at a time: every caller during a refresh shares its answer. */
function refresh(m: Machine): Promise<TokenResult> {
  return singleFlight(m.refreshing, () => runRefresh(m));
}

async function accessToken(m: Machine): Promise<Result<string, SessionFailure>> {
  const tokens = m.current.get()?.tokens ?? null;
  if (tokens === null) return err(SIGNED_OUT);
  if (isAccessTokenFresh(tokens, m.deps.clock.nowMs())) return ok(tokens.accessToken);
  const refreshed = await refresh(m);
  if (refreshed.ok) return ok(refreshed.value.accessToken);
  // Offline or a slow server: a token that has not expired yet still goes out; the server decides.
  const isStillUsable =
    refreshed.error.kind !== SIGNED_OUT.kind &&
    m.current.get()?.tokens === tokens &&
    isAccessTokenUnexpired(tokens, m.deps.clock.nowMs());
  return isStillUsable ? ok(tokens.accessToken) : refreshed;
}

async function renewAfterUnauthorized(
  m: Machine,
  rejected: string,
): Promise<Result<string, SessionFailure>> {
  const current = m.current.get();
  if (current === null) return err(SIGNED_OUT);
  // Another request already refreshed after the same 401: use its token, refresh nothing.
  if (current.tokens.accessToken !== rejected) return ok(current.tokens.accessToken);
  const refreshed = await refresh(m);
  return refreshed.ok ? ok(refreshed.value.accessToken) : refreshed;
}

export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  const m = createMachine(deps);
  return {
    getSnapshot: () => m.snapshot.get(),
    subscribe: (listener) => {
      m.listeners.add(listener);
      return () => {
        m.listeners.delete(listener);
      };
    },
    restore: (options) => restore(m, options),
    start: (options) => {
      restore(m, options).catch((error: unknown) => {
        deps.errorLog.record('startup', error);
      });
    },
    signIn: (input) => signIn(m, input),
    accessToken: () => accessToken(m),
    peekAccessToken: () => m.current.get()?.tokens.accessToken ?? null,
    renewAfterUnauthorized: (rejected) => renewAfterUnauthorized(m, rejected),
    signOut: (reason) => signOut(m, reason),
  };
}
