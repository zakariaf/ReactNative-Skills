# Drawing a surface: draw(), kit, palettes, layout, text, particles

Everything a surface's `draw-<id>.ts`, `layout-<id>.ts`, `to-view.ts`, `canvas-palettes.json` and
`<id>-surface.ts` must get right. Read this before writing or reviewing any of them.

## Contents

- The rules of draw()
- Opaque canvases (iOS and Android)
- Highlights and effect layers
- The draw kit and palettes
- Contrast pairs and the colour-blind profile
- Paths: build once, unit size
- Layout at any canvas size
- RTL: mirror positions, never pixels
- Text: digits, words, fonts
- Particles and shake
- Many sprites: an atlas
- Performance
- Accessibility (VoiceOver and TalkBack)
- The template surface and the example

## The rules of draw()

`draw(canvas, frame)` is a worklet in a file that starts with `'worklet';`. It:

- reads only its arguments: `frame.view`, `frame.fx` (timeline sample + pointer), `frame.highlight`,
  `frame.colors`, `frame.layout`, `frame.kit`;
- allocates no Skia objects (no `Skia.Paint()`, `Skia.Color()`, `Skia.Path…`, `Skia.Font`), reads no
  clock and no random source, returns nothing;
- imports Skia **types** only (`import type { SkCanvas } …`), and values only from other `'worklet'`
  modules (`@/canvas/canvas-layout`, `@/canvas/timeline/sample`, `@/canvas/timeline/particles`,
  `@/canvas/draw-text`, the surface's `canvas-ids.ts`). A plain JS function called on the UI thread
  throws at runtime, never at build time;
- paints every pixel first: its first canvas call is `canvas.drawColor(frame.colors.color.background)`,
  because `SurfaceCanvas` is opaque (next section);
- is split into one small function per layer: background, cells or bars, highlight, vanishing items,
  effects, drag preview. When the background is a layer function, `draw()` calls it first and its first
  canvas call is the `drawColor` (`opaque-background` follows one same-file helper level);
- draws a drag preview exactly on `frame.fx.pointer.hover`: the gesture layer already lifted the
  pointer by the surface's `dragLiftPt`, so draw never adds an offset (`row - 1` would draw the
  preview one row away from where the item lands, and make an edge row unreachable).

Because of these rules the same function runs in the Picture worklet on device, in Jest goldens
(CanvasKit) and in headless Node scripts with identical pixels. Plain `{ x, y, width, height }` objects
are accepted wherever Skia wants an `SkRect` (and `{ rect, rx, ry }` for an `SkRRect`), on device and
in CanvasKit, so drawing allocates nothing.

Set the paint immediately before each draw call (`kit.fill.setColor(colors.color.done)`), and restore
alpha to 1 after a translucent layer (`kit.fill.setAlphaf(1)`).

## Opaque canvases (iOS and Android)

`SurfaceCanvas` renders `<Canvas opaque>` unless it gets `isOpaque={false}` (`SurfaceHost` passes the
prop through). An opaque canvas declares that it covers every pixel of its rectangle, so `draw()`
starts with `canvas.drawColor(frame.colors.color.background)`. The draw test asserts that the first
recorded call is `drawColor`, and `check-canvas-code.mjs` rule `opaque-background` checks the same
statically (directly, or as the first call of a same-file background helper that `draw()` starts
with). `drawPaint` with a paint that covers the clip (a gradient shader) counts too, and matrix calls
may come first (`save`, `translate`, `scale`, `rotate`, `skew`, `concat`: the shake pattern), because
both fill the whole clip whatever the matrix is; a `clip*` call first does not, since it shrinks what
the fill covers. Goldens cannot see a missing background: an offscreen surface keeps its alpha.

What the prop does in Skia 2.6.2 (verified on 2026-10-03 by reading the installed source and Skia's
Canvas documentation, "On Android it selects the cheapest backing view"; not yet observed on a device):

