// src/features/task-editor/apply-task-rejection.ts (shape: a server refusal mapped to a field)
// networking-and-server-state's ApiClient answers a refused write as a `rejected` failure with the
// server's `code`. Known codes land on the field they name with a catalog key (never the server's
// text); an unknown code is the form-level failure. The table is typed, so a new code without a key
// is a compile error, and check-forms' error-message-key trusts a typed value.
import * as v from 'valibot';

import type { TaskEditorInput } from './task-editor-schema';
import type { MessageKey } from '@/i18n/messages';
import type { UseFormSetError } from 'react-hook-form';

const TASK_REJECT_CODES = ['title-too-long', 'title-taken', 'estimate-out-of-range'] as const;
const TASK_REJECT_CODE = v.picklist(TASK_REJECT_CODES);
type TaskRejectCode = (typeof TASK_REJECT_CODES)[number];

const FIELD_OF: Readonly<Record<TaskRejectCode, { readonly field: keyof TaskEditorInput; readonly key: MessageKey }>> = {
  'title-too-long': { field: 'title', key: 'task-editor.title.too-long' },
  'title-taken': { field: 'title', key: 'task-editor.title.duplicate' },
  'estimate-out-of-range': { field: 'estimateMinutes', key: 'task-editor.estimate.out-of-range' },
};

/** True when the code was put on a field; false means: show the form-level failure. */
export function applyTaskRejection(code: string, setError: UseFormSetError<TaskEditorInput>): boolean {
  const parsed = v.safeParse(TASK_REJECT_CODE, code);
  if (!parsed.success) return false;
  const { field, key } = FIELD_OF[parsed.output];
  setError(field, { type: 'server', message: key }, { shouldFocus: true });
  return true;
}
