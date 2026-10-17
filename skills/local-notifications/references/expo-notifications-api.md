# expo-notifications for local reminders (SDK 57)

The parts of `expo-notifications` this skill uses, what each does on iOS and Android, and the facts
that were checked against the installed sources. Verified on 2026-10-14 with expo-notifications
57.0.21 (Expo SDK 57, React Native 0.86) by reading the versioned docs and the package sources.

Re-verify: `npm view expo-notifications@57 version`, then read
`https://docs.expo.dev/versions/v57.0.0/sdk/notifications.md` and, in an installed app,
`node_modules/expo-notifications/build/*.d.ts`, `ios/ExpoNotifications/Notifications/TriggerRecords.swift`
and `android/src/main/java/expo/modules/notifications/service/delegates/ExpoSchedulingDelegate.kt`.
For the wider Expo API surface, Expo's own `expo-overview` skill is the reference.

## Contents

- Install and config plugin
- The calls the adapter makes
- Triggers: what DATE becomes on each platform
- Reading the pending set
- The foreground handler
- Permissions
- Channels
- Taps (responses)
- Things this skill does not use, and why

## Install and config plugin

```sh
npx expo install expo-notifications
```

Local notifications work in Expo Go on both platforms (remote push needs a development build on
Android since SDK 53; push-notifications covers that). The config plugin (app.config.ts `plugins`)
takes, per the 57.0.21 `withNotifications.d.ts`: `icon` (Android, a 96×96 all-white PNG with
transparency), `color` (Android tint, default `#ffffff`), `defaultChannel` (Android, FCM pushes only),
`sounds` (custom sound files), `mode` (iOS APNs environment, `development` | `production`) and
`enableBackgroundRemoteNotifications` (iOS, push only). Local reminders need only `icon` and `color`;
without an icon Android shows the app icon squashed to a white silhouette. These are build-time
settings: rebuild after changing them (expo-prebuild-and-config-plugins).

The library's Android manifest adds `RECEIVE_BOOT_COMPLETED` and `POST_NOTIFICATIONS` and a receiver
for `BOOT_COMPLETED`, `REBOOT`, `QUICKBOOT_POWERON` and `MY_PACKAGE_REPLACED`, which re-arms
scheduled notifications. iOS needs no usage description for notifications.

## The calls the adapter makes

| Port member | expo-notifications call | Notes |
|---|---|---|
| `permission()` | `getPermissionsAsync()` | never prompts |
| `requestPermission()` | `requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } })` | the default request also asks for badges; reminders do not set badges |
| `syncChannels()` | `setNotificationChannelAsync(id, { name, description, importance })` | a no-op resolving `null` on iOS and Android below 8.0 |
| `pendingIds()` | `getAllScheduledNotificationsAsync()` → `request.identifier` | |
| `scheduleNotifications()` | `scheduleNotificationAsync({ identifier, content, trigger })` | `identifier` is ours; without it the library makes a UUID |
| `cancelNotifications()` | `cancelScheduledNotificationAsync(identifier)` | resolves for an unknown identifier |
| `lastTap()` / `clearLastTap()` | `getLastNotificationResponse()` / `clearLastNotificationResponse()` | the synchronous forms; the `...Async` forms are deprecated in 57 |
| `onTap()` | `addNotificationResponseReceivedListener()` | returns an `EventSubscription` (`remove()`) |
| (once) | `setNotificationHandler()` | see the foreground handler |

The content the adapter sends: `title`, `body`, and `data` (a plain object). On iOS a missing `sound`
means the default sound (the library sets `.default` "to behave the same as android",
`NotificationRecords.swift`); on Android 8+ the channel decides sound and vibration.

## Triggers: what DATE becomes on each platform

```ts
trigger: { type: SchedulableTriggerInputTypes.DATE, date: fireAtMs, channelId }
```

- **iOS:** `DateTriggerRecord` truncates the timestamp to whole seconds and creates a
  `UNTimeIntervalNotificationTrigger(timeInterval: date.timeIntervalSinceNow)`: an absolute instant
  measured from the moment of scheduling. A date in the past gives a non-positive interval, which
  UserNotifications rejects, so `scheduleNotificationAsync` rejects (the planner's 5-second lead
  keeps this from happening).
- **Android:** the request is stored and an AlarmManager alarm (`RTC_WAKEUP`) is set:
  `setExactAndAllowWhileIdle` below Android 12 or when `canScheduleExactAlarms()` is true, otherwise
  `setAndAllowWhileIdle` (inexact). A date whose next trigger is in the past is removed with a log line
  ("will not trigger in the future, removing") and the promise still resolves: a silent drop.
- **`channelId`** is read by the Android presentation; iOS ignores it.

`SchedulableTriggerInputTypes` also has `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`, `CALENDAR` (iOS only)
and `TIME_INTERVAL`. The skill does not use them (`repeating-trigger`): see scheduling-model.md.
Passing a plain `Date` or number as the trigger is treated as DATE; the skill always passes the object
form so the channel is never forgotten.