| Platform | `opaque` (the default here) | `isOpaque={false}` |
|---|---|---|
| Android | `SkiaBaseView.setOpaque(true)` swaps its `SkiaTextureView` for a `SkiaSurfaceView`. A SurfaceView composites in its own layer outside the view hierarchy: a parent's rounded `overflow: 'hidden'` clip and the view's alpha do not apply to it, and pixels draw() leaves untouched are not blended with the views behind it (black or stale content shows) | a TextureView: composites like any view (clips, alpha, content behind it shows through), at a higher GPU and memory cost |
| iOS | the prop is stored and unused: `MetalWindowContext.mm` always creates its `CAMetalLayer` with `opaque = false`, so the canvas blends over what lies behind it either way | the same |

So an app tested only on iOS never sees the Android problem. The default suits a surface that owns its
rectangle (a full-width chart, a board, an editor). A canvas that must show what lies behind it (a
chart on a card with rounded corners, a translucent overlay) renders with `isOpaque={false}`, declares
`"opaque": false` for its surface in `contracts/canvas-surfaces.json` (which exempts it from
`opaque-background`), and may leave its background transparent. The two must agree:
`opaque-contract` fails a `<SurfaceHost>`/`<SurfaceCanvas>` that renders a declared surface without
a literal `isOpaque={false}` (a `{...props}` spread proves nothing), a declared surface that nothing
renders that way, and `isOpaque={false}` on a surface the contract treats as opaque. Check such a
surface once on a named Android emulator (`adb -s <serial>`) inside its rounded card before relying on
it.

Skia's `androidWarmup` prop (draw the first frame directly on the Android compositor) is meant for
static, fully opaque canvases such as an icon; Skia's documentation says animated or translucent
canvases can misrender with it, so `SurfaceCanvas` never sets it.

## Highlights and effect layers

**Highlights.** The screen passes a `CanvasHighlight` (`{ selected, hinted }`, `EMPTY_HIGHLIGHT` when
there is nothing) and it reaches draw as `frame.highlight`. It is UI state (a tap-then-tap selection,
a focused day, a suggested action), never domain state, so the store, undo and persistence never see
it. A surface that can suggest an action implements `targetsOf(state, action)`; the screen rings the
returned targets through `hinted`.

**Effect layers wait for their track.** `sampleTimeline` holds a track's `from` until it starts, so a
sample exists at moment 0 for every track of the change. A layer that is a tween of something already
visible (a bar's height, a cell turning over) may read those held values. A layer that only exists
while its effect plays (a flash, a glow, a particle burst, a shake) draws only when
`isPlaying(entry)` (from `@/canvas/timeline/sample`: `ageMs > 0 && progress < 1`); otherwise every
flash of the change shows at full strength at moment 0, long before its event.

## The draw kit and palettes

`makeDrawKit(skia, { paths, numberTypeface, numberSize })` builds, once per theme on the JS thread: a
scratch `fill` paint, a scratch `stroke` paint, `numberFont` (digits and Latin), the unit `paths` from
`surface.buildPaths(skia)`, and `labels` (shaped Paragraphs, empty until the surface adds them). Skia
host objects captured in the kit are shared with the UI thread, not copied.

`makeCanvasColors(skia, CANVAS_PALETTES, set)` resolves every token of one palette set once per change
of theme or setting; draw reads `colors.color.<token>`. The screen picks the set: `'light'` or
`'dark'` from `useColorScheme()`, or an opt-in set (below).

`canvas-palettes.json` holds `light` and `dark` with identical keys:

- Tokens are semantic (`done`, `cell`, `glow`), never visual (`blue`).
- Values are `#RRGGBB`, or `#RRGGBBAA` for translucent tokens (a drag preview).
- The values come from the app's design tokens (`design-system-structure` owns them); a surface
  that uses the same tokens sits in its screen without a seam. The template's values are neutral demo
  colours.
- `canvas-palettes.ts` imports the JSON `with { type: 'json' }` and types it as
  `PaletteSet<CanvasToken>`, so a missing token is a type error.

## Contrast pairs and the colour-blind profile

Beside the palettes, `canvas-contrast.json` says which colours sit on which, so the pairs can be
measured. Two checkers measure the same two files with the same keys, formulas and thresholds:

- `check-canvas-files.mjs` (this skill) measures every pair in every palette set the contract lists.
- `accessibility-as-code`'s `check-contrast.mjs` does the same through its `canvas-contrast` rule, in
  the same surface folders (`<featuresDir>/*/canvas`, `<srcDir>/games/*/canvas`, the contract's `dir`
  entries, or `rn-skills.config.json` `"canvasSurfaceDirs"`). It counts the surface's
  `canvas-palettes.json` as declared, so it does not report it as an undeclared colour table.

So a surface's pairs are declared once, here. `contracts/contrast.json` (owned by
`accessibility-as-code`) holds the app's other colour tables: the theme palette, chart series that are
not canvas surfaces, tag colours. An entry there that names a surface's `canvas-palettes.json` is a
second pair table for one palette, and the two drift. Both checkers fail it:
`check-contrast` as `contrast-contract`, this skill as `contrast-declared-once`.

