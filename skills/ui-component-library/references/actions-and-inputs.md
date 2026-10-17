# Actions and inputs

Anatomy, states, accessibility and the do and don't of everything a person presses or sets.
Measurements are `COMPONENT_SPECS.<group>` names (the demo values are in the token file's
`components` block, [measurements-and-specs.md](measurements-and-specs.md)); colours are semantic
roles of the theme (`primary`, `onPrimary`, `surface`, `sunken`, `text`, `textMuted`, `border`,
`separator`, `danger`, `dangerSurface`).

## Contents

1. [The press model every control shares](#the-press-model-every-control-shares)
2. [Button and TextButton](#button-and-textbutton)
3. [IconButton](#iconbutton)
4. [HoldButton](#holdbutton)
5. [TileButton and ToggleTile](#tilebutton-and-toggletile)
6. [NavCard and ActionCard](#navcard-and-actioncard)
7. [Checkbox, Toggle and RadioMark](#checkbox-toggle-and-radiomark)
8. [SegmentedControl](#segmentedcontrol)
9. [Slider](#slider)
10. [OptionCard](#optioncard)
11. [ProgressBar](#progressbar)

## The press model every control shares

Every pressable composes design-system-structure's `PressableSurface`: it draws the face (fill,
edge, radius), plays the press look the theme chose (`PRESS.kind`: `opacity` by default, `scale`,
or the opt-in `sink`; the Android ripple when `PRESS.androidRipple`), mutes the face when disabled,
sets role, name, hint and state (`disabled`, `busy`, `selected`, `checked`), and runs the injected
press feedback (`usePressFeedback`) before `onPress`. A component passes `label`, `onPress`,
`testID`, `radius`, `fill`, `edgeColor`/`edgeWidth`, `isReducedMotion`, its `faceStyle` (padding,
direction, gap, minimum height) and its `layoutStyle` (how it sits in its parent).

- **One press implementation.** No `Pressable`, `Touchable*`, core `Button` or gesture-handler
  button anywhere else (`press-outside-host`), and no hand-written pressed look
  (`own-press-look`): every control then answers, sounds and announces the same way, and the look
  changes in one token.
- **A switch plays its own feedback.** `PressableSurface` skips the tap for `accessibilityRole`
  `switch`; the switch's handler plays the toggle sound or haptic after it dispatches. Without a
  `PressFeedbackProvider` the feedback is silent, so component tests need no audio fake.
- **Persistent states move by layout**, never a transform (the sink look's pushed-in key): VoiceOver,
  TalkBack and Maestro report layout frames. design-system-structure owns that rule.
- **Touch targets** are the face's own box, at least `MIN_TOUCH` (44 pt; 48 for a Material design),
  never `hitSlop` (accessibility-as-code owns the rule and its check).

## Button and TextButton

**Template:** `button.tsx` (`Button`), `text-button.tsx` (`TextButton`), paint in `variant-paint.ts`.

**Anatomy:** a face with an optional leading icon (`icon`), the label (`buttonLabel` style), an
optional trailing icon (`iconEnd`: forward arrows only). `button`: `minHeight`, `minHeightLarge`,
`paddingBlock`, `paddingInline`, `gap`, `radius`, `border`, `icon`, `rowMinBasis`.

| Variant | Fill | Label and icons | Edge |
|---|---|---|---|
| primary | `primary` | `onPrimary` | `primary` |
| secondary (default) | `surface` | `text` | `border` |
| danger | `surface` | `danger` | `danger` |

**States:** default; pressed (the press model); disabled (`isDisabled`: muted paint, presses
ignored, `accessibilityState.disabled`); busy (`isBusy`: the label stays, the busy blocks replace
the leading icon, presses ignored, `accessibilityState.busy`).

**Layout:** inline by default (hugs its content); `isBlock` stretches to the column; `size="large"`
is the screen's main call to action and always a block; `isInRow` grows from `rowMinBasis` so two
buttons share a row and wrap to two rows at large text, and stretches to the row's height so both
keys are as tall as the taller one.

**TextButton:** a flat action for the quieter choice ("Not now", "Show details"): no fill, no edge,
the label in `text` (or `danger` with `tone="danger"`), and an underline drawn as a bar
(`textButton.underlineThickness`, `underlineOffset`). It is drawn because `textDecorationLine`
cannot set a thickness or an offset on iOS or Android (`drawn-underline`).

**Accessibility:** role `button`, name = the visible label, a translated `hint` only when the result
is not obvious. **Parts:** `.label` (and `.underline` on TextButton).

**Do:** one primary per screen; put the safe choice first in a row of two. **Don't:** paint a
destructive action `primary`; put two primary buttons side by side (a pair is secondary + primary);
give a TextButton a shadow or a fill.

## IconButton

**Template:** `icon-button.tsx`. A square face (`iconButton.size` 48, `sizeSmall` = the 44 pt
minimum) with one icon from the app's icon set (`iconButton.icon`). **Accessibility:** `label` is
required: an icon has no text for a screen reader to read. **Don't:** go below 44 pt; use one for an
action that has no recognisable icon (use a TextButton).

## HoldButton

**Template:** `hold-button.tsx` over `use-hold-to-confirm.ts`. A destructive block button
("Hold to delete all tasks") whose `dangerSurface` fill grows from the start edge while the finger
stays down; it confirms when the fill is full (`MOTION_MS.holdToConfirm`), and lifting early empties
it. A short tap does nothing.

- **The timer passes `ReduceMotion.Never`** (`hold-reduce-motion`): under Reduce Motion Reanimated
  otherwise finishes a timing at once, and the hold would confirm on touch.
- **The fill sits in a track pinned to the face edges** (`hold-fill-track`): Yoga resolves an
  absolute child's percentage width inside its parent's padding, so a fill placed straight in the
  face ends short by the padding when it is full.
- **Screen readers confirm with the activate action** (a double tap): the hold is never the only
  way. The `hint` says how long to hold, and the screen also shows it as a caption.
- `frozenProgress` (0..1, read at mount) holds a still fill for a screenshot of the held state.
- Contrast: the `danger` label stays on the key while the fill grows under it, so the pair danger on
  `dangerSurface` is declared in `contracts/contrast.json` (accessibility-as-code) and passes 4.5:1.

**Part:** `.fill`.

## TileButton and ToggleTile

**Templates:** `tile-button.tsx`, `toggle-tile.tsx`. Square-ish keys for a grid of quick actions:
an icon over a label (`tileButton`: `minHeight`, padding, `gap`, `icon`). `ToggleTile` switches
one setting: role `switch`, `accessibilityState.checked`, filled `primary` when on, and a written
state line ("On" / "Off", with a check when on) so the state is never colour alone.

**Layout:** each grows into its cell of a row or grid with `{ flexGrow: 1 }`, never `flex: 1`
(`pair-cell-flex`): in a column cell `flex: 1` is a zero vertical basis, and the row measured 0 pt
on a device while every Jest test passed (Jest has no layout engine). At large text the screen
stacks the grid; that is the screen's job. **Parts:** `.label` (ToggleTile adds `.state` and, when on, `.check`).

## NavCard and ActionCard

**NavCard** (`nav-card.tsx`): a block button laid out as a row that opens another screen: an icon
tile, the label (bold) and an optional description, a chevron that points where reading goes on.
One button; its name is the label, or a translated `a11yLabel` sentence when the description
matters ("Archive, 12 finished tasks"). **Parts:** `.icon`, `.label`, `.description`.

**ActionCard** (`action-card.tsx`): a card that opens something and holds its own action (a task
row: the body opens the task, the checkbox completes it). The opener (a `PressableSurface` filling
the card and painting its face) and the action are siblings, never nested: a screen reader reaches
only the outer one of two nested pressables. The text layer is drawn above the opener, so it passes
touches through (`pointerEvents: 'none'`) and hides from screen readers (the opener's `openLabel`
says the texts). All three live in this one component so no screen can forget one
(accessibility-as-code's `nested-pressable` and `opener-covered` checks).

## Checkbox, Toggle and RadioMark

**Checkbox** (`checkbox.tsx`): a 44 pt target around a drawn box (`checkbox.box`); checked fills it
`primary` with a drawn check (`CheckMark`). Role `checkbox`, `accessibilityState.checked`, a
translated name of what it checks ("Complete Buy milk"). **Part:** `.check`.

**Toggle** (`toggle.tsx`): the on/off graphic of a switch row: a track and a knob that slides to
the end (it follows the layout direction), a check in the knob when on. It hides itself: the whole
row is the switch, so it is not a second target. Under reduce motion the knob jumps. **Part:**
`.check` (only when on; the test asserts it present when on and absent when off).

**RadioMark** (`radio-mark.tsx`): a ring, with a dot when chosen. It hides itself: the row or card
around it is the radio. **Part:** `.dot` (only when chosen).

## SegmentedControl

**Template:** `segmented-control.tsx` (`SegmentedControl<TValue>`). A row of equal segments (one
always chosen): the chosen one is filled `primary` and carries a check before its label.
**Accessibility:** the group carries `accessibilityRole="radiogroup"` and the group's name but is not
one accessibility element (its radios stay reachable); each segment is a `radio` with
`accessibilityState.selected`. **Ids:** the group is `testID`; each segment is `${testID}.<value>`
(a stable value, never a position) with `.label`, and `.check` on the chosen one only (its
test asserts the check on the chosen segment and on no other). **Don't:** show more than three or four
segments (use a list of radio rows); put a check on more than one.

## Slider

**Template:** `slider.tsx`. A value from 0 to 1: a 44 pt target, a track (`slider.trackHeight`),
the fill from the start edge (right to left in RTL), a thumb with a small shadow (it floats).

- **Input:** `Gesture.Race(pan, tap)` (react-native-gesture-handler 2.32, verified on 2026-10-03;
  re-verify with `npm ls react-native-gesture-handler` and `grep -n "Race" node_modules/react-native-gesture-handler/lib/typescript/handlers/gestures/gestureObjects.d.ts`). The pan starts after
  8 pt sideways (`activeOffsetX`) and fails after 8 pt up or down (`failOffsetY`), so a vertical
  swipe that starts on the slider still scrolls the list under it; a tap jumps to the point.
- **Accessibility:** role `adjustable`, a translated name, `accessibilityValue` 0 to 100, and the
  `increment` / `decrement` actions (a tenth per step): VoiceOver adjusts with a swipe up or down,
  TalkBack with its adjust gestures or the volume keys. React Native maps both actions on iOS and
  Android; the Jest test proves the handler, and a human pass on both readers proves the feel.
- `isMuted` greys the fill when what it controls is off, keeping the value.
- Tests drive gestures with `fireGestureHandler` and `gestureTestID` (`<id>.pan`, `<id>.tap`).

**Part:** `.fill`.

## OptionCard

**Template:** `option-card.tsx`. One choice of a list (a sort order, a language): label, optional
description, an optional hugging badge, a radio mark at the end. Chosen: a bold `primary` edge and
the dot. **Accessibility:** role `radio`, `accessibilityState.selected`; an autonym passes
`labelLanguage` (`accessibilityLanguage`, iOS only) so VoiceOver switches voices; TalkBack picks the
voice from the system language or the text's locale span, which React Native does not expose
(verified on 2026-10-03: `@platform ios` in React Native 0.86.3; re-verify with
`grep -n -B3 'accessibilityLanguage?:' node_modules/react-native/Libraries/Components/View/ViewAccessibility.d.ts`). A hugging badge sets
`alignSelf` on itself, which beats the row's `alignItems`, so the card centres it in a wrapper.
**Parts:** `.label`, `.description`, `.radio`.

## ProgressBar

**Template:** `progress-bar.tsx`. A track filled from the start edge. Role `progressbar`, a
translated label with the numbers ("3 of 8 tasks done") and `accessibilityValue` 0 to 100; values
outside 0..1 are clamped. Not interactive. **Part:** `.fill`.
