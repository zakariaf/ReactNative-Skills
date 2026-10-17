# Fields, kinds and autofill

The one text field, the kinds that set its keyboard and autofill, how iOS and Android read those
props, and how screen readers hear a field. Facts about React Native were read in the installed
React Native 0.86.3 source on 2026-10-10 (`Libraries/Components/TextInput/TextInput.js` and
`ReactAndroid/.../textinput/ReactTextInputManager.kt`); re-verify after an SDK upgrade with
`grep -n "autoCompleteWebTo" node_modules/react-native/Libraries/Components/TextInput/TextInput.js`.

## Contents

- The field kit
- TextField: anatomy and props
- How a screen reader hears a field
- Kinds: one name, every input prop
- What React Native does with the props (iOS and Android)
- Autofill and password managers
- Multiline, length and selection
- Right-to-left and mixed scripts
- Pickers, switches and other inputs
- Adding a kind or a field component

## The field kit

| File | Job |
| --- | --- |
| `src/ui/form/field-kinds.ts` | `FIELD_KINDS`: each kind's `autoComplete`, `inputMode`, `autoCapitalize`, `autoCorrect`, `secureTextEntry`, lines, and whether the iOS keyboard has a return key; `inputPropsOf(kind)` |
| `src/ui/form/text-field.tsx` | the one field: label, input, note; presentational |
| `src/ui/form/field-note.tsx` | the line under the input: error, then progress, then hint |
| `src/ui/form/keyboard-done-bar.tsx` | the Done bar for pads without a return key; reports its measured height |
| `src/hooks/use-done-bar-space.ts` | the scroll view's `bottomOffset` and `extraKeyboardSpace` that keep the focused field above the bar |
| `src/hooks/use-text-field.ts` | binds a react-hook-form field to TextField's props (value, `onChangeText`, `onBlur`, `ref`, translated error, focus chain) |
| `src/hooks/field-message-key.ts` | an error to a catalog key, or the generic key |

The `src/ui/form/` components are presentational (ui-component-library's rule 6): strings arrive
translated, no store or translation import. They join the app's component catalogue with the
entries in `assets/component-library-entries.json`; ui-component-library's `check-components` then
holds their testIDs, parts and tests.

## TextField: anatomy and props

```tsx
<TextField testID="task-editor.title" {...model.title} />
// model.title = { label, kind, value, onChangeText, onBlur, ref, error, enterKeyHint,
//                 submitBehavior, onSubmitEditing, maxLength }
```

- **Parts** (derived from the testID): `.label`, `.input`, and from FieldNote `.error`, `.status`,
  `.hint`. E2E flows and tests address `task-editor.title.input`; screens never build part ids.
- **Label**: always visible above the input, never a placeholder. A placeholder disappears as soon
  as typing starts, has low contrast by design, and is not announced as the field's name.
- **Error** replaces the hint while set; **status** ("Checking…") shows while an async check runs and
  there is no error; **hint** is help that stays.
- **Invalid look**: the border turns `danger` and gets the bold stroke, and the sentence appears:
  never colour alone (ui-component-library rule 7; the test asserts the bold edge).
- **Size**: `minHeight: MIN_TOUCH` (44 pt), never a fixed height, so the box grows with large text;
  the typed text scales up to `MAX_FONT_SCALE` (200 %), the same cap as AppText. A single-line input
  drops the line height (iOS draws a single-line `TextInput` with a line height off centre); a
  multiline one keeps it and aligns to the top (`textAlignVertical: 'top'` for Android).
- **Disabled**: `editable={false}` plus `accessibilityState.disabled`, and a sunken background. A form
  rarely needs it: prefer hiding a field that does not apply.
- **`maxLength`**: the schema's bound, so typing stops where validation would refuse (UTF-16 code
  units on both platforms; an emoji may count 2).

## How a screen reader hears a field

The visible label is the input's accessible name on both platforms, but each platform gets it the
way its screen reader reads text fields:

| | iOS (VoiceOver) | Android (TalkBack) |
| --- | --- | --- |
| The input's name | `accessibilityLabel={label}` | `accessibilityLabelledBy={labelId}`, no `accessibilityLabel` |
| The label view | hidden (`accessibilityElementsHidden`, an iOS-only prop) | in the tree: `accessible`, `accessibilityLabel={label}`, `nativeID={labelId}` (from `useId()`) |
| The error or hint | `accessibilityHint` | `accessibilityHint`, which React Native puts in the node's `tooltipText` |
| Expected reading, empty field | "Title, text field, Give the task a title" | the label once ("Title"), then the box named by it ("edit box, for Title" or similar) |
| Expected reading, filled field | "Title, Call Sam, text field, ..." | the typed text and the label it is labelled by |

