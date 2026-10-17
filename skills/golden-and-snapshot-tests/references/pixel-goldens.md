# Pixel goldens of Skia surfaces

How a hand-drawn surface's pixels are frozen: the golden project, the one matcher, the sizes and
moments, fonts, accepting baselines and reading a failure. Only apps that draw with
`@shopify/react-native-skia` need this page; the surface's own draw code, layout, timeline and golden
test template come from skia-canvas-rendering, and this page covers the golden mechanics every surface
shares.

## Contents

- Why pixel goldens exist and what they miss
- Set-up: the golden project, the matcher, the pins
- The shape of a pixel golden test
- Fonts and text
- Accepting baselines
- Reading a failure
- Skia and font upgrades
- Screenshot baselines on iOS and Android
- Headless previews outside Jest

## Why pixel goldens exist and what they miss

A Skia canvas has no accessibility children, so RNTL cannot see inside it. A pixel golden renders the
surface through the same pure `draw()` and `layout()` the device runs (skia-canvas-rendering's
`paintSurfacePng(Skia, request)`), on an offscreen CanvasKit surface in Node, and compares the PNG with
a committed baseline.

The tolerance is 0.1% of pixels. A two-digit label is about 0.035% of a phone canvas (77 of 218,400
pixels, measured), below the tolerance: pixels alone would not notice a missing number. So every
localized label inside a canvas is also asserted by a draw-call test that records `drawText` strings
(skia-canvas-rendering's draw test, in the `unit` project).

## Set-up: the golden project, the matcher, the pins

- **The project.** unit-and-component-tests' canonical `jest.config.js` has a `golden` project
  (`*.golden.test.ts` only) that, while the app depends on Skia, uses
  `testEnvironment: '@shopify/react-native-skia/jestEnv.js'` (loads CanvasKit into `global.CanvasKit`)
  and `setupFilesAfterEnv: ['@shopify/react-native-skia/jestSetup.js']` (mocks the module with a
  CanvasKit-backed `Skia`), and never loads `jest.setup.ts`, whose inert Skia mock would blank every
  pixel. The `unit` project cannot render Skia ("Native Skia Module failed to correctly install JSI
  Bindings!").
- **The matcher.** `templates/test/goldens/skia-golden.ts` is the one matcher every pixel golden uses:

  ```ts
  /** 0.1% of pixels may differ (CanvasKit anti-aliasing noise); diffs land in reports/visual/diff. */
  export const toMatchPixelGolden = configureToMatchImageSnapshot({
    failureThreshold: 0.001,
    failureThresholdType: 'percent',
    customDiffDir: join(process.cwd(), 'reports', 'visual', 'diff'),
  });
  ```

  `failureThreshold: 0.001` with `'percent'` means 0.1% of the pixels. The file is a golden path: its
  value changes only after the reviewer approved, together with `contracts/goldens.json`
  `maxPixelTolerance` (the limit `check-goldens.mjs` enforces), in a commit whose trailer says
  `approved by <reviewer>`. A test registers it with
  `expect.extend({ toMatchImageSnapshot: toMatchPixelGolden })` and never passes its own
  `failureThreshold`, `customDiffConfig` or a second `configureToMatchImageSnapshot`.
- **The pins.** `jest-image-snapshot` 6.5.2 (pixelmatch 5 inside) and `@types/jest-image-snapshot`
  6.4.2 as exact devDependencies, verified on 2026-10-03 (`npm view jest-image-snapshot version`,
  `npm view @types/jest-image-snapshot version`). Install with
  `npm install --save-dev --save-exact jest-image-snapshot@6.5.2 @types/jest-image-snapshot@6.4.2`;
  without the types `npm run typecheck` fails with TS7016 in `skia-golden.ts`. A moving matcher changes
  what "0.1% of pixels" means, so dependency-management's exact-pin policy applies.
- **Where.** Pixel goldens live under `test/goldens/<area>/` (skia-canvas-rendering uses
  `test/goldens/canvas/`): they read fonts with `node:fs` and wrap PNG bytes in `Buffer`, which the
  app program does not allow.

## The shape of a pixel golden test

skia-canvas-rendering's `test/goldens/canvas/__SURFACE__.golden.test.ts` is the template. The parts
that matter for this policy:

- **Three canvas sizes:** `phone-portrait` 390 x 560, `tablet-landscape` 1024 x 700, `small` 320 x 400
  (the narrow split-view case). A surface laid out to its container breaks at the edges first. A
  drawing with one true size (an app badge, an icon raster) renders that size and says why on a
  comment line `// fixed-size: <why>`. A smoke test that proves the golden pipeline itself, drawing a
  function defined inside the test rather than a production surface, needs no size matrix either.
  `check-goldens.mjs` accepts nothing less.
- **Three moments when it animates:** 0, 50% and 100% of the busiest change (`MOMENTS = [0, 0.5, 1]`,
  `elapsedMs: timelineEndMs(tracks) * moment`). Moment 0 shows no effect that starts later, 0.5 the
  effects mid-flight, 1 the final state. A static drawing (`elapsedMs: 0`, no tracks) needs none.
- **Snapshot ids** `<id>-<size>-<moment>` through `customSnapshotIdentifier`, stored next to the test
  as `__image_snapshots__/<id>-<size>-<moment>.png`.
- **A realistic view:** real data shapes, localized digits, the dark set by default; add light,
  mirrored (right-to-left) or high-contrast cases when the surface draws them differently.

## Fonts and text

CanvasKit has no system fonts, and Skia's `jestSetup` returns `null` for `useFont`/`matchFont`, so a
golden that draws text loads the app's bundled TTF explicitly:

```ts
const FONT = join(process.cwd(), 'assets', 'fonts', 'AppFont-Regular.ttf');
const TYPEFACE = Skia.Typeface.MakeFreeTypeFaceFromData(
  Skia.Data.fromBytes(new Uint8Array(readFileSync(FONT))),
);
```

Use the same file the app bundles, so the golden draws what users see, and assert in the test that
the typeface loaded (`expect(TYPEFACE).not.toBeNull()`): without it every glyph silently disappears.
`measureText` is unimplemented in CanvasKit; widths come from glyph widths in the draw code.

## Accepting baselines

1. `npx jest test/goldens/canvas/<id>.golden.test.ts --selectProjects golden -u` writes the PNGs (only
   `-u` writes; `jest --ci` refuses a missing baseline, verified on 2026-10-04).
2. Open every new PNG with your file-reading tool and compare it with the intended look: nothing
   clipped at `small`, a wide canvas rearranged rather than shrunk, moment 0 without later effects,
   moment 1 the final state, text present.
3. `CI=1 npx jest --ci --selectProjects golden` passes.
4. Commit with `Gate-Change: <id> pixel goldens <created | re-accepted>: <why>; opened all <n> PNGs`.

A set whose three moments all look alike means the timeline sample is not reaching `draw()`.

## Reading a failure

```
Expected image to match or be a close match to snapshot but was 3.7083333333333335% different from snapshot (6408 differing pixels).
See diff for details: reports/visual/diff/weekly-chart-phone-portrait-0.5-diff.png
```

Open the diff PNG (changed pixels are marked in red). If the change is a bug, fix the code; if it is
intended, re-accept that one file with `-u` and a trailer. CanvasKit renders are byte-identical run to
run (verified), so a golden that varies between runs on the same commit means the draw path reads time
or randomness: fix the draw path, never the tolerance.

## Skia and font upgrades

A new Skia version or font file shifts anti-aliasing everywhere. Upgrade in its own branch: prove every
pixel golden passes on the old version, upgrade, then re-accept all pixel goldens in one dedicated
commit after opening each changed PNG (run-goldens-rebaseline is the ritual). Never mix a re-acceptance
with feature work: a real regression would hide among the expected diffs. An Expo SDK move that changes
the bundled `@shopify/react-native-skia` version (read it in the new SDK's module map, expo-sdk-upgrade)
is such an upgrade: do the SDK move first with the old baselines failing only where Skia changed, then
re-accept in the dedicated commit with `Gate-Change: pixel goldens re-accepted for Skia <old> -> <new>`.

## Screenshot baselines on iOS and Android

A pixel golden proves the draw code, not the device renderer (Metal on iOS, Vulkan or OpenGL on
Android), the system fonts or the safe areas. e2e-maestro captures whole screens on a Release build
(ios-simulator-build, android-emulator-build) on a named iOS simulator (`xcrun simctl io <udid>
screenshot <file>`) and a named Android emulator (`adb -s <serial> exec-out screencap -p > <file>`),
per platform, locale and theme, and compares them with `.maestro/baselines/<platform>/...` at 0.2% of
pixels. The same policy holds: baselines change only on purpose, every changed PNG and its diff is
opened, the commit carries a Gate-Change trailer, and the comparator's tolerance is a gate. Android and
iOS baselines are separate files; never compare one platform's shot with the other's baseline.

## Headless previews outside Jest

For previews in plain Node (a design-review gallery, store art), the same draw modules load without
React Native because they import only Skia types. skia-canvas-rendering documents the loader
(`LoadSkiaWeb()` then the headless `Skia` export) and design-visual-parity owns the image-diff tooling.
These previews are tools, not the gate: the Jest pixel golden is the gate.
