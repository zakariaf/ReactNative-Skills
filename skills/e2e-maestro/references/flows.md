# Writing Maestro flows

Where flows live, how they are named and tagged, how they select elements and set up state, how a
flow taps a Skia canvas, where hand-run flows go, and what to do when a flow is flaky.

## Contents

- Folders and names
- The header and tags
- Selecting elements: testIDs only
- Setting up state: one debug link
- The shared sub-flows
- The template flows
- Waiting without sleeping
- Platform differences inside one flow
- Tapping a canvas
- Manual folders: flows the runner never lists
- Flaky flows and quarantine
- What a flow should not prove

## Folders and names

```
.maestro/                              rn-skills.config.json "e2eDir" moves it
  config.yaml                          optional Maestro config
  flows/<area>/<nn>-<name>.yaml        what the runner runs, one area folder per Maestro run
  subflows/<name>.yaml                 shared steps, run only through runFlow
  screenshots/matrix.yaml              the capture flow (declared in contracts/naming.json extraE2eFolders)
  <manual folder>/<nn>-<name>.yaml     hand-run flows (contracts/e2e.json manualFolders)
  baselines/<platform>/<device>/<locale>-<theme>[-largest]/<screen>.png
```

- Areas: `smoke` (fast, every run, blocks the release), `journeys`, `offline`, `rtl`, `a11y` (run by
  the large-text step only), and whatever the app needs, one folder level only. `<nn>` is two digits:
  the run order inside the area.
- Relative paths: from a flow `../../subflows/debug-setup.yaml`; from the matrix or a manual flow
  `../subflows/debug-setup.yaml`.
- When multi-package, each Expo app keeps its own `.maestro/` and contracts; the checkers find the apps
  from `package.json` `workspaces`, and the runner runs from the app's folder (`npm run e2e:ios -w apps/mobile`).

## The header and tags

```yaml
appId: ${APP_ID}
name: Completing a task offline survives a kill and a relaunch
tags: [smoke, journeys, offline]
---
- launchApp:
    clearState: true
```

- `appId: ${APP_ID}` always: the runner passes the built variant's id with `-e` (development, preview
  and production have different ids). `name:` is a sentence saying what the journey proves; it becomes
  the JUnit test name in the evidence.
- Tags: `smoke`, `journeys`, `offline`, `rtl`, `a11y`, `quarantine`, `screenshots`, the manual folder
  names, and `contracts/e2e.json` `tags`. A flow in `flows/a11y/` is tagged `a11y` and nothing outside
  it is; a manual flow carries its folder's name.
- An app that traces requirements cites them in the header comment, `# Task list (SCR-1): completes
  a task (REQ-2)`: spec-traceability reads the e2e folder's YAML as trace files.
- A game's flow is named after the game id (`flows/games/01-<id>.yaml` or `flows/<id>/01-play.yaml`):
  new-game-scaffold's completeness stage looks for it by that name.
- No `env:` block for `APP_ID`, `APP_SCHEME`, `LANG` or `THEME`: a flow's `env:` beats `-e`.
- The first step of a flow and of the matrix is `launchApp` with `clearState: true`
  (`clearKeychain: true` too for a first-launch flow), so every run starts from the same state. A
  journey that must survive process death ends with `killApp` and `launchApp: { stopApp: false }`
  without clearing.

## Selecting elements: testIDs only

- `tapOn: { id: 'tasks.add-button' }`, `assertVisible: { id: 'task-editor.title.input' }`. A flow then
  runs unchanged in every locale and on both platforms.
- A testID is `<screen>.<element>[.<key>]`, kebab segments (naming-conventions). Repeated items add a
  stable data key, never an index: `tasks.task-row.<task id>`. Form inputs are
  `<screen>.<field>.input`; a dialog's parts are `<dialog>.scrim`, `.card`, `.title`, `.body`,
  `.buttons` (ui-component-library).
- Every id a flow uses is in `contracts/screens.json` (screen-contracts; `{taskId}` segments stand
  for any data key, and the parts a component derives count too) or in `contracts/e2e.json`
  `extraTestIDs` with why (test-only screens such as `debug.menu`, probes). `check-flows` fails an
  unknown id before a device ever waits for it; add a new id to the component and the contract in the
  same change.
