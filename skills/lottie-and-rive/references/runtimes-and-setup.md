# Runtimes and setup

Which runtime plays which moment, the versions verified for Expo SDK 57, how each is installed and
bundled, and the exact play, pause and still APIs the templates use. Read it before adding the first
Lottie or Rive file, and whenever a version or an API is in doubt.

## Contents

- Choosing: Reanimated, Lottie or Rive
- Verified facts (dated, with re-verify commands)
- Installing Lottie
- Installing Rive
- Bundling the files (Metro)
- Lottie API used by the templates
- Rive API used by the templates
- Neither runtime reads Reduce Motion
- What is not verified

## Choosing: Reanimated, Lottie or Rive

| The moment | Tool | Why |
|---|---|---|
| A press, a sheet, a list row entering, a progress fill, a screen push, a burst of a few pieces | Reanimated (motion-and-animation) | It is already in the app, runs on the UI thread, follows `MotionConfig`, and needs no file |
| A designer-made illustration that plays once or loops briefly: a "list completed" celebration, an onboarding hero, a success tick drawn by hand | Lottie (`lottie-react-native`) | After Effects (Bodymovin) and LottieFiles export it; a JSON file plays the same on iOS and Android |
| Art that reacts: an empty-state mascot that looks at a touch, a toggle with character, a state that follows app data | Rive (`@rive-app/react-native`) | A state machine with inputs and data binding; one file holds every state |

Ask first whether Reanimated can do it with the app's tokens; a file is a dependency, a budget and a
licence to keep. Never play one moment with two runtimes, and never add a third runtime: a DOM
player (`lottie-web`, `react-lottie`, `@rive-app/react-canvas`), the legacy `rive-react-native`, or
a second Lottie player (`@lottiefiles/dotlottie-react-native`) is `unapproved-runtime`. The list
lives in `assets/runtimes.json`.

## Verified facts (dated, with re-verify commands)

| Fact | Verified | Re-verify |
|---|---|---|
| `npx expo install lottie-react-native` resolves `~7.3.8` on Expo SDK 57 (expo 57.0.27's `bundledNativeModules.json`); 7.3.8 was published 2026-05-14 | 2026-10-21 | `grep lottie node_modules/expo/bundledNativeModules.json` |
| npm `latest` of lottie-react-native is 7.5.0 (2026-08-22, peer `react-native >=0.84`, `react >=19.2`), `next` is 8.0.0-rc.0; Expo's SDK 58 map moves to `~7.5.0` (expo-sdk-upgrade's next map) | 2026-10-21 | `npm view lottie-react-native version dist-tags peerDependencies --json` |
| lottie-react-native 7.3.8 ships a codegen (Fabric) native component (`codegenConfig` in its package.json) and no `app.plugin.js`: autolinking only, no config plugin | 2026-10-21, read in the package | `ls node_modules/lottie-react-native; grep -A8 codegenConfig node_modules/lottie-react-native/package.json` |
| The Expo docs page for Lottie (`docs.expo.dev/versions/latest/sdk/lottie/`) answers 404; Expo's version map is the source for the version | 2026-10-21 | `curl -s -o /dev/null -w "%{http_code}" https://docs.expo.dev/versions/latest/sdk/lottie/` |
| The current Rive package is `@rive-app/react-native` (repo rive-app/rive-nitro-react-native, "Rive React Native 2.0"); Rive's React Native docs call it the recommended runtime that replaces the legacy `rive-react-native` ("still supported", 9.8.6 published 2026-10-15, not deprecated on npm) | 2026-10-21 | `npm view @rive-app/react-native version time --json; npm view rive-react-native version deprecated` |
| `@rive-app/react-native` 0.5.5 (2026-10-13) is `latest`; it peers `react-native-nitro-modules >=0.35.10 <0.37`, while Nitro's `latest` is 0.37.1, so pin Nitro 0.36.5 | 2026-10-21 | `npm view @rive-app/react-native peerDependencies --json; npm view react-native-nitro-modules version` |
| Rive's README requires React Native 0.78+, Expo SDK 53+, iOS 15.1+, Android SDK 24+, Xcode 16.4+; it lists no config plugin (an optional inline plugin only pins the native SDK versions) | 2026-10-21, README of 0.5.5 | `sed -n 1,140p node_modules/@rive-app/react-native/README.md` |
| `RiveView` is a Nitro HybridView; Nitro views need the New Architecture and React Native 0.78+ (nitro.margelo.com, View components) | 2026-10-21 | read `node_modules/@rive-app/react-native/src/core/NitroRiveViewComponent.ts` and the Nitro docs page |
| Expo SDK 57's default Metro `assetExts` (`@expo/metro-config` 57.0.13) include neither `riv` nor `lottie`; `json` is a source extension | 2026-10-21, run in the reference app | `node -e "const c=require('expo/metro-config').getDefaultConfig(process.cwd());console.log(c.resolver.assetExts.includes('riv'))"` |

When a fact here and the installed package disagree, the package wins: re-run the command, update
this table with the new date, and re-run the self-test.

## Installing Lottie

```sh
npx expo install lottie-react-native
```

