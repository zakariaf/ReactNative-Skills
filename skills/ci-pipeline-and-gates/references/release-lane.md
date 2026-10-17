# The release lane: EAS builds started by hand, behind a protected environment

How `templates/workflows/release.yml` starts a store build on EAS from CI, what the developer sets
up by hand first, and what stays out of CI. The EAS commands and their flags belong to
eas-build-and-submit (`scripts/eas/eas-commands.ts`, `release-preflight.ts`); this page covers the
CI side: trigger, environment, token, install and order. Verified on 2026-10-14 against Expo's
"Trigger builds from CI" page and eas-cli 24.10.0 (the version tools pin); no build was started by
this skill (no EAS project, no token).

## Contents

- Why by hand
- The human setup
- The job, step by step
- What never runs from CI
- Expo's EAS Workflows instead of GitHub Actions
- When the app has no EAS
- Re-verify

## Why by hand

A store build uses build credits, a version number and the store's processing; a submission or an
OTA update reaches testers or users. Each is an outward-facing act that a person decides. So:

- the workflow starts only on `workflow_dispatch` (or a pushed release tag, if the team tags by
  hand), never on a push to a branch, a pull request or a schedule (`release-trigger`);
- the job names `environment: production`, whose required reviewers approve each run before it can
  read `EXPO_TOKEN` (`release-environment`, `secret-environment`);
- `concurrency` has one group and `cancel-in-progress: false`: a second start waits instead of
  killing a build halfway.

Pushing this workflow, and starting it, are both the developer's calls: the agent prepares the file,
runs the checkers and actionlint, and asks.

## The human setup

1. On expo.dev, create an access token for CI (a robot user's token is the narrowest; a personal
   token also works) and keep it out of every file.
2. GitHub > Settings > Environments > New environment `production`: required reviewers (at least one
   person other than the one starting the run, when the team has two), deployment branches `main`
   only, and the environment secret `EXPO_TOKEN`.
3. Make sure the EAS project exists and its credentials are stored on EAS (eas-build-and-submit's
   first-time steps, run locally): the CI job uses `--freeze-credentials` and never creates or
   changes credentials.

## The job, step by step

```yaml
eas-build:
  runs-on: ubuntu-24.04
  timeout-minutes: 45
  environment: production
  steps:
    - uses: actions/checkout@<sha> # v7.0.1      with persist-credentials: false, fetch-depth: 0
    - uses: actions/setup-node@<sha> # v7.0.0    node-version-file: .nvmrc, package-manager-cache: false
    - run: npm ci
    - run: npm install -g --min-release-age=7 --ignore-scripts eas-cli@24.10.0
    - run: node scripts/eas/release-preflight.ts --profile production --platform "$PLATFORM"
    - run: eas build --profile production --platform "$PLATFORM" --non-interactive --freeze-credentials --no-wait --message "release from $GITHUB_SHA"
```

- `fetch-depth: 0`: the preflight compares the version with the last release tag, so the checkout
  needs the tags and history (the default is one commit).
- No cache in a job with a secret ([security-hardening.md](security-hardening.md)).
- The EAS CLI is installed globally, one exact version, with the dependency policy on the command
  line: `npx eas-cli` inside the repo stops with `ESTRICTALLOWSCRIPTS` (the repo's
  `strict-allow-scripts`) and would otherwise take whatever version is newest
  (`eas-cli-pinned`); Expo's own example uses `expo/expo-github-action` with `eas-version: latest`,
  which the same rule refuses. 24.10.0 was published on 2026-10-02 and is installable under the 7-day
  release age from 2026-10-09. Keep it at or above `cli.version` in `eas.json`.
- The preflight runs first and stops the job when the tree is not clean on `main`, `npm run verify`
  fails, or the app config or fingerprint is wrong. It prints the `eas build` command; in CI the next
  step runs that command.
- `--non-interactive` (`eas-non-interactive`): a prompt on a runner waits until the timeout.
  `--no-wait` exits once EAS has queued the build: the runner does not pay for EAS's build time, and
  the build's result is read on expo.dev or with `eas build:view` afterwards.
- Values reach the shell through `env:` (`PLATFORM`, `EXPO_TOKEN`), never inline `${{ }}`
  (`run-injection`).
- The build is not submitted here. Submitting the finished build to TestFlight or Play internal
  testing is the developer's next step, through eas-build-and-submit's runbook: `check-eas-build` on
  the build record, the store-artifact gate on the downloaded `.ipa` / `.aab` (ios-release-testflight,
  android-release-play), then `eas submit --path <gated file>`. A team that wants `--auto-submit`
  decides that in writing, for iOS only (an Android bundle must pass its gate before Play sees it),
  and the environment's reviewers still approve every run.
- When the app uses design-review-workflow, its release gate runs in this job before the preflight:
  `node scripts/checks/design-review-workflow/check-signoff.mjs .` (committed into the repo like any
  other checker). It reads git history, which `fetch-depth: 0` provides; on a shallow clone pass
  `--changed-from` a file holding `git diff -U0 <signed>..<release>` (the diff, not `--name-only`,
  so the build-number bump commit passes).

## What never runs from CI

- `eas build` (also `--local`, which needs `EXPO_TOKEN` and downloads the managed signing
  credentials) on a pull request, a push or a schedule, `eas submit` on anything but a manual start, and `eas update` on a push: an OTA update reaches users' phones at their next launch
  (ota-updates owns the update channel and its own gates).
- Any command that creates, changes or prints credentials (`eas credentials`, a `--clear-*` flag).
- Signing files written into the workspace or uploaded as an artifact.

## Expo's EAS Workflows instead of GitHub Actions

Expo runs its own CI (`.eas/workflows/*.yml`) on EAS machines, with jobs for builds, submissions,
updates and Maestro tests. It is a reasonable alternative for teams that already pay for EAS; Expo's
official `eas-workflows` skill is the reference for its syntax. The same rules carry over: the gate
is `npm run verify`, devices are named by the scripts, release jobs start by hand. This skill's
checkers read GitHub Actions files only.

## When the app has no EAS

The local release lanes (ios-release-testflight, android-release-play) build and sign on a machine
the developer controls. Running them in CI needs signing secrets on a macOS runner; keep it out of CI
unless the developer decides otherwise, and then follow those skills' procedures with the secrets in
an environment, written to `$RUNNER_TEMP` and deleted in an `if: ${{ always() }}` step.

## Re-verify

```sh
npm view eas-cli version time --json | head -20     # the newest version and its publish dates
eas build --help | grep -E 'non-interactive|no-wait|freeze-credentials'
```

Read https://docs.expo.dev/build/building-on-ci/ when the CI token or the flags change.
