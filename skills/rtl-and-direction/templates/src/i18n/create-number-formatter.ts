// src/i18n/create-number-formatter.ts
// Numbers that are not inside a catalog message: a count on a badge, a value drawn on a canvas, a
// chart label. The tag comes from localeTagFor(language, digits), the same tag the IntlProvider
// gets, so these numbers show the same digits as the sentences around them; the forced FormatJS
// NumberFormat polyfill honours its -u-nu- part on Hermes and in Jest alike.
export type NumberFormatter = (value: number) => string;

/** Whole numbers in the tag's digits and grouping: 1,234 · ١٬٢٣٤. */
export function createNumberFormatter(localeTag: string): NumberFormatter {
  const format = new Intl.NumberFormat(localeTag, { maximumFractionDigits: 0 });
  return (value) => format.format(value);
}

/** A rate from 0 to 1 as a whole percentage with the locale's own sign and spacing. */
export function createPercentFormatter(localeTag: string): NumberFormatter {
  const format = new Intl.NumberFormat(localeTag, { style: 'percent', maximumFractionDigits: 0 });
  return (value) => format.format(value);
}
