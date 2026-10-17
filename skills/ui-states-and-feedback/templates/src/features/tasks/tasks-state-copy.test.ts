// src/features/tasks/tasks-state-copy.test.ts
import { tasksStateCopyOf } from './tasks-state-copy';

import type { TFunction } from '@/i18n/create-t';

/** Echoes the key: the test proves which key each field uses, the catalogs hold the words. */
const echo: TFunction = (key) => key;

describe('tasksStateCopyOf', () => {
  it('uses the failure’s own message for a failed load', () => {
    const copy = tasksStateCopyOf({ kind: 'failed', messageKey: 'feedback.failure.unknown' }, echo);
    expect(copy.failedBody).toBe('feedback.failure.unknown');
    expect(copy.failedTitle).toBe('tasks.state.failed.title');
    expect(copy.failedAction).toBe('tasks.state.failed.action');
  });

  it('gives empty and filtered-empty their own words and actions', () => {
    const copy = tasksStateCopyOf({ kind: 'empty' }, echo);
    expect([copy.emptyTitle, copy.emptyAction]).toStrictEqual([
      'tasks.state.empty.title',
      'tasks.state.empty.action',
    ]);
    expect([copy.filteredTitle, copy.filteredAction]).toStrictEqual([
      'tasks.state.filtered-empty.title',
      'tasks.state.filtered-empty.action',
    ]);
    expect(copy.failedBody).toBe('');
    expect(copy.notice).toBeNull();
  });

  it('notes why a list on screen may be out of date', () => {
    const ready = { kind: 'ready', items: ['a'], isRefreshing: false } as const;
    expect(tasksStateCopyOf({ ...ready, notice: { kind: 'offline' } }, echo).notice).toBe(
      'tasks.notice.offline',
    );
    expect(
      tasksStateCopyOf(
        { ...ready, notice: { kind: 'refresh-failed', messageKey: 'feedback.failure.unknown' } },
        echo,
      ).notice,
    ).toBe('feedback.failure.unknown');
    expect(tasksStateCopyOf({ ...ready, notice: null }, echo).notice).toBeNull();
  });
});
