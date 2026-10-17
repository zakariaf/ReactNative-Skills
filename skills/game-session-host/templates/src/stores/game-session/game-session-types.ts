// src/stores/game-session/game-session-types.ts: one game run as plain data, held by a per-run store.
import type { DateKey } from '@/core/dates/date-key';
import type { GameEngine, Outcome } from '@/core/game/game-engine';
import type { GameRules } from '@/core/game/game-rules';
import type { RunRef } from '@/core/game-results/run-ref';

export type SessionStatus = 'playing' | 'paused' | 'won' | 'lost';

/** What the run log keeps: every applied move and the one continue, in order (undone moves leave it). */
export type RunLogEntry<TMove> =
  { readonly kind: 'move'; readonly move: TMove } | { readonly kind: 'continue' };

/** One level, daily or endless run. Pure data: the reducer makes it, the store persists then publishes it. */
export type GameSession<TState, TMove, TEvent> = {
  readonly ref: RunRef;
  readonly seed: number;
  readonly difficulty: number;
  /** The local day the run started: its result counts for that day (streaks, the daily). */
  readonly startedOn: DateKey;
  readonly state: TState;
  /** The state before each undoable move (memory only; rebuilt from `log` after a relaunch). */
  readonly past: readonly TState[];
  readonly log: readonly RunLogEntry<TMove>[];
  /**
   * The log does not replay to the state from create(seed, difficulty): the run was restored
   * without its history (the replay disagreed with the snapshot), staged by a test build, or synced
   * from a real-time loop. Its counters cannot be measured, so they are recorded as 0. Memory only,
   * never saved.
   */
  readonly hasPartialLog: boolean;
  readonly status: SessionStatus;
  readonly outcome: Outcome;
  readonly moveCount: number;
  readonly undoCount: number;
  readonly hintsUsed: number;
  /** 0 or 1: a run is rescued at most once. */
  readonly continuesUsed: number;
  /** The player turned the rescue down (Try again, Home): the loss is final and is recorded. */
  readonly isRescueDeclined: boolean;
  /** Milliseconds spent playing; time arrives in add-play-time, never from a clock in here. */
  readonly playMs: number;
  /** Events of the last change; the board animates them when eventSeq changes. */
  readonly lastEvents: readonly TEvent[];
  readonly eventSeq: number;
};

/** Imperative, kebab-case actions (verb first). */
export type SessionAction<TState, TMove> =
  | { readonly type: 'apply-move'; readonly move: TMove }
  | { readonly type: 'undo' }
  | { readonly type: 'use-continue' }
  | { readonly type: 'decline-continue' }
  | { readonly type: 'use-hint' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'add-play-time'; readonly ms: number }
  /**
   * A real-time game's save point (or its end): the loop's snapshot and its input log since the
   * run began. The state is the truth; the log is kept for a debug replay, never replayed here.
   */
  | { readonly type: 'sync-state'; readonly state: TState; readonly moves: readonly TMove[] }
  /** Test builds only (the host's debug controls): jump to an example state through the same persist step. */
  | { readonly type: 'stage-state'; readonly state: TState };

/** The parts of a game module the reducer needs (pure functions and policies only). */
export type SessionRules<TState, TMove, TEvent> = Pick<
  GameEngine<TState, TMove, TEvent>,
  'create' | 'applyMove' | 'outcome'
> &
  Pick<GameRules<TState, TMove, TEvent>, 'undo' | 'continueRun'>;

export type SessionStart = {
  readonly ref: RunRef;
  readonly seed: number;
  readonly difficulty: number;
  readonly startedOn: DateKey;
};
