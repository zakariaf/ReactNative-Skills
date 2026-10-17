// src/features/tasks/components/due-label.tsx: time arrives as a prop; converting an instant is pure.
import { AppText } from '@/ui/app-text';

import type { ReactNode } from 'react';

export type DueLabelProps = {
  readonly dueAtMs: number;
  /** From the injected clock, read in the model hook. */
  readonly nowMs: number;
  readonly overdueText: string;
  readonly testID: string;
};

export function DueLabel({ dueAtMs, nowMs, overdueText, testID }: DueLabelProps): ReactNode {
  const due = new Date(dueAtMs);
  const isOverdue = dueAtMs < nowMs;
  return <AppText testID={testID}>{isOverdue ? overdueText : String(due.getUTCDate())}</AppText>;
}
