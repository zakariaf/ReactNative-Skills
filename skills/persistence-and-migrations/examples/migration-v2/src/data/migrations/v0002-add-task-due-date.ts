// src/data/migrations/v0002-add-task-due-date.ts: version 2 of the app database: tasks get an optional due date. Frozen once it ships.
import type { Migration } from '@/data/migrations/migration-runner';

/**
 * ADD COLUMN keeps every row and gives it NULL; the CHECK accepts NULL and a 'YYYY-MM-DD' local
 * date key only. A change ALTER TABLE cannot make (a new constraint on an old column, a type change)
 * is a table rebuild instead: create tasks_new, copy, drop, rename, with rebuildsTables: true.
 */
export const ADD_TASK_DUE_DATE: Migration = {
  version: 2,
  name: 'add-task-due-date',
  up: (driver) => {
    driver.exec(`
ALTER TABLE tasks ADD COLUMN due_on TEXT
  CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]');
CREATE INDEX tasks_by_due_date ON tasks (due_on) WHERE due_on IS NOT NULL;
`);
  },
};
