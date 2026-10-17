// src/games/__GAME_ID__/rules/__GAME_ID__-stats.test.ts
import { __GAME_CONST___STATS } from './__GAME_ID__-stats';

import type { __GAME_PASCAL__Event } from './__GAME_ID__-types';

const CLEARING_MOVE: readonly __GAME_PASCAL__Event[] = [
  { kind: 'cells-toggled', cells: [0, 1, 3] },
  { kind: 'board-cleared' },
];

describe('__GAME_CONST___STATS', () => {
  it('measures one move: cells toggled, boards cleared and the biggest toggle', () => {
    const measured = __GAME_CONST___STATS.counters.map((counter) => [
      counter.id,
      counter.measure(CLEARING_MOVE),
    ]);
    expect(measured).toStrictEqual([
      ['cells-toggled', 3],
      ['boards-cleared', 1],
      ['biggest-toggle', 3],
    ]);
  });

  it('declares 2 to 4 counters with unique kebab-case ids', () => {
    const ids = __GAME_CONST___STATS.counters.map((counter) => counter.id);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids.length).toBeLessThanOrEqual(4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toBe(true);
  });
});
