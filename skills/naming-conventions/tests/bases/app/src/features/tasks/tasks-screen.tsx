// src/features/tasks/tasks-screen.tsx: the Tasks screen, a pure view of its props.
import { FlatList } from 'react-native';

import { useT } from '@/i18n/use-t';
import { AppButton } from '@/ui/app-button';
import { AppText } from '@/ui/app-text';

import { TaskRow } from './components/task-row';

import type { Task } from './task-list';

export type TasksScreenProps = {
  readonly tasks: readonly Task[];
  readonly onAddTask: () => void;
  readonly onToggleTask: (taskId: string) => void;
};

export function TasksScreen({ tasks, onAddTask, onToggleTask }: TasksScreenProps): React.JSX.Element {
  const t = useT();
  return (
    <>
      <AppText testID="tasks.title">{t('tasks.title')}</AppText>
      <AppButton label={t('tasks.add-button.label')} testID="tasks.add-button" onPress={onAddTask} />
      <FlatList
        testID="tasks.list"
        data={tasks}
        keyExtractor={(task) => task.id}
        renderItem={({ item }) => <TaskRow task={item} onToggle={onToggleTask} />}
      />
    </>
  );
}
