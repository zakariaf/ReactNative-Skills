// src/data/tasks/task-failures.ts: names input and storage failures in the Tasks domain (the repository converts once, here).
import * as v from 'valibot';

import { toStorageFailure } from '@/data/to-storage-failure';

import type { TaskFailure } from '@/data/tasks/task-repository';
import type { StorageFailure } from '@/data/to-storage-failure';
import type { ErrorLogPort } from '@/services/error-log/error-log-port';

const SQLITE_CORRUPT = 11;
const SQLITE_CONSTRAINT = 19;

/** A damaged file, an I/O error or a bug; `code` is SQLite's primary result code when known. */
const unavailable = (code: number | null): TaskFailure => ({ kind: 'storage-unavailable', code });

/** What a write knows about its target, so a broken foreign key can name the missing list. */
export type FailureContext = { readonly listId?: number };

/** The first failing path of a schema check ('title', 'listId'); never the message text. */
export function invalidInput(
  issues: readonly [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]],
): TaskFailure {
  return { kind: 'task-input-invalid', field: v.getDotPath(issues[0]) ?? '(input)' };
}

/** Total, like every mapper. A constraint the input schema should have caught is a bug: unavailable. */
export function nameStorageFailure(storage: StorageFailure, context: FailureContext): TaskFailure {
  switch (storage.kind) {
    case 'constraint':
      return storage.detail === 'foreign-key' && context.listId !== undefined
        ? { kind: 'list-not-found', listId: context.listId }
        : unavailable(SQLITE_CONSTRAINT);
    case 'full':
      return { kind: 'storage-full' };
    case 'busy':
      return { kind: 'storage-busy' };
    case 'corrupt':
      return unavailable(SQLITE_CORRUPT);
    case 'unknown':
      return unavailable(storage.code);
  }
}

/**
 * The toFailure argument of attempt(): converts what the driver threw. An unexpected failure is
 * recorded with the raw error first, because past this line only the typed failure exists; an
 * expected one (a full disk, a missing list) is the app's to explain, not a defect to log.
 */
export function taskFailureOf(
  errorLog: Pick<ErrorLogPort, 'record'>,
  context: FailureContext = {},
): (thrown: unknown) => TaskFailure {
  return (thrown) => {
    const failure = nameStorageFailure(toStorageFailure(thrown), context);
    if (failure.kind === 'storage-unavailable') errorLog.record('storage', thrown);
    return failure;
  };
}
