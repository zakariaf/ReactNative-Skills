// Example (shape only, never copied): a Tasks row that works with a mouse, a keyboard and a finger.
// src/features/tasks/components/task-row.tsx
// - Hover from onHoverIn/onHoverOut (typed in React Native, fired by a mouse on the web, an iPad pointer
//   and an Android mouse); React Native's Pressable state types only `pressed`.
// - A focus ring drawn from onFocus/onBlur, because the default outline is removed by the reset.
// - `cursor: 'pointer'` and non-selectable labels: a double-click toggles instead of selecting text.
// - One file for every platform: nothing here needs a .web file.
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useT } from '@/i18n/t';
import { makeStyles } from '@/theme/make-styles';
import { AppText } from '@/ui/app-text';

import type { Task } from '../task-list';

export type TaskRowProps = {
  readonly task: Task;
  readonly onToggle: (id: string) => void;
};

export function TaskRow({ task, onToggle }: TaskRowProps): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Pressable
      testID={`tasks.task-row.${task.id}`}
      role="checkbox"
      aria-checked={task.isDone}
      accessibilityLabel={task.title}
      accessibilityHint={t('tasks.row.toggle-hint')}
      onPress={() => {
        onToggle(task.id);
      }}
      onHoverIn={() => {
        setIsHovered(true);
      }}
      onHoverOut={() => {
        setIsHovered(false);
      }}
      onFocus={() => {
        setIsFocused(true);
      }}
      onBlur={() => {
        setIsFocused(false);
      }}
      style={[styles.row, isHovered && styles.hovered, isFocused && styles.focused]}
    >
      <View style={[styles.box, task.isDone && styles.boxDone]} />
      {/* Enter toggles a checkbox role on the web; Space presses only role="button" (react-native-web 0.21). */}
      <AppText role="body" selectable={false}>
        {task.title}
      </AppText>
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: theme.minTouch,
    paddingHorizontal: theme.spacing.lg,
    cursor: 'pointer',
  },
  hovered: { backgroundColor: theme.colors.surfaceHover },
  focused: { borderColor: theme.colors.focusRing, borderWidth: theme.stroke.regular },
  box: { width: 20, height: 20, borderRadius: theme.radii.sm, borderWidth: theme.stroke.regular },
  boxDone: { backgroundColor: theme.colors.accent },
}));
