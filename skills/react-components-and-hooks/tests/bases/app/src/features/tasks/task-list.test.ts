// src/features/tasks/task-list.test.ts
import { visibleTasks } from './task-list';

describe('visibleTasks', () => {
  it('sorts open tasks before done ones', () => {
    const tasks = [
      { id: 'task-1', title: 'Water the plants', isDone: true },
      { id: 'task-2', title: 'Buy milk', isDone: false },
    ];
    expect(visibleTasks(tasks, 'all').map((task) => task.id)).toStrictEqual(['task-2', 'task-1']);
  });
});
