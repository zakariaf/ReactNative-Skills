// test/sqlite/sqlite-task-repository.test.ts: Node APIs are fine under the root test/ folder.
import { existsSync } from 'node:fs';

import { createSqliteTaskRepository } from '@/data/tasks/sqlite-task-repository';

describe('createSqliteTaskRepository', () => {
  it('keeps the database path', () => {
    expect(createSqliteTaskRepository('tasks.db').path).toBe('tasks.db');
    expect(existsSync('/nonexistent-tasks.db')).toBe(false);
  });
});
