// src/features/tasks/task-urgency.test.ts
// TASKS-12. A comment may mention it.skip( or Date.now() without tripping the checker.
import fc from 'fast-check';

import { taskUrgency } from './task-urgency';

describe('taskUrgency', () => {
  it('returns today for a task due today (TASKS-12)', () => {
    expect(taskUrgency(0)).toBe('today');
  });

  it('returns overdue for a task past its date', () => {
    expect(taskUrgency(-1)).toBe('overdue');
  });

  it.each([
    [2, 'soon'],
    [3, 'later'],
  ] as const)('returns the right urgency %i days ahead', (daysLeft, urgency) => {
    expect(taskUrgency(daysLeft)).toBe(urgency);
  });

  it('can be replayed with the same answer', () => {
    fc.assert(fc.property(fc.integer(), (daysLeft) => taskUrgency(daysLeft) === taskUrgency(daysLeft)));
  });
});
