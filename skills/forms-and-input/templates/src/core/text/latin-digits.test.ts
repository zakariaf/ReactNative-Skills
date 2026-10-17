// src/core/text/latin-digits.test.ts
import fc from 'fast-check';

import { toLatinDigits } from './latin-digits';

describe('toLatinDigits', () => {
  it.each([
    ['٣٠', '30'],
    ['۱۲۵', '125'],
    ['३०', '30'],
    ['１２', '12'],
    ['٣٫٥', '3.5'],
    ['١٬٢٠٠', '1200'],
    ['42', '42'],
  ])('reads %s as %s', (typed, latin) => {
    expect(toLatinDigits(typed)).toBe(latin);
  });

  it('leaves letters, spaces and signs alone', () => {
    expect(toLatinDigits(' -12 min ')).toBe(' -12 min ');
  });

  it('keeps every ASCII text as it is', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary-ascii' }), (text) => {
        expect(toLatinDigits(text)).toBe(text);
      }),
    );
  });
});
