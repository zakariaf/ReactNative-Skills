# The asking flow: when, how, and what happens after each answer

The decisions behind `usePermissionGate`, `nextAskStep` and the sheets, with the platform
guidance each one follows. Apple's text was read from the Human Interface Guidelines page "Privacy"
(`developer.apple.com/design/human-interface-guidelines/privacy`, fetched 2026-10-14 through
`developer.apple.com/tutorials/data/design/human-interface-guidelines/privacy.json`); Android's from
"Request runtime permissions" (`developer.android.com/training/permissions/requesting`, fetched
2026-10-14). Re-verify both before a release that changes a sheet.

## Contents

1. The one default
2. The seven states
3. The decision table (`nextAskStep`)
4. The explain sheet (before the first dialog)
5. Android's rationale sheet (before the second dialog)
6. After a refusal: respect it
7. The settings sheet (blocked)
8. Partial access is a grant
9. Unavailable
10. One ask at a time
11. Re-reading the state
12. Which permissions this flow covers (and ATT)
13. Writing the copy

## 1. The one default

A permission is asked **when the person presses the control that needs it**, through the feature's
model hook: `gate.requestAccess(onAllowed)`. Never at launch, never from an effect, never on a
screen's mount, never "to get it out of the way" during onboarding.

- Apple: "Request permission only when your app clearly needs access to the data or resource ...
  Ideally, wait to request permission until people actually use an app feature that requires
  access." and "Avoid requesting permission at launch unless the data or resource is required for
  your app to function."
- Android: "Ask for a permission in context, when the user starts to interact with the feature that
  requires it."

The only launch-time exception Apple names is an app that cannot work at all without the resource (a
navigation app and location). A Tasks app has none. If yours truly does, the contract entry's
`askedFrom` is the first screen's model and its `feature` says why; the checker still forbids the
startup files (`src/app/_layout.tsx`, `src/features/root-navigator/`), because those run before any
screen can explain anything.

## 2. The seven states

`src/core/permissions/permission-state.ts` (`PermissionState`):

| State | Meaning | iOS | Android |
|---|---|---|---|
| `granted` | full access | yes | yes |
| `limited` | partial access the person chose | "Select Photos" (iOS 14+), approximate location | "Allow limited access" to photos (Android 14+), approximate location |
| `provisional` | notifications delivered quietly without asking | yes (`allowProvisional`) | no |
| `undetermined` | never asked: the dialog can appear | yes | yes (Expo remembers whether it asked) |
| `denied` | refused, the dialog can appear once more | never reported | after the first "Don't allow" |
| `blocked` | the dialog will not appear again | after any refusal | after the second refusal |
| `unavailable` | no such capability, or the read failed | yes | yes |

The member names (`permission`, `requestPermission`) and the five shared states match the
notification ports of `push-notifications` and `local-notifications`, so their ports are a
`PermissionAccess` and use the same gate (section 12, "Notifications: the one contract").

## 3. The decision table (`nextAskStep`)

The state is read fresh at the press (`access.permission()`), never taken from a cached value:

| State | Step | What the person sees |
|---|---|---|
| granted, limited, provisional | `proceed` | the feature, at once |
| undetermined, `shouldExplainFirst: false` | `ask` | the system dialog (the control explains the need) |
| undetermined, `shouldExplainFirst: true` | `explain` | the app's explain sheet, then the system dialog |
| denied (Android only) | `rationale` | Android's educational sheet: Continue or No thanks |
| blocked | `settings` | "Camera access is off" and a button to the Settings app |
| unavailable | `unavailable` | "This device has no camera" (or hide the control) |

## 4. The explain sheet (before the first dialog)

Most controls explain themselves: a "Take photo" button needs no essay before the camera dialog.
Set `shouldExplainFirst: true` only when the context does not make the need obvious (a background
location feature, contacts for "find friends"). Apple: "Ideally, the current context helps people
understand why you're requesting their permission. If it's essential to provide additional details,
you can display a custom screen or window before the system alert appears."

When you show it, Apple's rules for pre-alert screens apply (they cover camera, microphone, location,
contacts, calendar and tracking), and the template follows them:

- **Exactly one button, and it opens the system dialog.** "Include only one button and make it
  clear that it opens the system alert."
- **Call it "Continue" or "Next", never "Allow".** "Use a term like 'Continue' or 'Next' to title
  the single button ... clarifying that its action is to open the system alert." and "don't create a
  button title that uses 'Allow' or similar terms, because people don't allow anything in a
  pre-alert screen."