- Maestro lists only accessible elements. A part inside an accessible element (a row's `.label`, an
  element whose contract entry has `parent`) or a decorative part (`a11yHidden`) is crop-only:
  `check-flows` fails it (`unreachable-testid`). Select the accessible element and match its label:
  `assertVisible: { id: 'tasks.task-row.task-2', text: '.*Buy milk.*' }`.
- `text:` next to `id:` filters the element's text (a regular expression). State filters such as
  `checked: true` work on Android only: on iOS Maestro 2.10 reports `checked` false for a React
  Native checkbox (seen on iOS 26.5), so assert an app-owned consequence on both platforms, such as
  `assertVisible: { id: 'tasks.summary', text: '.*1 open task.*' }` after a `lang=en` link.
- `id:` is a regular expression over the whole testID. A pattern (the sub-flow's readiness wait) must
  compile and match at least one id of the contracts.
- Text-only selectors are for OS-owned UI only, under a comment that says so:

  ```yaml
  # system-ui: iOS asks "Open in “<app name>”?"; the title and 'Open' are Apple's, not app text.
  - runFlow:
      when:
        visible: 'Open in .*\?'
      commands:
        - waitForAnimationToEnd
        # system-ui: Apple's Open button, the nearest one below the alert title.
        - tapOn:
            text: 'Open'
            below: 'Open in .*\?'
            optional: true
  ```

- **Guard on the alert's title, never on a bare `'Open'`** (`open-alert-guard`). Maestro's text match
  ignores case, so `visible: 'Open'` also matches an in-app button labelled OPEN (an ad's call to
  action did exactly that in a build with test ads: the guard fired with no alert up, and the tap
  failed once the link had moved the app on).

## Setting up state: one debug link

State comes from the test build's debug link, never from tapping through menus (slow, flaky, and it
couples every flow to every screen). debug-menu-and-test-hooks owns the link: the route
`<scheme>://debug/setup?...`, its registry and `contracts/debug-links.json`, which lists every
parameter and value (in the reference app: `date=YYYY-MM-DD|real`, `offline=0|1`,
`motion=system|still`, `probe=0|1`, `lang=<locale>`, `theme=system|light|dark`, `open=<screen>`). A
flow sends it through the shared sub-flow:

```yaml
- launchApp:
    clearState: true
- runFlow:
    file: ../../subflows/debug-setup.yaml
    env:
      QUERY: 'lang=en&theme=light&motion=still&date=2030-03-01&offline=1&open=tasks'
      WAIT_FOR: 'tasks.list'
```

- **End on the screen to show, and wait for that screen.** The link screen replaces itself with the
  `open=` target; `WAIT_FOR` is that screen's testID. Waiting for the screen the flow started on passes
  even when the link was lost (`debug-open` fails a query without `open=` while the contract has it).
- **A refused link fails at once.** An unknown, repeated or bad parameter makes the app show
  `debug.setup-error` and apply nothing; the sub-flow asserts it is absent. `check-flows`
  (`debug-query`) catches the same mistakes statically.
- **One link per setup is enough** (after `set-language.yaml` when the language can flip the
  direction, below), right after `launchApp` too: the sub-flow first waits for any testID,
  so the app's JavaScript runs, and Expo Router delivers the link once the navigator is ready.
