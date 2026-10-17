# Lists, surfaces, overlays and data displays

Everything that lies flat and informs, everything that floats over a screen, and the small parts
that draw state. Measurements are `COMPONENT_SPECS.<group>` names; colours are theme roles.

## Contents

1. [Flat by default](#flat-by-default)
2. [List, ListGroup and SectionHeader](#list-listgroup-and-sectionheader)
3. [ListRow and SubRow](#listrow-and-subrow)
4. [IconTile](#icontile)
5. [Card, CardHeader and Callout](#card-cardheader-and-callout)
6. [Badge and Chip](#badge-and-chip)
7. [AppBar](#appbar)
8. [Scrim, DialogCard and DialogButtonRow](#scrim-dialogcard-and-dialogbuttonrow)
9. [Toast and ToastStack](#toast-and-toaststack)
10. [EmptyState](#emptystate)
11. [StatGrid and BarChart](#statgrid-and-barchart)
12. [PagerDots, BusyIndicator, CheckMark, Chevron, Confetti](#pagerdots-busyindicator-checkmark-chevron-confetti)

## Flat by default

A shadow says "this floats" (a dialog, a toast, a slider thumb) or, with the sink look, "this can
be pressed". Lists, rows, cards, chips and badges lie flat (`shadow-outside-allowed`); a card that
does something holds a button or is an ActionCard. Static shadows use design-system-structure's
`shadow()` (boxShadow, the same on iOS and Android 9+), never the legacy `shadow*` or `elevation`
keys. Only components the catalogue marks `mayShadow` cast one.

## List, ListGroup and SectionHeader

**List** (`list.tsx`): a flat group of rows with a hairline edge that clips them to its corners. It
is for short, bounded groups (settings, a form section); a long or data-driven list is a `FlatList`
whose `renderItem` returns ListRow (FlashList when measured; react-components-and-hooks owns lists).

**SectionHeader** (`section-header.tsx`): the heading above a group. The header View is the one
accessible element: it carries the testID, `accessible`, `accessibilityRole="header"` and the title
as its label, and the AppText inside has no testID (`testid-on-inner-text`), so an E2E tool measures
the whole header, not only its words.

**ListGroup** (`list-group.tsx`): a SectionHeader over a List. **Parts:** `.header`, `.list`
(`settings.reminders` gives `settings.reminders.header` and `settings.reminders.list`).

## ListRow and SubRow

**ListRow** (`list-row.tsx`): one row; the whole row is the target.

| `kind` | Role | State | End |
|---|---|---|---|
| `navigate` | button | | Chevron |
| `switch` | switch | `checked` (`isOn`) | Toggle (hidden; `.toggle`) |
| `radio` | radio | `selected` (`isSelected`) | RadioMark (hidden; `.radio`) |
| `static` (default) | none (a plain View) | | |

- Anatomy: an optional icon on an IconTile (`.icon`), the text column (label `rowLabel`, optional
  description `rowDescription` in `textMuted`), an optional muted `value` (`.value`), the end part,
  and an optional `below` line at full width (a SegmentedControl). Rows after the first draw a
  hairline separator on top (`isFirst` drops it).
- The row wraps (for `below`), and a wrapping row centres a single line of parts only with
  `alignContent: 'center'`: Yoga's default (`flex-start`) puts the parts at the top of the row.
- `isDanger` paints the label `danger` (bold) and the tile `dangerSurface`.
- `labelLanguage` marks an autonym: AppText passes it on as `accessibilityLanguage`, which only
  VoiceOver reads (iOS only). TalkBack picks the voice from the system language or the text's
  locale span, which React Native does not expose, so on Android an autonym is read in the UI
  language's voice. `a11yLabel` is the sentence a row is heard
  by when the value matters ("Language, English"), built with `t()` by the screen model, never
  glued in the component.

**SubRow** (`sub-row.tsx`): a secondary line under a row, indented to the row label: a muted label
and the control that refines the row above (a volume Slider under "Daily reminder"). **Part:**
`.label`.

**Do:** make the whole row the target. **Don't:** put a raised button inside a row; give rows or
lists a shadow; nest a pressable in the row (use ActionCard).

## IconTile

**Template:** `icon-tile.tsx`. An icon from the app's icon set on a tinted square (`iconTile.size`;
`size="large"` leads a dialog or an empty state). Paints: `neutral` (sunken, text), `primary`
(primary, onPrimary), `danger` (dangerSurface, danger). Decorative: the row or card it leads carries
the name, so it hides itself (`decorative-not-hidden`).

## Card, CardHeader and Callout

**Card** (`card.tsx`): a flat surface that groups related content: hairline `separator` edge,
`card.radius`, `card.padding`. `tone="muted"` sits on `sunken`; `tone="danger"` tints an error
(danger edge, `dangerSurface`); `padding="compact"`; `isRow` for an icon beside text.

**CardHeader** (`card-header.tsx`): optional leading tile, the title as a header (`.title`), one
optional trailing action.

**Callout** (`callout.tsx`): a Card laid out as a row: an icon at the top start and a note.
- The icon sits at the top (`alignSelf: 'flex-start'`), nudged to the first line of text
  (`callout.iconNudge`): a centred icon drifts down as the note wraps.
- A note that fits on one line is as wide as its text (`flexShrink: 1`), a wrapped note fills the
  row; AppText's `onLineCount` tells which. Otherwise a one-line right-to-left note starts at the far
  end of the card instead of at its first word.
- `isError` paints the edge, tint and icon danger; `isStrong` sets the text in `rowLabelStrong`.
**Parts:** `.icon`, `.label`.

## Badge and Chip

**Badge** (`badge.tsx`): a small status label with an optional icon. Tones: neutral, primary,
success, warning, danger; a status tone always comes with a word, never colour alone. It hugs its
text (`alignSelf: 'flex-start'`), so a parent's `alignItems: 'center'` does not centre it: centre one
in a row wrapper with `justifyContent: 'center'`. `tiltDeg` adds a decorative tilt, clamped to
`badge.maxTilt`, that keeps its angle in right-to-left layouts (a tilt is a printed look, not a
direction); the catalogue marks Badge `mayRotate`.

**Chip** (`chip.tsx`): a small flat label (a list name, a date, a step counter); not interactive.

Both are one accessible text element: the box carries the testID, `accessible`,
`accessibilityRole="text"` and the text as its label, so the bounds an E2E tool reads are the
badge's, not its words' (`testid-on-inner-text`).

## AppBar

**Template:** `app-bar.tsx`. A custom top bar for a screen that hides the router's header: a back
IconButton (`.back-button`, the app's back icon, which its icon set flips in right-to-left), the
title as a header (`.title`, wraps at large text), one end action. Prefer the native header of the
Expo Router stack (`<Stack.Screen options={{ title }} />`): it handles the safe area, large titles
and Android's back. With a custom bar, the screen frame keeps the top inset, and Android's hardware
back and predictive back gesture still go through the router (navigation-and-routing).

## Scrim, DialogCard and DialogButtonRow

**Scrim** (`scrim.tsx`): dims the screen (`scrim` role, the only translucent paint) and centres a
dialog, inside React Native's `Modal` (`transparent`, `animationType` `fade`, or `none` under reduce
motion).
- **The scrim is the modal root** (`modal-root`): `accessibilityViewIsModal` sits on its View, never
  on the card. A modal child hides its ancestors' identifiers: with the flag on the card, the
  scrim's testID (and the screen under it) dropped out of the accessibility tree E2E tools read.
- **It closes on Android's back** (`modal-back`): `onRequestClose` on the Modal receives the hardware
  back button and the predictive back gesture. It never fires on iOS for the Scrim: a transparent
  Modal presents over full screen, and the iOS swipe-to-dismiss belongs to `pageSheet` and
  `formSheet` modals ([layout-and-platform-lessons.md](layout-and-platform-lessons.md)). RN's
  Modal is a separate window on both platforms, so VoiceOver and TalkBack stay inside it.
- **Edge to edge:** on Android 15 and 16 (target SDK 35+) React Native 0.86 already draws the
  Modal edge to edge, so the scrim covers the system bars; `statusBarTranslucent` and
  `navigationBarTranslucent` make Android 14 and older match, and are always set together (the
  second alone is unsupported and warns). Source and re-verify commands:
  [layout-and-platform-lessons.md](layout-and-platform-lessons.md).
- An Expo Router modal route (`presentation: 'modal'` or `'transparentModal'`) is the other good
  home for a dialog; it gets back handling from the navigator.

**DialogCard** (`dialog-card.tsx`): the card on the scrim: optional art (a large IconTile), the
title as a header, a body, then the buttons. It floats, so it casts the one shadow among surfaces
(`mayShadow`). Its testID is the card's own (`delete-task-dialog.card`); `.title` and `.body`
derive from it.

**DialogButtonRow** (`dialog-button-row.tsx`): the row of `isInRow` buttons, the safe choice
(Cancel) first; it wraps at large text and mirrors in right-to-left. **Do:** always offer a way out;
keep the body to two or three lines. **Don't:** put a second primary button in a dialog.

## Toast and ToastStack

**Toast** (`toast.tsx`): a short message about something that just happened ("Task deleted"): an
optional icon (or the busy blocks), the text (`toast` style), a hairline edge and a small shadow (it
floats above content). It drops in from below (fades only under reduce motion).
- Role `alert` with `accessibilityLiveRegion="polite"`: TalkBack reads it. iOS does not read live
  regions, so the screen also announces the text once with accessibility-as-code's `useAnnounce()`.
- The screen owns its timer (about 3 to 4 s) and where it sits (above the bottom inset).

**ToastStack** (`toast-stack.tsx`): toasts that are on screen together, newest last.

## EmptyState

**Template:** `empty-state.tsx`. What a screen shows when it has nothing yet: a decorative picture
(hidden; `.picture`), a title as a header (`.title`), a hint of what to do (`.body`), the one action
that fills the state. ui-states-and-feedback decides when a screen is empty, filtered-empty or
offline; this is the shape it uses.

## StatGrid and BarChart

**StatGrid** (`stat-grid.tsx`): summary numbers in two or three columns. Each cell is one accessible
element, so a screen reader hears "1,284, Tasks done" together; an empty cell keeps a short last
row's column widths. Values arrive formatted in the app's digits. **Ids:** `${testID}.<stat id>`
with `.value` and `.label`.

**BarChart** (`bar-chart.tsx`): simple vertical bars. A chart stands in for text, so each column
is one labelled image (`accessibilityRole="image"`, a translated sentence: "Monday: 12 tasks
done"), never "12, Mon" in pieces. **Ids:** `${testID}.<key>` (a date key, a weekday id: data, never
a position) with `.bar`, `.value`, `.label`. A richer chart is a Skia canvas exposed as one image
(skia-canvas-rendering).

## PagerDots, BusyIndicator, CheckMark, Chevron, Confetti

**PagerDots** (`pager-dots.tsx`): where the reader is in a short sequence. The current dot is wider
as well as filled (shape, not colour alone). Decorative: the screen writes the step in words
("Step 2 of 4"), which screen readers hear. Dots are keyed by page key, never by index.

**BusyIndicator** (`busy-indicator.tsx`): three blocks in a wave. Standing alone it is a labelled,
busy image ("Loading"); inside a busy button or toast it hides (the control says it is busy).
Still under reduce motion (a loop is motion).

**CheckMark** (`check-mark.tsx`) and **Chevron** (`chevron.tsx`): drawn glyphs, so the library
needs no icon set for its own state marks. A check never mirrors (its frame lays out left to
right); a chevron points where reading goes on and turns with the layout direction. Both hide
themselves and are marked `mayRotate` (a drawn glyph is a turned box).

**Confetti** (`confetti.tsx`): a short, bounded celebration (all tasks done): five pieces fall into
place once. Under reduce motion it renders nothing. The pieces are placed with `start` offsets, so
the band sets `direction: 'ltr'` (`scatter-ltr`): otherwise the scatter mirrors in right-to-left
languages. Use it for a screen-level moment only: a burst from the point of action (the checkbox
just ticked) is motion-and-animation's `CelebrationBurst`, and one moment gets one celebration,
never both (component-catalogue.md, "Owned by other skills"). motion-and-animation keeps the app's
moments bounded.
