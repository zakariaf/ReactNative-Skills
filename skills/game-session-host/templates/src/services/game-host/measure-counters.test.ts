// src/services/game-host/measure-counters.test.ts
import { TALLY_GAME } from '@test/games/tally-game';

import { measureCounters } from './measure-counters';
import { sessionRulesFor } from './open-session';

const RULES = sessionRulesFor(TALLY_GAME, true);
const COUNTERS = TALLY_GAME.stats.counters;
const ADD_ONE = { kind: 'move', move: { kind: 'add', amount: 1 } } as const;
const ADD_TWO = { kind: 'move', move: { kind: 'add', amount: 2 } } as const;

describe('measureCounters', () => {
  it('replays the kept moves from the seed and folds sum and max counters', () => {
    const tally = measureCounters(
      RULES,
      { seed: 1, difficulty: 1, log: [ADD_ONE, ADD_TWO, ADD_ONE], hasPartialLog: false },
      COUNTERS,
    );

    expect(tally).toStrictEqual({
      adds: { value: 3, aggregate: 'sum' },
      'biggest-add': { value: 2, aggregate: 'max' },
    });
  });

  it('counts the rescue events too, and nothing for undone moves (they left the log)', () => {
    const lost = [ADD_TWO, ADD_TWO, ADD_TWO] as const;
    const tally = measureCounters(
      RULES,
      {
        seed: 1,
        difficulty: 2,
        log: [...lost, { kind: 'continue' }, ADD_ONE],
        hasPartialLog: false,
      },
      COUNTERS,
    );

    expect(tally['adds']?.value).toBe(4);
  });

  it('measures nothing from a partial log (it does not start at the seed)', () => {
    const tally = measureCounters(
      RULES,
      { seed: 1, difficulty: 1, log: [ADD_ONE], hasPartialLog: true },
      COUNTERS,
    );

    expect(tally['adds']?.value).toBe(0);
    expect(tally['biggest-add']?.value).toBe(0);
  });
});
