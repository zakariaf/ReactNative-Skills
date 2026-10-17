// src/features/tasks/use-tasks-model.ts
// Stand-in for the feature's model hook: it hands the player's layout, the state and the store's
// dispatch to the input hook.
import { useProgressGridInput } from './use-progress-grid-input';

import type { ProgressGridInputArgs, ProgressGridInput } from './use-progress-grid-input';

export type TasksModel = {
  readonly grid: ProgressGridInput;
  readonly picture: unknown;
  readonly gridLabel: string;
};

export function useTasksModel(args: ProgressGridInputArgs): TasksModel {
  return { grid: useProgressGridInput(args), picture: null, gridLabel: 'tasks.progress-grid.summary' };
}
