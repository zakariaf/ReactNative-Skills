# Skia notes for code-drawn art

## Contents

- Versions
- Three places Skia runs
- Headless Skia in Node
- Drawing APIs used here
- Declarative drawing in components
- Jest: unit vs golden
- Text in art

## Versions

`@shopify/react-native-skia` 2.6.2 (in Expo SDK 57's module map), Reanimated 4.5.1, Node 22.18 or newer
for the scripts (type stripping). Verified on 2026-10-10; re-verify with
`npm view @shopify/react-native-skia version` and `npx expo install --check`.

## Three places Skia runs

| Where | How Skia is loaded | Used for |
|---|---|---|
| The app | `import { Skia, Canvas, ... } from '@shopify/react-native-skia'` | the icon rasterizer, `BrandTile`, `Picture` |
| Jest golden project | CanvasKit (`@shopify/react-native-skia/jestEnv.js` and `jestSetup.js`; golden-and-snapshot-tests owns the project) | `*.golden.test.ts`: the rasterizer, `drawMark` pixels |
| Node scripts | `loadHeadlessSkia()` in `scripts/art/load-headless-skia.ts` | `build-icon-paths.ts`, `render-icon-sheet.ts`, `render-app-art.ts` |

Draw code shared by all three (`brand-mark-art.ts`) imports Skia **types only** and takes the Skia API
as a parameter (`type SkiaApi = typeof Skia`), so Node's type stripping loads none of React Native.

## Headless Skia in Node

```ts
import headless from '@shopify/react-native-skia/lib/commonjs/headless/index.js';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/commonjs/web/LoadSkiaWeb.js';
await LoadSkiaWeb();
const skia = headless.getSkiaExports().Skia;
```

Skia has no `exports` map, so deep imports need the `.js` extension under Node ESM. The CommonJS build
declares its own copy of the Skia types; when passing the headless API to shared draw code, cast once:
`(await loadHeadlessSkia()) as unknown as SkiaApi`. Relative imports in the scripts keep their `.ts`
extension (Node resolves files, not TypeScript paths); `@/` aliases do not work in Node scripts.

## Drawing APIs used here

- Surfaces: `skia.Surface.Make(w, h)` (CPU), `surface.getCanvas()`, `surface.flush()`,
  `surface.makeImageSnapshot().encodeToBytes()` (PNG) or `.encodeToBase64()`, `.readPixels()` (RGBA,
  goldens).
- Paths: `skia.Path.MakeFromSVGString(d)` (null on bad data), `skia.Path.Stroke(path, { width, cap,
  join })`, `skia.Path.MakeFromOp(a, b, op)`, `skia.Path.AsWinding(path)`,
  `skia.PathBuilder.MakeFromPath(path).setFillType(type).build()`, `path.toSVGString()`.
- Paint: `skia.Paint()`, `setColor(skia.Color(hex))` (or a `Float32Array` RGBA), `setAntiAlias(true)`,
  `setStyle(0 fill | 1 stroke)`, `setStrokeWidth`, `setStrokeCap(0 butt | 1 round)`,
  `setStrokeJoin(1 round)`, `setBlendMode(0 clear)` (cut-outs), `setColorFilter(skia.ColorFilter.MakeMatrix(m))`.
- Canvas: `drawColor`, `clear`, `drawPath`, `save`/`restore`, `translate`, `scale`,
  `rotate(deg, px, py)`, `saveLayer(paint)` (the luma filter of the tinted icon).

## Declarative drawing in components

```tsx
<Canvas style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
  <Group transform={[{ scale }]}>{markPaths(ops)}</Group>
</Canvas>
```

Rotations in `transform` are radians. Build element lists with a plain function (`markPaths`), not a
nested component: one component per file, and the list stays one canvas. A canvas is either an
accessible image with a label or explicitly decorative (accessibility-as-code, skia-canvas-rendering);
art is decorative and the screen says in text what it shows.

## Jest: unit vs golden

- **Unit project:** the canonical `jest.setup.ts` mocks Skia centrally (inert `Skia<Component>` host
  elements that keep their props). A component test asserts the frame, size, colours passed to
  `SkiaPath` and accessibility, never pixels. Canvas-holding components are hidden from accessibility,
  so query them with `{ includeHiddenElements: true }`.
- **Golden project** (`*.golden.test.ts`): real CanvasKit. Read pixels with `readPixels()` and assert
  colours at known points (as `brand-mark-art.golden.test.ts` does), or compare PNGs with
  golden-and-snapshot-tests' pixel matcher (a fixed-size raster such as a 1024 icon then carries a
  `// fixed-size: <why>` comment for that skill's `pixel-golden-cases` rule).

## Text in art

Icons, the mark, the app icon and the splash hold no text, so the art scripts load no fonts. Store art
that needs words (a feature graphic) is made by hand in each of the app's locales. Art that must draw
text in the app loads the app's bundled font files through Skia, on both platforms the same way:
`useFont(require('…ttf'), size)` for one font, or `useFonts({ Family: [require('…ttf')] })`, which
returns a `SkTypefaceFontProvider` for paragraphs (or build one with `Skia.TypefaceFontProvider.Make()`
and `registerFont`). `matchFont()` reaches only the system fonts. In goldens and Node,
`Skia.Typeface.MakeFreeTypeFaceFromData` loads the same files. Verified against the
`@shopify/react-native-skia` 2.6.2 type declarations on 2026-10-10 (`lib/typescript/src/skia/core/Font.d.ts`).
skia-canvas-rendering owns text on canvases, including right-to-left scripts and paragraph layout.
