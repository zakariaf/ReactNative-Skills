// src/features/tasks/task-list.test.ts
import { sortOpenFirst } from './task-list';

describe('sortOpenFirst', () => {
  it('puts open tasks before done ones', () => {
    const tasks = [{ id: 'a', isDone: true }, { id: 'b', isDone: false }];
    expect(sortOpenFirst(tasks).map((task) => task.id)).toStrictEqual(['b', 'a']);
  });
});
