// src/features/tasks/components/task-board.tsx
// Example (shape only, never copied): tasks as cards in a grid whose columns follow the board's own
// width. Inside the detail pane of a 13-inch iPad the board is about 1,055 pt wide in a 1,376 pt
// window, so it measures its container instead of reading the window. The cells share the width
// minus the padding (2 x SPACING.md = 24) in steps of 160 + a 12 gap, so its test fires a layout
// event at: 288 (264 left: one column), 340 (316: still one, 2 x 160 + 12 = 332 does not fit),
// 380 (356: two columns of 172) and 1,055 (1,031: six fit, capped at four columns of 248).
import { FlatList, StyleSheet, View } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { gridCellWidthOf, gridColumnsOf } from '@/ui/adaptive/pane-layout';
import { useMeasuredWidth } from '@/ui/adaptive/use-measured-width';
import { AppText } from '@/ui/app-text';

import type { Task } from '@/features/tasks/task-list';
import type { ReactNode } from 'react';

/** The narrowest card that still holds a two-line title at 200 % text. */
const CARD_MIN_WIDTH = 160;
const MAX_COLUMNS = 4;

export type TaskBoardProps = {
  readonly testID: string;
  readonly tasks: readonly Task[];
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    fill: { flex: 1 },
    content: { padding: SPACING.md, gap: SPACING.md },
    row: { gap: SPACING.md },
    // The width comes from gridCellWidthOf: every card, the last row's too, keeps the grid's cell
    // size (flex: 1 would stretch a lone last card across the whole row).
    card: { padding: SPACING.md, borderRadius: RADII.md, backgroundColor: theme.colors.surface },
  });
  return styles;
});

export function TaskBoard({ testID, tasks }: TaskBoardProps): ReactNode {
  const styles = useStyles();
  const { width, onLayout } = useMeasuredWidth();
  const cellsWidth = width === null ? 0 : width - 2 * SPACING.md;
  const columns = gridColumnsOf({
    width: cellsWidth,
    minCellWidth: CARD_MIN_WIDTH,
    gap: SPACING.md,
    maxColumns: MAX_COLUMNS,
  });
  const cellWidth = gridCellWidthOf({ width: cellsWidth, gap: SPACING.md, columns });
  return (
    <View style={styles.fill} onLayout={onLayout} testID={testID}>
      {/* Nothing until the first layout: a one-column flash would remount at once. */}
      {width === null ? null : (
        <FlatList
          // A new column count must mount a fresh list: React Native throws on a changed numColumns.
          key={`grid-${String(columns)}`}
          numColumns={columns}
          data={tasks}
          keyExtractor={(task) => task.id}
          contentContainerStyle={styles.content}
          // FlatList rejects columnWrapperStyle when numColumns is 1.
          columnWrapperStyle={columns > 1 ? styles.row : undefined}
          renderItem={({ item }) => (
            <View style={[styles.card, { width: cellWidth }]} testID={`${testID}.card.${item.id}`}>
              <AppText testID={`${testID}.card.${item.id}.title`}>{item.title}</AppText>
            </View>
          )}
        />
      )}
    </View>
  );
}
