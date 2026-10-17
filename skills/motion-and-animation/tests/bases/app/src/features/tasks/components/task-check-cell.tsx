// src/features/tasks/components/task-check-cell.tsx
// The tap target of a task's checkbox. Marking the last open task done commits first, then plays
// the list-cleared celebration from the checkbox itself.
import { View } from 'react-native';

import { CelebrationBurst } from '@/ui/motion/celebration-burst';
import { MOTION_MOMENTS } from '@/ui/motion/motion-moments';
import { useCelebration } from '@/ui/motion/use-celebration';
import { PressableSurface } from '@/ui/pressable-surface';

import { TaskCheck } from './task-check';

import type { ReactNode } from 'react';

export type TaskCheckCellProps = {
  readonly taskId: string;
  readonly label: string;
  readonly isDone: boolean;
  readonly isLastOpen: boolean;
  readonly colors: readonly string[];
  readonly onToggle: (id: string) => void;
};

export function TaskCheckCell(props: TaskCheckCellProps): ReactNode {
  const celebration = useCelebration(MOTION_MOMENTS.listCleared);
  function handlePress(): void {
    props.onToggle(props.taskId);
    if (props.isLastOpen && !props.isDone) celebration.play(props.taskId);
  }
  return (
    <PressableSurface label={props.label} onPress={handlePress}>
      <View>
        <TaskCheck isDone={props.isDone} color={props.colors[0] ?? ''} />
        <CelebrationBurst celebration={celebration} colors={props.colors} testID="tasks.list-cleared" />
      </View>
    </PressableSurface>
  );
}
