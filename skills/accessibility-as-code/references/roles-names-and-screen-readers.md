# Roles, names, targets and screen readers

What every interactive element exposes to VoiceOver (iOS) and TalkBack (Android), how common
components map to roles and states, how to pair a card that opens a screen with its own action, how
swipe, drag and pinch actions stay reachable, how custom canvases and announcements are spoken, and
how overlays stay modal on both platforms. Prop
facts verified on 2026-10-03 by reading React Native 0.86.3's `ViewAccessibility.d.ts`, `View.js`,
`Pressable.js`, the `Touchable*.js` files and `BaseViewConfig.ios.js` (re-verify:
`grep -rn "aria-modal" node_modules/react-native/Libraries/Components/`).

## Contents

- The pressable checklist
- Roles and states per element
- Names, hints and translations
- Touch targets
- Grouping, sliders and holds
- Swipe, drag, pinch and custom actions
- A card that opens a screen plus its own action
- Custom canvases
- Announcements and live regions
- Order, overlays and escape
- Languages
- iOS and Android differences at a glance

## The pressable checklist

Screens use the shared components in `src/ui/` (buttons, icon buttons, rows); ESLint lets only
`src/ui/` import `Pressable`. Every pressable there has:

| Prop | Value |
|---|---|
| `accessibilityRole` (or `role`) | `button`, or `switch`, `checkbox`, `radio`, `tab`, `link`, `adjustable` (`role="slider"`) where true |
| `accessibilityLabel` (or `aria-label`) | the translated visible text, or the required `label` prop of an icon-only button; a row whose own children render its texts (in the text primitive, or in a component that renders text) may leave it out, because the screen reader reads them in order. An icon component never counts as text: an icon font draws a private-use glyph. `aria-labelledby` / `accessibilityLabelledBy` do not replace it: they are Android and web only |
| `accessibilityHint` | only when the result is not obvious from the label, translated |
| `accessibilityState` (or `aria-disabled`, `aria-busy`, `aria-checked`, `aria-selected`) | `busy`, plus `checked` / `selected` for toggles, tabs, segments and options; `disabled` as below |
| `disabled` | on React Native's `Pressable` and Touchables, `disabled` alone is enough: they copy it into `accessibilityState.disabled`. Gesture Handler's `Pressable` (`disabled`), buttons (`enabled`) and touchables do not, so they also take `accessibilityState={{ disabled }}` |
| size | its own box at least 44 × 44 pt, never `hitSlop` |
| `testID` | `<screen>.<element>[.<key>]` in kebab-case, an interactive element ending in its role (`tasks.add-button`); a repeated item adds its stable data key as its own segment, never a list index (`tasks.task-row.<task id>`, its checkbox `tasks.task-row.<task id>.complete-checkbox`), as naming-conventions defines |

The same holds for a pressable wrapped for animation: `const AnimatedPressable =
Animated.createAnimatedComponent(Pressable)` (the usual Reanimated 4 way to animate press feedback)
is still a `Pressable`, and `check-a11y-code` judges it as one. `hitSlop` fails on any element,
including one handed to a shared component.

**A link.** Expo Router's `<Link href asChild>` gives its one child `role: 'link'` and the
`onPress` (expo-router 57.0.24 `build/link/useLinkToPathProps.js`, read on 2026-10-03; re-verify:
`grep -n "role: 'link'" node_modules/expo-router/build/link/useLinkToPathProps.js`), so a
`Pressable` inside it needs a name but no role of its own. Never give navigation the role `button`.

**A pressable no screen reader should focus.** A modal's backdrop or a keyboard-dismiss area is a
convenience for touch users: mark it `accessible={false}` (or `aria-hidden`; the canonical ESLint
config asks every `Pressable` for a role, so it also takes `accessibilityRole="none"`), and make sure
its action is reachable another way (the sheet's Close button, Android's back through `onRequestClose`, VoiceOver's
escape gesture through `onAccessibilityEscape`). `check-a11y-code` and the audit then skip its role
and name. The checker cannot see whether the other way exists; the release checklist asks for it.

Why: both screen readers read role, name and state, and React Native Testing Library's
`getByRole('button', { name })`, `toBeDisabled()` and `toBeChecked()` assert exactly that. The
`aria-*` props are aliases: `View.js` turns `aria-label` into `accessibilityLabel` and `aria-hidden`
into `accessibilityElementsHidden` plus `importantForAccessibility="no-hide-descendants"`.

