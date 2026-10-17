import type { Task } from '@/core/tasks/task';

export function makeTask(overrides: Partial<Task> = {}): Task {
  return { id: 't1', title: 'Buy milk', done: false, ...overrides };
}
