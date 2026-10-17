// src/ui/adaptive/use-list-detail-layout.ts
// Owned by the adaptive-layout skill. The list-detail pane count for the box the panes get. The
// window is the wrong measure whenever the screen does not span it: beside a side tab bar or a
// permanent drawer, or in an iPad form sheet, the window is wider than the panes. So
// ListDetailLayout reports its own width through `onLayout`, and the decision follows it on every
// change (rotation, iPad Split View and Stage Manager, Android multi-window and freeform windows, a
// foldable opening, a side bar appearing). Before the first layout it estimates from the window
// minus the physical side insets, which is exact when the screen spans the window.
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWindowClass } from '@/hooks/use-window-class';

import { listDetailLayoutOf } from './pane-layout';
import { useMeasuredWidth } from './use-measured-width';

import type { PaneLayout } from './pane-layout';
import type { LayoutChangeEvent } from 'react-native';

export type ListDetailPanes = {
  /** One pane or two, for the box the panes have now. */
  readonly layout: PaneLayout;
  /** ListDetailLayout attaches it to its root view, so the pane count follows that box. */
  readonly onLayout: (event: LayoutChangeEvent) => void;
};

/** The pane layout from the panes' measured width (the window minus the side insets until then). */
export function useListDetailLayout(): ListDetailPanes {
  const windowClass = useWindowClass();
  const dimensions = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const measured = useMeasuredWidth();
  // The measured box is inside the screen's SafeAreaView, so its side insets are already off.
  const width = measured.width ?? dimensions.width - insets.left - insets.right;
  return { layout: listDetailLayoutOf({ width, windowClass }), onLayout: measured.onLayout };
}