**When `check-contrast` reports `canvas-palettes.json` "looks like a colour table":** the installed
copy of `accessibility-as-code` is older than its `canvas-contrast` rule (its `--help` does not list
that rule). Update that skill from this library and rerun. Do not add the surface to
`contracts/contrast.json` in the meantime. That only moves the failure to `contrast-declared-once`,
and the pairs in the second table would never be kept in step with `canvas-contrast.json`.

The template's file:

```json
{
  "edge": "edge",
  "text": [["label", "cell"]],
  "graphics": [["mark", "done"], ["hint", "cell"]],
  "shapes": [["done", "background"], ["done", "cell"]],
  "distinct": [["done", "cell"]]
}
```

**Format 1** (stable: both checkers read it, so a key is added, never renamed; a key outside this list
fails as `contrast-file`, because a misspelt key would switch its checks off):

| Key | Value | Measured as |
|---|---|---|
| `text` | `[fg, bg]` token pairs: digits and labels drawn on a ground | 4.5:1 in every set (WCAG 2.2 1.4.3, `text-contrast`) |
| `graphics` | `[fg, bg]` pairs: icons, marks, rings, axis lines | 3:1 in every set (1.4.11, `non-text-contrast`) |
| `shapes` | `[fill, ground]` or `[fill, ground, edge]`: a filled shape and what it sits on | 3:1 off its edge (`edge` below, or the third token) or off its ground, whichever is higher (1.4.11 measures the boundary, `shape-contrast`) |
| `distinct` | token lists (item kinds), two or more tokens each | at least 0.07 apart in OKLab under protanopia, deuteranopia and tritanopia (Machado 2009, severity 1.0; `cvd-separation`) |
| `edge` | a token: the outline draw() strokes around filled shapes | required when a `shapes` entry has two tokens |
| `base` | a token, default `background`: an opaque colour | translucent grounds are composited over it |
| `distinctSets` | palette set names | the sets `distinct` is checked in (default: every set) |
| `$comment` | text | nothing |

- At least one `text`, `graphics` or `shapes` pair; every token must exist in `canvas-palettes.json`.
- A translucent token (`#RRGGBBAA`, a drag preview) is composited over its ground before it is
  measured, and a translucent ground over `base`.
- The thresholds are WCAG's floors; numbers in `quality-gates.json` `"a11y"` (`textContrastMin`,
  `nonTextContrastMin`, `minCvdDistanceOk`, owned by `quality-gates` and `accessibility-as-code`) may
  raise them, never lower them.
- Draw text only on a declared ground (the template draws the streak label on a `cell` plate).
- A failing pair is fixed in the palette values (from the design tokens), never by dropping the pair.
- Meaning is never carried by colour alone: the template's done cells carry a check mark as well.

**The colour-blind (or high-contrast) profile is opt-in.** An app that offers such a setting adds the
sets to every surface's palettes (for example `colorBlindLight` and `colorBlindDark`, from a CVD-safe
family such as Okabe–Ito) and lists them in `contracts/canvas-surfaces.json` `"paletteSets"`;
`check-canvas-files.mjs` then requires them everywhere with identical tokens, measures every pair in
them too, and fails a palettes file that holds a set the contract does not list. A `distinct` list that
only has to hold in the colour-blind sets names them in `distinctSets`.

## Paths: build once, unit size

