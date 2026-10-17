// src/data/backup/upgrades/v0002-add-task-due-on.ts: backup schema 1 to 2, the JSON twin of migration v0002 (tasks get due_on). Frozen once it ships.
import { mapRows } from '@/data/backup/backup-upgrade-step';

import type { BackupUpgrade } from '@/data/backup/backup-upgrade-step';

/** ALTER TABLE tasks ADD COLUMN due_on gives every existing row NULL; so does this step. */
export const ADD_TASK_DUE_ON: BackupUpgrade = {
  version: 2,
  name: 'add-task-due-on',
  up: (payload) => mapRows(payload, 'tasks', (row) => ({ ...row, due_on: null })),
};