- **No close, no cancel, no "Not now".** "Don't include additional actions in your custom screen or
  window, unless needed to obtain a legal consent. For example, don't provide a way for people to
  leave the screen or window without viewing the system alert — like offering an option to close or
  cancel." (The system back gesture on Android still dismisses it; that is the platform, not a
  button.)
- **No incentive, no picture of the alert, no arrow at its buttons.** "Don't offer incentives for
  granting the request", "Don't show an image of the standard alert and modify it in any way", "Don't
  add a visual cue that draws people's attention to the system alert's Allow buttons."

This is why the explain sheet cannot "save" the one iOS dialog for later: once the person taps
Continue, the dialog appears. The saving happens earlier, by asking only from the press that needs
the permission.

## 5. Android's rationale sheet (before the second dialog)

On Android a first refusal leaves `denied`: the OS shows its dialog once more. Before that second
dialog, Android asks for an educational screen (`shouldShowRequestPermissionRationale()` is true):
"show an educational UI to the user. In this UI, describe why the feature that the user wants to
enable needs a particular permission." It also requires a way out: "include a 'cancel' or 'no thanks'
button that lets the user continue using your app without granting the permission." and "Don't block
the user."

So the `rationale` sheet has two buttons: `explain.continue` (shows the second and last dialog) and
`explain.dismiss` ("No thanks", nothing is asked). iOS never reaches this sheet: it reports no
`denied` state.

## 6. After a refusal: respect it

When the person refuses in the system dialog, the gate does nothing more: no sheet, no Settings link,
no retry. The state the view shows becomes `denied` or `blocked`, and the control may say so quietly
("Camera access is off"). Android: "respect the user's decision. Don't link to system settings in an
effort to convince the user to change their decision." The settings sheet appears only on a **later**
press, when the person asks for the feature again: that press is their new intent.

The feature keeps working without the permission wherever it can (attach from the photo picker, type
an address instead of locating). App Review guideline 5.1.1(iv) asks the same: "Where possible,
provide alternative solutions for users who don't grant consent."

## 7. The settings sheet (blocked)

`blocked` means no dialog can appear, so calling `requestPermission` again is pointless (it resolves
at once with the same answer). The sheet says what is off and why it matters, and offers one action:
`settings.open` → `PermissionsPort.openSettings()` → React Native's `Linking.openSettings()` (iOS: the
app's page with its switches; Android: App info, where "Permissions" lists each). A second button,
`settings.dismiss`, closes it; this sheet is not a pre-alert screen, so a close button is right.

When the person comes back, the status mirror re-reads (section 11). The gate does not run the held
action automatically: the person presses again, which keeps every dialog and every action tied to a
press.

## 8. Partial access is a grant

