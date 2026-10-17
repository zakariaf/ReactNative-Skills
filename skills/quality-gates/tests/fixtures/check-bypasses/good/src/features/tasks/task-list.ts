// src/features/tasks/task-list.ts
// A comment may say that eslint-disable comments are inert here, or mention --no-verify, freely.
import { sortTasks as vendorSort } from './vendor-sort';

export type Task = { readonly id: string; readonly title: string; readonly done: boolean };

// @ts-expect-error the vendor typings miss the readonly overload of sortTasks
export const sortTasks = (tasks: readonly Task[]): readonly Task[] => vendorSort(tasks);
