// src/features/tasks/components/hide-for-premium.tsx: one primitive selector, so it re-renders
// only when that value changes.
import { useTasksStore } from '@/stores/tasks-store';

import type { ReactNode } from 'react';

export type HideForPremiumProps = { readonly children: ReactNode };

export function HideForPremium({ children }: HideForPremiumProps): ReactNode {
  const isPremium = useTasksStore((state) => state.isPremium);
  return isPremium ? null : children;
}
