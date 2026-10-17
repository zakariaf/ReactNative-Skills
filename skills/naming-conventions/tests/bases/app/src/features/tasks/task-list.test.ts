// src/features/tasks/task-list.test.ts
import { countOpen, sortTasks } from './task-list';

const TASKS = [
  { id: 'task-1', title: 'Water the plants', isDone: true },
  { id: 'task-2', title: 'Buy milk', isDone: false },
];

describe('sortTasks', () => {
  describe('when some tasks are done', () => {
    it('lists open tasks first', () => {
      expect(sortTasks(TASKS)[0]?.id).toBe('task-2');
    });
  });
});

describe('countOpen', () => {
  it('can include done tasks', () => {
    expect(countOpen(TASKS, true)).toBe(2);
  });
});
