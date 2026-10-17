# Catalogs, keys and ICU messages

Everything about the text itself: where catalogs live, how keys are named, how placeholders and
plurals are written, and every rule `check-catalogs.mjs` (and the project linter behind
`npm run i18n:verify`) enforces.

## Contents

- Catalog files
- Key grammar
- Placeholders
- Numbers and plurals (CLDR categories, verified outputs)
- Free text and bidi isolation (and nested isolates)
- System dialog texts
- Untranslated keys (developer-only screens)
- Dates and month names
- Script rules for translators
- The catalog rules (L1-L13, P1-P5, F1)
- What FormatJS verify does and does not catch
- When multi-package: key prefixes

## Catalog files

```
src/i18n/languages.ts            LANGUAGES = ['en', 'ar'] as const; SOURCE_LANGUAGE = 'en'
src/i18n/catalogs/en.json        the source catalog: every key exists here first
src/i18n/catalogs/ar.json        one file per language in LANGUAGES, the same keys
```

- A catalog is a **flat JSON object**: key -> ICU MessageFormat string. No nesting, no arrays, no
  comments.
- **The source language is authoritative.** A key exists in `<source>.json` first; every other
  catalog has exactly the same keys (P1, P2).
- **Keys are sorted** (JavaScript default sort, by UTF-16 code unit) in every file, so diffs stay
  small (L12). `sync-copy.mjs apply` writes sorted files; Prettier keeps the 2-space layout.
- **No runtime fallback.** `messagesFor(language)` returns that language's catalog alone. A key a
  translation lacks reaches `onError` (the error log in the app, a thrown error in tests) instead of
  silently showing the source language; the checker catches it before that.
- A language may carry a region or script (`pt-BR`, `zh-Hant`, `es-419`): its catalog is
  `pt-BR.json`, its plural rules are CLDR's for the full tag (`pt-BR` and `pt-PT` both have
  one/many/other, but 0 is `one` in `pt-BR` and `other` in `pt-PT`, verified on Node 26.4), and the
  polyfill rule finds each package's locale-data file by truncation fallback, the tag and then the
  tag minus its last subtag (runtime reference, "Regional and script languages").
- **Tags are in BCP 47 canonical casing and the file is named exactly so** (F1): language lowercase,
  Script title case, REGION uppercase (`en`, `pt-BR`, `zh-Hant`, `es-419`). `pt-br` in `LANGUAGES` or a
  `pt-br.json` file for `pt-BR` fails: a case-insensitive Mac imports `./catalogs/pt-BR.json` from
  `pt-br.json`, Linux CI and EAS Build do not. naming-conventions' `catalog-file` rule names catalogs
  the same way (and, with `contracts/naming.json` `locales`, only those tags).
- `LANGUAGES` in `languages.ts` is the one list. The checkers read it as a literal, the polyfill
  rule derives the locale-data imports from it, `messages.ts` must type-check against it, and
  `supportedLocales` repeats it.

## Key grammar

```
key      = segment "." segment [ "." segment ]{0,3}      2 to 5 segments
segment  = [a-z0-9]+ ( "-" [a-z0-9]+ )*                   lowercase ASCII kebab-case
regex    = ^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*){1,4}$
```

| Rule | Example | Rejected |
|---|---|---|
| `<area>.<element>[.<variant>]`, 2-5 kebab segments | `tasks.delete.title` | `Tasks.Title`, `tasksTitle` |
| The key names the place, never the words | `tasks.summary.open` | `tasks.you-have-no-open-tasks` |
| The last segment names the role when an element has several texts | `.title`, `.body`, `.label`, `.description`, `.a11y-label`, `.a11y-hint`, `-button` | `.text1`, `.text2` |
| One key per whole sentence or label | `tasks.summary.open` | `tasks.summary.prefix` + `...suffix` |
| Plurals live inside the message | `{openCount, plural, …}` | `…-one` / `…-other` keys |
| A text used on several screens with the same meaning has one `common.*` key | `common.cancel` | `tasks.cancel` + `lists.cancel` |
| Keys are literals at the call site, or come from a typed table of literals | `t('tasks.page')`, `MONTH_SHORT_KEYS[month - 1]` | `` t(`date.month-short.${month}`) `` |
| Never cast a string to a key | a `switch` that returns literal keys | `t(code as MessageKey)` |
| No key is a prefix of another key | `tasks.list.title` and `tasks.list.empty` | `tasks.list` and `tasks.list.title` together |

