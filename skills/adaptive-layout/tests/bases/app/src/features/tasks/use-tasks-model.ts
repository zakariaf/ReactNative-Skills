// src/features/tasks/use-tasks-model.ts: the only code that reads the route and decides push or select.
import { router, useLocalSearchParams } from 'expo-router';

import { useListDetailLayout } from '@/ui/adaptive/use-list-detail-layout';

import type { Task } from './task-list';
import type { ListDetailPanes } from '@/ui/adaptive/use-list-detail-layout';

export type TasksModel = {
  readonly tasks: readonly Task[];
  readonly selected: Task | null;
  readonly panes: ListDetailPanes;
  readonly onePane: 'list' | 'detail';
  readonly onSelect: (id: string) => void;
};

export function useTasksModel(tasks: readonly Task[], onePane: 'list' | 'detail'): TasksModel {
  const params = useLocalSearchParams<{ selected?: string; id?: string }>();
  const panes = useListDetailLayout();
  const selectedId = (onePane === 'detail' ? params.id : params.selected) ?? null;
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  function handleSelect(id: string): void {
    if (panes.layout.kind === 'one-pane') router.push(`/tasks/${id}`);
    else if (onePane === 'detail') router.setParams({ id });
    else router.setParams({ selected: id });
  }
  return { tasks, selected, panes, onePane, onSelect: handleSelect };
}
