# File, folder and route names

How every kind of file is named, from pure modules to route files and Maestro flows, and the names
tools own. Read this before creating any file or folder. Where a file lives (which folder, which
layer) is the architecture-and-boundaries skill's job; this page owns only the names.

## Contents

- The rule of thumb
- Patterns by kind of file
- Route files (Expo Router)
- Ports, adapters and fakes
- Tests, goldens, simulations and fixtures
- Catalogs, flows, config plugins, scripts
- Tool-owned names
- Where this differs from Expo's expo-project-structure skill
- The path header
- When multi-package

## The rule of thumb

The path answers "what is this?" and "who owns it?". The canonical layout fixes the top of every path
(`src/app/`, `src/features/<feature>/`, `src/ui/`, `src/core/`, `src/services/<concern>/`, `src/stores/`,
`src/data/`, `src/i18n/`, `src/config/`, `test/`, `scripts/`, `plugins/`, `.maestro/`, `contracts/`);
below it, names are kebab-case nouns or verb phrases. Every dot-separated part of a file name is
kebab-case: `tasks-db-v1.full.json`, `app.config.ts`, `badge.golden.test.ts`, `task-row.ios.tsx`.

## Patterns by kind of file

| Kind of file | Pattern | Example | Main export |
|---|---|---|---|
| Pure logic module | `<verb>-<noun>.ts` or `<noun>.ts` | `sort-tasks.ts`, `task-list.ts`, `date-key.ts` | named after the job (`sortTasks`) |
| Screen (pure view) | `src/features/<feature>/<feature>-screen.tsx` | `src/features/tasks/tasks-screen.tsx` | `TasksScreen` + `TasksScreenProps` |
| Model hook | `src/features/<feature>/use-<feature>-model.ts` | `use-tasks-model.ts` | `useTasksModel` |
| Feature component | `src/features/<feature>/components/<noun>.tsx` | `components/task-row.tsx` | `TaskRow` + `TaskRowProps` |
| Nested feature component | `src/features/<feature>/<part>/<noun>.tsx` | `settings/language/language-row.tsx` | `LanguageRow` or `SettingsLanguageRow` |
| Shared UI primitive | `src/ui/<noun>.tsx` | `src/ui/app-button.tsx` | `AppButton` |
| JSX helper module | `src/ui/<noun>.tsx` | `src/ui/icon-path.tsx` | `iconPath` (camelCase is accepted for a function that returns JSX) |
| Hook | `use-<noun-or-verb>.ts`, one hook per file | `use-reduce-motion.ts` | `useReduceMotion` |
| Context module | `<noun>-context.ts(x)`: the context (kept private), its provider and its hook | `press-feedback-context.tsx`, `services-context.tsx` | `PressFeedbackProvider` + `usePressFeedback` (or an exported `XContext`) |
| Provider component alone | `<noun>-provider.tsx` | `i18n-provider.tsx`, `theme-provider.tsx` | `I18nProvider`; a prefix that avoids a library's name is fine (`AppThemeProvider`: expo-router exports a `ThemeProvider`) |
| Store / reducer / selectors | `src/stores/<domain>-store.ts`, `<domain>-reducer.ts`, `<domain>-selectors.ts` | `tasks-store.ts` | `useTasksStore`, `tasksReducer`, `select...` |
| Port type | `src/services/<concern>/<concern>-port.ts` | `clock-port.ts`, `crash-reporter-port.ts` | `ClockPort`, `CrashReporterPort` |
| Adapter | `<library>-<concern>-adapter.ts` | `system-clock-adapter.ts`, `sentry-crash-reporter-adapter.ts` | `createSystemClockAdapter` |
| SQL driver | `src/data/sql-driver.ts` (the port), `<library>-sql-driver.ts` | `expo-sqlite-sql-driver.ts` | `SqlDriver`, `createExpoSqliteSqlDriver` |
| Fake | `fake-<concern>.ts` | `fake-clock.ts` | `createFakeClock` |
| Root kit (app-startup-and-bootstrap's slots) | `<concern>-root-kit.tsx` | `push-root-kit.tsx`, `debug-root-kit.tsx` | `createPushKit`, `createDebugKit` |
| Ambient declarations | `<topic>.d.ts` | `src/app-env.d.ts`, `src/env.d.ts` | none |
| Closed set of values | `<noun>.ts` from `templates/string-union.ts` | `task-priority.ts` | `TASK_PRIORITIES`, `TaskPriority`, `isTaskPriority` |
| Message catalog | `src/i18n/catalogs/<locale>.json` | `en.json`, `ar.json`, `pt-BR.json` | none |
| Frozen data fixture | `src/data/**/fixtures/<name>-v<N>[.<case>].json` | `tasks-db-v1.json`, `backup-v2.empty.json` | none |
| Maestro flow | `.maestro/flows/<area>/<nn>-<name>.yaml` | `.maestro/flows/smoke/01-add-task.yaml` | none |
| Maestro sub-flow | `.maestro/subflows/<name>.yaml` | `.maestro/subflows/grant-notifications.yaml` | none |
| Flow CI does not run | `.maestro/<folder>/<name>.yaml`, the folder declared in `contracts/naming.json` `extraE2eFolders` | `.maestro/screenshots/matrix.yaml` | none |
| Config plugin | `plugins/with-<capability>.ts` | `plugins/with-android-queries.ts` | default export `withAndroidQueries` |
| Server API route | `src/app/**/<name>+api.ts` | `src/app/api/tasks+api.ts` | named `GET`, `POST`, ... |
| Server helper | `src/server/<noun>.ts` (imported only by API routes and middleware) | `src/server/database.ts` | named after the job |
| Node script | `scripts/<area>/<verb>-<noun>.ts` | `scripts/i18n/verify-catalogs.ts` | the function it runs |
| Level table (games plugin) | `src/games/<game-id>/levels/pack-<n>.json` | `src/games/lights-out/levels/pack-1.json` | none |

`check-file-names.mjs` checks the main export (`export-name`) for hooks, screens, `src/ui` and
`src/features` components, context modules, adapters, `*-sql-driver.ts` implementations, fakes,
ports, store hooks in `src/stores/`, reducers and config plugins. In a `use-x.ts` that does export
`useX`, any other exported hook must be called in the same file, as a building block of `useX`
(`one-hook-per-file`); one it never calls moves to its own `use-<name>.ts`.

**A context module** is the one place a hook shares a file: `createContext` stays private in
`<noun>-context.tsx`, beside the provider that fills it and the `use<Noun>` hook that reads it, so no
other file can read the context without the hook's checks. The main export is `<Noun>Provider`
(or `use<Noun>`, or the context itself as `<Noun>Context` when another module must provide it).

**A component that grows** gets its own folder, and the folder's root file is named after the
component, with its private parts beside it: `src/ui/table/table.tsx` (exports `Table`),
`src/ui/table/table-header.tsx`. Expo's official expo-project-structure skill puts that root in
`index.tsx`; this library does not ("Where this differs from Expo's expo-project-structure skill"
below lists every naming point where the two differ).

## Route files (Expo Router)

Files in `src/app/` are routes and nothing else (routes are thin: each renders a
screen from `src/features/`). Their names are URL segments, so they follow the router's grammar:

| Name | Meaning | Default export |
|---|---|---|
| `_layout.tsx` | the layout of its folder (Stack, Tabs) | `<Name>Layout` (`RootLayout`, `TabsLayout`) |
| `index.tsx` | the folder's own route | `<Name>Route` (`TasksRoute`) |
| `task-details.tsx` | a static segment, kebab-case | `TaskDetailsRoute` |
| `[taskId].tsx`, `[taskId]/` | a dynamic segment; the param is camelCase | `TaskDetailsRoute` |
| `[...rest].tsx` | a catch-all | `<Name>Route` |
| `(tabs)/`, `(auth)/`, `(a,b)/` | a group: shapes the layout, not the URL; kebab-case inside | — |
| `+not-found.tsx` | the unmatched route | `NotFoundRoute` |
| `+html.tsx`, `+native-intent.tsx` | web root document, incoming native URL rewrite | exempt (their own APIs) |
| `<name>+api.ts` | a server API route (web output) | named `GET`/`POST` functions |
| `about.web.tsx` | a platform-specific route | as above |

- Renaming a route file changes a URL. Deep links, universal links (iOS) and app links (Android),
  push payloads and saved bookmarks still point at the old path: add a redirect (or keep the old file
  rendering a `<Redirect />`) and hand off to deep-links-and-universal-links.
- The ESLint routes block lets the route grammar through and keeps the default export legal there;
  `check-file-names.mjs` adds what a glob cannot see: camelCase params (`route-segment`) and the
  `<Name>Route` / `<Name>Layout` default export (`route-export-name`).
- The testID scope of a screen is its route path in kebab-case (`tasks`, `task-details`,
  `settings-language`).

## Ports, adapters and fakes

A port is named after its concern: `ClockPort` in `clock-port.ts`, `CrashReporterPort` in
`crash-reporter-port.ts`. A few ports keep a role noun instead of the `Port` suffix because the noun is
clearer (`SqlDriver` in `sql-driver.ts`, `ApiClient` in `api-client.ts`). That gives, for example:

```
src/services/
  clock/          clock-port.ts  system-clock-adapter.ts  fake-clock.ts
  crash-reporter/ crash-reporter-port.ts  sentry-crash-reporter-adapter.ts  fake-crash-reporter.ts
  push/           push-port.ts  expo-notifications-push-adapter.ts  fake-push.ts
src/data/
  sql-driver.ts  expo-sqlite-sql-driver.ts  tasks-repository.ts
```

- An adapter's factory is `create` + the PascalCase file name: `createSystemClockAdapter`,
  `createExpoSqliteSqlDriver`, `createFakeClock`.
- A type ending in `Port` lives in its own `<concern>-port.ts` (`port-file`); one port per file.
- Test doubles of our own code are in-memory fakes named `fake-<concern>.ts`, never `*.mock.ts`,
  `mock-*.ts` or `*-mock.ts` (`fake-file`). Root `__mocks__/<package-name>.ts` exists only for vendor
  SDKs that crash when imported in Jest, and mirrors that package's own names. A test is named after
  its subject, so a test of a vendor mock may say so (`test/skia-mock.test.tsx`).
- Port names the app depends on are listed in `contracts/naming.json` `canonical.types`; renaming one
  is a stop-and-ask decision (`canonical-name`).

## Tests, goldens, simulations and fixtures

| Kind | File | Runs in |
|---|---|---|
| Unit / component | `<unit>.test.ts(x)` next to the unit | `npm test` (Jest project `unit`) |
| Pixel or data golden | `<unit>.golden.test.ts` | `npm run test:golden` (project `golden`) |
| Simulation (slow, many runs) | `<unit>.sim.test.ts` | `npm run test:sim` (never pre-commit) |
| Performance | `<unit>.perf.test.ts` | `npm test` |
| Android-only behaviour (`.android.tsx` files, `Platform.OS`) | `<unit>.android.test.tsx` | `npm test` (Jest project `android`); `<unit>.ios.test.tsx` runs in `unit`, which is iOS |
| Web-only behaviour (a `.web.ts` sibling) | `<unit>-web.test.ts`, importing the `.web` file by its full name | `npm test` (`unit`); there is no web Jest project, so `.web.test` is refused (`test-file`) |
| Node-API test (`node:sqlite`, `fs`) | `test/<area>/<name>.test.ts` (repo root) | `npm test` |
| Test helper | `test/<noun>.ts(x)` | imported through `@test/` |
| Frozen data fixture | `fixtures/<name>-v<N>[.<case>].json` next to the migration tests | gated (a `Gate-Change:` commit) |

No `.spec` files and no `__tests__/` folders (`test-file`). Fixture builders inside tests are
`make<Thing>()` (`makeTask({ isDone: true })`). A frozen fixture carries its schema version in the
name because migration tests load every old version by name (`fixture-file`).

## Catalogs, flows, config plugins, scripts

- **Catalogs** are one flat JSON file per locale in `src/i18n/catalogs/`, named after the BCP 47 tag
  with its canonical casing: `en.json`, `ar.json`, `pt-BR.json`, `zh-Hans.json`, `es-419.json`
  (`catalog-file`). These are the only files exempt from kebab-case, because the tag's casing is part
  of its meaning. With `contracts/naming.json` `locales`, only those tags are accepted. Never create
  two catalogs that differ only by case (`pt-BR.json` and `pt-br.json`): on a case-insensitive Mac
  they are one file.
- **Maestro flows** are `.maestro/flows/<area>/<nn>-<name>.yaml`: a two-digit order first, always in
  an area folder (`smoke`, `journeys`, `rtl`, `a11y`, ...), because Maestro runs only the top-level
  files of the folder it is given (`flow-file`). Shared steps live in `.maestro/subflows/<name>.yaml`
  (kebab-case, no number) and are never run on their own: a sub-flow placed under `flows/` would run as
  a flow and fail. Only Maestro's `config.yaml` sits loose at the top of `.maestro/`. A flow in an
  area folder directly under `.maestro/` (`.maestro/a11y/large-text.yaml`) is one no CI run includes,
  because CI runs the area folders under `.maestro/flows/`: move it to
  `.maestro/flows/a11y/03-large-text.yaml`. A
  folder of flows that CI deliberately does not run (a screenshot matrix run by its own npm script,
  StoreKit tests run by a harness, a by-hand checklist) is declared in `contracts/naming.json`
  `extraE2eFolders` with its `why`; its files are kebab-case and sit directly inside it.
- **Config plugins** are `plugins/with-<capability>.ts` and default-export `with<Capability>`
  (`plugin-file`, `export-name`), the Expo convention for config plugins on both platforms
  (`with-android-manifest-queries.ts`, `with-ios-background-modes.ts`).
- **Node scripts** are `<verb>-<noun>.ts` inside an area folder of `scripts/` (`build/`, `release/`,
  `e2e/`, `i18n/`, `quality/`, `audit/`, ...).

## Tool-owned names

Tool-owned files keep the tool's spelling: `package.json`, `app.config.ts`, `eas.json`,
`eslint.config.mjs`, `jest.config.js`, `jest.setup.ts`, `babel.config.js`, `metro.config.js`,
`tsconfig.json`, `expo-env.d.ts`, `.maestro/config.yaml`, `google-services.json` and
`GoogleService-Info.plist` (Firebase), `__mocks__/<package-name>.ts`, Jest's `__snapshots__/` and
`__image_snapshots__/`, `README.md`, `AGENTS.md`. Generated native projects (`ios/`, `android/`) are
never named by hand (Continuous Native Generation writes them). Font files keep their upstream names
inside `assets/`. The checkers skip `__mocks__/`, `__snapshots__/`, `__image_snapshots__/`, `assets/`,
`baselines/` and `generated/` folders for kebab-case.

## Where this differs from Expo's expo-project-structure skill

Expo's official expo-project-structure skill is the reference for Expo's own project conventions, and
this library follows it on most points (kebab-case files, `src/app/` routes, `+api.ts` routes,
`src/server/` for server helpers). It differs on three naming points that an agent with both skills
installed will meet; in an app that uses these skills, this library's rule wins, because its checkers
enforce it:

| Expo's skill | This library | Why | Rule |
|---|---|---|---|
| A grown component's root in `index.tsx` (`src/ui/table/index.tsx`) | `src/ui/table/table.tsx` | an `index.tsx` root is a barrel by another name: imports read `@/ui/table` instead of the file that defines the symbol, and barrels invite import cycles | `barrel-index` |
| Route files `export default function HomeScreen()` | `export default function HomeRoute()`; `HomeScreen` is the view in `src/features/` | two symbols named `HomeScreen` make every grep and stack trace ambiguous | `route-export-name` |
| `src/utils/` for standalone helpers | each helper named after its job, next to its user (`src/core/dates/add-days.ts`) | a grab-bag folder grows without limit and says nothing about its contents | `grab-bag-folder` |

Where a file belongs in this layout is the architecture-and-boundaries skill's job.

## The path header

This skill owns the path-header rule; other skills (typescript-and-lint-rules, every skill that ships
templates) cite it rather than restate it. Line 1 of every `.ts`, `.tsx`, `.js`, `.mjs` and `.cjs`
file the repo owns is a comment holding its repo-relative path:

```ts
// src/ui/app-text.tsx: the one component that renders React Native's Text.
```

- **The path comes first**, relative to the repo root exactly as `git ls-files` prints it (forward
  slashes, no `./`; when multi-package, `// apps/mobile/src/ui/app-text.tsx`). A short
  note may follow after `: ` or a space: `// babel.config.js — generated by npx expo customize`
  passes; `// Runs before each test file` (no path) and `// src/core/date-key.ts` in
  `src/core/dates/` (a stale path) fail (`path-header`).
- **A `#!` line stays on line 1** and the header goes on line 2 (`#!/usr/bin/env node`, then
  `// scripts/release/bump-build-number.mjs`).
- **A file-level directive goes after the header**: `'use dom';` for an Expo DOM component,
  `'worklet';` for a Reanimated worklet module. JavaScript requires a directive to be the first
  statement, and a comment is not a statement, so the header above it changes nothing:

  ```tsx
  // src/features/tasks/components/task-chart.tsx: an Expo DOM component.
  'use dom';
  ```

- **Where it is checked:** `.ts`/`.tsx` files in `src/`, `test/`, `scripts/`, `plugins/`,
  `__mocks__/` and the repo root, and `.js`/`.mjs`/`.cjs` files in the same places (`babel.config.js`,
  `metro.config.js`, `eslint.config.mjs`, a `scripts/` tool). A file a tool rewrites on its own is
  exempt: `expo-env.d.ts`, which Expo regenerates on every start. A file that `npx expo customize`
  writes gets the header the first time the app commits it.
- **Files without comments:** JSON cannot hold one, so a JSON file's path is its location (and a
  JSON template sits at its repo path under the skill's `templates/`). YAML and shell templates that a
  skill ships start with `# <path>` (`# .maestro/flows/smoke/01-add-task.yaml`, after a `#!` line in a
  shell script), because template placement reads it; the checker does not require it of YAML in the
  app, where Maestro Studio, EAS and CI write YAML of their own.
- **Templates:** every template's line 1 names the repo path it is copied to, in the form above
  (placeholders allowed: `// src/features/__FEATURE__/use-__FEATURE__-model.ts`); the template
  verifier places files by it.
- **Moving a file** updates its header in the same commit, together with its main export and its
  imports. Moving the single app into a workspace (`apps/<app>/`) moves every header with it
  (`// src/ui/app-text.tsx` becomes `// apps/<app>/src/ui/app-text.tsx`); expo-project-bootstrap's
  "When multi-package" has the one command that rewrites them.

The header is on by default because agents and reviewers read code out of context (a diff hunk, a
pasted snippet, a log). A repo that does not want it sets `"pathHeader": false` in
`contracts/naming.json` and the rule stops (templates still carry the header, because placement needs
it).

## When multi-package

With npm workspaces (`apps/*` + `packages/*`), every workspace is scanned with its own layout
(`<workspace>/src/app`, `<workspace>/src/features`, ...), read from `package.json` `workspaces` (never
from hard-coded folders):

- A workspace package is named `@<scope>/<folder>`, and every workspace uses one scope
  (`package-name`): `@acme/ui` in `packages/ui`, `@acme/billing` in `packages/billing`.
- An app workspace's folder and its slug are independent by default: `apps/mobile` with
  `slug: 'acme-tasks'` is fine, because the slug names the EAS project and must never change once
  that project exists, while folders get renamed. A new repo may choose one name for both
  (`apps/planner` with `slug: 'planner'`): set `"slugMatchesAppFolder": true` in
  `contracts/naming.json` and `app-id` then fails a mismatch, with the fix "rename the folder", never
  "change the slug".
- A package that ships its own catalogs prefixes every key with its folder name
  (`billing.paywall.title`), and the app's catalogs never use a package's prefix
  (`i18n-key-namespace`).
- Imports between packages carry the file extension (`@acme/ui/app-button.tsx`): the typescript-and-lint-rules
  skill owns that rule.
