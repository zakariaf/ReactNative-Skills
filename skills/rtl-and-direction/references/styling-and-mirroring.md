# Styling and mirroring

What mirrors in a right-to-left layout, what must not, and how to write styles so React Native does
the mirroring for you. Holds the checklist a design system fills in for its components.

## Contents

- Logical style keys
- Rows, grids and order
- Text alignment and writing direction
- Safe areas are physical
- Icons: which flip
- The design system's RTL checklist
- Physical surfaces
- Gestures and motion

## Logical style keys

Physical left/right keys never appear in a style: `StyleSheet.create` (also inside a `makeStyles`
factory), any `style`/`*Style` prop, a `*Style`-typed variable, a helper typed to return a style
(`function countAlign(): TextStyle`, `(x: number): ViewStyle => (...)`), a Reanimated
`useAnimatedStyle`. Code may still use `left`/`right` as **data** (a swipe left completes a task in
every language).

**What React Native does with a physical key** (read in the React Native 0.86.3 source, 2026-10-10):
in a right-to-left layout it rewrites `left`/`right`, `marginLeft`/`Right`, `paddingLeft`/`Right`,
the left/right border widths, colours and radii into their start/end forms before layout
(`YogaLayoutableShadowNode::swapStyleLeftAndRight()`, called from `layoutTree` when
`layoutContext.swapLeftAndRightInRTL` is set and the surface is right to left). The switch is on by
default: iOS `RCTI18nUtil` calls `swapLeftAndRightInRTL:true` when it is created, Android's
`I18nUtil.doLeftAndRightSwapInRTL` defaults to true. So `marginLeft: 8` usually lands where
`marginStart: 8` would. The rule still holds, for these reasons:

- **The swap is a global, mutable native preference.** `I18nManager.swapLeftAndRightInRTL(false)`
  turns it off for the whole app; Android keeps the value in `SharedPreferences` across launches,
  iOS in `NSUserDefaults` until the next launch resets it. Any library, debug menu or older build
  can flip it, and every physical key then sits on the other side. Logical keys do not depend on it.
- **A physical and a logical key on one element collide after the swap.** `{ marginLeft: 4,
  marginStart: 8 }` gives 8 at the left in a left-to-right layout (Yoga prefers the logical edge,
  `Style::computeLeftEdge`) but 4 at the right in a right-to-left one (the swapped `marginLeft`
  overwrites `marginStart`): one style, two sizes.
- **react-native-web never swaps** (0.21.3 flips only the logical properties); a physical key
  there stays physical.
- **`left`/`right` cannot express a truly physical offset in a right-to-left app.** A drag thumb, a
  scrubber or a crop handle positioned with `left: x` is silently mirrored in Arabic. Drive such a
  position with `transform: [{ translateX: x }]` (transforms are never swapped), or place it inside
  a `PhysicalDirectionView`, where `start` is the left edge.

Re-verify after an upgrade: `grep -n "swapLeftAndRightInRTL\|swapStyleLeftAndRight" node_modules/react-native/ReactCommon/react/renderer/components/view/YogaLayoutableShadowNode.cpp node_modules/react-native/React/Modules/RCTI18nUtil.m node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/i18nmanager/I18nUtil.kt`.

| Instead of | Write |
|---|---|
| `marginLeft` / `marginRight` | `marginStart` / `marginEnd` (or `marginInline` when equal) |
| `paddingLeft` / `paddingRight` | `paddingStart` / `paddingEnd` (or `paddingInline`) |
| `left` / `right` (absolute position) | `start` / `end` |
| `borderLeftWidth`, `borderRightColor` … | `borderStartWidth`, `borderEndColor` … |
| `borderTopLeftRadius` … | `borderTopStartRadius`, `borderTopEndRadius`, `borderBottomStartRadius`, `borderBottomEndRadius` |
| `textAlign: 'left' / 'right'` | `<AppText align="start" / "end">` |
| `flexDirection: 'row-reverse'` | `flexDirection: 'row'` (it already mirrors) |
| `transform: [{ scaleX: -1 }]` on content | nothing: only directional icons flip, inside `Icon` |

The canonical ESLint config (typescript-and-lint-rules) bans the same inside style contexts;
`check-rtl` proves it without ESLint, in Reanimated styles too.

