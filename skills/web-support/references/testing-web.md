# Testing the web build

The layers that prove a web build works, the checkers' rules and options, and the realistic run this
skill was verified with. Verified on 2026-10-14 (Expo SDK 57, Node 26.4, Chrome stable, macOS).

## Contents

- 1. The layers
- 2. Jest
- 3. The source checker
- 4. The export check and the browser smoke
- 5. Checks by hand
- 6. The realistic run
- 7. What the checkers cannot see
- 8. Debugging a web crash

## 1. The layers

| Layer | Proves | Command |
|---|---|---|
| Jest (unit project) | web adapters and helpers behave (logic, explicit `.web` imports) | `npx jest --ci --maxWorkers=2 <files>` |
| `check-web-support.mjs` | the web graph holds only code that works in a browser; the set-up is in place | `node ${CLAUDE_SKILL_DIR}/scripts/check-web-support.mjs .` |
| Export | the web bundle builds | `APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform web` |
| `check-web-export.mjs --browser auto` | the export renders each smoke route in Chrome with no console error | `node ${CLAUDE_SKILL_DIR}/scripts/check-web-export.mjs . --browser auto` |
| By hand | layout, input, the two-tab case, a second browser | section 5 |

Maestro drives iOS and Android only (e2e-maestro); it does not cover the web.

## 2. Jest

- The canonical Jest projects (`unit`, `android`, `golden`; unit-and-component-tests) resolve modules the
  way iOS does, so `import './x'` in a test gets the native file. A web file's test imports it by its full
  name, `import { createExpoSqliteWarmUpAdapter } from './expo-sqlite-warm-up-adapter.web';`, and runs in the
  unit project. Name such a test `<unit>-web.test.ts` (`expo-sqlite-warm-up-adapter-web.test.ts`): the
  Jest projects select by suffix and there is no `.web.test` project (naming-conventions).
- Keep web logic in plain functions that take what they need (`readWindowErrorHooks(target)` takes an
  `EventTarget`; Node has `EventTarget` and `Event`, so no DOM environment is needed), and keep the
  `.web.ts` file a few lines of wiring.
- A file that reads `window` at import: define it for the test (`Object.defineProperty(globalThis,
  'window', ...)`), load the module in `jest.isolateModules` with `jest.requireActual`, and restore the
  property afterwards (`app-error-net-web.test.ts`). A test of a missing window sets it to `undefined`.
- `navigator.locks`: Node has `navigator` but no `locks`; define a fake `LockManager` on it per test.
- A `jest-expo/web` project was tried and is **not** the default (measured 2026-10-14): the canonical
  `jest.setup.ts` fails under jsdom at `require('react-native-reanimated').setUpTests()` (jsdom has no
  `window.matchMedia`), and with a `matchMedia` stub React Native Testing Library still fails there
  (`__fbBatchedBridgeConfig is not set, cannot invoke native modules`): RNTL renders React Native, not
  react-native-web. Component behaviour on the web is proven in the browser (section 4).

## 3. The source checker

`node ${CLAUDE_SKILL_DIR}/scripts/check-web-support.mjs [repo-root] [--app-dir <dir>] [--json]`

It first decides whether the web is a target (`platforms` includes web, or `platforms` unset and `react-dom`
installed) and prints `NOT APPLICABLE: <fact>` when not. Then:

