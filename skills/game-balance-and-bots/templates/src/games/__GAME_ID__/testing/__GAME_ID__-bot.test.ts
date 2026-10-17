// src/games/__GAME_ID__/testing/__GAME_ID__-bot.test.ts
import { seedRng } from '@/core/rng/sfc32';
import { create } from '@/games/__GAME_ID__/rules/create';
import { listMoves } from '@/games/__GAME_ID__/rules/list-moves';
import { toggleCells, neighbourhood } from '@/games/__GAME_ID__/rules/toggle-cells';

import {
  __GAME_CAMEL__Bot,
  evaluate__GAME_PASCAL__,
  scoreOf__GAME_PASCAL__,
  tag__GAME_PASCAL__Event,
} from './__GAME_ID__-bot';

import type { __GAME_PASCAL__State } from '@/games/__GAME_ID__/rules/__GAME_ID__-types';

/** A 3x3 board one press from dark: the centre press lit its cross. */
const ONE_PRESS: __GAME_PASCAL__State = {
  cols: 3,
  rows: 3,
  cells: toggleCells(Array.from({ length: 9 }, () => 0 as const), neighbourhood(3, 3, 4)),
  moves: 0,
  maxMoves: 6,
};

describe('evaluate__GAME_PASCAL__', () => {
  it('prefers a board one press from dark, ranks a win above every board and a loss below', () => {
    const fewer = { ...ONE_PRESS, cells: toggleCells(ONE_PRESS.cells, [1, 3]) };
    const won = { ...ONE_PRESS, cells: ONE_PRESS.cells.map(() => 0 as const), moves: 1 };
    const lost = { ...ONE_PRESS, moves: ONE_PRESS.maxMoves };
    expect(evaluate__GAME_PASCAL__(ONE_PRESS)).toBeGreaterThan(evaluate__GAME_PASCAL__(fewer));
    expect(evaluate__GAME_PASCAL__(won)).toBeGreaterThan(evaluate__GAME_PASCAL__(ONE_PRESS));
    expect(evaluate__GAME_PASCAL__(lost)).toBeLessThan(evaluate__GAME_PASCAL__(ONE_PRESS));
  });

  it('prefers fewer lit cells when no single press finishes the board', () => {
    const three = { ...ONE_PRESS, cells: toggleCells(ONE_PRESS.cells, [4, 5]) };
    const two = { ...three, cells: toggleCells(three.cells, [7]) };
    expect(evaluate__GAME_PASCAL__(two)).toBeGreaterThan(evaluate__GAME_PASCAL__(three));
  });
});

describe('scoreOf__GAME_PASCAL__', () => {
  it('reports the win score the result screen shows, and 0 before a win', () => {
    const won = { ...ONE_PRESS, cells: ONE_PRESS.cells.map(() => 0 as const), moves: 2 };
    expect(scoreOf__GAME_PASCAL__(won)).toBe(40);
    expect(scoreOf__GAME_PASCAL__(ONE_PRESS)).toBe(0);
  });
});

describe('tag__GAME_PASCAL__Event', () => {
  it('tags the dark board as the payoff and a press that toggles its neighbours as the twist', () => {
    expect(tag__GAME_PASCAL__Event({ kind: 'board-cleared' })).toStrictEqual(['payoff']);
    expect(tag__GAME_PASCAL__Event({ kind: 'cells-toggled', cells: [1, 3, 4, 5, 7] })).toStrictEqual([
      'twist',
    ]);
    expect(tag__GAME_PASCAL__Event({ kind: 'cells-toggled', cells: [0, 1, 3] })).toStrictEqual([]);
    expect(tag__GAME_PASCAL__Event({ kind: 'moves-added', count: 3 })).toStrictEqual([]);
  });
});

describe('__GAME_CAMEL__Bot', () => {
  it('takes the press that clears the board', () => {
    const choice = __GAME_CAMEL__Bot(ONE_PRESS, listMoves(ONE_PRESS), seedRng(1));
    expect(choice.move).toStrictEqual({ kind: 'toggle', col: 1, row: 1 });
  });

  it('plays only listed moves on a real level', () => {
    const start = create(7, 40);
    const moves = listMoves(start);
    expect(moves).toContainEqual(__GAME_CAMEL__Bot(start, moves, seedRng(7)).move);
  });
});
