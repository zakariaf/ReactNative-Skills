# Canvas architecture: layers, files and the CanvasSurface contract

How a hand-drawn Skia surface (a progress grid, a chart, an editor, a game board) is built, which
file does what, and what each surface must provide. Read this first, before writing any canvas code.

## Contents

- When to draw with Skia at all
- Layers and data flow
- Where the code lives
- The kit's public API (what touch input and other skills build on)
- The CanvasSurface contract
- Three kinds of surfaces
- Prerequisites and their owners
- The contract file and rn-skills.config.json keys
- When multi-package

## When to draw with Skia at all

Draw with Skia when the picture is computed: cells, bars, paths, particles, anything whose geometry
comes from data and changes with it. Use ordinary views for text-heavy UI, forms and lists (they get
layout, accessibility and dynamic type for free). A chart library built on Skia (victory-native) is
fine for standard charts; this skill is for pictures you draw yourself.

| Job | Library (Expo SDK 57, verified on 2026-10-03) | Why |
|---|---|---|
| Drawing | `@shopify/react-native-skia` 2.6.2 | GPU 2D; the same draw code renders PNGs in Jest and Node without a phone |
| Timing (60/120 Hz) | `react-native-reanimated` 4.5.1 + `react-native-worklets` 0.10.1 | frame code runs on the UI thread, so a busy JS thread never stutters the picture |
| Touch | `react-native-gesture-handler` 2.32.0 | canvas-local coordinates (`canvas-gestures-and-hit-testing`) |

Install them only with `npx expo install <package>` so they stay on the SDK pins, and re-check with
`npx expo install --check`. Re-verify the pins with
`node -p "require('expo/bundledNativeModules.json')['@shopify/react-native-skia']"`. Skia 2.6.2 has
a postinstall script that copies the native libraries: approve it with
`npm approve-scripts @shopify/react-native-skia` before `npx expo prebuild` (EAS Build runs the
install itself). There is no game engine: a second runtime, an editor and a large binary buy nothing
for 2D pictures, and none of them can be tested headlessly.

## Layers and data flow

```
 JS thread (pure, testable)                                   UI thread (worklets, 60/120 Hz)
 ──────────────────────────────────────────────────────       ─────────────────────────────────────
 user action → store reducer: { state, events }; persist
   or server data (query cache) → useCommittedChange(data, diffEvents)
                   │ CommittedChange { seq, state, events }
 presentChange(): toView(state) + buildTimeline(events, motion)
                   │ clock.push(scene) ─────────────────────►  scene (one shared value)
                   │ cues.schedule(tracks) → audio / haptics    │ frame callback: runSceneFrame
                                                                │   stamps startAt, writes now
                                                                ▼
                               recordPicture(): sampleTimeline(tracks, now − startAt)
                                                → draw(canvas, { view, fx, highlight, colors, layout, kit })
                                                                │
                                                       <Canvas><Picture/></Canvas>
```

- **The view is always the final state.** Tracks describe how the picture gets there. Anything that
  disappears must be drawable from its tracks alone.
- **One scene per committed change.** `{ seq, view, tracks, endMs, startAt: NOT_STARTED }` travels
  as one shared value, so the UI thread can never pair a new view with old tracks.
