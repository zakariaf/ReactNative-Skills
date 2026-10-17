import { spacing } from '@/theme/tokens';

import { AppText } from './app-text';

import type { Task } from '@/core/tasks/task';

export function TaskRow({ task }: { readonly task: Task }) {
  return <AppText testID={`tasks.row-${String(spacing.row)}`}>{task.title}</AppText>;
}
