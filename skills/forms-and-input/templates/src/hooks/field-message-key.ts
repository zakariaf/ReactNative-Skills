// src/hooks/field-message-key.ts
// Turns a react-hook-form field error into a catalog key (forms-and-input). With the valibot
// resolver an error's message is whatever the schema action carried: in this app always a
// catalog key ('task-editor.title.required'). A message that is not a key (an action written
// without one shows valibot's English default; a manual setError with prose) becomes the generic
// key instead of reaching the screen as English or as a raw key. A type guard, never a cast.
import { SOURCE_LANGUAGE } from '@/i18n/languages';
import { messagesFor } from '@/i18n/messages';

import type { MessageKey } from '@/i18n/messages';
import type { FieldError } from 'react-hook-form';

/** Shown when an error carries no catalog key. */
export const FALLBACK_FIELD_MESSAGE = 'forms.field.invalid' satisfies MessageKey;

/** True for a key of the source catalog (every catalog has the same keys). */
export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(messagesFor(SOURCE_LANGUAGE), value);
}

/** The key to translate for a field error, or null when the field has none. */
export function fieldMessageKey(error: FieldError | undefined): MessageKey | null {
  if (error === undefined) return null;
  const { message } = error;
  return typeof message === 'string' && isMessageKey(message) ? message : FALLBACK_FIELD_MESSAGE;
}
