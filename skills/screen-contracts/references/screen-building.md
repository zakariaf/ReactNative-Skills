# Building a screen to its contract

Everything the screens of an app share: the three files of a screen, the common frame on iOS and
Android, the screen rules with their reasons, the testID and copy conventions, states, tests, right to
left, dark, large text, screenshots, and what to do while a screen is not built yet. Expo Router is
the default; React Navigation 7 (static API) is the appendix at the end.

## Contents

- The three files of a screen
- The common frame
- Screen rules (defaults, with the reason for each)
- testIDs in code
- Copy and texts
- States: every one built
- View tests and model-hook tests
- Right to left, dark, large text, wide windows
- Screenshots: reference images and frame states
- A screen that is not built yet
- Appendix: React Navigation 7 (static API)

## The three files of a screen

| File | What it does | Template |
|---|---|---|
| `src/app/<group>/<route>.tsx` | the route: `const model = useListsModel();` then the view (and the header title through `<Stack.Screen options={{ title: model.title }} />`). Nothing else. A default export, because Expo Router reads it | `templates/src/app/(app)/lists.tsx` |
| `src/features/<feature>/use-<feature>-model.ts` | the model hook: the only code that reads stores, repositories, services, server state, the clock and navigation; it translates every text (`t()`), formats numbers and dates, and returns plain data and handlers | `templates/src/features/lists/use-lists-model.ts` |
| `src/features/<feature>/<feature>-screen.tsx` | the pure view: a typed `model` in, library components out, every contract testID set, no store, no navigation, no `t()` | `templates/src/features/lists/lists-screen.tsx` |

Around them: `components/` for the screen's own parts (each a pure view), pure logic beside the hook
(`lists-state.ts`: which state the screen shows, decided from data, with its own test), and the
tests. Functions stay within the lint limit (typescript-and-lint-rules: 40 lines), so a large model
splits into pure helpers in the same file (`listsCopyOf(t)`, `deleteDialogOf(t, pending)`) or a
second hook file. React Compiler memoizes: no `useMemo` or `useCallback` (react-components-and-hooks).

The route's second line is the `// device-only: <what covers it>` marker
(unit-and-component-tests): it only joins the tested hook and the tested view, so coverage skips it.

## The common frame

- **Every screen sits in `ScreenFrame`** (react-components-and-hooks' `src/ui/screen-frame.tsx`, its
  testID the screen's `<scope>.screen`) with the required `edges` for what sits around it: the frame
  owns the safe areas, the ground colour behind the system bars and the centred column. Left and right
  stay on in every case, for the landscape notch and Android's display cutouts. Under a Stack header
  the header pads the top inset, so the frame takes `BELOW_HEADER_EDGES` (right, bottom, left); its
  "Safe areas" table gives the tab-bar and header-less cases (`ABOVE_TAB_BAR_EDGES`,
  `BETWEEN_HEADER_AND_TAB_BAR_EDGES`, `ALL_EDGES`).
- **A tall page scrolls on under the home indicator and Android's navigation bar.** Turn the bottom
  edge off the frame and pad the scroll content by the bottom inset instead: under a Stack header
  that is `BELOW_HEADER_SCROLLING_EDGES` (right and left), with
  `ScreenBody isUnderHomeIndicator` (`usePageBottomPadding(true)`: the larger of the page padding and
  the inset) or, for a list, the same padding on the FlatList's content (the Lists view). Otherwise the
  last block stops one inset above the screen edge, or sits under the system bar at the end of the
  scroll. Expo apps (SDK 54 and later) draw edge to edge on every Android version, and Android 16 only
  removes the OS opt-out, so this matters on both platforms. The Lists template draws a plain `View`
  root only because it must compile without `ScreenFrame`; its header comment shows the frame an app
  uses.
- **Bounded pages** (a detail page, settings, an empty or error state) use `ScreenBody`
  (`templates/src/ui/screen-body.tsx`): one column, one gap token between blocks, the page padding, a
  growing content box so a spacer (`flexGrow: 1`) pushes the state's one action to the bottom while
  the same column scrolls at 200 % text. `ScreenBody` is this skill's file in `src/ui`:
  ui-component-library's `check-components` treats `src/ui/screen-body.tsx` as owned elsewhere by
  default (owner screen-contracts), so it neither asks for a catalogue entry nor reports it unlisted.
  An app whose catalogue moved the ui folder lists it under `ownedElsewhere` itself.
- **Opening at a scroll offset.** `ScreenBody scrollToY` scrolls from `onContentSizeChange` and again
  from `onLayout`: the first layout can come before the safe-area insets, iOS clamps the offset to
  that too-tall frame, and a body that scrolled once stopped short (seen on a device, never in Jest).
  After the person's first drag (`onScrollBeginDrag`) it stops: content that grows later (async
  data, an expanding block, a text-size or rotation change) never jumps the page back.
