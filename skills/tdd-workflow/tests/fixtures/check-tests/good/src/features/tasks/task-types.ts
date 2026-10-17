// src/features/tasks/task-types.ts: types only, nothing for a test to run.
export type TaskId = string;
export type TaskFilter = (taskId: TaskId) => boolean;
