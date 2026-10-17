# Runbook: from a reviewed commit to TestFlight and Play internal testing

The release sequence with every command, in order, and where the developer's word is needed. Commands
verified against EAS CLI 24.10.0's flags (`build/commands/build/index.js`, `submit.js`,
`build/view.js`) and docs.expo.dev on 2026-10-14. No build or submission was run against a real Expo,
Apple or Google account while writing this skill; the gates, the record check and the commands were
proven on the reference app, its fixtures and EAS CLI's offline `eas config`.

## Contents

- Install the CLI
- Internal builds for testers and E2E
- The store release, step by step
- What to Test, groups, and the Play track
- After the submission
- Building on your own machine (--local)
- EAS Workflows and CI
- What needs the developer

## Install the CLI

```sh
npm install -g --min-release-age=7 --ignore-scripts eas-cli@24.10.0
eas --version            # eas-cli/24.10.0 ...
eas whoami               # the developer's account; CI uses EXPO_TOKEN instead of eas login
```

A global install ignores the project `.npmrc`, so the policy flags go on the command line
(dependency-management). Never `npx eas-cli` inside the app (`ESTRICTALLOWSCRIPTS` under
`strict-allow-scripts`). EAS CLI is deliberately not a dependency, so an npm script that calls `eas`
makes knip report `Unlisted binaries: eas`; keep `eas` out of `package.json` scripts (the preflight
prints the line, CI calls `eas` directly), or add `"eas"` to knip's `ignoreBinaries` with that reason. The eas.json `cli.version` floor refuses an older CLI: "You are on eas-cli@x
which does not satisfy the CLI version constraint defined in eas.json".

## Internal builds for testers and E2E

| Need | Command |
|---|---|
| dev client on a phone | `eas build --profile development --platform ios --freeze-credentials` (devices registered first: `eas device:create`) |
| dev client on a simulator | `eas build --profile development-simulator --platform ios --freeze-credentials` |
| release build for testers | `eas build --profile preview --platform all --freeze-credentials` (iOS: registered devices only; Android: an APK from the build page) |
| release build for simulator E2E | `eas build --profile preview-simulator --platform ios --freeze-credentials`, then `eas build:run --profile preview-simulator --platform ios --simulator <udid>`, the UDID of a `<project>-<purpose>` simulator created as ios-simulator-build describes (without `--simulator`, eas-cli 24.10.0's `build:run` installs on the first booted simulator, another session's on a shared machine) |
| release build on an Android emulator | `eas build --profile preview --platform android --freeze-credentials`, then download the APK from the build page (or build it with `--local --output build/eas/preview.apk`) and `adb -s <serial> install -r <apk>` on the emulator android-emulator-build started by AVD name; never `eas build:run -p android`, which installs on the first running emulator |

Internal builds use the testing variants' own ids and never reach a store, so they need no preflight;
they still run from a committed tree (`requireCommit`) and keep the stored credentials as they are
(`--freeze-credentials`, checked by `eas-commands`). A newly registered device reaches the ad hoc
provisioning profile through the developer, who refreshes it with `eas credentials` (a credentials
change, rule 1) before the next internal build.

## The store release, step by step

