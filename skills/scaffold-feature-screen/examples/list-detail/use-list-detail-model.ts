// src/features/list-detail/use-list-detail-model.ts
// The scaffold's model after three test-first steps: it reads the list's tasks through the data
// context for a parsed id, picks the state with the pure chooser, and retries on an error. The
// params are still parsed here and nowhere else; the way out is still dismissTo('/'). The tasks are
// read once on mount and again on retry, so the screen goes stale while it stays mounted under a
// screen that changes them (an editor pushed on top). An app whose rows change elsewhere reads them
// from a store selector instead (state-management-zustand), or re-reads on focus (useFocusEffect).
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { useAppData } from '@/data/app-data-context';
import { useT } from '@/i18n/t-context';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { parseListDetailParams } from './list-detail-params';
import { listDetailStateOf } from './list-detail-state';

import type { ListDetailState } from './list-detail-state';

/** What the screen renders, in every state. */
export type ListDetailModel = {
  /** The navigation title; the route hands it to the Stack header. */
  readonly title: string;
  readonly state: ListDetailState;
  readonly emptyText: string;
  readonly notFoundText: string;
  readonly errorText: string;
  readonly retryLabel: string;
  readonly invalidLinkText: string;
  readonly goHomeLabel: string;
  readonly onRetry: () => void;
  readonly onGoHome: () => void;
  readonly isReducedMotion: boolean;
};

export function useListDetailModel(): ListDetailModel {
  const t = useT();
  const router = useRouter();
  const { tasks } = useAppData();
  const isReducedMotion = useReduceMotion();
  const params = parseListDetailParams(useLocalSearchParams());
  const listId = params.ok ? params.value.listId : null;
  const read = (): ListDetailState =>
    listDetailStateOf(listId === null ? null : tasks.tasksOf(listId));
  const [state, setState] = useState(read);
  return {
    title: t('list-detail.title'),
    state,
    emptyText: t('list-detail.empty.body'),
    notFoundText: t('list-detail.not-found.body'),
    errorText: t('list-detail.error.body'),
    retryLabel: t('list-detail.retry-button.label'),
    invalidLinkText: t('list-detail.invalid-link.body'),
    goHomeLabel: t('list-detail.invalid-link.go-home'),
    onRetry: () => {
      setState(read());
    },
    onGoHome: () => {
      router.dismissTo('/');
    },
    isReducedMotion,
  };
}
