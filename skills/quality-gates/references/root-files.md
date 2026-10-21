# The gate files, entry by entry

Why each moving part of the gates exists, so a failing gate is fixed at its cause and no entry is
"cleaned up" by mistake. Every file here is a gated path: a change needs the developer's agreement,
the matching `quality-gates.json` change and a `Gate-Change:` trailer in the same commit.

## Contents

- The verify runner and verifyExtraSteps
- Adding a gate from another skill
- knip.json and contracts/knip-ignores.json
- jest.config.js: thresholds and the device-only marker
- The gated-paths module
- What check-gate-wiring compares
- rn-skills.config.json

## The verify runner and verifyExtraSteps

`npm run verify` is `node scripts/quality/run-verify.ts`. The steps live in `verify-plan.ts` (tested
by `verify-plan.test.ts`): `format:check`, `lint`, `typecheck`, `i18n:verify`, `check:unused`, the
guardrail, `test:coverage`, `test:sim` (only while a `*.sim.test.ts` exists under `src/` or `test/`,
the roots `jest.sim.config.js` runs), every `verifyExtraSteps` script in order, `export:audit`,
`audit:licenses`, `check:deps`. `run-verify.ts` only reads the two facts (the extra steps, whether a
simulation exists), spawns each step from the repo root and prints the summary.

`verifyExtraSteps` in `quality-gates.json` is how another skill makes its tool a gate without editing
the canonical plan: a list of npm script names, run as `npm run -s <name>` after the tests and before
the release export. `extraStepsOf` refuses (and `verify` stops on) a value that is not a list of
distinct script names, or that repeats a core step; `check-gate-wiring.mjs` (`verify-step`) also fails
a name that `package.json` lacks, and (`script-target`) a step whose `node <file>` target does not
exist. The baseline list is empty; an app's list only grows, and removing an entry is a gate change.

There is no partial mode: every step is strict from the first run. A step whose tool an owner skill
has not installed yet fails loudly at that step (`Cannot find module`), and `check-gate-wiring.mjs`
prints the matching `SKIP ... not yet created (<skill> creates it)` line so the reason is plain.

## Adding a gate from another skill

A skill that adds a gate does all of this in one commit with a `Gate-Change:` trailer:

1. its npm script in `package.json` (the command its own skill documents);
2. the script name in `verifyExtraSteps` when the gate belongs in `verify`;
3. its evidence files in `gatedPaths` (baselines, waivers, a contract the gate reads): the canonical
   list names only files every app has, so a skill that owns a waivers file, a network-audit baseline
   or a facts file appends its path here when it installs it, or the commit check refuses the trailer
   on a commit that changes only that file;
4. a knip ignore entry, if a tool contract needs one, with its reason in `contracts/knip-ignores.json`;
5. a budget or minimum in `perf` / `a11y` when its tests read one from `quality-gates.json`.

Then `node scripts/quality/check-quality-gates.ts`, the wiring check and `npm run verify`.

A skill's own zero-dependency checker (state-management-zustand's `check-stores.mjs`, async-safety's
`check-async-safety.mjs`) can join `verify` the same way, as an app decision: an npm script that runs
it from the folder the app installed the skills into (`"check:stores": "node <skills-folder>/<skill>/scripts/<checker>.mjs ."`
with the real folder written out), its name in `verifyExtraSteps`. The canonical scripts and the canonical extra-step list never name one, because
that folder differs per agent (`.agents/`, `.claude/`, a vendored `skills/`) and a skill update would
change the gate without a trailer; `script-target` fails the step if the skill is moved. Run
`npm run -s check:unused` after adding it.

## knip.json and contracts/knip-ignores.json