Expo writes `~7.3.8` on SDK 57 (dependency-management keeps the `~` for SDK-mapped packages). There
is no config plugin; the native view arrives through autolinking on the next development build
(`npx expo prebuild` or an EAS build). A `.lottie` (dotLottie) file also needs the Metro kit below.

## Installing Rive

```sh
npm install --save-exact @rive-app/react-native@0.5.5 react-native-nitro-modules@0.36.5
```

Neither package is in Expo's module map, so they are exact pins (dependency-management's policy and
its 7-day release age: 0.5.5 is 8 days old on 2026-10-21). Rive needs a development build; it never
runs in Expo Go. Without `react-native-nitro-modules` the native build fails, which check-animations
reports as `unapproved-runtime`.

Export every `.riv` with its fonts and images embedded. On the legacy backend, referenced ("hosted")
assets are fetched from Rive's CDN (`loadCdn` defaults to true, read in `src/core/RiveFile.ts` of
0.5.5); on the new backend the flag is ignored and referenced assets must be supplied with
`referencedAssets`. Either way an embedded file is the only one that works offline.

## Bundling the files (Metro)

Animation files live in `assets/animations/` and are required through the `@/assets/*` alias:
`require('@/assets/animations/list-completed.json')`, `require('@/assets/animations/empty-tasks-mascot.riv')`
(architecture-and-boundaries owns the alias and the asset folders). Lottie `.json` needs nothing
from Metro. `.riv` and `.lottie` need `resolver.assetExts`: copy
`templates/scripts/metro/animation-assets-kit.ts` (and its test) to `scripts/metro/` and list
`ANIMATION_ASSETS_KIT` in the app's `scripts/metro/metro-kits.ts` `METRO_KITS` (the Metro slot that
app-variants-and-environment owns; a kit never edits `metro.config.js`). Restart Metro with
`npx expo start --clear` after the change.

## Lottie API used by the templates

Read from lottie-react-native 7.3.8's types (`lib/typescript/types.d.ts`, `LottieView/index.d.ts`):

- `source`: `string | AnimationObject | { uri: string }`. The app passes only the `AnimationObject`
  a `require()` of a bundled `.json` returns; `{ uri }` is the remote form (`remote-animation-source`).
- `autoPlay`, `loop` (true unless set: the templates always pass `loop={false}`), `progress` (0 to 1;
  with `autoPlay={false}` it shows that frame), `speed`, `resizeMode`, `renderMode`, `cacheComposition`,
  `hardwareAccelerationAndroid`.
- `onAnimationFinish(isCancelled)`, `onAnimationFailure(error)`, `onAnimationLoaded()`, `onAnimationLoop()`.
- Ref methods: `play(startFrame?, endFrame?)`, `pause()`, `resume()`, `reset()`.

`LottiePlayer` plays with `autoPlay` and `loop={false}`, counts `onAnimationFinish(false)` and calls
`play()` until `plays` is used, then rests on the end frame. Still, it renders a separate view
(`key="still"`) with `autoPlay={false}` and `progress`.

## Rive API used by the templates

Read from @rive-app/react-native 0.5.5's source (`src/core/RiveView.tsx`, `src/specs/RiveView.nitro.ts`,
`src/hooks/useRive.ts`, `src/hooks/useRiveFile.ts`):

- `useRiveFile(input)` with `input` a Metro asset number (`require()` of a `.riv`), `{ uri }`, a
  resource name or an `ArrayBuffer`; an `http(s)` string or uri loads from the network. It returns
  `{ riveFile, isLoading, error }`.
- `<RiveView file stateMachineName artboardName autoPlay fit alignment frameRate dataBind semantics onError hybridRef />`.
  `autoPlay` defaults to true. `frameRate` caps the render loop (new runtime only).
- `useRive()` returns `{ riveRef, riveViewRef, setHybridRef }`; pass `hybridRef={setHybridRef}` and
  call `riveViewRef.play()` / `riveViewRef.pause()` (both return promises) once `riveViewRef` is set.
- `reset()` is deprecated (a no-op on the new runtime). State machine inputs, text runs and events
  (`setNumberInputValue`, `triggerInput`, `onEventListener`, ...) are deprecated and throw: drive a
  state machine with data binding (`useViewModelInstance`, `useRiveNumber`, `useRiveTrigger`, ...).

`RivePlayer` loads the file, renders `RiveView` with `autoPlay` while playing, and calls `pause()`
when the moment turns still, so the state machine rests where it is (its first frame when it never
started).

## Neither runtime reads Reduce Motion

Neither package has a reduce-motion prop or reads the system setting (read in both packages'
sources on 2026-10-21), and Reanimated's `MotionConfig` does not reach native views. So the app's one
reduce-motion answer, accessibility-as-code's `useReduceMotion()`, is read by `AnimationMoment`,
which hands `playback: 'still'` to the player. A test build with motion held still
(debug-menu-and-test-hooks' `motion=still`) passes preference `'on'` into `MotionConfig`, so the same
read covers test mode; there is no second switch.

## What is not verified

- Device behaviour of a Rive view with `autoPlay={false}` (that it draws its first frame) was read
  from source, not watched on a device; confirm it on a named iOS simulator and a named Android
  emulator in the device pass.
- Whether Expo Go ships lottie-react-native was not checked; the skill assumes a development build.
- Frame-time cost per file was not measured; performance-budgets' device report is the evidence.
