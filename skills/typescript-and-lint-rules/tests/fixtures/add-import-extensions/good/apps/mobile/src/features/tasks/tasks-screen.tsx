// apps/mobile/src/features/tasks/tasks-screen.tsx
import type { ReactElement } from 'react';

import { AppText } from '@/ui/app-text';

import { useTasksModel } from './use-tasks-model';

/** The tasks screen. */
export function TasksScreen(): ReactElement {
  const model = useTasksModel(' Buy milk ');
  return <AppText>{model.title}</AppText>;
}
