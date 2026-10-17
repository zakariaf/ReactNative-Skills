# The web target and its output

Whether the app has a web build at all, which of Expo's three outputs it uses, the root HTML, static
rendering and dynamic routes. Verified on 2026-10-14 against Expo SDK 57 (`expo` 57.0.26,
`expo-router` 57.0.24, `react-native-web` 0.21.3) by exporting a copy of a canonical Tasks app and
opening it in headless Chrome. Re-verify: `npx expo export --platform web` in the app, then
`node ${CLAUDE_SKILL_DIR}/scripts/check-web-export.mjs . --browser auto`.

## Contents

- 1. Is the web a target
- 2. The three outputs
- 3. The default and why
- 4. The root HTML (`+html.tsx`)
- 5. Static rendering runs your modules in Node
- 6. Dynamic routes
- 7. Commands
- 8. Decisions

## 1. Is the web a target

Expo decides from the app config: `platforms` defaults to `["ios", "android"]`, and **web is added when
`react-dom` is installed** (SDK 57 app config reference). The Expo templates install `react-dom` and
`react-native-web`, so a new app is a web app until someone decides otherwise. That is the trap: a
`web` npm script and a `web` block in the config that nobody tests, and a web build that crashes on the
first native-only call.

So the decision is explicit, one of two:

- **Ship the web.** Keep `react-dom` and `react-native-web` (`npx expo install react-dom
  react-native-web`; `@expo/metro-runtime` comes with `expo-router`), set `web.output`, add
  `contracts/web.json`, and follow this skill.
- **Do not ship the web.** Set `platforms: ['ios', 'android']` in `app.config.ts`, or remove `react-dom`,
  `react-native-web` and the `web` script (dependency-management owns the removal). Both checkers then
  print `NOT APPLICABLE` with the fact that proves it.

## 2. The three outputs

`web.output` in `app.config.ts` (SDK 57 values; the fallback when unset is `single`):

| Output | What `npx expo export --platform web` writes | Runs app code in Node | Response headers from the expo-router plugin |
|---|---|---|---|
| `single` | `dist/index.html`, `dist/metadata.json`, `_expo/static/js/web/index-<hash>.js`, `assets/` | no | **none**: no `_expo/.routes.json` is written (verified) |
| `static` | one `.html` per route (`index.html`, `+not-found.html`, `(app)/index.html`, `_sitemap.html`), the bundle, `assets/`, `_expo/.routes.json` | **yes**, every route at export time | yes: `_expo/.routes.json` carries `headers` (verified) |
| `server` | `dist/client` and `dist/server`, HTML rendered per request | yes, per request | yes |

A static host serves `single` and `static` exports. `server` needs a host that runs Expo Router's server
(EAS Hosting, or `expo-server` adapters). API routes, middleware and data loaders are server code:
architecture-and-boundaries owns where they live; on SDK 57 API routes need `server` output.

## 3. The default and why

**`static` on EAS Hosting**, with the root layout behind `WebStorageGate` (sqlite-on-web.md):

- An app on this stack stores data in expo-sqlite, which needs cross-origin isolation headers on the
  page. On EAS Hosting the only way to send them is the expo-router plugin's `headers` option, and
  those reach the host only through `_expo/.routes.json`, which `static` and `server` write and
  `single` does not (verified 2026-10-14). `web-sqlite-setup` fails `single` on `eas-hosting` for that
  reason.
- It is the Expo template default, so most apps already have it.
- The cost is honest: every module the routes import runs in Node at export time (section 5), and the
  storage gate renders nothing there, so the static HTML of a storage-backed screen is an empty root
  (verified: `<div id="root"><div ...><!--$--><!--/$--></div></div>`). Pages that should be indexed
  (a landing page, a help page) render without storage, outside the gate's subtree or in their own
  route group.

**`single` on a static host** is the other good choice: no Node rendering at all, and the host's own
headers file sends the isolation headers (hosting-and-headers.md). Record it as `output: "single"`,
`host: "static-host"` in the contract.

## 4. The root HTML (`+html.tsx`)

`src/app/+html.tsx` wraps every page Expo renders ahead of time (`static`, `server`); `single` ignores it.
It runs only in Node: no browser globals, no providers, no global CSS (global CSS goes in the root
layout). The template (`templates/src/app/+html.tsx`) is the SDK 57 shape:

- `<html lang dir>` from the source language and its direction (`SOURCE_LANGUAGE`, `directionOf`,
  i18n-strings-and-catalogs). Without the file Expo writes `<html lang="en">` and no `dir`. Static HTML
  is per route, not per visitor, so the static values cover only the first paint; the app sets both at
  runtime (below).
- `viewport-fit=cover`: react-native-safe-area-context's web provider reads `env(safe-area-inset-*)`
  (`NativeSafeAreaProvider.web.js`), which is zero unless the page covers the notch area.
- `ScrollViewStyleReset` from `expo-router/html`: the body does not scroll; the root `ScrollView` does,
  as on a phone. Remove it only for a page that is a long document.
- The ground colour of both schemes in a `<style>` with `prefers-color-scheme`, from the palette, so a
  dark-mode visitor sees no white flash before JavaScript runs.
