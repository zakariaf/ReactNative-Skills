// src/features/tasks/task-details-screen.tsx
import { AppText } from '@/ui/app-text';

export type TaskDetailsScreenProps = { readonly taskId: string };

export function TaskDetailsScreen({ taskId }: TaskDetailsScreenProps): React.JSX.Element {
  return <AppText testID="task-details.title">{taskId}</AppText>;
}
