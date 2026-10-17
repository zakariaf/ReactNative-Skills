# Overlays, dialogs and sheets

A dialog, an overlay or a sheet is a screen of its own in the contract, with its ids, states, view
and view test. This page says which presentation to choose, how to keep VoiceOver and TalkBack inside
it, how Android's back closes it, and how its model opens it. Facts about React Native's `Modal` and
the native-stack presentations were verified by reading the types of React Native 0.86.3 and
expo-router 57.0.24 on 2026-10-10 (re-verify: `grep -n "onRequestClose\|navigationBarTranslucent"
node_modules/react-native/types_generated/Libraries/Modal/Modal.d.ts`), and the Android translucent
bars by reading React Native 0.86.3's `ReactModalHostView.kt` and `Modal.js` the same day (re-verify:
`grep -n "isEdgeToEdgeFeatureFlagOn" node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt`
and `grep -n "translucent navigation bar" node_modules/react-native/Libraries/Modal/Modal.js`); the
screen-reader behaviour is each platform's documented behaviour, to confirm on a device with
VoiceOver and TalkBack on.

## Contents

- Choosing the presentation
- Keeping screen readers inside
- Android back and the predictive back gesture
- Who opens it
- The template dialog
- Tests

## Choosing the presentation

| The design shows | Contract `presentation` | Build it as |
|---|---|---|
| a full page sliding up, its own back or close, a URL of its own | `modal-route` | an Expo Router route with `<Stack.Screen options={{ presentation: 'modal' }} />` (or `formSheet`, `pageSheet`, `fullScreenModal`) |
| a small card over a dimmed screen asking one question (confirm, choose) | `dialog` | React Native's `Modal` (transparent) or the library `Scrim` + `DialogCard`, drawn by the screen that asks |
| a sheet from the bottom with a few options | `sheet` | a `formSheet` route with detents (then `modal-route`), or an in-tree sheet inside `Modal` |
| a layer over the same screen (a coach mark, a result card over a board) | `overlay` | `Modal`, or a full-window view that is the modal root (next section) |

A `transparentModal` route leaves the screen behind visible and reachable: declare it `overlay` and
keep a modal root inside it. On Android, `modal` presents like a regular push (there is no card
sheet); the contract and the ids do not change.

## Keeping screen readers inside

Without a modal root, VoiceOver swipes and TalkBack's linear navigation leave the dialog and read the
list behind it, and a person can activate a control they cannot see.

- **React Native's `Modal`** opens its own window on iOS and Android: both screen readers stay inside
  it. This is the default (`overlay-not-modal` accepts it).
- **A modal root component**: ui-component-library's `Scrim` renders in `Modal`, carries
  `accessibilityViewIsModal` on the scrim (never on the card, which would hide the scrim's testID),
  and closes on Android back. List other roots in `policies.modalRoots` or mark them `modalRoot` in
  the component catalogue. A listed root is **trusted** to keep the screen reader inside and to close
  on Android back in its own file: both overlay rules skip a layer that renders it. The library
  `Scrim` earns that trust (ui-component-library's `modal-back` checks it); a third-party sheet does
  not by default. `@gorhom/bottom-sheet`'s `BottomSheetModal`, for example, does not close on
  Android back unless the app wires `BackHandler` itself. Before listing such a root, prove its back
  handling with a view test that fires back (`BackHandler.mockPressBack()` in Jest, or the Modal's
  `requestClose` event) and asserts the sheet closed.
- **`accessibilityViewIsModal` (or its alias `aria-modal`) on a full-window view** is read by
  VoiceOver only. On Android the screen
  behind must be hidden in the same change (`importantForAccessibility="no-hide-descendants"` or
  `aria-hidden` on the content behind the layer, never on the layer itself). That Android half is
  accessibility-as-code's rule (`modal-overlay-android` in its `check-a11y-code`), stated and checked
  there; `overlay-not-modal` here only requires one of the three roots, and `overlay-no-back` requires
  the layer to handle Android back itself (next section).
- **The bars under the dim.** Expo apps (SDK 54 and later) draw edge to edge, and there React Native
  0.86.3 forces a `Modal`'s `statusBarTranslucent` and `navigationBarTranslucent` on whatever the props
  say (`get() = field || isEdgeToEdgeFeatureFlagOn`), so the dim already covers both system bars. Set
  both anyway, and always together, so the dim covers the bars in an app without edge to edge too:
  React Native warns when `navigationBarTranslucent` is set without `statusBarTranslucent`.

## Android back and the predictive back gesture

`Modal`'s `onRequestClose` is called for Android's back button and the predictive back gesture
(Android 13 and later animate it); point it at the dialog's cancel handler, never at a no-op, or the
dialog traps the person (`overlay-no-back` fails a `Modal` without it, or with a handler that does
nothing). A full-window overlay without `Modal` handles back itself
(`BackHandler.addEventListener('hardwareBackPress', …)` in an effect that returns the unsubscribe,
react-components-and-hooks, or a `useBackHandler` hook); `overlay-no-back` fails a layer with neither.
A modal root (`Scrim`) closes on back in its own file, which ui-component-library's `modal-back`
checks. iOS has no back gesture for a transparent `Modal`; a sheet's swipe to
dismiss is `allowSwipeDismissal` with `onRequestClose`.

## Who opens it

- **The model of the screen that asks owns the state** (`pendingId` in `use-lists-model.ts`) and
  hands the view the dialog's translated copy or `null`. The dialog's contract entry names that model
  in `model`, which is where its copy keys are found.
- **Opened through the handler a person's press uses** (`onAskDelete(id)`); a screenshot run that
  needs the open frame calls the same handler once (screen-building.md, "Screenshots").
- **At most one dialog at a time.** An app with several dialogs from several screens keeps one dialog
  host above the navigator (a context that holds the current request and renders it), so two `Modal`s
  never stack: iOS will not present a second view controller over one that is still presenting, and
  the second dialog may never show. `examples/dialog-host.tsx` is the shape: one `DialogRequest`
  union by kind, `useOpenDialog()` for models, the host rendered after the navigator, an action that
  runs and then closes, and Cancel or back that only close. Plain yes/no questions use
  ui-states-and-feedback's `confirm()` instead, and on iOS a root host's `Modal` cannot show from a
  modal or form-sheet screen (the example's header says how to handle that).
- **Closing keeps the screen consistent**: confirm runs the change and re-reads the data; a failure
  becomes the screen's error state, never a dialog that stays open with nothing to do.

## The template dialog

`templates/src/features/lists/delete-list-dialog/delete-list-dialog.tsx` is a pure view drawn in
`Modal` (transparent, fade unless motion is reduced, `onRequestClose` = cancel, both bar props),
with a scrim (`delete-list-dialog.scrim`, `accessibilityViewIsModal`), a card, a title that is a
header, a body, and two actions: Cancel at the start, the destructive Delete at the end in the danger
colour, never looking primary. The actions wrap onto two lines at large text. The card and actions are
drawn locally only because the template must compile in a reference app without ui-component-library's
components. An app with the library composes `Scrim`, `DialogCard` and `Button` instead (the contract
then lists the card's derived parts, `delete-list-dialog.card.title` and `.body`, as `DialogCard`
parts, and `policies.primaryAction` matches the real primary).

## Tests

The dialog's view test renders it visible and, in every block, finds its ids, presses one action and
asserts the callback, and ends with the pressable audit. The screen's view test renders the screen
with a pending model and finds the dialog's card, so the wiring between the two is tested too. The
model-hook test opens, confirms, cancels and fails the delete.
