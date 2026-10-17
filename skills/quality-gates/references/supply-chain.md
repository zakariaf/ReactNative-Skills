# Supply-chain gates, knip and CI

What the dependency steps of `verify` check, the release-age exception format, install scripts,
licences, the knip settings, and running the gates in CI. Adding, upgrading and approving packages is
dependency-management's job; this page covers what the gates enforce.

## Contents

- The dependency steps of verify
- Exact pins and the release-age cooldown
- Install scripts
- Licences
- knip
- CI
- Other package managers

## The dependency steps of verify

| Step | Script | Checks |
|---|---|---|
| 10 | `export:audit` | `APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production expo export --platform ios --platform android --source-maps --output-dir dist-audit`: the production bundle of both platforms, with source maps (a production bundle must name its variant; app-variants-and-environment) |
| 11 | `audit:licenses` | every npm package whose code is in those bundles has an allowed licence or an approved exception |
| 12 | `check:deps` | the `.npmrc` policy and the config npm really runs with, `engines`, banned packages, Expo alignment (`expo install --check`, `expo-doctor`), reviewed install scripts pinned to a version |

`dist-audit/` is git-ignored and skipped by Prettier, ESLint and `check-bypasses.mjs`; the export
clears it first, so a stale bundle never feeds the audit. Measured on 2026-10-04: 43 s on a cold
Metro cache, 10 s warm, then under 1 s for the audit and 4 s for `check:deps`.

## Exact pins and the release-age cooldown

- `.npmrc` (dependency-management's file) holds the policy lines the guardrail checks
  (`npmrcLines`): `min-release-age=7` (refuse any version published less than 7 days ago),
  `engine-strict=true`, `save-exact=true`. Commit `package-lock.json`; CI and EAS install with
  `npm ci`.
- A needed fix younger than the release age goes into a dated block, and nowhere else:

  ```ini
  # exclude-block expires=YYYY-MM-DD reason=<issue link or changelog line>
  min-release-age-exclude[]=<package>
  ```

  The expiry is the publish date plus the release age. `check-bypasses.mjs` (and `check:deps`) fail an
  exclude outside a dated block, in any spelling (`min-release-age-exclude = x` counts too), and a
  block whose expiry has passed; the fix is to delete the whole block, never to extend it. The
  lockfile keeps the installed versions.
- `min-release-age` below 7 fails `check-bypasses.mjs` (`release-age-lowered`); a stricter number is
  fine.
- The cooldown covers npm only. CocoaPods and Gradle dependencies follow the native modules' specs;
  read `ios/Podfile.lock` and the Gradle dependency report after a native change (dependency-management).

## Install scripts

With `strict-allow-scripts=true` npm stops an install whose tree holds an unreviewed install script
before anything runs (`ESTRICTALLOWSCRIPTS`). Review each script, then approve it pinned to its
version in the root `package.json` `allowScripts` (`"lefthook@2.1.14": true`). `check:deps` fails
unless `npm approve-scripts --allow-scripts-pending` prints `No packages with unreviewed install
scripts.` (that command exits 0 either way, so the gate reads its output). lefthook's install script
is approved in the canonical `package.json`; without it the `npx lefthook` binary link is missing
(the binary itself comes from the platform package). The approved script runs `lefthook install`
from the folder npm started in, so an app nested in a larger repository denies it instead
(gates-overview.md, "lefthook's own postinstall bypasses that guard").

## Licences

Shipped dependencies may use the licences of the dependency policy (by default MIT, ISC, Apache-2.0,
BSD-2-Clause, BSD-3-Clause, 0BSD, OFL-1.1, CC0-1.0; an SPDX `OR` needs one allowed side, `AND` needs
all). Anything else needs an exception in `contracts/dependency-policy.json` with the exact licence
and a reason, agreed by the developer (a gated path). Only shipped JavaScript is audited, so build
tools in the lockfile never fail it; native SDKs a module pulls through CocoaPods or Gradle are read by
hand (dependency-management). Fonts and sounds are not npm packages: list their licences where the
app credits them.

## knip

- Every issue type knip 6 knows is an `error`, including `cycles`.
- `ignoreExportsUsedInFile: true` keeps knip quiet about exports their own file uses (a props type,
  an `as const` table beside its union).
- Entry points: the Expo Router routes (`src/app/**`), `scripts/**/*.ts`, `__mocks__/`, and the tests;
  the project is the app, the tests, the scripts and the root configs.
- Tool dependencies referenced only from configs must be devDependencies, or knip reports them.
- Every ignore entry has its reason in `contracts/knip-ignores.json` (root-files.md).

## CI

Local `npm run verify` is the gate; CI repeats it for every push and pull request
(ci-pipeline-and-gates owns the workflow, the pinned toolchain and the device jobs). In a workflow,
`LEFTHOOK: '0'` switches the git hooks off on the runner, where `npm ci` would otherwise install them:
`.github/workflows/` is the one place `check-bypasses.mjs` accepts it, and `--no-verify`,
`core.hooksPath` and `lefthook uninstall` stay forbidden there too. Pushing a workflow is
outward-facing: ask the developer first.

## Other package managers

`min-release-age`, `strict-allow-scripts`, `allowScripts` and `npm approve-scripts` are npm 11.17
features, and the canonical scripts call `npm run`. A pnpm, Yarn or Bun repo keeps every gate but
needs its own equivalents (pnpm `minimumReleaseAge` and `onlyBuiltDependencies`, for example) and the
same scripts with its runner; dependency-management lists the differences. The guardrail's
`npmrcLines` and `check-bypasses.mjs`'s `.npmrc` rules read npm's file only.
