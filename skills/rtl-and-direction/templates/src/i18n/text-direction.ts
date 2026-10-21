// src/i18n/text-direction.ts
// The direction of a text the app did not write: a task title, a list name, a contact, a search
// query. Such text is laid out by its own first strong letter (Unicode's first-strong rule, UAX #9
// P2-P3), not by the UI language: a Latin title inside an Arabic screen must keep its full stop at
// its own end. Pass the result to AppText's `direction` (iOS reads writingDirection; on Android
// AppText adds a direction mark, because Android ignores writingDirection).
import { FSI, PDI } from './bidi';

import type { Direction } from './languages';

/** A letter: the only strong characters. Digits (\p{Nd}), marks and punctuation are weak or neutral. */
const LETTER = /\p{L}/u;
/**
 * The right-to-left blocks: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic, the
 * presentation forms and the historic and Adlam ranges. They also hold weak characters (the
 * Arabic-Indic digits U+0660-0669, the Persian digits U+06F0-06F9, Arabic punctuation and harakat),
 * so a character counts as right-to-left only when it is also a letter.
 */
const RTL_BLOCK =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/**
 * The direction of the first strong letter, skipping digits (of every script), punctuation, spaces
 * and isolated runs; null when there is none (an empty string, a number), so the caller falls back
 * to the layout.
 */
export function firstStrongDirection(text: string): Direction | null {
  let depth = 0;
  for (const char of text) {
    if (char === FSI) depth += 1;
    else if (char === PDI) depth = Math.max(0, depth - 1);
    else if (depth === 0 && LETTER.test(char)) return RTL_BLOCK.test(char) ? 'rtl' : 'ltr';
  }
  return null;
}
