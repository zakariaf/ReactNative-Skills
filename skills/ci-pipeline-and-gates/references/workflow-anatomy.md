# Workflow anatomy: three workflows, pinned runners, the toolchain and the caches

What each of the three template workflows does, line by line, why it is split that way, what the
hosted runner images hold, and what CI can and cannot prove. Verified on 2026-10-14 against the
runner-images READMEs (Ubuntu 24.04 image 20261004.327.1, macOS 26 arm64 image 20260907.0351.1),
GitHub's runner and pricing docs, and actionlint 1.7.12 on the three templates.

## Contents

- Why three workflows
- ci.yml: the merge gate
- devices.yml: the device lanes
- release.yml: the manual release lane
- The runners
- The pinned toolchain
- Caches
- Reports and evidence
- Adding a skill's checker to CI
- Adopting into an existing repo
- When multi-package
- What CI cannot prove
- Re-verify

## Why three workflows

| Workflow | Starts on | Runner | Holds a secret | Typical time |
|---|---|---|---|---|
| `ci.yml` | every pull request, every push to `main`, by hand | `ubuntu-24.04` | no | the length of `npm run verify` plus install (budget 10 to 20 minutes; measure your own) |
| `devices.yml` | nightly (`cron`), by hand | `ubuntu-24.04` (Android), `macos-26` (iOS) | no | 20 to 60 minutes per lane (a cold Release build, then the flows) |
| `release.yml` | by hand only | `ubuntu-24.04` | yes (`EXPO_TOKEN`, in the `production` environment) | minutes (it starts an EAS build and exits) |

The split follows three differences that would otherwise fight inside one file:

- **Cadence.** The merge gate must be fast enough to run on every push; a device lane is not.
- **Cost.** A macOS minute costs about ten times a Linux minute on private repositories ($0.062
  against $0.006 per minute on standard runners, GitHub's pricing page, 2026-10-14). Public
  repositories run standard runners free.
- **Trust.** A pull request runs code nobody has reviewed yet. The workflows that run it hold no
  secret at all; the one that holds a secret starts only by hand and waits behind a protected
  environment.

## ci.yml: the merge gate

- `on: pull_request, push: branches: [main], workflow_dispatch`. `pull_request` (never
  `pull_request_target`) runs a fork's code with a read-only token and no secrets. The push to `main`
  verifies what actually merged (a merge commit can fail where both parents passed). A repository
  that turns on GitHub's merge queue with `verify` as a required check also needs `merge_group:` in
  this list: queued pull requests are checked on that event, and without it the required check is
  never reported, so every queued merge fails. Leave it out until the merge queue is on.
- `permissions: contents: read` at the top. Without it the token gets the repository default, which
  older repositories still set to read-write.
- `concurrency: group: ${{ github.workflow }}-${{ github.ref }}`,
  `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`: a new push to a pull request
  cancels the run of its previous push; pushes to different branches never cancel each other. Runs on
  `main` are never cancelled: with a plain `true`, two quick merges would cancel the first merge's
  run, and that merged commit would never be verified. (devices.yml keeps `true`: a nightly lane
  superseded by a newer one loses nothing.)
- `env: LEFTHOOK: '0'`: `npm ci` runs the `prepare` script, which installs the lefthook git hooks
  when the checkout is the git top level (it is on a runner). Nothing commits on the runner, so the
  hooks are switched off; `.github/workflows/` is the one place quality-gates' `check-bypasses`
  accepts the variable. `EXPO_NO_TELEMETRY: '1'` keeps Expo CLI quiet.
- One job, `verify`, with `timeout-minutes: 30`:
  1. `actions/checkout` with `persist-credentials: false`: no later step pushes, so the token is not
     left in `.git/config`.
  2. `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`: the project's Node (and
     the npm it ships), and npm's download cache keyed on `package-lock.json`.
  3. `npm ci`: exactly the lockfile, or a failure. The committed `.npmrc` applies (`engine-strict`,
     `strict-allow-scripts`, `min-release-age=7`).
  4. `npm run verify`: the same pipeline the pre-push hook runs (formatting, lint, types, catalogs,
     unused code, the guardrail, Jest with coverage, the extra gates, the release export, licences,
     the dependency policy). Nothing in CI decides what the gates are; quality-gates does.
  5. `actions/upload-artifact` with `if: ${{ always() }}`: `reports/` and `coverage/` survive a red
     run, for 14 days.

