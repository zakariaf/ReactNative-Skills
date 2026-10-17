// src/games/__GAME_ID__/rules/__GAME_ID__-stats.ts
import type { __GAME_PASCAL__Event } from './__GAME_ID__-types';
import type { StatsSpec } from '@/core/game/stats';

function toggledIn(events: readonly __GAME_PASCAL__Event[]): number {
  let total = 0;
  for (const event of events) if (event.kind === 'cells-toggled') total += event.cells.length;
  return total;
}

/**
 * 2 to 4 counters for the game's statistics card. `measure` sees ONE move's events; the host folds
 * the values over the kept move line of a finished run (undone moves never count). Ids are
 * kebab-case and permanent: they are keys in stored statistics.
 */
export const __GAME_CONST___STATS: StatsSpec<__GAME_PASCAL__Event> = {
  counters: [
    {
      id: 'cells-toggled',
      labelId: '__GAME_ID__.stats.cells-toggled',
      aggregate: 'sum',
      measure: toggledIn,
    },
    {
      id: 'boards-cleared',
      labelId: '__GAME_ID__.stats.boards-cleared',
      aggregate: 'sum',
      measure: (events) => events.filter((event) => event.kind === 'board-cleared').length,
    },
    {
      id: 'biggest-toggle',
      labelId: '__GAME_ID__.stats.biggest-toggle',
      aggregate: 'max',
      measure: toggledIn,
    },
  ],
};
