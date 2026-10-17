# Identifiers, types, React parts, stores and actions

How values, constants, types, components, hooks, handlers, props, routes, stores, reducers and actions
are named, with the naming part of the ESLint flat config that enforces most of it. Read this when
naming anything inside a file, or when `@typescript-eslint/naming-convention` reports an error.

## Contents

- Identifiers
- Types
- React: components, hooks, props, handlers, screens
- Routes (Expo Router)
- Stores, reducers and actions
- The enforcing ESLint configuration
- Appendix: React Navigation 7 static API

## Identifiers

| Kind | Format | Example |
|---|---|---|
| Local variable, parameter, function, method | camelCase, a verb for functions | `nextDueDate`, `sortTasks`, `formatDueDate` |
| Module-level fixed data (a literal, a regex, an `as const` table) | UPPER_CASE | `MAX_TITLE_LENGTH`, `TASK_FILTERS`, `DUE_DATE = /^\d{4}-\d{2}-\d{2}$/u` |
| Module-level object created by a call | camelCase | `styles = StyleSheet.create(...)`, `queryClient = new QueryClient()` |
| Component (a function or a variable holding one) | PascalCase | `TaskRow`, `TasksScreen` |
| Boolean | prefixed | `isDone`, `canUndo`, `hasReminder`, `IS_PREVIEW_BUILD` |
| Unused parameter | `_` + name | `(_event, isSuccess) => ...` |
| Type, type alias | PascalCase | `TaskList`, `SettingsState` |
| Type parameter | `T` / `TName` | `Result<TValue, TError>` |
| Object keys | any (mirror the data) | `{ 'max-lines': ... }`, `{ paddingStart: ... }` |

- Leading or trailing underscores are forbidden everywhere else (`_cache`, `value_`), including
  "private" module state: use a non-exported `const` instead.
- Acronyms are words: `SqlDriver`, `isRtl`, `ApiClient`, `loadHttpUrl` (`acronym-case`). External
  names stay as their owner spells them (`I18nManager.isRTL`, the `testID` prop, `EXPO_PUBLIC_API_URL`).
- Booleans read as questions: `is`, `has`, `can`, `should`, `did`, `will`, `was`. UPPER_CASE booleans
  use `IS_`, `HAS_`, ... The ESLint boolean selector checks the name after the prefix: `isReady` →
  `Ready` (PascalCase), `IS_PREVIEW_BUILD` → `PREVIEW_BUILD` (UPPER_CASE).
- Destructured booleans are renamed while destructuring: `const { granted: isGranted } = permission`,
  `({ disabled: isDisabled }: ButtonProps)`. A bare destructured `granted` and a `{ disabled }`
  parameter both fail naming-convention, and the renamed forms pass (verified 2026-10-03 against the
  canonical config in the reference Expo app).
- Units and meaning live in the name when the type cannot carry them: `delayMs`, `dueAtMs`,
  `priceMinorUnits`, `widthDp`. A bare `delay`, `total` or `width` invites a unit bug.
- Functions are verb phrases (`loadTasks`, `scheduleReminder`); values are noun phrases (`taskCount`,
  `nextDueDate`). No `get` prefix on a pure value accessor (`dueTasks(state)`, not `getDueTasks`).

## Types

- `type` aliases only. `interface` appears only inside `*.d.ts` files that merge into a global
  namespace (`NodeJS.ProcessEnv` in `src/env.d.ts`), because merging needs it.
- No `I` prefix (`IClockPort`), no plain `Props` or `State` outside tests (`type-name`).
- Props: `<Component>Props`. State: `<Domain>State`. Actions: `<Domain>Action`. Ports:
  `<Concern>Port` (or a role noun such as `SqlDriver`). Result errors: `<Operation>Error`
  (`SyncError`, `PurchaseError`), always a `kind` union. Options objects: `<Function>Options`.
- Literal unions for closed sets: `type Direction = 'ltr' | 'rtl'`. When the set is also needed at
  runtime, derive the type from an `as const` array so the two never drift
  (`templates/string-union.ts`).
- Games plugin: a game's concrete engine types carry the game id in PascalCase (`LightsOutState`,
  `LightsOutMove`, `LightsOutEvent`); generic engine code uses type parameters (`TState`, `TMove`).

## React: components, hooks, props, handlers, screens

The shape to imitate is `examples/task-row.tsx`:

- The component is named after its file (`task-row.tsx` → `TaskRow`), has a `<Component>Props` type
  and a named export, and gets a one-sentence TSDoc summary.
