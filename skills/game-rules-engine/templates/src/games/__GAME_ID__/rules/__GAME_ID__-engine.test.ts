// src/games/__GAME_ID__/rules/__GAME_ID__-engine.test.ts
import { engineContractProblems } from '@/core/game/testing/engine-contract';

import { __GAME_CONST___ENGINE, __GAME_CONST___RULES } from './__GAME_ID__-engine';
import { __GAME_CONST___PERSISTENCE } from './__GAME_ID__-persistence';

describe('__GAME_CONST___ENGINE', () => {
  it('keeps the engine contract over seeded random games at every difficulty band', () => {
    const problems = engineContractProblems({
      gameId: '__GAME_ID__',
      engine: __GAME_CONST___ENGINE,
      persistence: __GAME_CONST___PERSISTENCE,
      starts: [0, 25, 50, 100].flatMap((difficulty) =>
        [1, 2, 3].map((seed) => ({ seed, difficulty })),
      ),
      maxMoves: 60,
    });
    expect(problems).toStrictEqual([]);
  });
});

describe('__GAME_CONST___RULES', () => {
  it('shows moves against the move limit in the top bar', () => {
    const state = __GAME_CONST___ENGINE.create(1, 0);
    expect(__GAME_CONST___RULES.hud(state).goal).toStrictEqual({
      id: '__GAME_ID__.hud.moves',
      values: { moves: 0, maxMoves: 6 },
    });
  });

  it('turns a lost run back into a playing one with the single continue', () => {
    const lost = { ...__GAME_CONST___ENGINE.create(1, 0), moves: 6 };
    if (__GAME_CONST___RULES.continueRun.kind !== 'once') throw new Error('continue expected');
    const { state, events } = __GAME_CONST___RULES.continueRun.apply(lost);
    expect(__GAME_CONST___ENGINE.outcome(state)).toStrictEqual({ kind: 'playing' });
    expect(events).toStrictEqual([{ kind: 'moves-added', count: 3 }]);
  });
});
