// src/features/tasks/tasks-state-copy.ts
// Every string the Tasks screen's non-happy paths show, translated in one pure step the model hook
// runs (the view never calls t()). The failure text comes from the failure's own message key, so
// a failed load says what failed instead of a generic "error".
import type { TFunction } from '@/i18n/create-t';
import type { ListScreenState } from '@/ui/feedback/screen-state';

export type TasksStateCopy = {
  readonly loadingLabel: string;
  readonly offlineTitle: string;
  readonly offlineBody: string;
  readonly failedTitle: string;
  /** The failure's message, or '' when the state is not failed. */
  readonly failedBody: string;
  readonly failedAction: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly emptyAction: string;
  readonly filteredTitle: string;
  readonly filteredBody: string;
  readonly filteredAction: string;
  /** Above a list that may be out of date (offline, or the refresh failed), else null. */
  readonly notice: string | null;
};

function noticeOf<TItem>(state: ListScreenState<TItem>, t: TFunction): string | null {
  if (state.kind !== 'ready' || state.notice === null) return null;
  return state.notice.kind === 'offline' ? t('tasks.notice.offline') : t(state.notice.messageKey);
}

export function tasksStateCopyOf<TItem>(
  state: ListScreenState<TItem>,
  t: TFunction,
): TasksStateCopy {
  return {
    loadingLabel: t('tasks.state.loading.label'),
    offlineTitle: t('tasks.state.offline.title'),
    offlineBody: t('tasks.state.offline.body'),
    failedTitle: t('tasks.state.failed.title'),
    failedBody: state.kind === 'failed' ? t(state.messageKey) : '',
    failedAction: t('tasks.state.failed.action'),
    emptyTitle: t('tasks.state.empty.title'),
    emptyBody: t('tasks.state.empty.body'),
    emptyAction: t('tasks.state.empty.action'),
    filteredTitle: t('tasks.state.filtered-empty.title'),
    filteredBody: t('tasks.state.filtered-empty.body'),
    filteredAction: t('tasks.state.filtered-empty.action'),
    notice: noticeOf(state, t),
  };
}