`limited` is allowed (`isPermissionAllowed`). A photo feature works with the photos the person chose;
a location feature works with approximate location unless precision is the whole point (then say
so, and on iOS ask for temporary full accuracy through expo-location's API, not by re-asking).
Mapping `limited` to `denied` locks people out who said yes; mapping it to `granted` makes the app
promise photos it cannot see. `toPermissionState` reads `accessPrivileges` (expo-image-picker,
expo-media-library) and the location accuracy (`ios.accuracy === 'reduced'`,
`android.accuracy === 'coarse'`).

## 9. Unavailable

A device without the capability (no camera, a simulator, web) or a failing read answers
`unavailable`. The feature hides or disables its control (the example model's `isCameraMissing`), and
a press shows the `unavailable` sheet at most. It never asks. The sheet's copy is the contract's
optional `unavailable` group (`title`, `body`, `dismiss`: "No camera available", what cannot work and
that the rest still does); a feature that always hides its control may leave the group out, and its
view then renders no unavailable sheet.

## 10. One ask at a time

Expo's Android permission service throws "Another permissions request is in progress. Await the old
request and then try again." on a second request while one is open (expo-modules-core 57,
`PermissionsService.kt`, read in source). The gate holds a lock (`runExclusive`): a second press
while an ask runs is ignored, and `isAsking` disables the control.

## 11. Re-reading the state

A permission changes outside the app: the person flips the switch in Settings, Android resets the
permissions of an app unused for months ("If your app targets Android 11 (API level 30) or higher and
is not used for a few months, the system ... automatically reset[s] the sensitive runtime
permissions"), and a one-time grant ("Only this time", Android 11+) expires. Android ends the
app's process when a permission is revoked ("if the user revokes your app's one-time permission,
your app's process terminates"); iOS ends it after some privacy changes ("Some permission changes
will terminate the application if running", `xcrun simctl help privacy`) and not after others, so
the app cannot count on a fresh start either way. So
the status the view shows is an OS mirror (`permission-status-mirror.ts`) that re-reads every time
the app becomes active, and every press reads fresh again before deciding.

On iOS the system dialog itself moves the app to `inactive` and back to `active`: the mirror re-reads
after every dialog (harmless), and code that pauses or tears down state on `inactive` must not treat
a permission dialog as leaving the app.

## 12. Which permissions this flow covers (and ATT)

Every runtime permission the app asks for through an Expo module or `PermissionsAndroid`: camera,
microphone, photos (read and add-only), location (foreground and background), contacts, calendar,
reminders, motion, notifications, Bluetooth.

**Notifications: the one contract** (local-notifications and push-notifications cite this section).
The notification permission is one OS permission, and the app's `PermissionsPort` has one access for
it:

- **The access.** `PermissionKind` gains `notifications`; the composition root binds
  `access.notifications` to a notification port, which is a `PermissionAccess` as is (its
  `permission`/`requestPermission` return the five shared states): push-notifications' `PushPort`
  when push is adopted, local-notifications' `LocalNotificationsPort` otherwise:
  `notifications: { permission: push.permission, requestPermission: push.requestPermission }`.
- **The ask.** The model of the press that needs notifications ("Remind me", "Notify me") asks through
  `usePermissionGate({ access: permissions.access.notifications, ... })` and runs the feature's own
  flow from `onAllowed`: `reminderSync.enable()` (local) or `optInToPush(...)` (push). Both find the
  permission allowed and only sync channels, then schedule or register; neither prompts again. The
  explain, rationale and settings sheets are this skill's.
- **Channels.** Both notification skills create their Android channels at launch and before their
  own asks (Android issues no push token before a channel exists, and an app targeting 12L or lower
  gets no dialog before one); the gate's dialog needs nothing more on targetSdk 33+.
- **Without this skill** the two flows still ask by themselves from the press and answer `blocked`
  for the Settings hand-off; the moment this skill is adopted, the gate becomes the asking place.

An app that adopts either notification skill needs this entry (no `purposeKey`: iOS has no purpose
string for notifications), with the catalog keys and a sibling test of the asking model:

```json
{ "kind": "notifications", "feature": "Reminders when a task is due", "askedFrom": "src/features/task-detail/use-task-reminder-model.ts",
  "platforms": ["ios", "android"], "shouldExplainFirst": false,
  "explain": { "title": "permissions.notifications.explain.title", "body": "permissions.notifications.explain.body", "continue": "permissions.continue", "dismiss": "permissions.not-now" },
  "settings": { "title": "permissions.notifications.settings.title", "body": "permissions.notifications.settings.body", "open": "permissions.open-settings", "dismiss": "permissions.close" } }
```

**App Tracking Transparency is not asked here.** `admob-ads-and-consent` owns it: the ConsentPort asks
after Google's consent form and before the first ad request, never in a child-directed app, and its
adapter is the only importer of expo-tracking-transparency. Apple's pre-alert rules in section 4
apply to an ATT explainer too; its own rules add: "you can't withhold functionality or content or
make your app unusable until people allow you to track them."

## 13. Writing the copy

Each permission has three texts, plus an optional fourth, all catalog keys (contract `purposeKey`,
`explain.*`, `settings.*`, `unavailable.*`), translated in every app language
(`i18n-strings-and-catalogs`):

| Text | Where it shows | Write |
|---|---|---|
| purpose string | inside the system dialog, after the app name | one active sentence: what the feature does with it, and where the data goes |
| explain sheet | before the first dialog, only when the control does not explain the need | the benefit in the person's terms; "Continue" |
| settings sheet | after a block, on a later press | what is off, what turning it on gives, where the switch is |
| unavailable sheet (optional) | a press on a device without the capability, or after a failed read | what cannot work here and that the rest of the feature still does; one "Close" |

Apple's purpose-string examples: "The app records during the night to detect snoring sounds." (good:
"An active sentence that clearly describes how and why the app collects the data") against
"Microphone access is needed for a better experience." ("A passive sentence that provides a vague,
undefined justification") and "Turn on microphone access." ("An imperative sentence that doesn't
provide any justification"). The Tasks example: "Lets you add a photo to a task. Photos stay on this
device unless you share them."
