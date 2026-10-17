import { AppText } from '@/ui/app-text';

import { useTaskDetailModel } from './use-task-detail-model';

export function TaskDetailScreen({ taskId }: { readonly taskId: string }) {
  const { title } = useTaskDetailModel(taskId);
  return <AppText>{title}</AppText>;
}
