# The app side: the parity harness and testIDs

What the app must provide so a capture shows exactly the state a design frame draws, and so every
element can be measured. The harness ships as templates (copy them, do not rewrite them); it is
test-build code reached only through the test-only gate, so production builds never contain it.
Verified on 2026-10-14 in Jest against the reference app (Expo SDK 57, expo-router 57, React Native
0.86.3); the launch on a simulator or an emulator follows from the documented APIs and the source
app's measured launch (iOS), and is not yet driven on a device by this skill.

## Contents

- The launch contract
- The templates
- What a parity launch does, in order
- The appliers: how the app applies a launch
- Frame states and who opens them
- Tall frames and the scroll offset
- Motion held still
- The launch nonce and modal roots
- Probe launches
- Wiring it in (and keeping it out of production)
- testIDs the screens must carry
- Three traps
- Appendix: React Navigation

## The launch contract

One query, built by capture-app.mjs: `frame=<key>&theme=<light|dark>&lang=<code>&date=<fixture day>&
motion=still&nonce=<hex>[&scrollY=<pt>][&probe=<region>]`. iOS gets it as the launch argument
`-parity "<query>"`; Android as the link `<scheme>://debug/parity?<query>`. Both end in one route,
`src/app/(debug)/debug/parity.tsx`.

`parseParityRequest` (template `parity-request.ts`) is strict: an unknown, repeated, missing or bad
parameter refuses the whole launch, a date other than the fixture's day is refused, `probe` must be the
frame's region, `scrollY` belongs to tall frames. A refused launch shows only the error screen (root
`parity.error`, the failure as its label), so the capture fails `screen-not-reached` naming it; a silent
fallback to the home screen would be compared with the wrong reference. check-harness.mjs runs the app's
own parser (`harness-parser`): every plan must launch, and an unknown parameter, a repeated one, an
unknown frame, a missing nonce and `motion=system` must be refused.

## The templates

| File | What it does |
|---|---|
| `src/features/parity/parity-plans.ts` | One plan per design frame: root, href, state, data (`design` or `empty`), tall, probe. Plain data; check-harness.mjs proves it agrees with the contracts |
| `src/features/parity/parity-request.ts` (+ test) | The strict parser and its typed failures |
| `src/features/parity/parity-fixture.ts` + `parity-fixture.json` (+ test) | The design's data in every language, validated with valibot at load; `parityDataFor(fixture, language, data)` |
| `src/features/parity/parity-session.ts` (+ test) | The running launch's request, an external store |
| `src/features/parity/parity-launch.ts` (+ test) | `runParityLaunch(params, { appliers, navigate })`: the launch in order |
| `src/features/parity/parity-launch-root.tsx` (+ test) | The launch, rendered by the app's launch screen: runs it once, shows the error screen on a refusal |
| `src/features/parity/parity-error-screen.tsx` | The `parity.error` root |
| `src/features/parity/parity-frame-root.tsx` (+ test) | Around the navigator: turns the session into the screens' `FrameRequest` and draws the launch marker |
| `src/features/parity/read-parity-launch.ts` (+ test) | iOS: reads `-parity` from React Native's `Settings`; the launch href; a query parser |
| `src/features/parity/parity-launch-bridge.tsx` (+ test) | iOS: opens the launch route once from the launch argument |
| `src/features/parity/parity-root-kit.tsx` (+ test) | The parity kit (`createParityKit`): a test build's root kit; its provide slot wraps the Stack in the frame root, its effects slot mounts the bridge with `router.replace` (app-startup-and-bootstrap's root slots; the root files stay unchanged) |
| `src/hooks/use-frame-request.tsx`, `use-frame-state-opener.ts`, `use-frame-scroll-target.ts` (+ tests) | Production: `FrameRequestProvider` and `useFrameRequest`, and the two hooks built on it (one hook per file, naming-conventions); null in every normal start |
| `src/ui/parity-launch-marker.tsx` (+ test) | Production: the invisible `parity.launch.<nonce>` element; draws nothing without a launch |

The production files (the frame-request hooks and the launch marker) are what screens and modal roots import; nothing else of the harness is ever
imported by value outside the test-only entry and the test-only folders (the app's launch screen lives
in one; `harness-leak`). Until contracts/architecture.json exists, the test-only folders are
debug-menu-and-test-hooks' defaults, `src/features/debug/` and `src/services/test-hooks/`.

## What a parity launch does, in order

`runParityLaunch` (template `parity-launch.ts`):

1. **Parse** the request (refused: the error screen, nothing applied).
2. **Hold the consent moment** (`appliers.consent`): it resolves only when nothing can ask for
   consent over the frame, else the launch stops on the error screen (below).
