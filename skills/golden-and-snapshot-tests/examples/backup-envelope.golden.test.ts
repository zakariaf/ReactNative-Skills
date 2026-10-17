// src/data/backup/backup-envelope.golden.test.ts
// DATA GOLDEN, all [contract]: backup format 1 is read by every later version and by files users
// keep, so these entries never change and are never deleted (adding a case is fine). A new format is
// encodeBackupV2 with its own [contract] cases next to these, while the reader keeps accepting format 1.
// Create cases only with `npx jest <this file> --selectProjects golden -u` and a Gate-Change trailer.
import { encodeBackup } from './backup-envelope';

import type { BackupTask } from './backup-envelope';

const TWO_TASKS: readonly BackupTask[] = [
  { id: 't1', title: 'Renew passport', isDone: false, dueKey: '2026-09-30' },
  { id: 't4', title: 'Pay rent', isDone: true, dueKey: null },
];
/** A right-to-left title (Arabic for "buy bread") proves the format keeps every character as written. */
const RTL_TASK: readonly BackupTask[] = [
  { id: 't9', title: 'شراء الخبز', isDone: false, dueKey: '2027-01-01' },
];

describe('[contract] encodeBackup goldens', () => {
  it('encodes format 1 for an empty list exported at the end of 2026-12-31', () => {
    expect(encodeBackup([], { exportedAt: '2026-12-31T23:59:59.000Z' })).toMatchSnapshot();
  });

  it('encodes format 1 for two tasks exported on 2026-10-03', () => {
    expect(encodeBackup(TWO_TASKS, { exportedAt: '2026-10-03T09:00:00.000Z' })).toMatchSnapshot();
  });

  it('encodes format 1 for a right-to-left title exported on 2027-01-01', () => {
    expect(encodeBackup(RTL_TASK, { exportedAt: '2027-01-01T00:00:00.000Z' })).toMatchSnapshot();
  });
});
