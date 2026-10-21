// packages/shared/src/core/task-title.ts
import type { Result } from './result';

/** A trimmed task title, or the failure kind for an empty one. */
export function taskTitle(raw: string): Result<string, 'empty'> {
  const title = raw.trim();
  return title === '' ? { ok: false, failure: 'empty' } : { ok: true, value: title };
}