| Rule | Reads | Fails when |
|---|---|---|
| `web-target` | package.json, app config | react-native-web missing; `web.output` unset or not the contract's |
| `web-contract` | `contracts/web.json` | missing, or a value out of the schema (an unknown key is exit 2) |
| `web-platform-pair` | every `src/` file with a platform suffix | no base file; a variant shadowed by a base of an earlier extension; a platform route without its base route |
| `web-variant-exports` | `.web` files with a base | value export names differ |
| `web-variant-typed` | `.web` files with a base | no `import type ... from './<base>'` |
| `web-module-support` | the web graph (below) | an import of a `none` package, a `react-native/Libraries/*` deep import, or a contract `nativeOnlyPackages` entry |
| `web-rn-api` | the web graph | a use of a missing export, or a missing, silent or wrong member, that no guard keeps off the web (rn-api-gaps.md section 6: `Platform.OS` checks for web, `ios` or `android`, a function value under a `Platform.select` key the web never picks, `typeof`) |
| `web-browser-global` | every non-`.web` file in `src/` (not `+html`, `+api`, `+middleware`) | `window.`, `document.`, `navigator.`, `localStorage`, `sessionStorage`, `indexedDB`, `matchMedia` used (a parameter or variable of that name is left alone) |
| `web-ssr-scope` | `.web` files of the web graph, static or server output | a browser global read at module scope without `typeof` on the same line |
| `web-token-storage` | `.web` siblings of files importing expo-secure-store | `localStorage`, `sessionStorage` or `indexedDB` (bare or as `window.`/`globalThis.`/`self.` members), `document.cookie`, or an AsyncStorage import (localStorage on the web) |
| `web-sqlite-setup` | metro.config, app config or headers file | wasm asset or dev headers missing; deployed headers missing; `single` on EAS Hosting |
| `web-sqlite-warm-up` | the root layout and the adapters it creates itself | expo-sqlite in the web graph, and the root layout does not return `<WebStorageGate>` with a warm-up as its outermost element, or creates an adapter that reads expo-sqlite synchronously on its first render (before the gate) |
| `web-error-net` | the web graph | the error net reads `ErrorUtils`/`HermesInternal` (`readGlobalErrorHooks`) with no `.web` sibling |
| `web-static-routes` | dynamic routes | `static` output on a static host, no `generateStaticParams` and not in `clientRoutes` |

**The web graph** is what Metro would bundle for the web: the `package.json` `main` file (when local) and
every route file (the `.web` one when it exists; `+api`, `+middleware`, `+html` left out), following value
imports through relative paths and tsconfig aliases with Metro's web order (`x.web.ts` before `x.ts`, per
extension). A native file that a `.web` sibling replaces is never in it, which is how a platform file
fixes `web-module-support`.

**Layout:** `src/`, the routes folder and `contracts/` come from check-lib's `resolveLayout` (tsconfig
`paths`, `rn-skills.config.json` `srcDir`, `routesDir`, `contractsDir`). For an app inside a monorepo,
pass `--app-dir apps/mobile`. Scans skip installed skills (`.agents/skills`, `skills/`, any folder with a
`SKILL.md`).

## 4. The export check and the browser smoke

`node ${CLAUDE_SKILL_DIR}/scripts/check-web-export.mjs [repo-root] [--dist dist] [--browser auto|<path>] [--timeout 15000]`

Without `--browser` it reads the export: `export-entry` (index.html and the bundle), `export-routes`
(a page per smoke route for `static`/`server`), `export-wasm` (expo-sqlite installed), `export-headers`
(expo-sqlite on EAS Hosting: both headers in `_expo/.routes.json`), `export-source-maps`.