**Disabled, by component.** React Native 0.86.3's `Pressable.js` merges `disabled` into the
accessibility state (`disabled != null ? {..._accessibilityState, disabled} : …`), and
`TouchableOpacity`, `TouchableHighlight`, `TouchableNativeFeedback` and `TouchableWithoutFeedback` do
the same, so VoiceOver says "dimmed", TalkBack says "disabled" and `toBeDisabled()` passes. Gesture
Handler 2.32 does not: its `Pressable` uses `disabled` only to turn the gesture off, its
`RectButton`, `BorderlessButton` and `BaseButton` take `enabled`, and its touchables pass
`accessibilityState` through unchanged. The native button sets Android's `View.isEnabled`, so
TalkBack hears it, but iOS traits and RNTL read only `accessibilityState`; `check-a11y-code` fails
`disabled-state` there. A custom control built on a `View` states it through `accessibilityState`
too. Read on 2026-10-03; re-verify:
`grep -n "disabled != null" node_modules/react-native/Libraries/Components/Pressable/Pressable.js` and
`grep -n "isPressableEnabled" node_modules/react-native-gesture-handler/src/components/Pressable/Pressable.tsx`.

Not every alias works on every component in React Native 0.86.3:

- **`aria-modal`** becomes `accessibilityViewIsModal` only in `Pressable` and `TouchableOpacity`,
  `TouchableHighlight` and `TouchableNativeFeedback` (and the internal `TouchableBounce`).
  `View.js` does not map it, the native view config lists only `accessibilityViewIsModal`,
  Fabric's accessibility props have no `aria-modal`, and `TouchableWithoutFeedback` hands it
  unchanged to its child. So `<View aria-modal>` alone is dropped and VoiceOver can leave the
  layer: on a `View`, write `accessibilityViewIsModal`. `check-a11y-code` fails `modal-overlay` for
  `aria-modal` alone on a host that drops it.
- **The web is the other way round.** react-native-web 0.21 honours `aria-modal` and
  `aria-labelledby` on a `View` (its `createDOMProps` writes them to the DOM) and does not map
  `accessibilityViewIsModal`. A web-enabled app keeps `aria-modal` next to
  `accessibilityViewIsModal` on the scrim (web-support owns the web target); `check-a11y-code`
  accepts the pair (read on 2026-10-03;
  re-verify: `grep -n "aria-modal\|aria-labelledby" node_modules/react-native-web/dist/modules/createDOMProps/index.js`).
- **`aria-labelledby` and `accessibilityLabelledBy`** are Android only in React Native
  (`AccessibilityPropsAndroid`, `@platform android`; the web honours `aria-labelledby` too): an
  icon-only button named only through them has no VoiceOver name, so `check-a11y-code` does not
  count them as a name (`pressable-name`).
- **Text inputs** are outside `pressable-name`: a `TextInput`'s name (a placeholder is not a name) is
  forms-and-input's `input-label` rule, which follows the same principle. Its `TextField` sets
  `accessibilityLabel` on iOS and, on Android, `accessibilityLabelledBy` pointing at the visible label
  (React Native maps `accessibilityLabel` to the EditText's `contentDescription`, which loses to the
  typed text); that split is marked unverified on a device in forms-and-input's fields reference.

## Roles and states per element

