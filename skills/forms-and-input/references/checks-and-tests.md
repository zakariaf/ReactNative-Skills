# Checks and tests

Every rule of `scripts/check-forms.mjs` with its fix, the options and config keys, what a passing run
may print, what the checker cannot see, and the test recipes that prove the rest.

## Contents

- Running the checker
- The rules
- Options and rn-skills.config.json
- Passing output, SKIP and NOT APPLICABLE
- What the checker cannot see
- Test recipes
- E2E notes
- When multi-package

## Running the checker

```
node ${CLAUDE_SKILL_DIR}/scripts/check-forms.mjs [repo-root] [--src <dir>]... [--field-dir <dir>]... [--catalog <file>] [--json]
```

Exit 0 pass (NOT APPLICABLE and SKIP lines included), 1 problems, 2 bad input (no source folder, a
malformed config or catalog). It scans the runtime `.ts`/`.tsx` files under the source and routes
folders of the app and of every workspace, with the shared repo walk: agent skill folders
(`.agents/skills`, `.claude/skills`, `skills/`, ...), any folder holding a `SKILL.md`, generated
native folders and build output are skipped; tests (`*.test.*`, `*.spec.*`, `__tests__/`,
`__mocks__/`, `test/`) and `*.d.ts` are left out. A **form schema** is the module whose schema a
`valibotResolver(...)` call receives: imported by name (followed through tsconfig aliases) or
declared in the same file.

## The rules

