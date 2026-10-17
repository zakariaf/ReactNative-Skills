# Platforms: orientation, tablets, resizing, foldables and insets

What iOS and Android do to an app's window, what the Expo config writes, and why the app must lay
out for every shape whatever it asks for. Verified on 2026-10-10: Expo SDK 57 config plugins read in
the installed `@expo/config-plugins`, the reference app's generated native config, Apple's TN3192
(revised 2026-08-13) and Android 16's behaviour changes page.

## Contents

1. The app config keys
2. iOS and iPadOS
3. Android
4. Foldables
5. Per-screen orientation locks
6. Device orientation versus window shape
7. Insets that change with the window
8. Profiles: a landscape app, an app without an iPad layout
9. Re-verify commands

## 1. The app config keys

| Key | Default | What prebuild writes | This library's default |
|---|---|---|---|
| `orientation` | no lock | iOS `UISupportedInterfaceOrientations` (phones); Android `screenOrientation` on the main activity (`default` becomes `unspecified`) | `'portrait'` (the Expo template's) or `'default'` |
| `ios.supportsTablet` | `false` | `UIDeviceFamily` with iPad | `true` |
| `ios.isTabletOnly` | `false` | iPad only | as the product needs |
| `ios.requireFullScreen` | `false` | `UIRequiresFullScreen` | never `true` |

With `supportsTablet: true` and no `requireFullScreen`, prebuild also writes
`UISupportedInterfaceOrientations~ipad` with all four orientations, whatever `orientation` says. The
reference app (`orientation: 'portrait'`, `supportsTablet: true`) generates exactly this:

```
UIRequiresFullScreen: false
UISupportedInterfaceOrientations: Portrait, PortraitUpsideDown           (iPhone)
UISupportedInterfaceOrientations~ipad: Portrait, PortraitUpsideDown, LandscapeLeft, LandscapeRight
Android main activity: screenOrientation=portrait,
  configChanges=keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|locale|layoutDirection
```

So `orientation: 'portrait'` is a **phone-only** lock in practice: iPads rotate and multitask, and
large Android displays ignore it (section 3). The checker's `config-orientation` accepts `portrait`
and `default`; `landscape` needs the contract's `appOrientation: 'landscape'` (section 8).

## 2. iOS and iPadOS

- **iPad multitasking resizes the app at any time:** Split View, Slide Over, Stage Manager and, from
  iPadOS 26, freely resizable windows. A window can be as narrow as about 320 pt and portrait-shaped
  on a landscape iPad. React Native reports each change through `useWindowDimensions`.
- **`UIRequiresFullScreen` is on its way out.** Apple's TN3192: deprecated starting in iPadOS 26 and
  "will be ignored in a future release"; starting in iOS 27 and iPadOS 27, an app built with the iOS
  27 SDK that sets it is resized anyway (discretely: the scene changes size when the drag ends). To
  support resizable scenes an app provides a launch screen (required for App Store submission from
  iOS 27 / iPadOS 27; expo-splash-screen generates one), supports all orientations, and drops the key.
  The checker fails `requireFullScreen: true` and any `UIRequiresFullScreen` (`full-screen-opt-out`).
- **Keeping full screen on older iOS only.** TN3192's migration path: an app that still needs the
  compatibility mode on, say, iOS 18 keeps the key and adds
  `UIRequiresFullScreenIgnoredStartingWithVersion` (`ios.infoPlist`, value `'26'`), so the system
  ignores the key from iPadOS 26 on (any version of 27 or lower works the same way from that
  version). The checker accepts `requireFullScreen`/`UIRequiresFullScreen` when that key sits in the
  same config; the layout must still adapt, because every current iPad resizes the app. A key set to
  its resizable value (`UIRequiresFullScreen: false`) is reported as redundant: drop it.
- **App Store validation:** an iPad app that does not require full screen must list all four iPad
  orientations (ITMS-90474); prebuild's `withRequiresFullScreen` writes them for you (section 1).
- **`supportsTablet: false`** makes the app iPhone-only: on an iPad it runs in a scaled phone-sized
  compatibility frame, and the App Store lists it as an iPhone app. The checker's `tablet-support`
  fails it unless the contract says `tablets: false` with a reason.
- **iPhone landscape:** a regular-width window (874 × 402 on a current iPhone) with 62 pt side insets
  for the Dynamic Island and its mirror, and a 21 pt home-indicator inset at the bottom. Phones honour
  `orientation: 'portrait'`, so a portrait-locked app never sees it on a phone, but its iPad and
  Android tablet builds do.
- Not verified here: iOS 27 window resizing on iPhone. TN3192 says "Prior to iOS 27, this key-value
  pair configures iPadOS apps only, and is ignored for iOS apps"; it does not say more. Treat an
  iPhone window change as possible and keep layouts window-driven.

## 3. Android

- **Android 16 (API 36) on displays 600 dp and wider** (smallest width): for apps targeting API 36,
  as Expo SDK 57 apps do, the system ignores `screenOrientation`, `resizableActivity`,
  `minAspectRatio`, `maxAspectRatio`, `setRequestedOrientation()` and `getRequestedOrientation()`, in
  full screen and in multi-window. The app fills the window; there is no letterboxing. Exceptions:
  games (`android:appCategory`), a person who opts the app back into its own behaviour in the device's
  aspect-ratio settings, and displays narrower than 600 dp.
- **The opt-out is temporary:** `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` on the
  activity or application keeps the old behaviour for API 36 only, and stops working when the app
  targets API 37. The checker fails it with the other opt-outs (`full-screen-opt-out`).
- **Multi-window and freeform/desktop windows** resize the app on phones and tablets; split screen
  can give a phone app a window of a few hundred dp.
- **No activity restart on resize.** Expo's manifest lists `orientation|screenSize|screenLayout|
  smallestScreenSize` in `configChanges`, so a rotation, a fold or a window resize keeps the React
  tree alive and only `useWindowDimensions` changes. A config plugin that trims `configChanges` would
  restart the activity on every resize and lose in-memory state; review any plugin that touches it.
- **Edge to edge everywhere:** Expo apps (SDK 54 and later) draw edge to edge on every Android
  version, and Android 16 removes the OS opt-out. In landscape the three-button navigation bar sits on
  a side and arrives as a side inset; display cutouts can be on any edge.
- Not verified on a device in this library: Android 16 large-screen behaviour was read from the
  platform documentation; check on a named tablet emulator (AVD `<project>-tablet`) and a foldable
  emulator before a release.

## 4. Foldables

- Opening a book-style foldable turns a compact cover screen into a near-square regular window while
  the app runs; closing it does the reverse. The window
  class and the pane layout follow, the activity is not restarted (section 3), and the selection
  survives because it is the route's.
- React Native has no API for the hinge or the fold posture (Jetpack WindowManager's `FoldingFeature`
  needs a native module). The base layout does not depend on it: the window-driven two-pane layout
  already works on an open foldable. Aligning the pane split to a vertical hinge or a tabletop posture
  is a progressive enhancement behind a port in `src/services/`, never a requirement.
- Do not put a control across the middle of a book-style foldable's window in a layout that only
  exists there; with two panes, the split sits near the middle anyway.

## 5. Per-screen orientation locks

Some screens legitimately prefer one orientation while they run: camera capture, a full-screen video,
a signature pad. Two ways, both listed in `contracts/adaptive-layout.json` `orientationLocks` with the
reason (`orientation-lock` fails any lock outside the list):

- **A Stack screen option** (react-native-screens): `<Stack.Screen options={{ orientation:
  'portrait_up' }} />`. The navigator restores the orientation when the screen leaves. `'default'`
  and `'all'` lock nothing, and the checker lets them through.
- **expo-screen-orientation** (`~57.0.2` in the SDK 57 module map; `npx expo install
  expo-screen-orientation`): `lockAsync(OrientationLock.PORTRAIT_UP)` in an effect whose cleanup calls
  `unlockAsync()` (`orientation-unlock` fails a lock without an unlock). Its config plugin has one
  option, `initialOrientation` (iOS only): `DEFAULT`, `ALL`, `PORTRAIT`, `PORTRAIT_UP`,
  `PORTRAIT_DOWN`, `LANDSCAPE`, `LANDSCAPE_LEFT` or `LANDSCAPE_RIGHT`, written to the Info.plist key
  `EXDefaultScreenOrientationMask` (read in expo-screen-orientation 57.0.2's
  `plugin/build/withScreenOrientation.js`, 2026-10-10). Anything but `DEFAULT` or `ALL` is an app-wide
  launch lock, so `config-orientation` fails it unless the contract's `appOrientation` names the same
  family (`portrait` for `PORTRAIT*`, `landscape` for `LANDSCAPE*`).

Every lock is a preference. iPads with multitasking ignore it unless the app requires full screen
(deprecated, section 2), Android displays 600 dp and wider ignore it (section 3), and on phones it
overrides the person's rotation setting. So a locked screen still lays out for both shapes.

## 6. Device orientation versus window shape

`ScreenOrientation.addOrientationChangeListener` and `getOrientationAsync` report how the **device**
is held. An iPad in landscape running the app in a third of the screen gives a tall, narrow window: the
device is landscape, the window is portrait. Layout reads `useWindowClass().isLandscape` (width >
height of the window). The checker's `device-orientation` rule fails the device APIs outside the
`orientationLocks` files, where a camera may need them to rotate a capture.

## 7. Insets that change with the window

- Rotation moves the notch or cutout to a side: `insets.left`/`insets.right` become non-zero in
  landscape. They stay **physical** (the cutout does not mirror in RTL): take both sides or let
  `SafeAreaView` edges apply them (react-components-and-hooks' `inset-direction`).
- The pane layout never counts the notch side as usable: `ListDetailLayout` measures its box inside
  the screen's `SafeAreaView` (left and right edges on), and before the first layout
  `useListDetailLayout` takes `useSafeAreaInsets()`' side insets off the window. A landscape phone at
  the edge of the two-pane width gets one pane rather than a detail pane hidden under the notch.
- `useSafeAreaInsets()` needs a `SafeAreaProvider` above it; Expo Router mounts one at its root. In
  Jest, wrap the subject in `<SafeAreaProvider initialMetrics={{ frame, insets }}>` (it renders nothing
  without metrics).
- The keyboard is not a layout class: forms-and-input owns keyboard avoidance.

## 8. Profiles: a landscape app, an app without an iPad layout

- **Landscape-only app** (a game board, a kiosk): set `orientation: 'landscape'` and
  `"appOrientation": "landscape"` in the contract. Phones honour it; tablets still resize, so layout
  stays window-driven. Games declare `android:appCategory="game"` through their own config, which also
  keeps Android 16's large-screen override away (games plugin skills own that).
- **No iPad layout yet:** `supportsTablet: false` with `"tablets": false` and `"tabletsReason"`. The
  iPad then shows the phone app scaled; Android tablets still run the app full size, so the phone
  layout must at least cap its width (`readable-width`).

## 9. Re-verify commands

Run inside an app with the canonical stack installed:

```sh
sed -n 1,60p node_modules/@expo/config-plugins/build/ios/Orientation.js         # orientation -> UISupportedInterfaceOrientations
grep -n "ipad\|UIRequiresFullScreen" node_modules/@expo/config-plugins/build/ios/RequiresFullScreen.js
sed -n 1,40p node_modules/@expo/config-plugins/build/android/Orientation.js     # screenOrientation on the main activity
grep -n -A3 "orientation?:\|supportsTablet?:\|requireFullScreen?:" node_modules/@expo/config-types/build/ExpoConfig.d.ts
APP_VARIANT=production npx expo config --type introspect | grep -n -A6 "UISupportedInterfaceOrientations\|screenOrientation"
```

Web pages (re-read when a new iOS or Android SDK lands): Apple TN3192 "Migrating your iPad app from
the deprecated UIRequiresFullScreen key"; Android "Behavior changes: Apps targeting Android 16 or
higher", section "Large screens and adaptive layouts".
