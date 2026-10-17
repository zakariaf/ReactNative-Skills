# The checkers: every rule, the contract, options and expected output

`scripts/check-workflows.mjs` reads how the workflows are written (pins, permissions, secrets,
caches); `scripts/check-ci-lanes.mjs` reads what they run (the gate, the lanes, the release). Both
are zero-dependency Node scripts with their own YAML reader, take the repo root as the first
positional argument, and print one `FAIL <file>:<line> [<rule>] <message> Fix: <fix>` line per
problem, then `RESULT: PASS` or `RESULT: FAIL (<n> problems)`.

## Contents

- Running them
- check-workflows rules
- check-ci-lanes rules
- contracts/ci.json
- Expected SKIP and NOT APPLICABLE lines
- What soft-fail and run-injection cannot see
- What release-trigger cannot see
- What the YAML reader accepts
- actionlint
- When multi-package

## Running them

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-workflows.mjs .
node ${CLAUDE_SKILL_DIR}/scripts/check-ci-lanes.mjs .                      # --app-dir apps/mobile when multi-package
node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs                              # after changing a checker or a template
```

Exit 0 pass (SKIP lines and NOT APPLICABLE included), 1 problems, 2 bad input (no `package.json`, an
existing but empty `.github/workflows/` for both checkers, a malformed `contracts/ci.json`). `--json`
adds the problems as JSON.

## check-workflows rules

| Rule | Fails when | Why |
|---|---|---|
| `yaml-syntax` | a workflow or `dependabot.yml` does not parse (tabs, bad indentation, anchors, tags, two documents) | the other rules cannot read it; a reviewer should not need YAML's corners either |
| `action-sha-pin` | a `uses:` is not `owner/repo@<40-hex SHA>` with a `# vX.Y.Z` comment; `docker://` without `@sha256:` | tags and branches move; the comment keeps the pin reviewable |
| `runner-pinned` | `runs-on` (or the matrix value it reads) is a moving `latest` label: `ubuntu-latest`, `macos-latest`, `macos-latest-large`, `macos-latest-xlarge` | the image changes under the workflow with no diff |
| `permissions-default` | no top-level `permissions:`, `write-all`, or a top-level scope other than `read`/`none` | every step and action would get the repository default token |
| `no-pr-target` | `pull_request_target` or `workflow_run` is a trigger | secrets and a write token next to a fork's code |
| `persist-credentials` | `actions/checkout` without `persist-credentials: false` | the token stays in `.git/config` for every later step |
| `run-injection` | a `${{ }}` in a `run:` script reads anything but `runner.*`, `vars.*`, fixed `github.*` values, or `matrix.*` of a matrix written out literally in the job; `env.*` included | text a contributor controls runs as code; a secret lands in the script file; `${{ env.X }}` pastes whatever was put into `X` (read `"$X"` instead) |
| `secret-environment` | a job reads `secrets.*` (other than `GITHUB_TOKEN`) or `secrets: inherit` without `environment:`; any secret in the workflow-level `env:`; a job that calls a reusable workflow passes it a secret (`secrets:` map or `inherit`) | the environment's reviewers and branch rule are what protect the secret; a workflow-level secret reaches every job and step, same-repository pull request runs included; a calling job cannot name `environment:` (the called workflow's job names it and reads the environment secret itself) |
| `concurrency` | no workflow- or job-level concurrency group; a workflow with an environment job sets `cancel-in-progress` to anything but `false` | stale runs keep running; a release cancelled halfway leaves a half-made build |
| `job-timeout` | a job without `timeout-minutes`, or outside 1 to 180 | the default is six hours of a hung simulator |
| `soft-fail` | `continue-on-error` on a job or step, `\|\| true`, `\|\| exit 0`, `\|\| :`, `set +e`; any `\|\|` after `npm ci`, `npm run`/`test`/`exec`, `node`, `npx`, `eas` or a `scripts/` file whose fallback does not end in `exit`, `exit <non-zero>` or `false` (a retry such as `npm ci \|\| npm ci` included); one of those commands piped into another (`npm run verify 2>&1 \| tee reports/verify.log`) unless the step or `defaults.run` names `shell: bash` (or a shell with `pipefail`) or an earlier line runs `set -o pipefail` | a red step shown green is a gate already gone (limits: "What soft-fail cannot see" below) |
| `npm-config-env` | an `NPM_CONFIG_*` / `npm_config_*` variable at any level, an inline `npm_config_x=` assignment, `npm config set` | it beats the committed `.npmrc` (release age, install scripts, engines) |
| `lefthook-off` | a job installs dependencies without `LEFTHOOK: '0'` in its workflow, job or step env | `prepare` installs the git hooks on the runner |
| `cache-key` | `actions/cache` of `node_modules`, or a key without `hashFiles(...)` | stale native builds; a cache that never invalidates |
| `release-no-cache` | a job with an environment uses `actions/cache`, or `setup-node` without `package-manager-cache: false` or with `cache:` | cache poisoning next to a secret |
| `dependabot-actions` | no `.github/dependabot.yml`, no `github-actions` entry, or `cooldown.default-days` below 7 | SHA pins that never move miss security fixes; a fresh release waits a week like npm packages |

