// src/data/backup/backup-upgrades.test.ts
import { BACKUP_SCHEMA_VERSION, FIRST_BACKUP_SCHEMA_VERSION } from './backup-envelope';
import { mapRows } from './backup-upgrade-step';
import { BACKUP_UPGRADES, backupUpgradeProblems, upgradeBackupPayload } from './backup-upgrades';

import type { BackupUpgrade } from './backup-upgrade-step';

describe('BACKUP_UPGRADES', () => {
  it('holds one step per schema version after the first that wrote backups, in order', () => {
    const versions = { first: FIRST_BACKUP_SCHEMA_VERSION, latest: BACKUP_SCHEMA_VERSION };
    expect(backupUpgradeProblems(BACKUP_UPGRADES, versions)).toStrictEqual([]);
  });
});

describe('upgradeBackupPayload', () => {
  const addDueOn: BackupUpgrade = {
    version: 2,
    name: 'add-task-due-on',
    up: (payload) => mapRows(payload, 'tasks', (row) => ({ ...row, due_on: null })),
  };
  const renameName: BackupUpgrade = {
    version: 3,
    name: 'rename-list-name',
    up: (payload) =>
      mapRows(payload, 'lists', ({ name, ...row }) => ({ ...row, title: name ?? null })),
  };
  const steps = [addDueOn, renameName];
  const v1 = { lists: [{ id: 1, name: 'Home' }], tasks: [{ id: 1, list_id: 1 }] };

  it('applies only the steps newer than the file, in order, without changing the input', () => {
    expect(upgradeBackupPayload(v1, 1, steps)).toStrictEqual({
      lists: [{ id: 1, title: 'Home' }],
      tasks: [{ id: 1, list_id: 1, due_on: null }],
    });
    expect(upgradeBackupPayload(v1, 2, steps)).toStrictEqual({
      lists: [{ id: 1, title: 'Home' }],
      tasks: [{ id: 1, list_id: 1 }],
    });
    expect(v1.tasks[0]).toStrictEqual({ id: 1, list_id: 1 });
  });

  it('leaves a payload without that table, or with rows that are not objects, as it is', () => {
    expect(mapRows({ lists: [] }, 'tasks', () => ({}))).toStrictEqual({ lists: [] });
    expect(mapRows({ tasks: [1, null] }, 'tasks', () => ({}))).toStrictEqual({ tasks: [1, null] });
  });

  it('reports a missing or misordered step', () => {
    expect(backupUpgradeProblems([renameName], { first: 1, latest: 3 })).toStrictEqual([
      'upgrade versions are [3], expected [2, 3]',
    ]);
    expect(backupUpgradeProblems([renameName, addDueOn], { first: 1, latest: 3 })).toHaveLength(1);
  });
});
