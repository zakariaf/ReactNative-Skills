# Schemas and messages

How a form's one valibot schema is written, what the resolver does with it, and how its messages
reach the screen in the user's language. Versions verified on 2026-10-10 in the reference app
(valibot 1.5.0, react-hook-form 7.89.0, @hookform/resolvers 5.9.1; re-verify with
`node -p "require('valibot/package.json').version"` and the same for the other two).

## Contents

- Why one schema, and why valibot
- What valibotResolver does (read in its source)
- Input and output types
- Writing the schema: the house shape
- Messages are catalog keys
- The message argument of each action
- From error to text: fieldMessageKey
- Digits in any script
- Hermes and Intl.Segmenter
- Duplicates, cross-field rules and other fields' values
- Date fields
- Numbers, money and units
- Decisions and the alternatives turned down

## Why one schema, and why valibot

A form has three things that must agree: the TypeScript type of the draft, the runtime check, and
the messages. Written separately they drift: a field is checked for 200 characters while the type
says nothing and the database allows 120. One valibot schema gives all three: `v.InferInput` types
the fields, `v.InferOutput` types what a valid submit hands on, the pipe is the check, and each
action carries its message key. valibot is the house validator (the stack table): the same library
checks API responses (networking-and-server-state) and stored data (persistence-and-migrations), so
a developer learns one API, and its tree-shakable functions keep the bundle small.

## What valibotResolver does (read in its source)

`@hookform/resolvers/valibot/src/valibot.ts` (5.9.1), read on 2026-10-10:

- It calls `safeParseAsync(schema, values, { abortPipeEarly: true })` on **every validation**: the
  whole form object, not one field. With `mode: 'onTouched'` that is every blur of an untouched
  field and every change of a touched one. Anything slow or remote in the schema therefore runs
  once per keystroke (rule 3, `schema-async`).
- `abortPipeEarly` is true unless `criteriaMode: 'all'`: a field reports only the first failing
  action of its pipe. Order the pipe from the most basic problem to the most specific (required
  before length before duplicate) so the first message is the useful one.
- Each issue becomes `{ message: issue.message, type: issue.type }` at the issue's dot path
  (`errors.title.message`). The message is whatever the action carried: in this library a catalog
  key.
- On success the resolver hands react-hook-form `result.output` (the transformed value: trimmed
  text, numbers) unless `raw: true`. That is why `handleSubmit`'s callback receives `TaskDraft`, not
  the raw strings.
- The default `mode: 'async'` is right even for a synchronous schema: `safeParseAsync` runs a sync
  schema fine; `mode: 'sync'` would throw on an async action instead of reporting it.

## Input and output types

```ts
const form = useForm<TaskEditorInput, unknown, TaskDraft>({
  resolver: valibotResolver(taskEditorSchema(deps.openTitles)),
  mode: 'onTouched',
  defaultValues: EMPTY_TASK_EDITOR,
});
```

- `TaskEditorInput = v.InferInput<TaskEditorSchema>`: what the fields hold. A `TextInput` holds
  text, so every text field's input type is `string`, also for a number (`estimateMinutes: string`).
- `TaskDraft = v.InferOutput<TaskEditorSchema>`: what the save receives (`estimateMinutes: number |
  null`). The third type argument of `useForm` makes `handleSubmit` pass it.
- `defaultValues` gives every field a string (`''`), never `undefined`: `useTextField` hands
  `field.value` to a `TextInput` typed `string`, and `reset(EMPTY_...)` must return every field to a
  known value.
- Export the types from the schema file; the model and the tests import them, never redeclare them.

## Writing the schema: the house shape

`templates/src/features/task-editor/task-editor-schema.ts` is the pattern:

```ts
title: v.pipe(
  v.string(),
  v.trim(),                                             // transform first: '   ' is empty
  v.nonEmpty('task-editor.title.required'),
  v.maxLength(TASK_TITLE_MAX, 'task-editor.title.too-long'),
  v.check((title) => !taken.has(titleKeyOf(title)), 'task-editor.title.duplicate'),
),
```

- **Transform, then check.** `v.trim()` before `v.nonEmpty` so a title of spaces is refused, and
  the trimmed value is what the save receives.
