# The scheduling model: database, plan, diff

How reminders stay correct when the OS forgets, the clock jumps, the person travels or changes
language. Read this before adding a reminder kind, changing the sync, or debugging "it fired at
the wrong time" or "it never fired".

## Contents

- The three layers and why
- What a reminder row stores
- The plan: occurrences, the window, the limit
- Identifiers: why they encode the instant and the text
- The diff and the one sync
- When the sync runs
- Daylight saving, travel and a clock set by hand
- Product shapes in the Tasks domain
- Restore, reinstall, sign-out and data reset
- Decisions and the alternatives we rejected

## The three layers and why

| Layer | Lives in | Owns |
|---|---|---|
| Reminder rows | the database (`reminders`, `reminder_skip_days`) | what the person asked for: the truth |
| The plan | memory, computed by `planReminders` (pure) | which notifications should be pending right now |
| The pending set | the OS (UNUserNotificationCenter, AlarmManager) | a cache of the plan |

The OS pending set is lossy by design: iOS keeps only the soonest 64; Android OEM battery managers
drop alarms; a reinstall, a restore from backup, or "Clear all" in some launchers empties it; an app
update can change what a notification should say. None of that is visible to the app except by
reading the pending identifiers again. So nothing in the app reads the pending set to decide what
the person asked for, and every change flows one way: rows → plan → diff → OS.

## What a reminder row stores

`Reminder` (`src/core/reminders/reminder.ts`) is what the repository returns:

- `schedule`: `at` (an instant: a snooze, "in one hour"), `once` (a local day and a wall-clock
  minute), `daily` (a minute), `weekly` (ISO weekdays and a minute). A recurring time is never stored
  as an instant: 09:00 stored as `07:00Z` is 08:00 every winter in Berlin.
- `skipDays`: local days on which a day-based rule stays silent ("done for today", a holiday).
- `channelId`: the Android channel (one of `REMINDER_CHANNELS`); iOS ignores it.
- No path. Where a tap leads is the row's subject (the task it belongs to), looked up again at tap
  time (`findReminder`) and turned into a typed href by the app (`hrefForReminder` in
  examples/create-root-kits.ts). A stored path would need an `as Href` cast to navigate and goes
  stale when a route is renamed; the planner never needs one.
- `label`: the person's text (a task title), quoted in the body.

`reminderProblem` rejects a row the planner cannot use; the sync records it in the error log and
keeps planning the others. One bad row never silences every reminder. A row whose columns do not
even have the right types fails the repository's schema; the repository records its id and leaves
it out (examples/sqlite-reminder-repository.ts). Either way the row stays in the database.

## The plan: occurrences, the window, the limit

`planReminders` expands each row into occurrences inside a horizon (default 30 days), resolves each
day's wall-clock minute to an instant through the zone (`instantOfWallClock`), never schedules
anything closer than `DEFAULT_MIN_LEAD_MS` (5 s), sorts everything nearest first and keeps
`maxPending` (default 50).

