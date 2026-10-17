// src/features/tasks/tasks-screen.tsx: a pure view of the model; lists that grow are a FlatList.
import { FlatList } from 'react-native';

import { ScreenFrame, BELOW_HEADER_EDGES } from '@/ui/screen-frame';

import { HideForPremium } from './components/hide-for-premium';
import { TaskRow } from './components/task-row';
import { TasksFooter } from './components/tasks-footer';

import type { TasksModel } from './use-tasks-model';
import type { ReactNode } from 'react';

export type TasksScreenProps = { readonly model: TasksModel };

export function TasksScreen({ model }: TasksScreenProps): ReactNode {
  return (
    <ScreenFrame testID="tasks.screen" edges={BELOW_HEADER_EDGES}>
      <FlatList
        testID="tasks.list"
        data={model.tasks}
        keyExtractor={(task) => task.id}
        renderItem={({ item }) => <TaskRow task={item} onToggle={model.onToggle} />}
      />
      <HideForPremium>
        <TasksFooter />
      </HideForPremium>
    </ScreenFrame>
  );
}
