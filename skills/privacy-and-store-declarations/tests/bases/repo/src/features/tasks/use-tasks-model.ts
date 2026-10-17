// src/features/tasks/use-tasks-model.ts
import type { ApiClient } from '@/api/api-client';

export function useTasksModel(api: ApiClient): { readonly load: () => Promise<number> } {
  return { load: () => api.request('/tasks') };
}
