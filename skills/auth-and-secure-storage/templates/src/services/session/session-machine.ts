// src/services/session/session-machine.ts
// The session manager's state and the few moves everything else is built from: publish a snapshot
// to every subscriber, run secure-store work through one queue in call order, bump the generation
// that drops work a sign-out superseded, and set or clear the install marker. Plain values behind
// Cells, so every change is a call that a test can follow.
import { cell } from './single-flight';

import type {
  SessionFailure,
  SessionManagerDeps,
  SessionSnapshot,
  SignedOutReason,
} from './session-types';
import type { StoredSession } from './session-vault';
import type { Cell } from './single-flight';
import type { Result } from '@/core/result';
import type { TokenSet } from '@/core/session/token-set';

export type TokenResult = Result<TokenSet, SessionFailure>;

/** A sign-out in flight, and the generation its wipe ended (null until then). */
export type SignOutRun = { readonly done: Promise<void>; readonly endedAt: Cell<number | null> };

export type Machine = {
  readonly deps: SessionManagerDeps;
  readonly listeners: Set<() => void>;
  readonly snapshot: Cell<SessionSnapshot>;
  /** The signed-in session in memory; null while signed out or not restored yet. */
  readonly current: Cell<StoredSession | null>;
  /** Bumped by every sign-in and sign-out; work started under an older number is dropped. */
  readonly generation: Cell<number>;
  /** The tail of the secure-store queue: writes and wipes land in call order. */
  readonly queue: Cell<Promise<void>>;
  readonly refreshing: Cell<Promise<TokenResult> | null>;
  readonly restoring: Cell<Promise<SessionSnapshot> | null>;
  readonly signingOut: Cell<SignOutRun | null>;
  /** Sign-ins still writing: a sign-out meanwhile must run, so the sign-in is superseded. */
  readonly signInsInFlight: Cell<number>;
};

export const SIGNED_OUT = { kind: 'signed-out' } as const satisfies SessionFailure;

/** A machine that is restoring, with nothing in memory and an empty queue. */
export function createMachine(deps: SessionManagerDeps): Machine {
  return {
    deps,
    listeners: new Set(),
    snapshot: cell<SessionSnapshot>({ status: 'restoring' }),
    current: cell<StoredSession | null>(null),
    generation: cell(0),
    queue: cell(Promise.resolve()),
    refreshing: cell<Promise<TokenResult> | null>(null),
    restoring: cell<Promise<SessionSnapshot> | null>(null),
    signingOut: cell<SignOutRun | null>(null),
    signInsInFlight: cell(0),
  };
}

export function publish(m: Machine, snapshot: SessionSnapshot): SessionSnapshot {
  m.snapshot.set(snapshot);
  for (const listener of m.listeners) listener();
  return snapshot;
}

export function publishSignedOut(m: Machine, reason: SignedOutReason): SessionSnapshot {
  return publish(m, { status: 'signed-out', reason });
}

/** Runs secure-store work one piece at a time, in call order (a sign-out's wipe lands last). */
export function serial<TValue>(m: Machine, work: () => Promise<TValue>): Promise<TValue> {
  const next = m.queue.get().then(work);
  m.queue.set(
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/**
 * Sets or clears the install marker. Its adapter records why a change failed; a marker left unset
 * costs one more (harmless) wipe at the next launch, so the caller only learns whether it worked.
 */
export function markInstall(m: Machine, isKnown: boolean): boolean {
  const changed = isKnown ? m.deps.installMarker.write() : m.deps.installMarker.clear();
  return changed.ok;
}

export function nextGeneration(m: Machine): number {
  const generation = m.generation.get() + 1;
  m.generation.set(generation);
  return generation;
}
