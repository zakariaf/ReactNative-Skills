// src/stores/tasks-reducer.ts
// Naming shape of a reducer module: an as-const table and its derived union, <Domain>State,
// <Domain>Action with imperative kebab-case `type` values, DEFAULT_<DOMAIN> and <domain>Reducer.
export const TASK_FILTERS = ['all', 'open', 'done'] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

export type TasksState = {
  readonly filter: TaskFilter;
  readonly selectedTaskId: string | null;
  readonly isEditing: boolean;
};

export type TasksAction =
  | { readonly type: 'set-filter'; readonly filter: TaskFilter }
  | { readonly type: 'select-task'; readonly taskId: string }
  | { readonly type: 'toggle-editing' }
  | { readonly type: 'reset-selection' };

export const DEFAULT_TASKS_STATE: TasksState = { filter: 'all', selectedTaskId: null, isEditing: false };

/** Pure reducer: every change to the task list's view state goes through here. */
export function tasksReducer(state: TasksState, action: TasksAction): TasksState {
  switch (action.type) {
    case 'set-filter':
      return { ...state, filter: action.filter };
    case 'select-task':
      return { ...state, selectedTaskId: action.taskId };
    case 'toggle-editing':
      return { ...state, isEditing: !state.isEditing };
    case 'reset-selection':
      return { ...state, selectedTaskId: null, isEditing: false };
  }
}
