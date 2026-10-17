# Testing reminders: Jest, then devices

Everything that decides what fires and when is pure and runs in Jest; the adapter is driven against
Jest's automock; devices prove only what Jest cannot (delivery, the prompt, the shade, reboot).

## Contents

- What each test proves
- Jest recipes
- Device probes (named devices only)
- What only a real device proves

## What each test proves

| Test (template) | Proves |
|---|---|
| `src/core/reminders/wall-clock.test.ts` | wall-clock minutes across spring and autumn changes, skipped and doubled times, a half-hour zone, a midnight that does not exist |
| `src/core/reminders/plan-reminders.test.ts` | one-shots nearest first, identifiers stable and changing on edits, DST, lead time and `imminentIds`, skip days (also of a once rule), weekdays, the limit, rejected rows, a property test over random rows |
| `src/core/reminders/reconcile-reminders.test.ts` | empty diff when equal, an edit is cancel + schedule, an imminent pending notification kept (a deleted row's cancelled), foreign identifiers untouched |
| `src/core/reminders/reminder.test.ts`, `reminder-tap.test.ts` | row validation, the tap data contract |
| `src/services/local-notifications/reminder-sync.test.ts` | the whole run against the fakes: idempotence, edits, deletes, a sync seconds before a reminder fires, travel, a language switch (channel names follow the `t()` passed last, also in a queued run), no permission (cancel-only: deleted rows still leave the pending set), `enable()`, failures, single flight |
| `src/services/local-notifications/expo-local-notifications-adapter.test.ts` | the SDK calls and their arguments (automock), permission mapping, refusals as values, the handler installed by default and left to push with `installForegroundHandler: false` |
| `src/services/local-zone/*.test.ts` | the engine offset in the adapter; the fake's travel |
| `src/hooks/use-reminder-sync.test.ts`, `use-reminder-taps.test.ts` | the foreground and `t()` triggers, and the `t()` handed to each request; cold-start and later taps |

Run them: `npx jest src/core/reminders src/services/local-notifications src/services/local-zone src/hooks --ci --maxWorkers=2`.

## Jest recipes

- **Daylight saving without the machine's zone.** Jest runs with `TZ=UTC` (jest.config.js), so a
  test never relies on the machine. Pass a rule zone from `test/reminders/rule-zone.ts`
  (`berlin2026`, `newYork2026`, `lordHowe2026`, `havana2026`) as `offsetAt`, or to
  `createFakeLocalZone`. Add a zone by listing its transitions, checked with Node:

  ```sh
  node -e "const f=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',timeZoneName:'longOffset'});let p;for(let t=Date.UTC(2026,0,1);t<Date.UTC(2027,0,1);t+=9e5){const o=f.formatToParts(t).at(-1).value;if(o!==p)console.log(new Date(t).toISOString(),o),p=o}"
  ```

- **The sync with fakes, never mocks of the app's own modules.** `createFakeLocalNotifications`
  (pending map, refusals, a broken read, prompts, taps), `createFakeLocalZone` (`travel`),
  `createFakeClock` (architecture-and-boundaries), `createFakeErrorLog`. `loadReminders` is a closure
  over a mutable row list.
- **The adapter against the automock.** `jest.mock('expo-notifications')` and a typed
  `jest.requireMock`; enum values come from the mock (`native.AndroidImportance.HIGH` is 6). The test
  imports nothing from expo-notifications, not even a type: the canonical ESLint vendor ban
  (`no-restricted-imports`) covers type imports in every file but an adapter, so the test types the
  mock by hand (`MockedNotifications`), or reads a type the adapter exports for it (push-notifications'
  `ExpoNotificationsSdk`). check-reminder-code itself ignores type-only imports.
- **Hooks.** `renderHook` from React Native Testing Library 14 is async (`await renderHook(...)`,
  `await rerender(...)`, `await unmount()`); AppState is faked with `Object.defineProperty` on
  `currentState` and a spied `addEventListener`, as `use-is-app-active.test.ts` does.
- **A fixed "now".** `NOW_MS` and `TODAY` in `test/reminders/reminder-rows.ts` (2026-10-14 08:00 UTC,
  a Wednesday); never `Date.now()` in a reminder test.

## Device probes (named devices only)

Use your own named simulator or emulator (`<project>-reminders`), never "the booted device".

**iOS simulator** (Xcode 26.6):

```sh
xcrun simctl list runtimes                                    # pick an iOS runtime id
xcrun simctl create tasks-reminders "iPhone 17" <runtime-id>  # prints <udid>
xcrun simctl boot <udid>
xcrun simctl uninstall <udid> <bundle-id>   # the notification prompt shows again after a reinstall
```

Schedule a reminder a minute ahead through a debug hook (debug-menu-and-test-hooks), press Home, and
watch it arrive; tap it to test the launch path. Delivery and the foreground handler behave as on a
device; Focus, Scheduled Summary and lock-screen previews need a device.

**Android emulator** (an AVD you created, started by name on a port you chose). The serial is
`emulator-<port>`; the default 5554 may belong to another session's emulator on a shared machine,
so pick a free even port and use that serial on every call:

```sh
emulator -avd tasks-reminders -port 5580 -no-snapshot &
adb -s emulator-5580 emu avd name                                                 # prints tasks-reminders: the right device
adb -s emulator-5580 shell dumpsys alarm | grep -A3 <application-id>              # pending alarms
adb -s emulator-5580 shell dumpsys notification --noredact | grep -A2 <application-id>
adb -s emulator-5580 shell cmd notification list                                  # posted ones
adb -s emulator-5580 shell pm revoke <application-id> android.permission.POST_NOTIFICATIONS
adb -s emulator-5580 shell dumpsys deviceidle force-idle                          # enter Doze
adb -s emulator-5580 shell dumpsys deviceidle unforce
adb -s emulator-5580 reboot                                                       # re-arm check
```

When the emulator was started without `-port`, find its serial by AVD name: for each
`emulator-<n>` in `adb devices`, `adb -s emulator-<n> emu avd name` prints the AVD it runs.

**The zone probe (does the zone follow a change without a restart?).** The adapter reads the
engine's `getTimezoneOffset`, and whether Hermes follows a zone change while the app runs is
unverified (scheduling-model.md, "Daylight saving, travel"). Run this once per SDK upgrade, on
both platforms, with the app in the background (not killed) the whole time:

1. Schedule a daily 09:00 reminder; note the pending instants (`dumpsys alarm` on Android; a debug
   screen listing `pendingIds()` on iOS, the instant is the third `:` field in base 36).
2. Change the zone without killing the app. Android emulator: Settings → System → Date & time, turn
   off automatic time zone, pick a zone six hours away (this changes only that emulator). iOS: prefer
   a device: Settings → General → Date & Time, turn off Set Automatically, pick the zone. The
   simulator follows the Mac's zone, and changing the Mac's zone in System Settings changes it for
   the whole machine: every other session's simulators, builds and tests see the new zone too. Do
   it only on a machine nobody else is using, and set it back right after (launching with
   `SIMCTL_CHILD_TZ=<zone>` sets the zone for a fresh launch only and does not answer the question).
3. Bring the app to the foreground. If the instants moved by the offset difference, the engine
   follows the zone. If they move only after a cold start, Hermes caches the zone: record it in
   scheduling-model.md and in the app's release notes (reminders after a flight follow the new zone
   once the app is restarted).

E2E flows (schedule, background, wait, tap, assert the screen) belong to e2e-maestro, with the device
named on every `maestro` call.

## What only a real device proves

- OEM battery managers (alarms dropped after the app is swiped away on some vendors' builds).
- Doze over hours, and the exact-alarm grant revoked in Settings.
- Focus modes, Scheduled Summary, lock-screen previews, CarPlay and watch mirroring on iOS.
- Notification sound and vibration per channel on real hardware.

Track "fired as expected" during dogfooding on at least one iPhone and two Android vendors; a green
emulator run is not evidence of survival.
