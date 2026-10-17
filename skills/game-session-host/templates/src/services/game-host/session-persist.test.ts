// src/services/game-host/session-persist.test.ts
import { ok } from '@/core/result';
import { createFakeGameRunsRepository } from '@/data/game-runs/fake-game-runs-repository';
import { TALLY_GAME } from '@test/games/tally-game';
import { TALLY_RULES, playTally, startTally } from '@test/games/tally-runs';

import { entryFor } from './open-session';
import { createSessionExtras } from './session-extras';
import { isDecided, persistStep, recordFinishedRun } from './session-persist';

import type { PersistDeps, ResultFeedback } from './session-persist';
import type { TallyEvent, TallyMove, TallyState } from '@test/games/tally-game';

type Deps = PersistDeps<TallyState, TallyMove, TallyEvent>;

function depsWith(played: ResultFeedback[] = []): Deps & {
  readonly runs: ReturnType<typeof createFakeGameRunsRepository>;
} {
  return {
    gameId: 'tally',
    rules: TALLY_RULES,
    hud: TALLY_GAME.rules.hud,
    counters: TALLY_GAME.stats.counters,
    entry: entryFor(TALLY_GAME, { kind: 'level', level: 1 }),
    table: TALLY_GAME.levels?.table ?? [],
    runs: createFakeGameRunsRepository(),
    persistence: TALLY_GAME.persistence,
    feedback: (result) => {
      played.push(result);
    },
  };
}

describe('recordFinishedRun', () => {
  it('records a decided run in one write and returns its summary', () => {
    const deps = depsWith();
    const recorded = recordFinishedRun(deps, playTally(startTally(), [2, 2]));

    expect(recorded.ok && recorded.value).toMatchObject({ isWon: true, stars: 3 });
    expect(deps.runs.writes()).toStrictEqual(['record-run-end']);
  });

  it('records a replayed daily as practice: no new best, the first result stays', () => {
    const deps = depsWith();
    const daily = { kind: 'daily', date: '2026-10-14' } as const;
    const won = { ...playTally(startTally(), [2, 2]), ref: daily };
    const lost = { ...playTally(startTally(), [2, 1, 2]), ref: daily };
    recordFinishedRun(deps, lost);
    const replay = recordFinishedRun(deps, won);

    expect(replay.ok && replay.value).toMatchObject({ isPractice: true, isNewBest: false });
    expect(deps.runs.data().runEnds.map((end) => end.isPractice)).toStrictEqual([false, true]);
    expect(deps.runs.bestScore('tally', daily)).toStrictEqual({ ok: true, value: null });
  });

  it('returns the failure and writes nothing when the repository refuses', () => {
    const deps = depsWith();
    deps.runs.failNextWrite({ kind: 'storage-busy' });

    expect(recordFinishedRun(deps, playTally(startTally(), [2, 2])).ok).toBe(false);
    expect(deps.runs.data().runEnds).toHaveLength(0);
  });
});

describe('persistStep', () => {
  it('settles first, writes a move, then records the win with its feedback', () => {
    const played: ResultFeedback[] = [];
    const deps = depsWith(played);
    const settled: string[] = [];
    const persist = persistStep({
      deps,
      extras: createSessionExtras<TallyMove>(),
      settle: () => {
        settled.push('settle');
        return ok(undefined);
      },
    });
    const move = { type: 'apply-move', move: { kind: 'add', amount: 2 } } as const;
    persist(playTally(startTally(), [2]), move);
    persist(playTally(startTally(), [2, 2]), move);

    expect(deps.runs.writes()).toStrictEqual(['write-run', 'record-run-end']);
    expect(played).toStrictEqual(['win']);
    expect(settled).toHaveLength(2);
  });

  it('knows a decided run', () => {
    expect(isDecided({ status: 'lost' })).toBe(true);
    expect(isDecided({ status: 'paused' })).toBe(false);
  });
});