- **Bounds come from storage.** `TASK_TITLE_MAX` is the data layer's limit; the field passes the same
  number as `maxLength`, so typing stops where the save would refuse. A bound the database does not
  share is a product decision: write it down next to the constant.
- **One file per form**, `src/features/<feature>/<form>-schema.ts`, pure (valibot and `src/core`
  only), tested without providers.
- **A factory when the schema needs data** (`taskEditorSchema(openTitles)`): the model builds it with
  the current list. React Compiler memoizes the call by its inputs; never put the schema in state.
- **No `v.optional` on a text field.** An empty field is `''`, not missing: say what empty means with
  a transform (`'' → null` for an optional number) or let `v.nonEmpty` refuse it.

## Messages are catalog keys

Every validation action gets a message, and the message is a key of the source catalog
(`src/i18n/catalogs/<SOURCE_LANGUAGE>.json`), written as a literal:

```ts
v.nonEmpty('task-editor.title.required')            // yes
v.nonEmpty()                                         // no: "Invalid length: Expected !0 but received 0"
v.nonEmpty(t('task-editor.title.required'))          // no: built once, language changes, key hidden
v.nonEmpty(`${prefix}.required`)                     // no: no checker or reviewer can see the key
```

- Key shape: `<feature>.<field>.<problem>` (`task-editor.estimate.out-of-range`); generic texts the
  field kit uses live under `forms.*` (`forms.field.invalid`, `forms.check.checking`,
  `forms.check.pending`, `forms.check.unavailable`, `forms.submit.fix-fields`, `forms.keyboard.done`). Key naming and the
  catalog rules are i18n-strings-and-catalogs'.
- A message names the problem and the way out, in the user's words: "Give the task a title", not
  "Title is required"; "This estimate is outside the allowed range", not "Invalid". Numbers in a
  message come from ICU arguments in the catalog, not from the schema.
- The schema test collects every message the schema can produce and asserts each one is a key in
  every catalog (`task-editor-schema.test.ts`, last test). check-forms' `schema-message-key` proves
  the same statically against the source catalog.
- A key that is not literal in the schema file can still be a string constant in the same file
  (`const REQUIRED = 'task-editor.title.required'`); the checker follows that one step.

## The message argument of each action

check-forms reads the message at the position valibot 1.5.0 declares it (`index.d.mts`):

| Position | Actions |
| --- | --- |
| first argument | `nonEmpty`, `email`, `rfcEmail`, `url`, `integer`, `safeInteger`, `finite`, `digits`, `decimal`, `hexadecimal`, `octal`, `uuid`, `ulid`, `nanoid`, `cuid2`, `isoDate`, `isoDateTime`, `isoTime`, `isoTimestamp`, `isoWeek`, `creditCard`, `bic`, `imei`, `isbn`, `emoji`, `empty`, `slug`, `ip`, `mac`, `base64`, ... |
| second argument | `minLength`, `maxLength`, `length`, `notLength`, `minValue`, `maxValue`, `value`, `notValue`, `values`, `gtValue`, `ltValue`, `multipleOf`, `regex`, `startsWith`, `endsWith`, `includes`, `excludes`, `check`, `checkItems`, `someItem`, `everyItem`, `minBytes`, `maxBytes`, `minSize`, `maxSize`, `minEntries`, `maxEntries`, `hash`, `mimeType`, the graphemes actions |
| third argument | `partialCheck` (paths, requirement, message), `minWords`, `maxWords`, `words`, `notWords` (locales, requirement, message) |

Transformations (`trim`, `transform`, `toNumber`, `toLowerCase`) and schema constructors
(`v.string()`, `v.object()`) are not listed: a text field always delivers a string, so a type issue
cannot reach the user.

## From error to text: fieldMessageKey

`src/hooks/field-message-key.ts` turns `fieldState.error` into a key: the message when it is a key
of the source catalog (`Object.hasOwn`, so `'toString'` is not one), `forms.field.invalid` for
anything else (an action someone left without a message, prose from a `setError`), `null` for no
error. `useTextField` translates the key with `t()`. The screen therefore shows either the right
message in the user's language or the generic one, never English and never a raw key. This is the
form side of error-handling-typed-results' `ui-error-message` rule, which fails a screen that shows
`fieldState.error.message` as it is.

