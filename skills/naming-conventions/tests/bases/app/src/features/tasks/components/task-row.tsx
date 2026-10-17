// src/features/tasks/components/task-row.tsx: one task in the list.
import { ListRow } from '@/ui/list-row';

import type { Task } from '@/features/tasks/task-list';

export type TaskRowProps = {
  readonly task: Task;
  readonly onToggle: (taskId: string) => void;
};

export function TaskRow({ task, onToggle }: TaskRowProps): React.JSX.Element {
  const handlePress = (): void => {
    onToggle(task.id);
  };
  return (
    <ListRow
      title={task.title}
      isChecked={task.isDone}
      testID={`tasks.task-row.${task.id}`}
      onPress={handlePress}
    />
  );
}
