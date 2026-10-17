// src/core/text/latin-digits.ts
// Typed digits in any script become ASCII digits before a schema checks or converts them
// (forms-and-input). An Arabic keyboard types ٣٠ (U+0663 U+0660), a Persian one ۳۰, a Hindi one
// ३०, and the iOS number pad follows the keyboard language: /^\d+$/ and Number() refuse all of
// them, so the user cannot enter a number in their own digits. Pure: no React, no Intl.

/** The zero of every decimal digit run a phone keyboard can type (Unicode Nd, ten in a row). */
const DIGIT_ZEROS: readonly number[] = [
  0x0660, // Arabic-Indic
  0x06f0, // Extended Arabic-Indic (Persian, Urdu)
  0x07c0, // NKo
  0x0966, // Devanagari
  0x09e6, // Bengali
  0x0a66, // Gurmukhi
  0x0ae6, // Gujarati
  0x0b66, // Oriya
  0x0be6, // Tamil
  0x0c66, // Telugu
  0x0ce6, // Kannada
  0x0d66, // Malayalam
  0x0e50, // Thai
  0x0ed0, // Lao
  0x0f20, // Tibetan
  0x1040, // Myanmar
  0x17e0, // Khmer
  0x1810, // Mongolian
  0xff10, // Fullwidth
];

/** Arabic decimal and thousands separators (U+066B, U+066C). */
const ARABIC_DECIMAL = '٫';
const ARABIC_THOUSANDS = '٬';

function latinDigitOf(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  const zero = DIGIT_ZEROS.find((start) => code >= start && code <= start + 9);
  return zero === undefined ? char : String(code - zero);
}

/** Replaces every typed digit with its ASCII digit; the Arabic decimal separator becomes '.'. */
export function toLatinDigits(text: string): string {
  return Array.from(text, latinDigitOf)
    .join('')
    .replaceAll(ARABIC_DECIMAL, '.')
    .replaceAll(ARABIC_THOUSANDS, '');
}
