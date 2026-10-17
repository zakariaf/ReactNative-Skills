// src/data/game-runs/fake-game-runs-repository.ts: an in-memory GameRunsRepository for tests and checkers.
import { runKeyOf } from '@/core/game-results/run-ref';
import { err, ok } from '@/core/result';

import type {
  GameRunsFailure,
  GameRunsRepository,
  RunEndRecord,
  SavedRun,
} from '@/data/game-runs/game-runs-repository';

/** What the fake holds; tests read it to see exactly what reached "disk". */
export type FakeGameRunsData = {
  readonly runs: ReadonlyMap<string, SavedRun>;
  readonly bests: ReadonlyMap<string, number>;
  /** Every recorded run end, oldest first. */
  readonly runEnds: readonly RunEndRecord[];
};

export type FakeGameRunsRepository = GameRunsRepository & {
  readonly data: () => FakeGameRunsData;
  /** Every call that wrote, in order ('write-run', 'clear-run', 'record-run-end'). */
  readonly writes: () => readonly string[];
  /** The next write fails with this failure and changes nothing (one shot). */
  readonly failNextWrite: (failure: GameRunsFailure) => void;
};

const bestKey = (gameId: string, key: string): string => `${gameId}/${key}`;

type FakeState = {
  runs: Map<string, SavedRun>;
  bests: Map<string, number>;
  runEnds: RunEndRecord[];
  writes: string[];
  /** At most one armed failure; shift() takes it. */
  armed: GameRunsFailure[];
};

/** Runs a write unless a failure is armed: the armed failure is returned and nothing changes. */
function write(
  state: FakeState,
  name: string,
  change: () => void,
): ReturnType<GameRunsRepository['clearRun']> {
  const failure = state.armed.shift();
  if (failure !== undefined) return err(failure);
  change();
  state.writes.push(name);
  return ok(undefined);
}

function recordEnd(state: FakeState, end: RunEndRecord): void {
  const key = bestKey(end.gameId, runKeyOf(end.ref));
  const best = state.bests.get(key);
  const isCounted = !end.isPractice && (end.isWon || end.ref.kind === 'endless');
  if (isCounted && (best === undefined || end.score > best)) state.bests.set(key, end.score);
  state.runEnds.push(end);
  state.runs.delete(end.gameId);
}

export function createFakeGameRunsRepository(
  initial: readonly SavedRun[] = [],
): FakeGameRunsRepository {
  const state: FakeState = {
    runs: new Map(initial.map((run) => [run.gameId, run])),
    bests: new Map(),
    runEnds: [],
    writes: [],
    armed: [],
  };
  return {
    savedRun: (gameId) => ok(state.runs.get(gameId) ?? null),
    writeRun: (run) => write(state, 'write-run', () => state.runs.set(run.gameId, run)),
    clearRun: (gameId) => write(state, 'clear-run', () => state.runs.delete(gameId)),
    bestScore: (gameId, ref) => ok(state.bests.get(bestKey(gameId, runKeyOf(ref))) ?? null),
    hasRunEnd: (gameId, ref) =>
      ok(state.runEnds.some((end) => end.gameId === gameId && runKeyOf(end.ref) === runKeyOf(ref))),
    recordRunEnd: (end) =>
      write(state, 'record-run-end', () => {
        recordEnd(state, end);
      }),
    data: () => ({
      runs: new Map(state.runs),
      bests: new Map(state.bests),
      runEnds: [...state.runEnds],
    }),
    writes: () => [...state.writes],
    failNextWrite: (failure) => {
      state.armed.splice(0, state.armed.length, failure);
    },
  };
}
