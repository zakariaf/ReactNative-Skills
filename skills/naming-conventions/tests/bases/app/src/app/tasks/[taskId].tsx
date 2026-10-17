// src/app/tasks/[taskId].tsx: one task. The param name is camelCase: it is the key of the params object.
import { useLocalSearchParams } from 'expo-router';

import { TaskDetailsScreen } from '@/features/tasks/task-details-screen';

export default function TaskDetailsRoute(): React.JSX.Element {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  return <TaskDetailsScreen taskId={taskId} />;
}
