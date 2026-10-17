// src/games/__GAME_ID__/testing/__GAME_ID__-bot.ts
// The game's bot hooks: how a position looks to a bot, which events are the payoff and the twist,
// and the "reasonable player" the game's testing spec exposes as testing.bot. The template game is
// Lights Out: a press toggles a cell and its neighbours, and a dark board wins.
import { greedyPolicy } from '@/core/game-balance/bot-policies';
import { applyMove } from '@/games/__GAME_ID__/rules/apply-move';
import { listMoves } from '@/games/__GAME_ID__/rules/list-moves';
import { outcome } from '@/games/__GAME_ID__/rules/outcome';
import { neighbourhood } from '@/games/__GAME_ID__/rules/toggle-cells';

import type { BotPolicy } from '@/core/game/testing/play-bot';
import type { EventTag } from '@/core/game-balance/trace-bot';
import type {
  __GAME_PASCAL__Event,
  __GAME_PASCAL__Move,
  __GAME_PASCAL__State,
} from '@/games/__GAME_ID__/rules/__GAME_ID__-types';

/** Above any board the rules can make: a won position always outranks a playing one. */
const WON_VALUE = 1000;
/** What a board one press from dark is worth over its lit cells (a player sees the cross). */
const ONE_PRESS_BONUS = 5;
/** A press this big (away from the corners) shows the twist: the neighbours toggle too. */
const TWIST_CELLS = 4;

/** True when the lit cells are exactly one press's cross: a player presses its centre and wins. */
function isOnePressFromDark(state: __GAME_PASCAL__State, lit: number): boolean {
  return state.cells.some((_, index) => {
    const cross = neighbourhood(state.cols, state.rows, index);
    return cross.length === lit && cross.every((cell) => state.cells[cell] === 1);
  });
}

/**
 * Higher is better for the player: a win (more spare moves first), else fewer lit cells, with a
 * bonus for a board a player can finish with one press. Plain "fewest lit cells" wins only about
 * half of the easiest levels (it walks away from the finishing cross), which no person would.
 */
export function evaluate__GAME_PASCAL__(state: __GAME_PASCAL__State): number {
  const result = outcome(state);
  if (result.kind === 'won') return WON_VALUE + result.score;
  if (result.kind === 'lost') return -WON_VALUE;
  const lit = state.cells.filter((cell) => cell === 1).length;
  return isOnePressFromDark(state, lit) ? ONE_PRESS_BONUS - lit : -lit;
}

/** The report's "score": the win's score the result screen shows (spare moves), 0 otherwise. */
export function scoreOf__GAME_PASCAL__(state: __GAME_PASCAL__State): number {
  const result = outcome(state);
  return result.kind === 'won' ? result.score : 0;
}

/** Payoff: the board goes dark. Twist: a press that toggles its neighbours too (four or five cells). */
export function tag__GAME_PASCAL__Event(event: __GAME_PASCAL__Event): readonly EventTag[] {
  if (event.kind === 'board-cleared') return ['payoff'];
  return event.kind === 'cells-toggled' && event.cells.length >= TWIST_CELLS ? ['twist'] : [];
}

/** The testing spec's bot: the greedy "reasonable player". */
export const __GAME_CAMEL__Bot: BotPolicy<__GAME_PASCAL__State, __GAME_PASCAL__Move> = greedyPolicy(
  { listMoves, applyMove, outcome },
  evaluate__GAME_PASCAL__,
);
