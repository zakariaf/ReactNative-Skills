// src/data/game-runs/game-runs-repository.ts: the port the game host stores runs and results through.
import type { DateKey } from '@/core/dates/date-key';
import type { StarCount } from '@/core/game/level-kit/star-rating';
import type { RunRef } from '@/core/game-results/run-ref';
import type { Result } from '@/core/result';

/** What is written for a run in progress (JSON values; one per game). `past` is never stored. */
export type SavedRun = {
  readonly gameId: string;
  readonly ref: RunRef;
  readonly seed: number;
  readonly difficulty: number;
  readonly startedOn: DateKey;
  /** The game's persistence.stateVersion when this was written (older ones go through migrateState). */
  readonly stateVersion: number;
  readonly state: unknown;
  readonly log: readonly (
    { readonly kind: 'move'; readonly move: unknown } | { readonly kind: 'continue' }
  )[];
  readonly moveCount: number;
  readonly undoCount: number;
  readonly hintsUsed: number;
  readonly continuesUsed: number;
  readonly isRescueDeclined: boolean;
  readonly playMs: number;
  /** false after Pause -> Home: the run stays saved, but a relaunch lands on Home, not in the run. */
  readonly shouldResumeOnLaunch: boolean;
};

/** One game counter's value for a finished run, folded into the statistics by its aggregate. */
export type CounterValue = { readonly value: number; readonly aggregate: 'sum' | 'max' };

/** Everything a finished run changes, written together: result, best, statistics, the run cleared. */
export type RunEndRecord = {
  readonly gameId: string;
  readonly ref: RunRef;
  /** The day the run started: a run finished after midnight still counts for the day it began. */
  readonly day: DateKey;
  readonly isWon: boolean;
  readonly score: number;
  readonly moves: number;
  readonly playMs: number;
  /** 1 to 3 for a won level, 0 otherwise. */
  readonly stars: StarCount;
  readonly hintsUsed: number;
  readonly counters: Readonly<Record<string, CounterValue>>;
  /**
   * A run that changes nothing but its own row: a replayed daily (the first finished attempt of a
   * date is the day's result, won or lost) or a tutorial. The adapter inserts the end row (marked
   * practice) and clears the run, but never raises the best or touches statistics, counters or
   * streaks.
   */
  readonly isPractice: boolean;
};

/** Why a call failed in a way the host expects and handles (error-handling-typed-results). */
export type GameRunsFailure =
  /** The record failed its schema in the repository; nothing was written. `field` is the first failing path. */
  | { readonly kind: 'run-invalid'; readonly field: string }
  | { readonly kind: 'storage-full' }
  | { readonly kind: 'storage-busy' }
  /** A damaged file, an I/O error or a bug: the raw error is already in the error log. */
  | { readonly kind: 'storage-unavailable' };

/**
 * Synchronous: a write has committed when the call returns ok. Every method returns a Result and
 * never throws for a data reason. Adapters: a SQLite repository over SqlDriver (the app's data
 * layer), fake-game-runs-repository.ts (tests).
 */
export type GameRunsRepository = {
  /**
   * The run in progress of a game, or null. The repository validates the envelope (an unreadable
   * row reads as null and is logged); `state` and the logged moves stay unknown until the game's
   * own parsers read them (restoreRun).
   */
  readonly savedRun: (gameId: string) => Result<SavedRun | null, GameRunsFailure>;
  /** Replaces the game's run in progress. */
  readonly writeRun: (run: SavedRun) => Result<void, GameRunsFailure>;
  /** Drops the game's run in progress alone (an unreadable run); results and statistics stay. */
  readonly clearRun: (gameId: string) => Result<void, GameRunsFailure>;
  /** The best score recorded for this run key (a level, a daily, endless), or null. */
  readonly bestScore: (gameId: string, ref: RunRef) => Result<number | null, GameRunsFailure>;
  /** Whether a run end is already recorded for this run key (a daily date: the day's result exists). */
  readonly hasRunEnd: (gameId: string, ref: RunRef) => Result<boolean, GameRunsFailure>;
  /**
   * ONE transaction: the result row (a won level keeps its best stars and score), the best score,
   * the statistics and counters, and the run in progress cleared. All or nothing. A practice end
   * writes only its row and clears the run.
   */
  readonly recordRunEnd: (end: RunEndRecord) => Result<void, GameRunsFailure>;
};
