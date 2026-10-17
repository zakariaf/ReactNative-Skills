# Testing permissions

Every outcome of every ask is a Jest test against the scripted fake; the device layers (simulator,
emulator, Maestro) prove the native config and the real dialogs. Commands verified on 2026-10-14
(`xcrun simctl help privacy` on Xcode 26.6; Maestro's permissions page; Android's `pm` help). Devices
are always named: a UDID for `simctl`, `-s <serial>` for `adb`, `--device <id>` for Maestro.

## Contents

1. The test matrix
2. Unit and hook tests with the fake
3. Model tests: one per outcome
4. Resetting and setting permissions on a simulator
5. Resetting and setting permissions on an emulator
6. Maestro flows
7. A manual pass before release

## 1. The test matrix

For each permission in `contracts/permissions.json`, the asking model's test covers:

| Outcome | Fake script | Expect |
|---|---|---|
| granted | `{ platform: 'ios', state: 'granted' }` | the action runs, no dialog |
| allowed in the dialog | `{ platform: 'ios', answers: ['allow'] }` | one dialog, then the action |
| limited | `{ platform: 'ios', answers: ['allow-limited'] }` | the action runs with partial access |
| declined (iOS) | `{ platform: 'ios', answers: ['deny'] }` | `blocked`, no sheet, no action |
| declined once (Android) | `{ platform: 'android', answers: ['deny'] }` | `denied`, no sheet; the next press shows `rationale` |
| rationale, then allow | `{ platform: 'android', state: 'denied', answers: ['allow'] }` | `rationale` → Continue → one dialog → the action |
| rationale, No thanks | `{ platform: 'android', state: 'denied' }` | no dialog, no action |
| blocked | `{ platform: 'android', state: 'blocked' }` | `settings` sheet → `openSettings` once, no dialog |
| first dialog dismissed (Android) | `{ platform: 'android', answers: ['dismiss'] }` | `blocked` at once (Expo's early block), no sheet; the next press shows `settings` |
| unavailable | `{ platform: 'ios', state: 'unavailable' }` | control hidden or `unavailable` sheet, no dialog |
| changed in Settings | `access.setState('granted')` + a foreground event | the shown state follows |

`check-permissions` (`asked-from`) requires at least a refusal (`denied` or `declined`) and a block
(`blocked`) in the asking model's test; the rest is this skill's definition of done.

## 2. Unit and hook tests with the fake

- `createFakePermissionAccess(script)` follows the dialog rules: iOS one dialog (a refusal is
  `blocked`), Android two (`denied`, then `blocked`), no dialog while allowed, blocked or unavailable,
  `dismiss` (Android) follows Expo: `blocked` after dismissing the very first dialog (platform-behaviour
  section 2), unchanged `denied` after dismissing the second. `dialogs()` counts dialogs; `setState` is a change in Settings.
- `createFakePermissions({ camera })` is the whole port; `settingsOpened()` counts trips to Settings.
- Hook tests render through `renderHookWithProviders` (unit-and-component-tests) and press inside
  `act(async () => { ...; await Promise.resolve(); })`, so the read and the dialog settle before the
  assertions.
- The status mirror takes a scripted foreground source (`watchActive`); its tests settle reads out of
  order with deferred promises to prove latest-wins.
- Adapters: the generic mapping is tested with plain response objects (`toPermissionState`); a
  per-permission adapter that only binds a module's functions carries the `// device-only:` marker
  naming the tests and the E2E flow that cover it. When an adapter does more, test it with
  `jest.mock('<module>')` and a typed `jest.requireMock` over a root mock in `__mocks__/`.
- Android-only behaviour in a model (a different sheet) goes in `<unit>.android.test.ts(x)`, never by
  overwriting `Platform.OS`.

## 3. Model tests: one per outcome

The example `use-task-photo-model.test.tsx` is the shape: one `mountModel(script)` helper, one press
helper, then one test per row of the matrix. Assert what the person sees (the sheet, the state
flags, whether the camera opened), never the gate's internals.

## 4. Resetting and setting permissions on a simulator

```sh
xcrun simctl privacy <udid> reset all <bundle-id>          # every service back to "ask next time"
xcrun simctl privacy <udid> grant photos <bundle-id>       # services: calendar, contacts(-limited),
xcrun simctl privacy <udid> revoke location <bundle-id>    #   location(-always), photos(-add), media-library,
                                                           #   microphone, motion, reminders, siri
xcrun simctl uninstall <udid> <bundle-id>                  # forget everything, including notifications
```

"Some permission changes will terminate the application if running" (simctl's own help). Camera is
not a `simctl privacy` service and a simulator has no camera: prove the camera ask with the fake and
on a device. Notifications are reset only by uninstalling.

## 5. Resetting and setting permissions on an emulator

```sh
adb -s <serial> shell pm grant <package> android.permission.CAMERA
adb -s <serial> shell pm revoke <package> android.permission.CAMERA      # kills the app's process
adb -s <serial> shell pm clear-permission-flags <package> android.permission.CAMERA user-set user-fixed
adb -s <serial> shell pm clear <package>                                 # app data, Expo's asked/blocked cache too
```

`clear-permission-flags` is a `pm` subcommand of recent Android releases (not verified on this
machine's emulator image; `pm help` lists what yours has). `user-fixed` is Android's "don't ask again" flag ("Permissions that have been denied permanently by
selecting Deny twice are flagged by USER_FIXED"); clearing it lets the dialog appear again, but Expo
still remembers "blocked" in the app's data until `pm clear` or a reinstall. Never use
`pm reset-permissions`: it resets every app on the device.

## 6. Maestro flows

Maestro grants every permission at launch unless told otherwise ("By default, all permissions are
allowed"), so a flow that never sees a sheet proves nothing about asking:

```yaml
# .maestro/flows/task-photo-blocked.yaml
appId: com.example.tasks
---
- launchApp:
    clearState: true
    permissions:
      camera: deny
- tapOn:
    id: task-photo.take-photo
- assertVisible:
    id: task-photo.permission-sheet
```

Values are `allow`, `deny` and `unset` ("Resets the permission state, causing the system to prompt
permission requests when running the Flow"); names include `camera`, `photos` (iOS, also `limited`),
`medialibrary`, `microphone`, `location` (iOS: `always`, `inuse`, `never`), `contacts`, `calendar`,
`notifications`, `usertracking` (iOS); `setPermissions` changes them mid-flow. On iOS Maestro taps
Allow on the notification alert by itself; on Android notifications are granted silently. Flows,
device binding and the screenshot matrix belong to `e2e-maestro`.

## 7. A manual pass before release

On one iPhone and one Android phone (or a named simulator and emulator), fresh install, for each
contract entry:

1. Press the control: the explain sheet (if `shouldExplainFirst`) has one "Continue"; the system
   dialog shows the translated purpose string in the phone's language.
2. Refuse: nothing else happens; the control says the feature is off.
3. Press again: Android shows the rationale with "No thanks"; iOS shows the settings sheet.
4. Open Settings from the sheet, turn the permission on, come back: the screen shows it on without a
   restart; the next press runs the feature.
5. Switch the app's language (iOS per-app language) and repeat step 1: the dialog text follows.
