// src/core/game/testing/play-choices.test.ts
import { playChoices } from './play-choices';

const RULES = {
  listMoves: (state: number): readonly number[] => (state < 5 ? [1, 2] : []),
  applyMove: (state: number, step: number) => ({
    state: state + step,
    events: [`added-${String(step)}`],
  }),
};

describe('playChoices', () => {
  it('picks move choice % legal moves and records every state and event', () => {
    expect(playChoices(RULES, 0, [0, 1, 3])).toStrictEqual({
      states: [0, 1, 3, 5],
      events: ['added-1', 'added-2', 'added-2'],
    });
  });

  it('stops when no legal move is left', () => {
    expect(playChoices(RULES, 4, [1, 1, 1]).states).toStrictEqual([4, 6]);
  });
});