1. **Gates, locally.** On the release branch with a clean tree:
   `node ${CLAUDE_SKILL_DIR}/scripts/check-eas-config.mjs . --release`, then
   `node scripts/eas/release-preflight.ts --profile production --platform all --what-to-test "<what testers should check>"`.
   The preflight stops on a dirty tree, another branch, a profile that is not a store build, a red
   `npm run verify`, a version not above the last release tag, or an app config whose ids differ from
   the submit pins. It runs unattended (no prompt, also under `CI=true`) and exits non-zero on any failed
   gate. It writes `dist/eas/fingerprint-ios.json` and `-android.json` and prints the release sequence
   of steps 3 to 6: the build line (no `--auto-submit`, `--json` into `dist/eas/builds.json`), a
   `check-eas-build` line per platform (`<eas-build-and-submit>` stands for this skill's folder), the
   download and store-artifact gate lines, and an `eas submit --path <gated file>` line per platform,
   What to Test on the iOS one. It runs nothing outward. When the app config reads an EAS environment
   variable, run it as `eas env:exec production 'node scripts/eas/release-preflight.ts ...'`
   ([versions-and-fingerprints.md](versions-and-fingerprints.md)). `dist/` and `build/` must be
   git-ignored (the canonical `.gitignore` and the Expo template do it): the fingerprints, the records
   and the downloads land there, and with `requireCommit` any untracked file there makes EAS CLI stop
   with "You have some uncommitted changes" and the next preflight refuse the dirty tree.
2. **Ask.** A store build spends a build number, and each submission uploads to App Store Connect and
   Google Play: ask the developer once, with the version, the commit and the sequence the preflight
   printed. Go on only with a yes given in this session. Two other skills add to this question when
   they are set up: a schema version that is pending (run-migration's `check-migration` shows a step
   newer than `contracts/schema-ledger.json`) becomes permanent with the first tester build, so name
   it in the ask and, after the upload, record it with run-migration's `record-shipped --build <build>`;
   and design-review-workflow's `check-signoff.mjs` must print `RESULT: PASS` for the version before
   anything is submitted.
3. **Build.** Run the printed build line as it is:
   `eas build --profile production --platform all --non-interactive --freeze-credentials --message '<commit subject>' --json > dist/eas/builds.json`.
   It does not submit. Only when the developer explicitly agreed to submit each build before its
   record is checked, rerun the preflight with `--auto-submit`: its build line then carries
   `--auto-submit` and `--what-to-test`, and steps 4 and 5 come after the upload.
4. **Check the record** of each platform before anything is submitted:
   `node ${CLAUDE_SKILL_DIR}/scripts/check-eas-build.mjs . --build dist/eas/builds.json --platform ios`
   (and `--platform android`). It proves a finished store build of the production profile, from the
   reviewed commit, for the production id, with the app config version, a build number above every
   upload tag and the preflight's fingerprint. A platform with no upload tag yet gets
   `--previous <last-ios-build-number>` on its printed line: fill in the last number the store has
   (`eas build:version:get --platform ios`), or replace the pair with `--first` for the app's very first
   upload. When multi-package, pass `--app-dir apps/<app>`: the checker then reads that app's
   `<app>/vX.Y.Z+<platform>.<n>` tags only. For a build started elsewhere: `eas build:view <build id> --json > dist/eas/build-ios.json`.
5. **Download and gate each artifact.** The record's `artifacts.applicationArchiveUrl` is the store
   binary (`eas build:download` fetches simulator and emulator builds only). The printed lines save it
   where the stores' own skills read it and run their gates on that file:
   `curl -fsSL -o build/ios-release/export/app.ipa <ios-archive-url>`, then ios-release-testflight's
   `check-store-artifact.mjs . --ipa build/ios-release/export/app.ipa --variant production --version <x.y.z> --build <n>`;
   `curl -fsSL -o build/release-android/app-release.aab <android-archive-url>`, then android-release-play's
   `check-store-aab.mjs . --aab build/release-android/app-release.aab --version-code <n> --stamp build/release-android/aab-gate.json`.
   Each must print `RESULT: PASS`; the build numbers come from the record's `appBuildVersion`.
6. **Submit the gated files**, one platform at a time, with the printed lines:
   `eas submit --profile production --platform ios --path build/ios-release/export/app.ipa --non-interactive --what-to-test '<text>'`
   and `eas submit --profile production --platform android --path build/release-android/app-release.aab --non-interactive`.
   `--path` uploads exactly the bytes the gates read; `--id <build id>` would send EAS's copy of the
   same build, equal only as long as nothing changed in between, so the library's one form is `--path`
   (ios-release-testflight and android-release-play name the same command). `eas submit` waits for the
   submission to finish by default (`--wait`); never `--latest`, which takes whatever build finished
   last. Android never uses `--auto-submit` (its bundle would reach Play before step 5); iOS only with
   the developer's explicit agreement to skip steps 4 and 5 before the upload.
7. **Tag** each submitted build (annotated, from the record's `appBuildVersion`), and report.

## What to Test, groups, and the Play track

- **What to Test** reaches TestFlight through `--what-to-test` on `eas submit` (or on `eas build` with
  `--auto-submit`). App Store Connect allows 4,000 characters; the template refuses more and refuses an
  empty text. It is iOS only.
- **TestFlight groups:** `--groups "QA"` (or `submit.production.ios.groups`) adds the build to existing
  internal groups; with "Enable automatic distribution" on in App Store Connect, internal testers get
  every processed build. Internal testing reaches up to 100 team members as soon as processing ends
  (usually 5 to 15 minutes, no guarantee); external testing needs Beta App Review for the first build of
  each version and is the developer's step in App Store Connect.
- **Play:** the profile's `track: "internal"` (up to 100 testers, no review) with `releaseStatus:
  "completed"`. Expo's docs (read 2026-10-14) say the first `eas submit` of an app "creates your app's
  first release on the internal testing track"; while the Play app itself is still a draft, Google's API
  answers `Only releases with status draft may be created on draft app`: submit that one with
  `releaseStatus: "draft"` or finish the store listing first (a human step). Promotion to closed, open or
  production tracks and staged rollouts are android-release-play's.

## After the submission

- iOS: the build appears in TestFlight after Apple's processing; a build that fails processing comes
  with an email from Apple, which the developer forwards. `eas submit` reports the submission status;
  `eas submit:list` and the submission page show it later.
- Android: the release is on the internal track (or a draft); testers opt in through the testing link.
- Tag, then send the evidence message (git-commits-and-reporting): the version, both build numbers and
  build ids, the commit, every RESULT line, and the one question ("ship", or what testers found).
- Submission for App Review and the release to the public happen only on the developer's "submit".

## Building on your own machine (--local)

`eas build --local` runs EAS's build steps on this machine. It still needs `eas login` or `EXPO_TOKEN`
(the project must exist and managed credentials are downloaded), ignores `node`, `image` and the other
version fields of eas.json, supports no cache and no EAS secret variables (set them in the local
environment), and needs Node, the package manager, fastlane and CocoaPods (iOS) or the Android SDK and
NDK installed (docs.expo.dev `/build-reference/local-builds`, read 2026-10-14). Use it to debug a
failing cloud build (`EAS_LOCAL_BUILD_SKIP_CLEANUP=1 EAS_LOCAL_BUILD_WORKINGDIR=<dir>` keeps the logs),
not as the release path. A team without EAS uses the local lane skills instead.

## EAS Workflows and CI

Release jobs in `.eas/workflows/*.yml` or `.github/workflows/*.yml` follow the same order: install,
`npm run verify` (or the preflight), the build, the record check and the store-artifact gate, then the
submit. In a GitHub workflow those are run steps (`--platform`, `--profile`, `--freeze-credentials` on
the build, `--non-interactive` and `--path` on the submit); ci-pipeline-and-gates' `release.yml` stops
after the build (`--no-wait`) and leaves the submit to this runbook. In EAS Workflows they are the
pre-packaged jobs: a `type: build` job with `params.platform` and `params.profile` that `needs:` the
verify job, a custom check job that `needs:` the build, and a `type: submit` job with
`params.build_id` and `params.profile` that `needs:` the check job (a submit job takes a build id, so
here the check job's download is EAS's copy of the same artifact):

```yaml
jobs:
  verify:
    steps:
      - uses: eas/checkout
      - uses: eas/install_node_modules
      - run: npm run verify
  build_ios:
    needs: [verify]
    type: build
    params: { platform: ios, profile: production }
  check_ios:
    needs: [build_ios]
    steps:
      - uses: eas/checkout
      - uses: eas/install_node_modules
      - uses: eas/download_build
        id: download
        with:
          build_id: ${{ needs.build_ios.outputs.build_id }}
      - run: |
          npm install -g --min-release-age=7 --ignore-scripts eas-cli@24.10.0
          mkdir -p dist/eas
          eas build:view ${{ needs.build_ios.outputs.build_id }} --json > dist/eas/build-ios.json
          npx --no-install @expo/fingerprint fingerprint:generate --platform ios > dist/eas/fingerprint-ios.json
          node "$SKILLS_DIR/eas-build-and-submit/scripts/check-eas-build.mjs" . --build dist/eas/build-ios.json --platform ios --previous "$LAST_IOS_BUILD"
          node "$SKILLS_DIR/ios-release-testflight/scripts/check-store-artifact.mjs" . --ipa "${{ steps.download.outputs.artifact_path }}" --variant production --version "$APP_VERSION" --build "$IOS_BUILD"
  submit_ios:
    needs: [check_ios]
    type: submit
    params:
      build_id: ${{ needs.build_ios.outputs.build_id }}
      profile: production
```

`eas/checkout` is a shallow clone (`--depth 1`, docs.expo.dev/eas/workflows/syntax, read 2026-10-16),
so it carries no upload tags: pass `--previous` (the last uploaded number, an EAS environment
variable the developer keeps) or fetch the tags first. `eas/download_build` (`build_id` in,
`artifact_path` out) is from the same page; that a custom job's run steps can call `eas build:view`
after the global install was not run against a real project here (no account in this environment):
prove it once with the developer before relying on the workflow. `$SKILLS_DIR` is a job variable
holding the folder the skills are installed in (for example `.agents/skills`). `profile` defaults to `production` in both job types
(docs.expo.dev/eas/workflows/pre-packaged-jobs, read 2026-10-16), so a job without it is the "names no
`--profile`" mistake in YAML form. `needs:` runs a job only after its dependencies succeeded; `after:`
runs it whether they succeeded or failed, so `after: [verify]` is no gate. ci-pipeline-and-gates owns
the GitHub workflow files, caches and secrets; Expo's official `eas-workflows` skill is the reference
for the workflow syntax.

### What the command checks read

`eas-commands` and `gates-first` read `package.json` scripts, `*.sh` files, the `run:` values of
`.github/workflows/*.yml` and `.eas/workflows/*.yml` (inline, literal `|` and folded `>` blocks), and
the `type: build` / `type: submit` jobs of `.eas/workflows/*.yml`.

- **Shell text** is split the way a shell does: a quoted argument is one value (`--platform "$PLATFORM"`
  names a platform), and a command ends at an unquoted `;`, `&`, `|` or a new line. A step's `name:`, a
  YAML or shell comment and quoted text are never commands, so `name: eas build (production)` is not a
  command, and `# npm run verify` or `echo "npm run verify"` is not a gate. A gate is a command:
  `npm run verify` or `node .../release-preflight.ts` in front of an `eas build`, and
  `node .../check-eas-build.mjs` in front of an `eas submit` (verify alone never gates a submit); in
  shell text it counts for every later command in the same script or
  file, including a later job of the same GitHub workflow (the checker does not follow GitHub's
  `needs:`, so keep the gate and the command in one job). `npx eas-cli ...` and `eas-cli@<x> ...` are
  reported (`eas-commands`; dependency-management's `npx-install` rule owns the reason).
- **EAS Workflows jobs:** each `type: build` or `type: submit` job is a command: `params.profile`
  (absent means `production`), `params.platform` (build jobs; a submit job takes its build's
  platform). Every such job is outward when its profile is a store profile (a submit job always). Its
  gate is a job it `needs:`, directly or through other jobs, whose `run:` steps call the gate of its
  kind (verify or the preflight for a build job, `check-eas-build.mjs` for a submit job); a gate in
  the job's own `hooks` counts too, except `after_submit`. `-s` and `--submit` count as
  `--auto-submit` (eas-cli's aliases).
- **Not read, by design:** a command inside a quoted `sh -c '...'`, an npm script that calls another
  script (`npm run release:build`), a here-document; in EAS Workflows, YAML anchors, aliases and merge
  keys, and a profile written as an expression (`profile: ${{ inputs.profile }}`), which the checker
  cannot judge as a store profile. EAS Workflows build jobs have no credentials-freeze parameter, so
  `--freeze-credentials` is checked on `eas build` commands only; a workflow build job keeps the stored
  credentials only as long as nobody changes them (`eas credentials` is the developer's). Keep the
  release command and its gate visible: one script, one GitHub job, or an EAS job that `needs:` the gate.

## What needs the developer

| Step | Why the agent asks |
|---|---|
| Every `eas build` of a store profile, every `eas submit` | uploads and spends build numbers; cannot be undone |
| `eas build:version:set` | changes the shared remote counter |
| `eas credentials` changes, `eas device:create` | changes signing assets and the team's device list |
| `eas init`, accounts, app records, service accounts, API keys | the developer's accounts and money |
| Submitting for review, external testing, promotion and rollout | outward-facing; "submit" is a separate word from "ship" |