3. **Set every test-build switch**: the simulated day (`today: request.date`), motion held still,
   simulated offline off, the probe (`probe: request.probe`). Every one is set on every launch: a switch
   an earlier E2E flow saved (offline on, another day) would otherwise carry into the capture
   (`harness-debug-flags`).
4. **Write the design's data** through the app's own repositories (`appliers.data`): the frame's rows
   in the render language, or nothing for an empty frame. The screen then reads what a person would
   have entered, through the real code path.
5. **Apply the settings**: the language, and the theme setting `system` (the device appearance, which
   capture-app.mjs sets, decides the colours). A language that flips the layout direction restarts the
   app (rtl-and-direction); the launch is delivered again after the restart (the launch argument stays
   on iOS; Expo Router re-delivers the launch link on a cold start on Android) and finishes then.
6. **Start the session** and **replace** the launch route with the frame's route (`router.replace`, so
   Back never returns to the launch).

## The appliers: how the app applies a launch

`ParityAppliers` is the app's side, built from its own services by a small test-only screen that
renders `ParityLaunchRoot` (examples/parity-launch-screen.tsx; it reads `useTestHooks()` and the
services):

| Applier | Built from |
|---|---|
| `consent()` | resolves when no consent primer, Google consent form or Apple tracking prompt can cover a frame. An app without react-native-google-mobile-ads resolves at once; an app with it resolves only when the build's ads mode is off (`readAdsExtraForBinary(Application.applicationId).adsMode === 'off'`, admob-ads-and-consent: an `ADS_MODE=off` build never asks) and rejects otherwise, so a capture is never made of a covered frame. Capture an `ADS_MODE=off` preview build. check-harness.mjs fails an ads app whose consent applier does not consult the ads mode (`harness-consent`) |
| `overrides({ today, motion, isOffline, probe })` | debug-menu-and-test-hooks' switches store (the same `apply-overrides` action the debug link uses: the simulated clock, simulated offline, motion still, the probe) |
| `data(rows)` | the app's repositories (persistence-and-migrations): replace the tables the frames read with the fixture's rows |
| `settings({ language, theme })` | the app's debug settings target (the one the debug link's `lang=` and `theme=` use); `restarting` when the language flips the direction |

## Frame states and who opens them

A frame whose screen does not open on it by itself (a dialog, a menu, a pressed state, a state reached by
an action) has a plan `state`. The model hook that owns that state opens it once, on mount, through the
handler a person's press would call:

```ts
useFrameStateOpener('delete-list-dialog-open', () => {
  onAskDelete(firstListId);
});
```

`useFrameStateOpener` reads the parity root's request (null in a normal start), so there is no
capture-only branch in a view or a model, and the capture shows the real code path (screen-contracts'
rule). check-harness.mjs requires every planned state to be opened by a literal
`useFrameStateOpener('<state>', ...)` outside the harness (`harness-opener`), and a dialog, overlay or
sheet frame, or a non-default state that data alone does not reach, to have a plan state
(`harness-frame-state`). Every opener has a test with a provided `FrameRequest`. An opener whose state
lives outside React re-renders through a subscription; a value cached by the React Compiler can draw a
switch off that the store holds on, and only a capture shows it.

## Tall frames and the scroll offset

