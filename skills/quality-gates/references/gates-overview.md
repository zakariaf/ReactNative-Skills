# The gates: what runs when, and what each script does

Quality is a stack of automatic gates, each cheaper and earlier than the next. This page lists every
gate, every canonical npm script with the skill that owns its target, and the order and cost of
`npm run verify`. Timings were measured on 2026-10-04 in a copy of the reference Expo SDK 57 app (a
Tasks app, about 115 test files) on macOS with Node 26.4.

## Contents

- The gate stack
- The canonical npm scripts
- The verify pipeline, step by step
- check:fast, the inner loop
- What is outside verify
- Adopting into an existing app
- When multi-package

## The gate stack

| When | Gate | Blocks | Measured |
|---|---|---|---|
| After every Edit/Write by Claude Code | PostToolUse hook `scripts/hooks/after-edit.ts`: Prettier and ESLint on that file | nothing (feeds the errors back, exit 2) | about 3 s |
| When the agent wants to stop | Stop hook: `npm run -s check:fast` | the agent from stopping (exit 2) | 7 s warm, 15 s cold |
| `git commit` | lefthook `pre-commit`: secrets, format, lint, typecheck, related tests (in parallel, on staged files) | the commit | 2.3-2.6 s |
| `git commit` | lefthook `commit-msg`: git-commits-and-reporting's check (format, `Gate-Change:` exactly when a gated path changed) | the commit | under 0.1 s |
| `git push` | lefthook `pre-push`: `npm run verify` | the push | about 2 minutes |
| Every `verify` | the guardrail: resolved configs equal `quality-gates.json` | the push | 16 s |
| CI (optional, ci-pipeline-and-gates) | `npm ci && npm run verify` | a merge, when the team uses pull requests | minutes |

End-to-end flows (Maestro, e2e-maestro), screenshot and visual-parity runs, mutation testing
(`test:mutation`, unit-and-component-tests) and release builds run outside `verify`: nightly, before
a release, and when a logic module is finished.

## The canonical npm scripts

All scripts live in the root `package.json` and run from the repo root. The exact commands are in
`templates/package-scripts.json`; copy them byte for byte, because the guardrail compares the gate
scripts exactly and `check-gate-wiring.mjs` compares all of them. `start`, `android`, `ios` and `web`
are Expo's defaults and stay the app's own.

| Script | What it does | Its target is created by |
|---|---|---|
| `prepare` | `node scripts/hooks/install-git-hooks.ts`: npm runs it after `npm install` / `npm ci`; it runs `lefthook install` when the app folder is the git top level and otherwise prints why it skipped (see below) | this skill |
| `verify` | `node scripts/quality/run-verify.ts`: every gate below, cheapest first, stopping at the first failure | this skill |
| `check:fast` | Prettier check, ESLint with a content cache, `typecheck`, `jest --onlyChanged` | (tools) |
| `format` / `format:check` | Prettier write / check on the whole repo | typescript-and-lint-rules (config) |
| `lint` | ESLint on the whole repo, `--max-warnings 0`, no cache (type-aware results go stale in a cache) | typescript-and-lint-rules (config) |
| `typecheck` | both programs: the root `tsconfig.json` (Node world) and `src/tsconfig.json` (the app) | typescript-and-lint-rules (config) |
| `test` | all Jest projects (`unit`, `android`, `golden`); `--ci` never writes snapshots | unit-and-component-tests (config) |
| `test:golden` | only the `golden` project | golden-and-snapshot-tests |
| `test:sim` | balance simulations (`*.sim.test.ts`, own config) | game-balance-and-bots (games) |
| `test:coverage` | all projects with the coverage thresholds, in random order | unit-and-component-tests |
| `test:mutation` | Stryker on the logic folders | unit-and-component-tests |
| `check:unused` | knip: unused files, exports and dependencies, unlisted dependencies and binaries (expo-doctor refuses a script named like a binary, so not `knip`) | typescript-and-lint-rules (config) |
| `check:deps` | `node scripts/deps/check-deps.ts`: the `.npmrc` policy, bans, Expo alignment, reviewed install scripts | dependency-management |
| `check:npm-config` | `node scripts/deps/check-npm-config.ts`: the config npm really runs with (before an install, in CI and EAS) | dependency-management |
| `export:audit` | a production export for iOS and Android with source maps into `dist-audit/` (both variant variables set: a production bundle must name its variant) | (Expo CLI) |
| `audit:licenses` | `node scripts/audit/audit-licenses.ts`: the licence of every package in the exported bundles | dependency-management |
| `i18n:verify` | `node scripts/i18n/verify-catalogs.ts`: FormatJS verify and the catalog linter | i18n-strings-and-catalogs |