Build shapes once, in `buildPaths(skia)`, with the immutable API, at unit size (0…1):

```ts
const mark = skia.PathBuilder.Make().moveTo(0.06, 0.52).lineTo(0.2, 0.38).lineTo(0.4, 0.58)
  .lineTo(0.8, 0.16).lineTo(0.94, 0.3).lineTo(0.4, 0.86).close().build();
```

Draw them scaled into a cell: `canvas.save(); canvas.translate(x, y); canvas.scale(size, size);
canvas.drawPath(path, paint); canvas.restore();`. Never `Skia.Path.Make()` plus `addCircle`/`moveTo`
on the path in new code: Skia 2.6 moved to immutable paths; in 2.6.2 the old mutators still work but
log a deprecation warning and will be removed. `path.transform(m)` still mutates in place: transform a
copy with `Skia.PathBuilder.MakeFromPath(path).transform(m).build()`, or use the canvas transform.
`Skia.Path.Circle(x, y, r)` is fine for static shapes.

## Layout at any canvas size

`layout(input)` is a pure worklet of the actual canvas size (portrait phone, landscape tablet,
resizable windows on iPad and Android tablets and foldables) and returns a `CanvasLayout`:

```ts
type CanvasLayout = { width: number; height: number; isMirrored: boolean; regions: readonly GridRegion[] };
type GridRegion = { id: string; x: number; y: number; cell: number; cols: number; rows: number };
```

- `fitGrid({ box, cols, rows })` gives the largest whole-point square cell that fits `box`, centred.
- Regions exist for tappable cells (a grid, a tray, a strip of bars). A region of square cells can
  stand for tall columns: the example chart's `bars` region has several rows per column, so a tap
  anywhere in a column hits that day. Free-form pictures scale to `layout.width`/`height`.
- `cellRect(layout, target)` is where to draw a cell (fractional col/row works for mid-animation
  positions). `hitTest(layout, point, slop)` is the inverse, used by the gesture layer. Both read the
  same layout, so drawing and touch can never drift.
- Rearrange for wide canvases instead of shrinking (a tray goes beside the grid when
  `width > height × 1.2`).
- A surface whose drag preview floats above the finger (`dragLiftPt`) keeps at least that much canvas
  below its last row, or no lifted drag could reach the last row.
- The canvas size comes from `<Canvas onSize={sharedValue}>` (`useSurfacePlayer` creates it).
  `<Canvas onLayout>` is not supported on the New Architecture: Skia 2.6.2's `Canvas.tsx` types it
  `@deprecated` and logs a `console.error` whenever it is passed under Fabric (`canvas-onlayout`).
  Before the first size, `EMPTY_LAYOUT` (no regions) keeps hit-testing inert.
- The template's `layout-<id>.test.ts` proves at random sizes (240…2732 points), mirrored or not, that
  every cell stays inside the canvas and `hitTest(cellRect(c)) = c`.

## RTL: mirror positions, never pixels

Never pixel-flip a canvas (`scaleX: -1` mirrors letters and digits). A surface that opts in
(`isMirroredInRtl: true`: a time axis, a reading-order grid) gets
`layout.isMirrored = isRtl && surface.isMirroredInRtl`, and `cellRect`/`hitTest` mirror positions:
logical column 0 sits on the physical right edge, glyphs stay readable, touches still land. Draw code
never branches on direction. A picture with a physical meaning (a map, a photo, a game arena) keeps
`isMirroredInRtl: false`. `rtl-and-direction` owns direction for the rest of the screen.

The surface's `isRtl` is the layout direction: `useDirection() === 'rtl'` from `rtl-and-direction`
(fixed for the JS run, the same direction the views around the canvas use), never the direction of the
current language (`directionOf(language)`). After a language switch without a reload the two differ,
and a canvas mirrored by language would disagree with its own header and with touch. Its
`PhysicalDirectionView` is for view-based surfaces; a canvas mirrors positions through its layout.

## Text: digits, words, fonts

