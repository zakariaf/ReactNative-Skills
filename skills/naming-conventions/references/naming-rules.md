# The naming rules, with reasons and examples

Every naming rule of this skill, why it exists, what enforces it, and a good/bad table for every kind
of name. Read this first when creating or renaming anything; the other references go deeper per area.
Examples use a neutral Tasks app (tasks, lists, reminders, a Premium entitlement).

## Contents

- Why names matter
- Where the scheme comes from
- The rules
- Good and bad, by kind of name

## Why names matter

Names are an agent's search index. Agents (and people) find code by `grep` and by path, so every name
must be predictable from the thing it names, and the thing must be findable from its name. A file
called `utils.ts`, a hook called `useData`, a testID called `button1` or a message key called
`continueLevel12` each force someone to open files to learn what a name already should have said.

## Where the scheme comes from

- **The Expo SDK 57 default template** uses kebab-case files (`themed-text.tsx`, `use-color-scheme.ts`)
  and Expo Router file routes in `src/app/`.
- **The Google TypeScript style guide**: UpperCamelCase types, lowerCamelCase values, CONSTANT_CASE
  constants, no `I` prefix, acronyms written as words.
- **The React docs**: components are capitalised, hooks start with `use`, event handlers are
  `handleX`, callback props are `onX`.

Where this library adds its own convention (kebab-case `kind` values, testIDs, message keys, the path
header), the rule says why.

## The rules

1. **Name every file and folder in kebab-case**, lowercase ASCII words joined by `-`
   (`task-row.tsx`, `use-tasks-model.ts`, `sort-tasks.ts`). Middle extensions are allowed: `.test`,
   `.golden.test`, `.sim.test`, `.perf.test`, `.d`, `.config`, and the platform extensions `.ios`,
   `.android`, `.native`, `.web`. Why: one convention, the Expo template's; macOS file systems (a
   developer's Mac, EAS's iOS builders) ignore case, but Linux CI runners and EAS's Android (Linux)
   workers do not, so `TaskRow.tsx` imported as `task-row` builds on a Mac and fails there. Enforced by: `check-file/filename-naming-convention`,
   `check-file/folder-naming-convention`, `check-file-names.mjs` (`file-kebab`, `folder-kebab`).
2. **Route files in `src/app/` follow the Expo Router grammar with kebab-case segments**:
   `_layout.tsx`, `index.tsx`, `+not-found.tsx` (and the other `+` names), `<name>+api.ts`,
   `task-details.tsx`, `(tabs)/` groups, `[taskId].tsx` params, `[...rest].tsx`. Params are camelCase:
   the name becomes the key of `useLocalSearchParams<{ taskId: string }>()`. Why: a route file name is
   a URL segment, and the param name is code. Enforced by: the routes block of the ESLint config
   (`ROUTE_FILE`, `ROUTE_FOLDER`; both reject an uppercase param such as `[TaskId]`) and
   `route-segment` (the same grammar without `node_modules`; verified 2026-10-03).
3. **Name a module's main export after its file:** `task-row.tsx` exports `TaskRow`,
   `use-tasks-model.ts` exports `useTasksModel`, `tasks-screen.tsx` exports `TasksScreen`. The role
   suffix maps too: `<vendor>-<concern>-adapter.ts` → `create<Vendor><Concern>Adapter`, `fake-x.ts` →
   `createFakeX`, `x-port.ts` → `type XPort`, `src/stores/x-store.ts` → `useXStore`, `x-reducer.ts` →
   `xReducer`, `plugins/with-x.ts` → `withX`. Why: the file name alone tells what to import and where
   a symbol lives. Enforced by: `export-name`, `port-file`.
4. **Route files default-export a named function `<Name>Route`** (`<Name>Layout` in `_layout.tsx`):
   `export default function TaskDetailsRoute()`. Why: the router reads the default export, an
   anonymous one shows as `Anonymous` in React DevTools and stack traces, and the screen the route
   renders already owns the name `<Name>Screen` in `src/features/`; two symbols called `TasksScreen`
   would make every grep ambiguous. Enforced by: `route-export-name`.
