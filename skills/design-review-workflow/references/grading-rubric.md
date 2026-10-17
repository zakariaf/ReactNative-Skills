# Looking and grading

How to read the captures, the five lenses a finding comes from, the accessibility floor that is
always a BLOCKER, the three grades, and the finding format `check-review.mjs` reads.

## Contents

- What this review judges, and what it does not
- How to look at the captures
- The five lenses
- The accessibility floor
- Grades
- The finding format
- Examples
- Turning a finding into a test

## What this review judges, and what it does not

The gates already proved, before the review started, everything a machine can see: types, lint,
tests, the screen contract's testIDs and states (screen-contracts), labels, roles and 44 pt boxes in
component tests and contrast pairs in `contracts/contrast.json` (accessibility-as-code), catalog parity
(i18n-strings-and-catalogs), logical styles (rtl-and-direction), goldens (golden-and-snapshot-tests),
design-baseline parity of changed screens (design-visual-parity). Never re-litigate them here: a
review that re-runs CI wastes the one look nobody else gives the app. This review judges what only
eyes, ears and hands catch: composition, rhythm, clipping in real fonts at real sizes, mirroring,
dark-mode feel, motion, and behaviour on a real phone.

## How to look at the captures

1. Read every cell, screen by screen (the names sort that way). An agent reads each PNG with its
   image-reading tool; a person opens the folder as a contact sheet. Never sign off from a sample.
2. Per screen, compare across one axis at a time: light against dark (same layout, designed dark
   colours, no lost edges or shadows), ltr against rtl (mirrored chrome, back arrows and progress
   flipped, numbers and Latin runs still readable), default against largest on the smallest phone
   (nothing clipped, truncated or overlapping; rows stacked; scrolling still reaches everything),
   phone against tablet (no stretched rows, no lost content, readable line length).
3. Then the worst cell of each screen: dark, right to left, largest text, smallest phone. It is where
   most findings are.
4. Watch every motion video at full and reduced motion.
5. Write each finding when you see it, with the exact cell names; grade it before moving on.

## The five lenses

| Lens | Question | Typical finding |
|---|---|---|
| `floor` | Does it meet the accessibility floor below? | text clipped at the largest size; a state shown by colour only |
| `identity` | Does it deliver the app's declared design system (its tokens, type, components), not a generic default? | a raw grey instead of the surface token; a system font where the type scale says otherwise |
| `parity` | Where an approved design baseline exists, is the built screen at least as good as it? | the empty state lost its illustration; spacing looser than the baseline |
| `motion` | Does every declared moment land, resolve to its end state when tapped mid-way, and have its reduced alternative? | a celebration that keeps going under reduce motion; a transition that blocks a tap |
| `behaviour` | Does it behave on a real phone in real state? | the silent switch ignored; data lost on upgrade; a crash log with user text |

Changing the design system itself is not a finding of this review: judge delivery of the declared
identity, and raise a wish to change it with whoever keeps the design system (design-system-structure).

## The accessibility floor

A finding of any of these kinds has `"lens": "floor"`, a `"floor"` kind, and is always a BLOCKER,
however good the screen looks (`review-floor`). The numbers are accessibility-as-code's, which owns
them:

| `floor` | The floor |
|---|---|
| `contrast` | text 4.5:1, large text, icons, edges and focus 3:1, in both themes (WCAG 2.2 AA) |
| `touch-target` | every target's own box at least 44 x 44 pt on iOS, 48 x 48 dp on Android |
| `text-scale` | text grows to 200 % without clipping, truncation or overlap; never clamped below that |
| `colour-alone` | every state also has an icon, shape or word; check by desaturating the capture |
| `direction` | right to left is mirrored where it should be and not where it should not (media controls, charts' time axis, phone numbers) |
| `reduce-motion` | with reduce motion on, every moment shows its reduced alternative; nothing loops or shakes |
| `screen-reader` | VoiceOver and TalkBack reach and name everything, in visual order, and stay inside dialogs |
| `assistive-access` | Switch Control, Switch Access and a keyboard reach and leave every control and mode |

A failed `screen-reader`, `switch-access`, `largest-text`, `reduce-motion` or destructive data step of
the on-device pass is a BLOCKER too, whatever lens its finding names.

## Grades

| Grade | Meaning | What happens |
|---|---|---|
| BLOCKER | an accessibility-floor miss or a shipping-stopper (data loss, a crash, a screen that cannot be used) | fixed in the fix round, verified on its new shot; if it survives, no sign-off and an escalation |
| FIX | clearly below the bar and cheap to fix now | fixed in the fix round, verified on its new shot |
| NOTE | minor, subjective or deferrable | moved to the backlog (`"status": "deferred"`, `"backlog": "#123"`); ships |

A BLOCKER or FIX is never deferred (`review-findings`). Findings opened while verifying the fix round
are NOTEs: verification opens no new critique (`review-fix-round`). When something serious is found
during verification, do not sign off; escalate it and run a new review after it is fixed.

Consolidate before fixing: one finding per cause, with every cell it shows on. Ten cells clipped by the
same row are one finding with ten cell names, not ten findings.

## The finding format

Findings live in the record under `"findings"`, keyed `F1`, `F2`, ... in the order they were found:

```json
"F3": {
  "grade": "BLOCKER",
  "lens": "floor",
  "floor": "text-scale",
  "what": "The due date under each task is cut after one line at the largest size on the smallest phone; it should wrap.",
  "cells": ["tasks.default--light--en--largest--ios-phone-small", "tasks.default--dark--ar--largest--android-phone-small"],
  "status": "open",
  "openedIn": "sweep"
}
```

| Key | Required | Values |
|---|---|---|
| `grade` | yes | `BLOCKER`, `FIX`, `NOTE` |
| `lens` | yes | `floor`, `identity`, `parity`, `motion`, `behaviour` |
| `floor` | with lens `floor` | a kind of the table above |
| `what` | yes | what is wrong, where, and what was expected (a sentence) |
| `cells`, `videos`, `step`, `screen` | at least one | exact cell or video names; `"<hardware>/<step>"`; a screen id |
| `status` | yes | `open`, `fixed`, `deferred` (NOTE only, with `backlog`), `escalated` |
| `openedIn` | yes | `sweep`, `device-pass`, `verify` |
| `seen` | written by `new-review.mjs --refresh` | the hash of each named cell and video when the finding was recorded |
| `backlog` | with `deferred` | the backlog item the NOTE moved to |
| `fix` | optional | what was changed, in one line |

## Examples

- BLOCKER (floor, contrast): "The placeholder text of the new-task field is #9AA0A6 on #FFFFFF, 2.6:1,
  in light mode on every device." The contrast table missed a pair; the fix adds the pair and a token.
- BLOCKER (behaviour): "After upgrading from 1.2.0, the lists screen is empty; the tasks come back
  after a relaunch." Data safety is never a NOTE.
- FIX (identity): "The summary line sits 4 pt closer to the list than every other screen."
- FIX (motion): "The task-completed celebration plays again when the screen is re-entered."
- NOTE (parity): "The empty-list picture reads colder in dark mode than the design baseline."

## Turning a finding into a test

Every BLOCKER and FIX that a machine could catch next time gets a failing test first (tdd-workflow):
a clipped row becomes a component test at `fontScale` 2, a missing label an RNTL role query, a lost
contrast pair an entry in `contracts/contrast.json`, a stuck loop a motion test. Then the fix, then the
re-shot cell. A finding no machine can catch (a feel, a rhythm) stays a review finding.
