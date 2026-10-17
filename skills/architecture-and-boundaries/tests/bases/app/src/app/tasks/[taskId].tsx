import { useLocalSearchParams } from 'expo-router';

import { TaskDetailScreen } from '@/features/task-detail/task-detail-screen';

export default function TaskDetailRoute() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  return <TaskDetailScreen taskId={taskId} />;
}