Why Android differs: React Native turns `accessibilityLabel` into the EditText's
`contentDescription` (`BaseViewManager.updateViewContentDescription`), and an EditText prefers its
own text to a content description. React Native 0.86's `ReactAccessibilityDelegate` says so in a
comment ("EditText's prioritize their own text content over a contentDescription"), Google's
Accessibility Test Framework flags a content description on an editable view, and Android's
guidance is to label an EditText with a hint or a separate label view (`labelFor`). React Native's
`accessibilityLabelledBy` is that label view: `ReactAccessibilityDelegate` calls
`AccessibilityNodeInfo.setLabeledBy(<the view with that nativeID>)`. The label view stays in the
tree because TalkBack reads the label's text from that node; the cost is that TalkBack visits the
label once on its own before the box.

**Verification status.** The mapping above was read in the React Native 0.86.3 source on 2026-10-10
(`ReactAccessibilityDelegate.kt`, `BaseViewManager.java`) and is proven in Jest
(`text-field.test.tsx` under the iOS preset, `text-field.android.test.tsx` under the Android
preset). The spoken phrases are **unverified on a device** for both screen readers: TalkBack's
exact wording for a labelled-by EditText differs between TalkBack versions. Check once by hand, with
the field empty and filled, on an Android emulator named for the job (for example
`<project>-a11y`, TalkBack on) and on an iOS simulator with VoiceOver, and record the date and device
here when it is done (Definition of done).

When an error appears:

