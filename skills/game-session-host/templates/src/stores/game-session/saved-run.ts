// src/stores/game-session/saved-run.ts: a run's written form, and restoring it (replay rebuilds undo).
import { attempt } from '@/core/result';

import type { PersistenceSpec } from '@/core/game/persistence';
import type { SavedRun } from '@/data/game-runs/game-runs-repository';
import type {
  GameSession,
  RunLogEntry,
  SessionRules,
} from '@/stores/game-session/game-session-types';

export type SavedRunTarget = {
  readonly gameId: string;
  readonly stateVersion: number;
  readonly shouldResumeOnLaunch: boolean;
};

/** Session -> its written form: the snapshot, the seed and the log (never `past`). */
export function toSavedRun<TState, TMove, TEvent>(
  session: GameSession<TState, TMove, TEvent>,
  target: SavedRunTarget,
): SavedRun {
  const { ref, seed, difficulty, startedOn, state, log, moveCount, undoCount, hintsUsed } = session;
  const { continuesUsed, isRescueDeclined, playMs } = session;
  return {
    ...target,
    ref,
    seed,
    difficulty,
    startedOn,
    state,
    log,
    moveCount,
    undoCount,
    hintsUsed,
    continuesUsed,
    isRescueDeclined,
    playMs,
  };
}

export type RestoredRun<TState, TMove, TEvent> =
  | {
      readonly kind: 'restored';
      readonly session: GameSession<TState, TMove, TEvent>;
      /**
       * false when the replay disagreed with the snapshot: undo history dropped (log it). A
       * save-points game is never replayed, so it is never false for one.
       */
      readonly hasHistory: boolean;
    }
  | { readonly kind: 'dropped'; readonly reason: 'state-invalid' | 'state-not-migratable' };

function parseLog<TState, TMove>(
  persistence: PersistenceSpec<TState, TMove>,
  saved: SavedRun,
): readonly RunLogEntry<TMove>[] | null {
  const log: RunLogEntry<TMove>[] = [];
  for (const entry of saved.log) {
    if (entry.kind === 'continue') {
      log.push(entry);
      continue;
    }
    const move = persistence.parseMove(entry.move);
    if (move === null) return null;
    log.push({ kind: 'move', move });
  }
  return log;
}

type Replay<TState> = { readonly past: readonly TState[]; readonly final: TState };

/** Re-applies the log from create(seed, difficulty); throws when a step does (the rules changed). */
function replayLog<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  saved: SavedRun,
  log: readonly RunLogEntry<TMove>[],
): Replay<TState> {
  let state = rules.create(saved.seed, saved.difficulty);
  let past: TState[] = [];
  for (const entry of log) {
    if (entry.kind === 'move') {
      past = [...past, state];
      state = rules.applyMove(state, entry.move).state;
    } else if (rules.continueRun.kind === 'once') {
      past = [];
      state = rules.continueRun.apply(state).state;
    }
  }
  return { past, final: state };
}

/** A replay that throws (a logged move the rules now refuse) is an expected answer: no history. */
function replay<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  saved: SavedRun,
  log: readonly RunLogEntry<TMove>[],
): Replay<TState> | null {
  const replayed = attempt(
    () => replayLog(rules, saved, log),
    () => ({ kind: 'replay-refused' }) as const,
  );
  return replayed.ok ? replayed.value : null;
}

function snapshotOf<TState, TMove>(
  persistence: PersistenceSpec<TState, TMove>,
  saved: SavedRun,
): TState | null {
  return saved.stateVersion === persistence.stateVersion
    ? persistence.parseState(saved.state)
    : persistence.migrateState(saved.state, saved.stateVersion);
}

type History<TState, TMove> = Pick<
  GameSession<TState, TMove, never>,
  'past' | 'log' | 'hasPartialLog'
>;

function historyOf<TState, TMove>(
  snapshot: TState,
  log: readonly RunLogEntry<TMove>[] | null,
  replayed: Replay<TState> | null,
): History<TState, TMove> {
  const isSame = replayed !== null && JSON.stringify(replayed.final) === JSON.stringify(snapshot);
  return log !== null && replayed !== null && isSame
    ? { past: replayed.past, log, hasPartialLog: false }
    : { past: [], log: [], hasPartialLog: true };
}

/**
 * A real-time (save-points) run restores from its snapshot alone: the sim made the state, so the
 * log (the loop's input log) is kept for a debug replay and never replayed through applyMove.
 */
function savePointHistory<TState, TMove>(
  log: readonly RunLogEntry<TMove>[] | null,
): History<TState, TMove> {
  return { past: [], log: log ?? [], hasPartialLog: true };
}

/** The counters a saved run carries over unchanged. */
function carried(
  saved: SavedRun,
): Omit<SavedRun, 'gameId' | 'stateVersion' | 'state' | 'log' | 'shouldResumeOnLaunch'> {
  const { ref, seed, difficulty, startedOn, moveCount, undoCount, hintsUsed } = saved;
  const { continuesUsed, isRescueDeclined, playMs } = saved;
  return {
    ref,
    seed,
    difficulty,
    startedOn,
    moveCount,
    undoCount,
    hintsUsed,
    continuesUsed,
    isRescueDeclined,
    playMs,
  };
}

/**
 * Saved run -> session, validated by the game's own parsers. The snapshot is the truth: the log
 * replay only rebuilds undo and must reproduce it exactly (the determinism policy makes it so);
 * when it does not, only the history is dropped. A run that was still being played comes back
 * paused, so nothing moves until the player resumes.
 */
export function restoreRun<TState, TMove, TEvent>(
  rules: SessionRules<TState, TMove, TEvent>,
  persistence: PersistenceSpec<TState, TMove>,
  saved: SavedRun,
): RestoredRun<TState, TMove, TEvent> {
  const isSameVersion = saved.stateVersion === persistence.stateVersion;
  const snapshot = snapshotOf(persistence, saved);
  if (snapshot === null) {
    return { kind: 'dropped', reason: isSameVersion ? 'state-invalid' : 'state-not-migratable' };
  }
  const log = isSameVersion ? parseLog(persistence, saved) : null;
  const isSavePoints = persistence.savePolicy.kind === 'save-points';
  const replayed = log === null || isSavePoints ? null : replay(rules, saved, log);
  const history = isSavePoints
    ? savePointHistory<TState, TMove>(log)
    : historyOf(snapshot, log, replayed);
  const outcome = rules.outcome(snapshot);
  const session: GameSession<TState, TMove, TEvent> = {
    ...carried(saved),
    state: snapshot,
    ...history,
    status: outcome.kind === 'playing' ? 'paused' : outcome.kind,
    outcome,
    lastEvents: [],
    eventSeq: 0,
  };
  return { kind: 'restored', session, hasHistory: isSavePoints || !history.hasPartialLog };
}
