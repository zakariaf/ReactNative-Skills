// src/features/tasks/components/task-detail.tsx
import { View } from 'react-native';

import type { Task } from '../task-list';

export function TaskDetail(props: { readonly task: Task | null }): React.JSX.Element {
  return <View testID={props.task ? `tasks.detail.${props.task.id}` : 'tasks.no-selection'} style={{ flex: 1 }} />;
}
