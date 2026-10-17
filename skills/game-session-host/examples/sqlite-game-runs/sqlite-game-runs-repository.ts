// src/data/game-runs/sqlite-game-runs-repository.ts
// GameRunsRepository on SQL (persistence-and-migrations' SqlDriver). The run in progress is one
// JSON row per game: its envelope is validated here, its state and moves by the game's own parsers
// when the run is restored. The run end is ONE transaction: the best, the end row, the run cleared,
// and whatever else the app keeps per run end (extendRunEnd). A practice end (a replayed daily)
// writes only its row, marked is_practice, and clears the run.
import * as v from 'valibot';

import { runKeyOf } from '@/core/game-results/run-ref';
import { attempt, err } from '@/core/result';
import { toStorageFailure } from '@/data/to-storage-failure';

import type { Result } from '@/core/result';
import type {
  GameRunsFailure,
  GameRunsRepository,
  RunEndRecord,
  SavedRun,
} from '@/data/game-runs/game-runs-repository';
import type { SqlDriver, SqlRow } from '@/data/sql-driver';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

const SELECT_RUN = 'SELECT run_json FROM game_saved_runs WHERE game_id = ?';
const UPSERT_RUN = `INSERT INTO game_saved_runs (game_id, run_json) VALUES (?, ?)
ON CONFLICT (game_id) DO UPDATE SET run_json = excluded.run_json`;
const DELETE_RUN = 'DELETE FROM game_saved_runs WHERE game_id = ?';
const SELECT_BEST = 'SELECT best_score FROM game_results WHERE game_id = ? AND run_key = ?';
const UPSERT_BEST = `INSERT INTO game_results (game_id, run_key, best_score, best_stars) VALUES (?, ?, ?, ?)
ON CONFLICT (game_id, run_key) DO UPDATE SET
  best_score = max(best_score, excluded.best_score), best_stars = max(best_stars, excluded.best_stars)`;