**What the checker cannot see** (it reads source text, not types): a style built by a helper with no
`*Style` return annotation (`function badge() { return { marginLeft: 4 } }`), a style object spread
in from another module, or a key computed at run time (`{ [side]: 4 }`). Annotate style helpers with
their style type (`: TextStyle`, `: ViewStyle`) so they are checked, and review the rest by hand.
For `textAlign` it flags a `'left'` or `'right'` literal anywhere in the value expression, so an
`isRtl ? 'right' : 'left'` ternary fails; a value read from a variable or a lookup table outside the
text style hook (`textAlign: ALIGN[side]`) does not, so keep such tables in that hook only.

## Rows, grids and order

- `flexDirection: 'row'` follows the layout: the first child sits at the start edge (left in a
  left-to-right layout, right in a right-to-left one). Never reverse arrays or styles "for RTL".
- `flexWrap: 'wrap'` grids fill from the start edge: the first item is top-left in English and
  top-right in Arabic, in a `ScrollView`, a `FlatList` and a `FlashList` alike (verified with
  `ScrollView`, `FlatList` and `FlashList` on iOS).
- A horizontal `FlatList` or `ScrollView` starts at the start edge and scrolls toward the end in
  both directions; do not set `inverted` for RTL (it is for chat-style lists).
- Things that run in reading order mirror through `row` and `start`/`end`, never transforms: a
  week strip (the first day of the week at the start edge), a horizontal bar chart, a progress
  bar's fill, a slider's track, a stepper.
- Components never read `I18nManager.isRTL`: `useDirection()` is the one source for layout
  decisions (`check-rtl` rule `i18nmanager`; react-components-and-hooks' `check-react-rules` rule
  `no-isrtl` fails a bare `isRTL` read outside `src/i18n/direction.ts` too, configurable through
  `rn-skills.config.json` `reactRules.directionModules`).

## Text alignment and writing direction

Every text renders through design-system-structure's `AppText`, which takes its style from
`useTextStyle()`:

- `textAlign` is always set explicitly, through `TEXT_ALIGN = { start: 'left', center: 'center',
  end: 'right' }`: React Native swaps `'left'` and `'right'` in a right-to-left layout
  (`doLeftAndRightSwapInRTL`, on by default), so `'left'` means start. `'auto'` follows the text's
  own first letter instead of the layout, which puts an English word in an Arabic row at the wrong
  edge. Verified (iOS 26.5, forced right to left on an English phone): `'left'` rendered on the
  right, `'right'` on the left, `'auto'` stayed left.
- `writingDirection` comes from the text locale (`TextLocaleProvider`), or from AppText's
  `direction` prop for a whole text in the other direction. iOS reads it; Android ignores it
  (React Native types it iOS-only), so AppText starts such a text with a direction mark on Android
  (design-system-structure owns that seam).
- `Text` from `react-native` is imported only in `src/ui/app-text.tsx` (`check-rtl` rule
  `text-import`); no other file sets `writingDirection` (`writing-direction`) or a `textAlign`
  literal (`text-align-literal`).

The cases this skill owns (digits-bidi-and-text.md has the details): a whole left-to-right text in
a right-to-left row takes `direction="ltr"`; a text the app did not write (a task title) takes the
direction of its first strong letter (`firstStrongDirection()`); a catalog text in the layout's
language that starts with a word of the other script (a brand name first) takes
`direction={directionOf(language)}` so Android does not lay it out by that first word.

## Safe areas are physical

