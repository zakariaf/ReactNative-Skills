// src/features/__DETAIL__/use-__DETAIL__-model.ts
// The only code of the feature that reads copy, the URL params, settings and navigation; the route
// hands what it returns to the pure view. The params are parsed here, never trusted: a failure is the
// invalid-link state, whose one way out uses dismissTo, never navigate or push (a link usually opens
// this screen alone, and dismissTo then replaces it with the first screen, so Back cannot return to
// the dead link). Reading the item for a valid id is the next behaviour to add, test-first.
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useT } from '@/i18n/t-context';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import { parse__DETAIL_PASCAL__Params } from './__DETAIL__-params';

/** Which layout the screen shows: the item's id parsed from the URL, or an invalid link. */
export type __DETAIL_PASCAL__State =
  | { readonly kind: 'ready'; readonly __PARAM__: string }
  | { readonly kind: 'invalid-link' };

/** What the screen renders, in every state. */
export type __DETAIL_PASCAL__Model = {
  /** The navigation title; the route hands it to the Stack header. */
  readonly title: string;
  readonly state: __DETAIL_PASCAL__State;
  readonly body: string;
  readonly invalidLinkText: string;
  readonly goHomeLabel: string;
  readonly onGoHome: () => void;
  readonly isReducedMotion: boolean;
};

export function use__DETAIL_PASCAL__Model(): __DETAIL_PASCAL__Model {
  const t = useT();
  const router = useRouter();
  const isReducedMotion = useReduceMotion();
  const params = parse__DETAIL_PASCAL__Params(useLocalSearchParams());
  return {
    title: t('__DETAIL__.title'),
    state: params.ok
      ? { kind: 'ready', __PARAM__: params.value.__PARAM__ }
      : { kind: 'invalid-link' },
    body: t('__DETAIL__.body'),
    invalidLinkText: t('__DETAIL__.invalid-link.body'),
    goHomeLabel: t('__DETAIL__.invalid-link.go-home'),
    onGoHome: () => {
      router.dismissTo('/');
    },
    isReducedMotion,
  };
}
