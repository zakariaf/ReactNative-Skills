// src/features/tasks/components/task-row.tsx: one task in the list, a checkbox that toggles it.
import { StyleSheet } from 'react-native';

import { makeStyles } from '@/theme/make-styles';
import { RADII, SPACING } from '@/theme/tokens';
import { useTheme } from '@/theme/use-theme';
import { AppText } from '@/ui/app-text';
import { PressableSurface } from '@/ui/pressable-surface';

import type { Task } from '@/features/tasks/task-list';

export type TaskRowProps = {
  readonly task: Task;
  readonly onToggle: (id: string) => void;
  /** From the app's reduce-motion hook, via the screen model. */
  readonly isReducedMotion: boolean;
};

const useStyles = makeStyles(() => {
  const styles = StyleSheet.create({
    face: { paddingBlock: SPACING.md, paddingInline: SPACING.lg },
  });
  return styles;
});

export function TaskRow({ task, onToggle, isReducedMotion }: TaskRowProps): React.JSX.Element {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <PressableSurface
      label={task.title}
      onPress={() => {
        onToggle(task.id);
      }}
      testID={`tasks.task-row.${task.id}`}
      radius={RADII.md}
      fill={theme.colors.surface}
      isReducedMotion={isReducedMotion}
      accessibilityRole="checkbox"
      isChecked={task.isDone}
      faceStyle={styles.face}
    >
      <AppText tone={task.isDone ? 'muted' : 'default'}>{task.title}</AppText>
    </PressableSurface>
  );
}
