# check-background-tasks.mjs: every rule, its limits and its record

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-background-tasks.mjs [repo-root] [--src-dir <dir>] [--json]
```

Zero dependencies (Node 22+), check-lib output contract: `FAIL <file>:<line> [<rule>] <message> Fix:
<fix>`, the summary, then `RESULT: PASS` or `RESULT: FAIL (<n> problems)`. Exit 0 pass, 1 problems,
2 bad input (no `package.json`, no source folder, a malformed `rn-skills.config.json` key).

## Contents

1. Scope and applicability
2. The rules
3. Configuration
4. Limits (what it cannot see)
5. Verification record

## 1. Scope and applicability

- **NOT APPLICABLE** when `package.json` lists none of `expo-background-task`, `expo-task-manager`
  and `expo-background-fetch` (dependencies or devDependencies).
- Scans the app's source folder (`resolveLayout`, default `src/`) and the entry file
  (`package.json` `main`), skipping test files (`*.test.*`, `test/`, `__mocks__/`), declaration files,
  and every folder that holds a `SKILL.md` (installed skills). `.agents/`, `skills/` and other agent
  folders are outside the scan by construction.
- Reads `app.config.ts|js|mjs|cjs` or `app.json`, and `contracts/native-config.json` when present.
- **Every `defineTask` is in scope**, not only expo-background-task's: a notification task
  (push-notifications' `Notifications.registerTaskAsync(job.name)`) and a location task
  (`Location.startLocationUpdatesAsync(job.name, …)`) are jobs too. Each is a `defineBackgroundJob`
  with its own literal name and budget, its executor is `toTaskExecutor(job, createEnvironment)`, the
  task body's `data` reaches the job as `context.input` and its `error` as `context.error`, and the run
  is recorded under the `background` trigger. Such a job is defined in a registry file named
  `define-<area>-tasks.ts` (for example `define-notification-tasks.ts`) that the entry imports too,
  and stays out of `BACKGROUND_JOBS`: that list is what the reconcile registers with
  expo-background-task, while a notification or location task is registered by its own API. The job
  rules (`job-tested`, `job-no-react`, `job-foreground-path`, …) apply to it unchanged; its foreground
  path is the code that handles the same payload while the app is open, and it is concrete:
  - **Location task:** while the app is open, the app's position watch (expo-location's
    `watchPositionAsync` behind the app's location port) hands each update to the same job:
    `runBackgroundJob(recordLocationJob, environment, { trigger: 'foreground', input: { locations:
    [update] } })`, in a hook outside the background folder that imports the job (fixture
    `pass-location-task-foreground`). The job's test feeds the payload to the kit:
    `runJobTwice(job, deps, { input })` (the same points stored once, keyed by timestamp) and
    `runJobUntilAborted(job, deps, { stopAfterChecks: 1, input })`.
  - **Notification task:** the notification-received listener (push-notifications) runs the same job
    with the notification's data as `input`, while the app is in front.
- **SKIP** `app.config.ts [background-plugin]` while the app has no app config
  (expo-project-bootstrap creates it). A note (not a skip) says `background-plist not applied` when
  there is no native snapshot (expo-prebuild-and-config-plugins writes it).

## 2. The rules

| Rule | Fails when | Why (SKILL.md rule) |
|---|---|---|
| `no-background-fetch` | `expo-background-fetch` is in `package.json` or imported | deprecated, no patches, removed soon (1) |
| `background-plugin` | `expo-background-task` is installed and the app config does not list `'expo-background-task'` (comments ignored; `app.json` `expo.plugins` read as data) | prebuild does not apply it; iOS rejects registration without `processing` (1) |
| `background-plist` | the native snapshot's `ios.infoPlist` lacks `UIBackgroundModes` `processing` or the permitted identifier | the generated native project would reject registration (1) |
| `define-task-top-level` | a `defineTask(` call inside any function body (function, method, arrow block or expression body) | a headless run renders nothing; an undefined task is dropped for good (2) |
| `define-task-entry` | a file with `defineTask(` is not reachable from the entry through static imports (`import`, `export … from`, side-effect imports, `require`; dynamic `import()` and `import type` do not count), or `main` is missing or `expo-router/entry` | only the entry's import graph runs in a headless launch (2) |
| `executor-through-runner` | the second argument of `defineTask(` does not call `toTaskExecutor(` | a rejected executor is only console-logged; no budget, no record (4) |
| `task-name-literal` | the first argument of `defineTask`, `registerTaskAsync`, `unregisterTaskAsync`, `isTaskRegisteredAsync` or `getTaskOptionsAsync` is a string or template literal | one literal per job, in `defineBackgroundJob` (3) |
| `vendor-import-confined` | a value import of `expo-background-task` or `expo-task-manager` in a file not named `*-adapter.(ts\|tsx)` (platform suffixes allowed) or `define-*-tasks.(ts\|tsx)` | app code schedules through the port (9) |
| `minimum-interval` | expo-background-task's `registerTaskAsync` (namespace or named import binding) without a second argument, or with an object literal lacking `minimumInterval`; a `minimumInterval:` number expression below 15 anywhere; a `BACKGROUND_INTERVAL_MINUTES =` below 15 anywhere, or any `*_INTERVAL_MINUTES =` below 15 in the background folder or in a file that imports expo-background-task (a `REFETCH_INTERVAL_MINUTES = 5` in a feature is the app's own and stays silent, fixture `pass-unrelated-interval-constant`) | platform defaults differ; the documented 15-minute minimum, which the library does not clamp on Android 8+ (10) |
| `job-name` | `defineBackgroundJob(` without an object literal, a `name` that is not a string literal matching `<area>.<job>` kebab-case, or a name declared twice | two definitions of a name overwrite each other (3) |
| `job-budget` | `budgetMs` missing, not a number expression (`20_000`, `20 * 1000`), not a whole number, or above the cap | the system may end a run at any moment; 25 s is the design default (5) |
| `job-tested` | the job file has no sibling `<file>.test.ts(x)` that contains both `runJobTwice(` and `runJobUntilAborted(` | idempotent and resumable must be proved (6) |
| `job-no-react` | a job file imports `react`, `react-native`, `expo-router`, `@react-navigation/*`, `zustand` (value imports), or a file under the features, routes, ui or stores folders, or a `*-context` file | a headless run has no React tree (7) |
| `job-no-migrate` | a job file or any file under the background folder mentions `migrateDatabase`, `openAppDatabase`, `openDeviceDatabase` or `openDeviceData` in code; or a non-test file they import directly (the background open path, `src/data/open-background-data.ts`) calls one of them (`name(`). The data layer's `migrations/` folder and a file that defines one of the functions (persistence-and-migrations' foreground open path, imported for a constant such as `APP_DB_FILE`) are left out | background runs never migrate (8) |
| `job-foreground-path` | no non-test file outside the background folder imports the job file, or a non-test background file that imports it (the job list), while calling `runBackgroundJob(` itself; a hook that calls `job.run(` directly, or a screen that reads `job.name`, does not count | the background run may never happen (11) |
| `trigger-dev-only` | a `triggerTaskWorkerForTestingAsync(` call that is not inside a function whose body mentions `__DEV__` | a release build does nothing (the SDK resolves false outside `__DEV__`); the iOS native helper, which calls `fatalError()`, is debug-only and never reached (12) |

A job file is any non-test source file that calls `defineBackgroundJob(` (the declaration in
`background-job.ts` is skipped).

## 3. Configuration

`rn-skills.config.json` (optional, repo root):

```json
{ "backgroundTasks": { "backgroundDir": "src/services/background-tasks", "maxBudgetMs": 20000 } }
```

- `backgroundDir` (default `<servicesDir>/background-tasks`): the folder whose files count as
  background code for `job-no-migrate` and are excluded as callers for `job-foreground-path`.
- `maxBudgetMs` (default and maximum 25000): lowers the budget cap. A larger value is exit 2.
- `--src-dir <dir>` moves the scanned source folder (layout keys in the same file do too).

## 4. Limits (what it cannot see)

- **Semantics of idempotency.** `job-tested` proves the two kit calls exist, not that the assertions
  are strong; the reviewer reads the test.
- **Interval constants are found by name and place.** An interval constant named otherwise and kept
  outside the background folder (`SYNC_EVERY_MINUTES = 5` in `src/config/`) is not read; the reconcile
  throws on it at run time (`MIN_INTERVAL_MINUTES`) and `background-jobs.test.ts` checks the template's
  constant. Keep the one interval in `BACKGROUND_INTERVAL_MINUTES`.
- **Function detection is lexical.** A `defineTask` call inside a class field initializer or a
  getter written in an unusual form may be misjudged; the registry template keeps the call in a plain
  module-scope loop.
- **Bindings.** `minimum-interval`'s call check follows `import * as X from 'expo-background-task'` and
  `import { registerTaskAsync as Y }`; a re-export through another module is not followed (and fails
  `vendor-import-confined` anyway unless it is an adapter).
- **The entry graph** follows the repo's own files through tsconfig `paths` aliases and relative
  imports; a task defined inside a package of `node_modules` is not seen.
- **The foreground path is found through imports.** Two shapes count, both calling
  `runBackgroundJob(`: a hook outside the background folder that imports the job module directly
  (fixture `bad-job-foreground-bypass`: one that calls `job.run(` instead fails), or one that imports a
  background file holding the job, usually `background-jobs.ts` (the
  `for (const job of BACKGROUND_JOBS) runBackgroundJob(job, environment, { trigger: 'foreground' })`
  shape, fixture `pass-foreground-job-list`). The call is required in the second shape so that the
  startup registration hook, which imports the job list only for `backgroundJobNames()`, and the entry
  do not count (the `bad-job-foreground-path` fixture keeps that hook and still fails). The checker
  follows one level of background files and does not check that the call actually receives this job
  or that it passes `trigger: 'foreground'` (TypeScript requires a trigger; the reviewer reads which).
- **The migration scope is one import deep.** `job-no-migrate` reads the files background code imports
  directly; a migration two imports away (a helper the background open path calls) is the reviewer's,
  and so is a call through another name.
- **The fix text of `define-task-entry`** builds the import from the tsconfig `paths` alias whose
  target holds the file (`src/*` → `@/…`), else a path relative to the entry.
- **Expiry and real scheduling** are runtime behaviour: the device proof covers them.

## 5. Verification record

- Self-test (`scripts/selftest.mjs`): the good case is assembled from the shipped templates and
  examples; one `bad-*` case per rule (plus a second case for `define-task-entry`, `minimum-interval`
  and `job-name`), each failing only for its own rule, with the fix text checked where it carries a
  command or a specifier (`npm uninstall`, the `@/…` import); `pass-` cases for NOT APPLICABLE, the
  SKIP, the missing snapshot note, a foreground hook that runs every job through the job list, a
  location task whose foreground path is a position-watch hook (deleting the hook from that case fails
  `job-foreground-path`), an unrelated `*_INTERVAL_MINUTES` constant in a feature, and planted findings
  inside installed-skill folders; `error-` cases for a missing `package.json` and a budget cap above
  25000.
- Round 3 (2026-10-16), on a scratch copy of the reference app with the templates **and every
  example** applied (`src/data/open-background-data.ts` included), the plugin listed and the snapshot
  regenerated: this checker PASS; persistence-and-migrations' check-persistence FAIL
  `sql-outside-repository` on `src/data/open-background-data.ts` until the file is listed in
  `contracts/persistence.json` `sqlAllowed`, then PASS (the example environment holds no driver and
  runs no SQL, so `sqlite-outside-data` and `sql-outside-data` stay silent). Adding
  `src/features/tasks/tasks-refresh.ts` with `REFETCH_INTERVAL_MINUTES = 5` failed `minimum-interval`
  before this round's scope change and passes after it. The hook tests and the job tests pass in Jest
  there; the example environment and data file need the app's own API and outbox modules, so tsc and
  Jest reach them only in an app that has those. On the same copy, with the contract entries of
  api-and-config.md section 6 (`src/data/open-background-data.ts` in `compositionRoot`):
  architecture-and-boundaries' check-boundaries reports only the examples' four imports of those app
  modules (`unresolved-import`); check-layout, error-handling-typed-results' check-error-spine (after
  the runner's message helper moved from a `best-effort` catch to `attempt`) and check-error-net,
  async-safety, tdd-workflow's check-tests (the hook tests included), unit-and-component-tests'
  check-test-code, typescript-and-lint-rules' check-source and both naming-conventions checkers PASS.
  Planted there: dropping `isEnabled` from the registration hook's effect fails its test (once the
  test kept one error log across renders; a log created per render had hidden it); removing the
  foreground hook's active guard fails two of its tests; turning off the poison-change branch fails
  the job test; a `driver.exec(...)` pragma in the environment fails check-persistence three times
  (`sqlite-outside-data` twice, `sql-outside-data`).
- Round 2 (2026-10-14), on a scratch copy of the reference app with the templates and the outbox
  example applied, the plugin listed and the snapshot regenerated: PASS; replacing the foreground hook
  with the job-list loop: PASS; the same loop without the `runBackgroundJob` call: FAIL
  `job-foreground-path`; removing the entry import: FAIL `define-task-entry` with the fix
  `import '@/services/background-tasks/define-background-tasks';`. The background Jest tests (64)
  pass there.
- Reference app (2026-10-14, again 2026-10-16): on the harness as committed, `background-plugin` and `background-plist`
  fail (expo-background-task is installed and its plugin is not listed; the snapshot shows
  `UIBackgroundModes: ["fetch"]` only). With the plugin listed and the snapshot regenerated, and the
  templates applied with the entry import, the checker passes, and so do architecture-and-boundaries'
  check-boundaries (with the contract entries of api-and-config.md section 6) and check-layout,
  error-handling-typed-results' check-error-spine, async-safety, tdd-workflow's check-tests,
  unit-and-component-tests' check-test-code, typescript-and-lint-rules' check-source and
  naming-conventions' checkers. Removing the defineTask loop from that copy fails the registry's Jest
  test, and deleting the foreground hook fails `job-foreground-path`.
