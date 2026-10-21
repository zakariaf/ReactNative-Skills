# Digits, bidi isolation and mixed-direction text

## Contents

- Digits: the locale tag decides
- Which digits for which language
- Numbers outside messages
- The digits setting
- Bidi isolation
- A whole left-to-right text in a right-to-left row
- Text the app did not write
- A catalog text that starts with the other script
- Fonts for right-to-left scripts

## Digits: the locale tag decides

Every number shown to a person is formatted with a BCP 47 tag from `localeTagFor(language,
digits)` (`src/i18n/digits.ts`, owned by i18n-strings-and-catalogs). The tag carries the numbering
system (`ar-u-nu-arab`, `ar-u-nu-latn`), and the same tag goes to the `IntlProvider`, so numbers
inside catalog messages (`{count, number}`, plural `#`) and numbers outside them show the same
digits. Hermes ignores the `-u-nu-` part natively; the forced `@formatjs/intl-numberformat`
polyfill honours it, in the app and in Jest (i18n-strings-and-catalogs forces it in the entry and in
Jest `setupFiles`). Storage always holds plain numbers; digits are display only.

Outputs under the forced polyfill (FormatJS NumberFormat 9.4.3, CLDR 48 data; pinned in
`create-number-formatter.test.ts`, verified 2026-10-04):

| Tag | 1234567.89, no decimals | 0.62 as a percent |
|---|---|---|
| `en` | `1,234,568` | `62%` |
| `ar-u-nu-arab` | `١٬٢٣٤٬٥٦٨` (U+066C grouping) | `٦٢٪` followed by U+061C (ARABIC LETTER MARK) |
| `ar-u-nu-latn` | `1,234,568` | `62`, U+200E, `%`, U+200E (LEFT-TO-RIGHT MARKs) |
| `ar` (CLDR default) | `1,234,568`: CLDR 48 moved Arabic's default to Latin digits | as `ar-u-nu-latn` |

CLDR puts invisible marks into Arabic percent output on purpose. A font that lacks U+061C or
U+200E draws a box there; the platform fonts have both, a bundled font must be checked (below).

## Which digits for which language

Write each language's numbering system explicitly in `digits.ts` (the `NUMBERING` table): CLDR
defaults move between releases, and the product decides.

| Language | Common choice | Notes |
|---|---|---|
| Arabic `ar` | `arab` (Arabic-Indic ٠١٢) or `latn` | Varies by region and product: Maghreb countries use Latin digits; CLDR 48's default is Latin. |
| Persian `fa` | `arabext` (Extended Arabic-Indic ۰۱۲) | Separators U+066C (grouping), U+066B (decimal), U+066A (percent). |
| Urdu `ur` | `latn` or `arabext` | CLDR default Latin. |
| Sorani Kurdish `ckb` | `arab` (CLDR) or `arabext` | Many products prefer the Persian-style digits; choose explicitly. |
| Hebrew `he` | `latn` | Hebrew uses Latin digits. |

`localeTagFor(language, 'latin')` gives Latin digits for one value that must stay Latin (a code, a
version number, a phone number typed by the person); say why in a comment next to it.

## Numbers outside messages

A count on a badge, a value drawn on a canvas, a chart label, a price from the store: format in the
screen's model hook (or the canvas presenter) and pass strings to components.

```ts
// src/features/tasks/use-tasks-model.ts (shape)
const formatNumber = createNumberFormatter(localeTagFor(language, digits));
const openCountText = formatNumber(openCount); // "3" in English, "٣" in Arabic with arab digits
const doneRateText = createPercentFormatter(localeTagFor(language, digits))(doneRate);
```

- `Intl.NumberFormat` always gets the tag (never a literal `'ar'`, `undefined` or nothing):
  i18n-strings-and-catalogs' `check-i18n-code` rule `number-format-api` fails the rest.
