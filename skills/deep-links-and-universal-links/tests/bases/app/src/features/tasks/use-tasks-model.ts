// src/features/tasks/use-tasks-model.ts
// The first screen behind the signed-in gate opens a list link that waited for it.
import { useOpenPendingLink } from '@/hooks/use-open-pending-link';

export function useTasksModel(): void {
  useOpenPendingLink('signed-in');
}
