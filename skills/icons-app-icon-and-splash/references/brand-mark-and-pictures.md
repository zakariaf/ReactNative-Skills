# The brand mark and pictures

## Contents

- One mark, every place
- The mark: grid, layers, colour roles
- Designing a mark
- BrandTile: the mark in the app
- Pictures: multi-colour art from layer data
- Shared draw code: one function for the app, goldens and Node
- Canvas budget
- Sprites (games and boards)

## One mark, every place

The app has one brand mark, drawn as layer data in `src/ui/icons/brand-mark.ts` (`BRAND_MARK`). The
same data draws the in-app tile (About, onboarding, a sign-in header), the iOS icon in light, dark and
tinted, the Android adaptive foreground and themed monochrome layers, the splash images and the Play
store icon (app-icon-and-splash.md). One data file is the whole brand: a second drawing (a PNG for one
screen, a hand-made splash) drifts from it on the first redesign. The mark never mirrors in
right-to-left layouts.

## The mark: grid, layers, colour roles

```ts
// src/ui/icons/brand-mark.ts
export const BRAND_MARK: BrandMark = {
  tile: 'primary',                                    // the colour role of the tile behind the mark
  layers: [
    { d: 'M12 4h24a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6V10a6 6 0 0 1 6-6z', fill: 'surface', stroke: 'text' },
    { d: 'M14 19l6 6 13-13', stroke: 'primary', width: 5 },
    { d: 'M14 32h20M14 38h12', stroke: 'textMuted', width: 3 },
  ],
};
```

- `viewBox 0 0 48 48`; keep 2 units clear at the edges, half of each stroke's width included
  (`check-app-art` fails `brand-mark-shape` outside 2..46, with 0.25 units of anti-aliasing slack; a
  rotated layer is measured by its rotated box, which is conservative).
- A layer has `fill`, `stroke` or both (the fill is painted first, then its edge). Colours are **theme
  colour roles** (`ColorTokens` keys from `src/theme/theme-types.ts`, design-system-structure), never
  hex values: the same mark then paints itself in the light and dark palettes and follows a palette
  change. `check-app-art` fails a colour that is not a role.
- `width` is on the 48 grid (default 2.6). A line without a fill gets round caps; the edge of a fill
  gets a butt cap. `rotate: { deg, cx, cy }` tilts one layer like SVG `rotate(deg cx cy)`.
- `markOps(mark, colors)` expands the layers into paint operations (`MarkOp`, each with a stable React
  `key`) in one scheme's colours; `monoOps(mark, ink)` gives the silhouette for Android's themed icon
  (fills in `ink`, unfilled lines cut out, because launchers read only alpha).

## Designing a mark

1. One object that says what the app is for (a card with a check for a Tasks app), seen from the
   front, filling about 75 % of the grid.
2. A light body with a dark edge, one accent line or shape in the tile's contrast colour, about six
   layers (`brand-mark-shape` fails above 8). No text, no gradients, no photo: the icon is read at
   60 px on a home screen.
3. It sits on the `tile` colour, so avoid large areas in that colour; the accent must read on it in
   both schemes.
4. Its silhouette must say the same thing (the themed Android icon and the tinted iOS icon reduce it
   to alpha or gray): check `android-monochrome.png` and `icon-tinted.png` at 256 px.
5. Render everything (`node scripts/art/render-app-art.ts`) and look at all images at 1024 and 256 px.
   A new mark is a design decision: show the 256 px images to the reviewer before committing.

## BrandTile: the mark in the app

`<BrandTile mark={BRAND_MARK} size={92} testID="about.brand" />` (`src/ui/icons/brand-tile.tsx`): a
View in the tile colour, radius `0.24 x size`, with the mark at 80 % in one Skia `<Canvas>`. It is
decorative (the View and the Canvas are hidden from VoiceOver and TalkBack); the screen names the app
in text. Sizes are the app's design decision (46 in a header, 92 on About are typical).

## Pictures: multi-colour art from layer data

Empty states and onboarding scenes are pictures: `PictureArt = { viewBox: { width, height }, layers }`
with the same layer shape and colour roles as the mark, drawn by `<Picture art width testID />`
(`src/ui/icons/picture.tsx`) in one canvas, height from the view box. A picture is decorative: the
screen says in text what it shows ("No tasks yet"). Keep each picture's data next to its feature
(`src/features/tasks/empty-tasks-art.ts`).

## Shared draw code: one function for the app, goldens and Node

`brand-mark-art.ts` imports Skia **types only** and takes the Skia API as a parameter
(`type SkiaApi = typeof Skia`): `drawMark(skia, canvas, { ops, size })`. The same function runs in the
app, in the CanvasKit golden project (`brand-mark-art.golden.test.ts` reads real pixels) and in the
Node art scripts (`render-app-art.ts`, with the headless API cast once). A value import of
`@shopify/react-native-skia` in shared draw code would pull React Native into Node and fail there.
Components (`BrandTile`, `Picture`) draw the ops declaratively through `markPaths(ops)` in
`mark-paths.tsx`, a plain function, so a list of operations stays inside one canvas.

## Canvas budget

Use a Skia `<Canvas>` only for multi-colour art (the mark, pictures) and custom surfaces, never one per
list item: each canvas costs about 0.18 MB and 2.8 ms to mount (measured in the source app, iOS
simulator, Release). A few per screen is the measured comfort zone (the source app allowed 8); the
budget itself belongs to performance-budgets, and where canvas code lives to skia-canvas-rendering.
Icons in lists are always `Icon` (rasterized images).

## Sprites (games and boards)

Art drawn in code that repeats many times per frame (board cells, tokens) is pre-rendered once into a
sprite sheet and blitted (`canvas.drawImageRect`, or `<Atlas>` for hundreds). The cache key holds
everything that changes pixels: palette, colour scheme, colour-blind flag, cell size and pixel ratio
(`'tasks-board:dark:cb0:44@3'`); a new key disposes the old image, so a theme change never shows stale
colours. `surface.makeImageSnapshot().makeNonTextureImage()` gives a CPU-backed image the UI thread can
share (it may return null: check it). Board rendering itself is skia-canvas-rendering's.
