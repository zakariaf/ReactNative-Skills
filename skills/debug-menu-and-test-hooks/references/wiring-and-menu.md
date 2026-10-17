# Wiring the hooks into the app, and the debug menu

Where the test-only pieces plug into an Expo Router app's startup and root, the debug menu, and how
other skills' test hooks join the same entry. The startup order is the canonical one
app-startup-and-bootstrap owns; this skill fills three of its root slots from the app's root-kit
registry and edits no root file.

## Contents

- The startup and root, in order
- The two registry edits
- The debug group and its routes
- The debug menu
- Other skills' test hooks
- What is deliberately not here

## The startup and root, in order

```
src/app/_layout.tsx           RootLayout: the error net import first; useState(decideStartup):
                              createDeviceServices() -> language (unchanged)
  DirectionGate               rtl-and-direction: restarts once for the layout direction, or renders
  AppRoot                     startApp, in order:
                                prepareRootKits(device)   registry: TEST_ONLY?.createTestHooks(...) (test
                                                          build) -> services = testHooks?.services ?? device
                                openDeviceData(services), the error net's sink, settings, stores
                                createRootKits({ ..., prepared })   registry: TEST_ONLY?.createDebugKit(hooks)
    ServicesProvider          the prepared services (simulated clock and connectivity in a test build)
    ... data, i18n, theme, text locale
    RootStack                 GestureHandlerRootView > KeyboardProvider
      RootMotion              the motion slot: the debug kit's TestHooksRoot (the hooks + MotionConfig
                              with the debug motion switch) in a test build; the plain MotionConfig in
                              production (no kit)
        NavigationThemeProvider -> AppStack: Stack.Protected guard={isTestBuild} around (debug),
                              open only while a kit says opensDebugRoutes (the debug kit)
```

Nothing in this skill runs at import time, and nothing replaces a piece another skill owns: the error
net, the direction gate, the providers and the motion config keep their places. A production build
has `TEST_ONLY === null`: `prepareRootKits` returns the device services, `createRootKits` creates no
test-only kit, `RootMotion` renders the plain `MotionConfig`, and the `(debug)` group stays closed.

## The two registry edits

The registry (`src/services/create-root-kits.ts`, an app file; app-startup-and-bootstrap ships its
empty template) is the only file this skill touches outside its own folders
(`examples/create-root-kits.ts` is the shape; the checker reads the
result):

1. **`prepareRootKits(device)`**: call `TEST_ONLY?.createTestHooks({ services: device, storage:
   TEST_ONLY.createKvDebugStorageAdapter(), settings })` once and return `{ services:
   testHooks?.services ?? device, testHooks }`. startApp calls it first, before the data layer opens,
   and hands those services to everything (the repositories, `QueryProvider`'s
   `app.services.connectivity`, `ServicesProvider`), so every reader gets the simulated ports with no
   further edit. (`hooks-wired`, `entry-reachable`)
2. **`createRootKits(input)`**: with `input.prepared.testHooks`, register
   `TEST_ONLY?.createDebugKit(testHooks)` among the test build's kits. The kit
   (`src/features/debug/debug-root-kit.tsx`, canonical) fills the motion slot with `TestHooksRoot`
   and sets `opensDebugRoutes`, which opens the canonical AppStack's `Stack.Protected` around
   `(debug)` (navigation-and-routing's `debug-gated`: list the guard `isTestBuild` of
   `src/features/root-navigator/app-stack.tsx` in its contract's `protected`, and the routes in
   `debugRoutes`). (`entry-reachable`)

A settings target (`examples/settings-target.ts`) lives in `src/services/test-hooks/` like the other
hooks, so the entry re-exports `createDebugSettingsTarget` and `prepareRootKits` passes
`settings: TEST_ONLY.createDebugSettingsTarget({ store, restartForDirection })` once the app's
settings store exists before that step; a static import of it would ship it
(architecture-and-boundaries' `test-only-gate`).

Then copy the templates: the gate pair, `src/features/debug/`, `src/services/test-hooks/`,
`src/services/debug-storage/`, `src/stores/debug-overrides/`, `src/app/(debug)/`, the `debug.*` keys
of the catalogs, `contracts/debug-links.json` with its schema, and add the four folders to
`contracts/architecture.json` `testOnlyFolders`.

## The debug group and its routes

| Route file | URL | Renders |
|---|---|---|
| `src/app/(debug)/_layout.tsx` | | `<Slot />`, nothing else |
| `src/app/(debug)/debug/index.tsx` | `/debug` | `TEST_ONLY?.DebugMenuRoot`, or `<Redirect href="/" />` when it is undefined |
| `src/app/(debug)/debug/setup.tsx` | `/debug/setup?...` | `TEST_ONLY?.DebugSetupRoot` with `useLocalSearchParams()`, or the same redirect |

- Production is kept out twice: the canonical AppStack's `Stack.Protected guard={isTestBuild}`
  (open only while a kit sets `opensDebugRoutes`) removes the group, and
  each leaf route redirects home when its `TEST_ONLY` member is undefined. The group layout holds no
  `<Redirect>`: navigation-and-routing's `flow-by-guard` fails every redirect in a layout (a layout
  that redirects renders the guarded screen for a frame), and the guard already does that job.
