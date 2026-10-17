// src/data/tasks/sqlite-task-repository.ts: tested from test/sqlite/ (it needs node:sqlite there).
export function createSqliteTaskRepository(path: string): { readonly path: string } {
  return { path };
}
