# Taps: from a notification to the right screen

What happens when the person taps a reminder, on a warm and a cold start, and how this coexists with
push notifications and other notification sources.

## Contents

- The data contract
- The tap flow
- Cold start and the navigator
- Push notifications and other sources in the same listener
- Action buttons (an extension)
- Tests

## The data contract

A reminder notification carries `data: { kind: 'reminder', reminderId }` (`reminderTapData`) and
nothing else: no path, no title, no URL.

- A notification outlives the code that scheduled it: an update renames `/tasks/[id]`, the person
  deletes the task, or a reminder scheduled by an old build is tapped after an upgrade. Reading the
  row again at tap time gives its current subject (the task), or none.
- Notification data is untrusted input like any deep link: `parseReminderTap` accepts only the exact
  shape with a short id of letters, digits, `_` and `-` and returns null for anything else
  (`tap-parse`). Other kinds pass through untouched.
- The `kind` value `'reminder'` is reserved: push-notifications' message kinds never use it, so the
  two parsers never claim each other's notifications.

## The tap flow

1. The OS delivers the response; the adapter turns it into a `NotificationTap`
   (`{ id, action, data }`, `action: 'open'` for a tap on the notification itself).
2. `useReminderTaps` parses the data; a tap that is not a reminder is left alone.
3. It clears the last response for every reminder tap, repeats included (the native emitter stores
   every response it delivers as the last one, so the listener's copy of the launch tap sets it again
   and a remount would reopen it), then keeps only `action === 'open'` and each notification id once
   (the launch read and the listener can both report the same tap) and calls
   `openReminder(reminderId)`.
4. `openReminder` (the kit's: `router.navigate(hrefForReminder(id))`, with the app's
   `hrefForReminder` from examples/create-root-kits.ts) reads the row's subject
   (`findReminder` → `{ taskId }`) and maps it to a typed href: present →
   `{ pathname: '/(app)/tasks/[taskId]', params: { taskId } }`; missing or inactive → `'/'`. No path
   is stored anywhere: with typed routes (navigation-and-routing) a stored string would need an
   `as Href` cast, and a renamed route would fail only at tap time instead of in `tsc`. Paths that
   arrive from outside the app (universal links) are validated by deep-links-and-universal-links.

Never write to the database from a tap handler that runs without the app's UI: on Android a
notification action can run JS headless (registerTaskAsync, push only). The skill's taps run in the
app's JS context, after the providers mounted.

## Cold start and the navigator

A tap on a notification of a killed app launches it; that tap happened before any listener existed,
so it is only available through `getLastNotificationResponse()`. `useReminderTaps` reads it once
on mount. The local notifications root kit mounts it inside the navigator, beside the root Stack
(app-startup-and-bootstrap's effects slot in `app-stack.tsx`): navigating from the root layout before
the navigator mounted throws in Expo Router ("Attempted to navigate before mounting the Root Layout
component"). The splash stays until the startup gate
releases it (app-startup-and-bootstrap), so the person sees the target screen, not a flash of home.

## Push notifications and other sources in the same listener

expo-notifications reports every tap, local or remote, to every response listener. The contract with
push-notifications:

- Each side parses its own data and ignores the rest (`parseReminderTap` → null for a push kind;
  `parsePushData` → null for `{ kind: 'reminder' }`), so two listeners never handle the same tap.
- The launch tap is one shared value (expo-notifications keeps a single last response for the
  process). Each side clears it only after it has handled a tap of its own kind:
  `useReminderTaps` calls `clearLastTap()` as soon as `parseReminderTap` accepted the tap (before
  the repeat check), and push's router clears only when `parsePushData` accepted it, repeats
  included. A side that clears first and parses second
  erases the other side's cold-start tap whenever its effect happens to run first; effect order is
  not a contract. The local adapter is
  `src/services/local-notifications/expo-local-notifications-adapter.ts`.
- There is exactly one `setNotificationHandler`: the local adapter's when only reminders exist,
  push-notifications' adapter when push is adopted (its foreground policy returns the loud
  presentation for `isRemote: false`). The composition root then creates the local adapter with
  `installForegroundHandler: false`; the copied adapter is not edited, and check-reminder-code
  stops counting its call site.
- Channel ids are unique across the app: `reminders` here, push's own ids there; each side syncs its
  own channels (`setNotificationChannelAsync` per id is independent).
- The notification permission is one OS permission with one `PermissionAccess` in the app's
  `PermissionsPort` (permissions-and-system-prompts owns the port, the gate and the sheets): the
  composition root binds `permissions.access.notifications` to push's port when push is adopted,
  to this port otherwise (both return the same five states). Each feature asks through
  `usePermissionGate` from its own press and then calls its own flow (`sync.enable()` here,
  `optInToPush` there), which finds the permission allowed and does not prompt again.

## Action buttons (an extension)

"Done" and "Snooze" buttons need a category (`setNotificationCategoryAsync`, set once at startup, iOS
`categoryIdentifier` on the content). Each action writes the row (skip today, an `at` row an hour
ahead) and requests a sync, exactly like the in-app press; the tap hook then routes on
`tap.action`. Android may run an action's JS headless (only with `registerTaskAsync`), iOS opens the
app unless the action has the background option: keep the action's write idempotent and let the
next foreground sync settle the plan.

## Tests

- `src/core/reminders/reminder-tap.test.ts`: the round trip and every junk shape.
- `src/hooks/use-reminder-taps.test.ts`: the launch tap opened once and cleared, cleared again
  when the listener delivers it a second time, repeats ignored, action buttons and foreign kinds
  ignored (a foreign launch tap stays set), nothing after unmount (the fake port's `tap()`).
- E2E (e2e-maestro): schedule a reminder a minute ahead through a debug hook, background the app,
  wait, tap the notification in the shade, assert the task screen's testID.
