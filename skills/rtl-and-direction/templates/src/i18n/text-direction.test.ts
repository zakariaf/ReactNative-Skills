// src/i18n/text-direction.test.ts
import fc from 'fast-check';

import { isolate } from './bidi';
import { firstStrongDirection } from './text-direction';

/** Western, Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (Persian, U+06F0-06F9) digits. */
const DIGIT_SETS = ['0123456789', '٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹'];
/** Weak and neutral characters: digits of every set, separators, spaces and punctuation. */
const WEAK = [...Array.from(DIGIT_SETS.join('')), ' ', ':', '.', ',', '%', '-', '٫', '٬', '٪', '،'];
const weakText = fc
  .array(fc.constantFrom(...WEAK), { maxLength: 12 })
  .map((chars) => chars.join(''));

describe('firstStrongDirection', () => {
  it.each([
    ['Buy milk!', 'ltr'],
    ['اشترِ الحليب!', 'rtl'],
    ['קניות', 'rtl'],
    ['  42 — Inbox', 'ltr'],
    ['٣ مهام', 'rtl'],
    ['Ünïcode', 'ltr'],
    ['۳ tasks', 'ltr'],
    ['٣ tasks', 'ltr'],
  ] as const)('reads %j as %s', (text, direction) => {
    expect(firstStrongDirection(text)).toBe(direction);
  });

  it('returns null for text without a strong letter, so the caller uses the layout', () => {
    expect(firstStrongDirection('')).toBeNull();
    expect(firstStrongDirection('12:30 — 45%')).toBeNull();
    expect(firstStrongDirection('۱۲:۳۰')).toBeNull();
    expect(firstStrongDirection('٤٥٪')).toBeNull();
  });

  it('treats digits of every set as weak: the first letter after them decides', () => {
    fc.assert(
      fc.property(weakText, fc.constantFrom('Inbox', 'مهام', 'קניות'), (prefix, word) => {
        expect(firstStrongDirection(`${prefix}${word}`)).toBe(firstStrongDirection(word));
        expect(firstStrongDirection(prefix)).toBeNull();
      }),
    );
  });

  it('skips a run inside first-strong isolates', () => {
    expect(firstStrongDirection(`${isolate('Inbox')} مهام`)).toBe('rtl');
  });
});