Insets from `react-native-safe-area-context` (`useSafeAreaInsets()`, `SafeAreaView` `edges`) are
physical: `top`, `bottom`, `left`, `right`. The notch, a camera cutout and Android's navigation bar
in landscape sit on a physical side and do not move when the layout mirrors. Never map `insets.left`
to `paddingStart` by hand (in Arabic that pads the wrong side), and never to `paddingLeft` either:
React Native swaps `paddingLeft` to `paddingStart` in a right-to-left layout, so it pads the wrong
side too. Take the sides symmetrically, the
way design-system-structure's screen frame does: `paddingInline: Math.max(LAYOUT.screenGutter,
insets.left, insets.right)`, or let `SafeAreaView edges={['left', 'right']}` apply them. The status
bar and system chrome are not mirrored by the app either. `check-rtl` fails the `paddingLeft` form
(`physical-style-key`); react-components-and-hooks' `check-react-rules` rule `inset-direction`
fails `insets.left`/`insets.right` fed into a start/end key.

## Icons: which flip

Only icons that point along the reading direction flip, and the `Icon` component does it, with
`transform: [{ scaleX: -1 }]` when `useDirection()` is `'rtl'` and the name is in
`DIRECTIONAL_ICONS`, so no call site can forget it (`scale-x-flip` allows the transform only in the
Icon component).

| Flips in a right-to-left layout | Never flips |
|---|---|
| `back` (the header back arrow), `forward` ("Next", "Continue"), `chevron` (row disclosure), `undo`, `redo`; add others that point along reading order (`reply`, `send`, list-indent) | `play`, `pause`, media skip (media time runs left to right), clocks and timers, `check`, `close`, `search`, `lock`, logos, photos and pictures, the gear and every object icon, a question mark |

`DIRECTIONAL_ICONS` is exactly the members of the contract's `directionalIcons` (default `back`,
`forward`, `chevron`, `undo`, `redo`) that exist in `ICON_PATHS` (`check-rtl` rule
`directional-icons` fails an extra or a missing entry): an icon set that gains an arrow later must
not flip too little, and a play button must never flip. An app whose icon set lives elsewhere sets
`iconSet` and `iconComponent` in `contracts/rtl.json`; icons-app-icon-and-splash owns the icon set
itself.

## The design system's RTL checklist

The design system fills these in for its components and keeps them as decisions (design-system-
structure owns the tokens; design-visual-parity compares the screens):

1. **Layout mirrors, light does not.** Shadows point down in both directions; a shadow offset with
   an x component stays physical (light comes from one side of the screen).
2. **Things that fill from the start edge run right to left:** progress and slider fills, a
   hold-to-confirm fill, a toggle's "on" position (the end edge).
3. **Things at the start or end follow:** a badge at the top-end corner, a leading icon, a trailing
   chevron, dialog buttons (the safe choice at the start).
4. **Decoration does not mirror:** a tilted sticker keeps its angle, confetti and particles scatter
   from where the design draws them. A decoration placed physically sits in a
   `PhysicalDirectionView`, where `start` is the left edge, instead of using physical keys.
5. **One sanctioned branch:** when a design gives an asymmetric component physical paddings that
   must not mirror, the component reads `useDirection()` and swaps its logical values; that branch
   is documented in the component and is the only `useDirection()` call in styling.
6. **Fonts and digits:** the script's font and line heights come from the design system;
   letter-spacing is 0 for connected scripts (Arabic); numbers show in the language's digits.
7. **Centred stays centred.** Decide which elements are centred (an empty state, a title on a
   splash); everything else starts at the start edge.

## Physical surfaces

A surface whose content has a physical meaning keeps it in every language: a map, a photo with
annotations, a media scrubber (time runs left to right), a drawing pad, a game board, a chart whose
x axis is physical (a floor plan). Wrap it in `PhysicalDirectionView`
(`templates/src/ui/physical-direction-view.tsx`): `direction: 'ltr'` stops React Native from
mirroring rows, start/end keys and absolute start/end positions of the view children inside it
(verified: a `direction: 'ltr'` view kept `1 2 3` left to right and an absolute `start: 0` marker on
the left while the screen around it mirrored). List the component in `contracts/rtl.json`
`physicalSurfaces` and `check-rtl` rule `physical-surface-ltr` fails any use outside the wrapper.

A surface whose content reads in the language's direction (a timeline, a week strip drawn as views,
a reading-order grid) passes `mirrorsInRtl` and mirrors like the rest of the screen. A Skia canvas
draws in physical pixels whatever the layout direction; skia-canvas-rendering owns how a canvas
surface opts into mirroring (in its layout mapping, used by drawing and hit-testing alike, never a
`scaleX: -1`), and its numbers arrive as strings formatted with the locale tag.

## Gestures and motion

- Gestures are physical: a swipe left moves content left in every language; a horizontal pager
  advances toward the end edge (React Native's `ScrollView` paging follows the layout).
- A position that follows a finger (a slider thumb, a scrubber, a drag handle) is
  `transform: [{ translateX }]` from the gesture's physical x, never `left: x` or `start: x`: React
  Native swaps `left` to `start` in a right-to-left layout and the thumb would run against the
  finger. A slider whose fill grows from the start edge maps the value first (`x = isRtl ? width -
  w : w` inside the component that owns the gesture, reading `useDirection()`).
- A slide-in transition comes from the end edge in the reading direction; navigation stacks do this
  by themselves (they follow the layout direction).
- Reduce motion and the moment catalogue belong to accessibility-as-code and motion-and-animation;
  only the direction of motion is this skill's concern.
