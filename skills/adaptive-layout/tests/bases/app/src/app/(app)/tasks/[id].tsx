// src/app/(app)/tasks/[id].tsx: the detail route; on a wide window it shows the list beside it.
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTasksModel } from '@/features/tasks/use-tasks-model';

const SAMPLE = [{ id: 't1', title: 'Water the plants', isDone: false }];

export default function TaskRoute(): React.JSX.Element {
  const model = useTasksModel(SAMPLE, 'detail');
  return <TasksScreen model={model} />;
}
