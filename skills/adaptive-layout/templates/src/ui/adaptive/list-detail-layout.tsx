// src/ui/adaptive/list-detail-layout.tsx
// Owned by the adaptive-layout skill. A list and its selected item side by side when two panes fit,
// or the one pane the route stands for when they do not. It renders what it is given and never
// navigates: the selection is the route's (a search param on the list route, the id of the detail
// route), so rotating, resizing or opening a link always lands on the same item. Its root reports
// its own width to useListDetailLayout, so the pane count follows the box the panes get (narrower
// than the window beside a side bar or in a sheet). The row mirrors by itself in a right-to-left
// layout (the list sits on the start side); the panes keep their keys, so the list keeps its scroll
// position and state when the box crosses the two-pane width.
import { StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, STROKE } from '@/theme/tokens';

import type { ListDetailPanes } from './use-list-detail-layout';
import type { ReactNode } from 'react';

export type ListDetailLayoutProps = {
  /** `<screen>.panes`; the panes are `<testID>.list`, `<testID>.detail` and `<testID>.detail-column`. */
  readonly testID: string;
  /** From useListDetailLayout(), through the screen's model: the pane layout and the root's onLayout. */
  readonly panes: ListDetailPanes;
  /** The pane this route shows when only one fits: the list route 'list', the detail route 'detail'. */
  readonly onePane: 'list' | 'detail';
  readonly list: ReactNode;
  /** The selected item's detail, or null when nothing is selected. */
  readonly detail: ReactNode;
  /** Shown in the detail pane when nothing is selected (a short hint, never a blank pane). */
  readonly emptyDetail: ReactNode;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    row: { flex: 1, flexDirection: 'row', backgroundColor: theme.colors.background },
    // The width comes from the layout; the hairline separates the panes on the end side.
    listPane: { borderEndWidth: STROKE.hair, borderEndColor: theme.colors.separator },
    fill: { flex: 1 },
    // A wide detail pane centres a readable column instead of stretching the lines.
    detailPane: { flex: 1, alignItems: 'center' },
    detailColumn: { flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH },
  });
  return styles;
});

export function ListDetailLayout(props: ListDetailLayoutProps): ReactNode {
  const styles = useStyles();
  const { layout, onLayout } = props.panes;
  const isTwoPane = layout.kind === 'two-pane';
  const isListShown = isTwoPane || props.onePane === 'list';
  const isDetailShown = isTwoPane || props.onePane === 'detail';
  // One pane: the list fills the row. Two panes: it takes the layout's width beside the detail.
  const listStyle =
    layout.kind === 'two-pane' ? [styles.listPane, { width: layout.listWidth }] : styles.fill;
  return (
    <View style={styles.row} onLayout={onLayout} testID={props.testID}>
      {isListShown ? (
        <View key="list" style={listStyle} testID={`${props.testID}.list`}>
          {props.list}
        </View>
      ) : null}
      {isDetailShown ? (
        <View key="detail" style={styles.detailPane} testID={`${props.testID}.detail`}>
          <View style={styles.detailColumn} testID={`${props.testID}.detail-column`}>
            {props.detail ?? props.emptyDetail}
          </View>
        </View>
      ) : null}
    </View>
  );
}
