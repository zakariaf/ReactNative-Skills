# testIDs and accessibility

How every component names itself for E2E flows (Maestro), tests and screen readers, on iOS and
Android. naming-conventions owns the testID grammar and accessibility-as-code owns the accessibility
rules and their app-wide checks; this file says how the library applies them, component by
component.

## Contents

1. [A required testID, parts derived from it](#a-required-testid-parts-derived-from-it)
2. [The testID goes on the measured box](#the-testid-goes-on-the-measured-box)
3. [What E2E tools see on iOS and Android](#what-e2e-tools-see-on-ios-and-android)
4. [Decorative parts hide themselves](#decorative-parts-hide-themselves)
5. [Roles by component](#roles-by-component)
6. [Checklist per pressable](#checklist-per-pressable)

## A required testID, parts derived from it

- The grammar is `<scope>.<element>[.<part-or-key>...]`, kebab segments, at least two
  (naming-conventions): `tasks.add-button`, `settings.daily-reminder-switch`,
  `tasks.task-row.<task id>`. Interactive elements end in their role (`-button`, `-switch`,
  `-slider`, `-row`, `-card`, `-tile`, `-checkbox`).
- **Every component a test or a flow addresses takes a required `testID`** (`testid-required`);
  decorative parts (Toggle, RadioMark, IconTile, CheckMark, Chevron, BusyIndicator) take an optional
  one, because their owner passes `<owner>.<part>`.
- **A component derives its parts by appending a segment** (`part-not-derived`):
  `` testID={`${testID}.label`} ``. The screen passes one base id and never builds a part id by hand;
  the catalogue lists each component's parts, so a renamed part fails the check instead of a flow.
- **Repeated items take a data key, never a position:** segments `${testID}.<value>`, stat cells
  `${testID}.<stat id>`, chart columns `${testID}.<date key>`, pager dots `${testID}.<page key>`.
  naming-conventions' `testid-index` fails an index in a testID.
- A dialog card's testID is its own (`delete-task-dialog.card`); the scrim is
  `delete-task-dialog.scrim`, the button row `delete-task-dialog.buttons`.

| Component | Parts (appended to its testID) | Example |
|---|---|---|
| Button | `.label` | `tasks.add-button.label` |
| TextButton | `.label` `.underline` | `reminder.later-button.underline` |
| HoldButton | `.fill` | `erase-dialog.confirm-button.fill` |
| TileButton | `.label` | `home.new-list-button.label` |
| ToggleTile | `.label` `.state` `.check` (on only) | `quick.sounds-switch.check` |
| NavCard | `.icon` `.label` `.description` | `home.archive-card.description` |
| Checkbox | `.check` | `tasks.task-row.t1.complete-checkbox.check` |
| SegmentedControl | segments `.<value>` with `.label`, the chosen one with `.check` | `settings.theme-control.dark.check` |
| Toggle (optional id) | `.check` when on | `settings.daily-reminder-switch.toggle.check` |
| RadioMark (optional id) | `.dot` when chosen | `sort.by-date-row.radio.dot` |
| Slider, ProgressBar | `.fill` | `settings.volume-slider.fill` |
| OptionCard | `.label` `.description` `.radio` | `sort.by-date-option.radio` |
| ListGroup | `.header` `.list` | `settings.reminders.list` |
| ListRow | `.icon` `.label` `.description` `.value` `.toggle` `.radio` | `settings.daily-reminder-switch.toggle` |
| SubRow | `.label` | `settings.reminder-volume-row.label` |
| CardHeader | `.title` | `stats.week-card.header.title` |
| Callout | `.icon` `.label` | `task-edit.error-note.label` |
| AppBar | `.back-button` `.title` | `settings.app-bar.back-button` |
| DialogCard | `.title` `.body` | `delete-task-dialog.card.title` |
| EmptyState | `.picture` `.title` `.body` | `tasks.empty-state.body` |
| StatGrid | cells `.<id>` with `.value` `.label` | `stats.overview.done.value` |
| BarChart | columns `.<key>` with `.bar` `.value` `.label` | `stats.week-chart.mon.bar` |
| PagerDots | dots `.<page key>` | `onboarding.pager-dots.lists` |
| Chevron | `.mark` | `settings.language-row.chevron.mark` |

## The testID goes on the measured box

When the design measures a whole box (a section header, a chip, a badge), the component puts its
testID on that View, together with `accessible`, a role (`header`, `text`) and the text as its
`accessibilityLabel`; the AppText inside has none. With the id on the inner text, an E2E tool
reports only the words' bounds: the header went missing from a screen's element list and a badge
measured as wide as its text. `testid-on-inner-text` fails a component's own testID on an AppText
that is the only labelled child of a View that draws the box (padding, an edge or a fill). Part ids
(`.label`, `.value`) stay on their text, and so does text inside a plain layout View.

## What E2E tools see on iOS and Android

- Maestro's `id:` matches `testID` on both platforms, so one flow drives the iOS simulator and the
  Android emulator (naming-conventions, e2e-maestro).
- On iOS the hierarchy Maestro reads is the accessibility tree: an accessible element (a button, a
  switch row) is one node, and its children's testIDs do not appear. A part inside an accessible
  element (a row's `.label`) is found by RNTL tests, not by an iOS flow; a flow taps the row's own
  id. Observed on the iOS simulator; on Android Maestro reads the view hierarchy, where resource ids
  of children usually stay visible (not verified for every component here).
- A modal flag on a child hides its ancestors' identifiers from that tree: the scrim is the modal
  root, never the card (`modal-root`).
- Hidden parts (`accessibilityElementsHidden` on iOS, `importantForAccessibility="no-hide-descendants"`
  on Android) are absent from both trees; tests reach them with `{ includeHiddenElements: true }`.

## Decorative parts hide themselves

A part that only decorates (an icon tile, a radio ring, a toggle graphic, the check and chevron
marks, pager dots, the confetti, a busy indicator inside a busy control) sets both
`accessibilityElementsHidden` (iOS) and `importantForAccessibility="no-hide-descendants"`
(Android) on its root (`decorative-not-hidden`). The control around it carries the name and the
state, so VoiceOver and TalkBack read one element ("Daily reminder, switch, on") instead of a list
of pieces. Never un-hide a decorative part to make it measurable: give the measured element the id.

## Roles by component

| Role | Components |
|---|---|
| button | Button, TextButton, IconButton, HoldButton (+ the activate action), TileButton, NavCard, ActionCard's opener, ListRow `navigate` |
| switch | ToggleTile, ListRow `switch` |
| checkbox | Checkbox |
| radio (in a radiogroup) | SegmentedControl's segments, OptionCard, ListRow `radio` |
| adjustable | Slider (increment and decrement actions) |
| progressbar | ProgressBar |
| header | SectionHeader, the titles of CardHeader, AppBar, DialogCard, EmptyState |
| alert | Toast (polite live region; the screen also announces it) |
| image | BarChart columns, a labelled BusyIndicator |
| text | Badge, Chip |
| none | List, ListGroup, SubRow, Card, Callout, DialogButtonRow, ToastStack, StatGrid (cells are grouped), a static ListRow |
| hidden | Toggle, RadioMark, IconTile, CheckMark, Chevron, PagerDots, Confetti |

Overlays: the Scrim renders in React Native's Modal and carries `accessibilityViewIsModal`, so
both screen readers stay inside the dialog (accessibility-as-code's overlay rules).

## Checklist per pressable

| Prop | Value |
|---|---|
| role | `button`, `switch`, `checkbox`, `radio` or `adjustable`, set by the component (PressableSurface's `accessibilityRole`) |
| name | the translated visible label, the required `label` of an icon-only control, or a translated `a11yLabel` sentence built by the screen model |
| hint | only when the result is not obvious from the name, translated |
| state | `disabled`, `busy`, `checked`, `selected` through PressableSurface (React Native's Pressable derives `disabled`) |
| size | its own box at least `MIN_TOUCH`, never `hitSlop` (accessibility-as-code) |
| testID | `<scope>.<element>`, parts derived |
| feedback | the press surface's look and the injected feedback; a switch plays its own |

Every component test that renders a pressable ends with
`expect(findInaccessiblePressables(screen.container)).toStrictEqual([])`.
