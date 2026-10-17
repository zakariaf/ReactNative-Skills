// src/features/lists/lists-state.test.ts
import { err, ok } from '@/core/result';

import { listsStateOf } from './lists-state';

import type { TaskList } from '@/data/tasks/task-repository';

const INBOX: TaskList = { id: 1, name: 'Inbox', createdAtMs: 0 };

describe('listsStateOf', () => {
  it('shows the lists when the repository returns some', () => {
    expect(listsStateOf(ok([INBOX]))).toStrictEqual({ kind: 'default', lists: [INBOX] });
  });

  it('shows the empty state when there are no lists yet', () => {
    expect(listsStateOf(ok([]))).toStrictEqual({ kind: 'empty' });
  });

  it('shows the error state with the failure when the repository fails', () => {
    const failure = { kind: 'storage-unavailable', code: null } as const;

    expect(listsStateOf(err(failure))).toStrictEqual({ kind: 'error', failure });
  });
});
