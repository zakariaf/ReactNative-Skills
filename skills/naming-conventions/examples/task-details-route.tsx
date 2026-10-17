// src/app/tasks/[taskId].tsx
// Naming shape of an Expo Router route file: the file name is the URL segment ([taskId] is a
// camelCase param, because it becomes the key of the params object), the default export is a named
// function <Name>Route, and the screen it renders keeps <Name>Screen in src/features/.
import { useLocalSearchParams } from 'expo-router';

import { TaskDetailsScreen } from '@/features/tasks/task-details-screen';
import { useTaskDetailsModel } from '@/features/tasks/use-task-details-model';

export default function TaskDetailsRoute(): React.JSX.Element {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const model = useTaskDetailsModel(taskId);
  return <TaskDetailsScreen task={model.task} onComplete={model.completeTask} />;
}
