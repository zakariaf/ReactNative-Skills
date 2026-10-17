// src/i18n/bidi.ts
// U+2068 FIRST STRONG ISOLATE ... U+2069 POP DIRECTIONAL ISOLATE.
export const FSI = '⁨';
export const PDI = '⁩';

/** Isolates an interpolated string so its own direction cannot reorder the sentence around it. */
export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/**
 * Removes isolates: before a formatted text becomes a value of another message (it is isolated
 * again there), before comparing text in tests, or before copying to the clipboard.
 */
export function stripIsolates(text: string): string {
  return text.replaceAll(FSI, '').replaceAll(PDI, '');
}
