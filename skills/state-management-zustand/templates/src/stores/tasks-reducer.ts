// src/stores/tasks-reducer.ts: the rules of the tasks the app shows; pure, tested without React.
import type { Task, TaskFailure } from '@/data/tasks/task-repository';

/** What the tasks store holds: a copy of the rows on disk, never more. */
export type TasksState = {
  readonly tasks: readonly Task[];
  /** Why the last read failed (the tasks are then empty), or null after a good read. */
  readonly loadFailure: TaskFailure | null;
};

/** Imperative kebab-case requests. A new task arrives as the repository saved it (id included). */
export type TasksAction =
  | { readonly type: 'add-task'; readonly task: Task }
  | { readonly type: 'set-done'; readonly taskId: number; readonly isDone: boolean }
  | { readonly type: 'replace-tasks'; readonly tasks: readonly Task[] }
  | { readonly type: 'record-load-failure'; readonly failure: TaskFailure };

export const DEFAULT_TASKS_STATE: TasksState = { tasks: [], loadFailure: null };

function withDone(state: TasksState, taskId: number, isDone: boolean): TasksState {
  const task = state.tasks.find((item) => item.id === taskId);
  // An unknown task, or no change: the same object, so the store writes nothing.
  if (task === undefined || task.isDone === isDone) return state;
  return {
    ...state,
    tasks: state.tasks.map((item) => (item.id === taskId ? { ...item, isDone } : item)),
  };
}

/** Pure: no clock, no randomness, no mutation; the same object when nothing changes. */
export function tasksReducer(state: TasksState, action: TasksAction): TasksState {
  switch (action.type) {
    case 'add-task':
      return state.tasks.some((task) => task.id === action.task.id)
        ? state
        : { ...state, tasks: [...state.tasks, action.task] };
    case 'set-done':
      return withDone(state, action.taskId, action.isDone);
    case 'replace-tasks':
      return { ...state, tasks: action.tasks, loadFailure: null };
    case 'record-load-failure':
      return { ...state, tasks: [], loadFailure: action.failure };
  }
}
