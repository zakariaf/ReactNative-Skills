# Modules on the web

What each package of the canonical stack does in a react-native-web build, how that was measured, and
the web adapter each missing one needs. The machine-readable copy is `assets/web-support-table.json`
(`web-module-support` reads it). Verified on 2026-10-14 with Expo SDK 57 (`expo` 57.0.26), React Native
0.86.3, react-native-web 0.21.3, in headless Chrome.

## Contents

- 1. How it was measured
- 2. Three ways a module fails
- 3. Packages that fail
- 4. Packages that answer less
- 5. Packages that work
- 6. Web adapters for the failing ones
- 7. The app's own packages
- 8. Re-verify

## 1. How it was measured

A probe app over the installed stack (`registerRootComponent`, `web.output: 'single'`, `wasm` in Metro's
`assetExts`) required each package inside a `try` and called one representative API, then rendered the
results as JSON. `npx expo export --platform web` bundled it; a small Node server served the export
with and without the isolation headers; headless Chrome loaded it over the DevTools protocol (the same
way `check-web-export.mjs --browser` does) and the page text was read back. A package that broke the
bundle was recorded and removed, and the export repeated.

## 2. Three ways a module fails

| Kind | What happens | When you find out |
|---|---|---|
| The bundle fails | Expo's web resolver refuses a React Native internal (`Importing native-only module "react-native/Libraries/Utilities/codegenNativeComponent" on web`) | `npx expo export --platform web` |
| The import throws | `requireNativeModule('X')` throws `Cannot find native module 'X'` in a browser. During static rendering it returns `{}` instead (`requireNativeModule.web.ts`), so the export succeeds | the first page load |
| A call throws or does nothing | the module has a web file that is empty (`export default {}`) or stubbed | when the feature is used |

Only the browser shows the second and third kinds. That is why the export check has a browser smoke and
why `web-module-support` reads the web bundle's import graph instead of trusting a green export.

## 3. Packages that fail (support `none`)

`web-module-support` fails a web-bundled import of these:

| Package | Measured on the web | The web adapter (section 6) |
|---|---|---|
| `react-native-google-mobile-ads` 17.2.0 | the bundle fails: `Importing native-only module ... codegenNativeComponent on web` | no ads on the web: the slot renders nothing |
| `expo-tracking-transparency` | the import throws: `Cannot find native module 'ExpoTrackingTransparency'` | no tracking prompt on the web; the consent port reports not applicable |
| `expo-iap` 5.8.0 | `initConnection()` throws `Cannot find native module 'ExpoIap'` | purchases unavailable on the web; Premium bought on a phone is read from the server |
| `expo-secure-store` | every call throws (`getValueWithKeyAsync is not a function`); `isAvailableAsync()` is false | no secret storage in a browser: memory only, or an httpOnly cookie the server sets |
| `expo-file-system` | calls throw (`this.validatePath is not a function`) after `expo-file-system is not supported on web` | downloads through a link, uploads through expo-document-picker, or the feature hidden |
| `expo-notifications` | `getPermissionsAsync()` answers `undetermined`; `scheduleNotificationAsync` throws (not available on web); push-token listeners do nothing | reminders unsupported on the web |
| `react-native/Libraries/*` (any deep import) | the bundle fails | import from `react-native` only |

## 4. Packages that answer less (support `partial`)

They load and answer, so the checker lets them through; the feature must not depend on them:

| Package | Measured on the web | Do |
|---|---|---|
| `expo-sqlite` | works with set-up: `wasm` asset, isolation headers, a warm-up before synchronous calls, one tab at a time | sqlite-on-web.md |
| `expo-apple-authentication` | `isAvailableAsync()` false | show the button only when available; offer the OAuth web flow |
| `expo-store-review` | `isAvailableAsync()` false; `requestReview()` warns and does nothing | ask only on iOS and Android |
| `expo-splash-screen` | `preventAutoHideAsync()` resolves `false`, `hide()` does nothing | nothing: the `+html.tsx` ground colour stands in |
| `expo-haptics` | calls `navigator.vibrate`, which Chrome blocks before the first tap ("Blocked call to navigator.vibrate because user hasn't tapped") and Safari lacks | never the only feedback |
| `expo-background-task` | `getStatusAsync()` is 1 (Restricted) | schedule nothing |
| `expo-task-manager` | `isAvailableAsync()` false | register nothing |
| `expo-updates` | a stub: `isEnabled` is **true**, `checkForUpdateAsync()` reports `noUpdateAvailableOnServer` | the deploy is the update; skip the update flow on the web |
| `expo-clipboard` | the async Clipboard API: rejected without focus or permission (`User denied permission to access clipboard`) | copy only from a press handler; handle the rejection |
| `expo-sharing` | the Web Share API (`isAvailableAsync()` true in Chrome) | fall back to copying a link when it rejects |
| `expo-network` | `type: UNKNOWN`, `isConnected` from `navigator.onLine` | never branch on the connection type |
| `react-native-audio-api` 0.13.6 | an `AudioContext` starts `suspended` (autoplay policy) | resume from a press handler |
| `@shopify/react-native-skia` 2.6.2 | loads; drawing needs CanvasKit (WebAssembly) loaded first (`LoadSkiaWeb` / `WithSkiaWeb`); only the import was measured | skia-canvas-rendering owns the canvas kit |
| `react-native-keyboard-controller` 1.21.9 | loads; `KeyboardController.dismiss()` does nothing | the browser scrolls focused fields into view itself |
| `@sentry/react-native` | loads; only the import was measured | crash-reporting-and-observability owns the web set-up |
| `expo-dev-client` | loads, does nothing | nothing |

## 5. Packages that work

Measured working: `expo-image-picker` (a file input; permissions answer granted), `expo-document-picker`,
`expo-crypto` (Web Crypto; digests need a secure context, which `localhost` and https are),
`expo-localization` (from the browser; `measurementSystem`, `currencyCode`, `uses24hourClock` and
`firstWeekday` are `null`), `expo-linking` (`createURL('/tasks')` is `https://<origin>/tasks`),
`expo-constants`, `expo-web-browser` (a new tab), `expo-auth-session`, `expo-font`, `expo-image`,
`expo-system-ui`, `expo-router`, `react-native-reanimated` (on the JS thread), `react-native-gesture-handler`
(pointer events), `react-native-safe-area-context`, `react-native-screens`, `@shopify/flash-list`.

## 6. Web adapters for the failing ones

The port stays the same; the `.web.ts` adapter tells the truth about the web (platform-files.md has the
typed-variant pattern):

```ts
// src/services/session/expo-secure-store-session-adapter.web.ts
// No secret storage in a browser: any script on the page can read localStorage, sessionStorage and
// IndexedDB. The token lives in memory (a reload signs out) and the server's httpOnly cookie restores
// the session (auth-and-secure-storage owns the session rules).
import type * as NativeSession from './expo-secure-store-session-adapter';

export const createExpoSecureStoreSessionAdapter: typeof NativeSession.createExpoSecureStoreSessionAdapter =
  () => {
    let token: string | null = null;
    return {
      readToken: () => Promise.resolve(token),
      saveToken: (next) => {
        token = next;
        return Promise.resolve();
      },
    };
  };
```

- **Secrets** (`web-token-storage`): never `localStorage`, `sessionStorage`, `indexedDB` or a script-set
  `document.cookie` for what the native file keeps in expo-secure-store.
- **Notifications, purchases, tracking, ads, background tasks:** the adapter answers the port's
  "unsupported" outcome (`isSupported: false`, `'unavailable'`), and the screen hides the control. Never
  a fake success.
- **Files:** `DatabaseFiles`-style adapters that list or prune files return nothing on the web: expo-sqlite
  keeps the database in the origin private file system, out of expo-file-system's reach.
  `templates/src/data/expo-file-system-database-files-adapter.web.ts` is that sibling for
  persistence-and-migrations' adapter (without it the web bundle reaches expo-file-system and
  `web-module-support` fails).

## 7. The app's own packages

A package the table does not know is not checked. When the app adds a native-only package (an SDK
without a web build), list it in `contracts/web.json` `nativeOnlyPackages`; `web-module-support` then
fails a web-bundled import of it like the ones above. Measure a new package the way section 1 does
before calling it `partial` or working.

## 8. Re-verify

After an Expo SDK or package upgrade, rebuild the probe in a scratch copy of the app: one `try` per
package around `require()` and one call, `npx expo export --platform web`, then
`node ${CLAUDE_SKILL_DIR}/scripts/check-web-export.mjs <copy> --dist <export> --browser auto` with a smoke
route on the probe's testID, and read the page text. Update `assets/web-support-table.json` and this file
together, with the date.
