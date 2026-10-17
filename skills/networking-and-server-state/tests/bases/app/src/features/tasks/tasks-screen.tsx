// src/features/tasks/tasks-screen.tsx: the Tasks screen, a pure view of what the model returns.
import { FlatList } from 'react-native';

import { TaskRow } from './components/task-row';

import type { Task } from './task-list';
import type { JSX } from 'react';

export type TasksScreenProps = {
  readonly tasks: readonly Task[];
  readonly onToggle: (id: string) => void;
};

export function TasksScreen({ tasks, onToggle }: TasksScreenProps): JSX.Element {
  return (
    <FlatList
      data={tasks}
      keyExtractor={(task) => task.id}
      renderItem={({ item }) => <TaskRow task={item} onToggle={onToggle} />}
    />
  );
}