`knip.json` (typescript-and-lint-rules' file) reports unused files, exports and dependencies and
unlisted dependencies and binaries; every issue type is `"error"` (`cycles` defaults to `warn`, which
would not fail the run), and `quality-gates.json` holds the same `rules`, so the guardrail catches a
relaxed rule. knip's configuration takes no comments (its schema refuses unknown keys), so the reason
for every entry of an ignore list lives in `contracts/knip-ignores.json`, at the same key path:

```json
{
  "$schema": "./knip-ignores.schema.json",
  "ignoreBinaries": {
    "xcrun": "scripts/build/simulator.ts starts Xcode's xcrun by name; it ships with Xcode, not npm"
  },
  "ignoreDependencies": {
    "@formatjs/cli": "scripts/i18n/verify-catalogs.ts resolves it with createRequire, which knip does not follow"
  },
  "workspaces": {
    "apps/mobile": { "ignoreDependencies": { "react-native-audio-api": "the root mock imports it; the app installs it" } }
  }
}
```

**The agent folders are the one canonical ignore list.** Installed skills live inside the app
(`.agents/skills/`, `.claude/skills/`, a vendored `skills/`), and their templates and fixtures import
packages the app never installs, on purpose. knip's Jest plugin falls back to Jest's default test glob,
which reaches into those folders, so without an entry every app that installs skills fails
`check:unused`: verified 2026-10-10 with knip 6.38.0 in a copy of the reference app, a test file in
the `templates/src/` folder of a skill installed under `.claude/` and one in the `tests/fixtures/`
folder of a skill installed under `.agents/`, each importing an uninstalled package, gave
`Unlisted dependencies (2)`. Overriding the Jest plugin's
`entry` did not help; `"ignore"` with the ten folders did (exit 0). Prettier, ESLint and the tsconfig
set already exclude these folders, and every repo scan of the skills prunes them. So `knip.json`
carries:

```json
"ignore": ["skills/**", ".agents/**", ".claude/**", ".codex/**", ".cursor/**", ".windsurf/**",
           ".roo/**", ".cline/**", ".continue/**", ".kiro/**"]
```

with the reason for each in `contracts/knip-ignores.json` (the template ships them).
`check-gate-wiring.mjs` (`gate-scope`) fails a `knip.json` that does not ignore an agent folder that
exists and holds code. knip prints a configuration hint ("Remove from ignore") for each of these
folders that does not exist yet; that hint does not fail the run, and these ten entries stay.

`check-gate-wiring.mjs` (`knip-ignores`) fails every entry of `ignore`, `ignoreBinaries`,
`ignoreDependencies`, `ignoreFiles`, `ignoreMembers`, `ignoreUnresolved`, `ignoreWorkspaces` or
`ignoreIssues` (top level or per workspace) without a reason of at least 10 characters. An entry is
for a tool contract only: a binary a script starts by name, a package a root mock imports but the app
installs, a module loaded through `createRequire`. Never an entry for code that only looks unused:
delete it or use it. Exports reached only through a dynamic `require` carry `/** @public */`, which
knip honours, instead of an ignore entry. "Configuration hints" (a redundant entry pattern, an ignore
entry that became unnecessary) do not fail the run, but read them: a hint that an ignore entry is no
longer needed means the entry and its reason go.

## jest.config.js: thresholds and the device-only marker

unit-and-component-tests owns `jest.config.js`; this skill guards its numbers:

- Thresholds: global 90/90/90/85 (statements, lines, functions, branches); 95/95/95/90 for each key of
  `LOGIC_THRESHOLDS` (`./src/core/`, `./src/data/`, `./src/games/*/rules/**/*.ts`). A key joins only
  once its folder has source files, because a key with no data makes Jest exit 1.
  `check-gate-wiring.mjs` (`jest-thresholds`) reads the numbers of `global` and `LOGIC` and requires
  every non-global key of the baseline `coverageThreshold` to still be named in `jest.config.js`
  (deleting `'./src/data/'` from `LOGIC_THRESHOLDS` drops that folder to the global floors).
- `coveragePathIgnorePatterns` is `['/node_modules/', ...deviceOnlyCoveragePatterns(__dirname)]`:
  `scripts/quality/device-only.ts` turns every file under `src/` whose first 6 lines carry
  `// device-only: covered by <the e2e flow or device check>` into one exact pattern. That marker,
  in the file itself where review sees it, is the only way out of coverage. `check-gate-wiring.mjs`
  compares the helper with its canonical copy (`gate-script-changed`), so widening it is caught.
- The scope is canonical too: `collectCoverageFrom` (`src/**/*.{ts,tsx}` minus test files, `.d.ts`,
  `fixtures/` and `testing/`), each project's `testMatch` and `roots`, and the
  `testPathIgnorePatterns` and `modulePathIgnorePatterns` (generated native folders, build output,
  reports, Stryker sandboxes and the agent folders; the unit project also leaves goldens, simulations
  and Android tests to their own runs). Two checks guard it:
  - `check-gate-wiring.mjs` (`jest-scope`) reads the value of every `collectCoverageFrom`,
    `coveragePathIgnorePatterns`, `testPathIgnorePatterns`, `modulePathIgnorePatterns`, `testMatch`,
    `testRegex` and `roots` key of `jest.config.js`, and every top-level constant such a value uses
    (`IGNORED_PATHS`, `TEST_ROOTS`, `IS_MUTATION_RUN`), and fails any value the canonical config in
    `assets/jest-config-baseline.js` does not have. An added `'!<rootDir>/src/stores/**'` or
    `'task-priority\\.test'` fails here before `npm ci`.
  - The guardrail compares the resolved scope with `jest.collectCoverageFrom` and `jest.projects` in
    `quality-gates.json`, and each project's `coveragePathIgnorePatterns` with the device-only list.
  Three changes pass both checks when made with a trailer:
  - **A new test project** (a `web` project with `preset: 'jest-expo/web'` and its own `testMatch`)
    added next to the canonical ones and listed under `jest.projects` in `quality-gates.json`:
    `jest-scope` leaves the values inside an object whose `displayName` is such a listed, non-canonical
    project to the guardrail. The canonical `unit`, `android` and `golden` projects keep their
    `displayName` (`jest-scope` fails a config where one is gone) and their exact scope.
  - **A new logic threshold key** in `LOGIC_THRESHOLDS` and `jest.coverageThreshold` at the logic
    floors; any other path key needs at least the global floors, because Jest takes the files a path
    key matches out of the global count.
  - **The workspace form, when multi-package:** a value written once per workspace, with a workspace
    prefix where the single app had `src/` or an ignored folder (`<rootDir>/apps/*/src/**/`,
    `<rootDir>/{apps,packages}/*/src/**/*.{ts,tsx}`,
    `<rootDir>/(apps|packages)/[^/]+/(ios|android|build|dist|web-build)/`), and logic keys in workspace
    or package form (`./apps/*/src/data/`, `./packages/core/src/`). The checker builds the prefixes
    from `package.json` `workspaces` (literal folders, `apps/*`, `apps/[^/]+`, `{apps,packages}/*`,
    `(apps|packages)/[^/]+`), strips them, drops repeats and compares the rest with the canonical
    value, in `jest.config.js` and in `quality-gates.json` alike. Keep the canonical order with the
    workspace entries where `src/` stood. It also fails a workspace holding `src/` that no coverage
    glob or test root reaches. A Node backend workspace (`functions/`: outside `packages/`, no Expo
    app) is reached by a project of its own instead of the canonical ones: `displayName: 'functions'`
    (its folder), `testEnvironment: 'node'`, `testMatch: ['<rootDir>/functions/src/**/*.test.ts']`
    (unit-and-component-tests, When multi-package), listed under `jest.projects.functions` like any
    new project, with `TEST_ROOTS` leaving the backend out and `collectCoverageFrom` adding
    `<rootDir>/functions/src/**/*.{ts,tsx}`. Per-workspace Jest configs (`projects: ['<rootDir>/apps/*']`) are
    outside the static check: it reports them as differing, and the guardrail compares them.
  Any other agreed change of scope (a new ignore pattern, a new generated folder, a test root in the
  single-app layout) is a change to unit-and-component-tests' canonical config, made there and
  synced; an app that makes it locally keeps one `jest-scope` line, reported as a recorded difference.
- **Limits of the static check** (the guardrail covers each): it compares source text, so a value
  computed in a helper function or read from another file, a project added with no scope key of its
  own, or a constant renamed and re-declared is seen only as "differs" or not at all; the resolved
  comparison in `verify` is the authority.

## The gated-paths module

`scripts/quality/gated-paths.ts` answers one question for the commit-message check
(git-commits-and-reporting) and anything else that needs it: is this changed file a gate?

- `gatedPathsOf(gates)` reads `gatedPaths` from the parsed `quality-gates.json`.
- `isGatedFile(file, pattern)` matches with Node's `path.matchesGlob`, except that a pattern starting
  with a wildcard never reaches into an agent folder (`AGENT_FOLDERS`: `skills/`, `.agents/`,
  `.claude/`, `.codex/`, `.cursor/`, `.windsurf/`, `.roo/`, `.cline/`, `.continue/`, `.kiro/`).
- `gatedFilesIn(files, patterns)` lists the gated files of a commit.

The commit check imports it as `../quality/gated-paths.ts` and needs the trailer exactly when the list
is not empty. The module and its test are canonical (`gate-script-changed`), and `gate-scope` fails a
copy that lost the agent-folder exclusion.

## What check-gate-wiring compares

`check-gate-wiring.mjs` reads files and runs no tool:

- this skill's files exist (`gate-file-missing`); another skill's gate file that does not exist yet
  is a `SKIP` naming it, and the rules reading it wait;
- every canonical script is present byte for byte (`npm-script`; the workspace `typecheck` and
  `export:audit` forms when multi-package), and every `node <file>` target of a script, a lefthook job or an extra step exists,
  or is another skill's not-yet-created file (`script-target`);
- `quality-gates.json` is no weaker than the template (`gate-weakened`; when multi-package the
  template's probes and app program carry each Expo app workspace's prefix, and every workspace
  `tsconfig.json` has a `typescript.projects` entry) and its extra steps are valid (`verify-step`);
- `.claude/settings.json` keeps every deny and ask rule, both hooks with their commands byte for
  byte, no bypass allow rule and no `disableAllHooks` (`claude-settings`);
- `lefthook.yml` keeps every job, run line, `glob:` line and secret glob, switches nothing off and
  excludes nothing new, and a local `lefthook-local.yml` (usually git-ignored) neither switches a job
  off nor touches a gate hook (`lefthook`); a git-ignored `.claude/settings.local.json` neither sets
  `disableAllHooks` nor allows a bypass (`claude-settings`);
- `.npmrc` holds the `npmrcLines` (`npmrc`); `eslint.config.mjs` keeps inline config inert and
  reported (`eslint-linter-options`); `jest.config.js` keeps the threshold floors
  (`jest-thresholds`) and the canonical coverage and test scope (`jest-scope`);
- no gate reaches into agent folders and knip ignores every agent folder that holds code
  (`gate-scope`); the gate scripts equal their templates (`gate-script-changed`); every knip ignore
  entry has its reason (`knip-ignores`).

The guardrail (`check-quality-gates.ts`, a step of `verify`) then compares what the tools resolve.
What only the guardrail sees: values that a later ESLint block, an `extends` or a CLI flag changes
without touching the compared line; a `lefthook-local.yml` change the line rules above do not name
(the guardrail reads the merged `lefthook dump`); a `jest.config.js` whose numbers are computed rather
than written as literals. The static check reads text with patterns, so a determined rewrite can pass
it; it exists to catch the ordinary weakening before `npm ci`, and `verify` stays the authority.

## rn-skills.config.json

`check-gate-wiring.mjs` reads two keys of the optional repo file `rn-skills.config.json`:

- `contractsDir` (default `contracts`), where it looks for `knip-ignores.json`;
- `lefthookPrepare`: `"parent-repo"` when the app is a folder inside a larger git repository (a
  `mobile/` folder next to a `server/` one, or an example app inside a library's repository) whose
  root installs lefthook, and the app keeps no `prepare` script at all. Rarely needed now: the
  canonical `prepare` (`scripts/hooks/install-git-hooks.ts`) already skips below the git top level and
  without `.git`, where a bare `lefthook install` failed or wrote hooks for the enclosing repository
  (both verified 2026-10-10 with lefthook 2.1.14), so keeping the canonical script is the default. The
  checker then prints a note instead of the `npm-script` problem for a missing `prepare`, and fails the
  key in a folder that holds `.git` (the git root installs its own hooks). The enclosing repository's
  `lefthook.yml` runs this app's jobs (lefthook's `root:` option). Any other value is exit 2. Neither
  the key nor the guarded `prepare` stops lefthook's own postinstall, which the canonical
  `"lefthook@2.1.14": true` approval lets run: it calls `lefthook install` from the folder npm started
  in and, below the git top level, writes lefthook's example `lefthook.yml` and a
  `prepare-commit-msg` hook into the enclosing repository (or re-syncs its hooks when it has a
  `lefthook.yml`; verified 2026-10-10). A nested app therefore denies the script in its own
  `package.json` (`"lefthook": false`) and runs `npx lefthook validate` and the guardrail from the
  enclosing root, because the denial also drops `.bin/lefthook` (gates-overview.md, "lefthook's own
  postinstall bypasses that guard").

It also reads `package.json` `workspaces` to decide the multi-package form. The gate scripts themselves live at the
paths the canonical commands name (`scripts/quality/`, `scripts/hooks/`), because the guardrail
compares those commands byte for byte.
