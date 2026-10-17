// src/stores/create-stores.ts: every domain store, created once per app start from the data layer.
import { createListsStore } from '@/stores/lists-store';
import { createTasksStore } from '@/stores/tasks-store';

import type { TaskRepository } from '@/data/tasks/task-repository';
import type { Stores } from '@/stores/stores-context';

/** What the stores read and write through: the data layer's repositories (members of AppData). */
export type StoreDeps = {
  readonly tasks: TaskRepository;
};

/**
 * The root layout calls it once, after the data layer is open (inside its useState initializer);
 * test/test-app.tsx calls it over fake repositories, so tests run the real factories. It is the
 * only caller of each create<Domain>Store.
 */
export function createStores(deps: StoreDeps): Stores {
  return {
    lists: createListsStore(deps),
    tasks: createTasksStore(deps),
  };
}
