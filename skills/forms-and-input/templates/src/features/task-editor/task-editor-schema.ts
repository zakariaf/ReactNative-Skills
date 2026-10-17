// src/features/task-editor/task-editor-schema.ts
// The New task form's one schema (forms-and-input): it gives the form's input and output types
// and the runtime check, and every action carries a catalog key as its message, so an error
// reaches the screen translated, never as valibot's English default. Bounds match the data
// layer's NEW_TASK (title 1-200 after trim). The duplicate check is local and synchronous, so
// it lives here, fed by a factory with the open titles; a server check would be an async field
// check in the model instead (use-async-field-check.ts). No grapheme or word counts: valibot
// counts them with Intl.Segmenter, which Hermes lacks (it throws on the phone, passes in Jest).
import * as v from 'valibot';

import { toLatinDigits } from '@/core/text/latin-digits';

export const TASK_TITLE_MAX = 200;
export const TASK_NOTES_MAX = 2000;
export const ESTIMATE_MAX_MINUTES = 600;

const WHOLE_NUMBER = /^\d+$/;

/** Case- and space-insensitive form of a title, for the duplicate check. */
export function titleKeyOf(title: string): string {
  return title.trim().replaceAll(/\s+/g, ' ').toLocaleLowerCase();
}

function buildTaskEditorSchema(openTitles: readonly string[]) {
  const taken = new Set(openTitles.map(titleKeyOf));
  return v.object({
    title: v.pipe(
      v.string(),
      v.trim(),
      v.nonEmpty('task-editor.title.required'),
      v.maxLength(TASK_TITLE_MAX, 'task-editor.title.too-long'),
      v.check((title) => !taken.has(titleKeyOf(title)), 'task-editor.title.duplicate'),
    ),
    notes: v.pipe(v.string(), v.trim(), v.maxLength(TASK_NOTES_MAX, 'task-editor.notes.too-long')),
    // A TextInput holds text: digits in any script become ASCII first, then a number or null.
    estimateMinutes: v.pipe(
      v.string(),
      v.transform(toLatinDigits),
      v.trim(),
      v.check(
        (text) => text === '' || WHOLE_NUMBER.test(text),
        'task-editor.estimate.not-a-number',
      ),
      v.transform((text) => (text === '' ? null : Number(text))),
      v.check(
        (minutes) => minutes === null || (minutes >= 1 && minutes <= ESTIMATE_MAX_MINUTES),
        'task-editor.estimate.out-of-range',
      ),
    ),
  });
}

export type TaskEditorSchema = ReturnType<typeof buildTaskEditorSchema>;
/** What the fields hold: text, as typed. */
export type TaskEditorInput = v.InferInput<TaskEditorSchema>;
/** What a valid submit hands on: trimmed text and a number or null. */
export type TaskDraft = v.InferOutput<TaskEditorSchema>;

/** The schema for a list whose open tasks already carry these titles. */
export function taskEditorSchema(openTitles: readonly string[]): TaskEditorSchema {
  return buildTaskEditorSchema(openTitles);
}

export const EMPTY_TASK_EDITOR: TaskEditorInput = { title: '', notes: '', estimateMinutes: '' };