## check-ci-lanes rules

| Rule | Fails when | Why |
|---|---|---|
| `yaml-syntax` | a workflow does not parse (the cross-workflow rules are then not judged, and a note says so) | |
| `verify-gate` | no job in a `pull_request` workflow runs `npm ci` and then `npm run verify`; a job- or step-level `if:` other than `success()` on that job or those two steps; `pull_request` with `paths`, `paths-ignore`, `branches`, `branches-ignore`, or `types` without `opened`, `synchronize`, `reopened`; no `push` trigger, or one whose `branches` leave out `main`, whose `branches-ignore` match `main`, with `paths` filters, or `tags` only; `cancel-in-progress: true` in that workflow (it cancels runs on `main` too) | CI and the pre-push hook must run the same gate, on every pull request and on what merged; a filtered required check never starts and blocks the merge, or lets the change through unverified |
| `install-ci` | `npm install` / `npm i` (not global), `yarn`/`pnpm`/`bun` with a `package-lock.json`, `npm ci` with `--force`, `--legacy-peer-deps`, `--ignore-scripts`, `--min-release-age=`...; a global install without one exact `pkg@x.y.z`, `--min-release-age=7` and `--ignore-scripts` | only the lockfile and the `.npmrc` policy decide what installs |
| `ad-hoc-command` | `eslint`, `tsc`, `jest`, `prettier`, `knip`, `stryker`, `expo`, `expo-doctor`, `xcodebuild`, `gradlew`, `pod`, `react-native`, `detox`, `fastlane` run directly (with or without `npx`) | CI would check something other than the scripts; the guardrail compares only the scripts |
| `node-pin` | a job runs `npm`, `npx` or `node` without an earlier `setup-node`; `setup-node` with `node-version:`; with no version; with a `node-version-file` that does not exist | the images' Node and npm fail `engine-strict`; one pin file serves local, CI and EAS |
| `script-missing` | `npm run <x>` with no such script, or `node`/`bash <file>` that does not exist (a SKIP when another skill creates it) | the run would fail minutes in |
| `device-lane` | a device script exists (`build:android:emu`, `e2e:android`, `build:ios:sim`, `e2e:ios`) and no job runs it, or only a manually started one does | a lane nobody runs proves nothing |
| `lane-runner` | an Android lane on a runner that is not Linux, or without a KVM step; an iOS lane off macOS | no nested virtualization on macOS arm64; software emulation does not finish; no Xcode on Linux |
| `jdk-pin` | a job runs `build:android:emu`, `e2e:*` or `screenshots:*` without `JAVA_HOME_17_*`, `setup-java` 17 or a job `JAVA_HOME` of 17 | Gradle and Maestro were verified on 17; the macOS default is 21 |
| `raw-device-command` | `maestro`, `adb`, `emulator`, `avdmanager`, `xcode-select` or `xcrun simctl` in a run step; `reactivecircus/android-emulator-runner`, `maxim-lobanov/setup-xcode`, `futureware-tech/simulator-action`, `mobile-dev-inc/action-maestro-cloud` | devices are created and addressed by the repo's scripts; a cloud action uploads the app |
| `sdk-licence` | `sdkmanager --licenses` in a workflow | accepting a licence is the developer's decision |
| `reports-artifact` | a job runs `verify` or a device script without `actions/upload-artifact` under `if: always()`, `failure()` or `!cancelled()` | screenshots and junit die with the runner |
| `release-trigger` | a workflow that runs a release starts on anything but `workflow_dispatch` or a tags-only push. A release is `eas build`/`submit`/`update`/`deploy`/`workflow:run`, an npm script named `release` or `release:*`, a `node scripts/release*` store lane, or a `scripts/eas/` file that spawns `eas build`/`submit`/`update`; `npm run <x>` is followed into the `package.json` text, recursively (6 levels, cycles stop), so `npm run release:eas` or `npm run ship` that ends in `eas build --auto-submit` counts | builds, submissions and updates are decided by a person |
| `release-environment` | the job running such a command has no `environment:` | the reviewers approve each release run |
| `eas-cli-pinned` | `npx eas-cli` / `npx eas`; `expo/expo-github-action` with an `eas-version` that is not `x.y.z` | an unpinned CLI changes behaviour between runs; npx stops on strict-allow-scripts |
| `eas-non-interactive` | `eas build` or `eas submit` without `--non-interactive` | a prompt waits until the timeout |
| `variant-pair` | `APP_VARIANT` and `EXPO_PUBLIC_APP_VARIANT` differ (or one is missing) in one env block | native config and JS bundle built as different variants (app-variants-and-environment) |
| `workflows-gated` | `quality-gates.json` `gatedPaths` does not match a workflow file or `dependabot.yml` (SKIP while quality-gates.json does not exist) | a commit could weaken CI without a `Gate-Change:` trailer |
| `lane-opt-out` | `contracts/ci.json` `laneOptOuts` is not an object, names an unknown lane, gives a reason shorter than 20 characters, or opts out a lane a workflow runs | an opt-out is a recorded decision, not a way to silence the check |

