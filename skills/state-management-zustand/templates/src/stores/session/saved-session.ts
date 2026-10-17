// src/stores/session/saved-session.ts: a session's written form, and restoring it (replay rebuilds undo).
import type {
  SessionRules,
  SessionStatus,
  UndoableSession,
} from '@/stores/session/undoable-session-types';

/** What is written (JSON values). `past` is never stored: replaying `log` from `start` rebuilds it. */
export type SavedSession = {
  readonly version: number;
  readonly start: unknown;
  readonly state: unknown;
  readonly log: readonly unknown[];
  readonly undoCount: number;
  readonly activeMs: number;
};

/** How a feature reads its saved values back (valibot schemas behind these functions). */
export type SessionCodec<TState, TCommand> = {
  /** The version of the state and command shapes; bump it whenever either changes. */
  readonly version: number;
  readonly parseState: (json: unknown) => TState | null;
  readonly parseCommand: (json: unknown) => TCommand | null;
  /** A state an older version wrote, brought up to date; null when that is not possible. */
  readonly migrateState: (json: unknown, fromVersion: number) => TState | null;
};

export type RestoredSession<TState, TCommand> =
  | {
      readonly kind: 'restored';
      readonly session: UndoableSession<TState, TCommand>;
      /** false when the replay disagreed with the snapshot: undo history dropped (log it). */
      readonly hasHistory: boolean;
    }
  | { readonly kind: 'dropped'; readonly reason: 'state-invalid' | 'state-not-migratable' };

/** The session as it is written: the snapshot, the origin and the log (never `past`). */
export function toSavedSession<TState, TCommand>(
  session: UndoableSession<TState, TCommand>,
  version: number,
): SavedSession {
  const { start, state, log, undoCount, activeMs } = session;
  return { version, start, state, log, undoCount, activeMs };
}

type Replay<TState, TCommand> = {
  readonly start: TState;
  readonly past: readonly TState[];
  readonly log: readonly TCommand[];
  readonly final: TState;
};

/** Re-applies the saved log from the saved start; null when anything fails to parse or apply. */
function replayLog<TState, TCommand>(
  rules: SessionRules<TState, TCommand>,
  codec: SessionCodec<TState, TCommand>,
  saved: SavedSession,
): Replay<TState, TCommand> | null {
  const start = codec.parseState(saved.start);
  if (start === null) return null;
  let state: TState = start;
  const past: TState[] = [];
  const log: TCommand[] = [];
  for (const json of saved.log) {
    const command = codec.parseCommand(json);
    const next = command === null ? state : rules.apply(state, command);
    if (command === null || next === state) return null;
    past.push(state);
    log.push(command);
    state = next;
  }
  return { start, past, log, final: state };
}

const restoredStatus = (isFinished: boolean): SessionStatus => (isFinished ? 'finished' : 'paused');

/**
 * Saved session -> session. The snapshot is the truth: with the same version the log is replayed
 * to rebuild undo, and when the replay does not reproduce the snapshot (a determinism bug, or rules
 * changed without a version bump) only the history is dropped. A restored session that was not
 * finished comes back paused, so nothing moves until the user resumes.
 */
export function restoreSession<TState, TCommand>(
  rules: SessionRules<TState, TCommand>,
  codec: SessionCodec<TState, TCommand>,
  saved: SavedSession,
): RestoredSession<TState, TCommand> {
  const isSameVersion = saved.version === codec.version;
  const state = isSameVersion
    ? codec.parseState(saved.state)
    : codec.migrateState(saved.state, saved.version);
  if (state === null) {
    return { kind: 'dropped', reason: isSameVersion ? 'state-invalid' : 'state-not-migratable' };
  }
  const snapshot: TState = state;
  const replay = isSameVersion ? replayLog(rules, codec, saved) : null;
  const hasHistory = replay !== null && JSON.stringify(replay.final) === JSON.stringify(snapshot);
  const session: UndoableSession<TState, TCommand> = {
    start: hasHistory ? replay.start : snapshot,
    state: snapshot,
    past: hasHistory ? replay.past : [],
    log: hasHistory ? replay.log : [],
    status: restoredStatus(rules.isFinished(snapshot)),
    undoCount: saved.undoCount,
    activeMs: saved.activeMs,
    revision: 0,
  };
  return { kind: 'restored', session, hasHistory };
}
