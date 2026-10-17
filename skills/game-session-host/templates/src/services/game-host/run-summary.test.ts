// src/services/game-host/run-summary.test.ts
import { TALLY_GAME } from '@test/games/tally-game';
import { TALLY_RULES as RULES, playTally, startTally } from '@test/games/tally-runs';

import { entryFor } from './open-session';
import { runEndOf, summarizeRun } from './run-summary';

import type { RunEndContext } from './run-summary';
import type { RunRef } from '@/core/game-results/run-ref';
import type { TallyEvent, TallyMove, TallyState } from '@test/games/tally-game';
import type { TallySession } from '@test/games/tally-runs';

function contextFor(ref: RunRef): RunEndContext<TallyState, TallyMove, TallyEvent> {
  return {
    gameId: 'tally',
    rules: RULES,
    hud: TALLY_GAME.rules.hud,
    counters: TALLY_GAME.stats.counters,
    entry: entryFor(TALLY_GAME, ref),
    table: TALLY_GAME.levels?.table ?? [],
  };
}

/** Nothing recorded before this run. */
const FIRST = { bestBefore: null, isPractice: false } as const;

function runOf(ref: RunRef, amounts: readonly (1 | 2)[]): TallySession {
  return playTally(startTally(ref), amounts);
}

describe('summarizeRun', () => {
  const LEVEL_1: RunRef = { kind: 'level', level: 1 };

  it('rates a won level on its table rule and offers the next level', () => {
    const summary = summarizeRun(runOf(LEVEL_1, [2, 2]), contextFor(LEVEL_1), FIRST);

    expect(summary).toMatchObject({
      isWon: true,
      score: 40,
      moves: 2,
      stars: 3,
      par: 2,
      isNewBest: true,
      bestScore: 40,
      nextLevel: 2,
    });
  });

  it('gives a loss no stars, no best and its reason', () => {
    const summary = summarizeRun(runOf(LEVEL_1, [2, 1, 2]), contextFor(LEVEL_1), {
      bestBefore: 40,
      isPractice: false,
    });

    expect(summary).toMatchObject({
      isWon: false,
      stars: 0,
      isNewBest: false,
      bestScore: 40,
      loseReasonKey: 'tally.lose.overshot',
      nextLevel: null,
    });
  });

  it('counts an endless best even though endless runs only end lost', () => {
    const ENDLESS: RunRef = { kind: 'endless' };
    const summary = summarizeRun(runOf(ENDLESS, [2, 2, 2]), contextFor(ENDLESS), {
      bestBefore: 4,
      isPractice: false,
    });

    expect(summary).toMatchObject({
      isWon: false,
      score: 6,
      isNewBest: true,
      bestScore: 6,
      stars: 0,
      par: null,
    });
  });

  it('counts no tutorial as a best', () => {
    const TUTORIAL: RunRef = { kind: 'tutorial' };

    const tutorialRun = { ...runOf({ kind: 'level', level: 1 }, [2, 2]), ref: TUTORIAL };

    expect(summarizeRun(tutorialRun, contextFor(TUTORIAL), FIRST).isNewBest).toBe(false);
  });

  it('treats a replayed daily as practice: the first finished attempt was the result', () => {
    const DAILY: RunRef = { kind: 'daily', date: '2026-10-14' };
    const replay = { ...runOf(LEVEL_1, [2, 2]), ref: DAILY };
    const summary = summarizeRun(replay, contextFor(DAILY), { bestBefore: 0, isPractice: true });

    expect(summary).toMatchObject({
      isWon: true,
      isPractice: true,
      isNewBest: false,
      bestScore: 0,
    });
  });
});

describe('runEndOf', () => {
  it('records the start day, the hints and the counters of the kept moves', () => {
    const LEVEL_1: RunRef = { kind: 'level', level: 1 };
    const session = runOf(LEVEL_1, [2, 2]);
    const end = runEndOf(
      session,
      summarizeRun(session, contextFor(LEVEL_1), FIRST),
      contextFor(LEVEL_1),
    );

    expect(end).toStrictEqual({
      gameId: 'tally',
      ref: LEVEL_1,
      day: '2026-10-14',
      isWon: true,
      score: 40,
      moves: 2,
      playMs: 0,
      stars: 3,
      hintsUsed: 0,
      counters: {
        adds: { value: 2, aggregate: 'sum' },
        'biggest-add': { value: 2, aggregate: 'max' },
      },
      isPractice: false,
    });
  });
});
