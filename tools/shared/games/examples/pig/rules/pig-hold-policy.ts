// src/games/pig/rules/pig-hold-policy.ts
// The witness's player lives in rules/, because level files may import only src/core and the
// game's own rules/, levels/ and geom/. testing/pig-testing.ts re-exports it as the game's bot:
//   export { holdAtTwentyPolicy as holdAtTwentyBot } from '@/games/pig/rules/pig-hold-policy';
import type { PigMove, PigState } from './pig-types';
import type { BotPolicy } from '@/core/game/testing/play-bot';

/** Hold at 20 points or when the turn reaches the target: the classic solo strategy. Draws nothing. */
export const holdAtTwentyPolicy: BotPolicy<PigState, PigMove> = (state, moves, rng) => {
  const canReachTarget = state.target > 0 && state.banked + state.turnTotal >= state.target;
  const shouldHold = state.turnTotal >= 20 || canReachTarget;
  const move = moves.find((candidate) => candidate.kind === (shouldHold ? 'hold' : 'roll'));
  const picked = move ?? moves[0];
  if (picked === undefined) throw new Error('holdAtTwentyPolicy called without legal moves');
  return { move: picked, rng };
};
