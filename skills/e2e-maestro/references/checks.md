# Contracts and checks

The repo-owned facts the checkers and the tooling read, every checker rule with its reason, the SKIP
and NOT APPLICABLE lines a passing run may print, and the multi-package behaviour.

## Contents

- contracts/e2e.json
- Other contracts the checkers read
- Layout keys (rn-skills.config.json)
- check-flows rules
- check-e2e-setup rules
- check-e2e-report rules
- SKIP and NOT APPLICABLE
- When multi-package
- The self-test

## contracts/e2e.json

The template and its schema ship in `templates/contracts/`. Keys:

| Key | Required | What it does | Default |
|---|---|---|---|
| `productionAppIds` | yes | store app ids; the runner refuses those builds (no debug link) | — |
| `network` | yes | `{ mode: offline-only \| allowlist \| off, allowHosts, why }`: the runtime proof | — |
| `buildExtra` | with ads | values the build's embedded `expo.extra` must hold, else the runner and the capture refuse it: `{ "adsMode": "off" }` for an app with `react-native-google-mobile-ads` (the template sets it; an app without ads removes it) | none |
| `devicePrefix` | | devices are `<devicePrefix>-<purpose>` | ios-sim-build's `simulatorPrefix`, else the package name |
| `maestroBin` | | the Maestro binary | `tools/maestro/bin/maestro` |
| `ios` | | `phone`, `tablet` models, `appPath` (folder of the `.app`) | iPhone 17 Pro Max, iPad Pro 13-inch (M5), `build/ios-sim/dd/Build/Products/Release-iphonesimulator` |
| `android` | | `systemImage`, `phoneDevice`, `tabletDevice`, `apkPath` | android-36 google_apis arm64-v8a, `pixel_8`, `pixel_tablet`, `build/android-emu/app-preview.apk` |
| `largeText` | when `flows/a11y/` exists | `{ locales }` for the large-text step | — |
| `screenshots` | for the matrix | `{ flow, locales, devices, platforms }` | `.maestro/screenshots/matrix.yaml`, phone + tablet, ios + android |
| `manualFolders` | | `[{ folder, why, startsOutside, requiredParams }]` (flows.md, "Manual folders") | none |
| `tags` | | extra flow tags | none |
| `extraTestIDs` | | `{ "<id>": "<why>" }`: ids flows may use that `contracts/screens.json` does not list | none |

## Other contracts the checkers read

- `contracts/screens.json` (screen-contracts): every element's `testID` (`{key}` segments match any data
  key), `role`, `component`, `parent`, `a11yHidden`, `coveredBy`; `components` and the component
  catalogue (`componentCatalog`, default `contracts/component-library.json`) for the parts a component
  derives (`<id>.<part>`; parts of an element with an accessible role are crop-only).
- `contracts/debug-links.json` (debug-menu-and-test-hooks): `params`, each with `values` or
  `kind: date`; an `open` parameter makes `debug-open` apply.
- `contracts/naming.json` (naming-conventions): `extraE2eFolders` entries count as manual folders
  (other than `screenshots`).
- `contracts/ios-sim-build.json` (ios-simulator-build): its `simulatorPrefix` is the default device
  prefix. Set its `maestroBin` to `tools/maestro/bin/maestro` so its `--link` step uses the pinned
  install.

## Layout keys (rn-skills.config.json)

The checkers resolve folders with check-lib's `resolveLayout`: `e2eDir` (default `.maestro`; also
`--e2e-dir`), `contractsDir` (default `contracts`), `scriptsDir` (default `scripts`; the tooling is
`<scriptsDir>/e2e/`). The templates and the npm scripts assume the defaults; change both together.

## check-flows rules

