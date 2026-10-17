// src/stores/tasks-reducer.test.ts
import fc from 'fast-check';

import { caseProblem } from '@/stores/reducer-cases';
import { DEFAULT_TASKS_STATE, tasksReducer } from '@/stores/tasks-reducer';
import { TASKS_REDUCER_CASES } from '@/stores/tasks-reducer-cases';

import type { Task } from '@/data/tasks/task-repository';
import type { TasksState } from '@/stores/tasks-reducer';

const RULES = TASKS_REDUCER_CASES.cases.map((item) => [item.rule, item] as const);

const TASK = fc.record({
  id: fc.integer({ min: 1, max: 50 }),
  listId: fc.integer({ min: 1, max: 3 }),
  title: fc.string({ minLength: 1, maxLength: 20 }),
  isDone: fc.boolean(),
  createdAtMs: fc.nat(),
});

function stateOf(tasks: readonly Task[]): TasksState {
  return tasks.reduce(
    (state, task) => tasksReducer(state, { type: 'add-task', task: { ...task } }),
    DEFAULT_TASKS_STATE,
  );
}

describe('tasksReducer', () => {
  it.each(RULES)('keeps %s', (_rule, item) => {
    expect(caseProblem(tasksReducer, TASKS_REDUCER_CASES, item)).toBeNull();
  });

  it('leaves its input unchanged', () => {
    const task: Task = { id: 1, listId: 1, title: 'Buy milk', isDone: false, createdAtMs: 0 };
    const state = Object.freeze({
      ...DEFAULT_TASKS_STATE,
      tasks: Object.freeze([Object.freeze({ ...task })]),
    });
    expect(
      tasksReducer(state, { type: 'set-done', taskId: 1, isDone: true }).tasks[0]?.isDone,
    ).toBe(true);
    expect(state.tasks[0]?.isDone).toBe(false);
  });

  it('treats set-done twice like set-done once', () => {
    fc.assert(
      fc.property(
        fc.array(TASK, { maxLength: 10 }),
        fc.integer({ min: 1, max: 50 }),
        (tasks, id) => {
          const once = tasksReducer(stateOf(tasks), { type: 'set-done', taskId: id, isDone: true });
          expect(tasksReducer(once, { type: 'set-done', taskId: id, isDone: true })).toBe(once);
        },
      ),
    );
  });
});
