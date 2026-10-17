# Device lanes: the Android emulator on Linux, the iOS simulator on macOS

How the nightly device jobs get a machine that can run the repo's build and E2E scripts, what each
platform needs, and what goes wrong. The scripts themselves belong to android-emulator-build,
ios-simulator-build and e2e-maestro; this page covers only the runner side. Verified on 2026-10-14
against the runner-images READMEs, GitHub's runner docs and the android-emulator-runner README; the
device jobs themselves were not run on GitHub by this skill (actionlint 1.7.12 passed, and the same
scripts were proven on a Mac by their owner skills).

## Contents

- Which lanes, when
- Android: Linux with KVM
- Android packages and licences
- iOS: macOS with the pinned Xcode
- Java 17 for Maestro and Gradle
- Devices are still named on a runner
- Flaky lanes
- Failures
- Re-verify

## Which lanes, when

| Lane | Script (owner) | Runner | Expected when |
|---|---|---|---|
| `android-build` | `build:android:emu` (android-emulator-build) | `ubuntu-24.04` + KVM | `package.json` has the script |
| `android-e2e` | `e2e:android` (e2e-maestro) | `ubuntu-24.04` + KVM | the script exists |
| `ios-build` | `build:ios:sim` (ios-simulator-build) | `macos-26` | the script exists |
| `ios-e2e` | `e2e:ios` (e2e-maestro) | `macos-26` | the script exists |