5. **Never create grab-bag files or folders, or barrel `index.ts` files.** No `utils.ts`,
   `helpers.ts`, `misc.ts`, `common.ts`, `shared.ts`, `stuff.ts`, and no `src/utils/`-style folders.
   The only `index` files are route files and the files a tool requires by name (listed in
   `contracts/naming.json` `allowedIndexFiles`). Why: grab-bags grow without limit, and barrels create
   import cycles and defeat tree shaking. Enforced by: `check-file/filename-blocklist`, `grab-bag-file`,
   `grab-bag-folder`, `barrel-index`.
6. **Start every `.ts`, `.tsx`, `.js`, `.mjs` and `.cjs` file with a comment holding its
   repo-relative path** (`// src/ui/app-text.tsx`; a short note may follow after `: ` or a space;
   after a `#!` line it is line 2; a `'use dom';` or `'worklet';` directive comes after it). Why:
   snippets, diffs, review comments and tool output always show where code lives. This skill owns the
   rule (files-and-folders.md states it in full); other skills cite it. On by default; a repo that
   does not want it sets `"pathHeader": false` in `contracts/naming.json`. Enforced by: `path-header`.
7. **Values are camelCase, components and types PascalCase, module constants UPPER_CASE.** A
   module-level constant is UPPER_CASE when it holds fixed data (`MAX_TITLE_LENGTH`, `TASK_PRIORITIES`,
   `DUE_DATE = /^\d{4}-\d{2}-\d{2}$/u`); objects built by a call stay camelCase (`styles`,
   `queryClient`, `useTasksStore`). Why: Google TS style; the case says whether a value can change.
   Enforced by: `@typescript-eslint/naming-convention`, `constant-name`.
8. **Treat acronyms as words:** `loadHttpUrl`, `SqlDriver`, `isRtl`, `ApiClient`, not `loadHTTPURL` or
   `isRTL`. External names stay as their owner spells them (`I18nManager.isRTL`, the `testID` prop).
   Why: word boundaries stay visible and case checks stay predictable. Enforced by: `acronym-case`.
9. **Prefix every boolean variable and parameter** with `is`, `has`, `can`, `should`, `did`, `will` or
   `was` (`isDone`, `hasReminder`); UPPER_CASE boolean constants use `IS_`, `HAS_`, ... Rename
   destructured booleans while destructuring (`const { granted: isGranted } = permission`,
   `({ disabled: isDisabled }: ButtonProps)`). Why: a boolean reads as a question at the call site.
   Enforced by: `@typescript-eslint/naming-convention` (a bare destructured `granted` and a `{ disabled }`
   parameter are both rejected; verified 2026-10-03), `boolean-name`.
10. **Declare types with `type`, never `interface`** (except declaration merging in `*.d.ts`), never
    with an `I` prefix, and never as `enum`. A closed set is an `as const` array plus a derived union
    (`templates/string-union.ts`). Why: `erasableSyntaxOnly` rejects enums, unions work with
    `switch-exhaustiveness-check`, and an `I` prefix carries no information. Enforced by:
    `consistent-type-definitions`, the enum ban in `no-restricted-syntax`, `tsc`, `type-name`.
11. **Suffixes say whose a type is:** `<Component>Props`, `<Domain>State`, `<Domain>Action`,
    `<Operation>Error`, `<Function>Options`, `<Concern>Port`; type parameters are `T` or `T` +
    PascalCase (`TItem`, `TError`). Never a bare `Props` or `State` outside tests. Enforced by:
    naming-convention `typeParameter`, `type-name`.
