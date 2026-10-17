# The 7-day release-age policy and dated exceptions

How `.npmrc` keeps brand-new releases and unreviewed install scripts out, how npm 11.17 behaves with
it, and the only allowed way to take a release younger than the release age. Read it when an install
fails with `ETARGET`/`notarget`, when adding an exception, and on or after an exclude block's expiry
date.

## Contents

- The complete root .npmrc
- Keys that must never be in it
- Config outside .npmrc (environment variables, ~/.npmrc)
- How the policy behaves (verified)
- How the plan measures the age (--now and --today)
- A bootstrap block (why a new project often needs one)
- Adding a dated exception
- Expiry: delete, never extend
- A new Expo patch inside the 7 days
- pnpm, Yarn and Bun
- What checks it

## The complete root .npmrc

`templates/dot-npmrc` is the file (copy it to `.npmrc`); without its comments it reads:

```ini
min-release-age=7
engine-strict=true
save-exact=true
strict-allow-scripts=true
legacy-peer-deps=false
force=false
dangerously-allow-all-scripts=false
package-lock=true

# A dated exception, only for a needed release younger than the release age, agreed by the developer:
# exclude-block expires=YYYY-MM-DD reason=<issue link or changelog line>
# min-release-age-exclude[]=<package>
```

- `min-release-age=7`: a 7-day wait lets most malicious or broken releases be pulled before the app
  adopts them. Seven days is the floor: an app may be stricter (`min-release-age=14`), and the
  checkers, `plan-dependency.mjs --online` and the app's gate (`release-age-excludes.ts`,
  `expo-patch-age.ts`) all read the value from `.npmrc`. A value below 7 fails.
- `engine-strict=true` with `"engines": { "npm": ">=11.17.0", "node": ">=22.18" }` in the root
  `package.json`. npm checks the project's `engines` only when they are declared, so without them
  `engine-strict` guards nothing (`check-deps-policy.mjs` fails `engines`, and so does the app's
  gate through `engines-floor.ts`). npm 10 (the default on EAS images for SDK 57) has none of the <!-- stack-pin-ignore: the EAS default npm -->
  policy settings, so it would install too-young releases and run every install script.
  `min-release-age` arrived in npm 11.10.0, `allowScripts`, `strict-allow-scripts` and
  `npm approve-scripts` in 11.16.0, and `min-release-age-exclude` (the dated blocks) in 11.17.0
  (verified 2026-10-03 in the published npm tarballs), so 11.17.0 is the floor.
- `save-exact=true`: `npm install x@~3.0.0` saved `"3.0.1"` (verified); every change of a version
  becomes a deliberate, reviewed commit.
- `strict-allow-scripts=true`: npm builds the tree, and when any package in it has an install script
  that the root `package.json` `allowScripts` does not cover, it stops with `ESTRICTALLOWSCRIPTS`
  before anything runs. Without it npm 11.17 runs the unreviewed script and only prints a notice
  afterwards (the supply-chain reference, "Install scripts").
- `legacy-peer-deps=false`, `force=false`, `dangerously-allow-all-scripts=false` and
  `package-lock=true` are npm's defaults, written out because a project line beats `~/.npmrc`: a
  developer's user config can then not switch them on (see "Config outside .npmrc"). The checks
  accept the file without them; keep them.
- In a value, an unescaped `#` or `;` starts a comment (npm 11.17 reads `min-release-age=7 # why` as
  7), and one pair of matching quotes is dropped (`strict-allow-scripts="true"` is true; a quoted
  value followed by a comment keeps its quotes). The checks read values the same way. The reason of
  a block still goes on its own `# exclude-block` header line.
- npm keeps the **last** value of a key (verified: `min-release-age=7` followed by
  `min-release-age=0` gives 0), reads `key = value` like `key=value`, reads a bare `key` (or
  `key=`) as `true`, reads `min-release-age-exclude = x` like `min-release-age-exclude[]=x`, and
  splits one exclude value on commas (`expo,@*/*` is two patterns). So no line may set a policy key
  to a weaker value, and every exclude, in any spelling, sits inside a dated block; the checks fail
  otherwise (`npmrc-policy`, `npmrc-exclude`). A comment line that still reads
  `# exclude-block expires=YYYY-MM-DD …` is documentation, not a block.