- **The lead, and what is already pending inside it:** an occurrence due within the lead is too
  close to schedule (iOS rejects a past date, Android drops it), but if an earlier sync scheduled it,
  the OS is about to fire it. The planner reports its identifier in `imminentIds` and
  `reconcileReminders` keeps it, so a sync that happens to run in the last seconds (a return to the
  foreground, a write's `sync.request()`) does not cancel the reminder it was meant to keep. A
  deleted or edited reminder plans no such identifier, so its pending notification is still
  cancelled.

- **Why 50 and never more than 64:** iOS keeps the soonest 64 pending local notifications per app and
  discards the rest without an error (Apple, Local and Remote Notification Programming Guide; the
  limit is per app, push notifications do not count). 50 leaves room for the app's other local
  notifications (a timer, a one-off). Android has no published per-app notification cap, but
  AlarmManager refuses more than 500 alarms per app (AOSP `MAX_ALARMS_PER_UID`, read from source,
  not reproduced on a device); 50 keeps both platforms identical.
- **Why one-shot triggers only:** a repeating trigger (DAILY, WEEKLY, CALENDAR) cannot skip a done
  day, carries one fixed text for ever, and its next instant is invisible to the diff (iOS reports a
  pending trigger's original parameters, not the next fire date). One-shot DATE triggers keep every
  occurrence a separate, checkable fact.
- **The rolling window:** with ten daily reminders, 50 slots cover five days. That is enough because
  the sync refills the window on every return to the foreground. An app whose people may not open
  it for longer than the window covers should say so in the reminder UI, or plan fewer reminders
  further ahead (for example only the next occurrence of each reminder); the planner's horizon and
  `maxPending` are the two knobs.

## Identifiers: why they encode the instant and the text

`reminder:<row id>:<fire instant, base 36>:<hash of channel, title and body>`.

- **Unchanged input, same identifier:** the second sync is an empty diff, so syncing on every
  foreground costs a read of the pending identifiers and nothing else.
- **An edit, a new identifier:** moving 09:00 to 10:00, a new language, a renamed task or another
  channel changes the identifier, so the old one is cancelled and the new one scheduled. A stable id
  such as `reminder:42:0` would match in both loops of the diff and keep firing at the old time
  with the old text: the classic wrong-hour bug.
- **The prefix fences the sync:** only identifiers that start with `REMINDER_ID_PREFIX` are ever
  cancelled. Another feature's local notification (a focus timer) and anything else pending stay.

## The diff and the one sync

`reconcileReminders(planned, pendingIds, imminentIds)` → `{ cancel, schedule }`; `createReminderSync` runs:

0. `texts(t)` once: the channels and the `describe` of this run, from the `t()` that
   `useReminderSync` passed last (`sync.request({ t })`), or `translateNow()` before it has passed
   one. Every text of a run shares one language and one `createIntl`.
1. `syncChannels` (Android: create or rename; iOS: nothing) every run, so a reinstall, a deleted
   channel or a language change heals itself. A notification posted to a channel that does not exist
   lands in expo-notifications' fallback channel (read in `BaseNotificationBuilder.kt`, 57.0.21).
2. `permission()`: read now, acted on in step 6.
3. `loadReminders()`: the rows; a storage failure stops the run (`failed: load`).
4. `planReminders` with `clock.nowMs()`, `clock.today()`, `zone.offsetAt`, the channel ids, `describe`.
5. `pendingIds()`: a failed read stops the run before any cancel (`failed: pending`).
6. cancel, then schedule (nearest first, one at a time, refusals recorded and retried next run).
   Without `granted` or `provisional` the run cancels only and ends with `not-allowed` and the
   count it cancelled: a deleted row or a sign-out still removes its pending text, so it cannot fire
   with the previous account's words once the person allows notifications again in Settings.

**Why the language is passed, not read.** The sync runs from a child's effect (`useReminderSync` in
the kit's effects, beside the root Stack), and React runs child effects before parent effects, so module state that
`I18nProvider` updates in its own effect (`recordShownLanguage`, read by `languageNow()`) still holds
the old language when the run starts. `useReminderSync(sync, t)` hands over the `t()` the screen
renders with (language and digits), and a write's `sync.request()` with no argument reuses it.

Runs never overlap (`singleFlight`): a call while one runs waits for exactly one more run, shared by
every caller in the meantime, so a burst (foreground + a write + a language switch) costs at most two
runs and two runs never interleave their cancels and schedules.

Only `reminder-sync.ts` calls `scheduleNotifications` and `cancelNotifications`: a feature that
schedules "just this one" directly is overwritten (or cancelled) by the next run, and a second writer
makes the diff wrong for both.

## When the sync runs

| Event | How |
|---|---|
| App start, and every return to the foreground | `useReminderSync` (mount and `useIsAppActive()` turning true) |
| A reminder row written (created, edited, deactivated, done for today) | `sync.request()` after the commit |
| A task completed or deleted (its reminders stop) | `sync.request()` after the commit |
| The language or digits changed | `useReminderSync`'s `t` argument (a new `t()` from `useT()`) |
| The person allowed notifications | `sync.enable()` runs it; a grant in Settings is caught by the next foreground |
| A restore or import finished | `sync.request()` after the import commits |

The foreground sync is the reliability backbone. Android re-arms scheduled alarms after a reboot and
after an app update by itself (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED` and the quick-boot actions in
expo-notifications' manifest, 57.0.21); iOS keeps pending notifications across reboots. Neither tells
the app what was lost to an OEM battery manager: only the next diff does.

## Daylight saving, travel and a clock set by hand

- **Daylight saving:** `instantOfWallClock` takes the zone as `offsetAt(instant)` and checks both
  sides of the wall time: 09:00 stays 09:00 on 23- and 25-hour days, a skipped 02:30 becomes 03:30,
  a doubled 01:30 takes its first occurrence (the same choice as `new Date(y, m, d, h, min)` and
  Temporal's `compatible`). Tests use rule zones (`test/reminders/rule-zone.ts`), because Jest runs
  with `TZ=UTC`.
- **Travel:** a DATE trigger is an absolute instant on both platforms (iOS turns it into a time
  interval from now, Android into an RTC alarm; read in the 57.0.21 sources). After a flight from
  Berlin to New York, a reminder planned for 09:00 Berlin fires at 03:00 local, until the next
  foreground sync re-plans it in the new zone (the instants change, so every identifier changes).
  Opening the app after landing fixes it; a reminder that fires before that is the documented cost
  of one-shot triggers. **Open, and how it was decided:** the zone adapter reads the engine's
  `getTimezoneOffset`, and whether Hermes re-reads the device zone while the app runs is not
  verified (JavaScript engines have cached the local zone until restart before). If it caches, the
  re-plan waits for the next cold start. Computing an IANA zone's offset from expo-localization's
  zone id was rejected: it needs `Intl.DateTimeFormat#formatToParts`, which Hermes lacks on iOS
  unless the app ships the forced FormatJS DateTimeFormat polyfill with all zone data, and the lint
  keeps `Intl.DateTimeFormat` in `src/i18n/`. The zone probe in testing-and-devices.md settles it
  per SDK; record the answer here.
- **A clock set by hand:** `nowMs` and `today` come from `ClockPort`; the next foreground sync plans
  from the new clock and the diff replaces whatever no longer fits. The planner never stores "now".

## Product shapes in the Tasks domain

| Shape | Row | Note |
|---|---|---|
| "Remind me at 18:00 today" | `once` with today's key | after 18:00 the planner drops it; the row can stay or be deactivated |
| "Every weekday at 08:30" | `weekly` `[1..5]`, 510 | |
| "Snooze one hour" | `at` with `nowMs + 3_600_000` | an instant, on purpose: "in an hour" is elapsed time |
| "Done for today" | add today to `skipDays`, then `sync.request()` | tomorrow's occurrence stays |
| "Your streak ends tonight" (dates-streaks-and-statistics) | `once` today at 20:00 when the day is not done yet, skipped once it is | the in-app countdown comes from `ClockPort.msUntilNextLocalDay()`; the notification is just another row |
| A due date with a reminder the day before | `once` with `addDays(dueOn, -1)` | day arithmetic on keys, never milliseconds |

## Restore, reinstall, sign-out and data reset

- **Restore or import:** the restored rows are the truth; run the sync. Never restore pending
  identifiers from a backup, and never call `cancelAllScheduledNotificationsAsync` (it also deletes
  other features' notifications): the diff cancels every `reminder:` identifier the new rows do not
  plan.
- **Sign-out or "delete my data":** deactivate or delete the rows in the same transaction as the rest
  of the account data, then run the sync: the plan is empty, so every reminder is cancelled. This
  holds without the permission too: a `not-allowed` run still cancels the `reminder:` identifiers
  the plan no longer holds and schedules nothing (`reminder-sync.test.ts`, "cancels the
  reminders of deleted rows even while the permission is blocked").
- **Reinstall:** iOS and Android drop the pending set with the app; the first foreground sync
  rebuilds it once the permission is granted again.

## Decisions and the alternatives we rejected

| Decision | Rejected alternative | Why |
|---|---|---|
| One-shot DATE triggers from a pure planner | DAILY/WEEKLY/CALENDAR triggers | cannot skip a done day, fixed text, CALENDAR is iOS-only, next fire date invisible to the diff |
| Identifiers encode instant and text | stable `reminder:<id>:<n>` | an edit keeps the old time and text |
| The DB is the source, the OS is a cache | reading `getAllScheduledNotificationsAsync` to show "reminders" | lossy, capped at 64, no fire date on iOS |
| Zone as `offsetAt` through a port | `Intl.DateTimeFormat` with a zone id in core | the lint bans Intl date formatting outside i18n; a port keeps core pure and testable with rule zones |
| Sync on every foreground | a background task that re-plans | iOS background work is opportunistic and Android throttles it; background-tasks may add a best-effort run, never instead of the foreground one |
| `maxPending` 50 | 64 | headroom for the app's other local notifications |