A tall frame's capture asks for `scrollY`; the screen passes `useFrameScrollTarget()` to ScreenBody's
`scrollToY` (screen-contracts' template), which scrolls from both `onContentSizeChange` and `onLayout`,
without animation. The harness never scrolls anything itself. Scrolling from `onContentSizeChange` alone
stopped short once: the first layout came before the safe-area insets, iOS clamped the offset, and
nothing scrolled again (`scroll-mismatch`).

## Motion held still

The design draws every animation at rest, and a capture must hold still. The launch sets the debug
switch `motion: 'still'`, which the root stack's one `MotionConfig` honours (debug-menu-and-test-hooks'
debug kit puts `TestHooksRoot` in the root's motion slot), so every consumer of the app's reduce-motion path holds still: loops, entrances,
celebrations, screen transitions. A loop that ignores it never settles (`unstable`): route it through
`useReduceMotion()` (accessibility-as-code), never a parity-only branch. The saved Reduce motion setting
is not touched; a settings row reads the preference, not the switch.

## The launch nonce and modal roots

`ParityFrameRoot` draws `<ParityLaunchMarker />` with the launch's nonce; capture-app.mjs refuses a
hierarchy dump without it. A modal layer (React Native's `Modal`, `accessibilityViewIsModal`, Android's
modal window) hides everything outside it from the accessibility tree Maestro reads, the root's marker
included, so every modal root renders `<ParityLaunchMarker />` as **the first child of the view that
carries `accessibilityViewIsModal`** (the scrim View), never beside it: iOS hides the siblings of that
view too, so a marker placed as the first child of `<Modal>` is invisible and every capture of the dialog
stops with "hierarchy from another device". It draws nothing outside a parity launch. check-harness.mjs
fails a file that renders React Native's `Modal` without it, a marker outside the
`accessibilityViewIsModal` view of its file, and a parity root without it (`harness-launch-marker`). A
file passes when it renders the marker itself or renders a component imported from a file that does
(followed through any number of imports), so a dialog that composes the app's shared modal root is
covered once that root carries the marker.

```tsx
<Modal transparent visible onRequestClose={onCancel}>
  <View testID="delete-list-dialog.scrim" accessibilityViewIsModal style={styles.scrim}>
    <ParityLaunchMarker />
    {/* the dialog's content */}
  </View>
</Modal>
```

**Shared modal roots from other skills.** Their canonical templates do not import this skill's marker
(it reads this skill's frame request, which an app without parity does not have), so after copying
`src/ui/parity-launch-marker.tsx` add one import and one line to each of them the app has adopted:

| Component (owner skill) | File | Edit |
|---|---|---|
| `Scrim` (ui-component-library) | `src/ui/scrim.tsx` | `<ParityLaunchMarker />` as the first child of its `accessibilityViewIsModal` View, inside the `<Modal>` |
| `ConfirmDialog` (ui-states-and-feedback) | `src/ui/feedback/confirm-dialog.tsx` | the same |
| `DeleteListDialog` (screen-contracts' demo dialog) and every dialog of the app's own | `src/features/<feature>/<dialog>/<dialog>.tsx` | the same, or compose `Scrim` (then nothing to add) |

check-harness.mjs names each file that still lacks it. Known limits (heuristics, documented rather than
grown into more patterns): it recognises a modal root only by React Native's `Modal` imported in that
file, and the "inside" check reads the first JSX element with `accessibilityViewIsModal` in the same
file; a third-party modal component (a bottom-sheet library) is not recognised, so render the marker in
it by hand.

**Modal routes.** An Expo Router route presented modally (native-stack `presentation` `modal`,
`formSheet` or `transparentModal`; navigation-and-routing's contract `modals`) is drawn outside the
view `ParityFrameRoot` wraps, and on iOS a presented sheet can confine the accessibility tree the way
`Modal` does. A frame whose route is presented modally renders `<ParityLaunchMarker />` in its screen
root. check-harness.mjs does not read `modals` (not yet measured on a device: unverified).

## Probe launches

For a frame with `probe` the launch carries `probe=<region>`: the frame state stays closed, the
switches store's canvas probe is on (`isCanvasProbeOn`), and the component that draws the region
publishes its rectangle as the label of an accessible element: by default `parity.probe.<region>` with
`{"x","y","width","height"}` in window points (from `measureInWindow`). skia-canvas-rendering's layout
probe already publishes `<prefix>.canvas-layout` as `{"x","y","layout":{"width","height",...}}`, which
capture-app.mjs reads as it is: name it in the contract (`"probe": { "region": "map", "testID":
"map.canvas-layout" }`). A map view without such a probe gets a two-line wrapper. Off by default, so no
screenshot ever shows it.

## Wiring it in (and keeping it out of production)

1. Copy the templates to the paths their first lines name, and `templates/design/parity/fixture.json`
   to the references folder (the harness's `parity-fixture.json` is its exact copy, `harness-fixture`).
2. Add `src/features/parity/` to `contracts/architecture.json` `testOnlyFolders`
   (`harness-test-only-folder`).
3. Add the app's launch screen (examples/parity-launch-screen.tsx: it builds the appliers and renders
   `ParityLaunchRoot`) in a test-only folder, and export it and `createParityKit` from
   `src/test-only-entry.ts` (examples/test-only-entry-additions.ts; `harness-not-exported`).
4. Add the launch route `src/app/(debug)/debug/parity.tsx` (examples/parity-route.tsx): it renders
   `TEST_ONLY?.ParityLaunchScreen` with `useLocalSearchParams()` and redirects home in production,
   inside the `(debug)` group's `Stack.Protected` (`harness-route`). Hrefs stay typed: the plans'
   `href` and every `navigate` callback are expo-router's `Href`, so the route calls
   `router.replace(href)` with no `as Href` cast (navigation-and-routing's `href-cast`). Register the
   route with its owners: `(debug)/debug/parity` in `contracts/navigation.json` `routes` and
   `debugRoutes` (navigation-and-routing's `route-table`), and in `contracts/screens.json`
   `ignoredRoutes` with its why, "test-only parity launch route; renders no screen of its own"
   (screen-contracts' `screen-unlisted`).
5. Register the parity kit (`templates/src/features/parity/parity-root-kit.tsx`) in the app's root-kit
   registry among the test build's kits (examples/create-root-kits-parity.ts; `harness-not-wired`):
   `const createParityKit = TEST_ONLY?.createParityKit;` then `createParityKit()` in the list
   `createRootKits` returns. The canonical root skeleton (app-startup-and-bootstrap) stays unchanged:
   its `provide` slot wraps the Stack in `ParityFrameRoot`, and its `effects` slot mounts
   `ParityLaunchBridge` beside the Stack, inside the navigator, with `router.replace`; a production
   build has no `TEST_ONLY`, so no kit and none of the harness. The bridge waits for
   the navigation container to report ready before it calls `router.replace`: expo-router throws
   "Attempted to navigate before mounting the Root Layout component" until then, and in an app whose
   root renders the stack on its first render the bridge's mount effect runs first (verified in Jest
   with a stand-in readiness; expo-router 57 source read for the throw).
6. Open each planned state in its model (`useFrameStateOpener`), pass `useFrameScrollTarget()` to tall
   frames' ScreenBody, render the marker in every modal root (the shared ones above included).
7. Add `.parity/` to `.gitignore` (`harness-gitignore`) and the gated parity files to quality-gates.json
   `gatedPaths` one by one (`gated-paths`): `design/parity/waivers.json`, `design/parity/<device>/**`
   for each device (the references), `design/parity/manifest.json`, `design/parity/fixture.json`,
   `design/parity/mockup/**` and `design/parity/devices/**`. Never `design/parity/**`: that also gates
   the sign-off ledger, which changes on every sign-off and records looks, not tolerances.
8. Prove the strip: a production export must not contain the harness (app-variants-and-environment's
   bundle check after a development and a production export made back to back).

## testIDs the screens must carry

- The contract is the screen contract: every element of every frame, its testID, role, component, copy
  key, reach and checks. Build the screen with exactly those testIDs (screen-contracts' `list-screen.mjs`
  prints them).
- Put the testID on the **accessible element** (the Pressable, the switch, the image), never only on its
  inner Text: Maestro does not list the children of accessible elements, so an inner testID is
  `missing`. Where the design measures a row, the testID goes on the row View, which hugs its content.
- **Reach policy (one rule for screen readers and parity).** Bounds are checked only for elements
  Maestro lists: the frame root, containers, texts and accessible elements. Parts inside an accessible
  element (`parent`) and decorative parts hidden from screen readers (`a11yHidden`) are crop-only:
  `checks` is `["crop"]` and `coveredBy` names the nearest reachable ancestor whose aligned crop is
  compared. They are never paired with the hierarchy and never `missing`. check-mockup.mjs proves the
  policy (`element-reach`, `element-cover`). Never un-hide a decorative part to measure it: screen
  readers come first.
- The root testID of each frame goes on the outer View of that screen, state or dialog; capture-app.mjs
  and check-parity.mjs prove the right frame is on screen by it.
- The accessibility label is how the text gate reads a text: a Text's label is its text; an icon
  button's label is its copy key's string. Do not add labels that differ from the visible text.
- Bounds are layout frames: anything that stays moved must move by layout, never by a transform.

## Three traps

- **A state that carries over.** A store that keeps a value unless something clears it (an
  entitlement kept until revoked, a dismissed banner) leaves every later frame in that state. Write the
  frame's data on every launch (the data applier replaces, never merges), and run a launch of a
  "special" frame followed by a normal one in a test.
- **Switches that carry over.** Test-build switches persist across launches by design (E2E flows rely
  on it). A parity launch sets all of them, every time (step 3 above).
- **The scroll that stops short.** Above, "Tall frames and the scroll offset".

## Appendix: React Navigation

With React Navigation 7 (static API) instead of Expo Router: register the launch screen in the root
navigator only in test builds (`TEST_ONLY ? { ParityLaunch: ... } : {}`), add `debug/parity` to the
`linking` config so the Android link opens it, and let `ParityLaunchBridge` call
`navigation.navigate('ParityLaunch', paramsFromQuery(query))` on iOS. `navigate` in `ParityLaunchRoot`
becomes `navigation.reset({ index: 0, routes: [{ name: plan.route }] })`, so Back never returns to the
launch. Everything else is unchanged.