With `--browser` it then serves the export on `127.0.0.1` the way a host does (clean URLs to `.html`,
every path to `index.html` for `single`, the isolation headers when expo-sqlite is installed), starts
headless Chrome with a throwaway profile and the DevTools protocol (Node's built-in `WebSocket`), opens
each smoke route, and fails on:

| Rule | Fails when |
|---|---|
| `browser-console` | a `console.error`, or a failed resource other than a favicon (a cross-origin resource that `require-corp` blocks shows here) |
| `browser-exception` | an uncaught exception or unhandled rejection |
| `browser-testid` | the route's testID never appeared before `--timeout`; the storage notices have their own testIDs (`web-storage.unsupported`, `web-storage.other-tab`), so a page that shows a notice instead of the app fails here |
| `browser-isolation` | expo-sqlite is installed and `self.crossOriginIsolated` is not `true` |
| `browser-direction` | with `smokeLanguage` in the contract: a second Chrome started with `--lang=<lang>` opens the first smoke route, and `<html>` does not end with that `dir` and `lang` (direction.web.ts and `syncDocumentLanguage` are not wired: web-target-and-output.md section 4) |

When an export rule fails, the smoke does not run and the output says
`browser smoke not run: fix the export problems first`. `auto` looks for Chrome, Chromium and Edge in
their macOS folders and on `PATH`; a CI image installs Chrome first. The browser and server are closed
and the profile removed afterwards.

## 5. Checks by hand

Before a release of the web build, on the production export served with its real headers
(`npx expo serve`, or the host's preview URL):

1. Resize the window from 320 to 1,600 points wide; zoom to 200 %.
2. Use the app with the keyboard only: Tab order, `Enter` and `Space` on every control, a visible focus ring.
3. Open the app in a second tab: the other-tab notice shows, the first tab keeps working.
4. Reload on a deep URL; use the browser's back and forward buttons.
5. Run with a screen reader (VoiceOver with Safari, NVDA or TalkBack with Chrome): names, roles, live updates.
6. Open it in Safari and Firefox on the desktop once: Chrome is the only browser the smoke drives.
7. Open it on a phone's browser, on named devices only (never `booted` or the only device). The key
   facts of this skill are WebKit's (isolation only with `require-corp`, no origin private file system
   in an ephemeral session, both measured in WebKit), and every iPhone browser is WebKit. Serve the export where the device
   reaches it as a **secure context**: cross-origin isolation, `SharedArrayBuffer` and the origin private
   file system exist only on `https` or `localhost`, so a plain-http LAN address (`http://10.0.2.2:8081/`,
   `http://192.168.x.y:8081/`) always shows the "unsupported" notice (measured in headless Chrome on
   2026-10-16: `localhost` gave `crossOriginIsolated` true, a LAN IP over http gave false with the same
   headers). Then:
   - **Safari on an iOS simulator:** `xcrun simctl list devices available`, pick a UDID (or create
     `<project>-web` with `xcrun simctl create`), `xcrun simctl boot <udid>`, then
     `xcrun simctl openurl <udid> http://localhost:8081/`.
   - **Chrome on an Android emulator:** `emulator -avd <project>-web` (an AVD with the Play Store image,
     so Chrome is installed), `adb devices` for its serial, forward the port so the page is `localhost`
     on the device: `adb -s <serial> reverse tcp:8081 tcp:8081`, then
     `adb -s <serial> shell am start -a android.intent.action.VIEW -d http://localhost:8081/`. (The
     secure-context rule is Chrome's documented behaviour, measured on desktop Chrome; the emulator
     commands were not run on a device in this round.)
   - **A real phone:** serve the export over `https` (the host's preview URL, or an https tunnel to
     `npx expo serve`); its LAN URL over http is not a secure context.
   On each, check that the app renders (not the "unsupported" notice) and, with Safari's Web Inspector
   (Develop menu, the simulator) or `chrome://inspect` (the emulator), that `self.crossOriginIsolated`
   is `true`. A private tab may show the "unsupported" notice on purpose: an ephemeral WebKit session
   answered `UnknownError` for the origin private file system when measured, and the warm-up reports it
   instead of crashing.
8. Turn on dark mode in the system: no white flash on load.

## 6. The realistic run

On 2026-10-14, a copy of the canonical Tasks app (every canonical file, the adopted templates) was
exported for the web and opened in headless Chrome:

| Step | Result |
|---|---|
| Plain copy, `npx expo export --platform web` | export fails: `Unable to resolve module ./wa-sqlite/wa-sqlite.wasm` |
| `wasm` added; served without isolation headers | crash screen; `ReferenceError: SharedArrayBuffer is not defined` |
| Served with the headers | crash screen; `Error: Sync operation timeout` (`openDatabaseSync`) |
| `WebStorageGate` around the root layout | next: `Appearance.setColorScheme is not a function`, `AccessibilityInfo.isBoldTextEnabled is not a function` |
| Both behind `Platform.OS === 'web'` checks | the Tasks screen renders; a task toggles; console warns `expo-file-system is not supported on web` |
| `.web.ts` for the file-system adapter, headers in the expo-router plugin, this skill's templates | `check-web-support.mjs` PASS, `check-web-export.mjs --browser auto` PASS, console empty |
| A second tab | "open in another tab" (the gate's `inUseElsewhere`) |
| Planted bug: `warmUp={null}` | `web-sqlite-warm-up` FAIL; the browser smoke FAILs `browser-console` (`Sync operation timeout`), `browser-exception`, `browser-testid` |

Repeated on 2026-10-16 with every template of this skill, the layout of sqlite-on-web.md section 4,
`syncDocumentLanguage` in `I18nProvider`, the screen-reader and bold-text reads guarded, and
`contracts/rtl.json` `gateWrappers`:

| Step | Result |
|---|---|
| `check-web-support.mjs`, export, `check-web-export.mjs --browser auto` (with `--lang=ar`) | PASS, PASS, PASS |
| The `setColorScheme` guard written as `Platform.OS === 'ios' \|\| Platform.OS === 'android'` | PASS |
| The guard removed | `web-rn-api` FAIL at `theme-provider.tsx:45` |
| `syncDocumentLanguage` removed | `browser-direction` FAIL: `dir="rtl" lang="en"` |
| COEP `credentialless` in the expo-router headers | `web-sqlite-setup` FAIL; after export `export-headers` FAIL and "browser smoke not run" |
| DirectionGate outermost, the gate inside it | `browser-exception` with `--lang=ar`: hydration error #418 (why the gate is outermost) |

Every rule of `check-web-support.mjs` fired on the plain copy except the ones its set-up made moot, and
each problem it named was one the browser showed.

**Other skills' checkers on that copy** pass, except the lines below that wait for their owners to
exempt web files (the code is right; the rules predate the web build). persistence-and-migrations'
`sqlite-outside-data` already accepts the browser's `localStorage` in `src/i18n/direction.web.ts`
(its self-test case `pass-web-direction-local-storage`); the other two remain:

- design-system-structure `check-raw-values` `no-palette-import` at `src/app/+html.tsx`: the root HTML
  runs in Node outside every provider and paints both schemes from the palette.
- rtl-and-direction `check-rtl` `reload-outside-direction` at `src/i18n/direction.web.ts`: the file is
  the web build's direction module, guard first, then the flip, then one reload.

## 7. What the checkers cannot see

- Browser globals read during render inside a component (not at module scope) under static output: the
  export or the browser smoke shows them.
- Behaviour that differs without failing (hover-only actions, `Space` on a checkbox): the checks by
  hand. (`isScreenReaderEnabled` answering `true` is a wrong member `web-rn-api` fails.)
- A package the table does not know: add it to `nativeOnlyPackages` once measured.
- Dynamic imports and `require` with a computed name are not followed.
- `web-rn-api` reads member uses written as `AccessibilityInfo.isBoldTextEnabled(...)` (also through a
  namespace import or an alias). A destructured member (`const { isBoldTextEnabled } = AccessibilityInfo`),
  a member passed around by reference, and a guard it cannot evaluate (`switch (Platform.OS)`, a flag
  such as `const isNative = Platform.OS !== 'web'` used later) are not seen: a destructured use is
  missed, and a use behind an unreadable guard is reported. `Platform` imported under another name
  (`import { Platform as P }`) is not read as a guard either: keep the name `Platform`. Write the call and its `Platform.OS` check
  in the shapes of rn-api-gaps.md section 6, or move the code into a `.native` file.
- The guards are read as written, not proven: a `Platform.OS === 'ios'` check guards on the web even if
  the code after it would also break on Android.

## 8. Debugging a web crash

- Export with `--dev` for an unminified bundle: React's minified errors ("Minified React error #520")
  become messages with component stacks.
- The crash screen means the error boundary caught something: the first `console.error` in the smoke's
  output is the cause, the boundary's report follows it.
- `npx expo start --web` and the browser's DevTools show the worker (`worker-<hash>.js`), the wasm request
  and the response headers; `self.crossOriginIsolated` in the console answers the isolation question.
