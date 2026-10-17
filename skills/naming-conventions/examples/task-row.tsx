// src/features/tasks/components/task-row.tsx
// Naming shape: the component is named after its file, its props type is <Component>Props, a boolean
// prop reads as a question, the callback prop is onX, the local handler is handleX, and the testID
// is <screen>.<element>.<stable key> with the element ending in its role (-row). Raw Pressable lives
// only in src/ui, so the row is built on the ListRow primitive.
import { ListRow } from '@/ui/list-row';

import type { Task } from '@/features/tasks/task-list';

export type TaskRowProps = {
  readonly task: Task;
  readonly isSelected: boolean;
  readonly onToggle: (taskId: string) => void;
};

/** One task in the list. Text arrives translated from the screen. */
export function TaskRow({ task, isSelected, onToggle }: TaskRowProps): React.JSX.Element {
  const handlePress = (): void => {
    onToggle(task.id);
  };
  return (
    <ListRow
      title={task.title}
      isChecked={task.isDone}
      isSelected={isSelected}
      testID={`tasks.task-row.${task.id}`}
      onPress={handlePress}
    />
  );
}
