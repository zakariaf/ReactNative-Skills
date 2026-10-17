// src/i18n/runtime-message.ts
// Text whose message id arrives at runtime: a game's message ids ('<game>.hud.moves', a lose reason),
// a server error code mapped to a key, a value read from storage. t() takes the typed MessageKey, so a
// runtime id is checked against the source catalog here, never cast (check-i18n-code's key-cast):
// an unknown id reaches onError and shows nothing instead of a raw key or a crash.
import { SOURCE_LANGUAGE } from './languages';
import { messagesFor } from './messages';

import type { MessageValues, TFunction } from './create-t';
import type { MessageKey } from './messages';

/** A message id and its values, as a game, a server answer or saved data hands them over. */
export type RuntimeMessage = { readonly id: string; readonly values?: MessageValues };

/** True when `id` is a key of the source catalog (MessageKey is exactly those keys). */
export function isMessageKey(id: string): id is MessageKey {
  return Object.hasOwn(messagesFor(SOURCE_LANGUAGE), id);
}

/**
 * Formats a runtime message with the app's t(). An id the source catalog lacks is a bug in the code
 * that produced it: it goes to onError (the error log in the app, a thrown error in tests) and the
 * result is an empty string, so no screen ever shows a raw key.
 */
export function translateRuntimeMessage(
  t: TFunction,
  message: RuntimeMessage,
  onError: (error: Error) => void,
): string {
  if (!isMessageKey(message.id)) {
    onError(new Error(`i18n: "${message.id}" is not a key of the ${SOURCE_LANGUAGE} catalog`));
    return '';
  }
  return t(message.id, message.values);
}
