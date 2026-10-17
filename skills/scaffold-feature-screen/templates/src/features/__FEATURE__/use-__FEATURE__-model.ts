// src/features/__FEATURE__/use-__FEATURE__-model.ts
// The only code of the feature that reads copy, stores, services and navigation: the route calls it
// and hands the result to the pure view. Every text leaves here translated, so the view never calls
// t(). Grow it test-first; past about 40 lines, split the handlers into use-__FEATURE__-actions.ts and
// the derived values into a pure __FEATURE__-model-of.ts (react-components-and-hooks).
import { useT } from '@/i18n/t-context';

/** What the screen renders. */
export type __FEATURE_PASCAL__Model = {
  /** The navigation title; the route hands it to the Stack header. */
  readonly title: string;
  readonly body: string;
};

export function use__FEATURE_PASCAL__Model(): __FEATURE_PASCAL__Model {
  const t = useT();
  return {
    title: t('__FEATURE__.title'),
    body: t('__FEATURE__.body'),
  };
}