**`prepare` installs the hooks only at the git top level.** A bare `lefthook install` writes into
`.git/hooks`: outside a git repository it exits 128 (`not a git repository`, lefthook 2.1.14, verified
2026-10-10), so `npm ci` fails in a Docker build context without `.git`, an EAS no-VCS workflow
(`EAS_NO_VCS=1`) or after an `.easignore` that drops `.git`, and `LEFTHOOK=0` does not skip it; in a
folder inside a larger repository (an example app, a reference app under `tools/`) it writes hooks for
the enclosing repository. So `prepare` runs `scripts/hooks/install-git-hooks.ts`: it asks
`git rev-parse --show-toplevel` from the package folder, runs `npx --no -- lefthook install` only when
the answer is that folder, and otherwise prints `install-git-hooks: skipped: <why>` and exits 0. A
real install failure at the top level still fails `npm install` (lefthook's exit code passes
through), which is why the script never ends in `|| true`. The decision is
`scripts/hooks/hook-install-plan.ts`, tested beside it. Developer machines, CI checkouts and the
default EAS Build upload (a shallow clone that keeps `.git`, read in the eas-cli 24.12.1 source)
are git top levels, so the hooks install there as before. An app inside a larger repository needs no
`rn-skills.config.json` `"lefthookPrepare"` key any more; the key still exempts one that keeps no
`prepare` at all (root-files.md, "rn-skills.config.json").

**lefthook's own postinstall bypasses that guard (the nested-repository caveat).** The canonical
`package.json` approves `"lefthook@2.1.14": true`, and it has to: the lefthook binary comes from its
platform package (`lefthook-darwin-arm64` and the like, an `optionalDependencies` entry) and runs
without the script, but npm 11.17 creates `node_modules/.bin/lefthook` only for a package whose install
script is approved, and `prepare` (`npx --no -- lefthook install`), the guardrail
(`npx --no -- lefthook dump`) and `npx lefthook validate` all go through that link. With the script
denied, `npm install` at a git top level fails in `prepare` with `sh: lefthook: command not found`
(exit 127). The approved script (`node postinstall.js`) runs `lefthook install` from `INIT_CWD`, the
folder npm was started in, unless `CI` is set (`LEFTHOOK=0` does not stop it), and it knows nothing of
the `prepare` guard. At a git top level it only repeats what `prepare` does. In an app folder inside a
larger repository, or with `npm ci --prefix <app>` run from that repository's root, it reaches the
enclosing repository: with no `lefthook.yml` at its root it writes lefthook's 42-line example
`lefthook.yml` there and a `prepare-commit-msg` hook into its `.git/hooks`; with one, it re-syncs that
repository's hooks, pointed at the nested app's binary (all verified 2026-10-10 with lefthook 2.1.14
and npm 11.17.0 in scratch repositories). Such an app denies the script in its own `package.json`
(`"lefthook": false`, dependency-management's denial form): `prepare` skips there anyway, and the
enclosing root installs and runs the hooks. The cost is the missing `.bin/lefthook` in that folder, so
`npx lefthook validate` and the guardrail's lefthook step run from the enclosing root (in the app
folder the guardrail stops at `could not run npx --no -- lefthook dump`). Where the approval must stay,
install with `CI=true` and delete a stray `lefthook.yml` or `prepare-commit-msg` hook that already
appeared. An app at the git top level keeps the canonical approval.

A tool script that only some apps need (an E2E run, a simulator or emulator build, a release lane, a
network audit under the `offline-only` profile) is documented and checked by the skill that owns it,
not listed here. When such a tool becomes a gate, its skill appends the script to `verifyExtraSteps`.

