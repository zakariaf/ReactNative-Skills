// src/app/(app)/tasks/index.tsx: the list route; on a wide window it also shows the selected task.
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTasksModel } from '@/features/tasks/use-tasks-model';

const SAMPLE = [{ id: 't1', title: 'Water the plants', isDone: false }];

export default function TasksRoute(): React.JSX.Element {
  const model = useTasksModel(SAMPLE, 'list');
  return <TasksScreen model={model} />;
}