## Digits in any script

An Arabic keyboard types ٠١٢٣٤٥٦٧٨٩ (U+0660 to U+0669), a Persian one ۰۱۲۳۴۵۶۷۸۹ (U+06F0 to
U+06F9), a Hindi one ०१२३४५६७८९; the iOS number and decimal pads follow the keyboard language, and
Android's do on many keyboards. `/^\d+$/` (ASCII digits only) and `Number('٣٠')` (`NaN`) refuse all of
them. `toLatinDigits` (`src/core/text/latin-digits.ts`) maps every decimal digit run a phone keyboard
types to ASCII and the Arabic decimal separator `٫` to `.` (the thousands mark `٬` is dropped), so:

```ts
estimateMinutes: v.pipe(
  v.string(),
  v.transform(toLatinDigits),            // first
  v.trim(),
  v.check((text) => text === '' || WHOLE_NUMBER.test(text), 'task-editor.estimate.not-a-number'),
  v.transform((text) => (text === '' ? null : Number(text))),
  v.check((minutes) => minutes === null || (minutes >= 1 && minutes <= ESTIMATE_MAX_MINUTES), 'task-editor.estimate.out-of-range'),
),
```

The field keeps showing what the user typed; only the parsed value is ASCII. Showing numbers in the
user's digits is rtl-and-direction's and i18n-strings-and-catalogs' job (the formatters).

**Decimal, money and quantity fields** need more than digits: the locale's decimal and group
symbols (`de` types `1.234,5`, `ar` types `١٢٫٥`). value-objects-money-and-units owns that step:
its `normalizeDecimalInput(text, localeTag)` (`src/i18n/normalize-decimal-input.ts`) maps the
locale's digits, decimal and group symbols to canonical ASCII decimal text for its parsers
(`parseMoney`, `quantityFromDecimal`). Do not rebuild it in the form. It returns a
`Result<string, DecimalInputFailure>`, not a string, so the schema unwraps it in a `rawTransform`
and turns each failure kind into its own message (an ambiguous `1,234` in English asks for the
number without the group mark; it is never read as "not a number"). The schema factory takes the
app's current locale tag (type-checked, linted and run in a Jest test with valibot 1.5.0 and the owner skill's normalizer on
2026-10-10: `١٢٫٥` in `ar-u-nu-arab` gives `12.5`, `1,234` in `en` gives the ambiguous-separator key):

```ts
import * as v from 'valibot';

import { toLatinDigits } from '@/core/text/latin-digits';
import { normalizeDecimalInput } from '@/i18n/normalize-decimal-input';

import type { MessageKey } from '@/i18n/messages';
import type { DecimalInputFailure } from '@/i18n/normalize-decimal-input';

const DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;
const DECIMAL_KEY_OF = {
  'ambiguous-separator': 'order.amount.ambiguous-separator',
  'misplaced-separator': 'order.amount.misplaced-separator',
} as const satisfies Record<DecimalInputFailure['kind'], MessageKey>;

function buildAmountSchema(localeTag: string) {
  return v.pipe(
    v.string(),
    v.transform(toLatinDigits), // keyboards whose digits are not the locale's
    v.trim(),
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
      if (dataset.value === '') return ''; // empty: a required check (or null) decides
      const normalized = normalizeDecimalInput(dataset.value, localeTag);
      if (normalized.ok) return normalized.value;
      addIssue({ message: DECIMAL_KEY_OF[normalized.error.kind] });
      return NEVER;
    }),
    v.check((text) => text === '' || DECIMAL_TEXT.test(text), 'order.amount.not-a-number'),
  );
}

export type AmountSchema = ReturnType<typeof buildAmountSchema>;

/** The amount field's schema for the app's current locale (useLocaleTag()). */
export function amountSchema(localeTag: string): AmountSchema {
  return buildAmountSchema(localeTag);
}
```

