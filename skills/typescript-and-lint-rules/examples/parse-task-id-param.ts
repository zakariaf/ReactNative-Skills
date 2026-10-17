// src/features/tasks/parse-task-id-param.ts
// Example (a shape to imitate): outside input parsed into a Result instead of a throw. A route
// parameter can be missing, repeated (?taskId=a&taskId=b) or malformed; each is an expected failure
// the caller handles (the screen shows its not-found state), never an exception.
import { err, ok } from '@/core/result';

import type { Result } from '@/core/result';

export type TaskIdParamError =
  | { readonly kind: 'missing' }
  | { readonly kind: 'repeated'; readonly count: number }
  | { readonly kind: 'malformed'; readonly raw: string };

const TASK_ID = /^task-\d{1,9}$/;

/** Reads the [taskId] route parameter as useLocalSearchParams returns it; never throws. */
export function parseTaskIdParam(
  raw: string | readonly string[] | undefined,
): Result<string, TaskIdParamError> {
  if (raw === undefined || raw === '') return err({ kind: 'missing' });
  if (typeof raw !== 'string') return err({ kind: 'repeated', count: raw.length });
  if (!TASK_ID.test(raw)) return err({ kind: 'malformed', raw });
  return ok(raw);
}
