// src/features/tasks/tasks-screen.tsx: the Tasks list and the selected task, side by side when two panes fit.
import { FlatList } from 'react-native';

import { ListDetailLayout } from '@/ui/adaptive/list-detail-layout';

import { TaskDetail } from './components/task-detail';
import { TaskRow } from './components/task-row';

import type { TasksModel } from './use-tasks-model';

export function TasksScreen({ model }: { readonly model: TasksModel }): React.JSX.Element {
  return (
    <ListDetailLayout
      testID="tasks.panes"
      panes={model.panes}
      onePane={model.onePane}
      list={
        <FlatList
          testID="tasks.list"
          data={model.tasks}
          keyExtractor={(task) => task.id}
          renderItem={({ item }) => <TaskRow task={item} onSelect={model.onSelect} />}
        />
      }
      detail={model.selected ? <TaskDetail task={model.selected} /> : null}
      emptyDetail={<TaskDetail task={null} />}
    />
  );
}
