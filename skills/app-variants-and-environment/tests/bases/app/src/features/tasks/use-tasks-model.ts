// src/features/tasks/use-tasks-model.ts
import { currentAppVariant } from '@/config/current-app-variant';
import { readPublicEnvironment } from '@/config/environment';
import { TEST_ONLY } from '@/test-only';

export function useTasksModel(): { readonly badge: string | null; readonly apiUrl: string } {
  const variant = currentAppVariant();
  TEST_ONLY?.recordScreen('tasks');
  return { badge: variant === 'production' ? null : variant, apiUrl: readPublicEnvironment().apiUrl };
}