- **Persist before animating.** The store applies and saves the change (or the query cache holds the
  server's data), then the surface presents it. Killing the app mid-animation loses nothing.
- **Only changes committed while the surface is mounted animate.** The change present at mount is
  shown as its final view, so reopening a screen replays nothing.
- **Every computed picture is a surface.** A canvas that renders a `<Picture>`, reads per-frame values
  (`useDerivedValue`, `useFrameCallback`, `useClock`, shared values) or calls the Skia draw API lives in
  the kit or in a surface folder (judged per `<Canvas>` element: its subtree and the same-file components
  it renders, never the rest of its file), so its draw code is a worklet, paints an opaque background, has a
  budget and goldens. `check-canvas-code.mjs` scans every app file that imports Skia and reports such a
  canvas anywhere else as `canvas-outside-surface`, and a surface object or draw file outside every
  surface folder (it imports the kit's `CanvasSurface` or `DrawFrame` type, or a `SurfaceHost` renders
  it as its `surface`) as `surface-outside-folder`. Same-file components are followed one level; for a
  child in another file the checker judges that file instead: Skia elements whose attributes read
  per-frame values in a file that renders no `<Canvas>` (an `<AnimatedBar>` that a chart's canvas maps
  over) are `canvas-outside-surface` too.
- **Static canvases may live anywhere.** A declarative canvas with fixed content (a gradient backdrop,
  a blur, a logo of shapes) has no `draw()`, no frame loop and nothing to animate, also when the same
  file animates an ordinary view (a button's press scale around its gradient); the API rules and
  `canvas-a11y` still apply (a decorative one says `accessible={false}`). Static art recorded once
  with `createPicture` is listed in the contract's `staticCanvases`; the listing never excuses
  per-frame values. The canvas size is layout, not motion: a backdrop sized by `<Canvas
  onSize={size}>`, with values derived from `size` alone (`useDerivedValue` with no animation, or a
  child taking it as `SharedValue<SkSize>`), is still static. `useCanvasSize()` (React state, measured
  once on mount) or a parent's `onLayout` work too.
- **An idle surface costs (almost) nothing.** The scene clock's frame callback runs only while a
  timeline plays, so the picture is not re-recorded; a picture that read a running clock (Skia's
  `useClock()`, `withRepeat(…, -1)`) would re-record every frame (`idle-clock`). One cost remains:
  Skia 2.6.2 implements `<Canvas onSize>` with its own Reanimated frame callback that measures the
  view every frame while the canvas is mounted (read in its `Canvas.tsx` on 2026-10-03); it records
  nothing.

## Where the code lives

```
src/canvas/                                   the kit, copied once (templates/src/canvas)
  canvas-layout.ts          'worklet'   Rect, Point, GridRegion, CanvasLayout, CanvasTarget, fitGrid, cellRect, hitTest
  canvas-types.ts                       PointerSample, CanvasHighlight, CanvasColors, DrawKit, DrawFrame, CanvasSurface ...
  timeline/track.ts         'worklet'   Track, EasingId, HapticCue, Motion, ease, timelineEndMs
  timeline/sample.ts        'worklet'   sampleTimeline, fxEntry, isPlaying
  timeline/particles.ts     'worklet'   BurstSpec, sampleParticle, burstHash
  draw-kit.ts                           PaletteSet, makeCanvasColors, makeDrawKit
  scene.ts                  'worklet'   Scene, makeScene, tickClock, sceneElapsedMs, isSceneAnimating
  scene-clock-state.ts      'worklet'   the clock's decisions (pushScene, stopClock, resumeClock, finishRun ...)
  run-scene-frame.ts        'worklet'   the whole frame-callback body (try/catch here)
  use-scene-clock.ts                    useSceneClock (device-only marker)
  record-picture.ts         'worklet'   recordPicture (one frame into a Picture)
  describe-error.ts         'worklet'   error → text on either thread
  draw-text.ts              'worklet'   textWidth, drawCenteredText, fittedScale, drawFittedText
  surface-canvas.tsx                    SurfaceCanvas: one Canvas + one Picture, accessible image
  present-change.ts                     presentChange, CommittedChange
  cue-scheduler.ts                      createCueScheduler (sounds on the audio clock, haptics on timers)
  use-canvas-lifecycle.ts               the one "may this surface run" decision
  use-surface-player.ts                 clock + presenter + cues + lifecycle + layout for one surface
  use-committed-change.ts               server data → CommittedChange (a seq per data identity, diffed events)
  surface-host.tsx                      SurfaceHost: the display-only composition
  canvas-layout-probe.tsx               optional end-to-end probe (<prefix>.canvas-layout / .canvas-frame)
  paint-surface-png.ts                  offscreen render for goldens and Node (device-only marker)
  + a test beside every module that has logic
src/features/<feature>/canvas/                one folder per surface (templates/src/features/__FEATURE__/canvas)
  canvas-palettes.json/.ts  canvas-contrast.json  canvas-model.ts  canvas-ids.ts  to-view.ts
  build-timeline.ts  layout-<id>.ts  draw-<id>.ts  <id>-surface.ts  + tests
  diff-events.ts            server-data surfaces only: past-tense events from two states (+ test)
src/hooks/use-is-app-active.ts                AppState → boolean (shared hook, react-components-and-hooks; see below)
test/goldens/skia-golden.ts                   the pixel matcher (canonical root file)
test/goldens/canvas/<id>.golden.test.ts       + __image_snapshots__/<id>-<size>-<moment>.png
scripts/quality/check-worklet-boundary.ts     + its test and worklet-transform.test.ts (run inside npm test)
contracts/canvas-surfaces.json                optional: the app's surfaces, kinds and palette sets
```

Imports: `@/canvas/...` from a surface, `./sibling` inside a folder, never `../` (the lint config
bans parent imports). Pure helpers that run on the UI thread live in `'worklet'` modules
(`canvas-ids.ts`), because a plain function called from `draw()` throws at runtime only.

## The kit's public API (what touch input and other skills build on)

`canvas-gestures-and-hit-testing` builds its gesture layer on these names, and
`realtime-game-loop` reuses the types and keeps its own golden painter for live surfaces
(`paintSimPng` in `src/canvas/realtime/`, a host inside this kit's folder that is never a surface). `canvas-layout.ts`, `canvas-types.ts`,
`timeline/track.ts` and `timeline/sample.ts` (with their tests) are canonical synced copies: they ship
byte-identical in every skill that needs them, and a change goes to the canonical copy, never to one
skill's copy. Renaming an export is a breaking change for all of them: keep the names, and add rather
than change.

`src/hooks/use-is-app-active.ts` (+ test) is not part of the kit: it is the app's one foreground hook,
owned by `react-components-and-hooks` (audio and motion read it too). This skill ships a synced copy in
`templates/src/hooks/` so the kit compiles on its own; an app that already has the file keeps it (the
copies are identical). `use-canvas-lifecycle.ts` imports `@/hooks/use-is-app-active`, never a copy
under `src/canvas/`; when the hook is missing, `check-canvas-files.mjs` reports `kit-import-unresolved`
and names `react-components-and-hooks`. A kit copied before this change still has
`src/canvas/use-is-app-active.ts`: delete it (and its test), and point the lifecycle import and the two
`jest.mock` calls in `use-canvas-lifecycle.test.ts` and `use-surface-player.test.ts` at
`@/hooks/use-is-app-active`.

| Module | Exports that other code relies on |
|---|---|
| `canvas-layout.ts` | `Rect`, `Point`, `GridRegion`, `CanvasLayout`, `CanvasTarget`, `FitInput`, `EMPTY_LAYOUT`, `fitGrid(input)`, `cellRect(layout, target)`, `hitTest(layout, point, slop?)`, `isSameTarget(a, b)` |
| `canvas-types.ts` | `PointerSample` + `IDLE_POINTER` (the gesture layer writes it, draw reads `frame.fx.pointer`), `CanvasHighlight` + `EMPTY_HIGHLIGHT`, `CanvasColors`, `DrawKit`, `DrawFrame`, `LayoutInput`, `ViewFormat`, `A11yMessage`, `SkiaApi`, `CanvasFx`, `CanvasSurface` (with `dragLiftPt` and `targetsOf`) |
| `surface-canvas.tsx` | `SurfaceCanvas` (`isOpaque`, default true), `CanvasInput` (`{ gesture, pointer }`: an interactive surface passes it) |
| `use-surface-player.ts` | `useSurfacePlayer(input)` → `{ clock, size, layout }`: an interactive screen builds its gestures from `layout` |
| `use-committed-change.ts` | `useCommittedChange(data, diffEvents)`, `nextChange`, `DiffEvents` (server data) |
| `timeline/*` | `Track`, `Motion`, `sampleTimeline`, `fxEntry`, `isPlaying`, `sampleParticle` |
| `paint-surface-png.ts` | `paintSurfacePng(skia, request)` |

`hitTest` mirrors exactly as `cellRect` does: a region is mirrored as a rectangle, a cell's edges are
half-open in both directions, a point truly inside a region beats one reached through the slop, and
otherwise the nearest region whose slop reaches the point wins. `canvas-layout.test.ts` proves
`hitTest ∘ cellRect = identity` at any size, mirrored or not.

## The CanvasSurface contract

```ts
export type CanvasSurface<TState, TView, TToken extends string, TAction = unknown> = {
  readonly isMirroredInRtl: boolean;                              // a time axis does; a photo does not
  readonly toView: (state: TState, format: ViewFormat) => TView;  // JS, pure; digits localised here
  readonly layout: (input: LayoutInput<TView>) => CanvasLayout;   // worklet; used by draw and hit-test
  readonly draw: (canvas: SkCanvas, frame: DrawFrame<TView, TToken>) => void; // worklet, pure
  readonly buildPaths: (skia: SkiaApi) => Readonly<Partial<Record<string, SkPath>>>; // JS, once per kit
  readonly describe: (view: TView) => A11yMessage;                // the screen-reader summary (catalog key)
  readonly dragLiftPt?: number;                                   // drag pointer lift, applied by the gesture layer
  targetsOf?(state: TState, action: TAction): readonly CanvasTarget[]; // rings a suggested action
};

export type DrawFrame<TView, TToken extends string> = {
  readonly view: TView;                 // the final state of the change
  readonly fx: CanvasFx;                // the timeline sample + the pointer sample
  readonly highlight: CanvasHighlight;  // the screen's selection and hints (EMPTY_HIGHLIGHT when none)
  readonly colors: CanvasColors<TToken>;
  readonly layout: CanvasLayout;
  readonly kit: DrawKit;                // fill/stroke paints, number font, unit paths, paragraph labels
};
```

The screen (its `use-<feature>-model.ts`, per the feature layout) owns the selection and hint state
and passes it as `highlight`; the store never sees it.

## Three kinds of surfaces

| Kind | Examples | What moves |
|---|---|---|
| Timeline (this skill end to end) | a progress grid, a chart, a diagram, a turn-based board | a committed change returns events; `buildTimeline` turns them into tracks; the scene clock plays them |
| Simulate-then-replay | a physics shot, a cascade | the continuous phase runs inside the reducer with a fixed step and returns timed events; tracks replay them (`realtime-game-loop`) |
| Live | a timer ring driven every frame, a real-time arena | a fixed-step loop on the UI thread; the picture reads the simulation directly; its draw test and goldens come with `realtime-game-loop`. Here it needs palettes, contrast pairs and a draw file only (`"kind": "live"`, or a `sim/` folder beside its `canvas/` folder) |

A surface that takes touch also needs the input side: load `canvas-gestures-and-hit-testing` in the
same session.

## Prerequisites and their owners

`check-canvas-files.mjs` checks every import of every present kit file and names the skill that
creates anything missing (`kit-import-unresolved`).

| Prerequisite | Path in the app | Owner skill |
|---|---|---|
| `AppText` (the probe renders its texts with it: `children`, `testID`) | `src/ui/app-text.tsx` | `design-system-structure` |
| Jest projects `unit` + `golden`, `jest.setup.ts` (the Skia mock for the unit project), `scripts/quality/device-only.ts` | root | `unit-and-component-tests` |
| `renderWithProviders` (the probe's test renders `AppText` inside the app's providers) | `test/render-with-providers.tsx` | `unit-and-component-tests` |
| `test/goldens/skia-golden.ts` (copied from this skill's templates; a canonical root file) | root | `golden-and-snapshot-tests` holds the golden policy |
| React Native Testing Library 14.0.1 with `test-renderer`, fast-check 4.10.2 | devDependencies | `unit-and-component-tests` (pinned with `dependency-management`) |
| Skia, Reanimated, Worklets, Gesture Handler (SDK 57 pins) | dependencies | `expo-project-bootstrap` (`npx expo install`) |
| Audio and haptics ports (optional; structurally match `CueAudio`, `CueHaptics`, `SurfaceAudio`; `HapticCue` in `timeline/track.ts` names the same seven cues as the haptics port and stays its own type, so the kit compiles without that skill) | `src/services/audio/`, `src/services/haptics/` | `audio-and-haptics-feedback` |
| A live reduce-motion value (`Motion`) | `use-reduce-motion` | `accessibility-as-code` |
| The foreground hook the lifecycle reads (`useIsAppActive`; a synced copy ships in `templates/src/hooks/`) | `src/hooks/use-is-app-active.ts` | `react-components-and-hooks` |
| The surface's state and events (local data) | the feature's store | `state-management-zustand` |
| The surface's server data (queries, keys, optimistic updates) | `src/api/`, the feature's model hook | `networking-and-server-state` |
| The bundled TTF the kit's fonts load (`assets/fonts/`) | root | `design-system-structure` |

## The contract file and rn-skills.config.json keys

`contracts/canvas-surfaces.json` (optional; template and schema in `templates/contracts/`) holds the
app's facts: which folders are surfaces, their kind, whether each canvas is opaque, the palette sets,
and the static canvases outside surface folders.

```json
{
  "$schema": "./canvas-surfaces.schema.json",
  "paletteSets": ["light", "dark"],
  "goldensDir": "test/goldens/canvas",
  "surfaces": [
    { "id": "progress-grid", "dir": "src/features/tasks/canvas", "kind": "timeline" },
    { "id": "weekly-chart", "dir": "src/features/insights/canvas" },
    { "id": "card-sparkline", "dir": "src/features/tasks/sparkline/canvas", "opaque": false }
  ],
  "staticCanvases": ["src/ui/brand-mark.tsx"]
}
```

(`card-sparkline` is a hypothetical surface on a rounded card; the example `weekly-chart` is opaque.)
`"opaque": false` says the surface shows what lies behind it, so its draw need not start with
`drawColor` (`drawing.md`, Opaque canvases); the default is `true`. The claim is checked where the
surface is rendered (`opaque-contract`): every `<SurfaceHost>` or `<SurfaceCanvas>` whose `surface`
is that folder's surface object passes a literal `isOpaque={false}` (a spread proves nothing), at
least one does, and `isOpaque={false}` on a surface the contract treats as opaque fails too.
`staticCanvases` lists source files outside every surface folder whose canvas is static art recorded
once (`canvas-outside-surface`; a listed file that animates still fails, a stale entry fails).
Without the contract, every `src/features/<feature>/canvas` (and `src/games/<game-id>/canvas`)
folder is a timeline surface (named by its `<id>-surface.ts`), a folder with a `sim/` sibling is live,
every canvas is opaque, the palette sets are `light` and `dark`, and no static picture is declared. A
malformed contract is bad input (exit 2), never a silent pass.

`rn-skills.config.json` keys this skill reads, besides check-lib's layout keys (`srcDir`,
`featuresDir`, `contractsDir`): `"canvasKitDir": "src/canvas"` (the kit folder) and
`"canvasSurfaceDirs": ["src/features/*/canvas"]` (globs of surface folders, replacing the defaults
`src/features/*/canvas` and `src/games/*/canvas`; `"**/canvas"` works and is
walked from the repo root, skipping installed skills, `node_modules` and build output). The checkers'
options `--kit-dir` and `--surface-dir` override both. A kit folder (and anything inside it) and the
goldens folder are never surfaces, whatever a glob matches, and a configured glob that matches no
surface folder is bad input (exit 2): a silent "0 surfaces" would hide every surface it was meant to
find. `check-canvas-files.mjs` also reads `"contrastContract"` (`accessibility-as-code`'s key, default
`<contractsDir>/contrast.json`) for one purpose only: no palette entry there may name a surface's
`canvas-palettes.json` (`contrast-declared-once`; drawing.md, Contrast pairs).

## When multi-package

With npm workspaces (`apps/*`, `packages/*`), the checkers read `package.json` `workspaces` and look
for the kit in each workspace's `<srcDir>/canvas` and for surfaces in each workspace's
`<featuresDir>/*/canvas`; each workspace's `tsconfig.json` `paths` resolve its `@/` imports. A kit
shared by several apps lives in one package (`packages/canvas/src`): pass
`--kit-dir packages/canvas/src` (or set `canvasKitDir`). `check-canvas-code.mjs` runs from the repo
root; run `check-canvas-files.mjs` once per app with the app's folder as the repo root
(`node ${CLAUDE_SKILL_DIR}/scripts/check-canvas-files.mjs apps/mobile`), because the Jest config, the
goldens and `scripts/quality/` belong to the app. Workspace packages consumed as TypeScript
source need explicit `.ts` extensions in imports (the lint config's `IS_MULTI_PACKAGE`); the
templates use the single-app, extensionless style.
