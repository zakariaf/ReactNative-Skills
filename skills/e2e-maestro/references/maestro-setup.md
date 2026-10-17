# Maestro: install, environment, devices and versions

How Maestro gets onto the machine, how it runs without sending anything anywhere, how each run names
its device on iOS and Android, which commands are verified, and how to move the pin.

## Contents

- What is pinned
- Installing (no Homebrew, no curl | bash)
- The environment every run needs
- Naming the device and the driver port
- Commands verified on 2.10.0
- Facts learned the hard way
- Commands that are banned
- Checking syntax without a device
- Changing the pin
- Optional: Maestro's MCP server

## What is pinned

| Tool | Version | Notes |
|---|---|---|
| Maestro CLI | 2.10.0 | `maestro.zip` SHA-256 `29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991`, from the release's `checksums_sha256.txt` (verified 2026-10-14) |
| Java | 17 | `/usr/libexec/java_home -v 17`, else Android Studio's bundled JDK (`/Applications/Android Studio.app/Contents/jbr/Contents/Home`, 17.0.11 on the verification Mac) |
| Xcode / iOS runtime | Xcode 26.6, iOS 26.5 | runtime id `com.apple.CoreSimulator.SimRuntime.iOS-26-5` (ios-simulator-build's `toolchain.ts` pins both) |
| Android | API level 36 | system image `system-images;android-36;google_apis;arm64-v8a` (x86_64 on Intel and most CI runners) |
| Devices | iPhone 17 Pro Max, iPad Pro 13-inch (M5); Pixel 8, Pixel Tablet | `contracts/e2e.json` `ios` and `android` override them |

A newer CLI line exists (cli-2.11.0, published 2026-09-29) and is not verified with this stack: stay on 2.10.0 until the steps under "Changing the pin" are done. stack-pin-ignore

## Installing (no Homebrew, no curl | bash)

`scripts/e2e/install-maestro.sh` is the only way Maestro is installed:

- it downloads `https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.10.0/maestro.zip`
  once into a cache outside the repo (`MAESTRO_CACHE_DIR`, default `~/Library/Caches/maestro-cli` on
  macOS and `~/.cache/maestro-cli` elsewhere; 315 MB, shared by worktrees and CI caches);
- it checks the zip with `shasum -a 256 -c`; on a mismatch it deletes the zip and exits 1. Never change
  the pin to match a download: a different checksum means a different file;
- it unzips into `<repo>/tools/maestro` (git-ignored as `/tools/maestro/`), writes
  `tools/maestro/.version` and prints `maestro --version` with the quiet variables set;
- it is idempotent: with the pinned version installed it exits 0 at once.

The runner and the screenshot capture call it before every run, so nobody installs Maestro by hand.
`check-e2e-setup` fails any other install path it finds in npm scripts, shell scripts and CI workflows
(`brew install maestro`, the `get.maestro.mobile.dev` script): `maestro-install-source`.

## The environment every run needs

`maestroEnv()` and `javaHome()` in `scripts/e2e/maestro-run.ts`:

```ts
JAVA_HOME: env.JAVA_HOME ?? java_home -v 17 ?? Android Studio's JDK,
MAESTRO_CLI_NO_ANALYTICS: 'true',
MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
MAESTRO_DISABLE_UPDATE_CHECK: 'true',
```

The three variable names were read in the 2.10.0 jar: no analytics, no "analyze your run" prompt, no
update check, so a run sends nothing off the machine. Set them in your shell too when you call
`tools/maestro/bin/maestro` directly.

## Naming the device and the driver port

Maestro 2.10.0 has two global options that go **before** the command:

- `--device <id>`: an iOS simulator's UDID (`xcrun simctl list devices`) or an Android device's adb
  serial (`emulator-5556`). `maestro --help` lists it with its alias `--udid`.
- `--driver-host-port <port>`: the host port of the driver Maestro talks to. On iOS that is the
  XCTest driver it installs on the simulator; on Android it is the host side of the adb port forward
  to the on-device driver. The default is 7001 on both. `--help` does not list it, but the 2.10.0 CLI
  passes it to both drivers (read in the jar: `MaestroSessionManager.createAndroid` and the iOS path
  take it, default 7001; observed on an iOS 26.5 simulator and an Android API 35 emulator on
  2026-10-14).

Several sessions share one machine, and a driver another session left on 7001 can answer a run that
asked for your device: a `hierarchy` call once returned another session's screen. So every call names
both, with a free port per run:

```sh
tools/maestro/bin/maestro --device "$UDID" --driver-host-port "$PORT" test .maestro/flows/smoke/01-first-launch.yaml -e APP_ID=<id> -e APP_SCHEME=<scheme>
tools/maestro/bin/maestro --device emulator-5556 --driver-host-port "$PORT" hierarchy
```

Keep one port per device for a whole run: a fresh port for each `maestro test` on the same Android
emulator left the second call waiting for a driver that never started ("Maestro Android driver did
not start up in time", 2026-10-14); with the same port the second call reuses the running driver.
`devicePorts()` in `maestro-run.ts` does that, and `maestroEnv()` also sets
`MAESTRO_DRIVER_STARTUP_TIMEOUT` (milliseconds, read in the 2.10.0 jar) to 120000 unless the caller
set it, for busy machines.

`$PORT` is a free port of this run
(`node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"`),
never 7001. In code, `maestroGlobalArgs({ udid, driverPort })` from `scripts/e2e/maestro-args.ts`
builds the two options (it accepts a simulator UDID or an adb serial and refuses `booted`, a device
name or a list) and `freeDriverPort()` finds the port; `runMaestro` in `maestro-run.ts` is the one
spawn of the binary. `check-e2e-setup` (`maestro-device`) fails any other spawn, an npm script or
shell line that runs `maestro test` without both options, the per-command `--udid`, and a fixed
port. `check-syntax` and `--version` need no device.

## Commands verified on 2.10.0

`launchApp: { clearState, clearKeychain, stopApp, permissions }` (it grants every permission unless
told otherwise), `killApp` (process death), `stopApp`, `openLink`, `runFlow: { file, env }`,
`runFlow: { when: { visible }, commands }`, the short `runFlow: <file>`, `extendedWaitUntil` with
`visible: { id }` and `timeout`, `assertVisible` / `assertNotVisible` with `id`, an optional `text`
regex and state filters (`checked`, `enabled`, `selected`), `tapOn: { id }` and
`tapOn: { point: 'x,y' }` (a point tap reaches a Skia canvas in a Release build), `scrollUntilVisible`,
`copyTextFrom: { id }`, `evalScript: ${...}` with `maestro.copiedText` and the shared `output` object,
`assertTrue`, `waitForAnimationToEnd: { timeout }`, `takeScreenshot: <name>`, `hideKeyboard`, and a
`# comment` line between steps. `setAirplaneMode` and `toggleAirplaneMode` exist for Android only.

## Facts learned the hard way

- **A flow's `env:` beats `-e`.** A variable in the flow's `env:` block overrides the same variable on
  the command line, so flows never define `APP_ID`, `APP_SCHEME`, `LANG` or `THEME`.
- **Maestro runs only the top-level files of a folder.** The runner lists `.maestro/flows/<area>/*.yaml`
  itself; a file two levels down never runs, and a sub-flow under `flows/` would run on its own.
- **iOS simulators have no airplane mode.** Offline runs set the debug link's `offline=1` (the
  simulated connectivity reaches every reader) and the socket sampler proves no traffic. Android
  emulators could toggle airplane mode, but the same debug switch keeps one flow for both platforms.
- **Maestro stops the app when a test ends.** A measurement after a flow (memory, a screenshot by
  hand) relaunches the app first.
- **`clearState` reinstalls the iOS app under a renamed bundle folder**
  (`<bundle id>-<timestamp>.app`): a process pattern must accept any folder name. On Android it runs
  `pm clear`.
- **Text matching ignores case.** `'Open'` matches an in-app OPEN button; guard iOS's alert on its
  title `'Open in .*\?'`.
- **Tap only after `waitForAnimationToEnd` following `scrollUntilVisible`.** A tap while a list still
  glides only stops the scroll.
- **A `: ` inside an `evalScript` breaks YAML** (it starts a mapping): use arithmetic such as
  `Number(cond)`, or quote the whole scalar.
- **Strings are single-quoted** (Prettier's `singleQuote` formats YAML); `${VAR}` works inside them.
- **`checked` is an Android state.** `assertVisible: { id, checked: true }` reads Android's checkable
  state; on iOS Maestro 2.10 reports `checked` false for a React Native checkbox and keeps the state in
  the element's value ("checkbox, checked", in the device language; seen on iOS 26.5). Assert an
  app-owned consequence instead (a summary text after a `lang=` link), as the journey template does.
- **`takeScreenshot` writes into the test output folder**, under
  `<test-output-dir>/<timestamp>/<flow name>/takeScreenshot/<name>.png`; a failing step adds
  `screenshots/step-*.png` beside it. The capture collects only the `takeScreenshot` files.
- **Maestro prints a "Run your flows on Maestro Cloud" box** at the end of a run. It is a local message;
  the quiet variables keep analytics and the update check off, and nothing here uploads.
- **The testID is the selector on both platforms.** React Native sets it as the iOS accessibility
  identifier and the Android `resource-id`, so `id:` selects the same element on both; only elements
  in the accessibility tree are listed, so a part inside an accessible element is invisible to Maestro.

## Commands that are banned

- `assertWithAI`, `assertNoDefectsWithAI`, `extractTextWithAI`: they upload screenshots to a third party.
- CLI commands that send runs off the machine (from `maestro --help` of 2.10.0): `maestro cloud`,
  `maestro login`, `maestro list-cloud-devices`, `maestro test --analyze`, and `maestro record` without
  `--local` (it renders the video remotely). `maestro bugreport` and `download-samples` are not needed.
- `retry` around app steps: allowed only around OS-owned UI (system alerts), under a
  `# system-ui: <why>` comment.
- Text selectors for app UI: select by `id`. Only OS-owned UI (iOS's "Open in …?" alert, a system
  permission dialog in a manual folder) may be matched by text, under a `# system-ui:` comment.

## Checking syntax without a device

`tools/maestro/bin/maestro check-syntax <file>` parses one flow and exits 1 with
`Invalid Command: tapOnn at /syntax-checker:3:9` or `Unknown Property: idd`. It takes about 3 s per
file (a JVM start). `node ${CLAUDE_SKILL_DIR}/scripts/check-flows.mjs . --syntax` runs it on every flow,
sub-flow, matrix and manual flow.

## Changing the pin

1. Read the release page (`https://github.com/mobile-dev-inc/Maestro/releases/tag/cli-<version>`) and
   its `checksums_sha256.txt`; wait at least 7 days after the release (the repo's minimum release age).
2. Update `MAESTRO_VERSION` and `MAESTRO_SHA256` in `install-maestro.sh`, the pin table in
   `check-e2e-setup.mjs` (`MAESTRO_PINS`) and this page, in one commit with a `Gate-Change:` trailer
   (the installer is a gated path).
3. Re-read in the new jar: the three quiet variable names, the global `--driver-host-port` option and
   which drivers use it, and whether a flow's `env:` still beats `-e`.
4. Rerun every flow on both platforms and `check-flows.mjs . --syntax`.

## Optional: Maestro's MCP server

`claude mcp add maestro -e JAVA_HOME="$JAVA_HOME" -- "$PWD/tools/maestro/bin/maestro" mcp` registers the
local binary as an MCP server for interactive exploration. No step of this skill needs it, and it
inherits none of the runner's device naming: name the device in every request.