`npm run verify` needs the network (`check:deps` asks npm and Expo's API) and runs `expo export` for
both platforms; both work on a Linux runner. The guardrail inside `verify` also compares the scripts
in `package.json` with `quality-gates.json`, which is why the workflow calls the script and never a
copy of its commands.

## devices.yml: the device lanes

Two jobs, one per platform, each a Release build of the preview variant and the Maestro flows:

- **android** on `ubuntu-24.04`, `timeout-minutes: 75`: JDK 17 from the image
  (`JAVA_HOME_17_X64` into `$GITHUB_ENV`), the KVM udev rule, the pinned Android packages through
  `sdkmanager --install`, the Gradle caches, the Maestro download cache, `npm ci`,
  `npm run build:android:emu -- --variant preview`, `npm run e2e:android`, the reports.
- **ios** on `macos-26`, `timeout-minutes: 90`: JDK 17 for Maestro (`JAVA_HOME_17_arm64`; the image
  default is 21), the Maestro download cache, `npm ci`, `npm run build:ios:sim -- --variant preview`,
  `npm run e2e:ios`, the reports.

The scripts belong to other skills (android-emulator-build, ios-simulator-build, e2e-maestro) and do
the careful parts: a clean prebuild, the pinned Xcode or JDK selected per process, a device named
`<prefix>-<purpose>` created and addressed by its id, the variant exported once, the ready signal and
the screenshot. The workflow only provides the machine. [device-lanes.md](device-lanes.md) has the
platform details and the failures.

## release.yml: the manual release lane

`workflow_dispatch` with a `platform` choice, one job in the `production` environment, no cache, the
pinned EAS CLI, the release preflight, then `eas build ... --non-interactive --no-wait`.
[release-lane.md](release-lane.md) explains each step and the human setup it needs.

## The runners

Standard GitHub-hosted runners (GitHub docs, 2026-10-14):

| Label | Architecture | Public repository | Private repository | Notes |
|---|---|---|---|---|
| `ubuntu-24.04` | x64 | 4 CPU, 16 GB RAM, 14 GB SSD | 2 CPU, 8 GB RAM, 14 GB SSD | hardware acceleration for the Android emulator (KVM) |
| `macos-26` | arm64 (M1) | 3 CPU, 7 GB RAM, 14 GB SSD | same | no nested virtualization: the Android emulator cannot run |
| `macos-26-intel` | x64 | 4 CPU, 14 GB RAM | same | the Intel image, when an x86 simulator is needed |
| `ubuntu-latest`, `macos-latest` | moving | | | `ubuntu-latest` moves to Ubuntu 26.04 in November 2026: never use a `-latest` label |

What the images hold that matters here:

| | `ubuntu-24.04` (20261004.327.1) | `macos-26` (20260907.0351.1) |
|---|---|---|
| Node / npm preinstalled | 22.23.3 / 10.9.9 | 24.20.0 / 11.19.0 |
| JDK default | 17.0.20 (`JAVA_HOME_17_X64`) | 21.0.12 (`JAVA_HOME_17_arm64` = 17.0.20) |
| Xcode | — | 26.6 (default, `/Applications/Xcode_26.6.app`, build 17F113), 26.5, 26.4.1 ... |
| iOS simulators | — | iOS 26.5 runtime: iPhone 17, 17 Pro, 17 Pro Max, iPad Pro 13-inch (M5), ... |
| Android SDK | cmdline-tools 12.0, platform-tools 37.0.1, build-tools 36.0.0, platforms android-36, NDK 27.3 default; **no emulator package, no system image** | emulator 37.1.11 (unusable: no nested virtualization) |
| `ANDROID_HOME` | `/usr/local/lib/android/sdk` | `~/Library/Android/sdk` (the runner user's home) |

The preinstalled Node and npm are why every job runs `setup-node` from `.nvmrc`: the canonical
`package.json` has `engines` `node >=22.18`, `npm >=11.17.0` with `engine-strict=true`, so `npm ci`
on the Ubuntu image's npm 10.9 stops with `EBADENGINE` before installing anything. <!-- stack-pin-ignore: the runner image's npm -->

## The pinned toolchain

| Tool | Pinned where | How CI gets it |
|---|---|---|
| Node 26.4.0 (npm 11.17.0) | `.nvmrc` (expo-project-bootstrap writes it) | `setup-node` `node-version-file: .nvmrc` |
| npm packages | `package-lock.json` + `.npmrc` | `npm ci` |
| Xcode 26.6 | `scripts/ios/toolchain.ts` `XCODE_VERSION` (ios-simulator-build) | the build script picks the `/Applications/Xcode*.app` whose version is 26.6 (on the runner `Xcode_26.6.app`) and sets `DEVELOPER_DIR` per process; no `xcode-select`, no setup-xcode action |
| JDK 17 | React Native 0.86's Gradle plugin (`jvmToolchain(17)`), Maestro 2.10 | `JAVA_HOME_17_X64` / `JAVA_HOME_17_arm64` from the image into `$GITHUB_ENV` |
| Android API 36, build tools 36.0.0, NDK 27.1.12297006 | React Native's version catalog (android-emulator-build's `toolchain.ts`) | `sdkmanager --install` in the job (the NDK is not on the image; installing it up front is clearer than the Gradle plugin's 1 GB download mid-build) |
| Maestro 2.10.0 | `scripts/e2e/install-maestro.sh` (version + SHA-256, e2e-maestro) | the E2E runner calls the installer; the zip is cached by its key |
| EAS CLI 24.10.0 | the release workflow | `npm install -g --min-release-age=7 --ignore-scripts eas-cli@24.10.0` |
| Every action | a 40-character commit SHA + `# vX.Y.Z` | Dependabot proposes updates after 7 days ([security-hardening.md](security-hardening.md)) |
| Runner image | `ubuntu-24.04`, `macos-26` | changed in its own pull request, never by a moving label |

Moving a pin is a change of its own: one pull request that changes the pin, nothing else, with the
gate trailer when the file is gated, and a green run of every workflow it touches.

## Caches

| Cache | Path | Key | Why |
|---|---|---|---|
| npm downloads | `~/.npm` (setup-node `cache: npm`) | `package-lock.json` | `npm ci` reinstalls `node_modules` from it in seconds |
| Gradle | `~/.gradle/caches`, `~/.gradle/wrapper` | `package-lock.json` (React Native's version decides Gradle and its plugins; `android/` is generated and not committed) | a cold Gradle cache adds about ten minutes |
| Maestro zip | `~/.cache/maestro-cli` (Linux), `~/Library/Caches/maestro-cli` (macOS) | `scripts/e2e/install-maestro.sh` (it holds the version and checksum) | 315 MB per download; the installer checks the checksum of a restored zip too |

Never cached:

- **`node_modules`.** `npm ci` deletes it before installing, so a restored copy is wasted time at best;
  a copy built on another image can carry native builds that do not match.
- **Anything in a job that holds a secret.** A cache written by any branch's run can be restored by a
  later run; a poisoned entry would run next to the secret (setup-node 5 and later even turn its npm
  cache on by themselves when `package.json` names npm in `packageManager`; set
  `package-manager-cache: false` in such a job).
- **Pods and DerivedData.** The iOS build starts from a clean prebuild on purpose
  (ios-simulator-build); a cache of generated native folders would undo that.

Caches are scoped: a pull request can read the default branch's caches, but what it writes is visible
only to reruns of the same pull request.

## Reports and evidence

Every gate and device job ends with `actions/upload-artifact` under `if: ${{ always() }}`, path
`reports/` (and `coverage/` for verify), `if-no-files-found: ignore`, `retention-days: 14`. A red E2E
run is diagnosed from its screenshots and junit file; without the artifact they die with the runner.
A report states what ran: the workflow run URL is the evidence a release report cites, never a local
run described from memory.

## Adding a skill's checker to CI

Several skills ship a checker the repo should run on every pull request (a ledger, a contract, a
budget). It reaches CI the same way every gate does: through `npm run verify`, never as a step
written into `ci.yml`.

1. **Commit the checker into the repo.** `${CLAUDE_SKILL_DIR}` exists on the developer's machine,
   not on the runner: copy the script (with its `lib/` and `check-lib.mjs`) to a repo folder such as
   `scripts/checks/<skill>/`, in the gated paths.
2. **Wrap it in an npm script** and append the name to `verifyExtraSteps` in `quality-gates.json`
   (quality-gates, "Adding a gate from another skill": one commit with a `Gate-Change:` trailer). It
   then runs in the pre-push hook and in CI alike, and the guardrail sees it.
3. **A checker that compares with the target branch** (for example run-migration's
   `check-migration.mjs . --base origin/main`) needs that branch in the checkout. Set
   `fetch-depth: 0` on the verify job's checkout: it fetches every branch, so `origin/main` exists
   on a pull request run too. Do not add a later `git fetch origin main` instead: with
   `persist-credentials: false` no token is left in `.git/config`, so the fetch fails on a private
   repository, and switching the credentials back on to make it work hands the token to every later
   step. Pass the base through `env:`, never as `${{ }}` inside the script:

   ```yaml
         - name: Check out
           uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
           with:
             persist-credentials: false
             fetch-depth: 0
         # ...
         - name: Run every gate (npm run verify)
           run: npm run verify
           env:
             GATE_BASE: origin/${{ github.base_ref || 'main' }}
   ```

   and in `package.json`: `"check:migration": "node scripts/checks/run-migration/check-migration.mjs
   . --base \"${GATE_BASE:-origin/main}\""`. `github.base_ref` (the `GITHUB_BASE_REF` variable) is
   the pull request's target branch and empty on a push, where comparing `main` with `origin/main`
   finds no change by design. Locally the default `origin/main` applies. A full clone costs seconds
   on an app repository; measure it before worrying about it.

Both checkers of this skill pass this shape (`pass-fetch-depth` in the self-test).

## Adopting into an existing repo

1. Check what the repo has: `ls .github/workflows .github/dependabot.yml .nvmrc` and
   `node -p "Object.keys(require('./package.json').scripts).join(' ')"`.
2. Without `npm run verify`, adopt quality-gates first: CI repeats the local gate, it does not invent
   one.
3. Copy `ci.yml` and `dependabot.yml`, then `devices.yml` only for the lanes the repo has scripts
   for (delete a job that has none, or keep it: the checker prints a SKIP while the owner skill has
   not created the script yet), then `release.yml` once eas-build-and-submit's preflight exists.
4. Replace an existing workflow's ad-hoc steps (`npx jest`, `npx eslint .`, `expo export`) with the
   npm scripts; delete steps the scripts already cover.
5. Run both checkers and actionlint, then ask the developer before pushing (a workflow runs on
   GitHub's machines under the repository's name).

## When multi-package

- The workflows stay at the repository root (`.github/` is per repository).
- `npm ci` and `npm run verify` run at the root; quality-gates' multi-package scripts run every
  workspace.
- Device scripts that live in one app's `package.json` run with
  `npm run build:ios:sim --workspace apps/mobile -- --variant preview`; pass `--app-dir apps/mobile`
  to `check-ci-lanes.mjs` so it reads that app's scripts.
- One device job per app that ships, never one job that builds every app (one failure would hide the
  others, and the timeout would be the sum).

## What CI cannot prove

A green pipeline proves the gates and the flows on simulators and emulators. It does not prove: the
app on a real phone (performance on low-end hardware, thermal throttling, a real camera, biometric
prompts), push delivery, real store purchases and receipts, audio output, TestFlight or Play
processing, or behaviour after an OTA update reaches an old binary. Those stay manual steps named in
the release checklist (ios-release-testflight, android-release-play, design-review-workflow). Say so
in a report instead of letting green stand for them.

CI only proves goldens by running them (inside `npm run verify`'s Jest run, or `npm run test:golden`);
it never rebaselines them: no `jest -u`, no run-goldens-rebaseline script in a workflow, and `reports/`
is uploaded as evidence, never committed back as baselines.

## Re-verify

```sh
curl -s https://raw.githubusercontent.com/actions/runner-images/main/images/macos/macos-26-arm64-Readme.md | grep -A10 '^### Xcode'
curl -s https://raw.githubusercontent.com/actions/runner-images/main/images/ubuntu/Ubuntu2404-Readme.md | grep -A12 '^### Android'
actionlint .github/workflows/*.yml        # a pinned release binary; see checks.md
```
