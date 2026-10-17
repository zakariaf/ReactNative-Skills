// src/ui/use-pair-layout.ts
// Two blocks side by side (two summary cards, two keys) that stack when the text is large. The row
// and its cells come from here so every pair on every screen stacks at the same text size
// (useWindowClass().isLargeText, accessibility-as-code's threshold). A cell grows from its content
// (flexGrow 1, flexBasis 'auto'), never from a zero basis: `flex: 1` in a column collapsed a pair
// to 0 pt high on a device while every Jest test passed.
import { useWindowClass } from '@/hooks/use-window-class';

import type { ViewStyle } from 'react-native';

export type PairLayout = {
  readonly row: ViewStyle;
  readonly cell: ViewStyle;
  /** True while the pair is stacked (large text): a screen may then drop a divider. */
  readonly isStacked: boolean;
};

export function usePairLayout(gap: number): PairLayout {
  const { isLargeText } = useWindowClass();
  if (isLargeText) {
    return {
      row: { flexDirection: 'column', gap },
      cell: { alignSelf: 'stretch' },
      isStacked: true,
    };
  }
  return {
    row: { flexDirection: 'row', alignItems: 'stretch', gap },
    cell: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
    isStacked: false,
  };
}
