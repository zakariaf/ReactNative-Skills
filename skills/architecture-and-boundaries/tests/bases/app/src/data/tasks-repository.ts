import type { SqlDriver } from './sql-driver';
import type { Task } from '@/core/tasks/task';

export function saveTask(driver: SqlDriver, task: Task): void {
  driver.run('INSERT INTO tasks (id, title, done) VALUES (?, ?, ?)', [task.id, task.title, task.done ? 1 : 0]);
}
