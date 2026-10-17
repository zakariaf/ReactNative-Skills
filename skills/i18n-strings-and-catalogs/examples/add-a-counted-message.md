# Worked example: a counted message in four languages

Task: the Tasks screen shows one summary line, "3 tasks due today, 1 overdue". The catalogs have no
such text, so it is written here in English (the source), German, Persian and Arabic, used from the
model hook, tested through the real catalogs, and checked. The app in this example ships
`LANGUAGES = ['en', 'de', 'fa', 'ar']`; the outputs below were produced by `check-catalogs.mjs` and
react-intl 12.1.3 under the forced polyfills.

## 1. Look for an existing key

`tasks.summary.open` ("{openCount, plural, …}") counts open tasks, not due and overdue ones, and two
counts in one sentence are not two keys glued together. A new key is needed.

## 2. Name the key

Place, then role: `tasks.summary.due` (3 segments, kebab-case, under the `tasks` area).

## 3. Print each language's plural categories

```sh
node -e "for (const l of ['en','de','fa','ar']) console.log(l, new Intl.PluralRules(l).resolvedOptions().pluralCategories.join(' '))"
# en one other
# de one other
# fa one other          (0 and 1 are "one")
# ar zero one two few many other
```

## 4. Write the four languages

One plural per count, each with its language's categories. `=0` on `overdueCount` must then exist in
every language (Persian would otherwise print its `one` form for zero); in Arabic that `=0` also
stands in for the `zero` category of `overdueCount`, while `dueCount` keeps its own `zero` branch.

```json
// src/i18n/catalogs/en.json
"tasks.summary.due": "{dueCount, plural, one {# task} other {# tasks}} due today, {overdueCount, plural, =0 {none overdue} one {# overdue} other {# overdue}}",
// de.json
"tasks.summary.due": "{dueCount, plural, one {# Aufgabe} other {# Aufgaben}} heute fällig, {overdueCount, plural, =0 {keine überfällig} one {# überfällig} other {# überfällig}}",
// fa.json
"tasks.summary.due": "{dueCount, plural, one {# کار} other {# کار}} برای امروز، {overdueCount, plural, =0 {هیچ کاری عقب نیفتاده} one {# کار عقب‌افتاده} other {# کار عقب‌افتاده}}",
// ar.json
"tasks.summary.due": "{dueCount, plural, zero {لا مهام} one {مهمة واحدة} two {مهمتان} few {# مهام} many {# مهمة} other {# مهمة}} لليوم، {overdueCount, plural, =0 {لا شيء متأخر} one {واحدة متأخرة} two {اثنتان متأخرتان} few {# متأخرة} many {# متأخرة} other {# متأخرة}}",
```

(The `//` lines only label the files here; JSON has no comments.) Persian keeps the noun singular
after a number in both forms; the Persian and Arabic texts use their own comma `،`. The fa and ar
texts are drafts: they go on the review queue (step 7).

What the checker rejects, and why:

| Wrong | Rule |
|---|---|
| `"{dueCount, number} tasks due today, …"` | L6: a plain number followed by a word must be a plural |
| `"{dueCount} tasks …"` | L4: a plain `{x}` prints Latin digits in every language |
| `"3 tasks due today"` | L7: literal digits |
| ar with only `one {…} other {…}` | L5: `{dueCount} lacks the ar cardinal categories zero, two, few, many` |
| en with `few {…}` | L5: `plural category "few" does not exist in en` |
| `=0 {none overdue}` in en only | P4: the same `=N` branches in every language |
| the key missing in fa | P1 |
| `"{dueCount, plural, …} due today,"` + `"{overdueCount, plural, …}"` as two keys | L11: one sentence, one key (the first ends in a joiner) |
| fa `کار ها, ...` with a Latin comma | L10: Arabic-script punctuation |

## 5. Use it from the model hook

```ts
// src/features/tasks/use-tasks-model.ts (excerpt)
const t = useT();
const summary = t('tasks.summary.due', { dueCount: due.length, overdueCount: overdue.length });
```

The screen receives `summary` as a string prop and renders it with `AppText`; it never builds text.

## 6. Test it through the real catalogs

```ts
// src/features/tasks/task-summary.test.ts
import { createIntl } from 'react-intl';

import { createT } from '@/i18n/create-t';
import { localeTagFor } from '@/i18n/digits';
import { SOURCE_LANGUAGE } from '@/i18n/languages';
import { messagesFor } from '@/i18n/messages';

import type { TFunction } from '@/i18n/create-t';
import type { Language } from '@/i18n/languages';

function failOnError(error: Error): never {
  throw error;
}

function tFor(language: Language): TFunction {
  const intl = createIntl({
    locale: localeTagFor(language, 'automatic'),
    messages: messagesFor(language),
    defaultLocale: SOURCE_LANGUAGE,
    onError: failOnError,
  });
  return createT({ intl, onError: failOnError });
}

describe('tasks.summary.due', () => {
  it.each([
    { language: 'en', dueCount: 1, overdueCount: 0, text: '1 task due today, none overdue' },
    { language: 'en', dueCount: 3, overdueCount: 1, text: '3 tasks due today, 1 overdue' },
    { language: 'ar', dueCount: 0, overdueCount: 5, text: 'لا مهام لليوم، ٥ متأخرة' },
    { language: 'ar', dueCount: 2, overdueCount: 2, text: 'مهمتان لليوم، اثنتان متأخرتان' },
    { language: 'ar', dueCount: 11, overdueCount: 0, text: '١١ مهمة لليوم، لا شيء متأخر' },
  ] as const)('reads $dueCount due and $overdueCount overdue in $language', (row) => {
    const { language, text, ...values } = row;
    expect(tFor(language)('tasks.summary.due', values)).toBe(text);
  });
});
```

The rows are objects because a test callback takes at most three parameters (`max-params`); the
Arabic rows cover the categories where its grammar changes (0, 2, 11). Add de and fa rows once their
locale data is in `intl-polyfills.ts` (the app above ships them; the shipped templates carry only en
and ar).

## 7. Check, then queue the drafts

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-catalogs.mjs .
node ${CLAUDE_SKILL_DIR}/scripts/check-i18n-code.mjs .
npx jest src/features/tasks --ci
node scripts/i18n/review-sheet.ts
```

All print `RESULT: PASS` / pass, and the review sheet lists `tasks.summary.due` for fa and ar. The
report carries the `REVIEW PENDING (not blocking)` line with one reviewer question per language
("Natural for 2 and for 11?"); nothing waits for the answer.