| Rule | Fails when | Fix |
| --- | --- | --- |
| `form-resolver` | a `useForm(...)` (type arguments included) passes no `resolver`; a `<Controller rules=...>` or `useController({ rules })` | `resolver: valibotResolver(schema)`; move the check into the schema |
| `form-mode` | `useForm` with `mode: 'onChange'` or `'all'` | `mode: 'onTouched'` |
| `focus-error` | `shouldFocusError: false` | keep the default |
| `schema-message-key` | in a form schema, a valibot validation action without its message, with a message that is not a string literal (or a `const` string in the file), or with a key the source catalog lacks | a literal catalog key at the action's message position (schemas-and-messages.md has the table) |
| `error-message-key` | `setError(name, { message })` with a literal that is not a catalog key, a template string, or text already translated (`t(...)`, `formatMessage(...)`) | the key itself; codes through a `Record<Code, MessageKey>` table (a typed value is trusted) |
| `schema-async` | any `*Async` valibot call in a form schema (`pipeAsync`, `checkAsync`, `objectAsync`, ...) | `useAsyncFieldCheck` in the model |
| `schema-segmenter` | a graphemes or words action anywhere in the app while `<i18nDir>/intl-polyfills.ts` does not force `@formatjs/intl-segmenter` | `maxLength`, or the polyfill (i18n-strings-and-catalogs) |
| `latin-digits` | a form schema reads digits (`\d` or `[0-9` in a regex, `digits()`, `decimal()`, `toNumber()`, `Number()`, `parseInt()`, `parseFloat()`, `Number.parseInt()`, `Number.parseFloat()`, the point-free `transform(Number)` and `.map(Number)`) and names none of the digit normalizers (`toLatinDigits`, `normalizeDecimalInput`) | `v.transform(toLatinDigits)` first in the pipe; a decimal, money or quantity field uses value-objects-money-and-units' `normalizeDecimalInput` |
| `raw-text-input` | `TextInput` value-imported from `react-native` or `react-native-gesture-handler` (or `<RN.TextInput>`) outside the field folders | render `TextField` with a kind; a new look is a new field component |
| `input-label` | a `<TextInput>` with no `accessibilityLabel` or `aria-label` and no spread; `accessibilityLabelledBy` / `aria-labelledby` alone do not count (Android and web only: VoiceOver gets no name) | the visible label as `accessibilityLabel` (TextField passes it on iOS and points at the label view with `accessibilityLabelledBy` on Android) |
| `input-preset` | a `<TextInput>` with `secureTextEntry` (not `{false}`) and no `autoComplete`/`textContentType`; or with the email keyboard and no `autoCapitalize` (no spread on the tag) | a kind, or the missing prop |
| `field-on-change` | in a file importing react-hook-form: `onChange={…onChange}` on any tag, or `{...field}` / `{...register(...)}` spread onto a tag | `onChangeText={field.onChange}`, props one by one (`useTextField`) |
| `field-ref` | a file calls `useController` or renders `<Controller>` and never passes a ref on (`field.ref`, a destructured `ref`, or `{...field}`) | `ref={field.ref}` on the input |
| `keyboard-provider` | some app file uses react-native-keyboard-controller (anything but `KeyboardProvider`/`KeyboardController`) and no app file renders `<KeyboardProvider>` | wrap the root stack |
| `keyboard-aware-scroll` | a file that renders a text field (`TextField`, the configured field components, a `TextInput`) renders `ScrollView` (react-native or gesture-handler), `Animated.ScrollView` (Reanimated or React Native) or React Native's `KeyboardAvoidingView`; a `ScrollView` with `horizontal` (not `{false}`) is a chip row and is left alone. Also a screen file (`*-screen.tsx`, or a `.tsx` in the routes folder) that renders two or more text fields and no scroll container at all (`KeyboardAwareScrollView`, `ScrollView`, `FlatList`, `SectionList`, `FlashList`, an `Animated.` one); one field above a list is a search box and passes | `KeyboardAwareScrollView` (for an animated scroller, its `ScrollViewComponent` prop) |
| `keyboard-persist-taps` | in such a file, a `ScrollView`, `KeyboardAwareScrollView`, `FlatList`, `SectionList`, `FlashList` (or `Animated.` one) without `keyboardShouldPersistTaps`, or with `"never"` (a spread excuses a missing prop) | `keyboardShouldPersistTaps="handled"` |
| `pad-done-bar` | a feature folder (`src/features/<name>/`, or the file's folder elsewhere) holds a pad field (`kind: 'integer' \| 'decimal' \| 'phone' \| 'one-time-code'`, `kind="..."`, or a `TextInput` with `inputMode` numeric/decimal/tel or `keyboardType` number-pad/decimal-pad/phone-pad/numeric) and no file in it renders a Done bar (`KeyboardDoneBar`, or a tag listed in `forms.doneBars`) | render `KeyboardDoneBar` in the screen, with `useDoneBarSpace()` for the scroll view |

## Options and rn-skills.config.json

| Option or key | Default | Effect |
| --- | --- | --- |
| `--src <dir>` (repeatable) | each app's `srcDir` and `routesDir` | the folders scanned |
| `--field-dir <dir>`, `forms.fieldDirs` | `<uiDir>/form` of each app | where a raw `TextInput` may live |
| `forms.fieldComponents` | `["TextField"]` | tags that count as a text field for the keyboard rules (add your other field components) |
| `forms.padKinds` | `["integer", "decimal", "phone", "one-time-code"]` | kinds that open a pad without a return key |
| `forms.doneBars` | `["KeyboardDoneBar"]` | tags that count as a Done bar. keyboard-controller's `KeyboardToolbar` is left out on purpose: it closes the keyboard, but in 1.21.9 its buttons speak fixed English labels and cap their text at 130 % (keyboard-focus-and-submit.md); list it here only after accepting that |
| `forms.digitNormalizers` | `["toLatinDigits", "normalizeDecimalInput"]` | the functions a digit-reading schema may call first (any one of them is enough); add the app's own normalizer here |
| `--catalog <file>`, `forms.sourceCatalog` | `<i18nDir>/catalogs/<SOURCE_LANGUAGE>.json` (`SOURCE_LANGUAGE` read from `<i18nDir>/languages.ts`, else `en`) | the catalog keys are checked against |

```json
{ "forms": { "fieldDirs": ["src/ui/fields"], "fieldComponents": ["TextField", "AmountField"] } }
```

A `forms` value that is not an object, or a key of the wrong type, is exit 2 with the key named.

## Passing output, SKIP and NOT APPLICABLE

- A passing run: `check-forms: <n> source files checked, 0 problems` and `RESULT: PASS`.
- `NOT APPLICABLE: no form or text input: no app file imports react-hook-form, TextInput or
  react-native-keyboard-controller` (exit 0): the app has no form yet. The reference app prints this
  until its first form.
- `SKIP src/i18n/catalogs/en.json [schema-message-key] not yet created (i18n-strings-and-catalogs creates it)`:
  the message rules wait for the catalog; every other rule runs.

## What the checker cannot see

It reads source text, not a type-checked program. A reviewer still looks for these shapes:

- A schema handed to the resolver through a variable built elsewhere (`const resolver =
  makeResolver(schema)`) is not found as a form schema; keep `valibotResolver(schema)` in the model.
- `schema-message-key` reads messages only in form schemas; a shared sub-schema imported into one is
  not followed (keep a form's actions in its schema file, or check the shared file's test).
- `field-ref` accepts any `.ref` member access in the file; a ref handed to the wrong element is
  only caught by the hook test (focus assertions).
- `pad-done-bar` groups by feature folder: a Done bar in another feature's screen that happens to
  render the field is not seen; a pad kind chosen at run time (`kind: isCode ? 'one-time-code' :
  'sentence'`) is not seen.
- `keyboard-persist-taps` and `keyboard-aware-scroll` look at one file: a scroll container in a
  parent component that renders a child holding the fields is not linked, and a field group
  component (not a `*-screen.tsx` or route file) with no scroller of its own is left alone, because
  its screen owns the scroller. A screen that renders its fields only through such a child, with no
  scroller anywhere, is not seen; the screen test (typing into the last field) catches it.
- `input-label` cannot judge whether the label is the visible one, or translated
  (i18n-strings-and-catalogs checks literals), nor how TalkBack and VoiceOver actually read it: the
  platform split in TextField is proven by its two Jest tests (iOS and Android presets), the spoken
  wording only by hand on a device (fields-and-autofill.md, Verification status).
- A spread on a `<TextInput>` excuses `input-label` and `input-preset`: the checker cannot know what
  the spread holds. TextField itself spreads `inputPropsOf(kind)` and its optional props, so deleting
  its `accessibilityLabel` passes the checker; its two Jest tests (`text-field.test.tsx`,
  `text-field.android.test.tsx`) are what hold the label there.
- `keyboard-aware-scroll` excuses every `ScrollView` with `horizontal`: a horizontal scroller that
  wraps the form's fields (rare, and a layout bug of its own) is not caught.
- `latin-digits` only sees that a normalizer is named in the schema file, not that it runs before
  the digit check, nor that the locale passed to `normalizeDecimalInput` is the app's current one
  (a schema test that types `٣٠`, and for a decimal field the locale's separator, proves it).
- The Done bar's room above the keyboard (`useDoneBarSpace`) is not checked statically; the screen
  test asserts the scroll view's `bottomOffset` follows the bar's measured height.
- The `onPress={form.handleSubmit(save)}` shape and `watch()` are lint's (typescript-and-lint-rules'
  promise rules, `react-hooks/incompatible-library`); showing `fieldState.error.message` untranslated
  is error-handling-typed-results' `ui-error-message`.

## Test recipes

**The schema** (pure, no providers): one test per message, and the catalog proof.

```ts
it('produces only messages that exist in every catalog', () => {
  const produced = [...messagesOf({ title: '' }), /* one input per message */];
  expect(produced).toHaveLength(6);
  for (const key of produced) expect(Object.hasOwn(en, key) && Object.hasOwn(ar, key)).toBe(true);
});
```

**A binding or model hook** over a real form, real catalogs and fake refs:

```ts
const { result } = await renderHook(() => useTaskEditorModel(deps), { wrapper: createFormTestWrapper().wrapper });
const title = { focus: jest.fn() };
await act(() => { result.current.title.ref(title); });      // the ref react-hook-form will focus
await act(async () => { result.current.onSubmit(); await jest.runAllTimersAsync(); });
expect(title.focus).toHaveBeenCalled();                      // setFocus / shouldFocusError use setTimeout
```

- `jest.useFakeTimers()` in `beforeEach` and `jest.runAllTimersAsync()` inside `act`: react-hook-form
  defers focus with `setTimeout`, the resolver is async, and the async check debounces.
- `createFormTestWrapper()` (`test/forms/i18n-form-wrapper.tsx`) adds the real `I18nProvider` with a
  throwing `onError` to the canonical providers, so a label is the catalog's text and a missing key
  fails the test. The canonical `test/test-app.tsx` has no catalogs, by design.

**The screen**, driven like a person, queried by label and role:

```ts
const user = userEvent.setup();
await user.type(screen.getByLabelText('Title'), 'Call Sam');
await user.press(screen.getByRole('button', { name: 'Add task' }));
expect(deps.save).toHaveBeenCalledWith({ title: 'Call Sam', notes: '', estimateMinutes: null });
expect(findInaccessiblePressables(screen.container)).toStrictEqual([]);
```

- `user.type` focuses, types each key and blurs, so `onTouched` validation runs as on a phone.
- The root mock `__mocks__/react-native-keyboard-controller.ts` hands Jest the library's own mock
  (`react-native-keyboard-controller/jest`): views render as plain views, `useKeyboardState` reports a
  hidden keyboard. A test that needs it up replaces the answer through
  `jest.requireMock('react-native-keyboard-controller')` (unit-and-component-tests forbids importing
  the SDK in a test: `vendor-sdk-import`).
- Digits: type `٣٠` into the estimate and expect `30` in the saved draft.
- The Done bar's room: mock the keyboard up, then expect `task-editor.form` to have `bottomOffset`
  `KEYBOARD_DONE_BAR_MIN_HEIGHT + DONE_BAR_GAP`; fire `layout` on `task-editor.keyboard` with a taller
  height and expect the offset to follow (`await fireEvent(bar, 'layout', { nativeEvent: { layout:
  { height: 92 } } })`).
- Android-only behaviour (TextField's `accessibilityLabelledBy`) is tested in
  `<unit>.android.test.tsx`, which runs in the Android Jest project, never by overwriting
  `Platform.OS` (unit-and-component-tests).
- A form that stays open after a save: save once, type into a field, and expect no error until its
  blur (the model test of the same name).
- RTL: render with `createFormTestWrapper({ language: 'ar', direction: 'rtl' })` and type both scripts.

**The async check**: fake timers plus a deferred fake check (the six races in
async-checks-and-server-errors.md).

## E2E notes

- Address inputs by their derived testID (`task-editor.title.input`); Maestro's `inputText` types
  into the focused field; `hideKeyboard` closes it (on iOS it may need a tap on the Done bar for a
  pad: tap `task-editor.keyboard.done`).
- Run the form flow once at the largest text size and once in the RTL locale (e2e-maestro).

## When multi-package

Each workspace is an app: its `srcDir`, `routesDir`, `uiDir/form`, `featuresDir` and `i18nDir` come
from its own layout, `keyboard-provider` is judged per app, and the source catalog is that app's. A
shared UI package that holds the field components is listed with `--field-dir` or `forms.fieldDirs`
(repo-relative, for example `packages/ui/src/form`).
