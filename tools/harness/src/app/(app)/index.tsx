// src/app/(app)/index.tsx: the home route. Route files stay thin: they render a screen from src/features/.
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTasksModel } from '@/features/tasks/use-tasks-model';

export default function TasksRoute(): React.JSX.Element {
  const model = useTasksModel();
  return (
    <TasksScreen
      summary={model.summary}
      tasks={model.tasks}
      onToggle={model.onToggle}
      isReducedMotion={model.isReducedMotion}
    />
  );
}
