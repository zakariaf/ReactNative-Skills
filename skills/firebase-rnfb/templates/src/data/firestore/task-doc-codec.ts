// src/data/firestore/task-doc-codec.ts
// What a task document holds, checked on every read. v.object (not strictObject) on purpose: a newer
// app version may add fields, and an older one must still read the document (it also never replaces
// one: every write merges, so the fields it does not know survive).
import * as v from 'valibot';

import type { Task } from '@/data/tasks/task-store-port';

const TIMESTAMP = v.object({ seconds: v.number(), nanoseconds: v.number() });

export const TASK_DOC = v.object({
  listId: v.pipe(v.string(), v.minLength(1)),
  title: v.string(),
  isDone: v.boolean(),
  updatedAt: v.nullable(TIMESTAMP),
});

export const TASK_DRAFT = v.object({
  listId: v.pipe(v.string(), v.minLength(1)),
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500)),
});

/** One document as a Task, or null when it does not parse (the caller skips it and logs nothing private). */
export function decodeTask(id: string, data: unknown): Task | null {
  const parsed = v.safeParse(TASK_DOC, data);
  if (!parsed.success) {
    return null;
  }
  const { listId, title, isDone, updatedAt } = parsed.output;
  const updatedAtMs =
    updatedAt === null ? null : updatedAt.seconds * 1000 + Math.floor(updatedAt.nanoseconds / 1e6);
  return { id, listId, title, isDone, updatedAtMs };
}
