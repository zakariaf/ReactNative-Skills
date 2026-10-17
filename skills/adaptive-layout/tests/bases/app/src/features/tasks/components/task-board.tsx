// src/features/tasks/components/task-board.tsx: tasks as cards; the columns follow the board's own width.
import { FlatList, View } from 'react-native';

import { gridColumnsOf } from '@/ui/adaptive/pane-layout';
import { useMeasuredWidth } from '@/ui/adaptive/use-measured-width';

import type { Task } from '../task-list';

const CARD_MIN_WIDTH = 160;

export function TaskBoard(props: { readonly tasks: readonly Task[] }): React.JSX.Element {
  const { width, onLayout } = useMeasuredWidth();
  const columns = width === null ? 1 : gridColumnsOf({ width, minCellWidth: CARD_MIN_WIDTH, gap: 12, maxColumns: 4 });
  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      {width === null ? null : (
        <FlatList
          key={`grid-${columns}`}
          numColumns={columns}
          data={props.tasks}
          keyExtractor={(task) => task.id}
          renderItem={({ item }) => <View testID={`tasks.card.${item.id}`} style={{ flex: 1, minWidth: CARD_MIN_WIDTH }} />}
        />
      )}
    </View>
  );
}
