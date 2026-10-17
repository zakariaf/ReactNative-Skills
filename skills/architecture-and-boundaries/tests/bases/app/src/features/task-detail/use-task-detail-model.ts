import { useServices } from '@/services/services-context';

export function useTaskDetailModel(taskId: string): { readonly title: string } {
  const { errorLog } = useServices();
  if (taskId === '') errorLog.record('service', 'empty task id');
  return { title: taskId };
}
