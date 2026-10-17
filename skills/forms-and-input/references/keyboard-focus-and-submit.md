# Keyboard, focus and submit

When errors appear, how the return key walks the form, how the keyboard stays out of the way on iOS
and Android, and how a submit saves without losing a character. Library facts were read in the
installed sources on 2026-10-10: react-hook-form 7.89.0 (`dist/index.esm.mjs`),
react-native-keyboard-controller 1.21.9 (`lib/typescript`, `src/`, `android/src`, `jest/index.js`)
and React Native 0.86.3; re-verify with `node -p "require('react-native-keyboard-controller/package.json').version"`.

## Contents

- When errors appear: the validation mode
- The focus chain
- A refused submit
- The keyboard: react-native-keyboard-controller
- The root: KeyboardProvider
- Forms scroll in KeyboardAwareScrollView
- Taps while the keyboard is up
- Pads without a return key: KeyboardDoneBar
- Android edge-to-edge and the soft input mode
- Submit: one void intent
- Keeping long input: drafts
- Leaving a form with unsaved changes
- Re-renders and React Compiler

## When errors appear: the validation mode

| `mode` | First validation of a field | After that | Use |
| --- | --- | --- | --- |
| `onSubmit` (react-hook-form's default) | on submit | on change (`reValidateMode`) | a one-field form (search, rename) |
| `onBlur` | on blur | on blur | rarely: errors lag behind fixes |
| **`onTouched`** (house default) | on the first blur | on every change | every form |
| `onChange` | on the first change | on change | never: "invalid email" at the first letter (`form-mode`) |
| `all` | blur and change | blur and change | never (`form-mode`) |

`onTouched` is quiet while the user types a field for the first time, speaks when they leave it, and
then clears the error the moment it is fixed. Submit still validates everything.

## The focus chain

`useTextField(form, name, { kind, next, onSubmit })` returns the chain props:

| Field | `enterKeyHint` | `submitBehavior` | `onSubmitEditing` |
| --- | --- | --- | --- |
| single line with `next` | `next` | `submit` (keeps the keyboard up) | `setFocus(next)` |
| last single line with `onSubmit` | `done` | `blurAndSubmit` | the form's submit intent |
| single line without either | `done` | `blurAndSubmit` | none |
| multiline | `enter` | `newline` | none (return makes a line) |

- `setFocus(name)` calls the registered ref's `focus()` inside a `setTimeout` (react-hook-form
  source), so the ref must be the input (`field.ref` passed to `TextField`'s `ref`, `field-ref`) and a
  test must run the timers before it asserts.
- `submitBehavior: 'submit'` keeps the keyboard open while focus moves; `blurAndSubmit` there would
  close and reopen it (a visible flicker on both platforms).
- `next` is typed `FieldPathByValue<Values, string>`: a typo in the next field's name is a compile
  error.
- The chain follows the visual order. A field that appears conditionally is skipped by naming the
  following field when it is hidden.
- After a multiline field, the user moves on by tapping the next field; do not hijack return.

## A refused submit

`handleSubmit(onValid, onInvalid)` validates the whole form. When it fails:

1. react-hook-form focuses the first field with an error, in registration order (`shouldFocusError`,
   true by default; it calls `ref.focus()`, also deferred with `setTimeout`). Never set it to false
   (`focus-error`): focus is how VoiceOver and TalkBack users find the problem.
2. `onInvalid` announces one sentence (`t('forms.submit.fix-fields')`) with `useAnnounce` (iOS has
   no live regions; on Android the field's live region speaks too).
3. Every field shows its error (submit marks them as touched).

Keep Save pressable while the form is invalid: a disabled button gives no reason, and a screen reader
user cannot find out what is missing.

## The keyboard: react-native-keyboard-controller

The library (1.21.9, in Expo SDK 57's module map and included in Expo Go; install with
`npx expo install react-native-keyboard-controller`) tracks the keyboard frame by frame on both
platforms and works the same on iOS and Android. What this skill uses:

| API | Use |
| --- | --- |
| `KeyboardProvider` | at the root; without it every view and hook below gets fallback values and does nothing (it warns "Couldn't find real values for `KeyboardContext`") |
| `KeyboardAwareScrollView` | the form's scroll view: scrolls the focused input above the keyboard (`bottomOffset` = the gap kept between caret and keyboard) |
| `KeyboardStickyView` | a view that rides on top of the keyboard (the Done bar) |
| `useKeyboardState(selector)` | read `isVisible`, `height` and the rest with a selector |

`KeyboardAwareScrollView` props worth knowing: `bottomOffset` (the gap kept between the focused
field's bottom edge, or a multiline field's caret, and the top of the keyboard: `SPACING.xl` on a
screen without a Done bar, `useDoneBarSpace().bottomOffset` with one), `extraKeyboardSpace` (more
scrollable room under the content, so the last field can scroll that far up), `mode: 'insets'` (the
default: content does not reflow while the keyboard animates; use `'layout'` only when a
`justifyContent: 'space-between'` layout must reflow), `disableScrollOnKeyboardHide`, `enabled`.
In 1.21.9 it scrolls only when `visibleRect - inputBottom <= bottomOffset`, and it scrolls the
focused field again whenever `bottomOffset` changes (`useEffect(..., [bottomOffset])` in
`src/components/KeyboardAwareScrollView/index.tsx`).

`KeyboardToolbar` (previous, next, done buttons) is not used: in 1.21.9 its buttons have fixed
English `accessibilityLabel`s and hints ("Next", "Moves focus to the next field", "Done", "Closes the
keyboard") and cap the Done text at `maxFontSizeMultiplier={1.3}` (read in
`src/components/KeyboardToolbar/compound/components/*.tsx`). Revisit when a release takes translated
labels and the app's text scale. check-forms' `pad-done-bar` therefore does not count it as a Done
bar; an app that accepts those labels anyway lists it in `forms.doneBars` (checks-and-tests.md).

## The root: KeyboardProvider

One `KeyboardProvider` wraps the root stack, inside `GestureHandlerRootView` and outside the motion
config and navigation theme (`examples/root-stack-keyboard-provider.tsx`):

```
RootLayout -> DirectionGate -> AppRoot (error net, providers) -> RootStack:
  GestureHandlerRootView -> KeyboardProvider -> MotionConfig -> navigation theme -> AppStack
```

The root composition order is navigation-and-routing's and app-startup-and-bootstrap's; this skill
owns the one provider, and app-startup-and-bootstrap's canonical `root-stack.tsx` already renders it. `check-forms` fails `keyboard-provider` while any app file imports the library
and no file renders the provider. Its Android-only props (`statusBarTranslucent`,
`navigationBarTranslucent`, `preserveEdgeToEdge`) stay at their defaults in an app that does not
change the system bars itself.

## Forms scroll in KeyboardAwareScrollView

```tsx
<KeyboardAwareScrollView
  testID="task-editor.form"
  contentContainerStyle={styles.content}
  keyboardShouldPersistTaps="handled"
  bottomOffset={props.keyboardSpace.bottomOffset}            // SPACING.xl when the screen has no Done bar
  extraKeyboardSpace={props.keyboardSpace.extraKeyboardSpace}
>
```

- Every screen with text fields scrolls in it (`keyboard-aware-scroll`), even a short form: at 200 %
  text or on a small phone in landscape, three fields no longer fit above the keyboard.
- React Native's own `KeyboardAvoidingView` is the old answer: it needs a per-platform `behavior`, a
  `keyboardVerticalOffset` equal to the header height, and on Android edge-to-edge it no longer gets
  a resized window to react to. keyboard-controller's `KeyboardAvoidingView` is fine for a bar pinned
  to the bottom (a message composer) that does not scroll.
- A list screen with a search field at the top needs neither: the field is never under the keyboard.
- A horizontal `ScrollView` inside the form (a row of tag chips) is not the form's scroller and may
  stay React Native's; it still sets `keyboardShouldPersistTaps="handled"` so the first tap on a chip
  is not swallowed (next section).

## Taps while the keyboard is up

`keyboardShouldPersistTaps` (React Native docs, 0.86): `'never'` (the default) dismisses the keyboard
on a tap outside the input and the children do not receive the tap; `'handled'` keeps the keyboard
when a child handled the tap; `'always'` never dismisses. With the default, the first tap on Save only
closes the keyboard and the user has to tap again. Every scroll container that holds fields sets
`"handled"` (`keyboard-persist-taps`), and so does every scroll view nested between it and the
button. A tap on empty space still closes the keyboard; `keyboardDismissMode="interactive"` (iOS) or
`"on-drag"` closes it on scroll.

## Pads without a return key: KeyboardDoneBar

The iPhone number pad, decimal pad and phone pad have no return key. A screen with a field of kind
`integer`, `decimal`, `phone` or `one-time-code` renders `KeyboardDoneBar` (`pad-done-bar`): a bar in
`KeyboardStickyView`, visible only while the keyboard is up (`useKeyboardState`), with one translated
Done button (`forms.keyboard.done`) built on `PressableSurface` (44 pt, press feedback, a role and a
name). It renders for every field while the keyboard is up, which also gives multiline fields a way
to close the keyboard. On Android it is harmless: the pads there have an action key.

**The bar covers what the scroll view keeps above the keyboard.** `KeyboardStickyView` puts the bar
directly on the keyboard, and `KeyboardAwareScrollView` only knows the keyboard: with
`bottomOffset={SPACING.xl}` (24 pt) it keeps the focused field's bottom edge 24 pt above the
keyboard, while the bar is at least 53 pt tall with the reference tokens (a `MIN_TOUCH` 44 pt
button, `SPACING.xs` 4 pt above and below, the 1 pt hairline) and grows with large text. The bottom of the field would sit under the bar, and a
field whose bottom edge is 24 to 53 pt above the keyboard would not scroll at all. So a screen that
renders the bar takes both scroll props from `useDoneBarSpace()` (`src/hooks/use-done-bar-space.ts`,
passed through the model as `keyboardSpace`):

- `bottomOffset` = the bar's height + `SPACING.lg`, and `extraKeyboardSpace` = the bar's height, so
  the last field and the Save button can scroll above the bar too;
- the height starts at `KEYBOARD_DONE_BAR_MIN_HEIGHT` (built from the same tokens as the bar's
  style) and becomes the measured one when the bar reports `onHeightChange` from its `onLayout`;
  keyboard-controller then scrolls the focused field again because `bottomOffset` changed.

**Inside tabs or a sheet.** `KeyboardStickyView` lifts the bar from where its container ends. Above
a bottom tab bar, or in a sheet that stops short of the screen's bottom, that edge is already the
tab bar's (or the inset's) height above the screen bottom, so the open bar floats that far above the
keyboard. Pass `offset={{ opened: <tab bar height or bottom inset> }}` to the `KeyboardStickyView`
(keyboard-controller's own prop for this case; `useBottomTabBarHeight()` gives the tab bar height)
so the bar sits on the keyboard again. `useDoneBarSpace` needs no change: once the bar rides on the
keyboard its math (bar height above the keyboard) holds; check it by eye in the tab screen.

The screen test proves it: with the keyboard mocked up, `task-editor.form` has `bottomOffset`
`KEYBOARD_DONE_BAR_MIN_HEIGHT + DONE_BAR_GAP`, and after a layout event of 92 pt on the bar it has
`92 + DONE_BAR_GAP`. That the field visibly clears the bar is checked by hand on both platforms
(Definition of done), at the default and the largest text size.

## Android edge-to-edge and the soft input mode

Expo SDK 57 builds for Android 16 (target SDK 36), where apps draw edge to edge and the window is no
longer resized for the keyboard. Keep `android.softwareKeyboardLayoutMode` at its default (`resize`,
which maps to `adjustResize`); `KeyboardProvider` then draws edge to edge and applies the keyboard
inset itself (1.21.9 `EdgeToEdgeReactViewGroup`), which is what `KeyboardAwareScrollView` reads.
Setting `pan` makes the system shift the whole window, which hides the header and breaks the scroll
view's own handling. Verified by reading the library's Android source and Expo's config types; a
device check on an Android 16 emulator belongs to the definition of done.

## Submit: one void intent

```ts
const onSubmit = (): void => {
  form
    .handleSubmit(save, () => { announce(t('forms.submit.fix-fields')); })()
    .catch((error: unknown) => { errorLog.record('service', error); });
};
```

- `handleSubmit(...)` returns a function that returns a promise and rethrows what `save` throws, so
  `onPress={form.handleSubmit(save)}` is an unhandled rejection (lint fails it:
  typescript-and-lint-rules). The model exposes one `() => void` intent.
- `save` returns a `Result` (error-handling-typed-results). On a failure: keep the input, show a
  translated sentence in a live region, announce it. Never `reset()` before the result
  (never-lose-data).
- On `ok`, reset **after `handleSubmit` has settled**, then navigate or close: the template's
  `onValid` only records `isSaved`, and the `.then` after `handleSubmit(...)()` calls
  `form.reset(EMPTY)` and `onSaved()`. react-hook-form 7.89.0 sets `isSubmitted: true` and
  `submitCount + 1` after `onValid` returns (`handleSubmit` in `dist/index.esm.mjs`), so a reset
  inside `onValid` is undone at once: on a form that stays mounted (a sheet that stays open, a
  quick-add row) the next draft counts as submitted, re-validates on change, and shouts an error at
  its first keystroke. The model test "keeps the next draft quiet until its first blur when the form
  stays open after a save" fails with the reset inside `onValid`. (react-hook-form's own docs show
  the other safe shape: reset in an effect on `isSubmitSuccessful`. It does not fit here: a save
  that returns `err` without throwing still counts as a successful submit.)
- A save that goes to a server is a TanStack Query mutation (networking-and-server-state): call
  `mutateAsync` inside `save`, map a `rejected` code to `setError` (async-checks-and-server-errors.md).
- `isSubmitting` comes from `useFormState({ control })` (not from `formState` read in a child, not
  from `watch`), and the Save button shows it as busy (`PressableSurface` `isBusy`). That hides a
  second press only after the re-render, and `handleSubmit` itself has no re-entry guard, so the
  submit intent keeps a ref (`isSaving`) and ignores a submit while a save runs; the template's
  model test presses twice during a pending save and expects one save. The save is async
  (`SaveTask` returns a `Promise<Result>`), so `isSubmitting` stays true for the whole save.
- After a successful save the keyboard closes by itself when the screen goes; on a sheet that stays
  open, call `Keyboard.dismiss()` after the reset.

## Keeping long input: drafts

A note, a description, anything longer than a line survives the app being killed. The pattern
(persistence-and-migrations owns where data lives; this is the form side):

1. A `DraftStore` port with `load(formId)`, `save(formId, values)`, `clear(formId)` over the
   key-value store (`expo-sqlite/kv-store`), validated with the form's input schema on load.
2. The model reads the draft once for `defaultValues` (the screen waits for it, or the form starts
   empty and calls `reset(draft)` when it arrives, before the user typed).
3. `useWatch({ control })` feeds a debounced save (`delayOrAbort` with a latest request, 500 ms):
   never on every keystroke.
4. A successful submit clears the draft after the save returned `ok`; a failed one keeps it.
5. Never store a password or a one-time code in a draft.

## Leaving a form with unsaved changes

`isDirty` from `useFormState` tells whether the user changed anything. Leaving a dirty form (back
gesture, Android back, a tab switch) asks first, through the router's prevent-remove hook:
navigation-and-routing owns the guard and its confirmation dialog. With a draft (above) the question
can be dropped: the input is kept anyway.

## Re-renders and React Compiler

- React Compiler is on in the canonical stack. react-hook-form's `watch()` returns values it cannot
  memoize safely; eslint-plugin-react-hooks reports it (`react-hooks/incompatible-library`), and a
  root `watch()` re-renders the whole form on every keystroke.
- Read one field's value with `useWatch({ control, name })` in the component that needs it, and form
  state with `useFormState({ control, name })`. `useController` already subscribes one field.
- Never mirror field values into `useState` or a store while typing: react-hook-form holds the draft
  (state-management-zustand's state-homes table says the same).
