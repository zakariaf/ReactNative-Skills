# Example: times and dates with Intl.DateTimeFormat at the edge

The shape to follow when the app shows what catalog month names cannot express: a time of day, a
full date in many shapes. (A relative time such as "3 days ago" is a catalog plural, or
`Intl.RelativeTimeFormat` on its own forced block: the DateTimeFormat polyfill does not provide it.)
`Intl.DateTimeFormat` lives in `src/i18n/` only, gets the
locale tag (digits), an explicit calendar and an explicit time zone, and runs on the forced FormatJS
polyfill, so Hermes and Jest print the same text. Verified on 2026-10-03 with Node 26.4 and the
pinned polyfills (`@formatjs/intl-datetimeformat` 7.8.0 forced, with `en` and `ar` data and
`add-golden-tz.js`).

## 1. Install and extend the polyfills

```sh
npm install -E @formatjs/intl-datetimeformat@7.8.0
```

Append the block to `src/i18n/intl-polyfills.ts`, after the NumberFormat block, one locale-data
import per language in `LANGUAGES`, then exactly one time-zone file:

```ts
// 5. Forced: native Hermes formats with the device calendar and ignores -u-nu-.
import '@formatjs/intl-datetimeformat/polyfill-force.js';
import '@formatjs/intl-datetimeformat/locale-data/en.js';
import '@formatjs/intl-datetimeformat/locale-data/ar.js';
import '@formatjs/intl-datetimeformat/add-golden-tz.js';
```

`check-i18n-code.mjs` rule `intl-api` requires this block as soon as a file under `src/i18n/`
uses `Intl.DateTimeFormat`, and `polyfill-locales` fails a partial one (a language without data, no
time-zone file, the conditional `polyfill.js`). A language without data does not throw: it silently
formats in English (`fr` came out as `9/26/2026`).

Startup weight, measured on disk for two languages: `polyfill-force.js` 101 KB (25 KB gzip), each
locale-data file about 210-270 KB (about 20 KB gzip), `add-golden-tz.js` 814 KB (128 KB gzip),
`add-all-tz.js` 1.36 MB (193 KB gzip). `add-golden-tz.js` covers the commonly used zones; take
`add-all-tz.js` only when the app formats arbitrary zones. This weight is why the template's
day-month labels use catalog month names instead.

## 2. The formatter

```ts
// src/i18n/format-time.ts
import { localeTagFor } from './digits';

import type { DigitStyle } from './digits';
import type { Language } from './languages';

export type TimeContext = {
  readonly language: Language;
  readonly digits: DigitStyle;
  /** The device zone: getCalendars()[0]?.timeZone from expo-localization (null -> 'UTC'). */
  readonly timeZone: string;
};

/** '14:05 UTC' -> '5:05 PM' (en, Asia/Riyadh) / '٥:٠٥ م' (ar, Arabic-Indic digits). */
export function formatTimeOfDay(at: Date, context: TimeContext): string {
  const format = new Intl.DateTimeFormat(localeTagFor(context.language, context.digits), {
    calendar: 'gregory',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: context.timeZone,
  });
  return format.format(at);
}
```

- **Always pass `timeZone`.** The forced polyfill does not know the device zone: without it every
  time is UTC (seen: `2:05 PM` for 14:05 UTC with `TZ=Europe/Berlin` in Node). Read the zone from
  `getCalendars()[0]?.timeZone` (expo-localization) in the model hook and pass it in; that also makes
  the test independent of the machine.
- **Always pass `calendar: 'gregory'`.** The polyfill formats the Gregorian calendar only; any other
  calendar falls back to it silently (`ar-u-ca-islamic` and `fa` with `calendar: 'persian'` both
  resolved to `gregory`). Saying so in code keeps the intent visible; a product that needs another
  calendar converts the date itself and uses catalog month names.
- The digits come from the locale tag, exactly as for messages: `ar-u-nu-arab` -> `٥:٠٥ م`,
  `ar-u-nu-latn` -> `5:05 م`.
- The result is a value for a message (`{timeText}`), never glued to other words. It already is one
  run of its language; pass it as `stripIsolates(...)` only when it came out of `t()`.

## 3. The test

```ts
// src/i18n/format-time.test.ts
import { formatTimeOfDay } from './format-time';

const AT = new Date(Date.UTC(2026, 8, 26, 14, 5));
const NNBSP = '\u202f'; // CLDR's narrow no-break space before AM/PM

describe('formatTimeOfDay', () => {
  it.each([
    ['en', 'automatic', `5:05${NNBSP}PM`],
    ['ar', 'automatic', '٥:٠٥ م'],
    ['ar', 'latin', '5:05 م'],
  ] as const)('formats 14:05 UTC in Riyadh in %s (%s digits)', (language, digits, text) => {
    expect(formatTimeOfDay(AT, { language, digits, timeZone: 'Asia/Riyadh' })).toBe(text);
  });
});
```

Jest loads `intl-polyfills.ts` through `setupFiles`, so the forced polyfill formats in Jest with the
same code and data the app bundles (not yet probed on a device: show `formatTimeOfDay` on the debug
screen of a test build after adding it, as the runtime reference's on-device probe does for
numbers). English puts U+202F (narrow no-break space) before `PM`, so a plain-space expectation
fails; compare with the character, never by trimming spaces. These three assertions, `tsc` and the
canonical ESLint config passed in the reference app with the block above (2026-10-03), and
`check-i18n-code.mjs` passed only once the block was there.