- Route files stay thin (architecture-and-boundaries): they render the test-only component through
  the gate and redirect when it is undefined. A route can never import `src/features/debug/` itself,
  so the model and view meet in a `*-root.tsx` component inside the test-only folder.
- A `Slot`, not a `Stack`: the link screen replaces itself, so the group keeps no history; a `Stack`
  here would also need its own moment in motion-and-animation's catalog.
- Production keeps the three small route files (Expo Router bundles every route); they hold no
  test-only code.

## The debug menu

`/debug` shows, for testers and developers:

| Row | testID | Writes |
|---|---|---|
| Build: `<variant>` | `debug.menu.build` | (read-only; `currentAppVariant()`) |
| Day: `<simulated day>` or "Real calendar" | `debug.menu.day` | (read-only) |
| Errors logged: `<n>` | `debug.menu.errors` | (read-only; the error log's count when the menu renders) |
| Simulate offline | `debug.menu.offline` | `set-offline` |
| Hold motion still | `debug.menu.motion` | `set-motion` |
| Canvas layout probes | `debug.menu.probe` | `set-canvas-probe` |
| Simulate the next day | `debug.menu.next-day` | `advance-day` (from the simulated day, else the real one) |
| Back to the real day | `debug.menu.real-day` | `use-real-day` |

- The menu writes the same store the debug link writes, through the same reducer, so the two never
  disagree and the menu's switches show what a link set.
- It is a screen like any other: a pure view (`debug-menu-screen.tsx`), a model hook
  (`use-debug-menu-model.ts`), the app's press surface with roles (`switch` with `isChecked`,
  `button`), texts from the catalogs. A short fixed list, so a `ScrollView` with its
  `// bounded-list:` reason (react-components-and-hooks).
- Texts: the `debug.*` keys. i18n-strings-and-catalogs lets an app keep them in the source language
  in every catalog with `"untranslatedPrefixes": ["debug."]` in `contracts/i18n.json`; the template
  ships translations so it passes without that key. Numbers still go through the formatters.
- Add a row the same way: a reducer action and case, the model's row, a testID `debug.menu.<id>`.

## Other skills' test hooks

A test hook another skill ships joins **this** entry, never a gate of its own (one way in,
`gate-file`). The pattern: the module lives in a folder that holds **only test-only code**, that
folder joins `testOnlyFolders`, the entry re-exports it, and the startup or `createTestHooks` wires
it. The folder rule is what lets both checkers pass: `testOnlyFolders` entries are folder prefixes,
so declaring a folder that also holds production modules makes architecture-and-boundaries'
`test-only-gate` fail every normal import of them, and leaving it undeclared makes this skill's
`test-only-folders` fail the entry's re-export. A single file cannot be declared.