- **Android**: FieldNote's error sits in `accessibilityLiveRegion="polite"`. TalkBack reliably speaks
  a change *inside* a live-region view that is already attached; FieldNote mounts the region together
  with its text (an always-mounted empty region would add TextField's gap under every field), and
  whether TalkBack speaks a region that appears with its content varies by view and version. So
  this is **unproven until the TalkBack check** in the Definition of done: on a refused submit the
  model's announcement and the focus move to the first invalid field carry the message either way
  (as on iOS); if TalkBack stays silent on a blur error, keep one live-region view mounted under the
  input and swap only its text. The same holds for the screen's save-failure note.
- **iOS**: React Native has no live regions on iOS. The refused submit is announced by the model
  (`useAnnounce(t('forms.submit.fix-fields'))`) and focus moves to the first invalid field
  (`shouldFocusError`), where VoiceOver reads the hint. Errors that appear on blur are read when the
  user returns to the field.

RNTL queries by label: `screen.getByLabelText('Title')` finds the input on both presets (RNTL
resolves `accessibilityLabelledBy` to the label's text); the hidden label text is not found without
`includeHiddenElements` (the TextField tests prove both). `accessibilityLabelledBy` alone is never
the name in a field component you write yourself: VoiceOver ignores it (`input-label`,
accessibility-as-code's rule 1).

## Kinds: one name, every input prop

A screen never sets `keyboardType`, `autoComplete`, `autoCapitalize` or `secureTextEntry` on a field;
it picks a kind:

| Kind | Keyboard (`inputMode`) | Autofill (`autoComplete`) | Capitalize | Autocorrect | Secure | Return key on iOS |
| --- | --- | --- | --- | --- | --- | --- |
| `sentence` | text | off | sentences | yes | no | yes |
| `multiline` | text | off | sentences | yes | no | new line |
| `name`, `given-name`, `family-name` | text | the same name | words | no | no | yes |
| `email` | email | email | none | no | no | yes |
| `username` | text | username | none | no | no | yes |
| `current-password`, `new-password` | text | the same name | none | no | yes | yes |
| `one-time-code` | numeric | one-time-code | none | no | no | no (Done bar) |
| `phone` | tel | tel | none | no | no | no (Done bar) |
| `url` | url | off (Android); iOS `textContentType` `URL` | none | no | no | yes |
| `integer` | numeric | off | none | no | no | no (Done bar) |
| `decimal` | decimal | off | none | no | no | no (Done bar) |
| `postal-code` | text | postal-code | characters | no | no | yes |
| `search` | search | off | none | no | no | yes |

- Autocorrect is off wherever autofill fills the text: a corrected name or address is wrong.
- `spellCheck` follows autocorrect (the red underline is noise in a name).
- `url` uses `autoComplete: 'off'` because Android has no URL autofill hint: React Native 0.86 logs
  "Invalid autoComplete: url" and turns autofill off for the field anyway. iOS would lose its URL
  suggestions with it, so the kind also sets `textContentType: 'URL'`: on iOS an explicit
  `textContentType` wins over the `autoComplete` mapping, and Android ignores the prop
  (`TextInput.js`, 0.86). `FIELD_KINDS` sets `textContentType` only where `autoComplete` cannot say
  it on both platforms.
- The kind travels with the binding (`useTextField(form, 'title', { kind: 'sentence' })`), so the
  model decides and the view cannot drop it.

## What React Native does with the props (iOS and Android)

`TextInput` (0.86) translates the web-style props before they reach native code:

| Prop | iOS | Android |
| --- | --- | --- |
| `inputMode` | `keyboardType`: decimal → `decimal-pad`, email → `email-address`, numeric → `number-pad`, search → `web-search`, tel → `phone-pad`, url → `url`, none → no keyboard | the same, except search → `default` |
| `enterKeyHint` | `returnKeyType`: done, next, go, search, send, previous; `enter` → `default` | the same (the IME action) |
| `autoComplete` | not sent to native code on iOS; mapped to `textContentType` (`email` → `emailAddress`, `current-password` → `password`, `new-password` → `newPassword`, `one-time-code` → `oneTimeCode`, `tel` → `telephoneNumber`, `postal-code` → `postalCode`, `url` → `URL`, `off` → `none`, ...) unless `textContentType` is set | mapped to an autofill hint (`current-password` → `password`, `new-password` → `password-new`, `one-time-code` → `sms-otp`, `given-name` → `name-given`, ...); `off` or a value it does not know sets `importantForAutofill` to no |
| `submitBehavior` | `submit` keeps focus, `blurAndSubmit` blurs, `newline` (multiline only) inserts a line; a single-line field given `newline` becomes `blurAndSubmit` | the same |
| default `submitBehavior` | single line: `blurAndSubmit`; multiline: `newline` (`blurOnSubmit` is deprecated) | the same |
| `autoCorrect` | autocorrection | `TYPE_TEXT_FLAG_AUTO_CORRECT`, or `NO_SUGGESTIONS` when false |
| `secureTextEntry` | dots, no autocorrect, password keyboard | `TYPE_TEXT_VARIATION_PASSWORD` |

**The pads without a return key.** On iPhone the number pad, the decimal pad and the phone pad have no
return or Done key, so a field with `inputMode` numeric, decimal or tel cannot close the keyboard by
itself; `FIELD_KINDS[kind].hasReturnKey` is false for those kinds and the screen renders
`KeyboardDoneBar` (keyboard-focus-and-submit.md). Android's pads show an action key.

## Autofill and password managers

- **iOS** offers saved passwords, one-time codes from Messages and contact data in the QuickType bar
  from `textContentType` (set through `autoComplete`). Offering the password saved for the app's own
  website, and saving a new one after sign-up, needs the app associated with that domain
  (Associated Domains `webcredentials:<domain>` in `ios.associatedDomains`, plus the domain's
  `apple-app-site-association` file): auth-and-secure-storage owns that setup.
- **`new-password`** makes iOS suggest a strong password; `passwordRules` (an iOS-only prop) can
  describe the server's rules (`"minlength: 12; required: digit;"`). Add it in the field folder when a
  form needs it, never on a screen.
- **Android** asks the user's autofill service (Google, a password manager) using the hints; it needs
  `importantForAutofill` not set to no, which `autoComplete: 'off'` does on purpose for free text.
- **Order matters for both**: put username or email directly before the password field, in one
  screen, so both platforms treat them as one sign-in pair
  (`examples/account-fields.ts`).
- A one-time code from SMS (`one-time-code`) is offered above the keyboard on iOS; on Android the
  `sms-otp` hint lets the autofill service offer it. Never read SMS yourself for this.

## Multiline, length and selection

- `multiline` grows with its content inside the scroll view; give it a `minHeight` of three lines and
  let the scroll view keep the caret visible (`KeyboardAwareScrollView` follows the caret).
- `selectTextOnFocus` only where the user will replace the whole value (an amount).
- Do not trim while typing (`onChangeText={(t) => set(t.trim())}`): the user cannot type a space
  between words. The schema trims on submit.

## Right-to-left and mixed scripts

- The input's text style comes from `useTextStyle({ align: 'start' })`, whose `textAlign: 'left'`
  React Native swaps in a right-to-left layout: the text starts at the layout's start edge. Never a
  `textAlign` literal on an input (rtl-and-direction).
- Typed text mixes scripts (a Latin product name in an Arabic note). Show it back (in a list, a
  summary) with rtl-and-direction's first-strong direction, not the UI direction.
- Test typing both scripts in both layouts (`user.type(input, 'Buy milk')` and Arabic text in a
  test rendered with `direction: 'rtl'`).

## Pickers, switches and other inputs

- A choice from a short fixed list is a set of radio rows or a segmented control from the component
  library (ui-component-library), bound with `useController` the same way: `value`, `onChange` of the
  value itself (not an event), `ref` to the first option.
- A date is a `DateKey` string in the form; see schemas-and-messages.md (Date fields) and
  dates-streaks-and-statistics for the picker edges.
- A switch that saves at once is a setting (settings-and-preferences), not a form field.

## Adding a kind or a field component

1. A new kind: add it to `FieldKind` and `FIELD_KINDS` with every prop; the kind tests (secure only
   for passwords, return key exactly for pads, autocorrect off where autofill fills) then cover it.
   Add it to check-forms' `padKinds` config when it opens a pad.
2. A new look (a search field with a clear button, an amount field with a currency): a new component
   in `src/ui/form/` that renders the same label, input and note parts, takes a kind, and joins the
   catalogue with a test. It is the only other place a raw `TextInput` may appear (`raw-text-input`).
