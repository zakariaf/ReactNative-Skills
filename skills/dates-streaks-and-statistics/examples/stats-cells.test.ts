// examples/stats-cells.test.ts — the test that ships beside stats-cells.ts (src/features/stats/).
import { EMPTY_ACTIVITY_STATS } from '@/core/stats/activity-stats';
import { buildStatsSummary } from '@/core/stats/stats-summary';

import { counterCells, overviewCells, recordCells, streakCells } from './stats-cells';

const view = buildStatsSummary({
  stats: {
    ...EMPTY_ACTIVITY_STATS,
    total: 8,
    successes: 6,
    failures: 2,
    durationMs: 8_040_000,
    longestRun: 4,
    bestDay: { date: '2026-09-21', count: 5 },
    counters: { 'subtasks-completed': 42 },
  },
  streak: { activeDays: 30, current: 0, best: 9 },
  today: '2026-09-26',
  counterIds: ['subtasks-completed'],
});

describe('stats cells', () => {
  it('formats the overview: counts, the bare rate and a duration', () => {
    expect(overviewCells(view).map((cell) => cell.value)).toStrictEqual([
      { kind: 'count', value: 8 },
      { kind: 'count', value: 6 },
      { kind: 'percent', rate: 0.75 },
      { kind: 'duration', hours: 2, minutes: 14 },
    ]);
  });

  it('shows the stored streak counts', () => {
    expect(streakCells(view).map((cell) => cell.value)).toStrictEqual([
      { kind: 'days', daysCount: 0 },
      { kind: 'days', daysCount: 9 },
      { kind: 'count', value: 30 },
    ]);
  });

  it('adds the best day once there is one', () => {
    expect(recordCells(view).map((cell) => cell.testID)).toStrictEqual([
      'stats.records.on-time-run',
      'stats.records.best-day',
    ]);
  });

  it('reads counters by their stored id, a best-of as a record', () => {
    const cells = counterCells(view, [
      { id: 'subtasks-completed', labelKey: 'stats.subtasks-completed', aggregate: 'sum' },
      { id: 'longest-checklist', labelKey: 'stats.longest-checklist', aggregate: 'max' },
    ]);

    expect(cells.map((cell) => [cell.testID, cell.value])).toStrictEqual([
      ['stats.counters.subtasks-completed', { kind: 'count', value: 42 }],
      ['stats.counters.longest-checklist', { kind: 'record', value: 0 }],
    ]);
  });
});
