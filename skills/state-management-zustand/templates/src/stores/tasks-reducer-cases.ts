// src/stores/tasks-reducer-cases.ts: the tasks rules as data; tasks-reducer.test.ts and check-reducers run them.
import type { ReducerCases } from '@/stores/reducer-cases';
import type { TasksAction, TasksState } from '@/stores/tasks-reducer';

const MILK = { id: 1, listId: 1, title: 'Buy milk', isDone: false, createdAtMs: 1_000 } as const;
const MAIL = { id: 2, listId: 1, title: 'Answer mail', isDone: true, createdAtMs: 2_000 } as const;
const BREAD = { id: 3, listId: 2, title: 'Buy bread', isDone: false, createdAtMs: 3_000 } as const;

export const TASKS_REDUCER_CASES: ReducerCases<TasksState, TasksAction> = {
  reducer: 'tasksReducer',
  initial: { tasks: [MILK, MAIL], loadFailure: null },
  cases: [
    {
      rule: 'add-task-appends',
      action: { type: 'add-task', task: BREAD },
      expect: { tasks: [MILK, MAIL, BREAD] },
    },
    { rule: 'add-task-once', action: { type: 'add-task', task: MILK }, same: true },
    {
      rule: 'set-done-changes-one-task',
      action: { type: 'set-done', taskId: 1, isDone: true },
      expect: {
        tasks: [
          { id: 1, isDone: true },
          { id: 2, isDone: true },
        ],
      },
    },
    {
      rule: 'set-done-unchanged-is-a-no-op',
      action: { type: 'set-done', taskId: 2, isDone: true },
      same: true,
    },
    {
      rule: 'set-done-unknown-task-is-a-no-op',
      action: { type: 'set-done', taskId: 99, isDone: true },
      same: true,
    },
    {
      rule: 'replace-clears-failure',
      state: { tasks: [], loadFailure: { kind: 'storage-busy' } },
      action: { type: 'replace-tasks', tasks: [BREAD] },
      expect: { tasks: [BREAD], loadFailure: null },
    },
    {
      rule: 'failure-empties',
      action: { type: 'record-load-failure', failure: { kind: 'storage-unavailable', code: 11 } },
      expect: { tasks: [], loadFailure: { kind: 'storage-unavailable', code: 11 } },
    },
  ],
};
