// src/core/stats/record-completion.test.ts
import { EMPTY_ACTIVITY_PROGRESS, recordCompletion } from './record-completion';

import type { ActivityProgress, Completion } from './record-completion';

type TasksDay = { readonly firstTaskId: number };

const START: ActivityProgress<TasksDay> = EMPTY_ACTIVITY_PROGRESS;

function completion(day: string, firstTaskId: number): Completion<TasksDay> {
  return {
    day,
    dayResult: { firstTaskId },
    event: { isSuccess: true, durationMs: 0, counters: {} },
    isPractice: false,
  };
}

describe('recordCompletion', () => {
  it('records the streak day and the statistics together, under the day the task started', () => {
    const next = recordCompletion(START, completion('2026-09-25', 1));

    expect(next.streak.byDay).toStrictEqual({ '2026-09-25': { firstTaskId: 1 } });
    expect([next.stats.total, next.stats.perDay['2026-09-25']?.count]).toStrictEqual([1, 1]);
  });

  it('counts a second completion of the day in the statistics only', () => {
    const first = recordCompletion(START, completion('2026-09-26', 1));
    const second = recordCompletion(first, completion('2026-09-26', 2));

    expect(second.streak).toBe(first.streak);
    expect([second.stats.total, second.stats.perDay['2026-09-26']?.count]).toStrictEqual([2, 2]);
  });

  it('records nothing for practice', () => {
    const sample = { ...completion('2026-09-26', 1), isPractice: true };

    expect(recordCompletion(START, sample)).toBe(START);
  });
});
