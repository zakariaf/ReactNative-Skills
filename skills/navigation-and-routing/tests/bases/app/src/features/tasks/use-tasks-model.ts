// src/features/tasks/use-tasks-model.ts
import { useRouter } from 'expo-router';

export function useTasksModel(): { readonly onOpenTask: (taskId: string) => void; readonly onDone: () => void } {
  const router = useRouter();
  return {
    onOpenTask: (taskId) => {
      router.push({ pathname: '/tasks/[taskId]', params: { taskId } });
    },
    onDone: () => {
      router.dismissTo('/');
    },
  };
}