`check-ci-lanes` expects a job for every lane whose script exists, in a workflow that starts on its
own (schedule, push or pull request), unless `contracts/ci.json` `laneOptOuts` records the decision
not to run it with a reason (for example "macOS minutes are not budgeted for this private
repository; flows run locally before every release"). An opt-out is a decision for the developer,
not for the agent: ask before writing one.

Nightly plus `workflow_dispatch` is the default cadence: a lane takes 20 to 60 minutes and would
slow every pull request. A team that wants device proof before merging adds `pull_request` with a
`paths:` filter for native-facing changes (`app.config.ts`, `package-lock.json`, `plugins/**`).

A schedule can stop without a sound. It runs only from the workflow file on the default branch (a
cron edited on a feature branch does nothing until it merges), and GitHub disables scheduled
workflows in a public repository after 60 days without repository activity; the workflow then shows
"This scheduled workflow is disabled" and no red run tells anyone. Re-enable it under Actions >
devices (or `gh workflow enable devices.yml`), and let the weekly report cite the date of the last
nightly run: a lane whose last run is older than a week is not running, whatever the badge says.

A repository that uses GitHub's merge queue with `verify` as a required check needs `merge_group:`
among the triggers of `ci.yml`, or the required check is never reported and every queued merge fails
([workflow-anatomy.md](workflow-anatomy.md)). The device lanes stay off the queue: they are not
required checks.

## Android: Linux with KVM

- GitHub's Linux runners support hardware acceleration for the Android emulator once `/dev/kvm` is
  opened to the runner user; the template does it with the udev rule the android-emulator-runner
  project documents:

  ```sh
  echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
  sudo udevadm control --reload-rules
  sudo udevadm trigger --name-match=kvm
  ```

  `sudo` is fine here: the runner is a single-use virtual machine. On a developer's machine the same
  rule set would be a human step (android-emulator-build).
- macOS arm64 runners (`macos-26`, `macos-latest`) cannot run the emulator at all: Apple's
  Virtualization Framework does not allow nested virtualization. check-ci-lanes fails an Android lane
  on any runner that is not Linux (`lane-runner`).
- `build:android:emu` picks the ABI from the host (`x86_64` on the x64 Ubuntu runner), builds that one
  ABI, creates the AVD `<prefix>-<purpose>` on the pinned `google_apis` image, starts it headless
  (`-no-window -no-audio -no-snapshot-save`) on a port it chose, and addresses it as
  `emulator-<port>`. The workflow never starts an emulator itself and never uses an action that does
  (`reactivecircus/android-emulator-runner` creates its own AVD and runs the script against
  whatever device adb lists first, which the build script would then not own).

## Android packages and licences

The Ubuntu image has platform-tools, build-tools 36.0.0, `platforms;android-36` and the command-line
tools, but no `emulator` package, no system image and not NDK 27.1.12297006 (React Native 0.86's
version catalog; the image's default NDK is 27.3). One step installs them:

```sh
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --install \
  'emulator' 'platforms;android-36' 'build-tools;36.0.0' 'ndk;27.1.12297006' \
  'system-images;android-36;google_apis;x86_64'
```

- The hosted image comes with the Android SDK licences accepted by its maintainers. The workflow
  never pipes `yes` into `sdkmanager --licenses` (`sdk-licence`): accepting a licence is a legal
  decision. If an install stops on a licence the image lacks, the developer decides, as
  android-emulator-build's human steps describe.
- The packages together are a few GB on a 14 GB disk. A job that fails with "No space left on device"
  needs a smaller footprint (one system image, no unused packages) before anything else; measure with
  `df -h` in a step.
- The versions follow React Native: when the SDK moves (Expo SDK 58 moves to API 37), change the
  packages here together with android-emulator-build's `toolchain.ts` pins.

## iOS: macOS with the pinned Xcode

- `macos-26` has Xcode 26.6 as its default (`/Applications/Xcode_26.6.app`, build 17F113), older
  Xcodes beside it, and the iOS 26.5 simulator runtime with iPhone 17 Pro Max and iPad Pro 13-inch (M5)
  among its device types.
- `build:ios:sim` selects Xcode by version (`XCODE_VERSION` in `scripts/ios/toolchain.ts`), finds
  `Xcode_26.6.app` through its `Xcode*.app` match, checks `xcodebuild -version` and sets
  `DEVELOPER_DIR` per process. The workflow does not select Xcode: no `xcode-select`, no
  `maxim-lobanov/setup-xcode` (both switch Xcode for the whole machine, and the second needs no
  version check). When the image drops the pinned Xcode, the build stops with the "not installed"
  message: move the pin (ios-simulator-build) or the runner label, deliberately.
- The runner has 7 GB of memory and 3 cores. A Release build plus two simulators fits; do not add a
  matrix that boots more devices in one job.
- CocoaPods is on the image; Pods and DerivedData are not cached (the build starts from a clean
  prebuild on purpose).

## Java 17 for Maestro and Gradle

React Native 0.86's Gradle plugin builds with `jvmToolchain(17)`, and Maestro 2.10 runs on Java 17.
The Ubuntu image's default JDK is 17, the macOS image's is 21. Both images export
`JAVA_HOME_17_X64` / `JAVA_HOME_17_arm64`, so the templates select 17 explicitly:

```yaml
- name: Use the image's JDK 17
  run: echo "JAVA_HOME=$JAVA_HOME_17_arm64" >> "$GITHUB_ENV"
```

`actions/setup-java` with `java-version: '17'` (and a pinned SHA) is the alternative when an image
lacks the variable. check-ci-lanes `jdk-pin` accepts either.

## Devices are still named on a runner

A hosted runner is a fresh, single-tenant machine, so "the booted simulator" would usually be the
only one. The scripts still create and name their devices and pass ids: the same scripts run on a
shared Mac or a self-hosted runner, where an implicit device reaches another job's simulator. A raw
`maestro`, `adb`, `emulator`, `avdmanager`, `xcrun simctl` or `xcode-select` line in a workflow
bypasses that (`raw-device-command`). The E2E lanes run the flows locally on the runner's own
device, never `maestro cloud`, `maestro login` or `--analyze` (e2e-maestro's `check-e2e-setup` fails
those in workflows), and restore the Maestro download from its cache folder
(`~/.cache/maestro-cli` on Linux, `~/Library/Caches/maestro-cli` on macOS).

## Flaky lanes

A lane that fails one night in ten is a bug in the app or the flow, not in CI. No `retry` around the
job, no `continue-on-error`, no re-run-until-green: read the uploaded screenshots and junit file,
reproduce locally with the same script and variant, and fix the timing (e2e-maestro's flake rules).

## Failures

| Symptom | Cause | Fix |
|---|---|---|
| `npm error code EBADENGINE` at `npm ci` | the job runs the image's Node (npm 10 on Ubuntu) | `setup-node` with `node-version-file: .nvmrc` before `npm ci` <!-- stack-pin-ignore: the runner image's npm, not the project's --> |
| `ESTRICTALLOWSCRIPTS` at `npm ci` | a dependency gained an install script nobody approved | approve it locally after reading it (dependency-management), commit `allowScripts` |
| `ETARGET` / `notarget` at `npm ci` | the lockfile names a version younger than `min-release-age` | wait until it is 7 days old, or a dated exclude block (dependency-management) |
| `/dev/kvm permission denied`, emulator boots for 15 minutes | the KVM udev step is missing or runs after the build | the KVM step before `build:android:emu` |
| `PANIC: Missing emulator engine program` | the `emulator` package is not installed | the `sdkmanager --install` step |
| `NDK at ... did not have a source.properties file` / long download | NDK 27.1.12297006 missing | install it in the packages step |
| `Xcode 26.6 is not installed (found: ...)` | the image dropped the pinned Xcode | move the pin or the runner label, in one pull request |
| the Android build stops with "no JDK 17", or the E2E log shows Maestro on Java 21 | `JAVA_HOME` points at the image default (21 on `macos-26`); the scripts were verified on 17 only | the JDK 17 step |
| `No space left on device` | packages plus Gradle caches | fewer packages, a single system image; check `df -h` |
| job cancelled at the timeout | a hung simulator or emulator | read the uploaded logs; never raise the timeout to make it pass |

## Re-verify

```sh
curl -s https://raw.githubusercontent.com/actions/runner-images/main/images/ubuntu/Ubuntu2404-Readme.md | grep -A12 '^### Android'
curl -s https://raw.githubusercontent.com/ReactiveCircus/android-emulator-runner/main/README.md | grep -A6 'Enable KVM'
grep -E '^(compileSdk|buildTools|ndkVersion)' node_modules/react-native/gradle/libs.versions.toml
```
