// src/games/__GAME_ID__/levels/__GAME_ID__-describe.ts
// A level start as readable text for the data goldens: the move limit and the board ('#' lit,
// '.' dark). A game with more than a grid writes its own (every part a player sees at the start:
// a tray, lanes, a target and a turn budget, the first draws of its stream).
import { renderCells } from '@/core/game/testing/render-cells';

import type { __GAME_PASCAL__State } from '@/games/__GAME_ID__/rules/__GAME_ID__-types';

/** The golden text of a level start (the golden test adds the seed and the difficulty). */
export function describeLevel(state: __GAME_PASCAL__State): string {
  return [`moves ${String(state.maxMoves)}`, renderCells(state.cells, state.cols)].join('\n');
}