- Metadata on SDK 57: `<Head>` from `expo-router/head` in a route. SDK 58 adds `generateMetadata()` and
  requires `useServerDocumentContext()` in `+html.tsx` (Expo's SDK 57 to 58 migration guide); move then.

The file is a route file, so its test lives in `test/web/root-html.test.tsx` (routes folders hold
routes only, architecture-and-boundaries).

**`<html dir>` and `<html lang>` at runtime.** A visitor reads the app in their own language, not the
source one, and react-native-web has no other place for either value:

- **Direction:** copy `templates/src/i18n/direction.web.ts` (and `direction-web.test.ts`) beside
  rtl-and-direction's `direction.ts`. react-native-web's `I18nManager` has no `isRTL` and ignores
  `forceRTL`, so the native file reads every visitor as left to right and DirectionGate gives up on
  every load (rn-api-gaps.md section 4). The web file keeps the direction on `<html dir>` (the logical
  style keys follow it as CSS logical properties) and saves the forced one in `localStorage` (a
  preference, not a secret) so it survives the direction restart's reload, the way a phone keeps its
  forceRTL flag. It keeps the native file's contract: the guard record first, then the flip, then
  one reload (`reloadAppAsync` is `location.reload()` in a browser).
- **Language:** copy `templates/src/i18n/document-language.ts` and `.web.ts` (and
  `document-language-web.test.ts`), and call `syncDocumentLanguage(language)` in the language
  provider's effect (`I18nProvider` in `src/i18n/i18n-provider.tsx`, i18n-strings-and-catalogs owns it):

  ```tsx
  useEffect(() => {
    recordShownLanguage({ language, digits });
    syncDocumentLanguage(language);
  }, [language, digits]);
  ```

  Screen readers pick their voice, and browsers their hyphenation, line breaking and font fallback,
  from `<html lang>`. The native file does nothing on iOS and Android, where each text carries its
  locale (AppText).

`browser-direction` (with `smokeLanguage` in the contract, `{ "lang": "ar", "dir": "rtl" }` in the
template) starts Chrome with `--lang=ar` and fails unless the first smoke route ends with
`<html dir="rtl" lang="ar">`; it is the check that both files are wired.

## 5. Static rendering runs your modules in Node

With `static` (and `server`), Expo bundles the app for the web and renders every route in Node
(`λ Bundled ... @expo/router-server/node/render.js` in the export log). Consequences, each verified:

- Native modules without a web implementation return `{}` during this render
  (`requireNativeModule.web.ts`: "For SSR, we expect not to have native modules available") and throw
  only in the browser. **A successful export proves nothing about the browser**; the browser smoke does.
- `window`, `document`, `navigator.locks`, `localStorage` do not exist there. A `.web.ts` file that reads
  one at module scope crashes the export (`web-ssr-scope`); read them inside functions and effects, or
  guard with `typeof window === 'undefined'` (the error-net template does).
- expo-sqlite uses a no-op `SQLiteModule.node.ts` on the server, so a screen that renders data from
  storage during the static render renders sample or empty data, and the browser's first render then
  disagrees with the HTML (a hydration error). The storage gate renders nothing in both places, so they
  match.
- Render-time reads of browser globals inside a component also run in Node. The checker sees module
  scope only; read the window size with `useWindowDimensions()` (adaptive-layout) and anything else in
  an effect or with `useSyncExternalStore` and a server snapshot.

## 6. Dynamic routes

`static` writes one HTML file per route path it knows. A dynamic route (`src/app/tasks/[id].tsx`) gets
pages only for the params its `generateStaticParams()` returns (it runs in Node at export, may read
files through `process.cwd()`, and cascades from parent layouts). A visitor who reloads
`/tasks/t-42` on a plain static host gets a 404 unless the host rewrites it to a page that renders the
route client-side. A host that runs Expo's server runtime (EAS Hosting) matches requests against the
routes the export wrote (Expo's hosting documentation; not verified here); on a plain static host
either export the params or list the route id in `contracts/web.json` `clientRoutes` and add the host's
rewrite (hosting-and-headers.md). `web-static-routes` checks this for `static-host`.

## 7. Commands

| Task | Command |
|---|---|
| Develop in the browser | `npx expo start --web` (the dev server sends the isolation headers once `withWebSqlite` wraps the Metro config) |
| Export | `APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform web` (app-variants-and-environment owns the variant pair; `--output-dir` to choose the folder; `--dev` for an unminified bundle with readable React errors) |
| Serve the export locally | `npx expo serve` (HTTP on port 8081; `static`/`server` exports get the manifest's headers through expo-server), or let `check-web-export.mjs --browser auto` serve it |
| Check the export | `node ${CLAUDE_SKILL_DIR}/scripts/check-web-export.mjs . --browser auto` |
| Deploy | Expo's `eas-hosting` skill (`eas deploy`). Deploying publishes the site: **stop and ask the developer first**, and never run it against a project they did not name |

## 8. Decisions

| Decision | Why |
|---|---|
| The web is a target only on purpose; otherwise `platforms` leaves it out | an untested web target ships a crash; `NOT APPLICABLE` needs a repo fact |
| `web.output` always explicit, and equal in `contracts/web.json` | the fallback (`single`) changes what the host must do, silently |
| `static` on EAS Hosting by default | the only verified way to get the expo-sqlite isolation headers there |
| Storage-backed screens render nothing at export time | no hydration mismatch; indexable pages render without storage |
| `+html.tsx` sets `lang`, `dir`, `viewport-fit=cover` and the ground colour | correct first paint, insets, no white flash |
| The export is smoke-tested in a real browser | a green export proves nothing about the browser (section 5) |
