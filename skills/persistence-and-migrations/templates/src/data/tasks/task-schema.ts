// src/data/tasks/task-schema.ts: row and input schemas of the Tasks tables (valibot: one schema gives the type and the check).
import * as v from 'valibot';

const ROW_ID = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const EPOCH_MS = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
/** SQLite has no boolean: 0 or 1, and a CHECK constraint says so. */
const FLAG = v.picklist([0, 1]);

/** What `SELECT id, name, created_at_ms FROM lists` returns. */
export const LIST_ROW = v.strictObject({ id: ROW_ID, name: v.string(), created_at_ms: EPOCH_MS });

/** What `SELECT id, list_id, title, is_done, created_at_ms FROM tasks` returns. */
export const TASK_ROW = v.strictObject({
  id: ROW_ID,
  list_id: ROW_ID,
  title: v.string(),
  is_done: FLAG,
  created_at_ms: EPOCH_MS,
});

/** Inputs are trimmed and bounded here, inside the limits the tables' CHECK constraints enforce. */
export const NEW_LIST = v.strictObject({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
});
export const NEW_TASK = v.strictObject({
  listId: ROW_ID,
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
});
export const TASK_DONE = v.strictObject({ taskId: ROW_ID, isDone: v.boolean() });
export const LIST_ID = ROW_ID;

export type ListRow = v.InferOutput<typeof LIST_ROW>;
export type TaskRow = v.InferOutput<typeof TASK_ROW>;
export type NewList = v.InferInput<typeof NEW_LIST>;
export type NewTask = v.InferInput<typeof NEW_TASK>;