## Reading the pending set

`getAllScheduledNotificationsAsync()` resolves with `NotificationRequest[]` (`identifier`, `content`,
`trigger`). On iOS a DATE request comes back as `{ type: 'timeInterval', seconds: <the original
interval> }` (`NotificationRecords.swift`), not as a fire date, so the app cannot learn when it will
fire. This is why the identifier carries the instant, and why the sync reads only identifiers.

## The foreground handler

`setNotificationHandler({ handleNotification })` decides what happens when a notification arrives
while the app is running. Per the SDK 57 docs: it must answer within 3 seconds, and "the default
behavior when the handler is not set or does not respond in time is not to show the notification".
So without a handler, a reminder that fires while the person is in the app is silently swallowed.

The answer (`NotificationBehavior`): `shouldShowBanner`, `shouldShowList`, `shouldPlaySound`,
`shouldSetBadge` (iOS) and an optional Android `priority`; `shouldShowAlert` is deprecated. On
Android, `shouldPlaySound: false` also suppresses the heads-up banner whatever the priority (docs).

There is one handler per app: a second call replaces the first. The skill's adapter installs it;
when push-notifications is adopted, its adapter installs the one handler and its policy covers local
notifications (`isRemote: false`), and the composition root creates the local adapter with
`createExpoLocalNotificationsAdapter({ errorLog, installForegroundHandler: false })`. The copied
adapter is never edited: its call site is guarded by that option, and both `foreground-handler`
rules (check-reminder-code here, check-push in push-notifications) stop counting it once a file
outside `src/services/local-notifications/` passes the flag.

## Permissions

`getPermissionsAsync()` and `requestPermissionsAsync()` resolve with `NotificationPermissionsStatus`:
`status` (`granted` | `denied` | `undetermined`), `granted`, `canAskAgain`, `expires`, and on iOS
`ios.status` (`IosAuthorizationStatus`: `NOT_DETERMINED` 0, `DENIED` 1, `AUTHORIZED` 2, `PROVISIONAL` 3,
`EPHEMERAL` 4). The docs ask apps to read `ios.status` on iOS. `toNotificationPermission` maps:

| OS answer | App state |
|---|---|
| `ios.status` PROVISIONAL | `provisional` (quiet delivery to Notification Center; allowed) |
| `granted`, or `ios.status` EPHEMERAL (App Clips) | `granted` |
| `status` undetermined | `undetermined` |
| denied and `canAskAgain` | `denied` (Android 13+ may still show the prompt) |
| denied and not `canAskAgain` | `blocked` (only the system Settings can change it) |

`enable()` syncs channels before `requestPermission()`: an app targeting Android 12L or lower gets
the system prompt only after its first channel exists, and a reminder scheduled on a missing channel
lands in an unnamed fallback (with targetSdk 33+, the canonical 36, the prompt shows on request). The
same union is push-notifications' `PushPermission`, and both are a subset of
permissions-and-system-prompts' `PermissionState`, so this port is a `PermissionAccess` for the
`notifications` kind (taps-and-routing.md, "Push notifications and other sources in the same listener").

## Channels

`setNotificationChannelAsync(id, input)` creates or updates a channel; after creation only `name` and
`description` can change (Android), so importance, sound and vibration are fixed per id: a new
behaviour needs a new id (and `deleteNotificationChannelAsync` for the old one, which keeps the
person's settings under the old id in Android's records). `AndroidImportance` values in this
library are its own numbering (`DEFAULT` 5, `HIGH` 6, `MAX` 7), not Android's constants: always use the
enum.

## Taps (responses)

`NotificationResponse`: `actionIdentifier` (`DEFAULT_ACTION_IDENTIFIER`,
`'expo.modules.notifications.actions.DEFAULT'`, for a tap on the notification itself),
`notification.request.identifier`, `notification.request.content.data`, optional `userText`.

- `getLastNotificationResponse()` returns the response that launched or last resumed the app (or
  null): the cold-start tap, which happened before any listener existed.
- `addNotificationResponseReceivedListener()` fires for taps while the app runs.
- Both can report the same tap; handle each identifier once and clear the last response after use.
- `useLastNotificationResponse()` is the hook form (`undefined` until known). The skill reads through
  the port instead, so the tap logic is testable with the fake.

## Things this skill does not use, and why

| API | Why not |
|---|---|
| `cancelAllScheduledNotificationsAsync()` | deletes every feature's notifications; the sync cancels by identifier (`cancel-all`) |
| `getNextTriggerDateAsync()` | the planner computes instants itself, the same way on both platforms |
| `setBadgeCountAsync()` | reminders do not carry a count; a badge needs its own source of truth |
| `registerTaskAsync()` / headless tasks | they serve remote pushes; local reminders need no JS when they fire |
| `trigger: null` (present now) | an in-app event is shown in the app, not as a system notification |
| categories (`setNotificationCategoryAsync`) | action buttons ("Done", "Snooze") are a later extension: each action writes the row and requests a sync, the same as an in-app press |
