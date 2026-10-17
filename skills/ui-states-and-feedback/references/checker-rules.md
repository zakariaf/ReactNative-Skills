# check-ui-states: every rule

`node ${CLAUDE_SKILL_DIR}/scripts/check-ui-states.mjs [repo-root] [--src-dir <dir>] [--contract <file>] [--json]`

## Contents

1. What it reads
2. Source rules
3. Contract rules
4. Results that pass
5. Configuration and multi-package
6. Known limits

## 1. What it reads

- `package.json` (root or a workspace): without `react-native` the whole check is
  `NOT APPLICABLE: react-native is not in package.json`.
- Every `.ts`/`.tsx` file under the source folder (`src/` from `resolveLayout`; `--src-dir .` reads
  the whole repo), through the repo walk: tests (`*.test.*`, `*.spec.*`, `__tests__/`, `__mocks__/`,
  `test/`), `.d.ts` files, output folders, the agent skill folders (`.agents/skills/`,
  `.claude/skills/`, …) and every folder holding a `SKILL.md` (installed or vendored skills) are
  skipped. The fixtures `pass-installed-skills-silent` and `pass-installed-skills-whole-repo` plant
  findings there, the second with the whole repo in scope.
- `contracts/screen-states.json` (or `--contract`, or `rn-skills.config.json`
  `"uiStates": { "contract": "<file>" }`) and the view, test, model and state-type files it names.

Exit 0 pass · 1 problems · 2 bad input (no `package.json`, no source folder, a contract that is not
valid JSON, a malformed config value).

## 2. Source rules

| Rule | Flags | Fix |
|---|---|---|
| `state-flags` | one file keeps a loading flag (`isLoading`, `loading`, `isFetching`, `isPending`) and an error (`error`, `err`, `errorMessage`, `failure`, `hasError`, `isError`, `failed`, …) in two `useState`s | one state union decided once (`listScreenStateOf`) |
| `empty-default` | in a file that reads TanStack Query (imports it or calls a `use…Query(` hook): a destructuring default `const { data = [] } = useQuery(…)` or `{ data: tasks = [] }` from any `use…Query(` call except `useSuspense…Query`; `data ?? []` / `query.data \|\| []` inside a `…StateOf(…)` call, or anywhere in a file that derives no state | keep `undefined` until the first success; let the state function decide |
| `bare-spinner` | `<ActivityIndicator>` in the features or routes folder, in a file without `DelayedPlaceholder`/`useDelayedVisibility` | `DelayedPlaceholder` with a content-shaped placeholder; controls in `src/ui` keep their own busy state |
| `refresh-blanks` | `if (…isFetching / isRefetching / fetchStatus === 'fetching'…) return …` | placeholders only when nothing is loaded; a quiet `isRefreshing` indicator |
| `native-alert` | `Alert.alert(…)`, `Alert.prompt(…)` | `notify()` for a result, `confirm()` for a decision |
| `confirm-outcome` | `!== 'cancelled'`, `!== 'dismissed'` (either order, in code, not comments or strings), or `if (x === 'cancelled') return` / `=== 'dismissed'` alone | `if (outcome !== 'confirmed') return;` |
| `confirm-vague` | a `confirm({ … })` whose `confirmLabel: t('…')` key ends in `ok`/`okay`/`yes`/`sure`, whose `title: t('…')` key ends in `are-you-sure`/`sure`/`warning`/`attention`, a shared `common.*`/`shared.*`/`general.*`/`global.*` title key, or a shared button key that names no verb (`common.confirm`, `common.continue`, `common.done`, ...; a shared verb such as `common.delete` passes) | a title with the consequence and count, a verb on the button |
| `offline-notice` | `notify({ … })` (any receiver: `feedback.notify`, `notify`) with a `t('…')` key containing `offline` | the offline banner and the list notice |
| `busy-overlay` | a `<Modal>` whose children hold `<ActivityIndicator>` or `<BusyIndicator>` | `useBusyAction` and the control's `isBusy` |
| `announce-ios` | a `.tsx` file in the features folder or `<uiDir>/feedback` with `accessibilityLiveRegion=` or a `<Toast>`, when no `useAnnounce(`/`announce(` call is in it or in any other source file of its feature folder (`<featuresDir>/<feature>/`, components included; for `<uiDir>/feedback`, that folder) | announce once per change with `useAnnounce()`, in the view or its model hook |

The raw-error rule (`error.message`, `String(error)` in UI code) is error-handling-typed-results'
`ui-error-message`; direct expo-network/NetInfo use is networking-and-server-state's
`connectivity-port`; timers and listeners left running are async-safety's. This checker does not
repeat them.

## 3. Contract rules