## Keys that must never be in it

Each switches one of the policy lines off for every install, so `check-deps-policy.mjs` fails it as
`npmrc-policy` (in any spelling npm reads as true) and the app's gate as `policy-bypass`:

| Key | What it does (npm 11.17) |
|---|---|
| `before=<date>` | replaces `min-release-age`: when both are in the same `.npmrc`, npm uses `before` and drops the age (verified 2026-10-03: with `before=2099-01-01` next to `min-release-age=7`, a 4-day-old `expo-constants` resolved; without it, `ETARGET`) |
| `legacy-peer-deps` | ignores `peerDependencies`, so an install off the SDK set resolves instead of failing with `ERESOLVE` |
| `force` | overrides conflicts and protections (`ERESOLVE`, `EBADENGINE`) for every install |
| `dangerously-allow-all-scripts` | runs every install script, approved or not, past `allowScripts` and `strict-allow-scripts` |
| `allow-scripts` | an approval list outside `package.json`, easy to miss in review; installs inside the project ignore the line next to `package.json` `allowScripts`, npx applies it, and npm exports it to every script it runs, so an `npm install` started by an npm script stops with `EALLOWSCRIPTS` (verified 2026-10-03, from the project `.npmrc` and from `~/.npmrc`) |
| `package-lock=false` | `npm install` (what developers run, and EAS Build under `EAS_NO_FROZEN_LOCKFILE`) ignores `package-lock.json` and stops writing it, so every install resolves a fresh tree (verified 2026-10-03: with a lockfile pinning `left-pad` 1.1.0 under `^1.1.0`, `npm install` installed 1.3.0; `npm ci`, which EAS Build runs by default, still honoured the lock). Libraries often ship this line in their own `.npmrc` |

Only the one harmless value passes: `legacy-peer-deps=false`, `force=false`,
`dangerously-allow-all-scripts=false`, `package-lock=true`. npm keeps other spellings (`0`, `no`,
`False`) as strings it treats as on, so the checks fail them too; write `true` or `false`.

## Config outside .npmrc (environment variables, ~/.npmrc)

npm reads its config in this order of precedence: command-line flags, then `NPM_CONFIG_*` (or
`npm_config_*`, any case) environment variables, then the project `.npmrc`, then `~/.npmrc`, then
the global config. Verified 2026-10-03 on npm 11.17.0:

- A variable beats every line of the project `.npmrc`: `NPM_CONFIG_LEGACY_PEER_DEPS=true` wins over
  an explicit `legacy-peer-deps=false`; `NPM_CONFIG_STRICT_ALLOW_SCRIPTS=false` and
  `NPM_CONFIG_PACKAGE_LOCK=false` do the same; `npm_config_min_release_age=0` or
  `npm_config_before=2099-01-01` each let `@types/node` 26.6.4 (published two days earlier)
  resolve, where the project file alone gave `ETARGET`.
  npm maps the name by lower-casing it and turning `_` into `-`, and ignores an empty variable.
- A project line beats `~/.npmrc`, but a key the project file leaves unset comes from `~/.npmrc`:
  `legacy-peer-deps=true` or `before=…` there applies to every install on that machine. That is why
  the template writes out the harmless values.
- `allow-scripts` belongs in no layer. From a variable or the command line npm refuses it for every
  install inside the project (`npm error code EALLOWSCRIPTS`: `--allow-scripts is not allowed in
  project-scoped installs`; verified with `NPM_CONFIG_ALLOW_SCRIPTS` on `npm ci` and `npm install`),
  and from `~/.npmrc` it reaches every script npm runs. Approvals live in the root `package.json`
  `allowScripts`; npx tools follow the supply-chain reference, "npx and one-off tools inside the repo".
- An exclude list is never merged: the highest layer that sets `min-release-age-exclude` replaces
  the whole list. A `~/.npmrc` with `min-release-age-exclude[]=*` applies whenever the project file
  has no block of its own; a variable replaces the project's dated blocks.
