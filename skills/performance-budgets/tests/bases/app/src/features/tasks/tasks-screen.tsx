// src/features/tasks/tasks-screen.tsx
import { FlatList, View } from 'react-native';

import { TaskRow } from './components/task-row';

import type { JSX } from 'react';

export function TasksScreen({ titles }: { readonly titles: readonly string[] }): JSX.Element {
  return (
    <View>
      <FlatList data={titles} keyExtractor={(title) => title} renderItem={({ item }) => <TaskRow title={item} />} />
    </View>
  );
}