The first segment is the area: a feature folder (`tasks`, `settings`) or a shared area such as
`common`, `app`, `date`, `permissions`. naming-conventions' `i18n-key-namespace` rule checks it against
the feature folders and `contracts/naming.json` `keyAreas` when the app declares them; this skill's L1
checks only the shape.

Why literals: `MessageKey = keyof typeof en` (from the JSON import) and both checkers can only check
keys they can see. A typed table keeps that: `['…'] as const satisfies readonly MessageKey[]`. A cast
(`as MessageKey`) turns any string into a key, so a typo compiles; `check-i18n-code.mjs` fails it
(`key-cast`). A failure code that maps to a message is a `switch` returning literal keys (see
error-handling-typed-results for the failure codes themselves).

## Placeholders

| Kind | Syntax | Name | Value passed to `t()` |
|---|---|---|---|
| Number | `{page, number}`, `{doneRate, number, ::percent}`, `{year, number, ::group-off}` | camelCase, not ending in Name/Text | `number` |
| Counted noun | `{openCount, plural, one {# task} other {# tasks}}` | camelCase | `number` |
| Ordinal | `{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}` | camelCase | `number` |
| Choice | `{mode, select, daily {…} other {…}}` | camelCase, not ending in Name/Text | `string` key |
| Free text | `{listName}`, `{dateText}`, `{priceText}` | ends in `Name` or `Text` | `string` (bidi-isolated by `t()`) |

- A plain `{x}` prints `String(value)` (read in `intl-messageformat` 12.1.2), which is Latin digits
  in every language. So every number in a sentence is `{x, number}`, a skeleton, or a plural `#`,
  and a plain `{x}` is only for free text whose name ends in `Name` or `Text` (L4).
- A store price is `{priceText}` (already formatted by the store), never `{price}`.
- The same key has the same placeholders with the same types in every language (P3).
- Apostrophes: ASCII `'` is ICU's escape character. English uses the typographic ’ (U+2019); a
  literal brace is written `'{'`.
- No rich-text tags (`<b>…</b>`) and no `{x, date}`/`{x, time}` (L3): emphasis belongs in layout,
  dates in `format-date.ts`.

## Numbers and plurals

The categories come from CLDR, per language. Read them from Node (full ICU), never from memory:

```sh
node -e "for (const l of process.argv.slice(1)) console.log(l, new Intl.PluralRules(l).resolvedOptions().pluralCategories.join(' '), '| ordinal:', new Intl.PluralRules(l, { type: 'ordinal' }).resolvedOptions().pluralCategories.join(' '))" en de fr ru pl ar he fa ja
```

Verified on 2026-10-03 with Node 26.4 (ICU 78.3, CLDR 48):

| Language | Cardinal categories | Notes |
|---|---|---|
| en, de | one, other | 0 is `other`; en ordinal: one two few other |
| fr | one, many, other | 0 and 1 are `one`; `many` is for millions ("1 000 000 de tâches") |
| ru | one, few, many, other | 0 is `many`; 21 is `one` |
| pl | one, few, many, other | 22 is `few`, 25 `many` |
| ar | zero, one, two, few, many, other | 0 zero, 1 one, 2 two, 3-10 few, 11-99 many, 100-102 other |
| he | one, two, other | |
| fa | one, other | **0 and 1** are `one` |
| ja | other | one form for every count |

- Use an ICU plural whenever a number is followed by a counted noun (L6 catches `{n, number} tasks`
  in the source language whenever it has more than one plural form and spaces between words, so
  `{n, number} Aufgaben` in a German source too; a styled number such as a percent is not a count). Never branch on "is it
  1?" in code: `check-i18n-code.mjs` rule `count-branch` fails `openCount === 1 ? t('…') : t('…')` and
  `items.length > 1 ? 'tasks' : 'task'` (checkers reference, "Heuristic limits", for what it reads as a
  count).
- **Every category of the language is required** (L5), and no category the language lacks. One
  relaxation: a category that holds only a few fixed numbers may be left out when `=N` branches
  cover all of them (Arabic `zero` is exactly 0, so `=0` stands in for it; Persian `one` is 0 and
  1, so it needs both `=0` and `=1`).