## The verify pipeline, step by step

`npm run verify` runs `scripts/quality/run-verify.ts`, which runs the steps of `verify-plan.ts` in
this order and stops at the first failure (like `a && b && c`). A green run ends with
`verify: <n> steps passed (<names>)`.

| # | Step | Measured | Fails when |
|---|---|---|---|
| 1 | `format:check` | 2.4 s | a file is not Prettier-formatted |
| 2 | `lint` | 20 s | any ESLint error or warning |
| 3 | `typecheck` | 1.8 s | any `tsc` error in either program |
| 4 | `i18n:verify` | 0.2 s | missing or extra keys, an ICU mismatch, a bad key name |
| 5 | `check:unused` | 1.2 s | an unused file, export or dependency; an unlisted dependency or binary |
| 6 | guardrail `check-quality-gates.ts` | 16 s | a resolved config differs from `quality-gates.json`, or a local file switches a hook off |
| 7 | `test:coverage` | 11.5 s | a failing test or a coverage threshold |
| 8 | `test:sim` (only once a `*.sim.test.ts` exists) | per game | a balance property fails |
| 9 | each `verifyExtraSteps` script, in order | per gate | that gate fails |
| 10 | `export:audit` | 43 s cold, 10 s warm | the production bundle does not build for iOS or Android |
| 11 | `audit:licenses` | under 1 s | a shipped package without an allowed licence or an approved exception |
| 12 | `check:deps` | 4 s | an undated or expired release-age exception, a banned package, Expo drift, an unreviewed install script |