## contracts/ci.json

```json
{
  "$schema": "./ci.schema.json",
  "laneOptOuts": {
    "ios-e2e": "macOS minutes are not budgeted for this private repository; flows run locally before releases."
  }
}
```

Optional: without it, every lane with a script is expected in CI. Lanes: `android-build`,
`android-e2e`, `ios-build`, `ios-e2e`. The schema ships beside it (`templates/contracts/ci.schema.json`).
An opt-out is the developer's decision; the agent asks before writing one and quotes the reason in
its report.

## Expected SKIP and NOT APPLICABLE lines

| Line | When it is legitimate |
|---|---|
| `NOT APPLICABLE: no .github/workflows/ folder ...` | the repo has no `.github/workflows/` folder (check-workflows: and no `dependabot.yml` either; with only `dependabot.yml` it checks that file). It means this skill was not applied: after Workflow step 2 both checkers print `N files checked` / `N workflows checked` instead, and a NOT APPLICABLE then is a missed copy step |
| `SKIP .github/workflows/devices.yml [script-missing] npm script "build:android:emu" not yet created (android-emulator-build creates it)` | until android-emulator-build is adopted |
| `SKIP ... npm script "e2e:ios" not yet created (e2e-maestro creates it)` (also `e2e:android`) | until e2e-maestro is adopted |
| `SKIP ... npm script "build:ios:sim" not yet created (ios-simulator-build creates it)` | until ios-simulator-build is adopted |
| `SKIP .github/workflows/release.yml [script-missing] scripts/eas/release-preflight.ts not yet created (eas-build-and-submit creates it)` | until eas-build-and-submit is adopted |
| `SKIP quality-gates.json [workflows-gated] not yet created (quality-gates creates it)` | an app without quality-gates yet (adopt it first: CI repeats its gate) |

