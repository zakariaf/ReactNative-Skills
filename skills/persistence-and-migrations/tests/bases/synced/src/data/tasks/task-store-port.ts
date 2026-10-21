// src/data/tasks/task-store-port.ts: the Tasks app's synced task store, as features see it.
export type Task = { readonly id: string; readonly listId: string; readonly title: string; readonly done: boolean };

export type TaskStorePort = {
  /** Queues the change in the synced store's offline cache; never awaits the server. */
  readonly saveTask: (task: Task) => void;
  /** Calls `onTasks` with every snapshot of the list; returns the unsubscribe. */
  readonly watchList: (listId: string, onTasks: (tasks: readonly Task[]) => void) => () => void;
};
