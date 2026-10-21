// apps/mobile/src/features/tasks/use-tasks-model.ts
import { taskTitle } from '@acme/shared/core/task-title';

import { DEFAULT_LOCALE } from '@/i18n';

/** The tasks screen's model. */
export function useTasksModel(raw: string): { readonly title: string; readonly locale: string } {
  const result = taskTitle(raw);
  return { title: result.ok ? result.value : '', locale: DEFAULT_LOCALE };
}
