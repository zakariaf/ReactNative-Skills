# Formatting and input at the edge

## Contents

1. Where formatting lives
2. formatMoney, verified
3. Exact input: decimal text, not floats
4. Display options
5. Digits, RTL and the polyfill
6. Performance
7. Amount input fields
8. Store display prices
9. Quantities
10. Tests

## 1. Where formatting lives

Values become text only in `src/i18n/` (the i18n layer of i18n-strings-and-catalogs), never in
`src/core/` (`core-formats`) and never with `style: 'currency'` in a feature (`currency-format-edge`).
Model hooks call `useFormatMoney()` and `useLocaleTag()`; components receive finished strings. A
sentence that holds an amount is a catalog message with the formatted amount as a placeholder value
(`t('orders.total', { total: formatMoney(order.total, localeTag) })`), so word order and the bidi
isolation stay the catalog's business.

## 2. formatMoney, verified

`formatMoney(amount, localeTag, options)` builds (and caches) an `Intl.NumberFormat` with
`style: 'currency'`, the amount's currency, `minimumFractionDigits` and `maximumFractionDigits` set to
the ISO 4217 exponent, and formats `toDecimalString(amount)`. Outputs under the forced FormatJS
polyfill (`@formatjs/intl-numberformat` 9.4.3, the harness's Jest setup, which is what iOS and Android
run), verified 2026-10-10:

| Amount | Tag | Output |
|---|---|---|
| 1999 USD | `en` | `$19.99` |
| 12345 KWD | `en` | `KWD 12.345` (U+00A0 no-break space) |
| 125 JPY | `en` | `¥125` |
| 12345 IQD | `en` | `IQD 12.345` (CLDR alone would print `IQD 12`) |
| −5 USD | `en` | `-$0.05` |
| −1234 USD, accounting | `en` | `($12.34)` |
| 199 EUR, `display: 'code'` | `en` | `EUR 1.99` |
| 199 USD, `display: 'name'` | `en` | `1.99 US dollars` |
| 1999 USD | `ar-u-nu-arab` | `‏١٩٫٩٩ US$` (right-to-left mark first) |
| 1999 USD | `ar-u-nu-latn` | `‏19.99 US$` |

- An unknown but well-formed code (`ZZZ`) formats as `ZZZ 1.00` without an error, which is why
  codes are validated by `parseCurrencyCode` before they become `Money`.
- A malformed code (`usd1`) throws `RangeError: Malformed currency code`.
- The default rounding mode is `halfExpand`; with the digits equal to the exponent and exact decimal
  input, no rounding ever happens in formatMoney.

## 3. Exact input: decimal text, not floats

