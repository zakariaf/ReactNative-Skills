// src/features/tasks/task-list.golden.test.ts
import { sortTasks } from './task-list';

describe('sortTasks', () => {
  it('keeps the readable order of the sample list', () => {
    expect(sortTasks([{ id: 'a', title: 'Water the plants', isDone: true }])).toMatchSnapshot();
  });
});