12. **Name React parts the React way:** event handlers inside a component are `handleX`
    (`handlePress`), callback props `onX` (`onToggle`), hooks `useX` in `use-x.ts` (one per file; a
    second exported hook there is only a building block `useX` calls, `useFontScale` beside
    `useTextStyle`; a context module `<x>-context.tsx` keeps its private context beside `XProvider` and its `useX` hook),
    screens `<Name>Screen` in `<name>-screen.tsx`, a feature's model hook `use-<feature>-model.ts`. Why:
    React's documented conventions; the React Compiler and `react-hooks` rules rely on the `use` prefix.
    Enforced by: `export-name`, `one-hook-per-file`, `handler-name`.
13. **Discriminate unions with `kind` and reducer actions with `type`; their values are kebab-case
    literals with a grammar:** commands imperative (`'complete-task'`), events past tense
    (`'task-completed'`), errors a noun phrase (`'stale-revision'`), actions imperative
    (`'set-filter'`). Why: one grep finds every producer and consumer, and stored values stay readable.
    A stored value (an outbox entry, an exported backup) is a data format: renaming it needs a
    migration. A `type:` that a format or library owns is not a discriminant and keeps its own shape:
    a MIME type (`'text/csv;charset=utf-8'`, `'image/*'`), react-hook-form's
    `setError('title', { type: 'maxLength' })`, an adapter's SDK options, and the values a test
    asserts (valibot's `'min_length'` issues). Enforced by: `kindValue`/`kindTypeValue` selectors,
    `kind-value`.
14. **Give every tappable or asserted element a testID `<screen>.<element>[.<key>]`**, kebab-case
    segments (`tasks.add-button`, `tasks.task-row.<task id>`). Repeated items append a stable data
    key as its own segment, never a list index; interactive elements end in their role (`-button`, `-row`, `-switch`,
    `-input`, ...). Flows select by `id:` only. Why: Maestro's `id:` matches `testID` on iOS and
    Android, so flows run unchanged in every locale and on both platforms. Enforced by: `testIdFormat`
    selector, `testid-format`, `testid-index`, `testid-role`, `maestro-selector`.
15. **Write message keys as semantic, dot-separated, kebab-case paths** of 2 to 5 segments,
    `<area>.<element>[.<variant>]` (`tasks.add-button.label`), written as literals or picked from a
    typed table, never built from strings. The first segment is a feature folder or a declared area
    (`app`, `common`, `crash`, `date`, `errors`, `permissions`, `reminders` in the template); a separately shipped package's
    keys start with its id, and app code never names them. Placeholders are
    camelCase and typed (`{count, number}`, `{taskCount, plural, ...}`, free text `{listName}`). Why: a
    wording change never renames a key, merged catalogs never collide, and tools can check what they
    can see. Enforced by: `i18n-key`, `i18n-key-built`, `i18n-key-namespace`, `i18n-placeholder`, and
    the i18n-strings-and-catalogs catalog verifier (the canonical ESLint config's
    `formatjs/no-literal-string-in-jsx` finds literal UI text, not key shape).
16. **Name tests after the unit, colocated:** `<unit>.test.ts(x)` next to the unit; pixel and data
    goldens `*.golden.test.ts`; simulations `*.sim.test.ts`; Android-only behaviour
    `*.android.test.tsx` (the Jest project `android`); Node-API tests in the root `test/`.
    `describe('<exported name>')` → `describe('when ...')` → `it('<third-person verb> ...')`; `it`, never
    `test`. Why: the Jest projects select by suffix, and titles read as specifications. Enforced by:
    Jest `testMatch`, `jest/valid-title` (`^(can|[a-z]+s)\b`), `jest/consistent-test-it`, `test-file`,
    `test-title`.
17. **Ids outside the code have one shape:** the iOS bundle id and the Android package are the same
    lowercase reverse-DNS id (`com.acme.tasks`, no Java keyword segment), store product ids are
    `<app id>.<product>` (`com.acme.tasks.premium`; `<last app-id segment>.<product>` only when the
    full form passes 40 characters), the slug is kebab-case, env vars are
    UPPER_SNAKE_CASE with `EXPO_PUBLIC_` for anything the app reads (besides Expo's own `EXPO_OS`,
    `EXPO_SERVER`, `EXPO_BASE_URL` and `NODE_ENV`), read by name with dot access (never destructured or
    copied), while server code (`+api.ts`, `+middleware.ts`, `src/server/`) reads secrets under plain
    names (never an `EXPO_PUBLIC_` name with a secret word such as `SECRET`, `TOKEN` or `KEY`), npm
    scripts are `<verb>` or `<area>:<verb>`, release tags are `vX.Y.Z`. An id that is already live on a
    store or EAS keeps its shape and is recorded in `contracts/naming.json` `publishedAppIds`,
    `publishedSlugs` or `publishedProductIds`: changing it would ship a new app. Enforced by: `app-id`,
    `product-id`, `env-var`, `npm-script-name` (packages-scripts-env-and-tags.md has the details).
18. **Canonical names are declared and never renamed silently.** The repo lists the names other code,
    CI and docs depend on (port types, npm scripts, env vars) in `contracts/naming.json` `canonical`.
    Renaming one is a decision for the reviewer, not a refactor. Enforced by: `canonical-name`.
19. **Commit headers and release tags** follow Conventional Commits and `vX.Y.Z`; the
    git-commits-and-reporting skill owns their full rules (trailers, scopes, bodies).

## Good and bad, by kind of name

| Thing | Good | Bad | Enforced by |
|---|---|---|---|
| Source file | `sort-tasks.ts`, `task-row.tsx` | `sortTasks.ts`, `TaskRow.tsx`, `sort_tasks.ts` | check-file, `file-kebab` |
| Folder | `task-details/`, `error-log/` | `TaskDetails/`, `__tests__/`, `error_log/` | check-file, `folder-kebab` |
| Route file | `src/app/tasks/[taskId].tsx`, `src/app/(tabs)/_layout.tsx` | `src/app/TaskDetails.tsx`, `[task-id].tsx`, `[TaskId].tsx`, `(Tabs)/` | `route-segment` |
| Route component | `export default function TaskDetailsRoute()` | `export default function () {}`, `export default function TaskDetailsScreen()` | `route-export-name` |
| Test file | `sort-tasks.test.ts`, `badge.golden.test.ts`, `reminders.sim.test.ts` | `sort-tasks.spec.ts`, `__tests__/sort-tasks.ts`, `sort-tasks.unit.test.ts` | Jest `testMatch`, `test-file` |
| Grab-bag | `format-due-date.ts`, `clamp-title.ts` | `utils.ts`, `helpers.ts`, `src/common/` | check-file, `grab-bag-file`, `grab-bag-folder` |
| Barrel | none (import the file) | `src/ui/index.ts` | check-file, `barrel-index` |
| Path header | `// src/ui/app-text.tsx: the one Text`, `#!/usr/bin/env node` then `// scripts/release/bump-build-number.mjs` | no header, `// Runs before each test`, a stale path after a move | `path-header` |
| Component | `export function TaskRow(...)` in `task-row.tsx` | `export default function (...)`, `taskRow` | naming-convention, `export-name` |
| Props type | `type TaskRowProps = { ... }` | `interface ITaskRowProps`, `type Props` | consistent-type-definitions, `type-name` |
| Hook | `useTasksModel` in `use-tasks-model.ts` | `tasksHook`, `useTasksModel` in `tasks.ts` | react-hooks, `export-name`, `one-hook-per-file` |
| Context module | `PressFeedbackProvider` + `usePressFeedback` in `press-feedback-context.tsx` | `FeedbackHost` in `press-feedback-context.tsx` | `export-name` |
| Handler / callback prop | `onPress={handlePress}`, `onToggle={onToggle}` | `onPress={onClick}`, `onPress={press}` | `handler-name` |
| Boolean | `isDone`, `hasReminder`, `IS_PREVIEW_BUILD` | `done`, `reminder`, `loading`, `rtl` | naming-convention, `boolean-name` |
| Boolean parameter | `(isIncludingDone: boolean)` | `(includeDone: boolean)` | naming-convention, `boolean-name` |
| Constant data | `MAX_TITLE_LENGTH = 120`, `TASK_FILTERS = [...] as const` | `maxTitleLength` at module level, `kMaxTitle` | `constant-name` |
| Enum replacement | `type TaskFilter = (typeof TASK_FILTERS)[number]` | `enum TaskFilter { All }` | enum ban, `erasableSyntaxOnly` |
| Type parameter | `TItem`, `TError`, `T` | `S`, `ItemType`, `TS` | naming-convention |
| Acronym | `SqlDriver`, `isRtl`, `ApiClient` | `SQLDriver`, `isRTL`, `APIClient` | `acronym-case` |
| Store | `useTasksStore` in `src/stores/tasks-store.ts` | `tasksStore`, `useStore` in `store.ts` | `export-name` |
| Reducer | `tasksReducer` in `tasks-reducer.ts` | `reducer`, `reduceTasks` | `export-name` |
| Action | `{ type: 'set-filter', filter }` | `{ type: 'SET_FILTER' }`, `{ type: 'setFilter' }` | `kindValue`, `kind-value` |
| Command | `{ kind: 'complete-task', taskId }` | `{ kind: 'CompleteTask' }`, `{ command: 'complete' }` | `kindValue`, `kind-value` |
| Event | `{ kind: 'task-completed', taskId }` | `{ kind: 'complete-task' }` (imperative), `{ kind: 'TASK_COMPLETED' }` | `kind-value`, review |
| Port type | `ClockPort`, `CrashReporterPort`, `SqlDriver` | `IClock`, `ClockService`, `ClockInterface` | `port-file`, `canonical-name` |
| Adapter file | `system-clock-adapter.ts`, `sentry-crash-reporter-adapter.ts`, `expo-sqlite-sql-driver.ts` | `clock.ts`, `SentryAdapter.ts`, `crash-sentry.ts` | ESLint `ADAPTERS` glob, `export-name` |
| Fake | `fake-clock.ts` → `createFakeClock()` | `clock.mock.ts`, `mock-clock.ts` | `fake-file` |
| testID | `tasks.add-button`, `tasks.task-row.<id>` | `addButton`, `Tasks.Add`, `tasks_add`, `tasks.add` on a button | `testIdFormat`, `testid-format`, `testid-role` |
| Message key | `tasks.add-button.label`, `errors.sync.stale-revision` | `addTask`, `Tasks.Add`, `tasks.add.Label`, `tasks.add-a-new-task` | `i18n-key`, catalog verifier |
| Placeholder | `{count, number}`, `{taskCount, plural, ...}`, `{listName}` | `{0}`, `{list-name}`, `{COUNT}`, plain `{count}` for a number | `i18n-placeholder` |
| App id | `com.acme.tasks` (iOS and Android); a live `com.Acme.Tasks` listed in `publishedAppIds` | a new `com.Acme.Tasks`, `com.acme.task-list`, `com.acme.new` | `app-id` |
| Product id | `com.acme.tasks.premium`; with the long app id `com.acmecorporation.taskplanner`, `taskplanner.premium_yearly` | `premium`, `com.acme.tasks.Premium-Plus`, `tasks.premium` (the full form fits) | `product-id` |
| Env var | `APP_VARIANT`, `process.env.EXPO_PUBLIC_API_URL` in app code, `process.env.DATABASE_URL` in `src/server/` | `appVariant`, `EXPO_API_URL` read in app code, `const { EXPO_PUBLIC_API_URL } = process.env`, `EXPO_PUBLIC_API_SECRET` read in `src/server/` | `env-var` |
| npm script | `test:golden`, `build:android:emulator` | `testGolden`, `test:Golden` | `npm-script-name` |
| Commit | `feat(tasks): add due dates` | `Added due dates.`, `feat: stuff` | commit-msg hook (git-commits-and-reporting) |
| Release tag | `v1.2.0` (monorepo: `<app>/v1.2.0`) | `1.2`, `release-1.2.0` | the release skills |