- A number turned into text by hand (`String(count)`, `count.toString()`, `rate.toFixed(1)`) writes
  Latin digits in every language: `check-rtl` rule `number-to-text` fails it as a JSX child.
  It does not see a template literal (``{`${count} tasks`}``), a number formatted in a helper and
  passed down, or a bare `{count}` child; AppText's `children: string` type stops the bare number
  at compile time, and the template literal is also a hand-built sentence (a plural message
  `{count, plural, ...}` is the fix for both). Review interpolations by hand. Attributes are
  never text: ``key={`dot-${String(i)}`}``, a `testID` or a `style` template literal (the form
  typescript-eslint's `restrict-template-expressions` asks for) passes, also on an element nested
  inside a `.map(...)` child; only the expression children themselves are searched.
- A store price re-formats the numeric price with the same tag (`style: 'currency'`), falling back
  to the store's own string.

## The digits setting

settings-and-preferences owns a "Numbers" (digits) preference: `automatic` (the language's
default), `latin`, `local` (the language's own). Show each option with a live preview, for example
"Local ٣٤٥", made by `createNumberFormatter(localeTagFor(language, option))(345)`, never typed into
a catalog. For a language whose own digits are Latin the three previews look the same; the row may
be hidden for those languages (a product decision).

## Bidi isolation

- **Free text interpolated into a sentence** (a list name, a person's name, a formatted date, an
  autonym in "System (العربية)") is wrapped in U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL
  ISOLATE, so its own direction cannot reorder the sentence around it. i18n-strings-and-catalogs'
  `t()` does this for every free-text placeholder; other free text uses `isolate()` from
  `src/i18n/bidi.ts`. Strip the inner isolates (`stripIsolates`) before a formatted text becomes a
  value of another message (never isolate twice).
- Numbers are never isolated (they are formatted inside the sentence and take its digits); `select`
  keys are never isolated (the match would fail).
- **No bidi controls anywhere else:** not in catalogs (i18n-strings-and-catalogs checks them), and
  not in source code, raw or escaped (`check-rtl` rule `bidi-in-source`, outside the bidi files:
  `src/i18n/bidi.ts` and AppText, which adds a direction mark on Android for an explicit
  direction). Never LRM/RLM (U+200E/U+200F), the embeddings U+202A–U+202E or the Arabic Letter
  Mark U+061C to nudge text into place: they work on one platform and break copy, search and
  screen readers on another.
- Verified (iOS 26.5): a Latin list name inside a right-to-left sentence stays in place with
  isolates, and the isolates render invisibly with the platform font.
- Tests compare with `FSI`/`PDI` in the expected string, or strip them first.

## A whole left-to-right text in a right-to-left row

Isolation is for free text *inside* a sentence. A whole text written left to right inside a
right-to-left screen (an English label a developer screen keeps in every language, a code, an email
address in a row) is a different case: lay it as a left-to-right paragraph aligned to the row's
start, `<AppText direction="ltr">`. The text style then sets `writingDirection: 'ltr'` (iOS) and
AppText prefixes a left-to-right mark (Android), while `textAlign` stays the start token, which
React Native swaps to the right in a right-to-left layout. The language's font and line height stay.

Why: laid right to left, iOS kept the trailing space of a wrapped English line inside the line, so
its first line sat 4.4 pt off the row's start (measured on an iPhone 16 Pro simulator, iOS 26.5,
2026-10-01); laid left to right and aligned to the same edge, every line sits flush. Never marks or
embeddings for this (`bidi-in-source` names `direction="ltr"` in its fix), never a hand-written
`writingDirection` (`writing-direction`).

## Text the app did not write

A task title, a list name, a note, a search query, a contact: such text is laid out by its own first
strong letter (Unicode's first-strong rule, UAX #9 rules P2–P3), not by the UI language. A Latin
title in an Arabic screen ("Buy milk!") must keep its exclamation mark at its own end. Use
`firstStrongDirection(text)` (`templates/src/i18n/text-direction.ts`) and pass the result to
AppText's `direction`, falling back to the layout when the text has no strong letter (a number):

```tsx
<AppText direction={firstStrongDirection(task.title) ?? layoutDirection}>{task.title}</AppText>
```

Only letters are strong. Digits are weak in every script, the Arabic-Indic digits (U+0660–0669) and
the Persian ones (U+06F0–06F9) too, even though they sit inside the Arabic block, and so are Arabic
punctuation (`،`, `٪`, `٫`) and the harakat. So `"۳ tasks"` reads left to right and `"۱۲:۳۰"` has no
direction of its own; a check by Unicode block alone would call both right-to-left. The template tests
it with a property: any run of digits and separators before a word leaves the word's direction.

A `TextInput` for free text holds the same mix: keep its alignment logical through the input
component (never a `textAlign` literal) and test typing both scripts in both layouts; forms-and-input
owns the input components.

## A catalog text that starts with the other script

Android decides a paragraph's direction from its first strong character (React Native 0.86's text
layout uses `FIRSTSTRONG_LTR`, read in source), and `writingDirection` is ignored there. An Arabic
catalog message that starts with a Latin word (a brand name, "iCloud …") is then laid out left to
right on Android only. Give such a text `direction={directionOf(language)}`: AppText adds the
right-to-left mark on Android, and iOS reads the writing direction. Prefer rewording the message so
it starts with an Arabic word when the translator agrees.

## Fonts for right-to-left scripts

design-system-structure owns fonts (the system font by default, bundled fonts pinned in its
contract) and the tall-script line heights. What this skill adds is the list to check before
bundling a font for a right-to-left script:

- every letter of each shipped language (Persian and Urdu letters beyond the Arabic alphabet, Sorani
  letters ڕ ڵ ۆ ێ ە ڤ), both digit sets (U+0660–U+0669, U+06F0–U+06F9), the separators U+066B
  U+066C U+066A and ، ؛ ؟, ZWNJ (U+200C) and ZWJ;
- the marks CLDR and AppText emit: U+061C (Arabic percent output), U+200E/U+200F (Latin-digit
  percent output, AppText's Android direction marks). Some popular Arabic-script fonts lack U+061C:
  then format percentages in a way that does not emit it, or pick a font that has it;
- one family per weight, file name equal to the PostScript name, letter-spacing 0 (connected
  scripts break apart when tracked).

The screenshot matrix (testing-rtl.md) is the judge: no clipped marks, no boxes, no overlapping
lines at 200 % text.
