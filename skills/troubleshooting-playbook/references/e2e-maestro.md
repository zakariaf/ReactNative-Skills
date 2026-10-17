# Maestro flows and devices

Failures of Maestro end-to-end flows on the iOS simulator and the Android emulator, and of the devices they run on. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `maestro --version`.

<!-- Generated from assets/known-failures/e2e.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Toolchain
- Flows
- Device

## Toolchain

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `e2e-maestro-java` | maestro fails to start: Unable to locate a Java Runtime, or JAVA_HOME is not set | Maestro needs Java 17 | Point JAVA_HOME at a JDK 17 for the process (/usr/libexec/java_home -v 17 on macOS, or Android Studio's bundled runtime); installing a JDK is a human step | verified |  | `e2e-maestro` |

## Flows

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `e2e-maestro-airplane` | setAirplaneMode does nothing on the iOS simulator | iOS simulators have no airplane mode (the command works only on Android) | Simulate offline through the app's connectivity port (a debug link or test hook that fakes offline); keep setAirplaneMode only in Android-only flows | verified | iOS | `debug-menu-and-test-hooks` |
| `e2e-maestro-ai-commands` | A flow uses assertWithAI, assertNoDefectsWithAI or extractTextWithAI | They upload screenshots to a third-party service and are not deterministic | Assert testIDs and texts; look at the screenshots yourself | verified |  | `e2e-maestro` |
| `e2e-maestro-upload` | A Maestro command sent the run off the machine (test --analyze, cloud, login, record without --local) | Those commands upload screens or results to a cloud service | Never use them in the repo tooling; the flow checker reports them | documented |  | `e2e-maestro` |
| `e2e-maestro-tags-flag` | maestro test --tags is rejected | Maestro 2.10 has --include-tags and --exclude-tags, no --tags | Use --include-tags / --exclude-tags | verified |  | `e2e-maestro` |
| `e2e-maestro-subfolders` | Flows in sub-folders do not run | maestro test <folder> does not recurse into sub-folders | List the flow files explicitly (the runner does), flows in .maestro/flows/<suite>/<nn>-<name>.yaml | verified |  | `e2e-maestro` |
| `e2e-maestro-evalscript-colon` | maestro check-syntax prints "Parsing Failed at <line>:<col>" on an evalScript line that holds a ternary (cond ? a : b) | A ": " inside a plain YAML scalar starts a mapping, so the flow is not valid YAML | Quote the whole scalar or write the choice as arithmetic; never an unquoted ": " in evalScript | verified |  | `e2e-maestro` |
| `e2e-maestro-screen-root` | A screenshot step waits and fails on a screen whose root testID differs from its name | The sub-flow waited for ${SCREEN}.screen while that screen renders another root | Pass the screen's root testID to the sub-flow explicitly | documented |  | `e2e-maestro` |
| `e2e-maestro-text-match-case` | Element not found: Text matching regex: Open (a guard matched the wrong element first) | Maestro's text match ignores case and matches any visible text, so a guard such as when visible: 'Open' matched an ad's OPEN button | Match the exact system alert ("Open in .*\?") or a testID, and make the tap after a guard optional | verified |  | `e2e-maestro` |

## Device

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `e2e-maestro-hierarchy-limits` | maestro hierarchy misses testIDs | It lists only on-screen elements, hides children of accessible elements, and rounds bounds to whole points | Put testIDs on the accessible element (the Pressable), scroll to the element first, allow 1 pt | verified |  | `e2e-maestro` |
| `e2e-maestro-launchapp-permissions` | A permission or tracking prompt never appears in a flow, or the status already reads granted | launchApp grants every permission by default (the iOS tracking answer included) | Launch with permissions: { all: unset } in flows that test a prompt, or install fresh and launch with xcrun simctl launch / adb -s <serial> shell am start | verified |  | `e2e-maestro` |
| `e2e-debug-link-before-ready` | A debug link right after launchApp clearState is ignored (no language, data or screen applied), while the same link seconds later works | The app was launched without the URL and its JS had not started the link handler yet, so neither getInitialURL nor the url event delivered it | Start listening as early as the debug kit loads and queue links until the navigator is ready; the setup sub-flow waits for the first screen root before openLink. Never add a fixed sleep | verified |  | `debug-menu-and-test-hooks` |
| `e2e-hierarchy-other-device` | maestro hierarchy shows another screen or language, or the run answers with another session's app | Maestro reached another session's device: the call named no --device, or two sessions' drivers shared a port | Name the device on every call: maestro --device <udid or serial> --driver-host-port <own port> <command> (maestroGlobalArgs()); simctl by UDID, adb -s <serial> | verified |  | `e2e-maestro` |
| `e2e-driver-port-shared` | A Maestro run fails to connect to its driver (port 7001 in use, Failed to connect) | The call used the default driver port, which another session's driver on the same machine already listens on | Give every run its own --driver-host-port (the maestro-args helper picks a free one) | verified |  | `e2e-maestro` |
| `e2e-hierarchy-500-hang` | UnknownFailure(errorResponse=Request for viewHierarchy failed, code: 500), then the Maestro process stays alive and the runner waits for ever | The iOS driver could not answer a hierarchy request on an overloaded machine; Maestro's main thread died but its JVM kept running | Stop that Maestro process only (it names your device and port), wait until the load average is below twice the cores, rerun; run screenshot matrices alone, never beside a Release build | verified | iOS | `e2e-maestro` |
| `e2e-app-stopped-after-flow` | A memory or footprint step after the flows finds no app process | Maestro 2.10 stops the app when a test ends | Relaunch the app by UDID or serial after the flows, wait for its pid, then measure | documented |  | `performance-budgets` |
| `e2e-busy-machine-timeouts` | Flows time out at random steps (relaunches never answer, StoreKit or system sheets appear late) | The machine is overloaded (load average far above the core count), so a correct app times out | Rerun alone once the load average is below twice the cores; never raise every timeout | verified |  | `e2e-maestro` |
| `e2e-socket-sampler-other-device` | The runtime network check reports sockets the app never opens, while every flow passes | The sampler watched every process with the app's name on the machine, another session's copy included | Sample only the processes of your own simulator or emulator (by UDID or serial) | verified |  | `privacy-and-store-declarations` |
| `e2e-network-guard-blocks-metro` | A Debug test build fails most flows at once and LogBox covers the app: a blocked websocket or fetch to localhost:8081 | The test build's network guard blocked the Debug build's own Metro (the bundle and the HMR websocket) | Let only a __DEV__ build reach localhost, 127.0.0.1 or [::1]; a Release build still blocks everything | verified |  | `privacy-and-store-declarations` |
| `e2e-ads-test-close-early` | A flow taps a test ad's close key, but the ad stays on screen ("Test mode" still visible) | Google's test full-screen ads ignore a close tap until the key is ready | Tap the close key again while "Test mode" is still visible (runFlow when visible), then assert the app | verified |  | `admob-ads-and-consent` |
| `e2e-android-adb-reverse` | A Debug Android build on the emulator shows "Unable to load script" or cannot reach Metro | The emulator reaches the machine at 10.0.2.2, not localhost, unless the port is reversed | adb -s <serial> reverse tcp:8081 tcp:8081, or test a Release build (the evidence build is Release) | documented | Android | `android-emulator-build` |
