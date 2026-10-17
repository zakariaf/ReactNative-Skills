// src/stores/tasks-selectors.ts: named reads of the tasks store.
// A selector returns a primitive or a reference that already lives in the state. One that builds a
// new array (selectTasksOfList) is read through useShallow at the call site:
//   const tasks = useTasksStore(useShallow((state) => selectTasksOfList(state, listId)));
import type { Task, TaskFailure } from '@/data/tasks/task-repository';
import type { TasksState } from '@/stores/tasks-reducer';
import type { TasksStoreState } from '@/stores/tasks-store';

export const selectTasks = (state: TasksState): readonly Task[] => state.tasks;

/** A number: no useShallow needed, even though it filters on the way. */
export const selectOpenTaskCount = (state: TasksState): number =>
  state.tasks.filter((task) => !task.isDone).length;

export const selectTasksLoadFailure = (state: TasksState): TaskFailure | null => state.loadFailure;

export const selectSetDone = (state: TasksStoreState): TasksStoreState['setDone'] => state.setDone;

export const selectAddTask = (state: TasksStoreState): TasksStoreState['addTask'] => state.addTask;

/** Builds a new array on every call: read it through useShallow. */
export function selectTasksOfList(state: TasksState, listId: number): readonly Task[] {
  return state.tasks.filter((task) => task.listId === listId);
}
