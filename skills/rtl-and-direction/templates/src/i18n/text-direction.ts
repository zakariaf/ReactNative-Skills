// src/i18n/text-direction.ts
// The direction of a text the app did not write: a task title, a list name, a contact, a search
// query. Such text is laid out by its own first strong letter (Unicode's first-strong rule, UAX #9
// P2-P3), not by the UI language: a Latin title inside an Arabic screen must keep its full stop at
// its own end. Pass the result to AppText's `direction` (iOS reads writingDirection; on Android
// AppText adds a direction mark, because Android ignores writingDirection).
import { FSI, PDI } from './bidi';

import type { Direction } from './languages';

/** Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic and the presentation forms. */
const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/u;
/** A strong left-to-right letter: any letter or mark outside the right-to-left blocks. */
const LETTER = /[\p{L}]/u;

/**
 * The direction of the first strong letter, skipping digits, punctuation, spaces and isolated runs;
 * null when there is none (an empty string, a number), so the caller falls back to the layout.
 */
export function firstStrongDirection(text: string): Direction | null {
  let depth = 0;
  for (const char of text) {
    if (char === FSI) depth += 1;
    else if (char === PDI) depth = Math.max(0, depth - 1);
    else if (depth === 0 && RTL_LETTER.test(char)) return 'rtl';
    else if (depth === 0 && LETTER.test(char)) return 'ltr';
  }
  return null;
}
