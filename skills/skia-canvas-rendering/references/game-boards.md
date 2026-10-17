# Appendix: game boards (the games plugin)

A game board is a canvas surface like any other; this appendix covers what games add. Read it when the
surface is a board in `src/games/<game-id>/` (the games plugin's layout), and load `game-rules-engine`
for the rules side and `game-session-host` for the session controller (moves, undo, hints) that feeds
the surface its committed changes.

## Contents

- Where a board lives
- Kinds of boards
- The progress-grid template as Lights Out
- Selection, hints and drag
- Drawing needs that recur
- Why no game engine

## Where a board lives

```
src/games/<game-id>/rules/      pure rules: state, moves, past-tense events (game-rules-engine)
src/games/<game-id>/canvas/     the surface: palettes, contrast pairs, to-view, build-timeline, layout, draw, <game-id>-surface.ts
src/games/<game-id>/sim/        a real-time loop, when the board is live (realtime-game-loop)
test/goldens/canvas/<game-id>.golden.test.ts
```

The checkers find `src/games/*/canvas` folders by default, and treat one with a `sim/` sibling as a
live surface; the `npm test` worklet gate (`scripts/quality/check-worklet-boundary.ts`) requires the
`'worklet'` directive in their `draw*` and `layout*` files as it does for feature surfaces. The board
imports the kit from `@/canvas/...`, which `architecture-and-boundaries` lets every game import by
default (`{srcDir}/canvas/**` is in its `gameFacing` defaults); only an app that moved the kit
elsewhere adds that folder to `gameFacing` in `contracts/architecture.json`. The kit's own imports
(`@/hooks/use-is-app-active`) are not the game's, so the board needs no seam for them. A committed
move is a committed change: the session store applies and saves the move, then `presentChange` plays
its events (persist before animating: killing the app mid-animation loses nothing). `seq` is the
move counter.

## Kinds of boards

| Kind | What moves on screen |
|---|---|
| Turn-based | `applyMove` returns events; `buildTimeline` turns them into tracks; the scene clock plays them |
| Simulate-then-replay | the continuous phase runs inside `applyMove` with a fixed step and returns timed events; tracks replay them (`realtime-game-loop`) |
| Real-time | a fixed-step loop on the UI thread; the picture reads the simulation directly; its draw test and goldens (moments of a scripted run) come with `realtime-game-loop` |

## The progress-grid template as Lights Out

Lights Out (`lights-out`, public domain): tapping a cell toggles it and its four neighbours; the board
is won when every cell is dark. The template maps one to one:

- `cells-toggled` with `cells: [tapped, up, left, right, down]`: the tapped cell turns first, the
  neighbours `FOLLOW_DELAY_MS` later, and the first track carries the sound and the haptic.
- `goal-reached` becomes `board-cleared`: the glow and the burst, with the final view all dark (flip
  the meaning of `1` in `to-view.ts`).
- `streak-extended` becomes a moves-left or bonus label.
- `targetsOf(state, move)` rings the cell a hint (a bot's best move) would tap.
- Fill the placeholders with `__FEATURE__` → the game's folder and `__SURFACE__` → `lights-out`, and
  place the files under `src/games/lights-out/canvas/` (pass the contract's `dir` or keep the default
  globs).

## Selection, hints and drag

- **Selection** (tap-then-tap: pick a piece, then a target) is host state passed as
  `highlight.selected`; bots, par, undo and the move counter never see it.
- **Hints** come from the session host (`game-session-host`: `controller.hintedMove()`, which asks
  the engine's bot), turned into targets by `surface.targetsOf(state, move)` and passed as
  `highlight.hinted`.
- **Drag** (`canvas-gestures-and-hit-testing`): the gesture layer lifts the pointer by the surface's
  `dragLiftPt`, so the hover target, the preview and the drop cell are one cell; draw puts the ghost
  exactly on `frame.fx.pointer.hover`. A board with a lift keeps at least `dragLiftPt` of canvas below
  its last row (a tray beside the board in a wide layout keeps a free strip), and its hit-target test
  proves every edge row is reachable.

## Drawing needs that recur

| Need | How |
|---|---|
| Several moves of one piece in one turn | several sequential `pos` tracks on one entity (the sampler follows the latest started) |
| Pieces that vanish (captured, cleared) | a `vanish` track carrying `[col, row, kind, alpha]`: they are no longer in the view |
| Numbers in small pieces | `drawFittedText` with the localised digits from `toView` |
| Card faces, dice pips | unit paths built once in `buildPaths`, plus digits or letters |
| Wrap-around moves | draw the wrapped copy at both ends while the tween runs |
| Letters that must read in RTL | `isMirroredInRtl: true` and one cached Paragraph per letter or word |
| Shake, particles | tracks, dropped under reduced motion |
| Hundreds of identical sprites | one atlas call (see drawing.md, "Many sprites") |

## Why no game engine

Unity, Godot or Phaser each bring a second language or runtime, an editor that needs a person at the
mouse, a large binary, and none of them can be tested headlessly. Small 2D boards are drawn with the
libraries the app already has: Skia for the picture, Reanimated for the frame clock, Gesture Handler
for touch, and pure TypeScript for the rules, all of it provable in Jest.
