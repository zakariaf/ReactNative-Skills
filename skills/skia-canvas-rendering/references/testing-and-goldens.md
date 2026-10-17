# Testing a surface: unit tests, draw-call budget, pixel goldens, devices

How every surface is proven before anyone looks at it on a phone. Read this when writing a surface's
tests or when a golden fails.

## Contents

- Three levels of proof
- The tests that come with the templates
- The draw-call budget and label assertions
- Pixel goldens: set-up
- Pixel goldens: writing and accepting
- When a golden fails
- Coverage: the device-only marker
- Headless previews in plain Node
- On a simulator, an emulator and devices

## Three levels of proof

| Level | Files | What it proves |
|---|---|---|
| Pure units | `sample.test.ts`, `scene.test.ts`, `scene-clock-state.test.ts`, `scene-clock-traces.test.ts`, `present-change.test.ts`, `cue-scheduler.test.ts`, `build-timeline.test.ts`, `layout-<id>.test.ts` | timeline sampling, the startAt clock fix, the clock's decisions and the recorded traces, fast-forward and cue order, the change budget and reduced motion, layout at any size |
| Draw calls | `draw-<id>.test.ts` (Jest `unit` project) | the per-frame budget, every localised label, moment 0, the highlight, the opaque background first |
| Pixels | `test/goldens/canvas/<id>.golden.test.ts` (Jest `golden` project, CanvasKit) | the picture itself at 3 sizes × 3 moments |

Also in the repo, copied from `templates/scripts/quality/`: `check-worklet-boundary.ts` and its test (a
`'worklet'` module may import values only from other `'worklet'` modules or `react-native-worklets`;
the kit's UI-thread modules and the `draw*`/`layout*` files of every `src/features/*/canvas` and
`src/games/*/canvas` folder must carry the directive; edit its `REQUIRED` list when the app keeps
surfaces elsewhere) and `worklet-transform.test.ts` (`tickClock` has a
`__workletHash`, proving the Babel plugin workletised the directive file). Both run inside `npm test`,
so the boundary holds even in sessions that never run this skill's scripts. The canonical
`jest.config.js` skips `worklet-transform.test.ts` in Stryker mutation runs, which compile without
the Worklets plugin.

## The tests that come with the templates

- `sample.test.ts`: before a tween starts the key holds its `from`; the latest started wins; the end
  lands exactly on `to`; `isPlaying` is false before, true during, false after.
- `scene.test.ts`: fake `FrameInfo` sequences where `timeSinceFirstFrame` restarts at 0 after each
  activation; every pushed scene starts at elapsed 0; done exactly at `endMs`.
- `scene-clock-state.test.ts` and `scene-clock-traces.test.ts`: push while paused, resume after done,
  stale done; the two recorded traces (the seq-guard hook freezes, `scene-clock-state` does not).
- `present-change.test.ts`: cancel old cues → push the final view as scene `seq` with `startAt:
  NOT_STARTED` → schedule new cues.
- `cue-scheduler.test.ts` (fake timers): sounds scheduled on the audio clock, haptics at the track
  start, `cancel()` drops the rest.
- `use-surface-player.test.ts`, `surface-host.test.tsx`, `surface-canvas.test.tsx`,
  `canvas-layout-probe.test.tsx`, `use-canvas-lifecycle.test.ts`: the wiring, with recording stand-ins
  for the clock (the UI thread) and Skia (the canonical `jest.setup.ts` renders Skia components as inert
  host elements in the unit project). The player test also proves that the change present at mount is
  shown without tracks or cues (a screen opened again replays nothing) and that the canvas is opaque
  unless `isOpaque={false}`. The player, the host, the canvas and the lifecycle, app-active and
  committed-change hooks read no context (every port, setting and label arrives as a prop or an
  argument), so their tests render with plain `render`/`renderHook` and say so in a
  `// no-providers: <why>` line, the opt-out `unit-and-component-tests` checks; if a kit file starts
  reading a provider, its test moves to the render helper. The probe writes its texts with `AppText`,
  which reads the theme, so its test renders through `renderWithProviders` from
  `@test/render-with-providers` (`unit-and-component-tests` ships it).
- `use-committed-change.test.ts`: server data becomes committed changes (first data without events,
  a kept identity commits nothing, an optimistic update and its rollback are two changes).
- `build-timeline.test.ts`, `layout-<id>.test.ts` (fast-check over canvas sizes and mirroring),
  `draw-<id>.test.ts`, `<id>-surface.test.ts`, `to-view.test.ts`: the surface.