- The usual workaround for `ERESOLVE` on EAS Build is `"env": { "NPM_CONFIG_LEGACY_PEER_DEPS":
  "true" }` in `eas.json`; EAS runs its install with it (`npm ci --include=dev` by default,
  `npm install --include=dev` when `EAS_NO_FROZEN_LOCKFILE` is set; the procedures reference,
  "EAS Build and other CI installs").

What checks it:

- `check-deps-policy.mjs` fails (`npm-env`) every `NPM_CONFIG_*` variable in `eas.json`
  `build.<profile>.env` (each Expo app's `eas.json` when multi-package) and in
  `.github/workflows/*.yml` that sets a policy key below the policy, a key from the table above, or
  an exclude, and an `EAS_NO_FROZEN_LOCKFILE` with any non-empty value in `eas.json` (it turns EAS
  Build's `npm ci` into `npm install`). It cannot see EAS environment variables stored on
  expo.dev, a CI system other than GitHub Actions, `~/.npmrc`, or flags on a command line.
- `scripts/deps/check-npm-config.ts` reads the config npm will actually run with, from every layer:
  `npm config get min-release-age engine-strict save-exact strict-allow-scripts legacy-peer-deps
  force dangerously-allow-all-scripts package-lock before min-release-age-exclude allow-scripts`
  must print the policy (`before=null`, only the project's own excludes, and an empty
  `allow-scripts=`). It needs no `node_modules`, so run it
  in CI before `npm ci` and on EAS Build as the `eas-build-pre-install` script (that is where EAS
  environment variables meet npm); `check-deps.ts` runs the same check in `npm run verify`. On EAS
  this is verified from Expo's docs only, not run on a worker by this skill.

## How the policy behaves (verified)

Verified with npm 11.17.0 between 2026-09-26 and 2026-10-03:

- A fresh resolution of a too-young version fails:
  `npm error notarget No matching version found for <pkg>@<v> with a date before <now - 7 days>`.
  npm computes that date from the moment of the install (`Date.now()` minus the days in 24-hour
  steps), not from the start of the day.
- A range picks the newest version that is at least 7 days old: `react-native-google-mobile-ads@^17`
  resolved to 17.0.0 while 17.2.0 was a day old.
- An exclude exempts only the named package or glob (minimatch: `*` stays inside one name segment,
  so `@expo/*` matches `@expo/cli`): its own dependencies still follow the policy. That is why
  `@expo/*` is listed next to `expo` in a bootstrap block.
- A glob exclude is a door for every future release under that name, not only the version you needed.
  On 2026-09-29 a `@typescript-eslint/*` glob let a one-day-old `@typescript-eslint/eslint-plugin`
  8.71.0 into a fresh install through `eslint-config-expo`'s `^8.59.0` range, next to
  typescript-eslint 8.70.1's own copy: every ESLint run crashed with
  `Cannot redefine plugin "@typescript-eslint"`. So a dated exclude names exact packages wherever it
  can, never a catch-all (`*`, `**`, `@*/*`; `npmrc-exclude` fails it), and a pinned package whose
  dependents float gets root overrides as well (the ten `@typescript-eslint/*` overrides in the
  seed policy).
- `npm ci`, and `npm install` with an existing lockfile, install the locked versions without
  re-checking age. The policy acts when a version enters `package-lock.json`: when a dependency is
  added or upgraded. `strict-allow-scripts` acts on every install, `npm ci` included (verified on a
  copy of the reference app: it passed with the app's approvals, and failed once one was removed).
- `npx` and `npm exec` run inside the repo read the project `.npmrc` too: `npx -y eas-cli@24.10.0` <!-- stack-pin-ignore: a one-day-old release -->
  (one day old) gave `ETARGET`, and `npx -y eas-cli@latest` resolved the newest release at least 7
  days old instead of the `latest` tag. `strict-allow-scripts` applies there as well, but the root
  `allowScripts` does not, so an npx tool whose tree holds an install script stops with
  `ESTRICTALLOWSCRIPTS` (the supply-chain reference, "npx and one-off tools inside the repo").
- A global install (`npm install -g`) ignores the project `.npmrc` even when run inside the repo: npm
  skips the project config in global mode (`npm config get min-release-age --global` printed `null`
  there). A global tool therefore carries the policy on its own command line:
  `npm install -g --min-release-age=7 --strict-allow-scripts <tool>@<x.y.z>`.
- CocoaPods and Gradle have no age gate; native SDKs follow the npm pins (the procedures reference,
  "After a native change").

## How the plan measures the age (--now and --today)

`plan-dependency.mjs --online` measures the age the way npm does: from the exact moment, `--now
<ISO time>` (default: the current time), back to the publish time, against the `.npmrc`
min-release-age in 24-hour days. `--today <YYYY-MM-DD>` only names the day the dated exclude blocks
are read for, and defaults to the UTC day of `--now`; it never moves the age check.

A release published 2026-09-25 14:06:55 UTC under `min-release-age=7` becomes installable at
2026-10-02 14:06:55 UTC. Planned at 2026-10-02 14:00 UTC it is `too-young` ("is 6 days old … Wait
until 2026-10-02T14:07Z", rounded up to the minute so the printed moment is never earlier than
npm's); planned at 14:10 UTC the same day it passes. So the plan never asks for an exclude on a day
the release is already installable.

## A bootstrap block (why a new project often needs one)

An Expo SDK patch pins module patches published the same day, so a project created within 7 days of
an Expo patch cannot resolve its own template under `min-release-age=7`. The reference app of this
library hit exactly that on 2026-10-03: `expo` 57.0.26 (published 2026-09-29) pins `expo-router`
57.0.24 and `expo-constants` 57.0.20 of the same morning, so `npx expo install` failed with
`ETARGET`. The fix is one dated block, deleted on its date (the lockfile keeps the versions):

```ini
# exclude-block expires=2026-10-06 reason=Expo SDK 57.0.26 module map (expo 57.0.26 of 2026-09-29 pins patch releases younger than 7 days)
min-release-age-exclude[]=expo
min-release-age-exclude[]=expo-*
min-release-age-exclude[]=@expo/*
min-release-age-exclude[]=babel-preset-expo
```

The expiry is the publish date of the youngest covered release plus the release age (2026-09-29 + 7
days). Prove each pattern necessary by removing it and resolving again; keep the list as short as
the resolution allows.

## Adding a dated exception

Only for a release the app needs before it is old enough, and only with the developer's agreement:

1. `node ${CLAUDE_SKILL_DIR}/scripts/plan-dependency.mjs <pkg>@<version> . --online` shows the publish
   time and, in its `too-young` fix line, the moment it becomes installable and the block's expiry
   date.
2. Copy `assets/npmrc-exclude-block.txt`, fill `__EXPIRES__` with the publish date + the `.npmrc`
   min-release-age (7 days, or the stricter value), `__REASON__` with the issue link or changelog
   line, and `__PACKAGE__` with the exact name (one line per extra name or glob, as few as possible,
   never a catch-all). Paste it at the end of `.npmrc` after one blank line (a blank line ends a
   block).
3. Install, then commit with a body that says why and a `Gate-Change:` trailer (git-commits-and-
   reporting owns the trailer).

## Expiry: delete, never extend

On or after the `expires=` date the whole block is deleted, not moved forward. Nothing reinstalls:
the lockfile keeps the versions. A block's date can never lie later than today plus the release age
(its release was published on or before today), so a later date was extended or invented, and both
checks fail it. `scripts/deps/check-deps.ts` (in `npm run verify`) and `check-deps-policy.mjs` fail
on:

- `expired`: an exclude inside a block whose date has passed;
- `no-block`: an exclude outside a `# exclude-block expires=YYYY-MM-DD reason=…` block;
- `outlives-release` / `npmrc-exclude`: a block that expires after today + the release age;
- `catch-all` / `npmrc-exclude`: a pattern that matches every package, or every scoped one;
- `policy-missing` / `npmrc-policy`: a missing `min-release-age` of 7 or more, `engine-strict=true`,
  `save-exact=true` or `strict-allow-scripts=true`;
- `policy-overridden` / `npmrc-policy`: a line that sets one of those keys to a weaker value
  (`min-release-age` below 7, `engine-strict=false`, `strict-allow-scripts=false`);
- `policy-bypass` / `npmrc-policy`: a key from "Keys that must never be in it".

## A new Expo patch inside the 7 days

Expo's own checks compare the installed SDK packages with the newest patch of the SDK line, whatever
its age. On 2026-09-29 `expo` 57.0.26 and `expo-constants` 57.0.20 were published at 10:56 UTC, and
three hours later `npx expo install --check` printed `expo@57.0.25 - expected version: ~57.0.26` <!-- stack-pin-ignore: the version installed that day -->
and `expo-doctor` reported a patch version mismatch, with no change to the repo. Installing the patch that day would break `min-release-age=7`,
and a dated exception for a routine patch is not worth a question to the developer. So:

- `scripts/deps/check-deps.ts` asks npm when each expected version was published
  (`npm view <pkg> time --json`). When every mismatch is a later patch of the same `major.minor` line
  and younger than the release age, it prints one `WARN` line per package with the day it becomes
  due (the first UTC day at least the release age after publication; 2026-10-07 for a patch
  published 2026-09-29 under `min-release-age=7`) and passes. Any other mismatch, an unknown publish
  time, or any other failing expo-doctor check still fails.
- On the due date the same mismatch fails. Then follow the upgrade procedure (the procedures
  reference, "Upgrade a package") with the command the `WARN` line printed: `npx expo install
  <pkg>@<spec as Expo printed it>` for an Expo-managed runtime package (a `~` range, or the exact
  version Expo pins for `react-native`, Reanimated, Worklets and Skia), `npm install -D
  <pkg>@<version>` for an Expo-map dev tool in `devDependencies` (`jest-expo`,
  `eslint-config-expo`); then the policy row, any root override, `npm install`, one commit.
- Never add an exclude for such a patch and never install it early; never pass `--fix` to Expo's
  checks inside the 7 days.
- A bare `npx expo install <pkg>` writes such a patch too. Always install Expo-managed packages with
  the row's spec, `npx expo install <pkg>@<row spec>`.

`scripts/deps/expo-patch-age.ts` (with its tests) holds the rule: the parsers for both outputs,
`dueDay`, and `judgeMismatches`.

## pnpm, Yarn and Bun

This policy is npm-first because `min-release-age`, `min-release-age-exclude`, `allowScripts` and
`strict-allow-scripts` (with `npm approve-scripts`) are npm features (all present from 11.17.0).
pnpm has its own
settings for the same ideas, per pnpm's docs (read 2026-10-03; not verified by this skill):
`minimumReleaseAge`, which is in **minutes** (7 days is `10080`; pnpm 11 defaults to `1440`, one
day) with `minimumReleaseAgeExclude`, and `allowBuilds` with `strictDepBuilds` for install scripts.
Yarn and Bun need equivalent controls before this skill's guarantees hold. The checkers read
`package-lock.json` only: with another package manager, `lockfile-missing` fails by design.

## What checks it

| Check | Where | Fails on |
|---|---|---|
| `release-age-excludes.ts` via `check-deps.ts` | `npm run verify` (and the pre-push hook, when quality-gates wires it there) | undated, expired, catch-all or outliving excludes; a missing, overridden or bypassed policy line (`package-lock=false` included) |
| `effective-npm-config.ts` via `check-deps.ts` and `check-npm-config.ts` | `npm run verify`; CI before `npm ci`; `eas-build-pre-install` | the config npm runs with differs from the policy (an `NPM_CONFIG_*` variable or `~/.npmrc` line), or holds an `allow-scripts` list |
| `engines-floor.ts` via `check-deps.ts` | `npm run verify` | root `engines` that admit npm below 11.17.0 or Node below 22.18, or are missing |
| `expo-patch-age.ts` via `check-deps.ts` | `npm run verify` | an Expo patch mismatch once its expected version is 7 days old (a `WARN` line with the due date before that) |
| `check-deps-policy.mjs` (this skill) | whenever dependencies change | all of the above for the files in the repo (`npmrc-policy`, `npmrc-exclude`, `engines`, `npm-env` for `eas.json` and GitHub workflows, `EAS_NO_FROZEN_LOCKFILE` in `eas.json` included), plus malformed block headers, and committed npx calls that install a package the policy keeps out (`npx-install`) |
| `plan-dependency.mjs --online` (this skill) | before installing | a version younger than the `.npmrc` release age (7 days or more, measured from `--now`) that no valid block covers |
