# iOS and Android: delivery, permission, channels

What each platform does with a scheduled reminder, where they differ, and what the app does about
it. Facts marked "source" were read in expo-notifications 57.0.21 on 2026-10-14; "docs" are the
Expo SDK 57 docs or the platform documentation; "unverified" was not reproduced on a device here.

## Contents

- Side by side
- iOS: the 64 limit, permission, presentation
- Android: channels, the permission, exact and inexact alarms
- Android: reboot, updates, Doze and OEM battery managers
- Privacy on the lock screen
- Pitfalls and fixes

## Side by side

| Concern | iOS | Android |
|---|---|---|
| Permission | asked once; after a refusal only Settings can change it | runtime `POST_NOTIFICATIONS` on 13+ (API 33); below 13, on by default |
| Prompt precondition | none | at least one channel must exist (docs) |
| Pending limit | the soonest 64 per app, the rest silently dropped (docs, Apple) | no notification cap; AlarmManager refuses more than 500 alarms per app (AOSP source, unverified on device) |
| What DATE becomes | `UNTimeIntervalNotificationTrigger` from now (source) | AlarmManager `RTC_WAKEUP` alarm, exact or inexact (source) |
| Past date | rejected (the call rejects) | dropped silently (source) |
| After a reboot | pending requests survive in the OS | re-armed by the library's boot receiver (source manifest) |
| After an app update | pending requests survive | re-armed on `MY_PACKAGE_REPLACED` (source manifest) |
| Sound and importance | per notification and per permission | per channel, fixed once the channel exists |
| Foreground | shown only if the handler says so | same; no heads-up without `shouldPlaySound` (docs) |
| Person mutes one kind | Settings → app → Notifications (all or nothing, plus Focus) | per channel in Settings |
| Time zone travel | the instant stays; the foreground sync re-plans | same |

## iOS: the 64 limit, permission, presentation

- **The 64 limit.** The system keeps the 64 soonest-firing local notifications of an app; the rest
  never fire and nobody is told. The planner caps the plan at `maxPending` (50) and the foreground
  sync refills it. A plan over 64 is a bug the logic checker fails (`plan-max-pending`).
- **The prompt is a one-time chance.** After "Don't Allow" the prompt never appears again
  (`canAskAgain` false, the app state `blocked`); only Settings can turn notifications on. Ask from
  the "Remind me" action, after one line of why (permissions-and-system-prompts owns the pre-prompt).
  When blocked, offer a button that opens the app's Settings page (`Linking.openSettings()`).
- **Provisional authorization** (iOS 12+): delivers quietly to Notification Center without a prompt,
  if the app requests it with `allowProvisional`. The skill does not request it by default (reminders
  the person asked for should alert), but treats a provisional state as allowed.
- **Focus and Scheduled Summary** can hold notifications back; `interruptionLevel: 'timeSensitive'`
  breaks through only with the Time Sensitive Notifications capability added to the app (an
  entitlement): an opt-in for genuinely time-bound reminders, never the default.
- **Presentation in the foreground** goes through the handler; `shouldShowBanner` and
  `shouldShowList` map to `UNNotificationPresentationOptions`.
- **Simulator:** local notifications are delivered on the iOS simulator; scheduling, the prompt and
  the foreground handler can be exercised there (testing-and-devices.md).

## Android: channels, the permission, exact and inexact alarms

- **Channels (Android 8+).** Every notification belongs to a channel; the person can mute or restyle
  each channel. Create them with names and descriptions in the person's language
  (`namedReminderChannels(t)`) before asking for the permission and before scheduling. A channel's
  importance, sound and vibration are fixed after creation (docs): `REMINDER_CHANNELS` ids are
  permanent; a new behaviour gets a new id. A notification whose channel does not exist goes to
  expo-notifications' fallback channel (source), which the person cannot tell apart, so the sync
  re-creates the channels on every run (cheap, idempotent).
- **`POST_NOTIFICATIONS` (Android 13+).** Declared by the library; the app requests it at runtime with
  `requestPermissionsAsync()`. Apps targeting 13+ get no notifications until the person allows them.
  On Android the prompt can be shown again after a first refusal; after the second it is `blocked`.