- **A tilted or shadowed first block** rises above its box and the scroll view clips it at its top
  edge: `ScreenBody hasTopOverhang` moves the clip edge up and pads the content by the same amount.
- **Lists that grow** are a `FlatList` keyed by id (FlashList once measured; a ScrollView only for a
  short bounded list): performance-budgets has the measurement method.
- **The header stays fixed; only the body scrolls.** A pinned element (an ad slot, a bottom action)
  sits outside the scroll view.
- **Wide windows** (tablets, foldables, split screen) centre the column at `CONTENT_MAX_WIDTH`; the
  window class comes from react-components-and-hooks' `useWindowClass()` (adaptive-layout owns
  two-pane layouts).

## Screen rules (defaults, with the reason for each)

1. **Start-align.** Screens read from the start edge; a centred menu is harder to scan and mirrors
   badly. Centre only what the design centres (a single empty-state message, a dialog's art).
2. **One primary action per screen** (`policies.primaryAction`, `one-primary-action`). One obvious
   "go"; everything else is secondary. A state may change which action is primary.
3. **Destructive never looks primary.** A delete keeps a quiet fill and turns its text and edge to
   the danger colour, so a person never confirms it by habit.
4. **Raised means pressable; a card is never a pressable panel with a nested button.** On iOS an
   accessible container hides its children from VoiceOver and from the tree E2E tools read, so a
   button inside a pressable card can be neither found nor pressed. Draw the card as a plain view,
   with its pressable surface and its button as siblings (the Lists row: name and delete button side
   by side, the row itself not accessible).
5. **Hide what the state hides, never grey it out.** A feature the person cannot use here (Premium
   content for a free user, an ad slot for a paying one, an action offline) is left out, not shown
   disabled with no way forward.
6. **Ads only on the screens the policy allows, and never for paying users** (`policies.adSlot`,
   `ad-slot-not-allowed`). The default: list or overview screens only; never a dialog, a form, a
   purchase flow or a screen in the middle of a task.
7. **Only library components and theme values in screens.** No raw `Pressable` or `Text`, colour
   literals or raw sizes: the look lives in ui-component-library's components and
   design-system-structure's tokens (their checkers enforce it), so a screen cannot drift from the
   design.
8. **Every target at least 44 pt (48 dp on Android)** and every animation with a reduced alternative:
   accessibility-as-code's and motion-and-animation's rules, applied per screen.

## testIDs in code

- **Exactly the contract's ids**: none missing, none invented, none from another screen. A new id is a
  contract change first.
- **On the accessible element**: the pressable, the switch row, the text. On iOS a testID inside an
  accessible element vanishes from the tree XCUITest and Maestro read; Maestro's `id:` matches the
  testID on both platforms (e2e-maestro).
- **Repeated items take a data key, never an index**: `lists.list-row.${list.id}`, with the contract
  id `lists.list-row.{listId}`. An index id points at a different item after a sort or a delete.
- **Parts extend their parent's id**: `${rowID}.delete-button`. A library component derives its parts
  itself; the screen passes only the base id (ui-component-library).
- **Decorative parts stay hidden** from VoiceOver and TalkBack (the components hide them); never un-hide
  one to make it measurable. View tests find them with `{ includeHiddenElements: true }`.

## Copy and texts

- Every visible and spoken text comes from the contract's key through `t()` in the model hook, which
  hands the view plain strings; the view never translates: no `t()` and no `<T id="…" />` in a view
  built to a screen contract. i18n-strings-and-catalogs owns the message rules, and its `<T>`
  component is for text outside the screen pattern (a component with no model hook); inside it, the
  model hook is the one place copy is chosen, so the contract's keys are checked in one file. Data
  text (a list's name) is not a key.
- Free text in a message is a `*Name`/`*Text` placeholder that `t()` isolates (FSI … PDI): tests
  compare with `isolate()` from `src/i18n/bidi.ts`, never a bare string.
- Numbers are typed ICU arguments; dates come from the app's formatter in `src/i18n/`, never
  `toLocaleDateString`.
- A text the catalog lacks is added to the source catalog first, then every language (with its plural
  categories), and to the contract element's `text`.

## States: every one built

- **Every state in the contract has a layout**, including the ones the design does not draw (Chosen,
  `drawn: false` with its `why`): empty, error, offline, loading, a paying user, a finished task. A state
  without a layout is a blank screen in front of a person.
- **Which state shows is a pure function of data** (`listsStateOf(result)`), tested on its own.
- **The defaults when the design is silent**: empty shows a title and one line (and the one action
  that fills it, if any); error shows what failed and one Try again; offline says so and keeps what is
  cached readable; loading shows a quiet indicator only after a short delay. ui-states-and-feedback
  owns the shared state components and connectivity; this skill requires each listed state to be built
  and tested.
- **With ui-states-and-feedback's `contracts/screen-states.json`**, align the two contracts by hand
  (state ids here are free-form): name a data screen's states as that skill does (`loading`,
  `offline`, `failed`, `empty`, `filtered-empty`; the Lists template's `error` is that skill's
  `failed`), and list each state's element as `<id>.state.<state>`, the testID its checker requires.
  The state rules (required states, next-step actions, delayed loading) stay that skill's checks.
- **Dialogs and overlays are screens of their own** in the contract (presentation `dialog`, `overlay`
  or `sheet`), opened by the model that owns the state through the handler a person's press uses
  ([overlays-and-dialogs.md](overlays-and-dialogs.md)).

## View tests and model-hook tests

**View test** (`<feature>-screen.test.tsx`, template `lists-screen.test.tsx`): render the view through
unit-and-component-tests' `renderWithProviders` with a model per state (a `modelWith(state,
overrides)` helper keeps each block short), and in **each block that renders**:

1. find the state's contract ids, `getByTestId(id, { includeHiddenElements: true })`;
2. check what a screen reader needs by role and name (`getByRole('button', { name: 'Try again' })`);
3. fire the state's handlers (`userEvent.press`) and assert the model callback;
4. end with `expect(findInaccessiblePressables(screen.container)).toStrictEqual([])`.

Name each block for its state (`it('shows the empty state …')`) so `state-untested` can see it.

**Model-hook test** (`use-<feature>-model.test.tsx`): `renderHook` through `createProvidersWrapper()`
with the data layer's fakes (`createFakeTaskRepository()` in an `AppDataProvider`) and the app's real
`I18nProvider` inside it (the canonical `test/test-app.tsx` carries no app catalogs), one test per
state and per handler, failures included (`failNextWrite`). Navigation is asserted through
`renderRouterWithProviders` (unit-and-component-tests) when the hook navigates.

Write the tests first, watch them fail, then build (tdd-workflow).

## Right to left, dark, large text, wide windows

- **Right to left** mirrors through `flexDirection: 'row'` and logical keys (`paddingInlineStart`,
  `marginInlineEnd`); only direction icons (back, chevron, forward) mirror; progress fills run from
  the start edge. rtl-and-direction owns the rules; compare every screen in the app's RTL locale.
- **Dark** comes from the theme only; a screen never checks the scheme to pick a colour.
- **Large text (200 %)** wraps, never truncates: side-by-side pairs stack (`usePairLayout(gap)` from
  `templates/src/ui/use-pair-layout.ts`, at `useWindowClass().isLargeText`), row values drop under
  their labels, and the body scrolls. A cell grows from its content (`flexGrow: 1`, `flexBasis:
  'auto'`): `flex: 1` in a column collapsed a pair to 0 pt on a device while Jest passed.
- **Wide windows**: the centred column; nothing else changes unless adaptive-layout says so.

## Screenshots: reference images and frame states

- Each state may name its approved design frame (`"reference": "lists-default.png"` in
  `design/screens/`, 1 pt = 1 px, light theme, the source language). Open it before building and
  again when done; compare the running screen in light, dark and right to left on an iOS simulator
  and an Android emulator, then hand the screen to design-visual-parity for the measured comparison.
- **A frame that shows a state** (a dialog open, a second page) is opened by the model hook that owns
  the state, once, through the same handler a person's press uses: a `useState` initializer when the
  first render can hold it, else an effect whose handler runs through `useEffectEvent`. The test
  build only says which state (debug-menu-and-test-hooks owns that launch hook); there is never a
  capture-only branch in a view or a model.
- **Motion holds still through the reduce-motion hook** (`useReduceMotion()`, passed down as
  `isReducedMotion`), which a capture run turns on; a loop that ignores it never settles for a
  screenshot.

## A screen that is not built yet

The contract lists every screen; `check-screens.mjs . --all` fails `screen-not-built` until each is
built, and plain `check-screens.mjs .` checks only the built ones. While a screen is missing, do not
add its route file (`screen-unlisted` would fail a route without a contract entry anyway, and Expo
Router has no route without a file), hide the way to it in the model of the screen that links there,
and follow navigation-and-routing for a placeholder route. Never wire a no-op handler, and never add a
provider only that screen needs before the root layout mounts it: both pass every test and fail on a
device.

## Appendix: React Navigation 7 (static API)

An app on React Navigation's static API keeps the same three files; the route component lives where
the navigator imports it:

```tsx
// src/features/lists/lists-route.tsx
export function ListsRoute(): React.JSX.Element {
  const model = useListsModel();
  return <ListsScreen model={model} />;
}
// src/features/root-navigator/root-stack.tsx
const RootStack = createNativeStackNavigator({
  screens: { Lists: ListsRoute },
});
```

The contract's `route` names `lists-route.tsx`; the header title is set from the model with
`navigation.setOptions` in the model hook. `screen-unlisted` reads Expo Router's routes folder only:
without one it stays silent, so list every navigator screen in the contract by hand and keep the
navigator's screen names equal to the contract ids in PascalCase.
