// src/i18n/intl-status.ts
type MaybePolyfilled = { readonly polyfilled?: boolean };

/** True only when the forced FormatJS polyfills are the active implementations. */
export function areIntlPolyfillsActive(): boolean {
  const plural = Intl.PluralRules as unknown as MaybePolyfilled;
  const numbers = Intl.NumberFormat as unknown as MaybePolyfilled;
  return plural.polyfilled === true && numbers.polyfilled === true;
}