- **Exact or inexact.** expo-notifications uses `setExactAndAllowWhileIdle` below Android 12, or when
  the app holds the exact-alarm permission (`canScheduleExactAlarms()`), and `setAndAllowWhileIdle`
  otherwise (source). Inexact alarms never fire early but may fire minutes late, and in Doze an app's
  allow-while-idle alarms are rate-limited (about one per 9 minutes, Android docs). For a task
  reminder that is fine: inexact is the default and needs no permission.
- **`SCHEDULE_EXACT_ALARM`** (add it in `android.permissions` only when minutes matter): since
  Android 14 it is denied by default for newly installed apps targeting 13+, the person grants it in
  Settings → Alarms & reminders, and it can be revoked at any time (Android docs). Without the grant
  expo-notifications silently falls back to inexact. If the app declares it, show the state in the
  reminder settings and offer the system screen; never block reminders on it.
- **`USE_EXACT_ALARM`** is granted at install but Google Play allows it only for apps whose core
  function is an alarm clock, a timer or a calendar; anything else risks rejection. The skill bans it
  (`exact-alarm`); list it under `android.blockedPermissions` if a library adds it to the manifest.

## Android: reboot, updates, Doze and OEM battery managers

- **Reboot and update.** The library's receiver re-arms scheduled notifications on `BOOT_COMPLETED`
  (after the first unlock), `REBOOT`, the quick-boot actions and `MY_PACKAGE_REPLACED` (source).
- **Doze and App Standby.** Allow-while-idle alarms still fire in Doze, rate-limited. An app in the
  "restricted" standby bucket may have alarms deferred further (Android docs).
- **OEM battery managers** (some Xiaomi, Huawei, OPPO, Samsung configurations) can kill the app and
  drop its alarms; no code fixes that. The foreground sync restores every lost reminder the next time
  the app opens. If the app's reminders matter enough, explain the vendor's battery setting in the
  help screen; do not request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (Play restricts it to apps that
  cannot work otherwise).
- **Emulators do not reproduce OEM behaviour.** Survival across reboot, Doze and OEM killers is
  confirmed only on real devices (testing-and-devices.md lists the probes).

## Privacy on the lock screen

The body quotes the person's task title. On iOS, "Show Previews: When Unlocked" hides it on a locked
screen; on Android the channel's lock-screen visibility and the person's setting decide. If an app's
reminders can hold sensitive text (health, money), keep the label out of the body
(`reminders.notification.body-unlabelled`) and show it only in the app. Reminders never leave the
device: no network, no SDK, nothing to declare beyond the notification permission
(privacy-and-store-declarations).

## Pitfalls and fixes

| Symptom | Cause | Fix |
|---|---|---|
| A reminder never fires while the app is open | no `setNotificationHandler` (SDK 57 shows nothing by default) | one handler in the adapter (`foreground-handler`) |
| Reminders stop after a few days | the 64/50 window ran out and the app was not opened | foreground sync refill; fewer occurrences per reminder |
| Fires an hour off twice a year | the time stored as an instant, or `+ 24 h` | wall-clock minute + rule, `instantOfWallClock` per day |
| Still fires at the old time after an edit | identifier without the instant | the identifier encodes instant and text (`plan-edit`) |
| Android shows "Miscellaneous" in Settings | no `channelId`, or the channel was never created | channel on every trigger (`trigger-channel`), channels each sync |
| No prompt on Android 13 | no channel existed yet | `enable()` syncs channels first |
| iOS rejects with an invalid trigger | a date in the past | the 5-second lead (`plan-past`) |
| Another feature's timer vanished | `cancelAllScheduledNotificationsAsync` | cancel by identifier (`cancel-all`) |
| A tap on a cold start opens only the app | only the listener was used | read `getLastNotificationResponse()` too (`tap-handling`) |
| Two features each set a handler; one stops showing | the last `setNotificationHandler` wins | exactly one call (`foreground-handler`) |
