// src/services/background-tasks/background-jobs.test.ts
import { MAX_JOB_BUDGET_MS } from './background-job';
import {
  BACKGROUND_INTERVAL_MINUTES,
  BACKGROUND_JOBS,
  backgroundJobNames,
} from './background-jobs';
import { MIN_INTERVAL_MINUTES } from './reconcile-background-tasks';

describe('BACKGROUND_JOBS', () => {
  it('names every job once', () => {
    const names = backgroundJobNames();

    expect(new Set(names).size).toBe(names.length);
    expect(names).toStrictEqual(BACKGROUND_JOBS.map((job) => job.name));
  });

  it('keeps every budget within the cap', () => {
    expect(BACKGROUND_JOBS.filter((job) => job.budgetMs > MAX_JOB_BUDGET_MS)).toStrictEqual([]);
  });

  it('uses a whole interval at or above the floor', () => {
    expect(Number.isInteger(BACKGROUND_INTERVAL_MINUTES)).toBe(true);
    expect(BACKGROUND_INTERVAL_MINUTES).toBeGreaterThanOrEqual(MIN_INTERVAL_MINUTES);
  });
});