| Hook | Owner | How it joins |
|---|---|---|
| Recording feedback (`recordAudioFeedback`, `recordHapticsFeedback`) | audio-and-haptics-feedback | shipped by that skill in `src/services/test-hooks/recording-feedback.ts` (+test); `src/services/test-hooks/` is already a test-only folder in `testOnlyFolders`, so nothing moves. `src/test-only-entry.ts` re-exports both from `'@/services/test-hooks/recording-feedback'`, and the startup wraps the audio and haptics ports with them in a test build (`TEST_ONLY?.recordAudioFeedback`), the way the clock is wrapped |
| The canvas layout probe (`<prefix>.canvas-layout`, `<prefix>.canvas-frame`) | skia-canvas-rendering | the canvas host passes `probe={{ testIdPrefix }}` to `SurfaceHost` only while the switches store says `isCanvasProbeOn` (`probe=1`; add a `selectIsCanvasProbeOn` selector with its first reader); off by default, so screenshots never show it |
| Motion held still | motion-and-animation, accessibility-as-code | already wired: `TestHooksRoot` passes `preference="on"` to the one `MotionConfig` while `motion=still` |
| The ready marker for Release simulator builds (`Documents/test-hooks/ready.txt` containing the first screen's name) | ios-simulator-build reads it (`contracts/ios-sim-build.json` `readyMarker`) | a test hook writes the file through a file-system port once the first screen is interactive; not shipped here yet |
| Running the seeded core goldens on a device | seeded-determinism-and-golden-vectors | a debug-menu row that runs the golden vectors and shows pass or the first mismatch; owed, not shipped here yet |
| Consent geography for an ads smoke test | admob-ads-and-consent | a `geo=` link parameter and an override the consent port reads, added the way "Adding a parameter" describes |
| Premium for StoreKit flows | in-app-purchases | owed, not shipped here yet: a `premium=0\|1` link parameter through a test-only Premium target (debug-deep-link.md, "Adding a parameter") that calls the premium store's `grantPremium` / `revokePremium`; in-app-purchases' contract allows those calls only in `src/services/test-hooks/` and `src/features/debug/` (`entitlement-writers`). Restore, receipts and the store stay real |
| A frame state for screenshots | screen-contracts | owed, not shipped here yet: a test build only names which frame state to open (a link parameter or a menu row); the owning screen's model opens it once through the same handler a person's tap uses, so there are no capture-only branches |
| A signed-in session for E2E | auth-and-secure-storage | owed, not shipped here yet: E2E cannot drive a real OAuth browser sign-in, so a test-only hook in `src/services/test-hooks/` seeds a session through `createSessionManager().signIn({ grant, account })` with test tokens (its `test/session/session-test-kit.ts` shows the Jest form) |
| The test-build perf log and its menu rows | performance-budgets (its `check-perf-code` rule `debug-perf-wired` reads the entry once it exists) | owed, not shipped here yet: the entry calls `createKvPerfLogAdapter()` (`src/services/perf-log/`) and `createPerfDebugActions({ perfLog, perf, openBenchmark })` and exposes `TEST_ONLY.perf = { perfLog, actions }`; the menu adds "Record frame times" (`actions.setRecording`), "Run storage benchmark", "Share performance report" and a summary line (`actions.summary()`). The perf log has its own kv-store database (`perf-log.db`), so a preferences reset does not wipe it. Production has no perf log |
| Crash triggers for the device proof | crash-reporting-and-observability | owed, not shipped here yet: three menu rows in the preview build's kit, a throw in a press handler, a rejected promise and a throw in render; no SDK-specific code (no native crash trigger) |
| The network guard | privacy-and-store-declarations | add `export { installNetworkGuard } from '@/services/test-hooks/network-guard';` to `src/test-only-entry.ts` once that skill's `network-guard.ts` is in the app (this template cannot export a module the app does not have yet), and install it first in the registry's `prepareRootKits`, before `createTestHooks`, with `onAttempt` writing to the error log (the library's reference app does); the menu may show the attempt count |
| The parity launch | design-visual-parity | its examples export `createParityKit` (the parity root kit: the frame root around the Stack, the iOS launch bridge beside it) and the app's `ParityLaunchScreen` from the entry, register the kit beside the debug kit in the registry and add the `(debug)/debug/parity` route; the screen builds its appliers from these hooks (`apply-overrides` with `today`, `motion`, `isOffline`, `isCanvasProbeOn`, and the settings target) |
| Background runs | background-tasks | owed, not shipped here yet: a row that calls `triggerBackgroundRunForTesting()` (it resolves false outside `__DEV__`; on Android the device proof uses `adb -s <serial> shell cmd jobscheduler run -f` instead), and a panel listing `lastRun(name, 'background')` for each job (the proof; the `'foreground'` record may sit beside it, labelled, never as proof) with the kv background error log's newest entries |
| A reminder a minute ahead | local-notifications | owed, not shipped here yet: a row that writes a reminder row through the repository and calls `reminderSync.request()`; never the notification adapter directly (that skill's `sync-only-writer`) |
| Ending a game run | game-session-host | owed, not shipped here yet: `host.debugControls().endActiveRun('win' \| 'lose')`, reached only through the entry (for example a `win-level` / `lose-level` row or link action); store builds never get it |

## What is deliberately not here

- No hidden gesture or shake menu in production builds: the debug menu does not exist there.
- No `__DEV__`-only tools (Reactotron, a devtools package): those are debug-bundle tooling, gated by
  `__DEV__` (app-variants-and-environment), and absent from preview builds testers use.
- No network override that bypasses the `ApiClient` port: a test build that needs a fake server
  points the API environment at one (app-variants-and-environment's environment readers).