- `selectordinal` is checked against the ordinal categories the same way.
- Exact matches (`=0`) must appear in **every** language (P4): Persian puts 0 in `one`, so an
  English-only `=0` would print the Persian `one` form for zero.
- No `offset:` (it confuses translators and changes what `#` prints); give the other count its
  own placeholder.
- Durations are whole messages with plurals, never `"2" + " h"`.

Verified outputs of the template catalogs (each line is an assertion in `create-t.test.ts`, run
under the forced polyfills):

| Language | Message | Values | Output |
|---|---|---|---|
| en | `{openCount, plural, =0 {No open tasks} one {# open task} other {# open tasks}}` | 0 / 1 / 2 | `No open tasks` / `1 open task` / `2 open tasks` |
| ar | `{openCount, plural, =0 {…} one {مهمة مفتوحة واحدة} two {مهمتان مفتوحتان} few {# مهام مفتوحة} many {# مهمة مفتوحة} other {# مهمة مفتوحة}}` | 2 / 3 / 11 / 100 | `مهمتان مفتوحتان` / `٣ مهام مفتوحة` / `١١ مهمة مفتوحة` / `١٠٠ مهمة مفتوحة` |
| ar, Latin digits | `الصفحة {page, number}` | 12 | `الصفحة 12` |
| ar | `تم إنجاز {doneRate, number, ::percent}` | 0.42 | `تم إنجاز ٤٢٪` followed by U+061C (CLDR's percent pattern) |

Which digits appear is decided by the locale tag (`ar-u-nu-arab`, `ar-u-nu-latn`), never by the
catalog (runtime reference, "The locale tag").

## Free text and bidi isolation

- `t()` wraps every `*Name` / `*Text` value in U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL
  ISOLATE, so a Latin list name inside an Arabic sentence cannot reorder it:
  `t('tasks.moved', { listName: 'Groceries' })` in ar gives `تم النقل إلى (FSI)Groceries(PDI)`.
- Numbers and select keys are never isolated (a select would stop matching).
- Catalogs never contain bidi controls themselves (U+202A-U+202E, U+2066-U+2069) or the Arabic
  Letter Mark U+061C (L8); the formatter adds what it needs.
- Tests compare with `FSI`/`PDI` in the expected string, or strip them with `stripIsolates()`.
- **Never isolate twice.** A text that already went through `t()` with a `*Name`/`*Text` value
  carries isolates inside it: every date from `formatDayMonth()` and `formatWeekdayDayMonth()` (the
  month name is a `monthName` value), and any `t()` result built with a name or text value. Passed
  straight into another message as a `*Text` value, `t()` wraps it again, and the nested FSI…PDI
  leave the outer isolate without a strong letter of its own, so iOS (CoreText) can run it left to
  right inside a right-to-left sentence (seen on iOS 26.5 with a Persian date; Android not
  verified). Strip the inner isolates first, a date being one run of its language:
  `t('reminders.next', { dateText: stripIsolates(formatDayMonth(date, t)) })`.
  `check-i18n-code.mjs` rule `nested-isolates` fails a formatter result (the contract's
  `isolatedFormatters`) or a `t()` call with a name or text value that goes straight into `t()`
  unstripped; `format-date.test.ts` shows both strings.

## System dialog texts

Some texts are shown by the operating system, not by the app:

- **iOS permission purpose strings** (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSUserTrackingUsageDescription`, …), printed under the system dialog's title, and the app name
  under the icon (`CFBundleDisplayName`).
- **The Android app name** (`app_name` in `strings.xml`). Android has no purpose strings: the
  rationale before a permission request is the app's own screen, translated like any other text.

Rules:

- **Key:** `<area>.<topic>.usage-description` for purpose strings (`permissions.camera.usage-description`),
  `app.name` for the name. The last segment marks a system text for the checkers.
  permissions-and-system-prompts adds the in-app texts around each dialog under the same area:
  `permissions.<kind>.explain.{title,body}`, `permissions.<kind>.settings.{title,body}`, and the shared
  `permissions.continue`, `permissions.not-now`, `permissions.open-settings`, `permissions.close`
  (ordinary ICU messages, not system texts).
- **Plain text only** (L13): no `{argument}`, plural, select or brace in any language. Nothing
  formats ICU on the way to the dialog, so a placeholder shows as braces; iOS already names the app
  in the dialog title. One or two whole sentences, the same script rules as any text.
- **How it reaches the platform:** app.config.ts sets `locales` from the catalogs with
  `nativeLocales(projectRoot, { displayName: 'app.name', usageDescriptions: { NSCameraUsageDescription: 'permissions.camera.usage-description' } }, { variantName })`
  (`scripts/i18n/native-locales.ts`), plus `ios.infoPlist.CFBundleAllowMixedLocalizations: true`
  (the `withI18n` wrapper in the runtime reference, "Declaring the languages"). `variantName` keeps
  the development and preview label (`المهام (Dev)`); without it every build shows the store name
  on every phone whose language the app declares.
  Prebuild (EAS Build runs it too) writes one `InfoPlist.strings` per language on iOS and one
  `values-b+<lang>/strings.xml` on Android (Expo's documented `locales` field; its values may be
  objects, verified in `@expo/config-types` 57).
- **The base value** in Info.plist is what the config plugin that requests the permission writes:
  pass it the catalog's source text, `cameraPermission: sourceText(projectRoot, 'permissions.camera.usage-description')`,
  never a literal (the plugin's own default, `Allow $(PRODUCT_NAME) to access your camera`, is not a
  purpose a reviewer accepts).
- `check-i18n-code.mjs` enforces it: `system-text-literal` fails a literal `NS…UsageDescription`
  value or a literal `*Permission` / `*UsageDescription` plugin option anywhere in app.config (even
  before the catalogs hold any `*.usage-description` key); `system-text-locales` fails an app config
  without `locales` while the catalogs hold such keys, an app config that repeats a catalog text (a
  second copy drifts), and a purpose key the config sets (directly, or through a known plugin
  option) that `NATIVE_TEXT_KEYS.usageDescriptions` does not list, so every other language would
  show the base text. `system-text-literal` also fails a permission plugin left to write its own
  English default (runtime reference, "Base texts of config plugins").
- iOS shows these texts in the language of the phone (or of the app's language in iOS Settings),
  not the in-app choice; the same holds for Android system dialogs and the store purchase sheets.

## Untranslated keys

Some screens exist only for developers or testers (a debug menu compiled out of store builds). Their
texts may stay in the source language in every catalog, declared in `contracts/i18n.json`:

```json
{ "untranslatedPrefixes": ["debug."] }
```

- Every key under such a prefix holds exactly the source text in every language (P5); a translated
  one fails, so the review queue never receives developer texts.
- The script rules (L9, L10) skip those keys, since their text is the source language's.
- Numbers and dates inside them still follow the language: the screen formats its values with the
  language's formatters, never `String(n)`.
- Default: no prefix, every key is translated.

## Dates and month names

The library default (rule 10): dates and times are formatted **at the edge**, in `src/i18n/`, on
the **forced** FormatJS polyfills, with an **explicit calendar**, an **explicit time zone** and the
locale tag's digits. Screens never format `Date` objects. Two ways meet that default:

- **Catalog names (the template, `src/i18n/format-date.ts`).** Every day-month label comes from
  literal key tables: `formatDayMonth(dateKey, t)` (`date.day-month`), `formatWeekdayDayMonth`
  (`date.weekday-day-month`), `formatMonthShort` (`date.month-short.1..12`) and `formatWeekdayName`
  (`date.weekday.1..7`, ISO weekday from `src/core/dates/date-key.ts`, 1 = Monday). The calendar is
  Gregorian by construction, the day is a typed number (so the digits follow the locale tag), and it
  needs no extra polyfill. That is why the template ships it: the DateTimeFormat polyfill with data
  for two languages and the common time zones weighs about 1.2 MB raw (about 190 KB gzip) at startup.
  2026-09-26 -> `26 Sep` (en) / `٢٦ سبتمبر` (ar with Arabic-Indic digits).
- **`Intl.DateTimeFormat` in `src/i18n/`** when catalogs cannot express it: a time of day, many
  date shapes. Add `@formatjs/intl-datetimeformat` (forced, one locale-data file per language, one
  time-zone file) to the polyfills; `check-i18n-code.mjs` rule `intl-api` requires that block once a
  file in `src/i18n/` uses `Intl.DateTimeFormat`, and `polyfill-locales` fails a partial one. Pass
  `calendar: 'gregory'` (or the product's calendar) and `timeZone` every time: the forced polyfill
  defaults to UTC and silently falls back to Gregorian for a calendar its data lacks. The full shape,
  test and verified outputs are in `examples/intl-date-time.md`.

**Relative times** ("3 days ago", "yesterday") are not a DateTimeFormat job, and the DateTimeFormat
polyfill does not provide `Intl.RelativeTimeFormat` (Hermes has none: `not a constructor` on the
phone). Write them as a catalog plural with every CLDR category of each language, the count computed
from date keys in code:

```json
"tasks.row.done-ago": "{daysCount, plural, =0 {Done today} =1 {Done yesterday} one {Done # day ago} other {Done # days ago}}"
```

Only when every unit from seconds to years is needed does `Intl.RelativeTimeFormat` earn its
forced `@formatjs/intl-relativetimeformat` block in `src/i18n/` (runtime reference, "The other Intl
APIs Hermes lacks"); `intl-api` fails it anywhere else, or without that block.

Month and weekday names in catalogs are copied from CLDR, never invented. Print them once (tooling,
so `Intl.DateTimeFormat` is fine here) for each language; use `fa-u-ca-gregory` for Gregorian months
in Persian:

```sh
node -e "const f=new Intl.DateTimeFormat(process.argv[1],{day:'numeric',month:'short',timeZone:'UTC'}); for (let m=1;m<=12;m++) console.log(f.formatToParts(new Date(Date.UTC(2026,m-1,15))).find((p)=>p.type==='month').value)" de
```

- German needs the format-context abbreviations (`Jan.` … `Sept.` … `Dez.`), which the command
  above prints; a bare `{ month: 'short' }` gives the stand-alone forms.
- **The calendar caveat.** Native Hermes formats with the device's calendar on iOS (verified: `fa`
  dates came out in the Solar Hijri calendar, 2026-09-26, iOS 26.5) and ignores the numbering
  system. That is why `Intl.DateTimeFormat` never runs unpolyfilled and never outside `src/i18n/`
  (`check-i18n-code.mjs` rule `date-format-api` keeps every other file away from it, and from
  `toLocale*String`). The FormatJS polyfill formats the Gregorian calendar only: with `fa` data,
  `calendar: 'persian'` resolved to `gregory` (7.8.0, verified 2026-10-03). A product that wants
  Solar Hijri dates converts the date itself (a Jalali conversion in `src/core/dates/`) and prints it
  with catalog month names, the catalog way above.

## Script rules for translators

- Keep every plural category in every language even when two forms are the same word (Persian
  nouns after a number stay singular: `۳ کار باز`).
- No literal digits anywhere, in any script (`Page 12` is `Page {page, number}`; L7 also catches
  `١٢` and `۱۲`).
- **Arabic-script languages** (ar, fa, ckb, ur, ps, …, found from CLDR likely subtags) use `،` `؛`
  `؟`, never Latin `,` `;` `?` (L10).
- **Persian, Dari, Sorani and Urdu** write ی (U+06CC) and ک (U+06A9), never Arabic ي (U+064A) or
  ك (U+0643) (L9). Arabic itself writes ي and ك; Pashto uses both yeh forms, so it is not in the
  list.
- One whole sentence per key: no leading or trailing spaces or joiners (`, ; : + & / – -`), no double
  spaces, the source language starts with a capital (for scripts with case). Never glue two keys.

## The catalog rules

`scripts/check-catalogs.mjs` and the project linter (`npm run i18n:verify`, templates in
`templates/scripts/i18n/`) print the same rule ids, names and messages, each at `<file>:<line>`, for
L1-L13, P4, P5 and F1. P1-P3 are the checker's; in `npm run i18n:verify` FormatJS's structural check
reports the same problems in its own words (next section).

| Id | Rule | Applies to | Message (start) |
|---|---|---|---|
| L1 | Key shape: 2-5 lowercase kebab segments | all | `key must be 2-5 dot-separated kebab-case segments` |
| L1b | Package keys start with the folder's `keyPrefix`; app keys never use one | multi-package | `keys of this catalog start with "billing."` |
| L2 | Parses as ICU with an `other` clause required | all | `ICU syntax error: …` |
| L3 | No `{x, date}`, `{x, time}` or rich-text tags | all | `no {x, date}/{x, time}: format dates in src/i18n/format-date.ts` |
| L4 | camelCase placeholders; plain `{x}` only for `*Name`/`*Text`; those names never for numbers | all | `{page} is plain text: …` |
| L5 | Plurals carry exactly the language's CLDR categories (cardinal or ordinal); no `offset` | all | `plural category "few" does not exist in en` / `{n} lacks the ar cardinal categories …` |
| L6 | A plain `{x, number}` followed by a word must be a plural | the source language, when it has more than one plural form and spaces between words (en, de, es, ar, ru, hi; not ja, zh, th, ko, vi) | `{tasksCount, number} is followed by a word: …` |
| L7 | No literal digits in any script | all | `literal digits: numbers must be placeholders` |
| L8 | No bidi controls or ALM | all | `bidi controls/ALM in catalog: t() isolates values` |
| L9 | No Arabic ي/ك | fa, prs, ckb, ur (not untranslated keys) | `Arabic ي/ك: use ی/ک` |
| L10 | No Latin `,` `;` `?` | Arabic-script languages (not untranslated keys) | `Latin , ; ? in Arabic-script text: use ، ؛ ؟` |
| L11 | Whole sentence: not empty, no edge space/joiner, no double space, source not lowercase, not a bare placeholder | all | `starts/ends with space or joiner: …` |
| L12 | Keys sorted | all | `keys are not sorted (first out of place: …)` |
| L13 | `*.usage-description` is plain text | all | `is a system dialog text (InfoPlist.strings) but holds an ICU argument or brace` |
| P1 | Every source key exists in every language | translations | `<key>: missing in ar (present in en)` |
| P2 | No key the source lacks | translations | `<key>: not in en.json` |
| P3 | Same placeholders with the same types | translations | `placeholders differ from en: …` |
| P4 | Same `=N` branches | translations | `plural {n} has exact branches […] but en has […]` |
| P5 | Untranslated keys equal the source text | translations | `keeps the source text in every language (untranslatedPrefixes), but …` |
| F1 | One flat JSON object of strings per language and folder, named `<tag>.json` exactly as `LANGUAGES` spells the tag, every tag in BCP 47 canonical casing; no `<lang>.json` for a language outside `LANGUAGES` | all | `ar.json is missing` / `value is not a string` / `fr.json is not in LANGUAGES` / `"pt-br" in LANGUAGES is not in BCP 47 canonical casing` / `the catalog is named pt-br.json, but LANGUAGES spells the tag pt-BR` |

## What FormatJS verify does and does not catch

`formatjs verify --source-locale en --missing-keys --extra-keys --structural-equality`
(`@formatjs/cli` 6.16.32, verified on 2026-09-26) fails on a missing or extra key, a different set of
variables, and a variable whose type differs (`Variable page has conflicting types: number vs
argument`). It does **not** require each language's plural categories (a Persian message with only
`other` passed), which is why L5 and P4 exist. The FormatJS ESLint content rules
(`enforce-placeholders`, `enforce-plural-rules`, …) skip id-only calls, so with JSON-first catalogs
they check nothing; the canonical ESLint config uses only `formatjs/no-literal-string-in-jsx`.

## When multi-package: key prefixes

A monorepo package that owns texts keeps its own catalog folder with a key prefix, declared in
`contracts/i18n.json`:

```json
{ "catalogs": [{ "dir": "packages/billing/src/i18n", "keyPrefix": "billing", "sourceDir": "packages/billing/src" }] }
```

- Every key of that folder starts with `billing.`; no app key does (L1b, both directions), so keys
  never collide when the app merges the catalogs. The prefix is the package's folder name
  (`packages/billing` -> `billing`); naming-conventions' `i18n-key-namespace` checks that pairing.
- The folder has one file per language in `LANGUAGES` (F1) and passes every other rule.
- The package cannot import the app's `MessageKey`, so it hands its texts over as plain literal ids
  (`{ id: 'billing.plan.monthly' }`); `check-i18n-code.mjs` looks every `billing.` literal in
  `sourceDir` up in the package catalog (`unknown-key`), and only `src/i18n/messages.ts` brands those
  ids (`asMessageKey`, the one allowed cast).
