// src/games/pig/rules/pig-engine.test.ts
import { ENDLESS_DIFFICULTY } from '@/core/game/difficulty';
import { engineContractProblems } from '@/core/game/testing/engine-contract';

import { PIG_ENGINE, PIG_RULES } from './pig-engine';
import { PIG_PERSISTENCE } from './pig-persistence';
import { TUNING, knobsFor } from './pig-tuning';

describe('PIG_ENGINE', () => {
  it('keeps the engine contract, and the endless run is never won', () => {
    const problems = engineContractProblems({
      gameId: 'pig',
      engine: PIG_ENGINE,
      persistence: PIG_PERSISTENCE,
      starts: [0, 40, 99].flatMap((difficulty) => [1, 2, 3].map((seed) => ({ seed, difficulty }))),
      maxMoves: 200,
      endless: { kind: 'endless', difficulty: ENDLESS_DIFFICULTY },
    });
    expect(problems).toStrictEqual([]);
  });
});

describe('PIG_RULES', () => {
  it('shows the banked points against the target, or the turns left in the endless run', () => {
    expect(PIG_RULES.hud(PIG_ENGINE.create(1, 0)).goal).toStrictEqual({
      id: 'pig.hud.target',
      values: { banked: 0, target: knobsFor(0).target, turnsLeft: knobsFor(0).maxTurns },
    });
    expect(PIG_RULES.hud(PIG_ENGINE.create(1, ENDLESS_DIFFICULTY)).goal).toStrictEqual({
      id: 'pig.hud.endless',
      values: { turnsLeft: TUNING.endlessRow.maxTurns },
    });
  });

  it('has no undo: taking back a roll would let a player dodge a bust', () => {
    expect(PIG_RULES.undo).toStrictEqual({ kind: 'none' });
  });
});
