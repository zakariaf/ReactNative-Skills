// src/features/tasks/task-list-state.ts (example: what the Tasks screen shows, from the query's state)
// Pure: TanStack's status and fetchStatus in, one view state out, so every combination is a unit test.
// v5 semantics: status says whether there is data ('pending' = none yet), fetchStatus whether a
// request runs ('fetching'), waits for the network ('paused') or rests ('idle'). A failed refetch keeps
// the old data (status 'error' with data): the list stays and a notice says it may be out of date.
import { apiFailureOf } from '@/api/api-error';
import { API_FAILURE_MESSAGES } from '@/api/api-failure-message';

import type { Task } from './task-list';
import type { MessageKey } from '@/i18n/messages';
import type { UseQueryResult } from '@tanstack/react-query';

export type TaskListState =
  | { readonly kind: 'loading' }
  /** Nothing cached and no network: the request waits and runs when the device is back online. */
  | { readonly kind: 'offline' }
  | { readonly kind: 'failed'; readonly messageKey: MessageKey }
  | {
      readonly kind: 'ready';
      readonly tasks: readonly Task[];
      readonly isRefreshing: boolean;
      /** Shown above a list that may be out of date (offline, or the last refresh failed). */
      readonly noticeKey: MessageKey | null;
    };

export type TaskQuerySnapshot = Pick<
  UseQueryResult<readonly Task[]>,
  'data' | 'error' | 'status' | 'fetchStatus'
>;

/** The message for a query error; a bug (not an ApiError) reads as an invalid response. */
function messageOf(error: Error | null): MessageKey {
  const failure = apiFailureOf(error);
  return (
    (failure === null ? null : API_FAILURE_MESSAGES[failure.kind]) ??
    API_FAILURE_MESSAGES['invalid-response']
  );
}

/** The notice above a list that is shown but may be out of date, or null. */
function noticeOf(query: TaskQuerySnapshot): MessageKey | null {
  if (query.fetchStatus === 'paused') return API_FAILURE_MESSAGES['network-unavailable'];
  return query.status === 'error' ? messageOf(query.error) : null;
}

/** The view state of the task list. */
export function taskListStateOf(query: TaskQuerySnapshot): TaskListState {
  if (query.data === undefined) {
    if (query.status === 'error') return { kind: 'failed', messageKey: messageOf(query.error) };
    return query.fetchStatus === 'paused' ? { kind: 'offline' } : { kind: 'loading' };
  }
  return {
    kind: 'ready',
    tasks: query.data,
    isRefreshing: query.fetchStatus === 'fetching',
    noticeKey: noticeOf(query),
  };
}
