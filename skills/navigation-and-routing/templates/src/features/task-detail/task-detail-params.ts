// src/features/task-detail/task-detail-params.ts
// The params of the task detail route (src/app/(app)/tasks/[taskId].tsx), parsed from the URL.
// Every Expo Router route is a URL: a deep link, a notification or a mistyped shared link can open
// it with any text, a repeated query key arrives as an array, and the type argument of
// useLocalSearchParams<...>() is a cast, not a check. So the model parses the raw params here and
// shows the not-found state for a failure instead of trusting them.
import * as v from 'valibot';

import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';

/** Task ids are short kebab-case slugs ('task-12'); anything else never names a task. */
const TASK_DETAIL_PARAMS = v.object({
  taskId: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{0,63}$/u)),
});

export type TaskDetailParams = { readonly taskId: string };

export type TaskDetailParamsFailure = { readonly kind: 'invalid-route-params' };

/** What useLocalSearchParams() hands back: strings, arrays for repeated keys, or nothing. */
export type RawRouteParams = Readonly<Record<string, string | readonly string[] | undefined>>;

/** The task id from the route params, or a failure the screen shows as "task not found". */
export function parseTaskDetailParams(
  raw: RawRouteParams,
): Result<TaskDetailParams, TaskDetailParamsFailure> {
  const parsed = v.safeParse(TASK_DETAIL_PARAMS, raw);
  if (!parsed.success) return err({ kind: 'invalid-route-params' });
  return ok({ taskId: parsed.output.taskId });
}
