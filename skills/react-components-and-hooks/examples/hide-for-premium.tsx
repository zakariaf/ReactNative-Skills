// Example (shape only, never copied into the app): a component that reads one store value.
// A primitive selector, so it re-renders only when that one value changes. The Tasks screen wraps
// its upgrade banner in it; a selector that built an object would need useShallow.
import { useEntitlementStore } from '@/stores/entitlement-store';

import type { ReactNode } from 'react';

export type HideForPremiumProps = { readonly children: ReactNode };

export function HideForPremium({ children }: HideForPremiumProps): ReactNode {
  const isPremium = useEntitlementStore((state) => state.isPremium);
  return isPremium ? null : children;
}