Gesture tests and the 44-point hit-target test come with `canvas-gestures-and-hit-testing`.

## The draw-call budget and label assertions

`draw` receives every Skia object through `kit` and imports no Skia value, so it runs in the plain
`unit` project (Skia's JSI module does not load there). The test passes a `Proxy` canvas that counts
every call and records `drawText` strings, stub paints and a stub font:

- **Budget**: sample the busiest change mid-animation, draw once, assert `total ≤ DRAW_CALL_BUDGET`
  (the surface's own number, never above 1,000) and that the effect layer actually drew.
- **Labels**: assert the recorded texts equal the localised strings (`['١٢']`). A two-digit label is
  about 0.035 % of a phone canvas (77 of 218,400 pixels), below the 0.1 % golden tolerance, so pixels
  alone would miss a missing number.
- **Moment 0**: at `atMs: 0` no effect layer that starts later draws (the template counts the cells'
  faces, edges and marks only).
- **Opaque background**: the recorder also keeps the call order, and the first call is `drawColor`
  (`SurfaceCanvas` is opaque, so every pixel must be painted; `check-canvas-code.mjs` rule
  `opaque-background` checks the same statically).
- **Highlight**: with a `CanvasHighlight` the rings add their draw calls; with `EMPTY_HIGHLIGHT`
  nothing extra is drawn.
- **Pointer layers** (interactive surfaces): with `pointer.isDown` and a hovered cell, the drag
  preview adds its draw call on exactly the hovered cell.

## Pixel goldens: set-up

- The canonical `jest.config.js` (owned by `unit-and-component-tests`) has two projects: `unit`
  (preset `jest-expo/ios`) and `golden` (`testEnvironment: '@shopify/react-native-skia/jestEnv.js'`,
  `setupFilesAfterEnv: ['@shopify/react-native-skia/jestSetup.js']`, `testMatch` `*.golden.test.ts`).
  Skia's environment replaces React Native's export conditions, so it must never be global.
- `test/goldens/skia-golden.ts` configures jest-image-snapshot (6.5.2 in the reference app):
  `failureThreshold: 0.001`, `failureThresholdType: 'percent'` (0.1 % of pixels), diffs written to
  `reports/visual/diff/`. Changing it follows the repo's gated-file policy (`quality-gates`).
- Goldens live under `test/` (Node types, `@test/*` alias): a golden that loads a TTF reads it with
  `node:fs`, which the app program does not allow.

## Pixel goldens: writing and accepting

The template renders through `paintSurfacePng(Skia, request)`, which runs the **same** `draw()` and
`layout()` the device runs on an offscreen `Skia.Surface`, at:

- three sizes: `phone-portrait` 390 × 560, `tablet-landscape` 1024 × 700, `small` 320 × 400;
- three moments of the busiest change: 0, 50 % and 100 % of `timelineEndMs(tracks)`;
- the dark set (add light, mirrored or opt-in sets when the surface draws them differently);
- the bundled TTF whenever the frames draw text: CanvasKit has no system fonts and draws nothing
  without a typeface (the example's golden loads `assets/fonts/AppFont-Regular.ttf`, `drawing.md`).

Snapshot ids are `<id>-<size>-<moment>`, stored as
`test/goldens/canvas/__image_snapshots__/<id>-<size>-<moment>.png`. The template ships the nine
reviewed baselines of the progress grid, so it passes as copied; once the surface draws something else
they fail, and that is the moment to accept new ones.

Accepting baselines is deliberate (`golden-and-snapshot-tests` holds the policy):

1. `npx jest test/goldens/canvas/<id>.golden.test.ts --selectProjects golden -u` writes them (path
   first: `--selectProjects` would swallow it as a project name; only `-u` writes, `jest --ci` refuses
   to write a new snapshot).
2. Open every new PNG (an agent uses its file-reading tool, which shows images) and check it against
   the intended look:
   - **moment 0 shows no effect that starts later**: old geometry (positions, sizes, faces held at
     each tween's `from`) and no flash, glow, burst or shake yet (an effect at moment 0 means a layer
     skips its `isPlaying` guard). Labels drawn from the view already show the final values unless the
     surface tweens them: the example chart's digit row reads the new counts at moment 0 under the old
     bar heights, and that is correct;
   - moment 0.5 shows the effects mid-flight;
   - moment 1 shows the final state (the view), with nothing left of the effects;
   - nothing is clipped at `small`, and a wide canvas rearranges rather than shrinks.
3. Commit the baselines on purpose, saying why in the message (the repo's golden policy decides the
   trailer).
4. `CI=1 npx jest --ci --selectProjects golden` passes afterwards.

A golden set whose three moments all look alike means the timeline sample is not reaching `draw()`.

## When a golden fails

The failure reads like `Expected image to match or be a close match to snapshot but was
3.7083333333333335% different from snapshot (6408 differing pixels)`, and the diff PNG is in
`reports/visual/diff/`. Open the diff. If the change is a bug, fix the code. If it is intended,
re-accept with `-u` and say why. Never raise the tolerance to hide a diff. CanvasKit renders are
byte-identical run to run, so a golden that varies between runs means the draw path reads time or
randomness. A Skia upgrade shifts anti-aliasing: review and re-accept one surface at a time.

## Coverage: the device-only marker

Modules that unit Jest cannot meaningfully run (`use-scene-clock.ts` needs the UI thread,
`surface-canvas.tsx` a real Skia canvas, `paint-surface-png.ts` CanvasKit) start with
`// device-only: covered by <the test, golden or device check that covers it>` in their first six lines.
The canonical `jest.config.js` leaves exactly those files out of coverage (through
`scripts/quality/device-only.ts`, owned by `unit-and-component-tests`). Everything with logic gets a
real test instead.

## Headless previews in plain Node

For previews outside Jest (store art, a design review gallery), the same draw modules load in plain
Node because they import only Skia types:

```ts
// scripts/visual/load-headless-skia.ts
import headless from '@shopify/react-native-skia/lib/commonjs/headless/index.js';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb.js';

import type { SkiaApi } from '../../src/canvas/canvas-types.ts';

export async function loadHeadlessSkia(): Promise<SkiaApi> {
  await LoadSkiaWeb();
  return headless.getSkiaExports().Skia as unknown as SkiaApi;
}
```

Then call `paintSurfacePng(skia, …)` and compare with pixelmatch (`threshold: 0.1`, max diff ratio
0.001). Run with `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON <script>.ts` (Node type
stripping needs explicit `.ts` extensions and relative paths, not `@/`; never add `"type": "module"`
to an Expo app's root package.json). The pixel tooling (pixelmatch, pngjs) belongs to
`design-visual-parity`.

## On a simulator, an emulator and devices

Jest proves logic and pixels; a Release build proves Metal and Vulkan/OpenGL rendering, fonts and real
timing. After the goldens pass:

- **iOS**: a Release build on a named simulator (`ios-simulator-build`), then
  `xcrun simctl io <udid> screenshot <file>` in each of the app's locales (one RTL locale at least).
- **Android**: a Release build on a named emulator (`android-emulator-build`), then
  `adb -s <serial> exec-out screencap -p > <file>`.
- Never target "the booted simulator" or "the only device": several sessions share one machine.
- Simulators and emulators are not devices: frame timing at 120 Hz and the hitch rate are checked on
  real phones with a frame-time recorder (`performance-budgets`).

End-to-end flows cannot see inside the canvas (it has no accessibility children), so in end-to-end
builds `SurfaceHost` takes `probe={{ testIdPrefix }}` and `CanvasLayoutProbe` publishes
`<prefix>.canvas-layout` = `JSON.stringify({ x, y, layout })` (`x`, `y`: the canvas's top-left corner in
window points via `measureInWindow`; `layout`: the current `CanvasLayout`, regions in canvas points,
unmirrored, plus `isMirrored`) and `<prefix>.canvas-frame` = `{ seq, settled }`. Nothing shows until the
canvas has a size, so a flow never reads the empty layout. A Maestro flow (always with
`--device <id>`) reads the layout with `copyTextFrom` and taps
`x + region.x + (col + 0.5) * region.cell` (mirrored: `x + layout.width - region.x - (col + 0.5) *
region.cell`). The probe is off by default and production builds never render it; `e2e-maestro` owns
the flows and `debug-menu-and-test-hooks` the switch that turns it on: `overrides.isCanvasProbeOn` in
its debug switches store (`src/stores/debug-overrides/`; the debug link `probe=1`, the menu row
`debug.menu.probe`). A canvas host passes `probe={{ testIdPrefix }}` to `SurfaceHost` only while that
switch is true, read with `useDebugOverridesStore` and a `selectIsCanvasProbeOn` selector added with its
first reader, so screenshots never show the probe.
