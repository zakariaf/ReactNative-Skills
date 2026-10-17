// src/data/tasks/task-failures.test.ts: every storage failure gets a Tasks name, and only the unexpected ones are recorded.
import { TASK_FAILURE_KINDS } from '@/data/tasks/task-repository';
import { createFakeErrorLog } from '@/services/error-log/fake-error-log';

import { nameStorageFailure, taskFailureOf } from './task-failures';

import type { TaskFailure } from '@/data/tasks/task-repository';
import type { StorageFailure } from '@/data/to-storage-failure';

/** tsc fails here when TaskFailure gains a kind that TASK_FAILURE_KINDS (the messages test's list) lacks. */
type UnlistedKind = Exclude<TaskFailure['kind'], (typeof TASK_FAILURE_KINDS)[number]>;
const IS_EVERY_KIND_LISTED: [UnlistedKind] extends [never] ? true : false = true;

const OTHER_FAILURES: readonly StorageFailure[] = [
  { kind: 'constraint', detail: 'unique' },
  { kind: 'full' },
  { kind: 'busy' },
  { kind: 'corrupt' },
  { kind: 'unknown', code: null },
];

describe('nameStorageFailure', () => {
  it('names a broken foreign key as the missing list only when the write knows the list', () => {
    const foreignKey = { kind: 'constraint', detail: 'foreign-key' } as const;
    expect(nameStorageFailure(foreignKey, { listId: 4 })).toStrictEqual({
      kind: 'list-not-found',
      listId: 4,
    });
    expect(nameStorageFailure(foreignKey, {})).toStrictEqual({
      kind: 'storage-unavailable',
      code: 19,
    });
  });

  it('maps every other storage failure to its Tasks kind', () => {
    expect(OTHER_FAILURES.map((storage) => nameStorageFailure(storage, {}))).toStrictEqual([
      { kind: 'storage-unavailable', code: 19 },
      { kind: 'storage-full' },
      { kind: 'storage-busy' },
      { kind: 'storage-unavailable', code: 11 },
      { kind: 'storage-unavailable', code: null },
    ]);
  });
});

describe('taskFailureOf', () => {
  it('records an unexpected failure with the raw error and leaves an expected one to the app', () => {
    const errorLog = createFakeErrorLog();
    const toFailure = taskFailureOf(errorLog);
    const corrupt = new Error('database disk image is malformed');
    expect(toFailure(corrupt)).toStrictEqual({ kind: 'storage-unavailable', code: 11 });
    expect(toFailure(new Error('database or disk is full'))).toStrictEqual({
      kind: 'storage-full',
    });
    expect(errorLog.recorded.map((entry) => entry.error)).toStrictEqual([corrupt]);
  });
});

describe('TASK_FAILURE_KINDS', () => {
  it('lists every kind once, and every storage failure is named with one of them', () => {
    expect(IS_EVERY_KIND_LISTED).toBe(true);
    expect(new Set(TASK_FAILURE_KINDS).size).toBe(TASK_FAILURE_KINDS.length);
    const listed: readonly string[] = TASK_FAILURE_KINDS;
    const storage: readonly StorageFailure[] = [
      ...OTHER_FAILURES,
      { kind: 'constraint', detail: 'foreign-key' },
    ];
    const named = storage.map((failure) => nameStorageFailure(failure, { listId: 4 }).kind);
    expect(named.filter((kind) => !listed.includes(kind))).toStrictEqual([]);
  });
});
