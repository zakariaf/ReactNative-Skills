// src/api/tasks/task-schemas.ts
// What the Tasks API sends and accepts, as valibot schemas: one definition gives the TypeScript type
// and the runtime check. Response schemas use v.object (unknown keys are dropped), never
// v.strictObject: a server that adds a field must not break every installed copy of the app. A closed
// set the server may grow (a status) gets a v.fallback, for the same reason.
import * as v from 'valibot';

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;

/** One task as the API returns it. */
export const taskSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  title: v.string(),
  isDone: v.boolean(),
  // A value this app version does not know yet reads as 'normal' instead of failing the list.
  priority: v.fallback(v.picklist(TASK_PRIORITIES), 'normal'),
  /** ISO 8601 instant; formatting happens at the edge (src/i18n). */
  updatedAt: v.pipe(v.string(), v.isoTimestamp()),
});

/** GET /tasks answers { items: [...] }; the query keeps the array. */
export const taskListSchema = v.pipe(
  v.object({ items: v.array(taskSchema) }),
  v.transform((page) => page.items),
);

export type ApiTask = v.InferOutput<typeof taskSchema>;
export type TaskList = v.InferOutput<typeof taskListSchema>;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** The body of POST /tasks. `requestId` doubles as the Idempotency-Key, so a retried create applies once. */
export type NewTaskRequest = {
  readonly requestId: string;
  readonly title: string;
};
