// src/app/tasks/[taskId].tsx: thin route; the screen and the parsing live in src/features/.
import { useLocalSearchParams } from 'expo-router';

import { TaskDetailScreen } from '@/features/tasks/task-detail-screen';
import { parseTaskIdParam } from '@/features/tasks/parse-task-id-param';

export default function TaskRoute(): React.JSX.Element {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  return <TaskDetailScreen taskId={parseTaskIdParam(taskId)} />;
}
