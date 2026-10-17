// test/games/game-host-test-deps.ts
// GameHostDeps over fakes for the game host's tests: an in-memory run repository, a fake clock, a
// fake error log, a feedback recorder and a board factory that renders nothing.
import { createFakeGameRunsRepository } from '@/data/game-runs/fake-game-runs-repository';
import { createFakeClock } from '@/services/clock/fake-clock';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import type { FakeGameRunsRepository } from '@/data/game-runs/fake-game-runs-repository';
import type { SavedRun } from '@/data/game-runs/game-runs-repository';
import type { FakeClock } from '@/services/clock/fake-clock';
import type { FakeErrorLog } from '@/services/error-log/fake-error-log';
import type { GameHostDeps, GameHostOptions } from '@/services/game-host/game-host';
import type { ResultFeedback } from '@/services/game-host/session-persist';

export type GameHostTestDeps = GameHostDeps & {
  readonly runs: FakeGameRunsRepository;
  readonly clock: FakeClock;
  readonly errorLog: FakeErrorLog;
  /** Every result feedback played, oldest first. */
  readonly played: readonly ResultFeedback[];
};

export type GameHostTestInput = {
  readonly saved?: readonly SavedRun[];
  readonly options?: Partial<GameHostOptions>;
};

export function createGameHostTestDeps(input: GameHostTestInput = {}): GameHostTestDeps {
  const clock = createFakeClock({ nowMs: 1_000_000, today: '2026-10-14' });
  const played: ResultFeedback[] = [];
  return {
    runs: createFakeGameRunsRepository(input.saved ?? []),
    clock,
    errorLog: createFakeErrorLog(clock),
    options: { isContinueAllowed: true, freeHintsPerDay: 0, ...input.options },
    feedback: (result) => {
      played.push(result);
    },
    createBoardHost: () => () => null,
    seedOverride: () => 7,
    played,
  };
}