- Event handlers declared inside a component are `handleX` (`handlePress`); callback props are `onX`
  (`onToggle`). Pass a callback prop straight through when nothing else happens (`onPress={onPress}`);
  otherwise wrap it in a `handleX`. Inside a `.tsx` file a local function named `onPress`, or a local
  function `press` passed to an `on*` prop, is wrong (`handler-name`). A hook may name the callbacks
  it wires into a worklet after their slot (`onDone`), and an `on*` prop may take a value that is not a
  function (Skia's `onSize={size}` takes a shared value). Handlers are synchronous (the async-safety
  skill owns that rule).
- Boolean props follow the prefix rule (`isSelected`) unless React Native already names the prop
  (`disabled`, `selected`, `visible`), in which case the RN name wins so the prop passes straight
  through; destructure it with a rename (`{ disabled: isDisabled }`).
- Hooks: `use` + PascalCase verb or noun (`useTasksModel`, `useReduceMotion`), one hook per
  `use-*.ts` file (`one-hook-per-file`). A second hook may be exported there only as a building
  block the file's own hook calls (`useFontScale`, called by `useTextStyle` in `use-text-style.ts`);
  a hook nothing in the file calls is a separate job and gets its own `use-<name>.ts`. The other
  exception is a context module: `<noun>-context.tsx` keeps `createContext` private beside
  `<Noun>Provider` and the `use<Noun>` hook that reads it (`PressFeedbackProvider` +
  `usePressFeedback`), so nothing reads the context around the hook.
- Screens: `<Name>Screen` in `src/features/<feature>/<name>-screen.tsx`, a pure view of its props; the
  feature's model hook is `use-<feature>-model.ts` → `use<Feature>Model`.

## Routes (Expo Router)

- A route file's default export is a named function `<Name>Route` (`TaskDetailsRoute`,
  `NotFoundRoute`), and `<Name>Layout` in `_layout.tsx` (`RootLayout`, `TabsLayout`) (`route-export-name`).
  Never anonymous, and never `<Name>Screen`: that name belongs to the screen in `src/features/`.
- Route params are camelCase (`[taskId].tsx` → `useLocalSearchParams<{ taskId: string }>()`), group
  folders kebab-case in parentheses (`(tabs)`), static segments kebab-case (`task-details.tsx`).
- The router's own named exports keep the router's spelling: `unstable_settings`, `ErrorBoundary`,
  `generateStaticParams` (the ESLint routes block allows `unstable_settings`).
- The testID scope of a route's screen is the route path in kebab-case (`tasks`, `task-details`).

## Stores, reducers and actions

Logic lives in pure reducers and Zustand stores stay thin. Names:

| Part | File | Export |
|---|---|---|
| State type | `tasks-reducer.ts` | `type TasksState` |
| Action union | `tasks-reducer.ts` | `type TasksAction` |
| Reducer | `tasks-reducer.ts` | `tasksReducer(state, action)` |
| Default state | `tasks-reducer.ts` | `DEFAULT_TASKS_STATE` |
| Store hook | `src/stores/tasks-store.ts` | `useTasksStore` |
| Selectors | `src/stores/tasks-selectors.ts` | `selectOpenTasks(state)` |

Actions carry a `type` discriminant whose value is an imperative, kebab-case request to the reducer
(`examples/tasks-reducer.ts`). Standard verbs, so the same intent has the same word everywhere:

| Verb | Meaning | Example |
|---|---|---|
| `set-<field>` | replace a value | `set-filter`, `set-theme` |
| `toggle-<flag>` | flip a boolean | `toggle-editing`, `toggle-sound` |
| `reset-<thing>` | back to defaults | `reset-selection`, `reset-settings` |
| `add-<thing>` / `remove-<thing>` | grow or shrink a collection | `add-task`, `remove-reminder` |
| `record-<fact>` | append a fact | `record-sync-result` |
| session verbs (games plugin) | control a game session | `apply-move`, `undo`, `use-hint`, `pause`, `resume`, `restart-<thing>` (`restart-level`) |

## The enforcing ESLint configuration

These are the naming parts of the one `eslint.config.mjs` (the typescript-and-lint-rules skill holds
the complete file and changes it; quoted here as of 2026-10-03, ESLint 9.39 and typescript-eslint 8.70):