A SKIP is never a reason to delete the job: it disappears when the owner skill's script lands. Any
other SKIP text is a bug in the checker.

## What soft-fail and run-injection cannot see

Both rules read each line of a `run:` script on its own; they are a net for the common forms, not a
shell parser. Not detected, and still a soft fail or an injection a reviewer must refuse:

- An `||` or a pipe after a command the rule does not list (`./gradlew test || echo`,
  `./gradlew test | tee`), a fallback that opens a `{` block continued on the next lines,
  `if ! npm run verify; then echo ...; fi`, a `trap ... EXIT` that resets the status,
  `set +o errexit`, `set +o pipefail` after `shell: bash`, and a soft fail inside a script file the
  step calls.
- An expression that reaches the shell another way: `${{ }}` written into a file in one step and
  `source`d in the next, `actions/github-script` `script:` bodies, a composite action's own `run:`.

The rule of thumb behind both: a gate command's own exit code decides the step, and the script reads
every value from an environment variable (`"$VALUE"`), never from `${{ }}`.

## What release-trigger cannot see

The rule follows `npm run` through `package.json` and recognises the release names this library
uses (`release:eas`, `release:ios`, `release:android`, `scripts/release*/`). It does not read inside
other script files, `npx` packages or composite actions, so a release started by a file with another
name (`node scripts/deploy.ts` that spawns `eas submit`, `fastlane` behind a shell script, a third
party action that uploads) passes it. A reviewer refuses those on sight: any workflow a push, pull
request or schedule starts must not reach a store, an EAS build or an update, whatever the step is
called.

## What the YAML reader accepts

Block mappings and sequences, plain and quoted scalars, literal and folded block scalars (`|`, `|-`,
`>-`, ...), flow sequences and mappings over one or more lines, comments (kept on scalars, which is
how the `# vX.Y.Z` comment is read). A `runs-on: ${{ matrix.<key> }}` label is resolved from a
`strategy.matrix.<key>` list only; the `matrix.include: [{ <key>: ... }]` form is not followed, so
an iOS lane written that way fails `lane-runner` with the literal expression and `runner-pinned`
does not see a `-latest` label inside `include`: list the runners under `matrix.<key>` instead. Not
accepted, by design: anchors and aliases (`&x`, `*x`), tags
(`!x`), tabs in indentation, more than one document, duplicate keys. GitHub accepts anchors since
2025; this library does not use them, because a reviewer should see every step of a job where it
runs.

## actionlint

The checkers judge policy; actionlint judges GitHub's own schema and expressions (unknown keys,
wrong contexts, shell problems with shellcheck installed). Run it before pushing a workflow change,
from a pinned release binary checked against the release's checksums file (no `go install`, no
`brew` on a shared machine):

```sh
V=1.7.12; curl -fsSLO https://github.com/rhysd/actionlint/releases/download/v$V/actionlint_${V}_darwin_arm64.tar.gz
curl -fsSLO https://github.com/rhysd/actionlint/releases/download/v$V/actionlint_${V}_checksums.txt
grep darwin_arm64 actionlint_${V}_checksums.txt | shasum -a 256 -c - && tar xzf actionlint_${V}_darwin_arm64.tar.gz actionlint
./actionlint .github/workflows/*.yml
```

(`linux_amd64` on Linux.) The three templates pass actionlint 1.7.12 (2026-10-14).

## When multi-package

- The workflows stay at the repository root; pass the repository root as the positional argument.
- `--app-dir apps/mobile` tells `check-ci-lanes` which lanes the app has (its `package.json`
  scripts, for `device-lane`); the pin file (`.nvmrc`) and `quality-gates.json` are read at the root.
- `script-missing` looks a command up where npm would run it: `npm run <x> --workspace <dir>` (also
  `-w <dir>`, `--workspace=<dir>`, `--prefix`, `-C`, before or after the script name) in
  `<dir>/package.json`, any other `npm run` (`verify` included) in the root `package.json`.
- A job that runs a workspace script is matched to its lane by the script name
  (`pass-multi-package` in the self-test uses both flag orders).
