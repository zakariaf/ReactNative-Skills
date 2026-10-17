# Forbidden patterns and what to write instead

Every pattern the canonical config rejects, why, which rule enforces it, and the replacement. Read this
when a lint or `tsc` error needs a fix, or before writing code that touches time, randomness, network,
text, styles or imports. The fix is always in the code; silencing a gate is itself forbidden. Where a
topic has an owner skill, the row names it for the full rule.

## Contents

- Silencing gates
- TypeScript syntax
- Exports and imports
- Promises, handlers and errors
- Time, randomness and determinism
- Network and packages
- Text, direction and styles
- React and UI primitives
- Tests
- Comments

## Silencing gates

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| `// eslint-disable...`, `/* eslint ... */`, `/* global */` | silencing a check is the likeliest failure of an unsupervised agent; inline config is switched off and reported | `noInlineConfig`, `reportUnusedDisableDirectives`, `check-source` `no-inline-config` | fix the code; a real exception is a files-scoped block in `eslint.config.mjs` with a `Gate-Change:` trailer |
| `// @ts-ignore`, `// @ts-nocheck` | hides type errors | `@typescript-eslint/ban-ts-comment`, `no-ts-ignore` | fix the type |
| `// @ts-expect-error` without a reason of 10+ characters | allowed only where a third-party type is wrong | `ban-ts-comment`, `ts-expect-error-reason` | `// @ts-expect-error: expo-iap 5.8 Purchase type misses revocationDate` |
| `eslint --rule ...`, `--no-inline-config`, `--quiet`, `--config`, `--ignore-pattern` in scripts; `eslint src` | CLI flags bypass the config; a narrower target skips `app.config.ts`, `plugins/`, `scripts/` and tests | `check-configs` `lint-script` | run ESLint only through the npm scripts, as `eslint . --max-warnings 0` |
| an ignore entry that reaches app code (`PRE_EXISTING: ['src/features/**']`, a `.prettierignore` line, a root `exclude` entry, an extra `globalIgnores` entry, a block-level `ignores`) | one line takes a folder out of every gate while the tools stay quiet | `check-configs` `ignore-app-code`, `eslint-weakened [global-ignores]`, `[block-ignores]`; `check-source` `ignore-app-code` | fix the code; code kept outside `src/` moves under it or into `rn-skills.config.json` `"layoutEntries"` |
| raising a limit in a later block, in any shape (`['error', 6]`, `{ max: 6 }`, a bare `'error'`) | the limit detects a symptom; a raised one hides it | `eslint-limit-changed`, `[option-redeclared]` | split by responsibility (references/limits-and-splitting.md) |
| an exemption for a whole folder (`ADAPTERS` gains `src/features/**/*.ts`) | every file in it loses the ban | `eslint-weakened [exemption-scope]` | name the one file the contract needs |
| a second ESLint, Prettier or knip config | two sources of truth | `config-stray` | one `eslint.config.mjs`, one `.prettierrc.json`, one `knip.json` |