`Intl.NumberFormat.prototype.format` accepts a number, a BigInt or a decimal string (ES2023,
`Intl.StringNumericLiteral` in TypeScript's lib). A string is formatted exactly:

| Input | Output (`en`, USD) |
|---|---|
| `'90071992547409.93'` | `$90,071,992,547,409.93` |
| `90071992547409.93` (a double) | `$90,071,992,547,409.94` |

So `formatMoney` passes `toDecimalString(amount)`, never `amount.minor / 100`.

## 4. Display options

- `display`: `'symbol'` (default; `$`, `US$` where `$` is ambiguous in the locale), `'narrow-symbol'`
  (`$` everywhere: compact UIs where the currency is obvious), `'code'` (`USD`: lists mixing
  currencies, statements), `'name'` (screen-reader friendly long form).
- `isAccounting`: negative amounts in parentheses where the locale does so.
- Whole-number display for a 0-display currency (HUF prices) is a display decision: format a copy
  rounded with `applyRate`/`allocate` rules first, or add a dedicated option; never change the
  stored amount or the exponent table.
- Screen readers: VoiceOver and TalkBack read `$19.99` as a price in English; for symbols they read
  poorly in another language, offer the `name` display in the accessibility label
  (accessibility-as-code owns labels).

## 5. Digits, RTL and the polyfill

- The locale tag carries the numbering system (`localeTagFor(language, digits)`: `ar-u-nu-arab`), and
  the same tag formats messages and amounts, so they never disagree (i18n-strings-and-catalogs).
- Hermes ignores `-u-nu-` and formats with each platform's own ICU data; the forced FormatJS polyfill
  (loaded first in `index.ts` and in Jest `setupFiles`) makes the output identical on iOS, on Android
  and in Jest. A test that formats money therefore needs no platform branch.
- Arabic currency text starts with U+200F (RLM). Inside a right-to-left sentence the catalog's
  placeholder isolation keeps it in place; do not strip it, and do not add your own marks.
- With the polyfills present, `new Intl.NumberFormat('ar')` prints Latin digits (CLDR 48 switched
  `ar` to Latin); always pass the tag from `localeTagFor`.

## 6. Performance

Constructing an `Intl.NumberFormat` under the polyfill resolves locale data and options, which is the
slow part; `format` on an existing instance is cheap. `formatMoney` and `formatQuantity` cache
instances in a module-level `Map` keyed by tag and options (a handful of entries per app). In a long
list, format in the model hook or the row's selector, not in a render loop that rebuilds options
objects. The React Compiler memoizes components; the cache keeps the formatter work flat.

## 7. Amount input fields

The text field keeps the person's text; the value is parsed on change:

1. `normalizeDecimalInput(text, localeTag)` returns `Result<string, DecimalInputFailure>`. It maps
   the locale's digits (from the same tag, so Arabic-Indic `١٢٫٥` works) to ASCII and the locale's
   decimal separator to `.`, removes bidi marks and surrounding spaces, turns `−` into `-`, `.5` into
   `0.5` and `5.` into `5`. It never drops a separator blindly, because a misread separator is a
   100× or 1000× amount that every later check accepts:
   - The locale's **group separator** counts only where it can stand: in the whole part, before any
     decimal separator, between groups of the locale's sizes (3, or en-IN's `1,23,456`, read from
     Intl). German `1.234,5` is 1234.5, `1.234.567` is 1234567; English `1,234.50` is 1234.50. Spaces
     count as the group separator only in a locale that groups with a space (French `1 234,5`), and
     `'` and `’` stand for each other (Swiss `1'234.50`).
   - A **lone `.` or `,` that cannot be a group separator** is the decimal point a keyboard sent:
     German `12.50` is 12.50 and `1.5` is 1.5 (never 1250 or 15); English `12,5` is 12.5. A `.` that
     is not the locale's group separator is always the decimal point (French `12.5`).
   - **Ambiguous** text, a lone `.` or `,` group separator with one to three digits before it and
     exactly three after it (German `1.234`, English `1,234`, en-IN `12,345` and `123,456`), is
     `{ kind: 'ambiguous-separator' }`: it could be 1234 or 1.234, and only the person knows. The
     message asks them to type it without the group separator. `1234,567` in English is 1234.567
     (it cannot be grouping). The trade-off is real: an English speaker typing `1,000`, or a Spanish
     one typing `1.000`, is asked once instead of being understood. It is kept because the other
     reading is a 1000× amount that no later check catches for an exponent-3 currency (KWD, BHD) or a
     quantity; for a 2-decimal currency the person types `1000` and moves on.
   - A group separator **anywhere else** (`1,2,3`, `12,34.5`, English `1.234,5`) is
     `{ kind: 'misplaced-separator' }`.
   - Any other character stays (`$12`, `12abc`, `12,5` in Arabic, whose separator is `٫`), so the
     parser refuses it.
   `normalizeDecimalText(text, symbols)` is the same function with the symbols written out, for a
   locale whose Intl data the app does not load and for tests (the forced polyfill formats only the
   app's languages, so a German test written against the tag would not test German).
2. `parseMoney(normalized, currency)` returns `not-a-decimal`, `too-many-decimals` (with the allowed
   number) or `out-of-range`; the model maps each kind, and the two separator kinds of step 1, to a
   catalog message and keeps the text. Rounding the input silently is never right: "1.234" in a USD
   field is a typo to show.
3. Keyboard: forms-and-input's `TextField` with kind `'decimal'` (it sets the decimal pad) plus its
   `KeyboardDoneBar`, because the iOS decimal pad has no return key; a raw `TextInput` in a feature
   fails forms-and-input's checker. On iOS the pad shows the locale's decimal
   separator. On Android the pad comes from the keyboard app, and some keyboards show only `.`
   whatever the locale (reported widely; verify on the target devices). Step 1 reads such a `.` as
   the decimal point when it cannot be a German-style group separator (`12.50`, `1.5`, `0.99`) and
   asks when it could be (`1.234`), so a person on such a keyboard never enters 1250.00 for 12.50.
4. For a keypad without a decimal key (a POS-style entry), accumulate digits into minor units
   directly: each digit `d` makes `minor = minor × 10 + d`, shown through `formatMoney`.

forms-and-input owns the field, focus and validation wiring; this skill owns the conversion
(`examples/use-amount-field.ts` shows the model hook).

## 8. Store display prices

The price to pay is the store's `displayPrice` string, shown as is (money-model.md section 7). If a
design needs the digits to follow the app's digit setting instead, format the store's Money with
`formatMoney` and the storefront currency; never type a price into code or catalogs.

The two texts can differ in more than digits. `formatMoney` prints the ISO 4217 exponent, so a
Hungarian forint price shows as `1 190,00 Ft` (HUF has 2 ISO decimals) where the store's
`displayPrice` shows `1 190 Ft` (CLDR and the store show none); IQD, IDR, CLP-style differences are
listed in money-model.md section 4. So `displayPrice` stays the price to pay, and a `formatMoney`
text of a store price is for derived figures ("save 4 000,00 Ft a year") where the app's own
arithmetic produced the number. A purchase module that formats store prices itself does so in
`src/i18n/` with `formatMoney` (from `moneyFromStoreDouble`), not with its own `style: 'currency'`
NumberFormat, which `check-value-code` reports.

## 9. Quantities

`formatQuantity(dimension, canonical, { unit, localeTag, maximumFractionDigits, unitDisplay })`
converts the canonical integer to the display unit (a float used only here) and formats with
`style: 'unit'`. Verified under the polyfill: 5,500,000 mm as `5.5 km` or `3.4 mi`, `٥٫٥ كم` in
`ar-u-nu-arab`; 1,500,000 bytes as `1.5 MB`; 2,506 g with two digits and long names as
`2.51 kilograms`. The unit keys are Intl's sanctioned unit identifiers (`kilometer`, `mile`,
`kilogram`, `pound`, `liter`, `gallon`, `fluid-ounce`, `megabyte`, `hour`, ...). Durations such as
"1 h 5 min" are catalog messages with numbers (there is no `Intl.DurationFormat` in Hermes or in the
polyfill set).

## 10. Tests

Format tests run under the forced polyfill (Jest `setupFiles`), so assert exact strings, including
U+00A0 and U+200F written as escapes. Cover: a 0-, 2- and 3-exponent currency, IQD (the CLDR
difference), a negative, the largest safe amount, an RTL tag. Input tests: each locale's separators,
Arabic-Indic digits, the leading-dot and trailing-dot forms, the keyboard dot in a locale that
groups with `.` (`12.50` German), the ambiguous and misplaced separator kinds, and text the parser
must refuse; locales the app does not load go through `normalizeDecimalText` with their symbols
written out.
