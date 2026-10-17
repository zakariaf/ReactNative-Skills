// src/app/(app)/index.tsx: a thin route, the model hook and the pure view.
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTasksModel } from '@/features/tasks/use-tasks-model';

export default function TasksRoute(): React.JSX.Element {
  const model = useTasksModel();
  return <TasksScreen model={model} />;
}