- **Digits** are localised in `toView()` with the app's `ViewFormat.formatNumber`, so the view holds
  `'١٢'`, not `12`, when the person's digit setting is Arabic-Indic. Build the format from the locale
  tag `i18n-strings-and-catalogs` gives every number, `localeTagFor(language, digits)` in
  `src/i18n/digits.ts`, which carries the numbering system:
  `{ formatNumber: (n) => new Intl.NumberFormat(localeTagFor(language, digits)).format(n) }`
  (`ar-u-nu-arab` gives `'١٢'`, `ar-u-nu-latn` gives `'12'`). Never rely on a region's default: under
  that skill's forced FormatJS polyfills (`@formatjs/intl-numberformat` 9.4.3 with only the `en` and `ar`
  data, imported first by the app entry and by Jest's `setupFiles`) both `ar` and `ar-EG` format `'12'`, while
  Node's own ICU formats `ar-EG` as `'١٢'` (verified on 2026-10-03; re-verify in a Jest test with
  `new Intl.NumberFormat('ar-EG').format(12)`). The template's tests pass a fixed Arabic-Indic
  formatter, so they test the surface, not the Intl data. Numbers that must stay Latin (codes) use an
  `en` formatter.
- **Standalone digits and Latin**: `drawCenteredText(canvas, { text, cx, y }, { font: kit.numberFont,
  paint: kit.fill })`. Arabic-Indic and other digits need no shaping, so `drawText` is right for them.
  Text width comes from glyph widths (`font.getGlyphWidths(font.getGlyphIDs(text))`): `SkFont.measureText`
  is not implemented in the CanvasKit build that Jest and Node use (Skia 2.6.2's `JsiSkFont.ts`, read on
  2026-10-03: under Jest it returns a `jest.fn()` stub, so `.width` is `undefined`; in plain Node and on
  web it throws "Not implemented on React Native Web").
- **Digits in a small shape**: the kit has one number size. `drawFittedText(canvas, { text, rect,
  maxShare = 0.8 }, { font, paint })` centres the text in `rect` and shrinks it, never grows it, so its
  glyph width and the font size fill at most `maxShare` of the rect; `fittedScale(font, label)` is the
  pure part its test checks.
- **Words and complex scripts** (Arabic, Hebrew, Devanagari, Thai, emoji): a Skia `Paragraph` built on
  the JS thread, laid out once per text, size and theme, stored in `kit.labels` (pass
  `{ ...kit, labels }` to the canvas), drawn inside the picture with `label.paint(canvas, x, y)`.
  `TextDirection.RTL === 0` is falsy and `LTR === 1`: never write `isRtl && TextDirection.RTL`; pick
  explicitly. Numeric enum literals keep the kit free of Skia value imports (Node-safe). The font
  provider is a required argument, so a label can never fall back to a system font:

  ```ts
  const RTL = 0;    // TextDirection.RTL (LTR is 1)
  const CENTER = 2; // TextAlign.Center
  type Label = { readonly text: string; readonly color: string; readonly width: number };

  export function makeLabel(skia: SkiaApi, fonts: SkTypefaceFontProvider, label: Label): SkParagraph {
    const builder = skia.ParagraphBuilder.Make({ textAlign: CENTER, textDirection: RTL }, fonts);
    builder.pushStyle({ color: skia.Color(label.color), fontFamilies: ['AppFont'], fontSize: 20, heightMultiplier: 1.5 });
    builder.addText(label.text);
    const paragraph = builder.pop().build();
    paragraph.layout(label.width);
    return paragraph;
  }
  ```

  Arabic-script text needs a taller line (`heightMultiplier` about 1.5) to keep its marks inside the
  box.
