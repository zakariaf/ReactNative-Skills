# Checkers, contracts and configuration

Every option the three checkers take, every file they read, and how to point them at a layout that
differs from the canonical single app. All scripts are Node ESM with no dependencies (Node 22.18 or
newer, full ICU: official Node builds have it), take the repo root as an optional positional
argument (default `.`), print `RESULT: PASS` or `RESULT: FAIL (<n> problems)` last, and exit 0 (pass),
1 (problems) or 2 (bad input or nothing to check).

## Contents

- What the checkers read
- check-catalogs.mjs
- check-i18n-code.mjs (and its heuristic limits)
- sync-copy.mjs
- contracts/i18n.json
- contracts/copy-source.json
- rn-skills.config.json keys
- SKIP lines and exit 2
- When multi-package

## What the checkers read

| File | Read by | Why |
|---|---|---|
| `src/i18n/languages.ts` | all three | `LANGUAGES` and `SOURCE_LANGUAGE`, parsed as plain literals (no TypeScript compiler) |
| `src/i18n/catalogs/<lang>.json` | all three | the catalogs |
| `contracts/i18n.json` | all three (optional) | untranslated prefixes, isolated formatters, package catalogs |
| `contracts/copy-source.json` | sync-copy | the approved copy |
| `src/**/*.ts(x)` and package `sourceDir`s | check-i18n-code | the code rules |
| `src/i18n/intl-polyfills.ts`, `package.json` `main`, the entry and `scripts["i18n:verify"]`, `jest.config.*`, `app.config.*` (or `app.json`), `scripts/i18n/app-languages.ts` (`I18N_DIR`) | check-i18n-code | the wiring rules |
| `node_modules/@formatjs/<package>/locale-data/` (the app's, then the repo root's; optional) | check-i18n-code | which locale-data file each language imports (`polyfill-locales`) |
| `tsconfig.json` `paths`, `package.json` `workspaces`, `rn-skills.config.json` | all three (through check-lib's `resolveLayout`) | folder layout and aliases |

Plural categories and scripts come from Node's ICU (`Intl.PluralRules`, `Intl.Locale#maximize`), so
the checkers know every language CLDR knows. A language code Node's ICU has no plural rules for is
bad input (exit 2).

## check-catalogs.mjs

```
node ${CLAUDE_SKILL_DIR}/scripts/check-catalogs.mjs [repo-root] [--app-dir <dir>] [--i18n-dir <dir>] [--languages en,ar] [--contract <file>] [--json]
```

| Option | Default | Use |
|---|---|---|
| `--app-dir` | the repo root | when multi-package: the Expo app's folder (`apps/mobile`); `srcDir`, `i18nDir` and aliases then come from it |
| `--i18n-dir` | `src/i18n` (layout `i18nDir`) | where `languages.ts` and `catalogs/` live |
| `--languages` | `LANGUAGES` in `languages.ts`, source = `SOURCE_LANGUAGE` | a list, source first, when there is no `languages.ts` yet |
| `--contract` | `contracts/i18n.json` | another contract file |

Rules: L1-L13, P1-P5, F1 (catalogs reference, "The catalog rules"). F1 also fails a `<lang>.json`
in a catalog folder for a language `LANGUAGES` does not list (a stale catalog after a language was
removed), a tag in `LANGUAGES` that is not in BCP 47 canonical casing (`pt-br` for `pt-BR`), and a
catalog whose file name differs from the tag only by case (`pt-br.json` for `pt-BR`: the folder is
listed, so the result is the same on a case-insensitive Mac and on Linux). Exit 2 when there is no
language list or no catalog folder at all.

## check-i18n-code.mjs

```
node ${CLAUDE_SKILL_DIR}/scripts/check-i18n-code.mjs [repo-root] [--app-dir <dir>] [--i18n-dir <dir>] [--src <dir>]... [--entry <file>] [--contract <file>] [--json]
```

| Option | Default | Use |
|---|---|---|
| `--app-dir` | the repo root | when multi-package: the folder holding the app's `package.json`, `app.config.*`, `jest.config.*` and `src/` |
| `--src` | `srcDir` plus each contract catalog's `sourceDir` | the folders to scan (repeatable) |
| `--entry` | `main` of the app's `package.json` | the app entry the polyfills must lead (repo-relative) |
| `--i18n-dir`, `--contract` | as above | |

Rules (`--help` describes each):

| Rule | Fails |
|---|---|
| `jsx-literal-text` | text a JSX element renders that is not from `t()`: every text run (also after a `{value}`), a string-literal or built-template child, a ternary or `&&` child with a literal branch |
| `literal-prop-text` | a literal or built string (or literal branch) in a text prop (`title`, `label`, `placeholder`, `alt`, `defaultValue`, `accessibilityLabel`/`Hint`, `aria-label`, `aria-description`, `aria-valuetext`, …, and any custom prop named `*Label`, `*Text`, `*Title`, `*Message`, `*Hint` or `*Placeholder`, such as `emptyText`), `accessibilityValue={{ text }}`, `accessibilityActions` labels, navigation `options` (`title`, `headerTitle`, `tabBarLabel`, a string `tabBarBadge`, …) and `navigation.setOptions({ title })`, `Alert.alert`/`Alert.prompt` titles, messages and button texts, the first argument of `AccessibilityInfo.announceForAccessibility[WithOptions]`, of accessibility-as-code's `announce()` and of `ToastAndroid.show*`, `ActionSheetIOS.showActionSheetWithOptions` `options` (each literal item of the array; `t('common.cancel')`, a spread and nested values pass)/`title`/`message`/`cancelButtonTitle` (and the share sheet's `message`/`subject`), expo-notifications `scheduleNotificationAsync` content `title`/`subtitle`/`body` (and channel and category names), and `Share.share` `title`/`message` (`shareAsync` `dialogTitle`) |
| `count-branch` | a ternary that picks a text by comparing a count to 1 (`=== 1`, `!== 1`, `> 1`, `<= 1`, `>= 2`, `< 2`, either side) when both branches are text (`t()`, `formatMessage`, `<T />` or a string literal): `openCount === 1 ? t('a') : t('b')`, `items.length > 1 ? 'tasks' : 'task'` |
| `dynamic-key`, `unknown-key`, `key-cast` | a built key, a key the catalog lacks (also a catalog key app.config names: a `NATIVE_TEXT_KEYS` value or `sourceText(projectRoot, '<key>')`, which `npx expo config` would throw on), a cast to `MessageKey` |
| `react-intl-import`, `date-format-api` | react-intl, `Intl.DateTimeFormat` or `toLocale*String` outside `src/i18n/` |
| `intl-api` | `Intl.RelativeTimeFormat`, `ListFormat`, `DisplayNames`, `Segmenter` (Hermes has none: `not a constructor` on the phone) or `PluralRules` outside `src/i18n/` (written `Intl.X`, `Intl['X']` or `const { X } = Intl`); inside it, `Intl.DateTimeFormat`, `RelativeTimeFormat`, `ListFormat`, `DisplayNames` or `Segmenter` while `intl-polyfills.ts` lacks that API's forced block (the fix lists the exact imports) |
| `number-format-api` | `Intl.NumberFormat` outside `src/i18n/` with a literal or missing locale (`new Intl.NumberFormat('ar')`); a formatter built from `localeTagFor(...)` passes. Money is stricter and belongs to value-objects-money-and-units: `style: 'currency'` only inside `src/i18n/`, always with the fraction digits taken from the ISO 4217 exponent (CLDR's default digits differ for some codes), and model hooks get the tag from its `useLocaleTag()` |
| `nested-isolates` | an isolated text passed straight into another `t()` value |
| `i18n-runtime` | a missing runtime file in `src/i18n/` |
| `polyfill-locales` | the polyfill imports differ from the list `LANGUAGES` needs: per package, each language's locale-data file is the first of its tag and its truncations (the tag minus its last subtag) the installed package ships (`pt-BR` -> pluralrules `pt.js`); an import of a file the installed package lacks is named as a `Cannot find module` failure, and so is an imported `@formatjs` package missing from an installed repo (the fix names `npm install -E <package>@<version>`); only a repo with no `node_modules` at all accepts the tag or a truncation. An optional block (DateTimeFormat + one time-zone file, RelativeTimeFormat, ListFormat, DisplayNames, Segmenter) is complete or absent |
| `polyfill-first`, `jest-polyfills` | the entry or a Jest `setupFiles` that does not load the polyfills first; a literal setup path (`const INTL_POLYFILLS = '…'`, `'<rootDir>/…'`, an `@/` alias) that names another folder than the i18n folder the checkers read |
| `verify-script` | no `"i18n:verify"` script in the app's `package.json`, or it does not run an existing `verify-catalogs.ts` |
| `tooling-dir` | `scripts/i18n/app-languages.ts` without a literal `export const I18N_DIR`, or one that differs from the i18n folder the checkers read (`rn-skills.config.json` `"i18nDir"`, `--i18n-dir`) |
| `supported-locales` | app.config without the expo-localization plugin, an `['expo-localization', options]` entry without `supportedLocales`, a value that neither comes from `readAppLanguages()` (the call, or a name bound from it such as `const { languages } = readAppLanguages(projectRoot)`, followed through same-file `const` declarations like `const supportedLocales = { ios: [...languages], … }`) nor is literal lists, or a literal list that differs from `LANGUAGES`. A `readAppLanguages()` call elsewhere in the file does not excuse a literal `['en']` |
| `system-text-literal` | a literal `NS…UsageDescription` value or a literal `*Permission` / `*UsageDescription` plugin option in app.config; or a permission plugin that runs (named in the config, or an installed package prebuild applies on its own) and writes its English default for a purpose key the config never sets. Heuristic limit: an option name counts for every plugin that shares it (`cameraPermission` on expo-camera covers expo-image-picker too) |
| `system-text-locales` | catalogs with `*.usage-description` keys but no `locales`, a repeated catalog text, a purpose key the config sets (directly or through a known plugin option) missing from `NATIVE_TEXT_KEYS.usageDescriptions`, or a config that builds variants (`APP_VARIANT`, `resolveAppVariant`, `variantIdentity`) but calls `nativeLocales` without `variantName` |

- Test files (`*.test.ts(x)`, `*.spec.*`, `test/`, `__mocks__/`, `__tests__/`, `testing/` folders)
  may use literal strings and casts; the key rules still apply to them.
- Files under `src/i18n/` may import react-intl and use `Intl.DateTimeFormat`, `RelativeTimeFormat`,
  `ListFormat`, `DisplayNames` and `Segmenter`, each on its forced polyfill block.
- The scan uses check-lib's repo walk: `node_modules`, generated native folders, build output and
  every folder holding a `SKILL.md` (installed skills in `.agents/skills/`, `.claude/skills/`, a
  vendored skill under `src/`) are never read.

### Heuristic limits

The checkers read source text, not a type-checked program, so a few shapes pass them. The type
check, the in-repo tests and review catch these; write the plain form and the checkers see it:

- **Text sinks are listed by name.** A literal reaches the screen through a call or prop the list
  does not name (a wrapper `showToast('Saved')` around `ToastAndroid.show(text)`, a custom component
  prop called `content`) unseen. Name the wrapper's parameter `*Text`/`*Label` so the prop rule sees
  it, or route the call through `t()` at the caller.
- **`count-branch` knows a count by its name**: `count`, `count*` (`countOpen(tasks)`, a call with
  plain arguments counts too), `n`, `total`, `*Count`, `*Total`, `num*`, any `.length` or `.size`,
  compared with 1 (or 2 for `>=`/`<`) in a ternary whose two branches are text.
  `step === 1 ? t('onboarding.first') : t('onboarding.next')` is not a count and passes; a count kept
  in a variable named otherwise (`tasksLeft === 1 ? …`), an `if`/`switch` on the count, or a branch
  stored first in a variable also passes. Rule 5 still holds: a count picks its form in the catalog.
- **`intl-api` sees `Intl.X`, `Intl['X']` and `const { X } = Intl`**, not an alias of `Intl` itself
  (`const I = Intl; new I.ListFormat()`) or a computed name.
- **Keys app.config names** are read from the `NATIVE_TEXT_KEYS` object (or the object passed to
  `nativeLocales`) and from `sourceText(…, '<key>')` with a literal key; a key built at run time is
  checked only when `npx expo config` runs.
- **`supported-locales` follows names inside app.config only**: the plugin options and the
  `supportedLocales` value are followed through `const` declarations in the same file, and a name
  counts as read from `LANGUAGES` when it is bound from `readAppLanguages()` there. A value returned by
  another helper, imported from another file or passed in as a parameter is reported as neither read
  nor literal; bind it from `readAppLanguages(projectRoot)` in app.config (the `withI18n` shape).
- **Action sheet `options` items are read at depth 0**: `['Cancel', 'Delete']` fails, while a literal
  hidden inside a call (`[capitalize('cancel')]`) passes, like any other unlisted wrapper.

## sync-copy.mjs

```
node ${CLAUDE_SKILL_DIR}/scripts/sync-copy.mjs <keys|apply|check> [repo-root] [--screen <id>]... [--prefix <text>]... [--key <key>]... [--all] [--overwrite] [--lang <list|source|all>] [--source <file>] [--app-dir <dir>] [--json]
```

- `keys` prints the selection (exit 0); `apply` writes it into every catalog (keys sorted; a
  different catalog text is `copy-conflict` and kept unless `--overwrite`); `check` compares every
  copy key a catalog holds and requires the selected ones.
- Rules: `copy-drift`, `copy-key-missing`, `retired-key`, `untranslated-prefix`, `copy-conflict`.
- `check` without a copy source (no `contracts/copy-source.json`, no `--source`, no `copySource`
  key) prints `NOT APPLICABLE: contracts/copy-source.json does not exist: …` and exits 0: approved
  copy is opt-in, and the catalogs are then the only texts.
- Exit 2: `keys` or `apply` without a copy source, a copy source the caller names that does not
  exist, a row without every language, an unknown screen or key.

## contracts/i18n.json

Optional; every key has a strict default. Schema: `assets/i18n-contract.schema.json`; template:
`templates/contracts/i18n.json`. Unknown keys are bad input (a misspelt key must not silently do
nothing).

| Key | Default | Meaning |
|---|---|---|
| `untranslatedPrefixes` | `[]` | key prefixes (`"debug."`) whose texts stay the source text in every language (P5); the script rules and the review queue skip them |
| `reviewLanguages` | `[]` | languages whose drafted texts go on the review queue (`scripts/i18n/review-sheet.ts`) |
| `isolatedFormatters` | `["formatDayMonth", "formatWeekdayDayMonth"]` | functions whose result already carries bidi isolates (`nested-isolates`) |
| `catalogs` | `[]` | package catalog folders: `{ "dir", "keyPrefix", "sourceDir"? }` (When multi-package) |

## contracts/copy-source.json

Schema: `assets/copy-source.schema.json`; example: `examples/copy-source.json`.

| Key | Meaning |
|---|---|
| `strings` | `{ "<key>": { "<lang>": "<ICU message>" } }`, every language of `LANGUAGES` in every row |
| `screens` | `{ "<screen id>": ["<key>", ...] }`, what `--screen` selects and where the review sheet says a text shows |
| `retired` | `{ "<key>": "<why>" }`, keys that must leave every catalog |

## rn-skills.config.json keys

The optional repo file check-lib reads for every skill. This skill reads:

| Key | Default | Meaning |
|---|---|---|
| `srcDir` | `src` | the app source folder |
| `i18nDir` | `{srcDir}/i18n` | the i18n folder; the Node tooling reads it from `I18N_DIR` in `scripts/i18n/app-languages.ts`, so change both (rule `tooling-dir`) |
| `workspaces.<dir>.srcDir`, `workspaces.<dir>.i18nDir` | `src`, `{srcDir}/i18n` | the same, relative to a workspace; used with `--app-dir <dir>` |
| `contractsDir` | `contracts` | where `i18n.json` and `copy-source.json` live |
| `copySource` | `{contractsDir}/copy-source.json` | another copy source path |

## SKIP lines and exit 2

A passing run of `check-i18n-code.mjs` may print these while the app is still being set up (the
file belongs to another skill's step):

```
SKIP package.json [polyfill-first] not yet created (expo-project-bootstrap creates it)
SKIP package.json [verify-script] not yet created (expo-project-bootstrap creates it)
SKIP jest.config.js [jest-polyfills] not yet created (unit-and-component-tests creates it)
SKIP app.config.ts [supported-locales] not yet created (expo-project-bootstrap creates it)
SKIP app.config.ts [system-text-locales] not yet created (expo-project-bootstrap creates it)
```

The `system-text-locales` line appears only while the catalogs hold a `*.usage-description` key.

The skill's own targets never skip: a missing runtime file is `i18n-runtime`, a missing catalog is
`F1`, no source files or no catalogs at all is exit 2. `check-catalogs.mjs` and `check-i18n-code.mjs`
have no NOT APPLICABLE: an app without react-intl is exactly what this skill exists to fix. Only
`sync-copy.mjs check` prints one, when the app keeps no copy source (above).

## When multi-package

- One app workspace: pass `--app-dir apps/mobile` to all three checkers. They then read
  `apps/mobile/package.json` (`main`), `apps/mobile/app.config.ts`, `apps/mobile/jest.config.js`,
  scan `apps/mobile/src` and find the catalogs in `apps/mobile/src/i18n`; a workspace listed in
  `package.json` `workspaces` uses its own `tsconfig.json` aliases and its `rn-skills.config.json`
  `"workspaces": { "apps/mobile": { "srcDir": "…" } }` keys. `contracts/` stays at the repo root.
  Without `--app-dir` in a repo whose root holds no app, the checkers stop with exit 2 and name the
  workspaces to pass.
- Folder options still win: `--src`, `--i18n-dir` and `--entry` take repo-relative paths.
- The tooling in `scripts/i18n/` (verify-catalogs, review-sheet) runs from the app folder and reads
  `contracts/` at the same repo root as the checkers: the nearest folder above the app whose
  `package.json` `workspaces` lists it (`i18n-contract.ts`). A moved `contractsDir` in
  `rn-skills.config.json` is a checker option only; keep the tooling's contracts at `contracts/`.
- Packages with texts: list each in `contracts/i18n.json` `catalogs` with a `keyPrefix` and its
  `sourceDir`; `check-catalogs.mjs` lints every folder (L1b keeps the prefixes apart) and
  `check-i18n-code.mjs` scans each `sourceDir` and looks package ids up in their own catalog.
