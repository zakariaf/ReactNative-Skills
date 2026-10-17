// src/features/not-found/use-not-found-model.ts: the only code of the not-found screen that reads
// copy, settings and navigation. "Go to your tasks" uses dismissTo, never navigate or push: an
// unknown URL usually opens alone (a cold-start deep link), and dismissTo('/') then replaces it with
// the first screen, so Back cannot return to the dead link; when '/' is already below in the stack,
// dismissTo goes back to it instead of stacking a second copy (navigate and push would).
import { useRouter } from 'expo-router';

import { useT } from '@/i18n/t-context';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

/** What the not-found screen renders. */
export type NotFoundModel = {
  readonly title: string;
  readonly body: string;
  readonly goHomeLabel: string;
  readonly onGoHome: () => void;
  readonly isReducedMotion: boolean;
};

export function useNotFoundModel(): NotFoundModel {
  const t = useT();
  const router = useRouter();
  const isReducedMotion = useReduceMotion();
  return {
    title: t('not-found.title'),
    body: t('not-found.body'),
    goHomeLabel: t('not-found.go-home'),
    onGoHome: () => {
      router.dismissTo('/');
    },
    isReducedMotion,
  };
}
