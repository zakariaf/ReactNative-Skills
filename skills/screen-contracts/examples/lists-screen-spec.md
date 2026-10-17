# Lists: screen spec

The written half of a screen's contract, kept next to the design (for example `design/screens/lists.md`):
what the product requires, the blocks in order with their spacing tokens, every state, what the
model supplies, and the pitfalls found while building it. The machine half is the screen's entry in
`contracts/screens.json`; the two name the same ids and keys. This is a shape to imitate for each
screen, not a file to copy.

## What the product requires

- Every list the person made, in name order, each with a way to delete it (confirmed first).
- Usable offline; a read failure never leaves a blank page.

## Layout, top to bottom

Stack header "Lists" (`lists.title`, set by the route from the model). Body: a `FlatList`, padding
`SPACING.lg` inline and top, rows `SPACING.sm` apart, bottom padding `usePageBottomPadding(true)`:

1. One row per list (`lists.list-row.{listId}`): surface fill, radius `RADII.md`, the list's name
   (body text, grows and wraps) at the start, the Delete button (danger text on `dangerSurface`,
   `RADII.sm`) at the end. The row itself is not pressable.

Wide windows: the column is centred at `CONTENT_MAX_WIDTH`.

## States and variants

| State | Drawn | What shows |
|---|---|---|
| `default` | yes (`lists-default.png`) | the list above |
| `empty` | no (Chosen: a first launch has no lists) | `ScreenBody` with the title "No lists yet" (a header) and one line |
| `error` | no (Chosen: the lists could not be read) | `ScreenBody` with the message, a growing spacer, Try again at the bottom |
| dialog | its own screen, `delete-list-dialog` | over the default state while a delete is pending |

## Data the model supplies

`ListsModel` (`use-lists-model.ts`): `title`, `state` (`listsStateOf(tasks.lists())`), the empty and
error copy, `deleteText`, `deleteLabelOf(name)` ("Delete Groceries", the button's accessible name),
`deleteDialog` (translated copy or `null`), `onRetry`, `onAskDelete(id)`, `onConfirmDelete`,
`onCancelDelete`, `isReducedMotion`.

## testIDs and copy keys

`node ${CLAUDE_SKILL_DIR}/scripts/list-screen.mjs . --screen lists` prints them with their text; the
contract entry is the source. Keys: `lists.title`, `lists.empty.title`, `lists.empty.body`,
`lists.error.body`, `lists.retry-button.label`, `lists.list-row.delete-button.text`,
`lists.list-row.delete-button.label`.

## Reference images

`design/screens/lists-default.png` (light, English, 1 pt = 1 px). Compare light, dark and Arabic on an
iOS simulator and an Android emulator.

## Pitfalls

- An accessible row (`accessible` on the row View) hid the Delete button from VoiceOver and from the
  E2E tree on iOS: the row stays a plain View, the name and the button are siblings.
- The FlatList ended one inset above the screen edge until its content padded the bottom inset.
- `t('lists.delete-dialog.title', { listName })` returns the name isolated (FSI … PDI): tests compare
  with `isolate('Groceries')`.
