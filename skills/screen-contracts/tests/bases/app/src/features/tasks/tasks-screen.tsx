// src/features/tasks/tasks-screen.tsx: the Tasks screen, a pure view of its props.
import { FlatList, StyleSheet } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { CONTENT_MAX_WIDTH, SPACING } from '@/theme/tokens';
import { AppText } from '@/ui/app-text';

import { TaskRow } from './components/task-row';

import type { Task } from './task-list';

export type TasksScreenProps = {
  /** Translated: "2 open tasks". */
  readonly summary: string;
  readonly tasks: readonly Task[];
  readonly onToggle: (id: string) => void;
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles((theme) => {
  const styles = StyleSheet.create({
    list: { flex: 1, backgroundColor: theme.colors.background },
    // A wide window (a tablet, a foldable) centres the column instead of stretching the rows.
    content: {
      width: '100%',
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: 'center',
      gap: SPACING.sm,
      paddingBlock: SPACING.lg,
      paddingInline: SPACING.lg,
    },
  });
  return styles;
});

export function TasksScreen(props: TasksScreenProps): React.JSX.Element {
  const styles = useStyles();
  return (
    <FlatList
      testID="tasks.list"
      style={styles.list}
      contentContainerStyle={styles.content}
      data={props.tasks}
      keyExtractor={(task) => task.id}
      ListHeaderComponent={
        <AppText testID="tasks.summary" tone="muted">
          {props.summary}
        </AppText>
      }
      renderItem={({ item }) => (
        <TaskRow task={item} onToggle={props.onToggle} isReducedMotion={props.isReducedMotion} />
      )}
    />
  );
}
