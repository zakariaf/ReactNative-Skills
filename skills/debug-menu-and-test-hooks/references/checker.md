# check-test-hooks: rules, fixtures and configuration

`node ${CLAUDE_SKILL_DIR}/scripts/check-test-hooks.mjs [repo-root] [--contract <file>] [--json]`.
Zero dependencies (Node 22.18 or newer): it reads the app's files, and loads the registry and the two
simulations as pure TypeScript through Node's type stripping to run them.

## Contents

- Rules
- What it prints
- Configuration
- When multi-package
- The self-test

## Rules

| Rule | Fails when | Fix |
|---|---|---|
| `gate-file` | test-only code exists (an entry, a `TEST_ONLY` reader, the contract) but `<srcDir>/test-only.ts` does not; the gate has no `test-only-entry.ts` beside it; a second gate or entry exists | copy the template pair; one gate |
| `gate-form` | the gate is not exactly `TEST_ONLY: TestOnlyApi \| null = process.env.EXPO_PUBLIC_APP_VARIANT === 'production' ? null : (require('./test-only-entry') as TestOnlyApi)`; it requires anything else; it runs other code. The message names the trap (`__DEV__`, `NODE_ENV`, polarity, an imported constant, an `if`) | the template's expression |
| `api-derived` | `TestOnlyApi` is written by hand (in the gate or a `test-only-api.ts`) | `import type * as TestOnlyEntry from './test-only-entry'; export type TestOnlyApi = typeof TestOnlyEntry;` |
| `sentinel` | no `TEST_BUILD_SENTINEL`; two sentinels; another name; a value that is not `<APP>_TEST_BUILD_ONLY`; the text in another app file's code | one unique sentinel in the entry |
| `entry-manifest` | the entry holds anything but `export { ... } from` lines and the sentinel | move the code into its test-only folder |
| `entry-reachable` | an entry export (not the sentinel) is read as `TEST_ONLY?.<name>` nowhere outside the test-only folders | wire it, or drop it |
| `hooks-wired` | the file that calls `TEST_ONLY?.createTestHooks` (or `TEST_ONLY.createTestHooks` behind a null check, the ternary form) never reads the result's `services` | hand `testHooks?.services ?? device` to the app |
| `test-only-folders` | a folder the entry re-exports from is not in `contracts/architecture.json` `testOnlyFolders`; a re-export does not resolve | add the folder |
| `debug-registry` | the contract or the registry is missing or unreadable; the registry lacks `DEBUG_LINK_PATH`, `DEBUG_LINK_PARAMS` or `parseDebugLink`; the two disagree on the path, a parameter or a value | change both in one commit |
| `registry-strict` | the parser accepts an unknown parameter, a repeated one or a bad value, or refuses a listed value | the template's strict parser |
| `link-route` | no Expo Router route answers the link path; the route does not hand `useLocalSearchParams()` to a screen read through `TEST_ONLY` | copy `templates/src/app/(debug)/` |
| `simulated-clock` | `createSimulatedClock` is missing while the entry exports `createTestHooks`; it does not change `today()` live, or does not forward `nowMs()` and `msUntilNextLocalDay()` at call time | the template |
| `simulated-connectivity` | the port lacks a member; it does not report `none` while offline, leaks real changes, misses the real value after, repeats unchanged values, or `stop()` leaves a listener; no reachability hub to build on | the template on `createReachabilityHub` |

**`hooks-wired` is a heuristic.** It reads text: it finds the call, the `const`/`let` the statement
assigns, and a `.services` read of that name anywhere in the file. It cannot see what the services
hold, or that the registry hands `device` on in one branch and the hooks' services in another. The
real proof of the composition is the `create-test-hooks` Jest test (the clock and
`services.connectivity` swapped inside the services, a reader hearing the switch); keep it, and
review the registry by eye against `examples/create-root-kits.ts` (app-startup-and-bootstrap's
check-startup proves startApp calls `prepareRootKits` before the data layer opens). Growing the pattern for every way to
write the startup would make the rule fragile, so it stays narrow on purpose.

Only bundled app code counts: tests, mocks, declarations and folders that hold a `SKILL.md`
(installed skills, a vendored skill pack) are never read.

## What it prints

- `NOT APPLICABLE: the app has no test-only code: ...` (exit 0) when there is no gate, no entry, no
  `TEST_ONLY` reader and no debug-link contract. Before this skill is adopted that is the honest
  answer; app-variants-and-environment's and ios-simulator-build's checks print their own SKIP for the
  missing gate meanwhile.
- `SKIP contracts/architecture.json [test-only-folders] not yet created (architecture-and-boundaries creates it)`
  while the app has no architecture contract.
- `note: link-route: expo-router is not in package.json; ...` with React Navigation (the appendix
  path: a `linking` config maps the link path to a screen rendered through `TEST_ONLY`).
- `ERROR [bad-input] nothing to check: ...` (exit 2) for a folder with neither `package.json` nor a
  source folder.

## Configuration

| Key | Where | Default | Read by |
|---|---|---|---|
| `srcDir`, `routesDir`, `featuresDir`, `servicesDir`, `contractsDir` | `rn-skills.config.json` (layout) | `src`, `src/app`, `src/features`, `src/services`, `contracts` | every rule |
| `registry` | `contracts/debug-links.json` | `<featuresDir>/debug/debug-links.ts` | `debug-registry`, `registry-strict`, `link-route` |
| `path`, `params` | `contracts/debug-links.json` | (required) | `debug-registry` |
| `testOnlyFolders` | `contracts/architecture.json` (architecture-and-boundaries) | `[]` | `test-only-folders`, `entry-reachable` |
| `--contract <file>` | command line | `<contractsDir>/debug-links.json` | the debug-link rules |

## When multi-package

Run it once per app workspace with that workspace as the root
(`node ${CLAUDE_SKILL_DIR}/scripts/check-test-hooks.mjs apps/mobile`): each app has its own gate,
entry, contract and routes. A shared package never holds a gate; it exports plain modules that an
app's entry re-exports.

## The self-test

`node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs` assembles each case from `tests/bases/app` (a minimal
app with the canonical result, date-key, languages and connectivity files synced in), this skill's
templates at the paths their first lines name (the canonical test-hook kit synced in among them), and
`examples/create-root-kits.ts` as the app's root-kit registry, so the shipped templates and examples
pass their own checker. Each `bad-*` case plants one bug for one rule (24
cases), `pass-*` cases print the
SKIP, the note, NOT APPLICABLE, or stay silent on planted findings under `.agents/skills/`,
`skills/` and a vendored folder with a `SKILL.md`; `error-*` cases are bad input. `--case <glob>` runs
some, `--materialize <dir>` writes the assembled cases.
