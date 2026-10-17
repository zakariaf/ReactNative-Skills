import { AppText } from '@/ui/app-text';
import { TaskRow } from '@/ui/task-row';

import { useTasksModel } from './use-tasks-model';

export function TasksScreen() {
  const { tasks, today } = useTasksModel();
  return (
    <>
      <AppText>{today}</AppText>
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </>
  );
}
