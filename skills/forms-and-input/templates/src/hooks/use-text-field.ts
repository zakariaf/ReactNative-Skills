// src/hooks/use-text-field.ts
// Binds one react-hook-form field to TextField's props the React Native way (forms-and-input):
// onChangeText (never onChange: react-hook-form reads event.target.value, which a React Native
// change event lacks, so the field would hold undefined), onBlur (the
// onTouched mode validates on the first blur), ref (setFocus and shouldFocusError need focus()),
// the translated error, and the focus chain: a single-line field names the field its return key
// moves to (`next`) or the submit it runs (`onSubmit`); a multiline field's return key makes a
// new line. The kind travels with the binding so the view cannot drop it.
import { useController } from 'react-hook-form';

import { useT } from '@/i18n/t-context';

import { fieldMessageKey } from './field-message-key';

import type { FieldKind } from '@/ui/form/field-kinds';
import type {
  Control,
  FieldPathByValue,
  FieldValues,
  RefCallBack,
  UseFormSetFocus,
} from 'react-hook-form';
import type { EnterKeyHintTypeOptions, SubmitBehavior } from 'react-native';

/** The two members of useForm()'s result a binding needs. */
export type FormFocus<TValues extends FieldValues, TOutput> = {
  readonly control: Control<TValues, unknown, TOutput>;
  readonly setFocus: UseFormSetFocus<TValues>;
};

export type TextFieldOptions<TValues extends FieldValues> = {
  readonly kind: FieldKind;
  /** The field the return key moves focus to. */
  readonly next?: FieldPathByValue<TValues, string>;
  /** What the return key of the last field runs (the form's submit intent). */
  readonly onSubmit?: () => void;
};

/** TextField's props except testID and label. */
export type TextFieldBinding = {
  readonly kind: FieldKind;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly onBlur: () => void;
  readonly ref: RefCallBack;
  /** Translated, or null. */
  readonly error: string | null;
  readonly enterKeyHint: EnterKeyHintTypeOptions;
  readonly submitBehavior: SubmitBehavior;
  readonly onSubmitEditing?: () => void;
};

type ChainProps = Pick<TextFieldBinding, 'enterKeyHint' | 'submitBehavior' | 'onSubmitEditing'>;

function chainProps<TValues extends FieldValues>(
  options: TextFieldOptions<TValues>,
  setFocus: UseFormSetFocus<TValues>,
): ChainProps {
  if (options.kind === 'multiline') return { enterKeyHint: 'enter', submitBehavior: 'newline' };
  const { next } = options;
  if (next !== undefined) {
    // 'submit' keeps the keyboard up while focus moves on: no close-and-reopen flicker.
    const onSubmitEditing = (): void => {
      setFocus(next);
    };
    return { enterKeyHint: 'next', submitBehavior: 'submit', onSubmitEditing };
  }
  const done = { enterKeyHint: 'done', submitBehavior: 'blurAndSubmit' } as const;
  return options.onSubmit === undefined ? done : { ...done, onSubmitEditing: options.onSubmit };
}

/** One field's TextField props, from the form and the field's name. */
export function useTextField<TValues extends FieldValues, TOutput>(
  form: FormFocus<TValues, TOutput>,
  name: FieldPathByValue<TValues, string>,
  options: TextFieldOptions<TValues>,
): TextFieldBinding {
  const t = useT();
  const { field, fieldState } = useController({ control: form.control, name });
  const key = fieldMessageKey(fieldState.error);
  return {
    kind: options.kind,
    value: field.value,
    onChangeText: field.onChange,
    onBlur: field.onBlur,
    ref: field.ref,
    error: key === null ? null : t(key),
    ...chainProps(options, form.setFocus),
  };
}