Step 12 needs the network (npm and Expo's version API); offline, `verify` fails there, which is
correct: a push without the dependency checks is unverified. Set `EXPO_NO_TELEMETRY=1` in tooling
environments. A young Expo patch that `expo install --check` expects is a `WARN` line with its due
date, not a failure, until that date (dependency-management).

Step 10 is also a gate in its own right: it proves the production bundle builds for both platforms,
which `tsc` and Jest cannot (a Metro resolution error, an asset, a platform file). Its output folder
is git-ignored and skipped by Prettier, ESLint and the bypass scan.

## check:fast, the inner loop

`check:fast` is the inner loop and the Stop hook's command: Prettier check, ESLint with a
content-based cache in `node_modules/.cache/eslint/`, the full `typecheck`, and
`jest --onlyChanged --passWithNoTests` (tests related to files changed since the last commit; with
no change there is nothing to run, the one place `--passWithNoTests` is allowed). It took 7 s warm and
15 s cold. The cache is safe because `lint` runs again without it in `verify`.

Run it at the end of every slice and before saying any change is done. Run `npm run verify` before
every push (the pre-push hook does it anyway).

## What is outside verify

| Run | When | Owner skill |
|---|---|---|
| `npm run test:mutation` | before a release, when a logic module is finished | unit-and-component-tests |
| Maestro flows on a named iOS simulator and a named Android emulator | before a release, after UI or navigation changes | e2e-maestro |
| Screenshot and visual-parity runs | after a UI change, before a release | e2e-maestro, design-visual-parity |
| Simulator and emulator release builds | before a release | ios-simulator-build, android-emulator-build |
| EAS Build and Submit, or the local release lane | a release | eas-build-and-submit, ios-release-testflight, android-release-play |

## Adopting into an existing app

The gates read files that other skills own. Install in this order so each step is green before the
next; until an owner has run, `check-gate-wiring.mjs` prints a `SKIP ... not yet created (<skill>
creates it)` line for its files, and `verify` fails loudly at that owner's step (never quietly):

1. typescript-and-lint-rules: `eslint.config.mjs`, the tsconfig set, Prettier, `knip.json`.
2. unit-and-component-tests: `jest.config.js`, `jest.setup.ts`, the device-only helper.
3. dependency-management: `.npmrc`, `contracts/dependency-policy.json`, `scripts/deps/`,
   `scripts/audit/`.
4. i18n-strings-and-catalogs: the catalogs and `scripts/i18n/verify-catalogs.ts`.
5. This skill: scripts, `lefthook.yml`, `quality-gates.json`, `.claude/settings.json`, the gate
   scripts.
6. git-commits-and-reporting: `scripts/git/check-commit-message.ts` (the commit-msg job runs it).

Existing red findings are fixed, not ignored: an app that cannot fix them in one change keeps the
gate and fixes them first, with the developer deciding the order. Never adopt by loosening a value of
`quality-gates.json`; `check-gate-wiring.mjs` fails a weaker value, and the guardrail fails a config
that differs.

## When multi-package

With npm workspaces (`apps/*`, `packages/*`), the gate files and hooks stay at the repo root and run
from there. `assets/package-scripts.multi-package.json` holds every script that changes:

- `typecheck` becomes `tsc --noEmit -p tsconfig.json && npm run -s typecheck --workspaces`, and every
  workspace has its own `typecheck` script (`tsc --noEmit -p tsconfig.json`); without `--if-present`, a
  workspace that lacks it fails loudly.
- `export:audit` becomes `cd <app-dir> && <the single app's expo export command>` with
  `--output-dir <to-root>/dist-audit`, where `<app-dir>` is the Expo app workspace (`apps/mobile`) and
  `<to-root>` the way back up to the repo root (two folders for `apps/mobile`); the checks fill both
  from the workspaces. The root form of the single app fails after the move: Metro, started at the
  root, falls back to `expo/AppEntry`, which imports an `App` file the root does not have, and stops
  with "Unable to resolve module". Run inside the app it finds `expo-router/entry`, and the export still
  lands at the repo root, where
  `audit:licenses` (its `dist-audit/**` source maps) and the bundle audit read it (verified on Expo
  SDK 57 in an npm-workspaces app with one app workspace on 2026-10-21; re-verify:
  `npm run -s export:audit && npm run -s audit:licenses` from the root). The form exports one app;
  with several apps the checks accept it for any one of them, and auditing each is not covered yet.

`quality-gates.json` lists every workspace program under `typescript.projects` (a glob such as
`apps/*/tsconfig.json` covers new ones; each Expo app's program keeps the single app's `["jest"]`), the
ESLint probes take the app workspace's prefix (`apps/<app>/src/core/gate-probe.ts`, ... in place of
`src/core/gate-probe.ts`: the guardrail runs `eslint --print-config` on those paths, so the single-app
ones resolve no app config), and `npmScripts` restates the workspace forms; `check-gate-wiring.mjs`
builds the same workspace form of its baseline from `package.json` `workspaces` (`gate-weakened` names
a probe or program it lacks). The `ask` rules gain the workspace tsconfigs
(`Edit(/apps/*/tsconfig*.json)`, `Edit(/packages/*/tsconfig*.json)`) in `.claude/settings.json` and
`quality-gates.json` `claudeSettings` in the same gate change, so loosening a workspace program still
prompts, and `gatedPaths` gains `apps/*/tsconfig*.json` and `packages/*/tsconfig*.json`, so the commit
needs a `Gate-Change:` trailer too (`isGatedFile` keeps wildcard patterns out of the agent folders), knip gets one `workspaces` entry per package (with
`includeEntryExports` for packages whose `exports` map makes every file an entry). Jest stays one root
`jest.config.js` whose scope takes the workspace form: `TEST_ROOTS` lists `<rootDir>/apps/*/src/**/`
and `<rootDir>/packages/*/src/**/` where it had `<rootDir>/src/**/` (and `<rootDir>/apps/*/plugins/**/`
where it had `<rootDir>/plugins/**/`; only a `src/` root counts as reaching a workspace), the coverage glob is
`<rootDir>/{apps,packages}/*/src/**/*.{ts,tsx}`, and the logic keys name each package's logic folder
(`./packages/core/src/` for `./src/core/`). `quality-gates.json` restates the same values under
`jest.collectCoverageFrom`, `jest.projects` and `jest.coverageThreshold` in the same gate change, so
the guardrail compares the resolved scope with them; `check-gate-wiring.mjs` compares both with the
canonical scope after stripping the workspace prefixes, so an added `!` glob or ignored test path
still fails (guardrail.md, "Adding a folder, a program or a package"; root-files.md, the Jest
section). Lint and Prettier stay single runs at the root.
