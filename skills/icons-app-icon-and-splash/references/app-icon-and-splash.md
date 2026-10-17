# App icon, native splash and store art

## Contents

- What is rendered, from what
- The contract: contracts/app-art.json
- iOS icon rules
- Android adaptive and themed icon rules
- Splash rules (both platforms)
- Store art (Google Play, App Store)
- The render script
- Expo config and app variants
- Icon Composer (iOS 26) instead of flat appearances
- Reviewing the images
- Hand-made art: the same platform rules
- What was verified

## What is rendered, from what

`scripts/art/render-app-art.ts` draws every image with headless Skia from the brand mark
(`src/ui/icons/brand-mark.ts`) and the theme palette (`src/theme/palette.ts`). The PNGs are committed;
`--check` re-renders in memory and exits 1 when a committed file differs.

| Output (default path) | Size | Drawn as | Read by |
|---|---|---|---|
| `assets/icons/production/icon.png` | 1024, opaque | the tile colour full bleed, the mark at `glyphArea` (62 %) | `icon` (fallback), `ios.icon.light`, Android legacy |
| `assets/icons/production/icon-dark.png` | 1024, transparent | the mark in the dark palette | `ios.icon.dark` |
| `assets/icons/production/icon-tinted.png` | 1024, opaque gray | the dark mark over the dark ground through a Rec. 709 luma filter | `ios.icon.tinted` |
| `assets/icons/production/android-foreground.png` | 1024, transparent | the mark at 55 % (inside the 66 dp circle) | `android.adaptiveIcon.foregroundImage` |
| `assets/icons/production/android-background.png` | 1024, opaque | the tile colour | `android.adaptiveIcon.backgroundImage` |
| `assets/icons/production/android-monochrome.png` | 1024, transparent | the white silhouette (`monoOps`) at 55 % | `android.adaptiveIcon.monochromeImage` (Android 13+ themed icons) |
| `assets/images/splash-icon.png`, `splash-icon-dark.png` | 1024, transparent | the mark at 62 %, light and dark | the `expo-splash-screen` plugin |
| `assets/store/play-icon.png` | 512, opaque | the light icon | Google Play listing (uploaded by hand) |
| `assets/store/feature-graphic.png` | 1024 x 500, opaque | designed by hand; optional | Google Play listing |

The production paths are the ones app-variants-and-environment's `app.config.ts` reads
(`assets/icons/<variant>/`); its `make-variant-icons.mjs` then draws the badged development and preview
copies from these files. Render first, then badge. An app started by expo-project-bootstrap already
holds placeholder art at these paths (a flat dark tile with a white mark, banded development and
preview copies, `splash-icon.png`, `favicon.png`) and its `app.config.ts` names `icon.png` for iOS:
replace the files at the same paths.

## The contract: contracts/app-art.json

Copy `templates/contracts/app-art.json` (and its schema). Every key is optional; the template shows
the defaults. `outputs` moves an image, `optional` lists images that may be absent (default: the
hand-made feature graphic), `glyphArea` (0.4 to 0.9, default 0.62) is the share of an iOS icon the mark
may cover, `icons.allowImages` / `icons.allowPackages` are check-icons' allow-lists. The renderer, the
config helpers and both checkers read the same file, and all of them refuse an unknown key.

The file serves two checkers, so adopting one does not adopt the other. `check-app-art` applies when
`scripts/art/render-app-art.ts` exists or the contract declares rendered art (any of `outputs`,
`optional`, `glyphArea`). An app that only needs check-icons' allow-lists (a photo folder, expo-symbols
for native tabs) keeps just the `icons` key; `check-app-art` then prints `NOT APPLICABLE` and its
hand-made icons are not measured against the code-drawn pipeline:

```json
{ "icons": { "allowImages": ["src/features/tasks/images/*.png"] } }
```

## iOS icon rules

| Requirement | Value | Checked by |
|---|---|---|
| Size and shape | 1024 x 1024 px, square, unmasked; Xcode derives every other size | `art-format` |
| Light | opaque, full bleed: Expo flattens transparency onto white | `art-light-opaque` |
| Dark | transparent background, the glyph only ("Provide your dark app icon with a transparent background") | `art-dark-clear` |
| Tinted | opaque grayscale ("Provide your tinted app icon as a grayscale image") | `art-tinted-gray` |
| Content | one simple glyph inside the central 62 %; no text, photos, fake gloss or shadows (the system adds its own) | `art-safe-area` plus a look |

`ios.icon` accepts a PNG, an object `{ light, dark, tinted }` or a `.icon` folder, and overrides the
top-level `icon` (Expo SDK 57 config reference, verified 2026-10-10).

## Android adaptive and themed icon rules

| Requirement | Value | Checked by |
|---|---|---|
| Layers | foreground and background of equal size (108 dp; a 1024 px source is resized by prebuild) | `art-format` |
| Foreground | transparent background: the launcher mask (circle, squircle, teardrop) cuts the layer | `art-android-foreground` |
| Safe zone | everything that must stay visible within the centre 66 dp circle (radius 30.6 % of the layer); launchers also move the layer for parallax | `art-safe-area` (the farthest drawn pixel) |
| Background | opaque (a transparent pixel shows as black or white per launcher) | `art-android-background` |
| Themed (Android 13+) | `monochromeImage`: a silhouette on transparency; the system recolours it from alpha alone | `art-android-monochrome` |