| Rule | Why |
|---|---|
| `e2e-contract` | the contract names the production ids and the network policy every run relies on |
| `flow-location` | Maestro never runs a file outside the folder it is given, and runs a sub-flow under `flows/` alone |
| `flow-name` | `<nn>-<kebab-name>.yaml` keeps a stable run order and greppable names |
| `flow-parse` | a file Maestro cannot read fails at run time, after a build |
| `flow-header` | `appId: ${APP_ID}` follows the variant; `name:` is the evidence line; tags select runs |
| `flow-tags` | an unknown tag is a typo; a11y flows must sit where the large-text step looks; manual flows name their folder |
| `env-shadows-cli` | a flow's `env:` beats `-e` in Maestro 2.10 |
| `ai-command` | uploads screenshots |
| `text-selector` | breaks in other locales and on copy changes |
| `retry-app-assertion` | hides races |
| `open-alert-guard` | a bare `'Open'` matches in-app OPEN buttons |
| `first-step-launch` | every run starts from the same state |
| `raw-open-link` | the sub-flow waits for the app, accepts the alert and proves the link arrived |
| `debug-query` | the app refuses an unknown, repeated or bad parameter; better to know before a build |
| `debug-open` | waiting for the start screen passes with a lost link |
| `large-text-lang` | the runner passes `LANG` per large-text locale; an a11y flow that never sets it runs every pass in the device language |
| `debug-lang-alone` | a language that flips the layout direction restarts the app and drops the rest of its link; `set-language.yaml` sends it alone and waits out the restart |
| `testid-format` | the testID grammar is how ids stay findable; a pattern must compile |
| `unknown-testid` | an id no contract lists fails only after a timeout on a device |
| `unreachable-testid` | Maestro lists accessible elements only |
| `no-testid-step` | a flow that asserts nothing about the app proves nothing |
| `runflow-missing` | a broken path fails at run time |
| `subflow-in-flows` | the file also runs on its own and fails |
| `smoke-quarantine` | a failing smoke flow blocks the release |
| `quarantine-note` | quarantine is dated, explained and short (7 days) |
| `manual-folder` | `launchApp` pre-grants the prompt under test; required parameters make the run independent of the machine |
| `platform-guard` | `back`, `pressKey: back`, `setAirplaneMode` and `toggleAirplaneMode` are no-ops on iOS in Maestro 2.10; outside `runFlow: { when: { platform: Android } }` the flow passes there without the step |
| `run-command-device` | a documented command line is copied: it must name the device and a port |
| `maestro-syntax` | (`--syntax`) Maestro's own parser |
| `flows-missing` | E2E set up without a flow is a gap, not a pass |

## check-e2e-setup rules

| Rule | Why |
|---|---|
| `e2e-contract` | as above |
| `e2e-ads-off` | with ads on, the consent form and the tracking prompt cover every cleared launch and the ad SDK's sockets break the network proof |
| `maestro-pin` | the version and checksum are verified; strict shell mode stops a half install |
| `maestro-install-source` | Homebrew and the script installer are unpinned, unverified, analytics on |
| `maestro-env` | Java 17 and no telemetry; the spawn must use the environment and the device binding |
| `runner-file-missing` | the runner needs every module (the sampler unless the network mode is off, the screenshot modules when a matrix exists) |
| `runner-network` | without the sampler the network policy is unproven at runtime |
| `sampler-liveness` | an empty `network.txt` from a sampler that crashed, never found the app or died halfway proves nothing; the runner must prove each one alive (`network-samplers.json`) |
| `sampler-own-devices` | other sessions run the same app on their own devices |
| `runner-steps` | the flows step lists the area files, leaves quarantine and a11y out; the large-text step runs; `run.json` is written; manual folders never run |
| `runner-build-guard` | Debug builds hide traffic behind Metro; production builds have no debug link; a build that misses `buildExtra` (ads on) is refused |
| `maestro-device` | a run without its device and port can reach another session's device |
| `shared-device` | `booted`, `all`, an adb device command without `-s` and adb's `-e` / `-d` pick a device implicitly; checked in tooling sources (an adb spawn whose arguments start with neither `-s` nor `adbArgs`/`adbDeviceArgs`, except `devices`, `start-server`, `kill-server`, `version`), shell scripts, npm scripts and CI workflows. Heuristic: an argument list built elsewhere and passed as a variable is not judged at the call; its builder is |
| `openurl-prompt` | `simctl openurl` leaves iOS's alert up |
| `maestro-upload` | `cloud`, `login`, `--analyze`, `record` without `--local` send the run away |
| `deterministic-capture` | a moving status bar, text size or appearance changes pixels |
| `screenshot-tolerance` | the tolerance is gated; raising it accepts regressions |
| `capture-evidence` | a capture that does not empty its platform folder first, or ends on the first failure, leaves a stale or partial summary for the report checker |
| `subflow-missing` | flows and tools rely on `open-link`, `debug-setup` and (with a matrix) `shoot-screen` |
| `e2e-script` | one documented way to run, on both platforms |
| `gitignore-tools` | the 315 MB install and the reports never reach git |
| `baseline-matrix` | sets of one platform hold the same screens; `--baselines` requires every set |

