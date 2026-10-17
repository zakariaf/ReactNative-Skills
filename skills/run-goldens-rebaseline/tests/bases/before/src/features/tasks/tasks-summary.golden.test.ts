// src/features/tasks/tasks-summary.golden.test.ts
// DATA GOLDEN (Jest 'golden' project).
import { summarizeTasks } from './tasks-summary';

describe('summarizeTasks goldens', () => {
  it('summarizes the sample list', () => {
    expect(summarizeTasks([{ id: 't1', isDone: false }])).toMatchSnapshot();
  });
});
