// src/features/tasks/components/task-row.tsx
import { View } from 'react-native';

import type { Task } from '../task-list';

export function TaskRow(props: { readonly task: Task; readonly onSelect: (id: string) => void }): React.JSX.Element {
  return <View testID={`tasks.task-row.${props.task.id}`} style={{ minHeight: 44, width: '100%' }} />;
}
