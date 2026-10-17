// packages/billing/src/plan-text.ts (fixture: a package hands its texts to the app as plain ids)
export const PLAN_TEXTS = {
  monthly: { id: 'billing.plan.monthly' },
  yearly: { id: 'billing.plan.yearly' },
} as const;
