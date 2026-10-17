// src/features/tasks/use-tasks-model.ts (example: the Tasks model hook with every non-happy path)
// The model decides; the view renders. One snapshot of the query becomes one ListScreenState, the
// copy is translated here, a delete happens at once with Undo, and the one irreversible action
// (clearing done tasks for good) asks first and runs only on 'confirmed'. Pull to refresh shows the
// platform spinner only for a refresh the person started, never for background refetches. The query
// and mutation factories come from src/api/tasks/ (networking-and-server-state);
// softDelete/restore/clearDone stand for the app's own mutations.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { apiFailureOf } from '@/api/api-error';
import { API_FAILURE_MESSAGES } from '@/api/api-failure-message';
import { taskMutations } from '@/api/tasks/task-mutations';
import { taskQueries } from '@/api/tasks/task-queries';
import { attemptAsync } from '@/core/result';
import { useReachability } from '@/hooks/use-reachability';
import { useT } from '@/i18n/t-context';
import { useServices } from '@/services/services-context';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';
import { FALLBACK_FAILURE_KEY, feedbackCopyOf } from '@/ui/feedback/feedback-copy';
import { listScreenStateOf } from '@/ui/feedback/screen-state';
import { runUndoable } from '@/ui/feedback/undoable';
import { useBusyAction } from '@/ui/feedback/use-busy-action';
import { useFeedback } from '@/ui/feedback/use-feedback';

import { tasksStateCopyOf } from './tasks-state-copy';

import type { Task } from './task-list';
import type { TasksStateCopy } from './tasks-state-copy';
import type { ApiFailure } from '@/api/api-failure';
import type { MessageKey } from '@/i18n/messages';
import type { Reachability } from '@/services/connectivity/connectivity-port';
import type { ListScreenState } from '@/ui/feedback/screen-state';

export type TaskFilter = 'all' | 'open';

export type TasksModel = {
  readonly state: ListScreenState<Task>;
  readonly copy: TasksStateCopy;
  readonly reachability: Reachability;
  readonly filter: TaskFilter;
  readonly isReducedMotion: boolean;
  /** The "Clear done" button shows its own busy state while the clear runs. */
  readonly isClearing: boolean;
  /** RefreshControl's `refreshing`: true only while a pull the person made runs. */
  readonly isRefreshingByUser: boolean;
  readonly onRefresh: () => void;
  readonly onRetry: () => void;
  readonly onCreate: () => void;
  readonly onClearFilter: () => void;
  readonly onDelete: (id: string) => void;
  readonly onClearDone: () => void;
};

/**
 * A failure as the message key of its kind. A bug (not an ApiFailure) reads as the fallback; a kind
 * whose message is null (cancelled: the screen that asked is gone) is never shown, so it gives null
 * and the state stays what it was.
 */
function failureKeyOf(failure: ApiFailure | null): MessageKey | null {
  return failure === null ? FALLBACK_FAILURE_KEY : API_FAILURE_MESSAGES[failure.kind];
}

export function useTasksModel(onCreate: () => void): TasksModel {
  const t = useT();
  const { api, connectivity, errorLog } = useServices();
  const queryClient = useQueryClient();
  const feedback = useFeedback();
  const [filter, setFilter] = useState<TaskFilter>('all');
  // A new filter is a new query key: keep the previous list on screen (ready, isRefreshing) until
  // the answer arrives, instead of dropping back to the loading placeholder.
  const query = useQuery({ ...taskQueries.list(api, filter), placeholderData: keepPreviousData });
  // The server filters, so an empty answer for 'open' cannot say whether any task exists at all.
  // The screen opens on 'all', so that list is in the cache: read it without fetching it again.
  const all = useQuery({ ...taskQueries.list(api, 'all'), enabled: false });
  const softDelete = useMutation(taskMutations.softDelete(api, queryClient));
  const restore = useMutation(taskMutations.restore(api, queryClient));
  const clearDone = useMutation(taskMutations.clearDone(api, queryClient));
  const state = listScreenStateOf<Task>({
    // undefined until the first answer: never `query.data ?? []`, which would read as "empty".
    items: query.data,
    isFetching: query.fetchStatus === 'fetching',
    isPaused: query.fetchStatus === 'paused',
    failureKey: query.status === 'error' ? failureKeyOf(apiFailureOf(query.error)) : null,
    // Filtered-empty only when unfiltered tasks exist (unknown counts as existing: "Show all"
    // then leads to the real answer); with no tasks at all, the empty state offers the first one.
    isFiltered: filter !== 'all' && (all.data === undefined || all.data.length > 0),
  });
  const shared = feedbackCopyOf(t);
  const clear = useBusyAction(
    async () => {
      const outcome = await feedback.confirm({
        title: t('tasks.clear-done.title'),
        body: t('tasks.clear-done.body'),
        confirmLabel: t('tasks.clear-done.confirm'),
        cancelLabel: t('common.cancel'),
        tone: 'destructive',
        testID: 'tasks.clear-done-dialog',
      });
      if (outcome !== 'confirmed') return;
      // The work never rejects: a failed clear becomes a Result and is shown, never only logged (the
      // button re-enabling with no message is a silent failure). Nothing changed, so a notice is enough.
      const cleared = await attemptAsync(() => clearDone.mutateAsync(), apiFailureOf);
      const failureKey = cleared.ok ? null : failureKeyOf(cleared.error);
      if (failureKey !== null) {
        feedback.notify({ text: t(failureKey), testID: 'tasks.clear-done-failed-notice' });
      }
    },
    // Only a contract-breaking rejection (a bug in the work above) reaches the error log.
    (error) => {
      errorLog.record('network', error);
    },
  );
  // Background refetches (focus, reconnect, the invalidation after every write) stay quiet in
  // ready.isRefreshing; RefreshControl spins only for the pull, or it would appear without one.
  // refetch() resolves with the query result even when it fails: the state's notice shows that.
  const refresh = useBusyAction(
    async () => {
      await query.refetch();
    },
    (error) => {
      errorLog.record('network', error);
    },
  );
  return {
    state,
    copy: tasksStateCopyOf(state, t),
    reachability: useReachability(connectivity),
    filter,
    isReducedMotion: useReduceMotion(),
    isClearing: clear.isBusy,
    isRefreshingByUser: refresh.isBusy,
    onRefresh: refresh.start,
    onRetry: () => {
      // Filters, scroll position and typed text live outside the query: they survive the retry.
      query.refetch().catch((error: unknown) => {
        errorLog.record('network', error);
      });
    },
    onCreate,
    onClearFilter: () => {
      setFilter('all');
    },
    onDelete: (id) => {
      runUndoable(
        {
          // mutateAsync rejects on failure; attemptAsync turns that into the Result runUndoable wants.
          apply: () => attemptAsync(() => softDelete.mutateAsync(id), apiFailureOf),
          revert: () => attemptAsync(() => restore.mutateAsync(id), apiFailureOf),
        },
        { doneText: t('tasks.deleted'), undoLabel: shared.undoLabel, testID: 'tasks.deleted-notice' },
        {
          notify: feedback.notify,
          // Nothing changed when a step fails, so a notice is enough: there is nothing to act on.
          onFailure: () => {
            feedback.notify({ text: t('tasks.delete-failed'), testID: 'tasks.delete-failed-notice' });
          },
          recordError: (error) => {
            errorLog.record('network', error);
          },
        },
      ).catch((error: unknown) => {
        errorLog.record('network', error);
      });
    },
    onClearDone: clear.start,
  };
}
