// src/services/game-host/session-persist.ts
// The persist step of one run: what the per-run store calls with every changed run BEFORE it is
// published. A live run is written per the game's save policy, a decided run with no rescue
// pending is recorded in ONE repository transaction, and the change that decided the run plays the
// result feedback once, after the write succeeded.
import { ok } from '@/core/result';
import { runEndOf, summarizeRun } from '@/services/game-host/run-summary';
import { isRescuePending } from '@/stores/game-session/game-session-transitions';
import { toSavedRun } from '@/stores/game-session/saved-run';

import type { PersistenceSpec } from '@/core/game/persistence';
import type { Result } from '@/core/result';
import type { GameRunsFailure, GameRunsRepository } from '@/data/game-runs/game-runs-repository';
import type { RunEndContext, RunSummary } from '@/services/game-host/run-summary';
import type { ExtrasBox } from '@/services/game-host/session-extras';
import type { PersistGameSession } from '@/stores/game-session/game-session-store';
import type { GameSession, SessionAction } from '@/stores/game-session/game-session-types';

/** The result step: the change that decided the run plays it once, after the run is on disk. */
export type ResultFeedback = 'win' | 'lose';

/** A write's answer: committed, or the failure the screen shows (nothing was published). */
export type Written = Result<void, GameRunsFailure>;

/** What recording a finished run needs: the run-end context and the repository. */
export type RecordDeps<TState, TMove, TEvent> = RunEndContext<TState, TMove, TEvent> & {
  readonly runs: GameRunsRepository;
};

/** What the persist step needs besides the run. */
export type PersistDeps<TState, TMove, TEvent> = RecordDeps<TState, TMove, TEvent> & {
  readonly persistence: PersistenceSpec<TState, TMove>;
  /** Audio and haptics (audio-and-haptics-feedback): win or lose, once per deciding change. */
  readonly feedback: (result: ResultFeedback) => void;
};

/** The persist step's parts: its deps, the controller's extras, and what must be on disk first. */
export type PersistParts<TState, TMove, TEvent> = {
  readonly deps: PersistDeps<TState, TMove, TEvent>;
  readonly extras: ExtrasBox<TMove>;
  /** Records an abandoned decided run before this run's first write (ok once it is done). */
  readonly settle: () => Written;
};

type Session<TState, TMove, TEvent> = GameSession<TState, TMove, TEvent>;

/** The changes that can decide a run: they play the result feedback. */
const DECIDING: ReadonlySet<SessionAction<unknown, unknown>['type']> = new Set([
  'apply-move',
  'stage-state',
  'sync-state',
]);
/** The changes an after-every-move game writes (pause and a save point always write). */
const TURN_ACTIONS: ReadonlySet<SessionAction<unknown, unknown>['type']> = new Set([
  ...DECIDING,
  'undo',
  'use-continue',
  'use-hint',
]);

export const isDecided = (session: Pick<Session<unknown, unknown, unknown>, 'status'>): boolean =>
  session.status === 'won' || session.status === 'lost';

/**
 * A tutorial, or a daily whose date already has a result, is practice: the first finished attempt
 * of a day is the day's result, won or lost, and a replay changes nothing.
 */
function isPracticeRun<TState, TMove, TEvent>(
  deps: RecordDeps<TState, TMove, TEvent>,
  session: Session<TState, TMove, TEvent>,
): Result<boolean, GameRunsFailure> {
  if (session.ref.kind === 'tutorial') return ok(true);
  return session.ref.kind === 'daily' ? deps.runs.hasRunEnd(deps.gameId, session.ref) : ok(false);
}

/**
 * A decided run's end in ONE repository transaction (result, best, statistics, the run cleared).
 * The best and the practice flag are read before the write, so "new best" compares with the best
 * before this run and a replayed daily never counts.
 */
export function recordFinishedRun<TState, TMove, TEvent>(
  deps: RecordDeps<TState, TMove, TEvent>,
  session: Session<TState, TMove, TEvent>,
): Result<RunSummary, GameRunsFailure> {
  const practice = isPracticeRun(deps, session);
  if (!practice.ok) return practice;
  const best = deps.runs.bestScore(deps.gameId, session.ref);
  if (!best.ok) return best;
  const summary = summarizeRun(session, deps, {
    bestBefore: best.value,
    isPractice: practice.value,
  });
  const written = deps.runs.recordRunEnd(runEndOf(session, summary, deps));
  return written.ok ? ok(summary) : written;
}

/** Records the run end once per run, and puts the summary in the extras before the publish. */
export function recordEnd<TState, TMove, TEvent>(
  parts: Pick<PersistParts<TState, TMove, TEvent>, 'deps' | 'extras'>,
  session: Session<TState, TMove, TEvent>,
): Written {
  if (parts.extras.current().summary !== null) return ok(undefined);
  const recorded = recordFinishedRun(parts.deps, session);
  if (!recorded.ok) return recorded;
  parts.extras.patch({ summary: recorded.value, hint: null });
  return ok(undefined);
}

/** Writes the run in progress (Home's Continue reads it; a relaunch restores it). */
export function writeLiveRun<TState, TMove, TEvent>(
  deps: Pick<PersistDeps<TState, TMove, TEvent>, 'gameId' | 'persistence' | 'runs'>,
  session: Session<TState, TMove, TEvent>,
  shouldResumeOnLaunch: boolean,
): Written {
  const { gameId, persistence, runs } = deps;
  const target = { gameId, stateVersion: persistence.stateVersion, shouldResumeOnLaunch };
  return runs.writeRun(toSavedRun(session, target));
}

/** A live run, or a loss waiting for its rescue, is written per the game's save policy. */
function writeRunIfDue<TState, TMove, TEvent>(
  deps: PersistDeps<TState, TMove, TEvent>,
  session: Session<TState, TMove, TEvent>,
  action: SessionAction<TState, TMove>,
): Written {
  const isEveryMove = deps.persistence.savePolicy.kind === 'after-every-move';
  const isSavePoint = action.type === 'pause' || action.type === 'sync-state';
  const isDue = isSavePoint || isDecided(session) || (isEveryMove && TURN_ACTIONS.has(action.type));
  return isDue ? writeLiveRun(deps, session, true) : ok(undefined);
}

/** Called by the store with every changed run BEFORE it is published. */
export function persistStep<TState, TMove, TEvent>(
  parts: PersistParts<TState, TMove, TEvent>,
): PersistGameSession<TState, TMove, TEvent, GameRunsFailure> {
  return (session, action) => {
    const settled = parts.settle();
    if (!settled.ok) return settled;
    const isFinal = isDecided(session) && !isRescuePending(parts.deps.rules, session);
    const written = isFinal
      ? recordEnd(parts, session)
      : writeRunIfDue(parts.deps, session, action);
    if (!written.ok) return written;
    parts.extras.patch({ saveFailure: null });
    if (DECIDING.has(action.type) && isDecided(session)) {
      parts.deps.feedback(session.status === 'won' ? 'win' : 'lose');
    }
    return written;
  };
}