The normalizer maps the locale's symbols and leaves other characters alone, so the last check
still refuses letters. Then `parseMoney(text, currency)` (value-objects-money-and-units) turns the
canonical text into minor units, in the model or in one more `rawTransform` with its own failure
kinds. `toLatinDigits` first is cheap insurance: a Persian keyboard under an Arabic interface types digits
the locale table does not list. check-forms' `latin-digits` accepts either normalizer
(`forms.digitNormalizers`); the field is a `TextField` of kind `decimal`, never a raw `TextInput`
with `keyboardType="decimal-pad"` (`raw-text-input`, `pad-done-bar`).

## Hermes and Intl.Segmenter

valibot's `graphemes`, `minGraphemes`, `maxGraphemes`, `notGraphemes` and the `words` family call
`new Intl.Segmenter()` (valibot 1.5.0 `dist/index.mjs`, `_getGraphemeCount` and `_getWordCount`).
Hermes has no `Intl.Segmenter`: on the phone the action throws "not a constructor" the first time it
runs, while Jest on Node (full ICU) passes. Bound text with `maxLength` (UTF-16 code units, the same
unit the `TextInput` `maxLength` prop counts), or force `@formatjs/intl-segmenter` in
`src/i18n/intl-polyfills.ts` (i18n-strings-and-catalogs owns that file; the polyfill adds about
139 KB). check-forms' `schema-segmenter` fails the action until the polyfill is there.

## Duplicates, cross-field rules and other fields' values

- **A duplicate check against local data is synchronous**: feed the current titles to the schema
  factory and check with `v.check` on a normalised key (`titleKeyOf`: trimmed, spaces collapsed,
  `toLocaleLowerCase()`). The check is then instant and runs with every validation, which is right.
- **A rule across two fields** (end after start, password confirmation) is `v.forward(v.partialCheck(
  [['start'], ['end']], (input) => input.end > input.start, 'reminder.end.before-start'), ['end'])`
  after the object: `partialCheck` runs only when both paths are valid, `forward` puts the message on
  the field the user must change.
- **Revalidate a dependent field** after its partner changes: `form.trigger('end')` in the partner's
  change handler, only when `end` was already touched (`getFieldState('end').isTouched`).
- **An answer that lives elsewhere** (a server, another user's data) is not a schema check: see
  async-checks-and-server-errors.md.

## Date fields

A date field that holds a calendar day keeps a `DateKey` string (`'2026-10-03'`) in the form, never a
`Date`. The picker takes and returns a `Date`, so the field converts at the edge with
dates-streaks-and-statistics' helpers in `src/services/clock/local-date.ts`: seed the picker with
`localNoonOfDateKey(key)` and read the choice back with `dateKeyOfLocalDate(date)`. Seeding with
`new Date(key)` parses UTC midnight and opens the previous day everywhere west of UTC. The schema
checks the key with `isDateKey` and compares keys as strings.

## Numbers, money and units

Money is never a JavaScript float in a form: the schema normalizes the typed text with
`normalizeDecimalInput` (above), then turns it into minor units (an integer of cents) with the
currency's digits through value-objects-money-and-units' parser, and a unit field (minutes,
kilometres) names its unit in the label ("Estimate in minutes"). That skill owns the money and unit
types and the normalizer; the form's job is the field (`TextField` with the `decimal` kind and a
Done bar), the schema's message keys, and handing the text to those functions.

## Decisions and the alternatives turned down

| Decision | Why | Turned down |
| --- | --- | --- |
| Catalog keys as messages, translated at the field | one language switch updates every visible error; keys are checkable | `v.setGlobalMessage` per language (global mutable state, the schema text changes under a mounted form, still English for an action without a message); messages built with `t()` in the schema |
| Synchronous schema; async checks in a hook | the resolver parses everything per validation | `v.checkAsync` in the schema; `validate` functions on fields |
| `abortPipeEarly` (the default) | one clear message per field | `criteriaMode: 'all'` (several messages per field, longer live-region speech) |
| A schema factory for local data | instant, testable, no effect | a `useEffect` that calls `setError` after each change |
| `maxLength` for bounds | Hermes-safe, matches the input's own `maxLength` | graphemes actions (need the Segmenter polyfill) |
