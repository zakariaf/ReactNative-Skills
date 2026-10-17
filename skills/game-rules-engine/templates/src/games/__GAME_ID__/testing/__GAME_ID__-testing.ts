// src/games/__GAME_ID__/testing/__GAME_ID__-testing.ts
import { applyMove } from '@/games/__GAME_ID__/rules/apply-move';
import { create } from '@/games/__GAME_ID__/rules/create';

import type { TestingSpec } from '@/core/game/testing';
import type { BotPolicy } from '@/core/game/testing/play-bot';
import type {
  __GAME_PASCAL__Move,
  __GAME_PASCAL__State,
} from '@/games/__GAME_ID__/rules/__GAME_ID__-types';

function litAfter(state: __GAME_PASCAL__State, move: __GAME_PASCAL__Move): number {
  return applyMove(state, move).state.cells.filter((cell) => cell === 1).length;
}

/** Greedy: the move that leaves the fewest lit cells (first one on ties). No randomness used. */
export const greedyBot: BotPolicy<__GAME_PASCAL__State, __GAME_PASCAL__Move> = (
  state,
  moves,
  rng,
) => {
  let best = moves[0];
  let bestLit = Number.POSITIVE_INFINITY;
  for (const move of moves) {
    const lit = litAfter(state, move);
    if (lit < bestLit) {
      best = move;
      bestLit = lit;
    }
  }
  if (best === undefined) throw new Error('greedyBot called without legal moves');
  return { move: best, rng };
};

const START = (): __GAME_PASCAL__State => create(1, 0);

/** Example states for screenshots, a debug menu and E2E setup: start, middle, win, lose. */
export const __GAME_CONST___TESTING: TestingSpec<__GAME_PASCAL__State, __GAME_PASCAL__Move> = {
  bot: greedyBot,
  examples: {
    start: START,
    middle: () => applyMove(START(), { kind: 'toggle', col: 1, row: 1 }).state,
    win: () => ({ ...START(), cells: START().cells.map(() => 0), moves: 2 }),
    lose: () => ({ ...START(), moves: START().maxMoves }),
  },
};