const SELECT_END = 'SELECT 1 AS found FROM game_run_ends WHERE game_id = ? AND run_key = ? LIMIT 1';
const INSERT_END = `INSERT INTO game_run_ends
  (game_id, run_key, day, is_won, score, moves, play_ms, stars, hints_used, counters_json, is_practice)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const COUNT = v.pipe(v.number(), v.integer(), v.minValue(0));
const DAY = v.pipe(v.string(), v.isoDate());
/** A stored run is a level, a daily or an endless run (a tutorial is never stored). */
const RUN_REF = v.variant('kind', [
  v.object({ kind: v.literal('level'), level: COUNT }),
  v.object({ kind: v.literal('daily'), date: DAY }),
  v.object({ kind: v.literal('endless') }),
]);
const LOG_ENTRY = v.variant('kind', [
  v.object({ kind: v.literal('move'), move: v.unknown() }),
  v.object({ kind: v.literal('continue') }),
]);
/** The envelope only: `state` and the moves stay unknown until the game's own parsers read them. */
const SAVED_RUN = v.object({
  gameId: v.pipe(v.string(), v.minLength(1)),
  ref: RUN_REF,
  seed: COUNT,
  difficulty: COUNT,
  startedOn: DAY,
  stateVersion: COUNT,
  state: v.unknown(),
  log: v.array(LOG_ENTRY),
  moveCount: COUNT,
  undoCount: COUNT,
  hintsUsed: COUNT,
  continuesUsed: v.pipe(COUNT, v.maxValue(1)),
  isRescueDeclined: v.boolean(),
  playMs: COUNT,
  shouldResumeOnLaunch: v.boolean(),
});
const COUNTER = v.object({ value: v.number(), aggregate: v.picklist(['sum', 'max']) });
const RUN_END = v.object({
  gameId: v.pipe(v.string(), v.minLength(1)),
  ref: RUN_REF,
  day: DAY,
  isWon: v.boolean(),
  score: v.pipe(v.number(), v.integer()),
  moves: COUNT,
  playMs: COUNT,
  stars: v.picklist([0, 1, 2, 3]),
  hintsUsed: COUNT,
  counters: v.record(v.string(), COUNTER),
  isPractice: v.boolean(),
});
const RUN_ROW = v.object({ run_json: v.string() });
const BEST_ROW = v.object({ best_score: v.pipe(v.number(), v.integer()) });

export type SqliteGameRunsDeps = {
  readonly driver: SqlDriver;
  readonly errorLog: Pick<ErrorLogPort, 'record'>;
  /**
   * Other app sections that change with a run end, inside the same transaction: a stored streak
   * (dates-streaks-and-statistics' recordCompletion with day = end.day, skipped for practice), the
   * ad history. A throw rolls the whole run end back. Omit it when streaks are derived on read
   * from game_run_ends (the default).
   */
  readonly extendRunEnd?: (driver: SqlDriver, end: RunEndRecord) => void;
};

type Log = Pick<ErrorLogPort, 'record'>;

/** SQLite errors become the port's failures here, once; the raw error goes to the error log. */
function failureOf(errorLog: Log): (thrown: unknown) => GameRunsFailure {
  return (thrown) => {
    const failure = toStorageFailure(thrown);
    if (failure.kind === 'full') return { kind: 'storage-full' };
    if (failure.kind === 'busy') return { kind: 'storage-busy' };
    errorLog.record('storage', thrown);
    return { kind: 'storage-unavailable' };
  };
}

function invalid(issues: readonly v.BaseIssue<unknown>[]): Result<never, GameRunsFailure> {
  const first = issues[0];
  return err({ kind: 'run-invalid', field: (first && v.getDotPath(first)) ?? '(record)' });
}

/** The row's JSON, or null for text that is not JSON (a torn write, a damaged file). */
function parsedJson(text: string): unknown {
  const parsed = attempt(
    (): unknown => JSON.parse(text),
    () => 'not-json' as const,
  );
  return parsed.ok ? parsed.value : null;
}

/**
 * An unreadable row (corrupt JSON or a bad envelope) reads as "no saved run" and is logged, never
 * a storage failure: the host then clears that row alone and every other row stays.
 */
function savedRunOf(row: SqlRow | null, errorLog: Log): SavedRun | null {
  if (row === null) return null;
  const json = v.safeParse(RUN_ROW, row);
  const parsed = json.success ? v.safeParse(SAVED_RUN, parsedJson(json.output.run_json)) : null;
  if (parsed?.success === true) return parsed.output;
  errorLog.record('storage', new Error('unreadable game_saved_runs row'));
  return null;
}

function bestOf(row: SqlRow | null, errorLog: Log): number | null {
  if (row === null) return null;
  const parsed = v.safeParse(BEST_ROW, row);
  if (parsed.success) return parsed.output.best_score;
  errorLog.record('storage', new Error('unreadable game_results row'));
  return null;
}

type ExtendRunEnd = SqliteGameRunsDeps['extendRunEnd'];

function recordEnd(driver: SqlDriver, end: RunEndRecord, extend: ExtendRunEnd): void {
  const key = runKeyOf(end.ref);
  const isCounted = !end.isPractice && (end.isWon || end.ref.kind === 'endless');
  const row = [end.gameId, key, end.day, end.isWon ? 1 : 0, end.score, end.moves, end.playMs];
  const tail = [end.stars, end.hintsUsed, JSON.stringify(end.counters), end.isPractice ? 1 : 0];
  driver.transaction(() => {
    if (isCounted) driver.run(UPSERT_BEST, [end.gameId, key, end.score, end.stars]);
    driver.run(INSERT_END, [...row, ...tail]);
    driver.run(DELETE_RUN, [end.gameId]);
    extend?.(driver, end);
  });
}

export function createSqliteGameRunsRepository({
  driver,
  errorLog,
  extendRunEnd,
}: SqliteGameRunsDeps): GameRunsRepository {
  const fail = failureOf(errorLog);
  return {
    savedRun: (gameId) =>
      attempt(() => savedRunOf(driver.get(SELECT_RUN, [gameId]), errorLog), fail),
    writeRun: (run) => {
      const parsed = v.safeParse(SAVED_RUN, run);
      if (!parsed.success) return invalid(parsed.issues);
      return attempt(() => {
        driver.run(UPSERT_RUN, [parsed.output.gameId, JSON.stringify(parsed.output)]);
      }, fail);
    },
    clearRun: (gameId) =>
      attempt(() => {
        driver.run(DELETE_RUN, [gameId]);
      }, fail),
    bestScore: (gameId, ref) =>
      attempt(() => bestOf(driver.get(SELECT_BEST, [gameId, runKeyOf(ref)]), errorLog), fail),
    hasRunEnd: (gameId, ref) =>
      attempt(() => driver.get(SELECT_END, [gameId, runKeyOf(ref)]) !== null, fail),
    recordRunEnd: (end) => {
      const parsed = v.safeParse(RUN_END, end);
      if (!parsed.success) return invalid(parsed.issues);
      return attempt(() => {
        recordEnd(driver, end, extendRunEnd);
      }, fail);
    },
  };
}
