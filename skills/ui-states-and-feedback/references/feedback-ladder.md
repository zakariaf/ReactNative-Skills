# The feedback ladder: inline, notice, banner, dialog

Which surface a message may use, how the one notice and the one question behave on iOS and Android,
and why a reversible action gets Undo instead of a confirmation.

## Contents

1. The ladder
2. The notice (one at a time)
3. Notice lifetime and accessibility timeouts
4. Reading notices on iOS and Android
5. The offline banner
6. Confirmations
7. Undo over confirm
8. Why not Alert.alert
9. Mounting the host
10. With ui-component-library
11. Testing
12. Verified facts

## 1. The ladder

Take the lowest rung that works. Each step up takes control away from the person, and only the top
one blocks.

| Rung | Lifetime | Use it for | Never for |
|---|---|---|---|
| **Inline** (in the field, row or region it concerns) | until resolved | validation (forms-and-input), a row that failed to sync, an empty region, a list that may be out of date | a condition of the whole app |
| **Notice** (a toast/snackbar line, `notify()`) | seconds, then it leaves | a completed action and its Undo; a failure that already recovered (nothing changed) | anything the person must act on later or might want to re-read; a lasting condition |
| **Banner** (`OfflineBanner`) | while the condition lasts | offline, a degraded mode, expired data | a one-off result |
| **Dialog** (`confirm()`) | blocks until answered | a decision that must be made now about something that cannot be undone | reporting a result ("Saved!"), showing information, anything reversible |

A failure the person must act on (sign in again, free some space) is inline on the screen that
owns it or a banner, never only a notice: a notice leaves, can be missed, and a screen-reader user
mid-sentence may never hear it.

## 2. The notice (one at a time)

`notice.ts` holds the reducer: showing **replaces** the notice on screen, closing closes only the
notice it names (by serial), so a late timer never closes a newer notice. There is no queue: a queue
shows old news late ("Task deleted" ten seconds after the person moved on). The `FeedbackProvider`
holds the one notice for the whole app, so two screens can never show two notices and a notice
survives a navigation.

A notice has one short sentence and at most one action (Undo). Its testID is
`<screen>.<what>-notice`; the parts `.text`, `.action` and `.dismiss` derive from it.

## 3. Notice lifetime and accessibility timeouts

`noticeLifetimeMs(notice, isScreenReaderOn)`:

| Notice | Screen reader off | Screen reader on |
|---|---|---|
| result only ("Task saved") | 4 s floor | 4 s floor |
| with an action (Undo) | 8 s floor | **stays until dismissed**, with a Dismiss button |