- **A language that flips the layout direction goes in a link of its own, through
  `set-language.yaml`.** The app restarts once to apply the direction and nothing after `lang=` runs.
  The sub-flow sends `lang=${LANG}` as the link that launches the app, so the restarted app opens it
  again and ends on the debug menu, and it waits for `debug.menu`: it returns only once the restart is
  over. Then send the rest with `open=` to a screen other than the debug menu. A literal
  left-to-right `lang=en` may share a link (the runner's devices start in English); a right-to-left
  locale, or `lang=${LANG}` while the contract lists one, may not (`debug-lang-alone`).
- `launchApp: { clearState: true }` wipes the debug switches (they live in the test-only key-value
  store), so every flow sets the ones it needs.
- The one tap a flow makes on its way is the control under test, on the screen the link opened.

## The shared sub-flows

| Sub-flow | Does | Env |
|---|---|---|
| `open-link.yaml` | waits for any testID, opens `LINK`, accepts iOS's alert (guarded on its title), waits for `WAIT_FOR`. ios-simulator-build's `--link` step runs it too | `APP_ID`, `LINK` (a full `<scheme>://<path>`), `WAIT_FOR` |
| `debug-setup.yaml` | runs `open-link.yaml` with `${APP_SCHEME}://debug/setup?${QUERY}`, then asserts `debug.setup-error` is absent | `QUERY`, `WAIT_FOR` (in-app-purchases' storekit flows use the same two) |
| `shoot-screen.yaml` | opens `open=${SCREEN}`, waits for `ROOT`, lets animations end, screenshots `${SCREEN}` | `SCREEN`, `ROOT` |
| `set-language.yaml` | stops the app, launches it with `${APP_SCHEME}://debug/setup?lang=${LANG}`, accepts iOS's alert, waits for `debug.menu` (after the direction restart, when there was one) | `LANG` (the runner's `-e`) |

`check-flows` follows each `runFlow` into the sub-flows it reaches and checks the ids and queries they
build from the values passed in: `SCREEN: home` makes `open=home`, which the contract may not list.

## The template flows

- `flows/smoke/01-first-launch.yaml`: a fresh install (state and keychain cleared) reaches the home
  screen and draws its content.
- `flows/journeys/02-complete-task-survives-kill.yaml`: offline and in English through the link, one
  tap on a task row (the control under test), the summary text proves the change, then `killApp` and
  a relaunch without clearing state, and the summary still says so.

Fill the placeholders with the app's testIDs and open value (`assets/template-placeholders.json`
names each). Sibling skills ship flows that already follow these rules; copy them to the same path:
rtl-and-direction's `flows/rtl/01-language-switch.yaml` (it taps through the language screens, the
control under test, and selects the kept row by its id pattern plus its title) and
accessibility-as-code's `flows/a11y/01-large-text-core-screens.yaml`. The runner passes
`-e LANG=<locale>` to each large-text run, so an a11y flow starts with
`runFlow: ../../subflows/set-language.yaml` and then opens its first screen through `debug-setup.yaml`
with `open=`: a flow that never reads `LANG` runs every locale's pass in the device language
(`large-text-lang`). Any other flow you adopt needs the same edits before check-flows passes: a path
under `flows/<area>/` (or a declared manual folder) with a two-digit name, ids instead of data text
(an id pattern plus `text:` for a row keyed by data), `open=` on every debug link when the contract
has `open` (`debug-open`), and `--device <id> --driver-host-port <port>` in any command a comment
shows (`run-command-device`).

## Waiting without sleeping

- Wait for an id: `extendedWaitUntil: { visible: { id: 'tasks.list' }, timeout: 15000 }` (20 s after
  a relaunch or a direction restart).
- Before a screenshot: `waitForAnimationToEnd: { timeout: 5000 }`, with `motion=still` in the setup.
- Never a fixed sleep: it is slow when the app is fast and flaky when the device is slow.

## Platform differences inside one flow

One flow runs on both platforms; keep platform branches out of it.

- iOS shows the "Open in …?" alert for a link opened from outside; Android opens it directly. The
  guarded `runFlow` is a no-op on Android.
- The software keyboard: `hideKeyboard` closes it on both, except an iOS number pad, which has no
  return key: forms-and-input's `<screen>.keyboard.done` button closes it.
- Back: Android's system back is `back`; iOS has none. A journey that needs "go back" taps the app's
  own back button (`<screen>.top-bar.back-button`), which exists on both.
- Android-only steps (`back`, `pressKey: back`, `setAirplaneMode`, `toggleAirplaneMode`) do nothing on
  iOS: Maestro 2.10's iOS driver has an empty back press and only logs for airplane mode, so an
  unguarded step lets the flow pass on iOS without it. check-flows' `platform-guard` requires each
  one inside `runFlow: { when: { platform: Android }, commands: [...] }`.
- `offline=1` simulates connectivity state for `ConnectivityPort` readers; it does not cut the
  network. An app whose offline path depends on real request failures also runs its offline journeys
  on Android with `subflows/airplane-mode.yaml` around them (`AIRPLANE: enabled` after the debug link,
  `AIRPLANE: disabled` at the end); iOS simulators have no airplane mode.
