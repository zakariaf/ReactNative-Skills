// src/app/(app)/index.tsx
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTasksModel } from '@/features/tasks/use-tasks-model';

export default function TasksRoute(): React.JSX.Element {
  const model = useTasksModel();
  return <TasksScreen onOpenTask={model.onOpenTask} />;
}