- **Fonts, the same way on iOS and Android**: load the app's bundled TTF (the file
  `design-system-structure` keeps in `assets/fonts/`) as data with Skia's `useFonts`. It returns a
  `SkTypefaceFontProvider`, `null` while the file loads; the provider gives the typeface of the kit's
  number font and resolves the paragraphs' `fontFamilies`, on both platforms, in Jest goldens and in
  Node. Build the kit and the labels once it exists:

  ```ts
  // use-insights-model.ts (JS thread): one provider for digits and paragraphs, on iOS and Android.
  const APP_FONTS = { AppFont: [require('../../../assets/fonts/AppFont-Regular.ttf')] };
  const REGULAR = { weight: 400, width: 5, slant: 0 } as const;

  const fonts = useFonts(APP_FONTS); // SkTypefaceFontProvider | null while the file loads
  const kit = fonts === null ? null : makeDrawKit(Skia, {
    paths: weeklyChartSurface.buildPaths(Skia),
    numberTypeface: fonts.matchFamilyStyle('AppFont', REGULAR),
    numberSize: 16,
  });
  // Until kit exists, the screen renders its placeholder where the canvas goes.
  ```

  React Compiler keeps `kit` until `fonts` changes (without the compiler, hold it in state); colours
  stay separate (`makeCanvasColors`), so a theme change rebuilds no paints. The snippet compiles and
  lints under the canonical configs (checked in the reference app on 2026-10-03). Never download a
  font at runtime for a canvas.
- **iOS only: the system font manager.** Fonts embedded with the `expo-font` config plugin are
  registered with iOS, and Skia's iOS font manager (`SkFontMgr_New_CoreText`) sees them, so
  `Skia.FontMgr.System().matchFamilyStyle('AppFont', …)` and `matchFont({ fontFamily: 'AppFont' })` find
  them there. Skia 2.6.2's Android font manager is `SkFontMgr_New_Android(nullptr, …)`
  (`RNSkAndroidPlatformContext.h`), which reads only the system font configuration: the fonts the plugin
  puts into the APK are invisible to it, and digits and Arabic-script labels silently fall back to a
  system font. Verified by reading Skia 2.6.2 source; confirm on a named emulator before relying on
  either path. The provider above avoids the question.
- **Fonts in tests and Node**: CanvasKit has no system fonts (verified on 2026-10-03: zero font
  families, and `drawText` without a typeface draws nothing at all), and Skia's Jest setup mocks
  `useFonts`/`matchFont`. Load the same TTF with
  `Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBytes(new Uint8Array(readFileSync(path))))`
  in the golden test (it lives under `test/`, where Node APIs are allowed) and pass that typeface to
  `makeDrawKit` directly: CanvasKit's `TypefaceFontProvider.matchFamilyStyle` is not implemented
  (Skia 2.6.2's `JsiSkTypefaceFontProvider.ts`: a `jest.fn()` stub under Jest, not a typeface). Register
  it in a `Skia.TypefaceFontProvider.Make()` (`registerFont(typeface, 'AppFont')`) for `makeLabel`,
  where paragraphs resolve `fontFamilies` through the provider as on device. The example's golden does
  both.

## Particles and shake

`sampleParticle(burst, index, ageMs)` is stateless: every particle position is a pure function of the
burst spec, its index and its age, with direction and speed from `burstHash(seed, index)` and 16
committed unit vectors (no `Math.cos`, whose last bits differ between engines). So bursts replay
identically, render at any moment in goldens and cost nothing when the clock stops. Bursts are tracks
(`channel: 'burst'`), which is how reduced motion removes them. Use `burst.ageMs` for the age and draw
only while `isPlaying(burst)`. (`burstHash` is the murmur3 finaliser; `particles.test.ts` pins three
values, cross-checked with an independent Python implementation, because a changed hash moves every
particle in the goldens. An app with `seeded-determinism-and-golden-vectors`'s RNG may use its hash
instead, then re-accept the goldens.)

Shake: a short track whose values offset the whole picture with `canvas.translate`; drop it under
reduced motion.

## Many sprites: an atlas

Up to about a hundred shapes: draw calls in the Picture. More than a few hundred identical sprites:
pre-render them once per theme into one image (keyed by palette set, cell size and pixel ratio), then
draw them as one atlas call. Inside a Picture that is `canvas.drawAtlas(sheet, srcs, xforms, kit.fill)`
with `SkRSXform`s built once in the kit (`skia.RSXform(1, 0, 0, 0)`) and updated in draw with
`xform.set(scale, 0, x, y)`; as a declarative node it is `<Atlas image={sheet} sprites={…}
transforms={…} />` with `useRSXformBuffer`. An atlas is one draw call. Dispose of pre-rendered images
(`.dispose()`) when the theme or palette set changes.

## Performance

- Each surface's draw test asserts its own budget on the busiest frame of a change (the template:
  250); no surface may exceed 1,000. Raising a budget needs a frame-time report from a real device
  (`performance-budgets`: hitch rate and p95 frame time).