## check-e2e-report rules

| Rule | Why |
|---|---|
| `run-record` | only a runner run carries the device, filter and policy facts |
| `run-filtered` | a filtered or shortened run is iteration, not evidence |
| `flow-failed` | any failed flow |
| `no-flows` | an empty report proves nothing |
| `smoke-not-run` | every smoke flow is in every evidence run |
| `network-sampler` | `network.txt` or `network-samplers.json` missing, a device of `run.json` without a sampler, or a sampler that took no sample, never found the app or died before the end: the empty report would prove nothing |
| `network-sockets` | a socket the policy does not allow |
| `large-text-missing` | the a11y flows are due in every locale on both devices |
| `large-text-failed` | an a11y flow failed at the largest size |
| `screenshot-capture-failed` | (`--screenshots`) a device x locale x theme that captured nothing (a device that did not start, a failed matrix flow) |
| `screenshot-platform` | (`--screenshots`) a row of another platform in `reports/screenshots/<platform>/summary.json` (a copied or merged summary) |
| `screenshot-changed` | (`--screenshots`) a diff, a size change or a missing baseline |
| `matrix-incomplete` | (`--screenshots`) a set with fewer screenshots: a capture step failed |

## SKIP and NOT APPLICABLE

- `SKIP contracts/screens.json [unknown-testid] not yet created (screen-contracts creates it)` and the
  same for `[unreachable-testid]`: ids are then checked for their format only.
- `SKIP contracts/debug-links.json [debug-query] not yet created (debug-menu-and-test-hooks creates it)`
  when a flow uses the setup sub-flow before the link exists.
- `SKIP scripts/ios/simulators.ts [runner-file-missing] not yet created (ios-simulator-build creates it)`
  and the same for `toolchain.ts`.
- `SKIP scripts/android/adb-args.ts [runner-file-missing] not yet created (android-emulator-build creates it)`:
  `android-device.ts` and `sample-sockets.ts` import `adbArgs` from it.
- `NOT APPLICABLE: the app has no Maestro E2E yet: ...` from all three checkers while the app has no
  `.maestro/`, no `contracts/e2e.json` and no `e2e:*` or `screenshots:*` npm script. Once any of them
  exists every rule is strict.
- `check-e2e-report` without `junit.xml` (or `--screenshots` without
  `reports/screenshots/<platform>/summary.json`) is bad input, exit 2: run the runner first.

## When multi-package

With `package.json` `workspaces`, `check-flows` and `check-e2e-setup` check every workspace that has
adopted E2E, each with its own layout (`apps/mobile/.maestro`, `apps/mobile/contracts`,
`apps/mobile/scripts/e2e`); repo-wide scans (shell scripts, CI workflows) prune installed skills and
build output. `check-e2e-report` checks one app: run it in the app's folder.

## The self-test

`node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs` assembles each case of `tests/fixtures/` on a small app
base (`tests/bases/app/`, `tests/bases/report/`) with this skill's templates on top, so the shipped
templates are exactly what the good cases pass. Every rule has a planted-bug case; `--syntax` is
tested with `/usr/bin/true` and `/usr/bin/false` standing in for Maestro.
