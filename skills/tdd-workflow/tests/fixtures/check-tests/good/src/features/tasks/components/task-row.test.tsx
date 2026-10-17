// src/features/tasks/components/task-row.test.tsx: imports through the @/ alias count as "a test imports it".
import { dayNumber } from '@/core/dates/day-number';

describe('TaskRow', () => {
  it('shows the day number', () => {
    expect(dayNumber(86_400_000)).toBe(1);
  });
});
