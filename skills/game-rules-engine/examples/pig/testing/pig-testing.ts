// src/games/pig/testing/pig-testing.ts
import { PIG_ENGINE } from '@/games/pig/rules/pig-engine';
import { holdAtTwentyPolicy } from '@/games/pig/rules/pig-hold-policy';
import { knobsFor } from '@/games/pig/rules/pig-tuning';

import type { TestingSpec } from '@/core/game/testing';
import type { PigMove, PigState } from '@/games/pig/rules/pig-types';

// The bot is the witness policy from rules/ (level files may import rules/, never testing/), so an
// app that adopts the levels example has one copy of it.
export { holdAtTwentyPolicy as holdAtTwentyBot } from '@/games/pig/rules/pig-hold-policy';

const START = (): PigState => PIG_ENGINE.create(1, 0);
const ROW_0 = knobsFor(0);

export const PIG_TESTING: TestingSpec<PigState, PigMove> = {
  bot: holdAtTwentyPolicy,
  examples: {
    start: START,
    middle: () => PIG_ENGINE.applyMove(START(), { kind: 'roll' }).state,
    win: () => ({ ...START(), banked: ROW_0.target, turn: ROW_0.maxTurns - 2 }),
    lose: () => ({ ...START(), turn: ROW_0.maxTurns }),
  },
};
