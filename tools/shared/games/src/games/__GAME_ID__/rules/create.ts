// src/games/__GAME_ID__/rules/create.ts
import { nextInt, seedRng } from '@/core/rng/sfc32';

import { TUNING, knobsFor, pressesFor } from './__GAME_ID__-tuning';
import { neighbourhood, toggleCells } from './toggle-cells';

import type { Cell, __GAME_PASCAL__State } from './__GAME_ID__-types';

/**
 * Board side (3, 4 or 5 by tuning row) and 2..12 scramble presses, both rising with the difficulty
 * (0..100, clamped). This game has no endless mode, so 100 is simply the hardest shape. Every
 * number comes from the tuning file.
 */
export function shapeFor(difficulty: number): { readonly side: number; readonly presses: number } {
  return { side: knobsFor(difficulty).side, presses: pressesFor(difficulty) };
}

/**
 * Start state from (seed, difficulty): the same pair gives the same board on every device.
 * The board is scrambled by pressing seeded cells of a dark grid, so it is always solvable
 * in at most `presses` moves (a press undoes itself). The RNG is dropped afterwards: nothing
 * random happens during play, so the state carries no RngState.
 */
export function create(seed: number, difficulty: number): __GAME_PASCAL__State {
  const { side, presses } = shapeFor(difficulty);
  const size = side * side;
  let rng = seedRng(seed);
  let cells: Cell[] = Array.from({ length: size }, (): Cell => 0);
  for (let press = 0; press < presses; press += 1) {
    const draw = nextInt(rng, size);
    rng = draw.state;
    cells = toggleCells(cells, neighbourhood(side, side, draw.value));
  }
  if (cells.every((cell) => cell === 0)) cells = toggleCells(cells, neighbourhood(side, side, 0));
  return { cols: side, rows: side, cells, moves: 0, maxMoves: presses * TUNING.movesPerPress };
}
