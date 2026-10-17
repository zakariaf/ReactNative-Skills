// src/app/(tabs)/index.tsx: the Tasks tab. Route files stay thin.
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTasksModel } from '@/features/tasks/use-tasks-model';

export default function TasksRoute(): React.JSX.Element {
  const model = useTasksModel();
  return <TasksScreen tasks={model.tasks} onAddTask={model.addTask} onToggleTask={model.toggleTask} />;
}