## TypeScript syntax

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| `enum`, `const enum` | not erasable (Node type stripping); unions work with exhaustive switches | `erasableSyntaxOnly`, `TSEnumDeclaration` selector, `no-enum` | `const TASK_STATUSES = ['open', 'done', 'archived'] as const; type TaskStatus = (typeof TASK_STATUSES)[number];` |
| `namespace X {}` (outside `*.d.ts`) | not erasable | `erasableSyntaxOnly`, `no-namespace` | plain modules; `declare namespace` only for merging in `*.d.ts` |
| constructor parameter properties (`constructor(private x: X)`) | not erasable | `erasableSyntaxOnly`, `no-parameter-property` | declare the field and assign it in the body, or use a factory function |
| `interface` (outside `*.d.ts`) | one way to declare types | `consistent-type-definitions`, `no-interface` | `type X = { ... }`; `interface` only for declaration merging (`NodeJS.ProcessEnv`, a library's module augmentation) |
| `any`, unsafe member access | type holes | typescript-eslint strict, `no-explicit-any` | `unknown` plus narrowing (valibot at a boundary), or the real type |
| non-null `value!` in app code | hides an `undefined` that `noUncheckedIndexedAccess` made visible | `no-non-null-assertion` (off in tests) | `if (x === undefined) return ...;` or `?? fallback` |
| truthiness on strings and numbers (`if (count)`) | `0` and `''` bugs | `strict-boolean-expressions` | `if (count > 0)`, `if (title !== '')` |
| non-exhaustive `switch` over a union | a new member is silently ignored | `switch-exhaustiveness-check` | a `case` per member; no `default` for unions |
| missing return type on an export | the contract is implicit | `explicit-module-boundary-types` | `export function f(x: X): Y` |
| `import { X }` for a type | single-file transforms cannot tell types from values | `consistent-type-imports`, `verbatimModuleSyntax` | `import type { X } from '...'` (a separate statement) |
| a `kind`/`type` value that is not kebab-case (`{ kind: 'TaskCompleted' }`) | discriminants are greppable and stable | `kindValue`, `kindTypeValue` selectors (naming-conventions owns the grammar) | `'task-completed'`. A MIME type (`type: 'image/jpeg'` in a multipart part, `getDocumentAsync({ type: 'application/pdf' })`, or a wildcard `'*/*'`, `'image/*'`) is an external data format and is exempt |

## Exports and imports

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| `export default` | names must be greppable; importers rename freely | `import/no-default-export`, `no-default-export` | `export function x` / `export const x`. Only Expo Router route files (`src/app/**`), `app.config.ts`, config plugins (`plugins/**`), `__mocks__/**` and `jest.setup.ts` default-export |
| `from '../x'` in app code | paths that survive moves; one way to reach another folder | `PARENT_IMPORT`, `no-parent-import` | a sibling: `./x`; any other folder: `@/features/tasks/task-list`. Node-run code may use `../` (Node reads no aliases) |
| `from './x'` without extension in Node-run code | Node type stripping resolves no extensionless import | `NODE_IMPORT_EXTENSION`, `import-extension` | `./x.ts`, `./view.tsx`, `./en.json` (when multi-package: every import) |
| `import type` from `app.config.ts`, `plugins/`, `scripts/` or `node:*` in `src/` | pulls the Node world into the app program and the bundle | `NODE_BUILTINS`, the tooling zone, `node-world-import` | a neutral file under `src/` both sides import |
| barrel `index.ts`, re-exports for convenience | cycles, hidden dependencies, slower Metro | `check-file/filename-blocklist` | import the file that defines the symbol |
| import cycles | untestable coupling | `import/no-cycle` | move the shared type down (to `src/core` or a types file) |
| deep `react-native/Libraries/*` | private API; a type error under the Strict API | `@react-native/no-deep-imports` | the public entry |
| Node built-ins (`node:*`, `fs`, `path`) in app code | they do not exist in the app runtime | `NODE_BUILTINS`, `node-world-import` | keep Node code in `app.config.ts`, `plugins/`, `scripts/` |

Import order is enforced and auto-fixed (`import/order`): built-ins, external packages, `@/` and
`@test/` imports, relative imports, then type imports in their own group, blank lines between groups.
`eslint --fix` (or the editor hook) orders them; never order imports by hand.

## Promises, handlers and errors

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| floating promise, `void promise` | an unhandled rejection is a silent failure | `no-floating-promises` (`ignoreVoid: false`), `no-void-promise` | `await` it, `return` it, or `task().catch(reportError)` |
| `async` event handler (`onPress={async () => ...}`, `const handleSave = async ...`, also with a type annotation) | React Native's Strict API types `onPress` as returning `unknown`, so `no-misused-promises` cannot catch it (verified) | `asyncHandler` selector, `sync-handler` | `const handleSave = (draft: TaskDraft): void => { save(draft).catch(reportError); };` (`examples/use-task-editor-model.ts`) |
| A handler that returns what it calls (`onPress={() => Linking.openURL(url)}`, `const handleLongPress = (): Promise<void> => retry();`, `return retry();` in a handler) | the promise goes to a prop typed as returning `unknown`, so neither `no-misused-promises` nor `no-floating-promises` sees it, and `openURL` rejects when no app handles the URL. A function passed by reference (`onPress={retry}`) is not caught: review it | `handlerBody` selector, `handler-body` | a block body that returns nothing: `onPress={() => { Linking.openURL(url).catch(reportError); }}`; then `no-floating-promises` checks the call |
| `onPress={handleSubmit(onValid)}` (react-hook-form) | `handleSubmit` returns a promise and rethrows what `onValid` throws, so the rejection is unhandled | `asyncHandler` selector, `sync-handler` | `onPress={() => { handleSubmit(onValid)().catch(reportError); }}` |
| empty `catch {}` | a swallowed error leaves no trace | `no-empty` (`allowEmptyCatch: false`), `no-empty-catch` | map to a `Result`, record through the error-reporting port with a fallback, or rethrow with `{ cause }` |
| `throw 'text'` | loses the stack | `only-throw-error`, `throw-error-object` | `throw new Error('message', { cause })` |
| rejecting with a non-Error | same | `prefer-promise-reject-errors` | `reject(new Error(...))` |
| `async` Promise executor, `new Promise` around async code | swallowed rejections | `no-async-promise-executor` | plain `async` functions |
| `setTimeout(fn)` without a delay | unclear intent | `setTimeoutNoDelay` selector | an explicit delay, cleared in `finally` or an effect cleanup |

The `Result` type and failure design belong to error-handling-typed-results.

## Time, randomness and determinism

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| `Math.random()` | untestable, and seeded output must match on every device | `no-restricted-properties` | the seeded RNG in `src/core/rng` or an injected random source |
| `Date.now()`, `new Date()` with no argument, `performance.now()` in app code | testable time (a test sets the clock; a debug build can move the date) | `no-restricted-properties`, `newDate` selector (`arguments.length=0`) | inject `ClockPort` (`src/services/clock`); the frame timestamp on the UI thread. `new Date(epochMs)` converts an instant the clock gave you and is allowed; keep stored instants as epoch numbers |
| `Date.now()`, `new Date()` in Node code | one testable clock for tooling | the Node-code block | `scripts/clock/system-clock.ts` |
| `Math.sin/cos/tan/atan2/exp/log/pow`, `**` in `src/core/rng`, `src/core/dates`, game rules | Hermes uses the platform libm and Jest runs V8: results differ across devices | `DETERMINISM_SYNTAX` | only `+ - * / %`, bitwise operators, `Math.sqrt/imul/floor/round/abs/min/max/PI`; multiply explicitly (seeded-determinism-and-golden-vectors) |
| `localeCompare`, any `Intl.*`, `toLocaleUpperCase`/`toLocaleLowerCase` in deterministic code (`src/core/rng`, `src/core/dates`, `*-generator.ts`, game rules) | the result depends on the device locale and its ICU data (Hermes and V8 ship different data), so a seeded generator sorts or cases differently per device | `DETERMINISM_SYNTAX` | compare code units with `<` and `>`; `toUpperCase`/`toLowerCase` (seeded-determinism-and-golden-vectors) |
| `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, `.toLocaleString()` outside `src/i18n` | one place applies the locale, calendar, numbering system and Hermes polyfills | `intlDate`, `toLocaleCall` selectors | the formatters in `src/i18n` (i18n-strings-and-catalogs). A locale's default calendar can differ from Gregorian (Persian, Thai Buddhist); the formatters pass the calendar the product wants |

## Network and packages

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` outside `src/api` | one place owns timeouts, retries, validation and the privacy inventory | `no-restricted-globals` | the typed `ApiClient` in `src/api` (networking-and-server-state). An app with no network at all uses the `offline-only` profile of privacy-and-store-declarations |
| `http(s)://`, `ws(s)://`, `ftp://` literals outside `src/api`, `src/config` | remote images, fonts and links make requests without `fetch` | `remoteUrl*` selectors | base URLs in `src/config`, endpoints in `src/api`. The rule holds in test files too (under `src/` and `test/`), on purpose: a test never pins a real endpoint. A test that needs a sample URL (an OAuth issuer, an API base) keeps it in a JSON fixture beside the test or builds it from `src/config`, and uses a reserved domain (`https://auth.example.test`) |
| `axios`, `@react-native-async-storage/async-storage`, `react-native-iap`, `react-native-restart` | replaced by a canonical choice | `BANNED_PACKAGE_PATHS` (the app's dependency policy, dependency-management) | the `ApiClient` (fetch); `expo-sqlite/kv-store` or `expo-secure-store`; `expo-iap` behind `PurchasePort`; `reloadAppAsync` from `expo` |
| a vendor SDK outside its adapter | one adapter per port | `no-restricted-imports` (`VENDOR_SDK_PATHS`) + the `ADAPTERS` block | import the port type; only `<vendor>-<concern>-adapter.ts` imports the SDK (architecture-and-boundaries). The canonical list: `react-native-google-mobile-ads`, `expo-iap`, `expo-sqlite`, `react-native-audio-api`, `expo-haptics`, `expo-network`, `@react-native-community/netinfo`, `@sentry/react-native`, `expo-updates`, `expo-secure-store`, `expo-auth-session`, `expo-apple-authentication`, `expo-file-system`, `expo-sharing`, `expo-document-picker`, `expo-notifications` (local and push), `expo-background-task` and `expo-task-manager` (plus the `TASK_REGISTRIES` block: `src/services/*/define-*-tasks.ts` may import the task manager), `posthog-react-native`; a skill that adds a port for another SDK appends it here. The ban covers `src/**` only: a root entry file (`index.ts`, `App.tsx`) that imports an SDK is caught by the owning skill's checker (crash-reporting-and-observability for `@sentry/*`) and by review |
| `expo-tracking-transparency` outside the consent adapter | the tracking prompt is asked once, in order, before any ad or analytics request | `ATT_IMPORT` (only the consent-adapter block lifts it) | `ConsentPort` (admob-ads-and-consent) |
| `console.log` in app code | noise in release logs, no structure | `no-console`, `no-console-log` | the error-reporting port or the debug menu; `console.warn`/`error` are allowed |

## Text, direction and styles

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| JSX string literals; literal `accessibilityLabel`, `aria-label`, `accessibilityHint`, `placeholder`, `title`, `alt` | every visible or spoken string is translatable (VoiceOver and TalkBack read the labels) | `react/jsx-no-literals`, `a11yLiteral`, `formatjs/no-literal-string-in-jsx` | `t('tasks.add-button.label')` (i18n-strings-and-catalogs) |
| `Text` from `react-native` outside `AppText` | alignment, writing direction and scaling live in one component | `no-restricted-imports` | `AppText` from `@/ui/app-text` |
| `left`, `right`, `marginLeft`, `paddingRight`, `borderTopLeftRadius`... in styles | layouts mirror in right-to-left locales | `physicalStyleKeys` | `start`, `end`, `marginStart`, `paddingEnd`, `borderTopStartRadius` (rtl-and-direction) |
| `textAlign: 'left' \| 'right'` outside `AppText`; `flexDirection: 'row-reverse'` | React Native already mirrors | `textAlignLiteral`, `rowReverse` | `align='start' \| 'end'` on `AppText`; plain `row` |
| `I18nManager` outside `src/i18n/direction.ts` | one source of direction | `no-restricted-imports`, `no-restricted-properties` | `DirectionContext` |
| `react-intl` outside `src/i18n/` | the wrapper owns formatting, bidi isolation and digits | `no-restricted-imports` | `t()` / `<T>` |
| inline styles, color literals, unused styles, single-element style arrays | theme tokens only | `react-native/*` rules | `makeStyles(theme => ...)` with tokens (design-system-structure) |

## React and UI primitives

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| `useMemo`, `useCallback`, `React.memo` without a measured need | the React Compiler memoizes | `no-restricted-imports`, react-hooks compiler rules | plain code; `'use no memo'` only as the documented escape hatch |
| Reanimated `.value` | compiler-safe access | review | `.get()` / `.set()` |
| `Pressable` outside `src/ui`, or without `role` | one button family; every control has a role and a label for VoiceOver and TalkBack | `no-restricted-imports`, `pressableA11y` | the buttons and rows in `src/ui` (react-components-and-hooks) |
| `Image` from `react-native` outside the Icon component | no caching or sizing | `no-restricted-imports` | `Image` from `expo-image`, or `Icon` from `@/ui/icons/icon` |
| `Dimensions`, `Animated`, `Alert`, `SafeAreaView` from `react-native` | windows resize (iPad, foldables, Android split screen); Reanimated; themed dialogs; deprecated | `no-restricted-imports` | `useWindowDimensions`, `react-native-reanimated`, the dialogs in `src/ui`, `react-native-safe-area-context` |
| a store hook without a selector (`useTasksStore()`) | re-renders on every change | `storeWithoutSelector` | `useTasksStore((state) => state.filter)` (state-management-zustand) |
| test globals (`jest`, `describe`, `expect`) in app code | tests stay in test files | `no-restricted-globals` | move the code into `*.test.ts(x)` |

## Tests

Test files (`**/*.test.{ts,tsx}`, `test/**`, `jest.setup.ts`, `__mocks__/**`) get block 7: 400 code
lines, no per-function limit, 4 nested callbacks, `!` and unsafe `any` access allowed, JSX literals
allowed. The Jest and Testing Library rules still hold (unit-and-component-tests owns them):

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| `test(...)`, or titles like `'should return'` | titles read as specifications | `jest/consistent-test-it`, `jest/valid-title` (`^(can\|[a-z]+s)\b`) | `it('returns ...')`, `it('can undo ...')` |
| an `it` outside a `describe` | one suite per unit | `jest/require-top-level-describe` | `describe('<exported name>', () => { it(...) })` |
| `toEqual` | `undefined` fields and class instances slip through | `jest/prefer-strict-equal` | `toStrictEqual` |
| `it.only`, `fit`, `it.skip`, `xit` | a focused or skipped test hides failures | `jest/no-focused-tests`, `jest/no-disabled-tests` | run the file with `npx jest <path>`; delete dead tests |
| a snapshot over 50 lines (inline over 10) | nobody reviews it | `jest/no-large-snapshots` (off only for `*.golden.test.ts`) | assert the fields that matter, or a golden test |
| a test with no assertion | proves nothing | `jest/expect-expect` (`expect`, `fc.assert`) | assert, or use `fc.assert` for properties |
| `fireEvent`/`userEvent` calls not awaited | Testing Library 14 is async: `render`, `user.press`, `fireEvent` and `act` return promises | `testing-library/await-async-events` | `const user = userEvent.setup();` then `await user.press(...)`; `await render(...)` |
| `fetch`, `WebSocket` in a test | tests never touch the network | `no-restricted-globals` | a fake port |

## Comments

| Pattern | Why | Enforced by | Instead |
|---|---|---|---|
| `TODO`, `FIXME`, `XXX`, `HACK` comments | nothing comes back to them | `no-warning-comments`, `no-warning-comment` | do it now, or leave it out (git keeps history) |
| commented-out code | same | `sonarjs/no-commented-code` | delete it |
| an exported `src/core` function or a `*Port` type without TSDoc | summaries are read before bodies | `tsdoc-contract` | a one-sentence `/** ... */` stating the contract |
| a comment saying *what* the next line does | noise | review | comment *why*, citing the requirement when a line exists because of it |
