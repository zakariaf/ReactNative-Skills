// src/i18n/direction-plan.test.ts
import { planDirection } from './direction-plan';

import type { DirectionPlan, DirectionPlanInput } from './direction-plan';

type Row = DirectionPlanInput & { readonly plan: DirectionPlan };

const ROWS: readonly Row[] = [
  { language: 'ar', layout: 'rtl', pendingRestart: null, plan: 'keep' },
  { language: 'en', layout: 'ltr', pendingRestart: 'rtl', plan: 'keep' },
  { language: 'ar', layout: 'ltr', pendingRestart: null, plan: 'restart' },
  { language: 'en', layout: 'rtl', pendingRestart: 'rtl', plan: 'restart' },
  { language: 'ar', layout: 'ltr', pendingRestart: 'rtl', plan: 'give-up' },
  { language: 'en', layout: 'rtl', pendingRestart: 'ltr', plan: 'give-up' },
  { language: 'ar', layout: 'ltr', pendingRestart: 'unreadable', plan: 'give-up' },
  { language: 'ar', layout: 'rtl', pendingRestart: 'unreadable', plan: 'keep' },
];

describe('planDirection', () => {
  it.each(ROWS)(
    'returns $plan for $language on a $layout layout (pending: $pendingRestart)',
    ({ plan, ...input }) => {
      expect(planDirection(input)).toBe(plan);
    },
  );
});