Without `monochromeImage` an app has no themed icon on Android 13+, and the home screen shows it in
full colour among the themed ones.

## Splash rules (both platforms)

- The splash is the `expo-splash-screen` config plugin: `image`, `imageWidth` (default 100), a
  `backgroundColor`, and `dark: { image, backgroundColor }` (SDK 57 docs). The plugin paints the
  ground; the image holds only the mark on transparency (`art-splash-clear`).
- On Android 12 and later the plugin resizes the image to `imageWidth` dp and centres it on a
  transparent 288 dp canvas, and that canvas becomes the window's splash icon
  (`windowSplashScreenAnimatedIcon`). Android masks the splash icon to a 192 dp circle (2/3 of the
  canvas, radius 96 dp). In image units the safe radius is therefore `96 / imageWidth` of the image
  width: 0.48 at `splashPlugin()`'s 200, and never less than 1/3 while `imageWidth` is at most 288.
  `art-safe-area` checks the farthest drawn pixel against `96 / imageWidth` (at most 0.5), reading
  the widest `imageWidth` it finds (`SPLASH_IMAGE_WIDTH` in `scripts/art/app-art-config.ts` and any
  literal next to `expo-splash-screen` in the app config) and printing it in the message; when it
  finds none it falls back to the conservative 1/3 that holds for any width up to 288. The renderer
  draws the mark at 62 % (reach about 31 %), so a larger mark has room up to the computed bound. Verified on
  2026-10-10 by reading expo-splash-screen 57.0.9 (`plugin/build/withAndroidSplashImages.js`,
  `withAndroidSplashStyles.js`); re-verify with
  `grep -n "288\|imageWidth" node_modules/expo-splash-screen/plugin/build/withAndroidSplashImages.js`.
- **`imageWidth` at most 288 on Android.** A wider image is larger than the 288 dp canvas it is
  composited onto, so its edges fall outside the splash icon. `art-splash-width` reads
  `SPLASH_IMAGE_WIDTH` in `scripts/art/app-art-config.ts` and any `imageWidth` literal in the app
  config; a bigger mark belongs inside the image, not in a wider image.
- iOS shows the whole image `imageWidth` points wide on the storyboard. `splashPlugin()` uses 200 pt.
- The grounds are the palette's `background` in light and dark (`splashPlugin` reads `PALETTE`), so the
  splash hands over to the first screen without a flash.
- Expo Go shows the app icon instead of the splash, and development builds do not reflect every plugin
  option: judge the splash on a preview or release build.

## Store art (Google Play, App Store)

- **Google Play icon:** 512 x 512 px, 32-bit PNG, sRGB, at most 1024 KB, a full square: Play rounds the
  corners (30 %) and adds its own shadow; transparent pixels show Play's UI colour, so it is opaque
  (`art-store-opaque`, `art-format`; Play icon specification, verified 2026-10-10).
- **Feature graphic:** 1024 x 500, no alpha (Play Console help; not re-verified here). It usually holds
  marketing copy, so it is designed by hand and listed as optional; when present it is checked.
- **App Store:** the large icon comes from the binary's asset catalog; nothing separate is uploaded.
  Screenshots are captured from the app (e2e-maestro, the release skills).
- Uploading to a store is outward-facing: stop and ask the developer.

## The render script

```sh
node scripts/art/render-app-art.ts            # writes every output of contracts/app-art.json (~0.4 s)
node scripts/art/render-app-art.ts --check    # exit 1 when a committed image is stale (verify gate)
node scripts/art/render-app-art.ts --help     # usage and exit codes (0 written or current, 1 stale, 2 bad input)
```

- Node runs it with type stripping; apps without `"type": "module"` print a harmless
  `MODULE_TYPELESS_PACKAGE_JSON` warning (hide it with `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`).
- Output is deterministic: re-rendering gives identical bytes. A Skia upgrade can change anti-aliasing
  bytes: re-render, look, commit.
- Run it after any change to the mark, the palette, the contract or the script, then redraw the badged
  variant copies (app-variants-and-environment) so they follow.

## Expo config and app variants

`scripts/art/app-art-config.ts` (imported by `app.config.ts`; Node world):

- `iosAppearanceIcon(projectRoot)` → `{ light, dark, tinted }` from the contract;
- `splashPlugin(projectRoot)` → `['expo-splash-screen', { image, imageWidth: 200, backgroundColor:
  PALETTE.light.background, dark: { image, backgroundColor: PALETTE.dark.background } }]`.

Wire it in this order (the order matters: the moment the plugin entry exists, `npx expo config` fails
with `Failed to resolve plugin for module "expo-splash-screen"` in an app that lacks the package):

