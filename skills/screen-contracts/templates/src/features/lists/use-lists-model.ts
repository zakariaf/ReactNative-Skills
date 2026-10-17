// src/features/lists/use-lists-model.ts
// The only code of the Lists screen that reads the data layer, the copy and the reduce-motion
// setting: the route calls it and hands the result to the pure view. Every text arrives translated,
// so the view never calls t(). It also owns the delete dialog (contracts/screens.json, screen
// "delete-list-dialog"): the dialog is opened by the handler a person's press uses, never by a flag
// a test or a screenshot run sets. The lists are read once on mount and again after a change; an app
// whose lists change elsewhere reads them from a store instead (state-management-zustand).
import { useState } from 'react';

import { useAppData } from '@/data/app-data-context';
import { useT } from '@/i18n/t-context';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { listsStateOf } from './lists-state';

import type { ListsState } from './lists-state';
import type { TaskList } from '@/data/tasks/task-repository';
import type { TFunction } from '@/i18n/create-t';

/** The delete dialog's copy, translated; null while the dialog is closed. */
export type DeleteListDialogModel = {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
};

/** What the Lists screen renders, in every state. */
export type ListsModel = {
  /** The navigation title (the route hands it to the Stack header). */
  readonly title: string;
  readonly state: ListsState;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly errorText: string;
  readonly retryLabel: string;
  /** A row's delete button: its visible text ("Delete") and its accessible name ("Delete Groceries"). */
  readonly deleteText: string;
  readonly deleteLabelOf: (listName: string) => string;
  readonly deleteDialog: DeleteListDialogModel | null;
  readonly onRetry: () => void;
  readonly onAskDelete: (listId: number) => void;
  readonly onConfirmDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly isReducedMotion: boolean;
};

type ListsCopy = Pick<
  ListsModel,
  'title' | 'emptyTitle' | 'emptyBody' | 'errorText' | 'retryLabel' | 'deleteText' | 'deleteLabelOf'
>;

/** Every fixed text of the screen, translated (the contract's copy keys, as literals). */
function listsCopyOf(t: TFunction): ListsCopy {
  return {
    title: t('lists.title'),
    emptyTitle: t('lists.empty.title'),
    emptyBody: t('lists.empty.body'),
    errorText: t('lists.error.body'),
    retryLabel: t('lists.retry-button.label'),
    deleteText: t('lists.list-row.delete-button.text'),
    deleteLabelOf: (listName) => t('lists.list-row.delete-button.label', { listName }),
  };
}

/** The delete dialog's copy for the pending list, or null while no delete is pending. */
function deleteDialogOf(t: TFunction, pending: TaskList | null): DeleteListDialogModel | null {
  if (pending === null) return null;
  return {
    title: t('lists.delete-dialog.title', { listName: pending.name }),
    body: t('lists.delete-dialog.body'),
    confirmLabel: t('lists.delete-dialog.confirm'),
    cancelLabel: t('lists.delete-dialog.cancel'),
  };
}

export function useListsModel(): ListsModel {
  const t = useT();
  const { tasks } = useAppData();
  const isReducedMotion = useReduceMotion();
  const [state, setState] = useState(() => listsStateOf(tasks.lists()));
  const [pendingId, setPendingId] = useState<number | null>(null);
  const pending =
    state.kind === 'default' ? (state.lists.find((list) => list.id === pendingId) ?? null) : null;
  return {
    ...listsCopyOf(t),
    state,
    deleteDialog: deleteDialogOf(t, pending),
    onRetry: () => {
      setState(listsStateOf(tasks.lists()));
    },
    onAskDelete: setPendingId,
    onConfirmDelete: () => {
      setPendingId(null);
      if (pending === null) return;
      const removed = tasks.removeList(pending.id);
      setState(
        removed.ok ? listsStateOf(tasks.lists()) : { kind: 'error', failure: removed.error },
      );
    },
    onCancelDelete: () => {
      setPendingId(null);
    },
    isReducedMotion,
  };
}
