// src/stores/tasks-selectors.test.ts
import {
  selectOpenTaskCount,
  selectTasks,
  selectTasksLoadFailure,
  selectTasksOfList,
} from '@/stores/tasks-selectors';

import type { TasksState } from '@/stores/tasks-reducer';

const STATE: TasksState = {
  tasks: [
    { id: 1, listId: 1, title: 'Buy milk', isDone: false, createdAtMs: 0 },
    { id: 2, listId: 1, title: 'Answer mail', isDone: true, createdAtMs: 0 },
    { id: 3, listId: 2, title: 'Buy bread', isDone: false, createdAtMs: 0 },
  ],
  loadFailure: null,
};

describe('tasks selectors', () => {
  it('returns references and primitives', () => {
    expect(selectTasks(STATE)).toBe(STATE.tasks);
    expect(selectTasksLoadFailure(STATE)).toBeNull();
    expect(selectOpenTaskCount(STATE)).toBe(2);
  });

  it('picks the tasks of one list, building a new array each time', () => {
    expect(selectTasksOfList(STATE, 1).map((task) => task.id)).toStrictEqual([1, 2]);
    expect(selectTasksOfList(STATE, 1)).not.toBe(selectTasksOfList(STATE, 1));
  });
});
