// src/ui/use-page-bottom-padding.ts
// The bottom padding of a page body. A page that scrolls on under the home indicator (iOS) or the
// navigation bar (Android draws edge to edge) leaves the frame's bottom edge off, so its content
// ends with the larger of the page padding and the bottom inset: the last block clears the system
// bar at the end of the scroll and still runs under it at rest. Without a safe-area provider (a
// test that does not give one) the inset is 0.
import { use } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { SPACING } from '@/theme/tokens';

/** Space under the last block of a page body. */
export const PAGE_BOTTOM_PADDING = SPACING.xl;

export function usePageBottomPadding(isUnderHomeIndicator: boolean): number {
  const insets = use(SafeAreaInsetsContext);
  if (!isUnderHomeIndicator) return PAGE_BOTTOM_PADDING;
  return Math.max(PAGE_BOTTOM_PADDING, insets?.bottom ?? 0);
}
