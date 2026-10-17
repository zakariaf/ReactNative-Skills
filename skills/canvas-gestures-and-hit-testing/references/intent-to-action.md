# The intent function: from intent to an allowed action

`intentToAction(state, intent) → Action | null` is the one place where a surface decides what a touch
means. `toView` turns state into what the canvas draws; the intent function turns what the finger did
back into a domain action, or nothing. Read this before writing a surface's
`src/features/<feature>/canvas/intent-to-action.ts` (or a game's `src/games/<game-id>/canvas/intent-to-move.ts`).

## Contents

- Rules for the intent function
- The legality source: a list or a validator
- Pattern: tap to act
- Pattern: drag to place, with a lift
- Pattern: tap-then-tap (select, then target)
- Pattern: swipe to move
- Pattern: aim and release
- Pattern: long press, with an alternative
- Wiring the screen
- Games
- Tests

## Rules for the intent function

- **Pure and deterministic.** It lives in the surface folder beside `to-view.ts` and imports only types,
  the domain's pure modules and pure `'worklet'` kit modules: no React, React Native, Expo, Skia, store,
  service, API, route or UI value, no clock, no random source (`intent-pure`). It receives the state it
  needs; it never reads a store.
- **Legality comes from the domain's one source of truth, nothing else.** Build the candidate action
  from the intent, then return it only if the domain accepts it. The same source answers for hints,
  bots, undo and tests, so a gesture can never do what the rest of the app forbids.
- **Exhaustive over intent kinds.** `switch (intent.kind)` with every kind listed (`tap`, `long-press`,
  `swipe`, `drag-end`, `aim`); the kinds the surface ignores return `null` explicitly
  (`intent-exhaustive`). With `@typescript-eslint/switch-exhaustiveness-check` a new kind then fails lint.
- **Check the region and the bounds** before building an action from a target: `target.regionId ===
  'grid'` and `col`/`row` inside the grid. Hit-testing clamps, but intents also come from tests and from
  layouts with several regions.
- **Never add a finger offset.** The drag lift is applied once, in the gesture layer; `intent.to` already
  is the lifted cell, the cell the preview was drawn on.
- **Never return a selection action.** A tap-then-tap selection is UI state the model hook keeps; it
  arrives as `intent.selected`.
- **Quantise continuous values before they enter state:** an aim vector becomes integers (thousandths
  of a unit vector) with `Math.sqrt`, `Math.round`, `+ - * /` only, so saves are compact and replays exact.
- **Actions are data:** a kebab-case imperative `kind` (`'toggle-day'`, `'schedule-task'`,
  `'slide-tile'`), JSON-serialisable, applied by the store like any other action (saved first, then
  animated).

## The legality source: a list or a validator

| Form | When | Shape |
|---|---|---|
| `listActions(state)` | the set of allowed actions is small and enumerable (a grid of days, a board's moves); hints and bots need the list anyway | `return listActions(state).some((listed) => isSame(listed, action)) ? action : null;` |
| `validate(state, action)` | the space is large or continuous (any time slot, any amount) | `return validate(state, action).ok ? action : null;` (a `Result` from error-handling-typed-results) |

Both are the domain's, both are pure, and both make "finished or locked" free: an empty list or a
refusing validator gives `null` without a separate status check.

## Pattern: tap to act

`examples/progress-grid/intent-to-action.ts`: a tap on a day of the Tasks progress grid toggles it,
unless the week is closed. Legality is `listDayActions(state)` in `src/features/tasks/progress-grid-rules.ts`.

```ts
function candidate(state: ProgressGridState, intent: CanvasIntent): ProgressGridAction | null {
  switch (intent.kind) {
    case 'tap':
      return isOnGrid(state, intent.target)
        ? { kind: 'toggle-day', cell: intent.target.row * state.cols + intent.target.col }
        : null;
    case 'long-press':
    case 'swipe':
    case 'drag-end':
    case 'aim':
      return null;
  }
}
```

`target.col` is the logical column: a mirrored surface's `hitTest` already turned the drawn column back
into the logical one. The same shape fits Lights Out (tap toggles a light and its neighbours).

## Pattern: drag to place, with a lift

`examples/inbox-planner/`: drag a task from the inbox tray onto a day of the month to schedule it,
`{ kind: 'schedule-task', taskId, day }`; the surface uses `panMode: 'drag'` and declares
`dragLiftPt` (its layout exports `DRAG_LIFT_PT = 40`).

- The gesture layer reports `{ kind: 'drag-end', from, to }`: `from` is where the finger went down
  (never lifted), `to` is the hit of the lifted release point. The preview is drawn from the same lifted
  pointer, so the preview cell is the drop cell. The intent function uses `intent.to` as it is.
- The layout keeps at least `DRAG_LIFT_PT` of canvas below the last week (the inbox lies there in
  portrait; a free strip when the inbox stands beside the month), and `hit-targets.test.ts` proves every
  edge week reachable in portrait and on wide canvases.
- The tray lies in one row in portrait and in one column when wide, so the slot is `target.col + target.row`.

## Pattern: tap-then-tap (select, then target)

The planner's second way in, and the only way for anyone who cannot drag: tap a task, then tap a day.

- The intent module exports the regions whose taps select instead of act:
  `export const SELECT_REGIONS: readonly string[] = ['inbox']` (most surfaces: `[]`).
- The gesture layer always sends `{ kind: 'tap', target, selected: null }`. The model hook fills
  `selected` in: a tap inside a select region toggles the selection (the same target again clears it)
  and is announced with `useAnnounce()`; any other tap goes to the intent function as
  `{ ...intent, selected }`. A non-null action is dispatched and clears the selection; a drag-end, a miss
  (`onMiss`), undo, a reset and leaving the screen clear it too.
- The intent function returns `null` for a tap inside a select region (it only selects) and builds the
  action from `intent.selected` plus `intent.target` for the second tap:

```ts
case 'tap':
  return scheduleOf(state, intent.selected, intent.target);   // null without a selection
case 'drag-end':
  return scheduleOf(state, intent.from, intent.to);           // the one-gesture shortcut
```

- The canvas draws the selection from `frame.highlight.selected` and a suggested action from
  `frame.highlight.hinted` (`surface.targetsOf(state, action)`).
- The test proves both sides: taps inside `SELECT_REGIONS` give `null`, and a tap with a selection gives
  exactly what the drag gives (a fast-check property in the example).

## Pattern: swipe to move

`examples/sliding-puzzle/`: the swipe's physical direction is the move (swipe left: the tile to the
gap's right slides left); the start cell does not matter. Return `null` when nothing would move, so a
wasted swipe costs nothing. A tap on a tile beside the gap does the same, which keeps the surface
usable without swiping.

## Pattern: aim and release

`examples/arena-aim/`: pull back and release; the launch goes opposite to the pull. Ignore short pulls
(a dead zone of about 20 pt), normalise with `Math.sqrt` (exactly specified by IEEE 754, unlike `sin`,
`cos` and `atan2`, whose results differ between JavaScript engines), and quantise to integers.

## Pattern: long press, with an alternative

`long-press` → a second action on the same target (`{ kind: 'flag-cell' }`, `{ kind: 'open-details' }`),
`tap` → the first. Offer the long-press action without a hold too: a mode toggle on the screen that turns
taps into that action, or an `accessibilityActions` entry on the canvas.

## Wiring the screen

`examples/progress-grid/use-progress-grid-input.ts` is the whole wiring, called by the feature's model
hook with the player's layout, the state and the store's dispatch:

```ts
const input = useCanvasGestures(args.layout, {
  panMode: 'none',
  dragLiftPt: args.dragLiftPt,          // progressGridSurface.dragLiftPt ?? 0
  onIntent: handleIntent,               // selection, intentToAction, dispatch
  onMiss: () => { setSelected(null); },
});
return { input, highlight: { selected, hinted: [] } };
```

The screen renders `<SurfaceCanvas ... input={model.grid.input} highlight={model.grid.highlight} />`.
React Compiler memoises the handlers; never wrap them in `useCallback` by hand. The canvas screen's
stack options turn off iOS's full-screen back swipe when the surface reads horizontal pans
(input-pipeline.md, "System back gestures").

## Games

A game surface lives in `src/games/<game-id>/canvas/`; its intent function is `intent-to-move.ts`,
exporting `intentToMove(state, intent)`, beside `to-view.ts`. It does not live in `rules/`: the
canonical lint lets game rules import only `src/core` and the game's own `rules`, `levels` and `geom`,
so `rules/` cannot see `CanvasIntent`. The intent function imports the rules' types and `listMoves`
through `@/games/<game-id>/rules/...` and is just as pure. A game reaches app code only through its
seam (architecture-and-boundaries' `game-facing` rule), and the canvas kit (`src/canvas/**`) is in
that seam by default, so a game surface imports the kit's layout and types with no
`contracts/architecture.json` entry (only an app that moved the kit adds its folder to `gameFacing`).
Legality is "`listMoves(state)` lists it";
`listMoves` is empty once the game is won or lost. game-rules-engine owns the rules contract: its
`GameInput<TState, TMove, TIntent extends { kind: string }>` (`src/core/game/game-input.ts`) accepts
`CanvasIntent` as `TIntent`, and the game's module file `src/games/<game-id>/<game-id>-game.ts` holds
`panMode` and `selectRegions` as literals (checked by game-rules-engine's `pan-mode` and
`select-regions` rules). realtime-game-loop owns live games, whose input is the stick
(`stick-input.md`).

## Tests

Each `intent-to-action.test.ts` (or `intent-to-move.test.ts`) covers:

- each intent kind the surface uses maps to the right action;
- illegal targets give `null`: a cell off the grid, another region, a drop off every region, a past or
  full day;
- a finished or locked state gives `null` (an empty list);
- ignored kinds give `null`;
- a fast-check property with a fixed seed: every non-null result is one the domain lists (or validates).

Surfaces with select regions add: a tap in a select region gives `null`, a target tap without a
selection gives `null`, and a tap with a selection gives exactly what the drag gives.
