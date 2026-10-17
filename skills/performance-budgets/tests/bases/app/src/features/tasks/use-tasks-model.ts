// src/features/tasks/use-tasks-model.ts
import { useColdStartMark } from '@/hooks/use-cold-start-mark';
import { useServices } from '@/services/services-context';
import { TEST_ONLY } from '@/test-only';

export function useTasksModel(): { readonly titles: readonly string[] } {
  const services = useServices();
  const perfLog = TEST_ONLY?.perf.perfLog ?? null;
  // The titles are in memory before this screen mounts, so the screen is ready on its first render.
  useColdStartMark({ perf: services.perf, perfLog, label: 'tasks', isReady: true });
  return { titles: ['Water the plants', 'Call the bank'] };
}