The floor goes through `AccessibilityInfo.getRecommendedTimeoutMillis(floorMs)`
(`notice-timer.ts`): on **Android** it returns the person's "Time to take action" (Accessibility
timeout) setting when that is longer; on **iOS** it resolves the value unchanged (verified in React
Native 0.86's `AccessibilityInfo.js`). The timer never fires sooner than the floor, also when the
lookup fails, and a cancel covers an answer that arrives after the notice already left. A timed
action a screen-reader user cannot reach in time breaks WCAG 2.2.1 (Timing Adjustable), so the
action notice stays.

## 4. Reading notices on iOS and Android

- **Android (TalkBack)** reads a view with `accessibilityLiveRegion="polite"` when it appears or
  changes (`accessibilityLiveRegion` is Android only in React Native's types).
- **iOS (VoiceOver)** reads no live region. The host therefore announces each notice once on iOS
  with accessibility-as-code's `useAnnounce()` (queued, so it does not cut the current speech).
  Announcing on Android too would read it twice.
- The text alone is the accessible alert (`accessibilityRole="alert"` on the text's wrapper). An
  accessible container around the text and the Undo button would merge them into one element and
  hide the button from both screen readers.
- `announce-ios` flags a `.tsx` file in the features folder or `src/ui/feedback` that renders a live
  region or a `<Toast>` when neither it nor any other file of its feature folder calls
  `useAnnounce()`. A pure view renders the live region and its model hook announces (forms-and-input's
  editor does this for a failed save); that passes.

## 5. The offline banner

`OfflineBanner` reads `useReachability(services.connectivity)`, the app's one ConnectivityPort
(networking-and-server-state owns it; never expo-network or NetInfo in a screen):

| Reachability | iOS | Android | Banner |
|---|---|---|---|
| `none` | no network | no network | "You're offline. Changes sync when you're back online." |
| `unvalidated` | never (iOS does not validate) | connected, but Android has not validated the internet (captive portal, a firewall blocking the probe, a VPN reporting no bandwidth) | the softer "You're connected, but the internet may not be reachable." Requests still run |
| `reachable` | connected | connected and validated | no banner |

The banner sits above the content of each data screen and stays while the condition lasts. A
change while the screen is open is spoken once (live region on Android, `useAnnounce()` on iOS); a
banner already up when a screen mounts is not announced, because it is the first element a screen
reader reads there and every screen opened while offline would otherwise repeat it. Being offline is never a notice
(`offline-notice`): the notice would leave while the person is still offline. The data screen adds
its own `offline` state or list notice (states-and-the-switch.md).

## 6. Confirmations

`confirm(request)` returns `Promise<'confirmed' | 'cancelled' | 'dismissed'>`:

- **Only `'confirmed'` runs the action**: `if (outcome !== 'confirmed') return;`. `'dismissed'`
  covers every way out that is not a button: Android's back button and predictive back gesture
  (`onRequestClose` on the Modal), a newer question replacing this one, the host unmounting. Code
  that returns only on `'cancelled'` runs the action when the person pressed back
  (`confirm-outcome`).
- **The title names the consequence and its count** ("Delete 3 done tasks?"), the body says what
  cannot be undone, the confirm button carries the verb ("Delete tasks"), Cancel comes first (the
  safe choice at the start, mirrored in right-to-left). "Are you sure?" and "OK" are tapped through
  without reading (`confirm-vague` flags such keys and shared `common.*` labels).
- A tap on the scrim does nothing: the question must be answered. The scrim is the modal root
  (`accessibilityViewIsModal`). On Android the dialog is a React Native `Modal`, its own window, so
  TalkBack stays inside and back answers `'dismissed'`. On iOS it renders in the overlay window
  with the window's accessibility modal on, so VoiceOver stays inside (section 9 says why it is not
  a `Modal` there). An app that adopts design-visual-parity renders `<ParityLaunchMarker />` as the
  first child of the scrim's `accessibilityViewIsModal` view, or composes ui-component-library's
  Scrim, so captures of the dialog find the launch marker (that skill's check-harness enforces it).
- `tone: 'destructive'` paints the confirm button in the danger colours.
- Every `confirm()` has a literal testID declared in `contracts/screen-states.json` `confirmations`
  with `whyNotUndo` (`confirm-undeclared`): the review question "could this be Undo instead?" is
  answered in writing once.
- A press-and-hold confirmation (reset all data) is ui-component-library's `useHoldToConfirm`, with
  a screen-reader action; the decision rules above still hold.

## 7. Undo over confirm

A reversible change happens at once and offers Undo:

```ts
await runUndoable(
  { apply: () => softDelete(id), revert: () => restore(id) },
  { doneText: t('tasks.deleted'), undoLabel: copy.undoLabel, testID: 'tasks.deleted-notice' },
  { notify: feedback.notify, onFailure, recordError },
);
```

- **Why**: nearly everyone who deletes meant it; a question punishes all of them and teaches them to
  tap through it, so it does not protect the rare slip either. Undo is faster for the many and
  safer for the few.
- **The change is written before the notice shows** (a soft delete: a `deletedAt` column, or a move
  to a trash list). A notice that times out, is replaced, or dies with the app therefore loses
  nothing, and Undo restores exactly. Purging soft-deleted rows later is the data layer's job
  (persistence-and-migrations; data-export-and-restore keeps them out of exports).
- Do not hold the change in memory and commit it when the notice closes: a kill during the window
  brings the item back, and two pending deletes race each other.
- A failed apply shows no Undo (nothing happened); a failed revert is reported where the change was
  asked for. Undo that cannot really restore is worse than no Undo.
- Confirm instead only when no restore exists (a server that deletes for good, sending a message,
  spending money, wiping all data), and declare why.

## 8. Why not Alert.alert

`native-alert` flags `Alert.alert` and `Alert.prompt` in app code:

- On Android at most three buttons show, mapped to neutral, negative and positive by position, and
  `style: 'destructive'`/`'cancel'` are ignored (iOS only).
- With no buttons Android shows "OK" in English: the text is not translated.
- `cancelable` is false by default on Android; with it true, a back press or a tap outside calls
  only `onDismiss`, an outcome most call sites never handle.
- It is native UI: React Native Testing Library cannot see or press it, so the decision is untested.
- It reports results as a dialog, the top rung, where a notice belongs.

Use `notify()` for a result and `confirm()` for a decision.

## 9. Mounting the host

One `FeedbackProvider` for the whole app, around the root Stack and below `MotionConfig`, the i18n
provider and the navigation theme (`examples/app-feedback.tsx`; app-startup-and-bootstrap and
navigation-and-routing own the full root order). It needs the translated Dismiss label, the bottom
safe-area inset (Expo Router's root provides `SafeAreaProvider`), and reduce motion. The context
carries only `notify` and `confirm`, two stable functions, so a new notice re-renders the host, not
every screen. A question still open when the host unmounts is answered `'dismissed'`, so no caller
waits forever.

The notice docks above the bottom inset. When a screen has a keyboard open, keep the notice above
it (forms-and-input's keyboard handling) or show the result inline instead.

**Modal screens differ by platform.** With Expo Router's native stack, a screen presented as
`modal`, `formSheet` or `fullScreenModal` is, **on iOS**, its own view controller presented above
the root view, so anything rendered as a sibling of the navigator in the root (the notice dock)
sits behind it: "Task deleted" with Undo from a modal screen would be invisible. **On Android** the
same screen stays in the one view hierarchy and the dock shows. `NoticeHost` therefore renders its
dock through `AboveModalScreens` (`above-modal-screens.tsx`): on iOS that is react-native-screens'
`FullWindowOverlay` (installed with Expo Router), which adds its children to the window above the
presented screens; on Android it renders the children in place (the overlay is iOS only and warns
elsewhere). Two details matter:

- `FullWindowOverlay` is an accessibility modal by default (`accessibilityContainerViewIsModal`
  defaults to true natively), which would trap VoiceOver in the notice and hide the screen;
  `AboveModalScreens` passes `unstable_accessibilityContainerViewIsModal={false}`.
- The overlay stacks above screens presented **before** it mounted: it adds its container to the
  window only when it is not there yet (`RNSFullWindowOverlay`'s `maybeShow`, react-native-screens
  4.26.2). `NoticeHost` renders nothing without a notice and keys the overlay by the notice's serial
  (`<AboveModalScreens key={notice.serial}>`), so every notice, a replacement included, mounts a new
  overlay on top of the window, above any modal presented since. Without the key a replacement would
  reuse the mounted overlay and stay hidden behind a sheet opened in between (delete with Undo, open
  an edit sheet, save: "Task saved" invisible). A modal presented while a notice is still up covers
  that notice until the next one replaces it.

The confirmation has the same problem in another form. A React Native `Modal` on iOS is presented
from the nearest view controller of the view that hosts it (`reactViewController`, the first view
controller up the responder chain). For the one host in the root that is the root view controller,
which is already presenting the modal screen, and UIKit refuses to present a second controller from
it, so `confirm()` would never show and never resolve. `ConfirmDialog` therefore renders through
`AboveModalScreens` with `isAccessibilityModal` on iOS (VoiceOver stays inside, as with a `Modal`)
and keeps the `Modal` on Android, where back answers `'dismissed'`. On iOS it appears without the
`fade`; an app that wants one adds an entering moment (motion-and-animation).

## 10. With ui-component-library

The templates' views (`NoticeHost`, `ConfirmDialog`, `StateMessage`, `OfflineBanner`,
`SkeletonBlock`) are deliberately plain: `AppText`, `PressableSurface` and theme tokens only, so the
skill works in an app without a component library. When the app has ui-component-library's
catalogue, render through its parts and keep the logic files:

| Here | Render with |
|---|---|
| `NoticeHost` | `Toast` (and `ToastStack` only for a progress line followed by its result) |
| `ConfirmDialog` | `Scrim` + `DialogCard` + `DialogButtonRow` |
| `StateMessage` | `EmptyState` with a `Button` as its action |
| busy controls | `Button` with `isBusy` and `BusyIndicator` |

`src/ui/feedback/` is owned by this skill, not by the catalogue: its files are listed in no
catalogue and follow this skill's tests. ui-component-library's `check-components` leaves the folder
alone by default (`feedback/**` is in its default `exclude`, next to `a11y/**`, `icons/**`,
`motion/**` and `adaptive/**`). A catalogue's `exclude` list replaces that default, so an app whose
`contracts/component-library.json` sets `exclude` keeps `"feedback/**"` in it; an older catalogue
copied before the folder joined the defaults adds it there.

The host components still keep the house component rules: `NoticeHost` and `ConfirmDialog` take a
required `testID` (`app.notice` and `app.confirm` from `FEEDBACK_TEST_IDS`), the hook lives in its
own `use-feedback.ts`, and the confirm buttons' minimum width is a named, commented constant.

## 11. Testing

- `notice.test.ts`: replace, close by serial, a late close ignored, lifetimes per screen-reader state.
- `notice-timer.test.ts`: fake timers with `doNotFake: ['setImmediate']` (so `flushMicrotasks()`
  still works), the recommended timeout honoured, the floor kept on a failed lookup, cancel before
  and after the answer.
- `notice-host.test.tsx` (iOS, the default Jest platform) and `notice-host.android.test.tsx` (the
  Android project of the canonical Jest config): announced once on iOS, left to the live region on
  Android; Undo runs and closes; an action notice stays with Dismiss while a screen reader runs.
- `notice-host.test.tsx` also proves the replacement case: a new serial gives a new
  `RNSFullWindowOverlay` instance.
- `above-modal-screens.test.tsx` and `.android.test.tsx`: on iOS the children sit in an
  `RNSFullWindowOverlay` host whose `accessibilityContainerViewIsModal` is false; on Android they
  render in place with no overlay and no warning.
- `confirm.test.ts` and `feedback-provider.test.tsx`: three outcomes, a newer question dismisses
  the older, the host unmounting answers `'dismissed'`, a missing provider throws a clear error.
- `undoable.test.ts`: apply then Undo reverts once; a failed apply shows no notice; a failed revert
  and a broken never-reject contract are reported.
- On devices (by hand, once per release): VoiceOver reads a notice once; TalkBack reads it once;
  with Android's "Time to take action" at 1 minute a result notice stays a minute; back on Android
  closes a confirmation as dismissed; **from a `modal` or `formSheet` screen on iOS, a notice is
  visible and its Undo works, and a confirmation opens and answers**; **a replacement notice shows
  above a modal opened after the first notice appeared** (delete with Undo, open an edit sheet,
  save); VoiceOver still reaches the
  screen under a notice and stays inside a confirmation (the overlay posts a layout change when it
  mounts, so check that the notice is read once, not twice). Not run on a device for this skill yet:
  the overlay and `Modal` behaviour above is read from react-native-screens' and React Native's
  source; a report owes this check until it ran.

## 12. Verified facts

Verified on 2026-10-10 against React Native 0.86.3 in the reference app.

| Fact | Re-verify |
|---|---|
| `getRecommendedTimeoutMillis` asks Android's native module and resolves the original value on iOS | `grep -n "getRecommendedTimeoutMillis" -A16 node_modules/react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo.js` |
| `accessibilityLiveRegion` is Android only | `grep -n "accessibilityLiveRegion" -A5 node_modules/react-native/Libraries/Components/View/ViewAccessibility.d.ts` |
| Android `Alert`: at most three buttons (neutral, negative, positive), "OK" default, `cancelable` false by default, `onDismiss` | `sed -n 80,140p node_modules/react-native/Libraries/Alert/Alert.js` |
| Expo Router's root renders `SafeAreaProvider` | `grep -n "SafeAreaProvider" node_modules/expo-router/build/ExpoRoot.js` |
| react-native-screens 4.26.2: `FullWindowOverlay` renders a plain `View` (with a console warning) off iOS, and its native `accessibilityContainerViewIsModal` defaults to true | `grep -n "Platform.OS\|accessibilityContainerViewIsModal" node_modules/react-native-screens/src/components/FullWindowOverlay.tsx node_modules/react-native-screens/src/fabric/FullWindowOverlayNativeComponent.ts` |
| The iOS overlay container is added to the window (`maybeShow`), above views presented earlier, and passes touches through where it has no subview (`pointInside`) | `grep -n "maybeShow\|pointInside\|_accessibilityContainerViewIsModal = YES" node_modules/react-native-screens/ios/RNSFullWindowOverlay.mm` |
| The native stack presents a modal screen from its navigation controller (UIKit hands it to the root view controller); a React Native `Modal` presents from its host view's nearest view controller | `grep -n "presentViewController" node_modules/react-native-screens/ios/RNSScreenStack.mm node_modules/react-native/React/Fabric/Mounting/ComponentViews/Modal/RCTModalHostViewComponentView.mm; grep -n "reactViewController" -A10 node_modules/react-native/React/Views/UIView+React.m` |