```js
const BOOLEAN_PREFIXES = ['is', 'has', 'can', 'should', 'did', 'will', 'was'];
const NAMING_CONVENTION = [
  { selector: 'default', format: ['camelCase'], leadingUnderscore: 'forbid', trailingUnderscore: 'forbid' },
  { selector: 'import', format: ['camelCase', 'PascalCase'] },
  { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
  // React components are PascalCase functions.
  { selector: 'variable', types: ['function'], format: ['camelCase', 'PascalCase'] },
  { selector: 'function', format: ['camelCase', 'PascalCase'] },
  {
    selector: 'variable',
    types: ['boolean'],
    format: ['PascalCase', 'UPPER_CASE'],
    prefix: [...BOOLEAN_PREFIXES, ...BOOLEAN_PREFIXES.map((p) => `${p.toUpperCase()}_`)],
  },
  { selector: 'variable', modifiers: ['destructured'], format: null },
  { selector: 'parameter', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
  { selector: 'parameter', types: ['boolean'], format: ['PascalCase'], prefix: BOOLEAN_PREFIXES, leadingUnderscore: 'allow' },
  { selector: 'typeLike', format: ['PascalCase'] },
  { selector: 'typeParameter', format: ['PascalCase'], custom: { regex: '^(T|T[A-Z][A-Za-z]+)$', match: true } },
  // Object keys may mirror external APIs, style props or catalog keys.
  { selector: ['objectLiteralProperty', 'typeProperty'], format: null },
];
```

File and folder names (`eslint-plugin-check-file` 3.3):

```js
'check-file/filename-naming-convention': ['error', { '**/*.{ts,tsx}': 'KEBAB_CASE' }, { ignoreMiddleExtensions: true }],
'check-file/folder-naming-convention': ['error', { '{test,scripts,plugins}/**/': 'KEBAB_CASE', 'src/!(app)/**/': 'KEBAB_CASE' }],
'check-file/filename-blocklist': ['error', {
  '**/{util,utils,helper,helpers,misc,common,shared,stuff}.{ts,tsx}': '**/[a-z]*-[a-z]*.ts',
  'src/!(app)/**/index.{ts,tsx}': '**/[a-z]*-[a-z]*.ts',          // app runtime code only
}],
// Routes block (src/app/**): the router grammar instead of KEBAB_CASE. Expo Router names: index,
// _layout, +not-found / +html / +native-intent / +middleware, [param], [...rest], (group), API routes
// (tasks+api, [taskId]+api), plus kebab-case segments. A param starts with a lowercase letter.
const ROUTE_FILE =
  '@(_layout|index|+([a-z0-9-])|+(+)+([a-z-])|\\[*(.)[a-z]*([a-zA-Z0-9])\\]|+([a-z0-9-])\\+api|\\[*(.)[a-z]*([a-zA-Z0-9])\\]\\+api)';
const ROUTE_FOLDER = '@(+([a-z0-9-])|\\(+([a-z0-9-])\\)|\\[*(.)[a-z]*([a-zA-Z0-9])\\])';
```

`check-file` requires a blocklist suggestion to be a valid glob; `**/[a-z]*-[a-z]*.ts` reads as "a
descriptive kebab-case name". A free-text suggestion makes the rule crash on every file. Both
ESLint (the `[a-z]` after the optional `...` in `ROUTE_FILE` and `ROUTE_FOLDER`) and
`check-file-names.mjs` `route-segment` reject an uppercase param (`[TaskId].tsx`, `[TaskId]/`,
`[...Rest].tsx`); `route-segment` also runs without `node_modules`. Verified on 2026-10-03 against the
canonical `eslint.config.mjs` with micromatch (the glob engine of `eslint-plugin-check-file`):
`[taskId]`, `[...rest]` and `[taskId]+api` match, `[TaskId]` and `[...Rest]` do not. Re-verify: in an
app with `node_modules`, `node -e "console.log(require('micromatch').isMatch('[TaskId]', ROUTE_FILE))"`
with the glob pasted in, or rename a route to `[TaskId].tsx` and run `npx eslint src/app`.

The `kind`/`type` value and testID selectors (entries of the `no-restricted-syntax` table for app code
and tests), quoted from the canonical `eslint.config.mjs` on 2026-10-03:

```js
const KEBAB = '[a-z0-9]+(-[a-z0-9]+)*';
// A MIME type (`type: 'image/jpeg'` in a multipart part, getDocumentAsync({ type: 'application/pdf' }))
// is an external data format, not an app kind.
const MIME_TYPE = '/^[a-z]+\\/[a-z0-9.+-]+$/';
testIdFormat: {
  selector: `JSXAttribute[name.name='testID'] > Literal[value!=/^${KEBAB}(\\.${KEBAB})+$/]`,
  message: "testID is '<screen>.<element>' in kebab-case, e.g. 'tasks.add-button'.",
},
kindValue: {
  selector: `Property[key.name=/^(kind|type)$/] > Literal[value=/[^a-z0-9-]/][value!=${MIME_TYPE}]`,
  message: "`kind`/`type` values are kebab-case string literals, e.g. 'task-completed'.",
},
kindTypeValue: {
  selector: `TSPropertySignature[key.name=/^(kind|type)$/] TSLiteralType > Literal[value=/[^a-z0-9-]/][value!=${MIME_TYPE}]`,
  message: "`kind`/`type` values are kebab-case string literals, e.g. 'task-completed'.",
},
```

**Where ESLint and `kind-value` still differ.** Both skip a plain MIME type (`'application/json'`,
`'image/svg+xml'`). `check-code-names.mjs` (`assets/naming-rules.json` `mimeType`) also skips a MIME
type with parameters or a wildcard (`'text/csv;charset=utf-8'`, `'image/*'`, `'*/*'`), the `type:`
inside a react-hook-form `setError(...)` call (`{ type: 'maxLength' }`), and `type:` values in test
files (valibot's `'min_length'`); the canonical selectors do not yet, so ESLint still reports those.
typescript-and-lint-rules owns the config, and this selector closes the gap (verified on 2026-10-03
with esquery 1.7.0, the version ESLint 9 uses in the reference app: it still reports
`kind: 'taskCompleted'` and `type: 'setFilter'`, and no longer the MIME values or `setError`'s type):

```text
:not(CallExpression:matches([callee.name='setError'], [callee.property.name='setError']) > ObjectExpression)
  > Property[key.name=/^(kind|type)$/]
  > Literal[value=/[^a-z0-9-]/][value!=/^([a-z]+|\*)\/([a-z0-9.+-]+|\*)(\s*;\s*[a-z0-9-]+=[^;]+)*$/]
```

Until the config carries it: keep a MIME value with parameters in its adapter, and give a manual
`setError` a kebab-case type of the app's own (`{ type: 'too-long' }`); react-hook-form's
`ErrorOption.type` accepts any string (`LiteralUnion<keyof RegisterOptions, string>` in
react-hook-form 7.89.0). Use a built-in name such as `'maxLength'` only where the code compares it with
what react-hook-form's own rules produce. In a test, assert a library's value as a field
(`expect(result.issues?.[0]?.type).toBe('min_length')`) rather than inside an object literal. Never
add an inline disable: they are switched off.

Verified on 2026-10-03 in a copy of the reference Expo app (canonical config): a probe file produced
errors for `BadName.tsx`, folder `BadDir/`, `src/app/TaskList.tsx`, `src/app/tasks/[task-id].tsx`,
group folder `(Tabs)/`, a destructured boolean `granted`, boolean `loading`, boolean parameter
`visible`, a `{ disabled }` parameter, constant `Bad_name`, an `enum`, testID `HomePlay`,
`kind: 'ColumnCleared'` (object) and `kind: 'blockPlaced'` (type literal); the renamed forms passed.
ESLint only sees literal testIDs; `check-code-names.mjs` also checks template testIDs, list indexes and
role suffixes. Re-verify: copy a probe file into the app and run `npx eslint <file> --max-warnings 0`.

## Appendix: React Navigation 7 static API

For an app that uses React Navigation instead of Expo Router:

- `const rootStack = createNativeStackNavigator({ screens: { ... } })` is camelCase (a config
  object), and `export const Navigation = createStaticNavigation(rootStack)` is PascalCase (a
  component). The React Navigation docs spell the first `RootStack`; naming-convention rejects that
  (`Variable name RootStack must match one of the following formats: camelCase, UPPER_CASE`; verified
  with React Navigation 7 installed on 2026-09-26, and again on 2026-10-03 in the reference app, which
  does not install React Navigation), so write `rootStack` and `StaticParamList<typeof rootStack>`.
- Route names are PascalCase (`Tasks`, `TaskDetails`, `SettingsLanguage`); the testID scope is the
  route name in kebab-case (`task-details`, `settings-language`); params are camelCase
  (`{ taskId: string }`).
- The route-file rules (`route-segment`, `route-export-name`) do not apply: there is no `src/app/`.
