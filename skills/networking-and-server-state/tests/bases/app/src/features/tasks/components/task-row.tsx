// src/features/tasks/components/task-row.tsx: one task, a checkbox row (props only).
import { PressableSurface } from '@/ui/pressable-surface';

import type { Task } from '@/features/tasks/task-list';
import type { JSX } from 'react';

export type TaskRowProps = { readonly task: Task; readonly onToggle: (id: string) => void };

export function TaskRow({ task, onToggle }: TaskRowProps): JSX.Element {
  return (
    <PressableSurface
      testID={`tasks.task-row.${task.id}`}
      onPress={() => {
        onToggle(task.id);
      }}
    />
  );
}