- Permission dialogs are OS-owned and different on each platform. `launchApp` grants every permission
  by default (`permissions: { all: allow }`), so regular flows never see one; a flow that tests the
  prompt itself is a manual flow.
- If a step truly differs, run it under `runFlow: { when: { platform: Android }, commands: [...] }`
  and say why in a comment.

## Tapping a canvas

A Skia canvas has no accessibility nodes, so its cells have no testIDs. With `probe=1` in the setup
link, skia-canvas-rendering's probe renders `<prefix>.canvas-layout`, a small text with the canvas
origin in window points and its layout (regions in canvas points, unmirrored, `isMirrored`). The flow
reads it and taps a cell centre: origin + region origin + (col + 0.5) × cell, measured from the right
when the surface is mirrored. The skill's `examples/canvas-tap-flow.yaml` shows the steps. Verified:
`copyTextFrom`, `JSON.parse` in `evalScript`, `regions.find` with an arrow function and
`tapOn: { point }` reaching a Skia canvas in a Release iOS build (Maestro 2.10.0), where points are
window points. On Android Maestro's coordinates are the hierarchy's physical pixels while the probe
reports density-independent points: multiply by `density / 160` (read once with
`adb -s <serial> shell wm density`) or tap a percentage of the screen (`point: '50%,40%'`); not yet
verified on an emulator. Gesture testIDs such as `canvas.tap` are Jest-only
(canvas-gestures-and-hit-testing).

## Manual folders: flows the runner never lists

Some behaviour only shows on a different build or with a real system prompt: an ads build with test
ads and the consent forms, a store sandbox, the permission prompt itself. Those flows live in a folder
of their own, declared in `contracts/e2e.json` `manualFolders` (and in `contracts/naming.json`
`extraE2eFolders`):

```json
{ "folder": "permissions", "why": "real system prompts: launchApp would grant every permission", "startsOutside": true, "requiredParams": ["lang"] }
```

- The runner lists only `flows/<area>/`, so these never run in the evidence run; `check-flows` still
  checks them (header, ids, guard, queries) and requires the folder's tag.
- `startsOutside: true`: the flow never calls `launchApp`. Start a fresh install first with
  `xcrun simctl launch <udid> <app id>` (iOS; reset an earlier answer with
  `xcrun simctl privacy <udid> reset all <app id>`) or `adb -s <serial> shell monkey -p <app id> 1`
  (Android; `adb -s <serial> shell pm clear <app id>` resets it).
- `requiredParams`: parameters the folder's first setup link must set, so the result never depends on
  the machine (a consent geography, a store environment).
- Run one with `tools/maestro/bin/maestro --device <udid or serial> --driver-host-port <port> test -e APP_ID=<id> -e APP_SCHEME=<scheme> <flow>`;
  admob-ads-and-consent (`ads-smoke/`) and in-app-purchases (`storekit/`) document theirs.

## Flaky flows and quarantine

A flaky flow passed and failed on the same commit. It is a bug in the flow or the app.

1. Rerun the failing flow alone:
   `tools/maestro/bin/maestro --device <udid or serial> --driver-host-port <port> test <flow> -e APP_ID=<id> -e APP_SCHEME=<scheme>`
   (the three quiet variables set; your own device; a free port, never 7001).
2. If it passes alone it is flaky: fix the wait (`extendedWaitUntil` on an id), the setup (the debug
   link) or the app. `retry:` never wraps app steps.
3. If the fix needs more than this session, add `quarantine` to the flow's tags and
   `# quarantine <YYYY-MM-DD>: <reason>`, name it in the report, and fix it within 7 days. The runner
   excludes `quarantine`; `check-flows` fails a quarantine older than 7 days.
4. A `smoke` flow is never quarantined: it blocks the release until fixed.
5. When a device's state looks wrong, erase only your own: `xcrun simctl erase <udid>` (shut down
   first) or `adb -s <serial> emu kill` and start the AVD with `-wipe-data`.

## What a flow should not prove

A rule proven by unit tests and property tests needs no flow; a flow proves the wiring: navigation,
persistence across a kill, a direction restart, offline behaviour, deep links. Translations are
proven by the catalog checks, layout and mirroring by the screenshot matrix.