- Recording a Picture costs about one command per draw call; keep static layers cheap (one
  `drawColor`, simple rects) or cache them in a picture of their own.
- Never trigger a React render per frame: labels next to the canvas change on committed changes only.
- Orientation from the source app (an iOS simulator, Release): 64 rounded rects plus 200 particles held
  the 60 fps cap; about 265 draw calls re-recorded every frame held 60 fps. Profile Release builds
  only, on devices.

## Accessibility (VoiceOver and TalkBack)

Skia content is invisible to screen readers. `SurfaceCanvas` renders the canvas with `accessible`,
`accessibilityRole="image"` and `accessibilityLabel` = `t()` of `surface.describe(view)` (for example
"21 of 28 days done"); VoiceOver reads it as an image with that label, TalkBack likewise. Every other
`<Canvas>` needs all three (`role="img"` with `aria-label` works for the last two), declarative ones
included. `accessible` is not optional: React Native 0.86 defaults it to false
(`AccessibilityProps.h`: `bool accessible{false}`), Skia's `Canvas` spreads its props straight onto its
native view (so nothing in `View.js` derives it from a label or a role), and on iOS a view becomes a
VoiceOver element only when `accessible` is true. A canvas with a role and a label but no `accessible`
is skipped by VoiceOver while TalkBack may still read its label, so the gap shows on iOS only (verified
by reading React Native 0.86.3 and Skia 2.6.2 source on 2026-10-03; confirm on a named simulator with
VoiceOver). A wrapper that speaks for the canvas needs the same three props. A purely decorative canvas
(a gradient backdrop, a blur; it may live outside the surface folders) says so explicitly with
`accessible={false}` or `importantForAccessibility="no-hide-descendants"` (`check-canvas-code.mjs`
rule `canvas-a11y`). The
`describe` id is a catalog key that must exist in every locale, with counted values named `…Count`
and used as ICU plurals (`{doneCount, plural, one {# day} other {# days}} of {dayCount} done`).
Interactive cells need more than one image label: `canvas-gestures-and-hit-testing` and
`accessibility-as-code` cover per-cell actions. Keep other controls siblings of the canvas, never
children of its gesture detector.

## The template surface and the example

- **The template** (`templates/src/features/__FEATURE__/canvas/`, filled as `tasks` /
  `progress-grid`): a 7 × 4 grid of days. A committed change turns the toggled days over (`flip`
  track, the first carries the sound and a light haptic), glows and bursts when every day is done
  (`glow`, `burst`), pops the localised streak label (`streak`, fitted text on a plate), and rings the
  hinted and selected days. Replace the model, the events and the layers; keep the structure and the
  tests.
- **The example** (`examples/weekly-chart/`, shapes to imitate): a bar chart of tasks done per day,
  fed by server data. `diff-events.ts` derives its events from two states (a changed day, a new week),
  bars tween from their old value (a held `from` is right for a visible tween), the changed bar
  flashes (an effect, guarded by `isPlaying`), a falling bar is clamped to the new week's scale, the
  time axis mirrors in RTL, a two-region layout puts the digit slots under the bars, and the draw test
  asserts every localised count and the opaque background. It is a complete surface folder (palettes,
  contrast pairs, timeline, layout and draw tests, the surface object) plus a golden test that loads
  the app's bundled TTF (`assets/fonts/AppFont-Regular.ttf`) and renders a busy refetch: three bars
  rise and flash, one falls. It ships no baselines, because they are created on purpose after looking
  at them (workflow step 8). Copied into the reference app on 2026-10-03 with a TTF at that path, it
  compiled, linted, passed its tests and both checkers, and its nine accepted baselines showed the
  digit row under the bars at every size (moment 0 the old bars without flashes, the digit row
  already showing the new counts because labels come from the view; 0.5 mid-tween with flashes; 1 the
  final view).
