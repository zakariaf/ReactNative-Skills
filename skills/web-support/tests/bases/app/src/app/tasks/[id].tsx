// src/app/tasks/[id].tsx
export { TaskScreen as default } from '@/features/tasks/task-screen';

export function generateStaticParams(): Record<string, string>[] {
  return [{ id: 'task-1' }, { id: 'task-2' }];
}
