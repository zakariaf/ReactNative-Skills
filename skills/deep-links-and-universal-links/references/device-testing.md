# Testing links on simulators, emulators and in E2E flows

Jest proves the gate and the router's handling (link-routing.md, section 9). A device proves what Jest
cannot: that the OS hands the link to this app at all (scheme registered, entitlement signed, domain
verified) and that a cold start and a warm start both land right. This library verified the gate in Jest
inside the real router (expo-router 57.0.24, 2026-10-14); the commands below come from Apple's simctl help,
Android's App Links guides and Maestro's `openLink` page, and were not driven on a device for this skill.

## Contents

1. Always name the device
2. Cold and warm, by hand
3. Verified links on devices
4. E2E flows (Maestro)
5. Expo Go and development builds

## 1. Always name the device

Several sessions share one machine, so every command names its device: a simulator by UDID (never
`booted`), an emulator by serial (`adb -s emulator-5554`), Maestro with `--device <id>`. Create a dedicated
simulator or AVD named `<project>-links` (ios-simulator-build and android-emulator-build own creating and
naming them). `npx uri-scheme open` targets whatever simulator is booted: use the explicit commands below
when more than one runs.

## 2. Cold and warm, by hand

| | iOS simulator | Android emulator |
|---|---|---|
| Cold | `xcrun simctl terminate <udid> <bundleId>` then `xcrun simctl openurl <udid> "tasks://tasks/task-7"` | `adb -s <serial> shell am force-stop <package>` then `adb -s <serial> shell am start -W -a android.intent.action.VIEW -d "tasks://tasks/task-7" <package>` |
| Warm | `xcrun simctl launch <udid> <bundleId>`, go somewhere, then the same `openurl` | `adb -s <serial> shell monkey -p <package> 1` (or open the app), then the same `am start` |

What to look for, each time:

- An allow-listed link opens its screen; Back leads to a screen of the app (the anchor or the screen the
  person was on), never out of the app.
- A refused link: cold start shows the first screen, warm start leaves the current screen as it was (type
  into a form first, then send a refused link: the text must survive).
- A gated link while signed out: the sign-in screen, then after signing in the linked screen, once.
- The same link twice in a row (warm) opens the screen twice only if that is what a push does; no crash.

iOS asks "Open in "<App>"?" the first time a custom scheme is opened from outside the app on a simulator;
accepting is remembered for that simulator, even after clearing app state (Maestro's docs). Accept it once
by hand, or handle it in the flow (section 4).

## 3. Verified links on devices

- **iOS.** The build must carry the `applinks` entitlement (EAS syncs the capability; a local signed build
  needs it on the App ID). Paste the link in Notes and long-press it, or open it from another app (not the
  Safari address bar: direct navigation stays in the browser). Settings > Developer > Universal Links >
  Diagnostics checks one URL on a device with Developer Mode on. Verified on the simulator by this library:
  not yet.
- **Android.** Install, wait 20 seconds or more, then `adb -s <serial> shell pm get-app-links <package>`
  must say `verified` for each host. Then
  `adb -s <serial> shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://tasks.example.com/tasks/task-7"`
  (without the package: the system must pick the app by itself). An emulator image without Google services
  cannot verify.

## 4. E2E flows (Maestro)

e2e-maestro owns `.maestro/` conventions, the pinned Maestro and the runner; this is the link part.
`examples/maestro-deep-links.yaml` is the canonical flow; its steps, verbatim:

```yaml
appId: ${APP_ID}
---
# Cold start: the link launches the stopped app and opens the task.
- stopApp
- openLink: ${APP_SCHEME}://tasks/task-7
# iOS asks once per simulator before a custom scheme opens an app from outside.
- runFlow:
    when:
      visible: 'Open in "${APP_NAME}"'
    commands:
      - tapOn: Open
- assertVisible:
    id: task-detail.screen
# Warm start, refused link: the current screen stays as it is. A relaunch, not `back`, returns to the
# list: Maestro's back command runs on Android and Web only (docs.maestro.dev, checked 2026-10-14).
- stopApp
- launchApp
- assertVisible:
    id: tasks.screen
- openLink: ${APP_SCHEME}://settings/delete-account
- assertVisible:
    id: tasks.screen
# Android verified link: autoVerify skips the chooser (Android only; iOS ignores it).
- runFlow:
    when:
      platform: Android
    commands:
      - openLink:
          link: https://preview.tasks.example.com/tasks/task-7
          autoVerify: true
      - assertVisible:
          id: task-detail.screen
```

- Run it with the device named: `maestro --device <udid-or-serial> test .maestro/flows/deep-links.yaml -e APP_ID=... -e APP_SCHEME=...`.
- Android verified links: `openLink: { link: https://preview.tasks.example.com/tasks/task-7, autoVerify: true }`
  skips the chooser (Android only).
- Assert by testID (screen-contracts), never by text.
- The debug link (`${APP_SCHEME}://debug/setup?...`) sets state for other flows; it exists only in test
  builds (debug-menu-and-test-hooks).

## 5. Expo Go and development builds

Expo Go answers `exp://` links only, with the path after `/--/` (`exp://127.0.0.1:8081/--/tasks/task-7`);
the app's scheme, universal links and App Links need a development build with the app's own config. The
development variant has its own scheme (`<scheme>-dev`), so a link for the store app never opens the
development build. With the gate in place, Expo Go refuses every link: an `exp://` URL carries a port and a scheme the
app does not register, so it lands on the first screen whatever its path. Test links only in a
development or preview build.
