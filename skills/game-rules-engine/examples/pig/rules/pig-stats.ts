// src/games/pig/rules/pig-stats.ts
import type { PigEvent } from './pig-types';
import type { StatsSpec } from '@/core/game/stats';

function bankedIn(events: readonly PigEvent[]): number {
  let total = 0;
  for (const event of events) if (event.kind === 'turn-banked') total += event.points;
  return total;
}

export const PIG_STATS: StatsSpec<PigEvent> = {
  counters: [
    {
      id: 'dice-rolled',
      labelId: 'pig.stats.dice-rolled',
      aggregate: 'sum',
      measure: (events) => events.filter((event) => event.kind === 'die-rolled').length,
    },
    {
      id: 'points-banked',
      labelId: 'pig.stats.points-banked',
      aggregate: 'sum',
      measure: bankedIn,
    },
    { id: 'best-turn', labelId: 'pig.stats.best-turn', aggregate: 'max', measure: bankedIn },
  ],
};
