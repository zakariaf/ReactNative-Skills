// src/features/task-editor/use-task-editor-model.ts
// The New task form's model (forms-and-input): react-hook-form holds the draft, the valibot
// schema validates it (on the first blur, then on every change), each field is bound with
// useTextField, and submit is one void intent. A refused submit focuses the first invalid field
// (shouldFocusError) and is announced; a failed save keeps everything typed and says why; only a
// saved draft clears the form, and only after handleSubmit has settled: handleSubmit marks the
// form submitted after the save returns, so a reset inside the save would leave the next draft
// "submitted" and validating from its first keystroke. The save is async (a repository or an API
// mutation); a second submit while it runs is ignored. Submit state comes from useFormState, never
// from watch().
import { valibotResolver } from '@hookform/resolvers/valibot';
import { useRef, useState } from 'react';
import { useForm, useFormState } from 'react-hook-form';

import { useDoneBarSpace } from '@/hooks/use-done-bar-space';
import { useTextField } from '@/hooks/use-text-field';
import { useT } from '@/i18n/t-context';
import { useServices } from '@/services/services-context';
import { useAnnounce } from '@/ui/a11y/use-announce';
import { useReduceMotion } from '@/ui/a11y/use-reduce-motion';

import {
  EMPTY_TASK_EDITOR,
  TASK_NOTES_MAX,
  TASK_TITLE_MAX,
  taskEditorSchema,
} from './task-editor-schema';

import type { TaskDraft, TaskEditorInput } from './task-editor-schema';
import type { Result } from '@/core/result';
import type { DoneBarSpace } from '@/hooks/use-done-bar-space';
import type { TextFieldBinding } from '@/hooks/use-text-field';
import type { UseFormReturn } from 'react-hook-form';

/** Stores a valid draft; a failure is a value (error-handling-typed-results), never a rejection. */
export type SaveTask = (draft: TaskDraft) => Promise<Result<void, { readonly kind: string }>>;

export type TaskEditorDeps = {
  /** Titles of the list's open tasks: a new task may not repeat one. */
  readonly openTitles: readonly string[];
  readonly save: SaveTask;
  /** After a successful save (close the sheet, go back). */
  readonly onSaved: () => void;
};

export type LabelledField = TextFieldBinding & {
  readonly label: string;
  readonly maxLength?: number;
};

/** What the New task screen renders and calls. */
export type TaskEditorModel = {
  readonly title: LabelledField;
  readonly notes: LabelledField;
  readonly estimate: LabelledField;
  readonly submitLabel: string;
  readonly doneLabel: string;
  /** Translated save failure; the draft stays in the fields. */
  readonly failure: string | null;
  readonly isSubmitting: boolean;
  readonly isReducedMotion: boolean;
  /** The room the scroll view keeps for the Done bar above the keyboard. */
  readonly keyboardSpace: DoneBarSpace;
  readonly onSubmit: () => void;
};

type TaskEditorForm = UseFormReturn<TaskEditorInput, unknown, TaskDraft>;

/** The app's save for a valid draft: a failure is shown and announced, and the draft stays. */
function useDraftSave(deps: TaskEditorDeps): {
  readonly failure: string | null;
  readonly save: (draft: TaskDraft) => Promise<boolean>;
} {
  const t = useT();
  const announce = useAnnounce();
  const [failure, setFailure] = useState<string | null>(null);
  /** Saves a valid draft; true only when the save returned ok. */
  const save = async (draft: TaskDraft): Promise<boolean> => {
    const result = await deps.save(draft);
    if (!result.ok) {
      setFailure(t('task-editor.save.failed'));
      announce(t('task-editor.save.failed'));
      return false;
    }
    setFailure(null);
    return true;
  };
  return { failure, save };
}

/** Submit: validate, save, and keep the draft unless the save worked. */
function useTaskEditorSubmit(
  form: TaskEditorForm,
  deps: TaskEditorDeps,
): { readonly failure: string | null; readonly onSubmit: () => void } {
  const t = useT();
  const announce = useAnnounce();
  const { errorLog } = useServices();
  const { failure, save } = useDraftSave(deps);
  const isSaving = useRef(false);
  const onSubmit = (): void => {
    // The button's isBusy hides a second press on screen; this guard holds before that re-render
    // too (a double tap, the keyboard's Done right after a tap), so one draft is saved once.
    if (isSaving.current) return;
    isSaving.current = true;
    let isSaved = false;
    // handleSubmit returns a promise and rethrows what save throws: never pass it to onPress.
    form
      .handleSubmit(
        async (draft) => {
          isSaved = await save(draft);
        },
        () => {
          announce(t('forms.submit.fix-fields'));
        },
      )()
      .then(() => {
        if (!isSaved) return;
        // After handleSubmit settled: the reset also clears isSubmitted and submitCount.
        form.reset(EMPTY_TASK_EDITOR);
        deps.onSaved();
      })
      .catch((error: unknown) => {
        errorLog.record('service', error);
      })
      .finally(() => {
        isSaving.current = false;
      });
  };
  return { failure, onSubmit };
}

export function useTaskEditorModel(deps: TaskEditorDeps): TaskEditorModel {
  const t = useT();
  const form = useForm<TaskEditorInput, unknown, TaskDraft>({
    resolver: valibotResolver(taskEditorSchema(deps.openTitles)),
    mode: 'onTouched',
    defaultValues: EMPTY_TASK_EDITOR,
  });
  const { isSubmitting } = useFormState({ control: form.control });
  const { failure, onSubmit } = useTaskEditorSubmit(form, deps);
  const title = useTextField(form, 'title', { kind: 'sentence', next: 'notes' });
  const notes = useTextField(form, 'notes', { kind: 'multiline' });
  const estimate = useTextField(form, 'estimateMinutes', { kind: 'integer', onSubmit });
  return {
    title: { ...title, label: t('task-editor.title.label'), maxLength: TASK_TITLE_MAX },
    notes: { ...notes, label: t('task-editor.notes.label'), maxLength: TASK_NOTES_MAX },
    estimate: { ...estimate, label: t('task-editor.estimate.label') },
    submitLabel: t('task-editor.submit'),
    doneLabel: t('forms.keyboard.done'),
    failure,
    isSubmitting,
    isReducedMotion: useReduceMotion(),
    keyboardSpace: useDoneBarSpace(),
    onSubmit,
  };
}
