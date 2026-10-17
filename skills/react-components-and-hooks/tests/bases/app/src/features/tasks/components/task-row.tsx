// src/features/tasks/components/task-row.tsx
import { TileButton } from '@/ui/tile-button';

import { TaskTags } from './task-tags';

import type { Task } from '@/stores/tasks-store';
import type { ReactNode } from 'react';

export type TaskRowProps = {
  readonly task: Task;
  readonly onToggle: (id: string) => void;
};

export function TaskRow({ task, onToggle }: TaskRowProps): ReactNode {
  const handlePress = (): void => {
    onToggle(task.id);
  };
  return (
    <TileButton label={task.title} onPress={handlePress} testID={`tasks.task-row.${task.id}`}>
      <TaskTags tags={[]} testID={`tasks.task-row.${task.id}.tags`} />
    </TileButton>
  );
}