| Rule | Flags | Fix |
|---|---|---|
| `contract-missing` | no contract while screen code (a file in the features or routes folder) calls a `use…Query(` hook (`useQuery`, `useSuspenseQuery`, `useInfiniteQuery`, `useQueries`, a `use…Query` wrapper), `<uiDir>/feedback/` exists, or code calls `confirm()`. Query plumbing in `src/api/` (QueryClient, provider, query options) and a form that only writes (`useMutation`, `useQueryClient`) do not count | copy the template contract and declare the screens |
| `screen-undeclared` | the contract exists, a file in the features or routes folder calls a `use…Query(` hook, and no screen names a `view`, `model` or `test` in its feature folder (for a route file that queries directly, its own folder); one problem per folder, on its first reading file | declare the screen with its states, build and test them |
| `contract-invalid` | not an object; unknown keys (top level, screen, confirmation); an `id` that is not kebab-case or repeats; a missing `view`/`test`; an unknown or repeated state; a non-boolean flag; a malformed `stateType`; a confirmation without `testID` | follow `contracts/screen-states.schema.json` (an invalid screen is skipped by the rules below) |
| `contract-file` | a `view`, `test`, `model` or `stateType.file` that does not exist | point at the real file |
| `states-required` | `loading` or `failed` missing; `empty` missing with `isList`; `filtered-empty` missing with `hasFilter`; `offline` missing with `readsServer` or a model importing `@tanstack/react-query` | declare the state, build it, test it |
| `state-kinds` | the `kind: '…'` literals of `export type <stateType.name>` differ from `states` + `ready` (or the type is missing) | keep the union and the contract in step |
| `state-testid` | the view has no JSX element whose `testID` is the literal `<id>.state.<state>` | render the state with that literal id |
| `state-action` | the element of `failed`, `empty` or `filtered-empty` has no `action=` (or the contract's `actionProp`) | give it its one next step (`offline` needs none) |
| `loading-delayed` | the view declares `loading` but never uses `DelayedPlaceholder`/`useDelayedVisibility` | delay the placeholder |
| `state-tested` | the test file never contains `<id>.state.<state>` for a declared state | render every state in the test |
| `confirm-undeclared` | a `confirm()` without a literal `testID`, or whose testID is not in `confirmations` with a non-empty `whyNotUndo` | prefer `runUndoable`; otherwise declare it with the reason |

## 4. Results that pass

| Output | When |
|---|---|
| `RESULT: PASS` with `check-ui-states: <n> source files and screens checked, 0 problems` | the contract exists and every rule holds |
| a note `contracts/screen-states.json: none yet (no screen reads server state, no src/ui/feedback/, no confirm())` then `RESULT: PASS` | an app with no data screens yet (query plumbing in `src/api/` may already exist): the source rules ran, the contract rules have nothing to hold |
| `NOT APPLICABLE: react-native is not in package.json` | not a React Native app |

The checker prints no SKIP lines: everything it reads is either the app's own (the contract, its
screens) or, when absent, a fact that makes the contract rules not apply yet.

## 5. Configuration and multi-package

- `--src-dir <dir>` and `--contract <file>` override the layout; `rn-skills.config.json` may set
  `"srcDir"` (moves every layout folder) and `"uiStates": { "contract": "qa/screen-states.json" }`.
- The features, routes and ui folders come from `resolveLayout` (`featuresDir`, `routesDir`,
  `uiDir`), so a moved `srcDir` moves the scopes of `bare-spinner` and `announce-ios` too.
- When multi-package: run once per app, `--src-dir apps/<app>/src --contract
  apps/<app>/contracts/screen-states.json`, from the repo root.

## 6. Known limits

- The rules read source text, not types: a loading flag named `isWorking` or an error called
  `problem` passes `state-flags`; the union and `switch-exhaustiveness-check` still hold the line.
- `refresh-blanks` sees early returns (`if (query.isFetching) return …`), not a JSX ternary that
  swaps a list for a placeholder (`{isFetching ? <Skeleton /> : <List />}`) or a `&&` that hides the
  list. A ternary on the same flag is often the legitimate quiet line (`isRefreshing ? <Updating /> :
  null`), so the checker does not guess; review those by eye, or derive placeholders only from
  `listScreenStateOf`. A bare `return;` renders nothing and is left alone (the load-more guard
  `if (query.isFetching || !query.hasNextPage) return;` and an effect that waits for the refresh),
  and inside a callback passed to a call or a JSX attribute (an effect, a handler, a `.some(…)`) only
  a returned element or `null` counts, because only a `renderItem`-style callback renders.
- `empty-default` reads `data` by name, plus every name a `{ data: X }` destructuring takes from a
  `use…Query(` call, with an optional member chain after it (`data?.pages.flatMap(…) ?? []`). In a
  file that derives a state, a `?? []` outside the `…StateOf(` call is flagged only when its
  `const X = …` is passed in as `items: X` (or the shorthand `items`); a default kept for a count or
  a sort (`(query.data ?? []).length`) is left alone on purpose. A default applied inside a helper
  in another file, or a const passed through a second variable, is not seen.
- `announce-ios` and `screen-undeclared` work per feature folder. Any announcement in the folder
  satisfies every live region in it, even one about something else, and a second data screen added
  to a folder that already has a declared screen is not noticed. Declare each data screen when you
  add it, and keep one screen per feature folder where you can (the house layout does).
- `screen-undeclared` and `contract-missing` look for a `use…Query(` call in screen code; a screen
  that reads server state only through a hook named otherwise (`useTasks()`) is seen through its
  model hook only when that file calls a query hook itself.
- `confirm-vague` reads key names; a vague message under a specific key ("tasks.clear.title" whose
  English is "Are you sure?") needs the copy review of i18n-strings-and-catalogs.
- `state-action` looks at the element with the state's testID; an action rendered by a child
  component under another testID needs the contract's `actionProp` or a restructure.
- `confirm-undeclared` reads `confirm(` calls; a confirmation built on another API (a custom modal)
  is outside it, which is one more reason to ask only through `confirm()`.
