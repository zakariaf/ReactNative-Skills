// src/core/task-filter.ts
export function openTaskCount(doneFlags: readonly boolean[]): number {
  return doneFlags.filter((isDone) => !isDone).length;
}
