# The checkers: rules, scope, configuration

Two zero-dependency Node checkers prove the rules on the app's own code. Both take the repo root as
an optional positional argument (default `.`), print one `FAIL <file>:<line> [<rule>] ... Fix: ...`
line per problem, and end with `RESULT: PASS` or `RESULT: FAIL (<n> problems)`. Exit 0 pass (NOT
APPLICABLE included), 1 problems, 2 bad input.

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-reminder-code.mjs .
node ${CLAUDE_SKILL_DIR}/scripts/check-reminder-logic.mjs .
```

## Contents

- When they apply
- check-reminder-code: the static rules
- check-reminder-logic: the behaviour rules and the module contract
- Configuration and layout
- Expected SKIP and NOT APPLICABLE lines
- Troubleshooting

## When they apply

Both print `NOT APPLICABLE: expo-notifications is not in package.json` without the SDK. With the SDK
but no local reminders (a push-only app), both print NOT APPLICABLE too: check-reminder-code when no
local notifications folder exists and nothing calls a scheduling API, check-reminder-logic when none
of its four modules exists and the folder does not either. A scheduling call anywhere makes the
static check apply, so "no folder" never hides a stray `scheduleNotificationAsync`. A root without
`src/` is bad input (exit 2).

## check-reminder-code: the static rules

Scans `src/` and a root `index.*` (comments masked; installed skills under `.agents/`, `.claude/`,
`skills/` and any folder holding a `SKILL.md` are never scanned), and the app config.

| Rule | Fails when | Scope |
|---|---|---|
| `sdk-import` | a file that is not an adapter (`src/services/<concern>/*-adapter.ts`) imports a value from expo-notifications, tests included (they use `jest.mock` + `jest.requireMock`). Type-only imports pass anywhere (`import type`, `export type ... from`, a braced list whose every name is `type X`, `typeof import('expo-notifications')`): TypeScript erases them, so they never reach native code. One value name in the list makes it a value import | all scanned files |
| `schedule-api` | `scheduleNotificationAsync`, `cancelScheduledNotificationAsync` or `getAllScheduledNotificationsAsync` is called outside the local notifications adapter | runtime files |
| `cancel-all` | `cancelAllScheduledNotificationsAsync` is called anywhere | runtime files |
| `sync-only-writer` | `.scheduleNotifications(` or `.cancelNotifications(` outside `reminder-sync.ts` (the port, the adapter and the fake define them) | runtime files |
| `repeating-trigger` | a DAILY, WEEKLY, MONTHLY, YEARLY, CALENDAR or TIME_INTERVAL trigger, `repeats: true`, or a string trigger type | runtime files |
| `trigger-channel` | a DATE trigger object without `channelId` | the local adapter |
| `foreground-handler` | no `setNotificationHandler` call at all, or more than one call site. When a file outside the local notifications folder (the composition root) passes `installForegroundHandler: false`, the local adapter's call site does not count, and another adapter (push-notifications') must call it | runtime files |
| `permission-at-launch` | `requestPermission(` / `requestPermissionsAsync(`, or `.enable(` called on a name ending in `sync`/`Sync` (`reminderSync.enable()`, `sync?.enable()`), anywhere in a `_layout`, the root navigator feature or the entry; and in any other file, the port's `.requestPermission(` or a `<name>Sync.enable(` inside a `useEffect`/`useLayoutEffect`/`useInsertionEffect` callback (an effect runs on mount, so the first screen's model prompts at launch); `requestPermissionsAsync(` in an effect counts only in a file that imports expo-notifications, because other SDKs (camera, media library) share the name | startup files; effects everywhere |
| `literal-text` | a `title:`, `body:` or `subtitle:` with a string literal, or a template literal whose text outside its `${}` spans holds a letter (`` `Reminder: ${label}` ``); a template of interpolations only (`` `${t('a')} ${t('b')}` ``) passes | the planner and service folders |
| `wall-clock` | `Date.now()`, `new Date(`, `performance.now()`, or a 24-hour constant (`86_400_000`, `24 * 60 * 60 * 1000`, `24 * 3_600_000`) without `// not-a-calendar-day: <why>` on its line or in the comment block above | the planner and service folders |
| `exact-alarm` | `USE_EXACT_ALARM` in `app.config.ts`/`.js`/`app.json` outside `blockedPermissions` | the app config |
| `sync-on-foreground` | `src/hooks/use-reminder-sync.ts` does not use `useIsAppActive`/`AppState`, or no file outside `src/hooks/` calls `useReminderSync(` | runtime files |
| `tap-handling` | a file subscribes `addNotificationResponseReceivedListener` without reading `getLastNotificationResponse` (or its hook/async form); a file calls the port's `.onTap(` without `.lastTap(` (the tap hook); or nothing outside `src/hooks/` calls `useReminderTaps(` | runtime files |
| `root-kit` | a file defines `createLocalNotificationsKit` (the root kit, which mounts both hooks beside the root Stack) but nothing else calls it: the registry `src/services/create-root-kits.ts` never creates it | runtime files |

The local-zone adapter (`src/services/local-zone/`) is outside the `wall-clock` scope on purpose: it
is the one place that asks the engine for the zone (`new Date(instant).getTimezoneOffset()`).

### What the static rules cannot see

They match call shapes in one file at a time, so a review still covers these:

- **A prompt reached indirectly.** `permission-at-launch` sees `requestPermission(`,
  `requestPermissionsAsync(` and `<name>Sync.enable(` written in a startup file or inside an effect's
  callback. An effect that calls a helper which calls `enable()` elsewhere, an effect callback
  defined as a named function outside the `useEffect(` call, or a destructured
  `const { enable } = reminderSync; enable()`, passes. Keep the "Remind me" press handler the only
  caller of `enable()`. A screen that opens only from a press and asks on mount (an onboarding step)
  is reported too: move the call into the step's button.
- **Text built outside the object literal.** `literal-text` reads the value right after `title:`,
  `body:` or `subtitle:`. `const title = 'Reminder'; return { title }`, a string concatenation
  (`'Reminder: ' + label`) or a literal returned by a helper passes. Text comes from `t()`; review any
  new text helper in the service folder.
- **A tap hook under another shape.** `tap-handling` pairs `.onTap(` with `.lastTap(` in the same
  file; a hook that reads the launch tap in a different file than the one subscribing is reported, and
  one that calls `lastTap()` without handling its result is not.

## check-reminder-logic: the behaviour rules and the module contract

Imports the app's pure modules with Node type stripping (tsconfig aliases resolve; a module that
imports React Native, Expo or a `.tsx` file cannot load) and runs pinned vectors. Time zones are rule
zones checked against the IANA data through Node's Intl (Berlin, New York, Havana, Lord Howe, 2026).

| Module (in the planner folder) | Exports the checks call |
|---|---|
| `wall-clock.ts` | `instantOfWallClock(day, minuteOfDay, offsetAt)` |
| `plan-reminders.ts` | `planReminders(input)`, `REMINDER_ID_PREFIX`, `IOS_PENDING_LIMIT` (64); input `{ reminders, nowMs, today, offsetAt, channelIds, describe, maxPending?, horizonDays?, minLeadMs? }` (a reminder: `{ id, schedule, channelId, label, skipDays }`); output `{ notifications: [{ id, reminderId, fireAtMs, channelId, title, body, data }], imminentIds: [id], rejected: [{ reminderId, problem }] }` |
| `reconcile-reminders.ts` | `reconcileReminders(planned, pendingIds, keepIds = [])` → `{ cancel, schedule }` |
| `reminder-tap.ts` | `parseReminderTap(data)`, `reminderTapData(reminderId)` |

| Rule | Proves |
|---|---|
| `missing-module` | as soon as one module exists, all four do |
| `module-load` | each module imports as pure TypeScript |
| `wall-clock-dst` | July offset; Berlin's skipped 02:30 → 03:30; doubled 02:30 (Berlin) and 01:30 (New York) take the first; Havana's missing midnight; Lord Howe's half-hour change |
| `plan-dst` | a daily 09:00 in Berlin stays 09:00 across the 23-hour and the 25-hour day |
| `plan-idempotent` | the same input, the same identifiers; unique; all carry `REMINDER_ID_PREFIX` |
| `plan-edit` | a new time, a new text, another channel → new identifiers |
| `plan-max-pending` | the default plan holds at most 64, nearest first; `maxPending: 10` keeps exactly the 10 nearest; 65 never plans more than 64 |
| `plan-past` | nothing at or before now; an occurrence one second ahead is not scheduled (lead time) |
| `plan-skip` | skip days (of a daily rule and of a once rule), ISO weekdays, one-off days |
| `plan-reject` | invalid rows and rows naming an undeclared channel are rejected, the others planned |
| `plan-data` | the data is exactly `{ kind: 'reminder', reminderId }`; text from `describe`, channel from the row |
| `reconcile-diff` | empty diff when equal; everything scheduled when nothing is pending; only prefixed identifiers cancelled; an occurrence due within the lead is in `imminentIds` and kept when pending, while a deleted reminder's is cancelled. Runs only after `plan-idempotent` and `plan-past` pass (it builds on them), so one planner bug is one problem |
| `tap-parse` | the round trip; junk, other kinds and unsafe ids are null |

## Configuration and layout

Folders come from `resolveLayout` (the canonical `src/` layout, `tsconfig.json` aliases,
`rn-skills.config.json`). This skill reads two keys of `rn-skills.config.json`; options win:

| Key | Option | Default |
|---|---|---|
| `remindersCoreDir` | `--core-dir <dir>` | `<coreDir>/reminders` (`src/core/reminders`) |
| `localNotificationsDir` | `--services-dir <dir>` (check-reminder-code only) | `<servicesDir>/local-notifications` |

The hooks are expected in `<srcDir>/hooks/`. `--json` adds the problems as one JSON line.

**When multi-package:** run each checker once per app with the app folder as the root; the
workspace's own `tsconfig.json` aliases resolve.

## Expected SKIP and NOT APPLICABLE lines

Neither checker prints SKIP lines: every file they check is this skill's own. The NOT APPLICABLE
lines are the two in "When they apply". The reference app of this library adopts the kit (no
reminder rows yet) and prints `RESULT: PASS` for both.

## Troubleshooting

- **`module-load`: Cannot find package '@/core'.** An alias the tsconfig does not declare, or a file
  of another skill that does not exist yet (`src/core/dates/date-key.ts` comes from
  seeded-determinism-and-golden-vectors; this skill ships a synced copy in `templates/`).
- **`module-load` on a `.tsx` or `react-native` import.** Move the code that needs React Native out of
  `src/core/reminders/`; the planner is pure.
- **`foreground-handler` after adopting push-notifications.** Two adapters call
  `setNotificationHandler`: pass `installForegroundHandler: false` to
  `createExpoLocalNotificationsAdapter` in the root-kit registry and let push's policy cover local
  notifications. Nothing in the copied adapter changes, and its test covers both settings.
- **`root-kit` in a fresh adoption.** The kit mounts both hooks, but only once the registry creates
  it: add `createLocalNotificationsKit(...)` to `src/services/create-root-kits.ts` as
  examples/create-root-kits.ts shows. `sync-on-foreground` and `tap-handling` then pass too.
- **`wall-clock` on a deliberate 24-hour constant.** Add `// not-a-calendar-day: <why>` above it, as
  `wall-clock.ts` does for the epoch-day arithmetic.
