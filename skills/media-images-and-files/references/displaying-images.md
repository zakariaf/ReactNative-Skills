# Displaying images with expo-image (Expo SDK 57)

How the app shows a picture: which component, how it is sized, which cache, how recycled list cells
stay correct, what a decoded image costs in memory, how it is named for VoiceOver and TalkBack, and
where remote image URLs come from. APIs read in the `expo-image` 57.0.5 type declarations and the SDK
57 docs on 2026-10-14; re-verify with `npm view expo-image@~57.0.5 version` and
https://docs.expo.dev/versions/v57.0.0/sdk/image/.

## Contents

1. Decisions
2. The component and its props
3. Sizing: always a box
4. Caching: one policy per kind of source
5. Lists: recycling and thumbnails
6. Memory: what a decoded image costs
7. Names for screen readers
8. Remote images and the network policy
9. Placeholders, transitions and errors
10. iOS and Android differences
11. Pitfalls

## 1. Decisions

| Decision | Why |
|---|---|
| Every raster image is rendered by `expo-image`'s `Image` (React Native's `Image` is banned by the canonical ESLint config except inside the `Icon` component) | One component with disk and memory caches, downscaling to the view, blurhash/thumbhash placeholders, `recyclingKey`, and the same API on iOS (SDWebImage) and Android (Glide) |
| UI icons, the logo and illustrations are drawn in code (icons-app-icon-and-splash), not image files | An icon is a one-colour mask; this skill covers photos and other content images |
| A stored photo is shown through `StoredImage` (`templates/src/ui/media/stored-image.tsx`) | Size, cover fit, the memory-only cache, the recycling key and the name are decided once |
| The view always has a box (`image-size`) | Without a style the view is 0 x 0 or jumps when the image arrives |
| Stored images are downscaled once before they are stored (files-and-storage.md) | `allowDownscaling` saves memory at draw time, but the file, the decode and every backup still pay for 12 MP |

## 2. The component and its props

```tsx
import { Image } from 'expo-image';

<Image
  source={{ uri }}                 // file://, https://, or require('./x.png'); an ImageRef from useImage
  style={styles.photo}             // the box (section 3)
  contentFit="cover"               // 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'; default 'cover'
  cachePolicy="memory"             // section 4; default 'disk'
  recyclingKey={item.id}           // section 5
  accessible
  accessibilityLabel={t('tasks.photos.photo-label', { position, count })}
  placeholder={{ blurhash }}       // section 9
  transition={isReducedMotion ? 0 : 150}
/>
```

Props that exist only for compatibility with React Native's `Image` and are marked deprecated:
`resizeMode` (use `contentFit`), `defaultSource` and `loadingIndicatorSource` (use `placeholder`),
`fadeDuration` (use `transition`). check-media's `image-legacy-prop` reports them.

Other props worth knowing: `contentPosition` (where a cropped image is anchored), `priority`
(`'low' | 'normal' | 'high'`, for a hero image above a list), `allowDownscaling` (default `true`; never
turn it off for photos), `autoplay` (animated images; `false` under Reduce Motion), `tintColor`
(template images), `blurRadius`, `enableLiveTextInteraction` (iOS 16+), `decodeFormat` (Android
`'argb'` default or `'rgb'`, half the memory for opaque photos), `onLoad`, `onError`, `onDisplay`.

Static methods: `Image.prefetch(urls, options)` (default cache `'memory-disk'`; resolves `false` as soon
as one URL fails), `Image.clearMemoryCache()`, `Image.clearDiskCache()` (both resolve `false` on web,
and may on Android without an activity), `Image.getCachePathAsync(key)`, `Image.writeToCacheAsync(source,
key)` and `Image.readFromCacheAsync(key)` (seed the cache from a local file), `Image.loadAsync(source,
{ maxWidth, maxHeight })` and the `useImage(source, options)` hook (an `ImageRef` in memory; give it a
size limit, the docs warn against large images without one), `Image.generateBlurhashAsync` and
`Image.generateThumbhashAsync`, `Image.configureCache(config)` (iOS only).

## 3. Sizing: always a box

The view needs a size from its style; the image's own pixel size does not lay the view out. Use one of:

- `width` and `height` (a thumbnail, an avatar);
- one dimension plus `aspectRatio` (a full-width photo: `{ width: '100%', aspectRatio: 4 / 3 }`; store the
  photo's aspect ratio with the record when the layout depends on it, so the box is right before the
  file is read);
- `flex: 1` inside a parent with a size (a viewer).

check-media's `image-size` rule fails an expo-image element without a `style` (a spread `{...props}` is
trusted). A style that exists but sizes nothing is a review finding no scan can prove.

Sizes come from the design system (design-system-structure) or the caller's props, never a number
typed in a shared component (ui-component-library's `measurement-literal`).

## 4. Caching: one policy per kind of source

| Source | `cachePolicy` | Why |
|---|---|---|
| A file the app stored (`MediaStorePort.uriOf`) | `'memory'` | The file is already on disk; a disk cache would hold a second copy. A stored file never changes under its name (files-and-storage.md, rule 10), so a cached decode can never be stale. |
| A picked temporary shown before import | `'none'` | It is deleted moments later |
| A public remote image (product photo, avatar URL from the API) | default `'disk'`, or `'memory-disk'` for images shown again and again in one session | The network is the slow part; the disk cache survives restarts |
| A private remote image (behind auth headers) | `'memory'` or `'none'`, unless the decision to keep private images in the app's cache folder is written down | The disk cache is a plain folder in the app's cache; signing out does not empty it. If the disk cache is kept, call `Image.clearDiskCache()` and `Image.clearMemoryCache()` on sign-out (auth-and-secure-storage) |

The cache key is the URI (or `source.cacheKey`). A signed URL that changes on every request defeats the
cache: pass a stable `cacheKey` (the image id) beside it.

## 5. Lists: recycling and thumbnails

- **Which list.** The house default is `FlatList`; FlashList only when a measurement shows the list
  needs it (performance-budgets), and a `ScrollView` only for a short bounded list. A task's photo
  strip (at most `MEDIA_LIMITS.maxPickCount` photos) is a FlatList (`examples/src/features/tasks/`).
  `list-recycling-key` applies once a FlashList is chosen.
- **FlashList recycles cells**: a cell scrolled out is reused for another row, and its image view still
  holds the previous picture until the new one loads. `recyclingKey` (the row's id) resets the view to
  blank or the placeholder when it changes. check-media's `list-recycling-key` fails an expo-image
  element without one in a file that imports `@shopify/flash-list` or in a local module such a file
  imports (one level deep: put rows in their own file, or render `StoredImage`, which always sets a key).
  `FlatList` unmounts rows instead of recycling them; the key costs nothing there, so pass it anyway.
- **Show thumbnails in lists.** The stored image is at most 2048 px on its long edge
  (`MEDIA_LIMITS.storedMaxEdgePx`); expo-image downscales to the view when it decodes
  (`allowDownscaling`), so a 96 pt cell decodes at about 288 px. Do not turn `allowDownscaling` off and do
  not use `contentFit="none"` or `"fill"` in lists: downscaling never applies to those two.
- A server that resizes: request `pixelsForPoints(box, PixelRatio.get())` (from `image-fit.ts`) instead of
  the original, so the download and the decode are both small.

## 6. Memory: what a decoded image costs

A decoded bitmap costs `width x height x 4` bytes (`decodedBytes` in `image-fit.ts`), whatever the
file size on disk:

| Image | Pixels | Decoded |
|---|---|---|
| 12 MP camera photo | 4032 x 3024 | 48.8 MB |
| Stored at 2048 px | 2048 x 1536 | 12.6 MB |
| 96 pt thumbnail at 3x | 288 x 288 | 0.33 MB |

- iOS terminates an app that grows past its memory limit (jetsam) without a JS error; Android throws
  `OutOfMemoryError` or the system kills the process. Both show up as "the app closed" in reviews.
- Never hold image bytes in JS: no `base64: true` from the picker, no `data:image/...;base64,` URIs
  (check-media `picker-options`, `data-uri`). A base64 string is 4/3 of the file, lives on the JS heap,
  is copied when passed around, and is decoded again natively.
- Import picked images one at a time (`media-importer.ts` does); a parallel import of ten 12 MP photos
  decodes ten of them at once.
- performance-budgets owns the memory budget and how it is measured on devices (`footprint` on the iOS
  simulator, `dumpsys meminfo` on Android).

## 7. Names for screen readers

expo-image's `accessible` defaults to `false`: VoiceOver and TalkBack skip the image unless it is made
an accessibility element. Every expo-image `<Image>` therefore states its decision (`image-a11y`):

- **Content** (a photo the person attached, a product picture): `accessible` plus
  `accessibilityLabel={t(...)}` (`alt` is an alias). Say what it is in context ("Photo 2 of 3",
  "Receipt for Groceries"), never the file name. A photo the person took has no description: the label
  names its role and position.
- **Decorative** (a background, a repeat of text already read): `accessible={false}`, written out so a
  reviewer sees the decision.
- An image inside a pressable is named by the pressable (ui-component-library): mark the image
  decorative.

`StoredImage` takes `label: string | null` and maps it to both forms. accessibility-as-code owns the
general rules (roles, touch targets, announcements).

## 8. Remote images and the network policy

- A remote image load is a network request outside the ApiClient. Remote URLs never appear as literals
  in app code (the canonical ESLint `remoteUrl` rule; privacy-and-store-declarations' audit): they come
  from API responses (validated with the response schema, `https:` only) or from `src/config` readers.
- Authenticated images: `source={{ uri, headers: sessionHeaders }}` with headers from the session
  (auth-and-secure-storage); never a token in the URL's query string (it ends up in server logs and in
  the cache key). Choose the cache policy for private images (section 4).
- Under privacy-and-store-declarations' offline-only profile there are no remote images at all.
- On web, `headers` needs CORS (`Access-Control-Allow-Origin` with the app's origin) (per the docs).

## 9. Placeholders, transitions and errors

- `placeholder={{ blurhash }}` or `{{ thumbhash }}` stored with the record (generate once with
  `Image.generateBlurhashAsync`/`generateThumbhashAsync` after the import, or let the server send it).
  Set `placeholderContentFit` equal to `contentFit`, or the placeholder (default `'scale-down'`) jumps.
- `transition` is a cross-dissolve in ms: pass `0` when Reduce Motion is on (motion-and-animation; the
  model hook reads `useReduceMotion()`).
- `onError` gives `{ error: string }`: show the placeholder and a retry for remote images; for a stored
  file it means the file is missing (the sweep reports it as `missing`): show the "photo unavailable"
  placeholder, never a blank box.

## 10. iOS and Android differences

| | iOS | Android |
|---|---|---|
| Engine | SDWebImage | Glide |
| HEIC | decoded | decoded on Android 9+ (API 28); stored images are JPEG anyway |
| Animated WebP/GIF | yes | yes |
| `enableLiveTextInteraction` | iOS 16+ | no |
| `decodeFormat` | ignored | `'rgb'` halves the memory of opaque images |
| `Image.configureCache` | yes | no |
| `accessible` | makes it an accessibility element | maps to `isScreenReaderFocusable` |

Facts in this table come from the type declarations' `@platform` tags (2026-10-14); the HEIC row is
from the platform documentation, not verified on devices here.

## 11. Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| A list shows the wrong photo for a moment while scrolling | FlashList reused the cell; no `recyclingKey` | `recyclingKey={item.id}` (`list-recycling-key`) |
| An image does not appear at all | no size: the view is 0 x 0 | a style with a box (`image-size`) |
| The layout jumps when the image arrives | height unknown until load | `aspectRatio` stored with the record |
| An edited photo still shows the old version | the file was overwritten under the same URI; the cache keyed by URI kept the old decode | new name per change (`overwrite-in-place`) |
| VoiceOver skips the photo | `accessible` defaults to false | `accessible` + label (`image-a11y`) |
| The app is killed after scrolling a gallery | full-size decodes, `allowDownscaling={false}` or `contentFit="none"` | stored images downscaled; thumbnails; keep downscaling on |
| A private photo is visible after sign-out | disk cache | memory-only cache for private images, or clear caches on sign-out |
