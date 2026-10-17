// src/data/document/schema/document-primitives.ts: the value schemas the document sections share. Frozen once shipped.
import * as v from 'valibot';

/** Non-negative safe integer: counts and epoch milliseconds. */
export const COUNT = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

/** Local calendar day 'YYYY-MM-DD' (the clock's today()). */
export const DATE_KEY = v.pipe(
  v.string(),
  v.regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
);

/** kebab-case identifiers: the app id, tip ids. */
export const KEBAB_ID = v.pipe(v.string(), v.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/));

/** A BCP 47 language tag the app ships, such as 'en' or 'ar'; null means "follow the device". */
export const LANGUAGE_TAG = v.pipe(
  v.string(),
  v.regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/),
);

/** Hour of the day, 0 to 23. */
export const HOUR = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(23));