1. `npx expo install expo-splash-screen` (SDK 57: `~57.0.9`).
2. `node scripts/art/render-app-art.ts`, look at the images, then let app-variants-and-environment
   redraw the badged development and preview copies from them (its make-variant-icons step, with
   `--force`).
3. In `app.config.ts` (app-variants-and-environment's template), production gets the appearances and
   every variant the drawn splash:

   ```ts
   import { iosAppearanceIcon, splashPlugin } from './scripts/art/app-art-config.ts';
   // baseConfig():
   ios: { bundleIdentifier: identity.appId, icon: variant === 'production' ? iosAppearanceIcon(projectRoot) : icons.ios, supportsTablet: true },
   // pluginsFor(): replace the template's expo-splash-screen entry with
   splashPlugin(projectRoot),
   ```

   `iconsFor(variant)` already points `icon` and `android.adaptiveIcon` at `assets/icons/<variant>/`;
   keep its `backgroundColor` equal to the tile colour.
4. Check: `APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo config --type public --json`
   shows `ios.icon` with three paths and the splash entry with the palette grounds; then
   `check-app-art` (`art-unwired` names a missing piece). A local prebuild after switching variants
   regenerates `ios/` and `android/` (app-variants-and-environment).

`art-unwired` reads the config as text, so it is a guard, not the proof. It accepts an image when the
config holds its contract path, or its folder (a const such as `ICONS = './assets/icons/production'`)
with `${...}/<file name>`, or, for a per-variant icon, an `assets/icons/` folder expression with
`${...}/<file name>`; a bare file name elsewhere (the Expo template's `./assets/images/icon.png`) does
not count. Dark and tinted count as wired when `iosAppearanceIcon(` appears in an `icon:` property.
What it cannot see: a branch that picks the helper for the wrong variant, a path built in another
module, or a computed value. `npx expo config --type public` per variant is the real proof; run it.

**When multi-package:** run the renderer and the checkers once per app folder
(`cd apps/mobile && node scripts/art/render-app-art.ts`); each app has its own contract and mark.

## Icon Composer (iOS 26) instead of flat appearances

The SDK 57 template ships an Icon Composer folder (`expo.icon`: `icon.json` plus layer images) that
gives per-layer Liquid Glass control on iOS 26. Its format is not a documented schema, so this pipeline
renders flat appearances, which iOS 26 renders with its own glass treatment. An app that keeps a
hand-made `.icon` folder for production lists `dark` and `tinted` under `optional` in the contract and
keeps `ios.icon` pointing at the folder; the light PNG, the Android layers, the splash and the store
icon stay drawn in code. `optional` means the same in both tools: `render-app-art.ts` never writes
or compares an optional image (`outputsToDraw()` in `app-art-contract.ts`; `--check` stays green),
and `check-app-art` never requires it or asks the config to name it, whether or not a leftover file
is still on disk (delete the old `icon-dark.png` and `icon-tinted.png` once the folder replaces them).
The same holds for `androidBackground` in an app that sets `adaptiveIcon.backgroundColor` only.

## Reviewing the images

Look at every image with the Read tool at 1024 and downscaled to 256 (`sips -Z 256 in.png --out
out.png` on macOS; any image tool elsewhere): a glyph that reads at 60 px on a home screen must read at
256. Check the dark icon on a dark ground, the monochrome layer as a silhouette, and the foreground
inside a circle. Put the 256 px versions in the report. On a device or simulator, check the home screen
in light, dark and tinted (iOS) and with themed icons on (Android 13+) once per mark change.

## Hand-made art: the same platform rules

`check-app-art` measures only art the pipeline renders. The platform rules do not depend on how an
image was made: an app with hand-made icons (an Icon Composer folder, a designer's PNGs) meets the
same iOS, Android, splash and store rules above. Check them by eye, since no rule here reads the
images an app config names:

- Open each image the config names (`npx expo config --type public --json` lists them) at full size
  and at 256 px.
- **iOS light and Play icon:** no transparency (a checkerboard or white corners in a viewer means
  alpha); the Play icon is 512 x 512 and under 1024 KB (`sips -g pixelWidth -g hasAlpha icon.png` on
  macOS).
- **Android foreground and monochrome:** transparent corners; draw a circle of 61 % of the width (66
  of 108 dp) over the centre and nothing that matters may cross it. **Background:** no transparency.
- **Splash:** transparent corners; the mark within a circle of 2/3 of the image width (exact for an
  `imageWidth` of 288, conservative below), and `imageWidth` at most 288.
- On a device, look at the home screen with round and squircle masks (Android) and in light, dark and
  tinted (iOS).

## What was verified

On 2026-10-10 in a scratch copy of the reference Expo SDK 57 app: `render-app-art.ts` wrote the nine
images in about 0.4 s, `--check` passed on a re-render, `check-app-art` passed, the images were looked
at at 256 px, app-variants-and-environment's badging step redrew its copies from the drawn production
icons, and
`npx expo config --type public` showed `ios.icon` with the three appearances (production), the
per-variant Android layers and the splash entry with the palette grounds. Not verified here (no native
build in this pass): how iOS 26 renders the flat appearances, launcher masks on Android devices, and
the splash on a release build.
