// src/features/new-list/use-new-list-model.ts (shape: an async availability check on one field)
// The list name must be free on the server. The schema checks the shape (required, length); the
// server question runs in useAsyncFieldCheck: debounced, newest value wins, a deadline, cancelled
// on unmount. Submit needs a pass for exactly the name being sent, and the server still answers
// `rejected` with a code if someone took the name in between (examples/server-field-errors.ts).
import { valibotResolver } from '@hookform/resolvers/valibot';
import * as v from 'valibot';
import { useForm, useFormState } from 'react-hook-form';

import { useAsyncFieldCheck } from '@/hooks/use-async-field-check';
import { useTextField } from '@/hooks/use-text-field';
import { useT } from '@/i18n/t-context';
import { useServices } from '@/services/services-context';
import { useAnnounce } from '@/ui/a11y/use-announce';

import type { Result } from '@/core/result';
import type { FieldCheck } from '@/hooks/use-async-field-check';
import type { TextFieldBinding } from '@/hooks/use-text-field';

export const LIST_NAME_MAX = 60;

/** The field's own shape, reused to decide whether a value is worth asking about. */
const LIST_NAME_SHAPE = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty('new-list.name.required'),
  v.maxLength(LIST_NAME_MAX, 'new-list.name.too-long'),
);

const NEW_LIST_SCHEMA = v.object({ name: LIST_NAME_SHAPE });
type NewListInput = v.InferInput<typeof NEW_LIST_SCHEMA>;
type NewListDraft = v.InferOutput<typeof NEW_LIST_SCHEMA>;

export type NewListModel = {
  readonly name: TextFieldBinding & { readonly label: string; readonly status: string | null };
  readonly onSubmit: () => void;
  readonly isSubmitting: boolean;
};

export function useNewListModel(deps: {
  readonly isNameFree: FieldCheck; // a port: lists API, honours the signal, never rejects
  readonly create: (draft: NewListDraft) => Promise<Result<void, { readonly kind: string }>>;
}): NewListModel {
  const t = useT();
  const announce = useAnnounce();
  const { errorLog } = useServices();
  const form = useForm<NewListInput, unknown, NewListDraft>({
    resolver: valibotResolver(NEW_LIST_SCHEMA),
    mode: 'onTouched',
    defaultValues: { name: '' },
  });
  const { isSubmitting } = useFormState({ control: form.control });
  const nameCheck = useAsyncFieldCheck(deps.isNameFree);

  /** Saves a checked draft; true only when the list was created. Never resets the form itself. */
  const save = async (draft: NewListDraft): Promise<boolean> => {
    if (!nameCheck.hasPassed(draft.name)) {
      const { state: check } = nameCheck;
      if (check.status === 'checking') {
        // Still running: not an error. The field's status line already says "Checking…" (a live
        // region); say why nothing was saved and leave no error behind once the answer lands.
        announce(t('forms.check.pending'));
        form.setFocus('name');
        return false;
      }
      const key = check.status === 'refused' ? check.messageKey : 'forms.check.unavailable';
      form.setError('name', { type: 'availability', message: key }, { shouldFocus: true });
      return false;
    }
    const result = await deps.create(draft);
    if (!result.ok) {
      // The input stays; a `rejected` code goes to the field (examples/server-field-errors.ts).
      announce(t('new-list.save.failed'));
      return false;
    }
    return true;
  };
  const onSubmit = (): void => {
    let isSaved = false;
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
        // Only after handleSubmit settled: it marks the form submitted after onValid returns, so a
        // reset inside save would leave the next name validating from its first keystroke (rule 13).
        form.reset({ name: '' });
        // The check answered for the old name; the empty field starts idle again.
        nameCheck.onValueChange('', false);
      })
      .catch((error: unknown) => {
        errorLog.record('service', error);
      });
  };

  const binding = useTextField(form, 'name', { kind: 'sentence', onSubmit });
  const onChangeText = (text: string): void => {
    binding.onChangeText(text);
    // The check answers for the trimmed name, the same value the schema hands to save.
    const trimmed = text.trim();
    nameCheck.onValueChange(trimmed, v.is(LIST_NAME_SHAPE, trimmed));
  };
  const { state } = nameCheck;
  const checkError =
    state.status === 'refused' ? t(state.messageKey) : state.status === 'unavailable' ? t('forms.check.unavailable') : null;
  return {
    name: {
      ...binding,
      onChangeText,
      label: t('new-list.name.label'),
      maxLength: LIST_NAME_MAX,
      error: binding.error ?? checkError,
      status: state.status === 'checking' ? t('forms.check.checking') : null,
    },
    onSubmit,
    isSubmitting,
  };
}
