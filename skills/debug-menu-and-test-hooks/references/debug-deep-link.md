# The debug deep link

One URL puts a test build into any state an E2E flow, a screenshot or a tester needs, and the debug
menu changes the same state through the same store. Verified on 2026-10-10 with expo-router 57.0.24
in Jest (the in-memory router), Expo SDK 57 sources and docs; not yet driven on a simulator or an
emulator (no native build in this skill's verification).

## Contents

- The URL and the registry
- How Expo Router delivers it (cold start and running, iOS and Android)
- What the link screen does, in order
- Strict parsing
- Idempotence, reloads and the direction restart
- Opening the link from tools
- Adding a parameter
- Pitfalls

## The URL and the registry

`<scheme>://debug/setup?<param>=<value>&...`, every parameter optional. The template's parameters
(Tasks demo; an app adds its own):

| Parameter | Values | Effect |
|---|---|---|
| `date` | `YYYY-MM-DD` or `real` | the day `clock.today()` answers; `real` clears it |
| `offline` | `0`, `1` | "simulate offline": every ConnectivityPort reader hears `none` |
| `motion` | `system`, `still` | `still` holds every animation at its end state (screenshots, E2E) |
| `probe` | `0`, `1` | canvas surfaces render their layout probe (`<prefix>.canvas-layout`) |
| `lang` | the app's languages (`LANGUAGES`) | the saved language, through the app's settings target |
| `theme` | `system`, `light`, `dark` | the saved theme, through the same target |
| `open` | `tasks`, `debug` | the screen opened last (default: the debug menu) |

- The registry is `src/features/debug/debug-links.ts`: `DEBUG_LINK_PATH`, `DEBUG_LINK_PARAMS` (each
  parameter's values or kind and its effect) and `parseDebugLink`. Pure, so Jest and the checker run
  it.
- `contracts/debug-links.json` mirrors the table for tools that do not run TypeScript (E2E flows,
  e2e-maestro's checks). `check-test-hooks` (`debug-registry`) fails when the two differ.
- Values are words or digits a person can type in a flow. Booleans are `0`/`1`, never `true`/`false`.
- Never name a parameter `screen`, `params`, `initial` or `state`: React Navigation reads those as
  nested-navigation instructions, so a nested navigator under the debug group (or the React
  Navigation appendix path) would treat `screen=tasks` as "navigate the child navigator". The
  contract schema refuses them, which is why the screen parameter is `open`.

## How Expo Router delivers it (cold start and running, iOS and Android)

The link is a route: `src/app/(debug)/debug/setup.tsx` (groups do not appear in the URL). Expo Router
resolves the launch URL on a cold start and every later URL while the app runs, and holds a URL until
the navigator is ready, so the app needs no `Linking` listener, no queue and no `linking` config. That
removes the classic failure of hand-rolled debug links: a link sent right after launch, before a
listener attached, was lost (React Native's `Linking` delivers a URL once: as the initial URL, or as
an event to the listeners attached at that moment).

- **iOS**: the scheme comes from `app.config.ts` `scheme` (per variant: app-variants-and-environment
  gives each variant its own scheme, so a development and a preview build on one simulator never
  answer each other's links).
- **Android**: Expo's scheme plugin adds the intent filter only to the `singleTask` main activity
  (read in `@expo/config-plugins` 57 `android/Scheme.js`), so a link while the app runs arrives
  through `onNewIntent` in the same task instead of starting a second copy.
- The route's search params arrive through `useLocalSearchParams()`: a repeated key is a
  `string[]`, a single one a `string`.

## What the link screen does, in order

`DebugSetupRoot` (rendered through `TEST_ONLY` by the route) parses once, plans, applies, then
**replaces** itself with the target, so Back never returns to the link:

1. **Parse** (`parseDebugLink`). A refused link applies nothing, records
   `debug link refused: <kind> <param>=<value>` in the error log and shows it with testID
   `debug.setup-error`, so the flow fails on the next wait.
   A link with a settings parameter while the startup passed no settings target is refused here too,
   before any step runs (`debug-link-settings-not-wired`), so a refused link leaves no simulated day
   behind.
2. **Overrides** (`date`, `offline`, `motion`, `probe`): one `apply-overrides` action on the debug
   switches store. The store persists before it publishes; the simulated clock and connectivity read
   it at once. A write that fails (the store's `lastWriteFailure`) refuses the link
   (`debug-link-overrides-not-saved`) instead of opening the screen in a state the link did not set.
3. **Settings** (`lang`, `theme`): `hooks.settings.apply(patch)` (the app's `DebugSettingsTarget`,
   `examples/settings-target.ts`); a target that throws refuses the link
   (`debug-link-settings-failed`).
4. **Screen**: `router.replace(DEBUG_SCREENS[open])`. If step 3 answered `restarting` (a language
   that flips the layout direction reloads the app), nothing else runs.

`planDebugSetup` holds that order as a pure function with its own test.

## Strict parsing

Unknown, repeated or bad parameters refuse the whole link with typed failures
(`debug-link-unknown-param`, `debug-link-repeated-param`, `debug-link-bad-value`, the Result type of
error-handling-typed-results). A parser that ignores what it does not know lets a flow with a typo
(`ofline=1`) test the online state and pass. `check-test-hooks` (`registry-strict`) runs the app's
parser with an unknown parameter, each parameter twice, a bad value of each, and every listed value.

## Idempotence, reloads and the direction restart

Every step sets a value; none toggles. The same link applied twice leaves the same state, which makes
three real situations harmless:

- React's development double effect runs the apply twice in a development build.
- A reload (crash recovery, the direction restart) re-delivers the launch URL on a cold start.
- A flow retries a step.

A language that flips the layout direction (en to ar) restarts the JS runtime through the app's
direction restart (rtl-and-direction). Send it in its own link, wait for a screen root, then send the
rest: after the reload Expo Router opens the launch URL again only when the app was launched by that
link, and a link that arrived while running is not re-delivered. The overrides survive either way
(the key-value store); the screen does not. A settings target compares the new language's direction
with the direction the app is running in (`readLayoutDirection()`), never with the saved language, so
`lang=en` on an English phone applies without a reload.

**Why there is no "pending screen" step.** A hand-rolled variant stores `{ screen, url }` in the
test-only key-value store before the restart and opens that screen once the reloaded navigator is
ready, so one link does both. It is left out on purpose: with Expo Router a cold start launched by
the link re-delivers the same URL after the reload, so the stored step and the re-delivered link both
run, and telling them apart needs a de-duplication key in storage and a "navigator ready" hook in the
startup, both easy to get subtly wrong. Two links (the language, then the rest) cost one extra wait
in an RTL flow and have no hidden state.

## Opening the link from tools

Always name the device (several sessions share one machine). The default is a Maestro subflow
(examples/debug-setup-flow.yaml), on both platforms. It uses `${APP_ID}` and `${APP_SCHEME}` and has
no `launchApp`, so it runs from a flow that passes both, or alone with `-e` and the app already open:

```yaml
# in a flow (e2e-maestro): the subflow gets its variables from the flow and runs after launchApp
- launchApp
- runFlow:
    file: subflows/debug-setup.yaml
    env:
      APP_ID: com.example.tasks.dev
      APP_SCHEME: tasks-dev
```

```sh
# standalone, with the app already running on its first screen (tasks.list)
maestro --device <id> test -e APP_ID=com.example.tasks.dev -e APP_SCHEME=tasks-dev .maestro/subflows/debug-setup.yaml
adb -s <serial> shell 'am start -W -a android.intent.action.VIEW -d "tasks-dev://debug/setup?date=2030-03-01&offline=1" com.example.tasks.dev'
```

- **iOS: never `xcrun simctl openurl` alone.** iOS answers a custom scheme opened from outside the
  app with an "Open in “<app>”?" alert that nothing accepts, so the app never gets the link (and the
  waiting alert hides the app from the next step). Seen on iOS 26.5 simulators in the source app;
  Maestro's documentation says the same prompt can appear for `openLink`, which is why the example
  flow accepts it in a guarded `runFlow`: guarded on the alert title `'Open in .*\?'`, never on a
  bare `'Open'` (Maestro's text match ignores case, so it also matches an ad banner's OPEN button).
- **Android: quote the URL twice.** `adb shell` hands its arguments to the device's shell, which
  splits an unquoted URL at `&`: only the first parameter arrives and the flow tests the wrong state.
  Quote the whole `am start` command for the local shell and the URL again inside it, as above.
- In Maestro, wait for a screen root before `openLink` so the JavaScript is running, then wait for a
  screen the app was not on before (or assert the state the link set): waiting for the start screen
  passes with a lost link.

## Adding a parameter

1. A failing test in `debug-links.test.ts` (accepted values, a refused value).
2. The entry in `DEBUG_LINK_PARAMS`, its field in `DebugRequest`, its case in `withValue`.
3. Its step in `planDebugSetup` (an override, a setting, or a new step kind with its own test).
4. Its row in `contracts/debug-links.json` and in this table.
5. `node ${CLAUDE_SKILL_DIR}/scripts/check-test-hooks.mjs .` until `RESULT: PASS`.

Parameters other skills ask an app to add (each through the steps above):

| Parameter | Values | Through | Asked by |
|---|---|---|---|
| `premium` | `0`, `1` | a test-only Premium target beside the settings target (`createTestHooks({ premium })`, refused as `debug-link-premium-not-wired` when null, like `lang=`), calling the premium store's `grantPremium({ ownedSinceMs: clock.nowMs() })` / `revokePremium(clock.nowMs())` from `src/services/test-hooks/` | in-app-purchases (`examples/debug-premium-link.ts`) |
| `open` value `paywall` | added to `DEBUG_SCREENS` | the paywall route (`paywall.screen`) | in-app-purchases |
| `geo` | `eea`, `other` | resets Google's consent answer and builds the consent port with `debugGeography` in the test-only entry (`createAdmobConsentDebugAdapter`) | admob-ads-and-consent |
| `onboarding` | `done` | an override the onboarding guard reads | admob-ads-and-consent |

The screen parameter is always `open` (`screen` is refused, see the registry above): a flow that
writes `screen=paywall` is refused with `debug-link-unknown-param`.

When deep-links-and-universal-links is adopted, its link gate refuses every path it does not list, so
its `LINK_ROUTES` needs `{ path: '/debug/setup', query: 'any', testBuildOnly: true }` (and `/debug`,
`/debug/parity` when those are linked); its `link-test-only` rule requires `testBuildOnly` on them.
The gate passes the query through only in test builds; this skill's strict parser still validates it.

## Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| A flow passes with a typo in the link | the parser ignores unknown parameters | the template's strict parser (`registry-strict`) |
| The link opens the not-found screen | no route answers `debug/setup`, or the group layout is missing | copy `templates/src/app/(debug)/` (`link-route`) |
| The link works on a cold start but not while the app runs (Android) | the main activity is not `singleTask` (a hand-edited manifest) | keep Expo's generated activity; never edit `android/` by hand |
| `lang=` is applied but the screen is wrong | the language flipped the direction and the app reloaded | send `lang=` in its own link |
| iOS: the link never arrives, an "Open in …?" alert waits | `simctl openurl`, or a flow without the guarded accept step | open it through the Maestro subflow with the guarded `runFlow` |
| Android: only the first parameter is applied | `adb -s <serial> shell am start -d` with the URL quoted once; the device shell split it at `&` | quote the command and the URL (above) |
| A flow passes although the link was lost | it waited for the screen it started on | wait for another screen, or assert the state (`debug.menu.day`) |
| A nested navigator jumps somewhere odd on a link | a parameter named `screen`, `params`, `initial` or `state` | rename it (`open`) |
| Back returns to the link | the screen pushed the target | `router.replace`, as the template does |
| `useTestHooks() needs a <TestHooksProvider>` | the registry never registers `TEST_ONLY?.createDebugKit`, so the root's motion slot renders no `TestHooksRoot` | register it (references/wiring-and-menu.md) |