| Element | Role | Name | State / value |
|---|---|---|---|
| Button, icon button, row action | `button` | translated label | `disabled`, `busy` |
| Task row that completes a task | `checkbox` | the task title (plus due date) | `checked` |
| Settings toggle row (the whole row is the target) | `switch` | row label | `checked`; the knob also shows a check or a dash |
| Segment, option in a picker | `radio` | option name | `selected` |
| Slider (volume, reminder offset) | `adjustable` / `role="slider"` | row label | `accessibilityValue { min, max, now }` + increment/decrement actions |
| Tab in a tab bar | `tab` | tab name | `selected` (Expo Router's native tabs set this themselves) |
| Screen title, section title | `header` (the text primitive's `isHeader`) | the title | — |
| Chart, drawing, game board (custom canvas) | `image` | `t()` of a pure `describe(state)` | updated with the state |
| Dialog, sheet, in-tree overlay | the overlay root is modal (see below) | the title | — |
| Decorative art, confetti, dividers | hidden: `accessible={false}`, `aria-hidden` | — | — |

## Names, hints and translations

- Every name and hint comes from `t()` with a catalog key (usually ending in `.a11y-label` or
  `.a11y-hint`), in every locale the app ships. A literal `accessibilityLabel="Delete"` is English
  for everyone; ESLint flags the literal, `check-a11y-code` also flags template-built text
  (`` `Delete ${title}` ``) and literal branches (`isDone ? 'Done' : t(...)`).
- Presentational components receive the translated string as a prop (`label`, `hint`); the
  screen's model hook calls `t()`.
- Counted values use ICU plurals in the message, never string building:
  `{taskName}, {subtasks, plural, =0 {no subtasks} one {# subtask} other {# subtasks}}`. Plural
  categories differ per locale (Arabic has six); i18n-strings-and-catalogs owns the catalogs.
- A button's name is its visible text; an icon-only button takes a required `label`.
- A hint starts with a verb that describes the result ("Opens the task details.", "Marks the task
  as not done."), never the gesture: VoiceOver and TalkBack add their own usage hint ("double-tap
  to activate"), so "Double-tap to …" is heard twice, and Apple's `accessibilityHint` guidance asks
  for the result.
- Keep names short and stable: the screen reader repeats the name on every focus, so put details
  in the hint or the value, not in the name.

## Touch targets

- Every touch target's own box is at least **44 × 44 pt** (`a11y.minTouchPt` in
  `quality-gates.json`, never below 44): `minWidth`/`minHeight` or `width`/`height` on the pressable
  itself, from a touch-size token. Apple's HIG asks for 44 pt; Material asks for 48 dp (RN's pt and
  dp are the same unit), so an app designed for both often sets the gate to 48. WCAG 2.2's AA floor
  (2.5.8) is 24 px; 44 is the AAA target (2.5.5).
- Never reach the size with `hitSlop`: it is invisible in layout, overlaps neighbours, and does
  not move the focus rectangle VoiceOver and TalkBack draw.
- Text-holding controls grow with the font: `minHeight`, never a fixed `height`.
- Custom hit-testing (canvas cells, gesture areas) asserts in a unit test that its smallest region
  is at least the minimum at the smallest supported window (canvas-gestures-and-hit-testing).

## Grouping, sliders and holds

- **A row is one accessible element**: label, value and control read together, one swipe per row.
  A `View` with `accessible` groups its children on both platforms (on Android it becomes one
  focusable node).
- **Sliders** use `accessibilityRole="adjustable"` (or `role="slider"`), `accessibilityValue={{ min,
  max, now }}`, declare `accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}` and
  handle both in `onAccessibilityAction` (clamped steps). VoiceOver adjusts with a one-finger swipe
  up or down; TalkBack with the volume keys or its adjust reading control. Without the declared
  actions neither does anything.
- **Holds and long presses** get a screen-reader alternative: `accessibilityActions` (for example
  `{ name: 'activate' }`, or `longpress`, which TalkBack sends on double-tap-and-hold) with
  `onAccessibilityAction`, or a confirmation dialog. "Delete all completed tasks" behind a 1.5 s
  hold must be confirmable without holding. The hold timer itself passes
  `reduceMotion: ReduceMotion.Never` (a safety timer, not decoration). The actions belong on the
  pressable that has the `onLongPress`: a shared row (`src/ui/`) that takes `onLongPress` declares
  them itself, so a screen passing `onLongPress` to it needs nothing more. `check-a11y-code` fails
  `hold-alternative` for `onLongPress` on a pressable or a React Native element (`Text`) without
  `accessibilityActions`, and for a component that calls `useHoldToConfirm()` but renders none.
  Limits: a hold built inside another hook (a `.ts` file) whose handlers reach a pressable through
  props, or a library component that takes `onLongPress`, is not judged; the release checklist is.

## Swipe, drag, pinch and custom actions

VoiceOver and TalkBack take over one-finger swipes to move focus, so an action that only a swipe,
drag, pinch or long press reaches is gone for their users, and a drag-only action fails people who
cannot drag (WCAG 2.2 2.5.1 Pointer Gestures, level A, and 2.5.7 Dragging Movements, AA). **Every
gesture-only action also works with one tap or through a named accessibility action** on the element
the screen reader focuses:

| Gesture | Screen-reader alternative | Single-pointer alternative |
|---|---|---|
| Swipe a task row to complete or delete (`ReanimatedSwipeable` `renderLeftActions` / `renderRightActions`) | `accessibilityActions={[{ name: 'complete', label: t(…) }, { name: 'delete', label: t(…) }]}` on the row's opener | the same actions in the task screen or a row menu |
| Drag to reorder (`Gesture.Pan()`, `DraggableFlatList`) | `move-up` / `move-down` actions on each row | Move up / Move down buttons in an edit mode |
| Pinch or rotate to zoom (`Gesture.Pinch()`, `Gesture.Rotation()`) | `increment` / `decrement` on an adjustable element, or zoom buttons | zoom in / zoom out buttons |
| Long press for a menu (`onLongPress`, `Gesture.LongPress()`) | `longpress` (TalkBack sends it on double-tap-and-hold) or a named action | a visible menu button |

The swipeable row is a shared `src/ui/` component (only `src/ui/` may import `Pressable`), and it
declares the actions itself, so no feature row built on it can leave them out:

```tsx
// src/ui/swipe-row.tsx (shape): the row's opener carries every swiped action as a named action.
export type SwipeAction = {
  readonly name: string;
  /** Translated: what the VoiceOver Actions rotor and the TalkBack actions menu speak. */
  readonly label: string;
  readonly onRun: () => void;
};

export function SwipeRow(props: SwipeRowProps): ReactNode {
  const styles = useStyles();
  const handleAction = (event: AccessibilityActionEvent): void => {
    props.actions.find((action) => action.name === event.nativeEvent.actionName)?.onRun();
  };
  return (
    <ReanimatedSwipeable
      renderLeftActions={props.renderLeftActions}
      renderRightActions={props.renderRightActions}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.openLabel}
        accessibilityActions={props.actions.map(({ name, label }) => ({ name, label }))}
        onAccessibilityAction={handleAction}
        onPress={props.onOpen}
        style={styles.row}
        testID={props.testID}
      >
        {props.children}
      </Pressable>
    </ReanimatedSwipeable>
  );
}
```

The feature's row passes its translated labels and handlers:
`actions={[{ name: 'complete', label: labels.complete, onRun: onComplete }, { name: 'delete',
label: labels.delete, onRun: onDelete }]}`, with the labels from the model hook.

- **VoiceOver** lists custom actions in the Actions rotor: with the row focused, swipe up or down to
  pick one and double-tap to run it. **TalkBack** lists them in its TalkBack menu (a three-finger
  tap on TalkBack 9.1 and newer, or swipe down then right in one motion), under the custom actions
  item (Google's TalkBack gesture help, 2026-10-03; not exercised on a device by this skill). The
  `label` is what both speak, so it comes from `t()`. Standard names (`activate`, `longpress`,
  `increment`, `decrement`, `escape`, `magicTap`) need no label.
- Put the actions on the element that gets focus (the opener), never on the swipeable container,
  which is not an accessibility element.
- `check-a11y-code` fails `gesture-alternative` when a component renders a `Swipeable` /
  `ReanimatedSwipeable` with revealed actions, a `GestureDetector` whose `Gesture.Pan/Pinch/
  LongPress/Fling/Rotation()` is built in the same component, a legacy `*GestureHandler`, or a
  `DraggableFlatList` with `onDragEnd`, and declares no `accessibilityActions` (or
  `onAccessibilityEscape` for a drag-to-dismiss) spelled out on an element or in a component it
  renders that declares them. An opaque spread does not count: `<TaskRow {...rowProps} />` under a
  swipeable fails unless `TaskRow` declares the actions. Limits: a gesture built in another file (a
  `use-drag-gesture.ts` hook) or another gesture library is not seen; the release checklist covers it.
- **An essential gesture** (WCAG's exception: a signature, a real-time game steered by dragging) is a
  reviewed exception, never a dummy action: after the developer agrees, list the file in
  `rn-skills.config.json` as `"a11yGestureExceptions": [{ "file": "src/games/arena-chase/arena-board.tsx",
  "reason": "…", "approvedBy": "…" }]`. The checker prints it on every run and fails an entry that
  no longer matches a finding.

## A card that opens a screen plus its own action

A task card whose body opens the task and whose Complete button completes it. A pressable inside
another accessible element is unreachable: the screen reader reads the outer element as one and
never lets focus into it. So the two are **sibling accessible elements, never nested**, and the
opener and the text layer it sits under **live in the same shared `src/ui/` component** (for
example `src/ui/action-card.tsx`). The canonical ESLint config lets only `src/ui/` import
`Pressable` and keeps `src/ui/` from importing `@/features/*`, so that component is generic: it
takes `openLabel`, `onOpen`, `testID`, the visible texts as `children` and the action as an
`action` node. The feature's card composes it with labels from its model hook (the worked example
`examples/accessible-task-row.md` shows both files). Keep the two together: with a shared opener
alone and the text layer left in each feature, every screen has to remember step 3.

1. The card is a plain `View` with the card look; it is not accessible itself.
2. Its first child is an absolutely filled `Pressable` (`StyleSheet.absoluteFill`, or
   `{ position: 'absolute', inset: 0 }` in a style object): the opener, with
   `accessibilityRole="button"`, a `testID`, and an `accessibilityLabel` that joins the card's
   visible texts in reading order (title, due date), built in the model hook from the same
   translated strings the card shows. React Native 0.86.3 no longer has
   `StyleSheet.absoluteFillObject`, so an old `{ ...StyleSheet.absoluteFillObject }` spreads
   nothing and the opener collapses (TypeScript reports it; `StyleSheetExports.js` read on
   2026-10-03; re-verify: `grep -n "absoluteFill" node_modules/react-native/Libraries/StyleSheet/StyleSheetExports.js`).
3. The visible texts sit above that layer in a `View` hidden from the screen reader
   (`accessibilityElementsHidden` and `importantForAccessibility="no-hide-descendants"`, or
   `aria-hidden`): they are already in the opener's label. **The same `View` passes touches
   through: style `pointerEvents: 'none'`.** A view drawn above the opener takes the touch: React
   Native gives a touch to the topmost view under the finger (Android's `TouchTargetHelper.kt` walks
   the children from the last one; iOS hit-testing does the same), and the responder then bubbles
   through that view's ancestors only, never to a sibling. Without it, taps on the title and the due
   date, most of the card, do nothing (React Native 0.86.3 source, read on 2026-10-03; re-verify:
   `grep -n "childrenCount - 1 downTo 0" node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/TouchTargetHelper.kt`).
   Write it in the style, not as the `pointerEvents` prop: React Native reads both, and
   react-native-web warns that the prop is deprecated.
4. The action is a separate accessible element placed above the opener, never inside it. Taps on
   the action reach the action; taps anywhere else on the card fall through the text layer to the
   opener. A wrapper `View` around several actions takes `pointerEvents: 'box-none'`, so its gaps
   pass touches through and its buttons still take them.

Nothing changes in the pixels. Test it by role and name: the joined label opens the task, the
action's label completes it, and the audit finds no inaccessible pressables. RNTL's `user.press` on
the opener cannot see a covering layer (it presses the element it is given), so the large-text Maestro
flow taps the card by its opener's `testID` and asserts that the task opened: Maestro taps the centre
of the opener's bounds on the real screen, which is where the text layer sits. Tap by the `testID`,
not by the title's text: the title sits in the layer hidden from screen readers, and iOS leaves
hidden elements out of the accessibility hierarchy Maestro searches (from how XCUITest reports
elements; Android not checked, its dump may still list the text).
`check-a11y-code` fails `nested-pressable` when an accessible pressable contains another pressable
(a raw one, or a component such as `Button` that renders one), and `opener-covered` when a layer
hidden from the screen reader, or text, drawn after an accessible absolutely filled opener has no
`pointerEvents` `none` (or `box-none`). It also follows a shared opener: a component whose returned
element is an accessible, absolutely filled pressable (a `<CardOpener>` in `src/ui/`) counts as an
opener where a feature renders it. A visible `View` there is left alone, because a sheet's card
over a backdrop button blocks touches on purpose; a visible wrapper of actions still needs
`box-none`, which only the device taps catch.

## Custom canvases

Skia content is invisible to the accessibility tree. A canvas that shows information (a chart, a
drawing, a game board) is **one accessible element**: `accessible`, `accessibilityRole="image"` and
`accessibilityLabel` = `t()` of a pure `describe(state)` ("6 of 9 tasks done this week, best day
Tuesday"), updated with the state. Unit-test `describe()` like any pure function. Add
`accessibilityIgnoresInvertColors` (iOS) when the canvas has its own dark variant, so Smart Invert
does not flip it twice. A canvas that is decoration only says so: `accessible={false}` or
`aria-hidden`. Interactive canvases can add `accessibilityActions` for their main moves.

## Announcements and live regions

Results and important events are announced with `useAnnounce()` (`src/ui/a11y/use-announce.ts`):
it speaks only while a screen reader runs (from `systemA11yStore`), with one short translated
sentence per user action. Never call `announceForAccessibility` directly, and never announce on every
frame or keystroke.

**Timing.** On iOS an announcement made right after a navigation or a focus change is often cut
off: VoiceOver starts reading the new screen and drops it. `useAnnounce()` therefore calls
`announceForAccessibilityWithOptions(text, { queue: true })`, which waits behind speech already
playing (React Native 0.86.3; `queue` and `priority` are iOS only, Android speaks it as a plain
announcement; re-verify: `grep -n -A20 "announceForAccessibilityWithOptions(" node_modules/react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo.js`).
Announce the result of an action, not the screen change itself: the screen's title is read anyway.

**Auto-dismissing toasts and banners.** Android's Settings > Accessibility > Time to take action
asks apps to keep timed messages up longer (WCAG 2.2.1). Schedule the dismissal with
`await AccessibilityInfo.getRecommendedTimeoutMillis(defaultMs)` (Android returns the user's value,
iOS returns `defaultMs`); it is a one-off calculation, not a switch, so it is called where the toast
is scheduled, not mirrored in the store. While a screen reader runs, keep a toast that holds an
action (Undo) up until it is dismissed, because focus may never reach it in time.

Android 16 deprecates announcement events (`TYPE_ANNOUNCEMENT`; verified on 2026-10-03 in the
Android 16 behaviour changes; re-verify: "Deprecating disruptive accessibility announcements" in
https://developer.android.com/about/versions/16/behavior-changes-all; React Native 0.86.3 still
sends them and TalkBack still speaks them).
For status text that changes on screen ("Saved", "3 tasks left"), prefer a live region on Android:
`accessibilityLiveRegion="polite"` (or `aria-live="polite"`) on the text, and keep `useAnnounce()`
for iOS and for events with no visible text.

`systemA11yStore` (a vanilla Zustand store) mirrors the OS switches (`isReduceMotionOn`,
`isScreenReaderOn`, `isBoldTextOn`); `watchSystemA11y(onError)` is called once from the root
layout's mount effect and is the only place that subscribes to `AccessibilityInfo`. A switch the app
needs and the store lacks (Reduce Transparency, Grayscale, Android high-contrast text) is added
there; `check-a11y-code` fails `a11y-store` for any `AccessibilityInfo.is*Enabled()`,
`prefers*()` or `addEventListener` outside the store file.

## Order, overlays and escape

- **Reading order equals visual order.** Do not move elements over the reading order with absolute
  positioning; in right-to-left locales the order starts at the top right (rtl-and-direction).
- **Overlays are modal on both platforms.** An overlay is anything drawn over the screen while the
  screen stays mounted: a dialog, sheet, action or overflow menu, popover, popup or drawer.
  `check-a11y-code` judges every `*-dialog`, `*-overlay`, `*-sheet`, `*-modal`, `*-popover`,
  `*-menu`, `*-drawer` and `*-popup` `.tsx` file (rename a file that only shares the word). In
  order of preference:
  1. an Expo Router modal route (`presentation: 'modal'` or `'formSheet'`): a native presentation,
     both screen readers stay inside. Route files are left out of the overlay check, because the
     navigator presents them. One caution: a form sheet with an undimmed detent
     (`sheetLargestUndimmedDetentIndex`) leaves the screen behind reachable while it sits at that
     detent. On Android, react-native-screens 4.26.2 hides the screens beneath a sheet only while it
     uses its dimming view (`ScreenStack.kt`, read on 2026-10-03; re-verify:
     `grep -n "sheetShouldUseDimmingView\|NO_HIDE_DESCENDANTS" node_modules/react-native-screens/android/src/main/java/com/swmansion/rnscreens/ScreenStack.kt`);
     on iOS, UIKit keeps the content
     under an undimmed detent interactive (Apple's `largestUndimmedDetentIdentifier`, not exercised
     here). Use undimmed detents only for sheets the user works beside, never for a decision;
  2. React Native's `<Modal>` (its own window on Android, its own presentation on iOS), with
     `onRequestClose` so Android's back gesture closes it;
  3. an in-tree overlay (a sheet drawn over the screen): one component owns the modal root. It
     sets `accessibilityViewIsModal` (iOS only) on the overlay's outermost layer, the scrim, and
     hides the content behind it while open with `aria-hidden={isOpen}` on the scrim's sibling that
     holds the screen (which also sets `importantForAccessibility="no-hide-descendants"`, the
     Android half). A hidden decorative part inside the layer (a grip, an icon) hides nothing
     behind it. `check-a11y-code` fails `modal-overlay-android` when the iOS flag stands alone.
     **Both halves act on siblings only:** UIKit's `accessibilityViewIsModal` hides the modal
     view's siblings, and `aria-hidden` hides only the subtree it sits on. An overlay host mounted
     inside a screen therefore leaves the native Stack header (its back button) and the tab bar
     reachable on both platforms. Mount the overlay host in the root layout, wrapping the navigator
     (as an `Overlay` component wraps its `children`), so the navigator is the hidden sibling; or
     use RN `Modal` or a modal route, which cover the whole window.
     Gesture Handler's `DrawerLayout` and `ReanimatedDrawerLayout` do both halves themselves
     (react-native-gesture-handler 2.32 source, read on 2026-10-03; re-verify:
     `grep -n "accessibilityViewIsModal\|no-hide-descendants" node_modules/react-native-gesture-handler/src/components/ReanimatedDrawerLayout.tsx`),
     so a drawer built on them counts as modal.
- **Never put the modal flag on the card inside the scrim.** A modal child hides its ancestors'
  identifiers: the scrim's `testID` and the screen under it dropped out of the accessibility tree,
  and every E2E step that waited for the screen failed "element not found".
- **Escape.** VoiceOver's two-finger scrub ("Z") and Android's back gesture should close an
  overlay or step back. Native stacks and RN `Modal` handle both; a custom in-tree overlay adds
  `onAccessibilityEscape` (iOS) and a `BackHandler` listener (Android; predictive back on
  Android 16 animates it) that call the same close action.
- The first thing read on each screen is its title; nothing is read as just "button".

## Languages

Text in another language than the UI (language names in a language picker, a quoted foreign
title) sets `accessibilityLanguage` with a BCP 47 tag (the text primitive's `language` prop), so
VoiceOver switches voice. The prop is iOS only: TalkBack speaks with the text-to-speech language of
the device or the app locale, and React Native 0.86 has no per-element equivalent on Android
(verified in `ViewAccessibility.d.ts`, `AccessibilityPropsIOS`).

## iOS and Android differences at a glance

| Need | iOS (VoiceOver) | Android (TalkBack) |
|---|---|---|
| Keep focus inside an overlay | `accessibilityViewIsModal` on the overlay root (`aria-modal` only on `Pressable` and `TouchableOpacity`/`Highlight`/`NativeFeedback`; the web reads `aria-modal`) | hide what is behind: `aria-hidden` / `importantForAccessibility="no-hide-descendants"`, or RN `Modal` |
| Name from another element | none: `aria-labelledby` / `accessibilityLabelledBy` are ignored | `aria-labelledby` / `accessibilityLabelledBy` (still give `accessibilityLabel` for iOS) |
| Hide a subtree | `accessibilityElementsHidden` | `importantForAccessibility="no-hide-descendants"` (`aria-hidden` sets both) |
| Speak an update | `useAnnounce()` | live region (`accessibilityLiveRegion="polite"`); `useAnnounce()` still works, deprecated on Android 16 |
| Voice per element | `accessibilityLanguage` | none (device TTS language) |
| Escape | `onAccessibilityEscape` (two-finger Z) | back gesture / `BackHandler` |
| Long press for screen-reader users | custom `accessibilityActions` | `longpress` action (double-tap and hold) |
| Swipe, drag or pinch actions | named `accessibilityActions` in the Actions rotor | the same actions in the TalkBack actions menu |
| An announcement after a screen change | `queue: true` waits for VoiceOver | spoken as a plain announcement (options ignored) |
| Large content viewer for small bars | `accessibilityShowsLargeContentViewer` | none |
| Reduce motion source | Reduce Motion switch | Remove animations (transition scale 0) |
