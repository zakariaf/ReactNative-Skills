# expo-sqlite on the web

What it takes for the canonical data layer (synchronous `SqlDriver`, kv-store preferences) to run in a
browser, every step verified on 2026-10-14 with expo-sqlite 57.0.3 in headless Chrome against an export
of a canonical Tasks app. Web support is **alpha** in expo-sqlite's own documentation; test the web
build on every SDK upgrade. Re-verify: export, then
`node ${CLAUDE_SKILL_DIR}/scripts/check-web-export.mjs . --browser auto` and the two-tab check in
testing-web.md.

## Contents

- 1. How it works on the web
- 2. The wasm asset
- 3. Cross-origin isolation
- 4. Synchronous calls and the warm-up
- 5. One tab at a time
- 6. Persistence and eviction
- 7. kv-store and localStorage
- 8. What isolation costs
- 9. The failure ladder

## 1. How it works on the web

expo-sqlite's web module (`build/ExpoSQLite.web.js` to `web/SQLiteModule.ts`) starts one Web Worker
(`new Worker(new URL('./worker', location.href))`) that runs wa-sqlite compiled to WebAssembly. The
database files live in the origin private file system through an `AccessHandlePoolVFS` (exclusive sync
access handles); `:memory:` databases use a `MemoryVFS`. Asynchronous calls post a message and await
the answer. Synchronous calls post a message and **spin** on a `SharedArrayBuffer` lock until the
worker answers (`web/WorkerChannel.ts`, `invokeWorkerSync`).

## 2. The wasm asset

The worker imports `./wa-sqlite/wa-sqlite.wasm`. Metro's default `assetExts` has no `wasm`, and the web
export fails:

```
Unable to resolve module ./wa-sqlite/wa-sqlite.wasm from .../expo-sqlite/web/worker.ts
```

Fix: `module.exports = withWebSqlite(config)` in `metro.config.js`
(`templates/scripts/metro/web-sqlite-metro.ts`; metro.config.js itself belongs to
app-variants-and-environment, so the change is one `require` and one wrap). The export then holds
`assets/.../wa-sqlite.<hash>.wasm` (`export-wasm` checks it).

## 3. Cross-origin isolation

`SharedArrayBuffer` exists only on a cross-origin isolated page, which needs two response headers on
the HTML:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

**`require-corp`, not the `credentialless` Expo's expo-sqlite page shows.** WebKit (Safari, and every
browser on iOS) does not support `credentialless` (MDN browser-compat-data 8.1.6, verified 2026-10-16:
safari and safari_ios `false`; `require-corp` since Safari 15.2, Chrome 83, Firefox 79), so with it an
iPhone visitor's page is not isolated: no `SharedArrayBuffer`, and the gate shows its "unsupported"
notice instead of the app. The warm-up template's note records the same in WebKit 27.2: `require-corp`
isolated the page and the app ran. `web-sqlite-setup` and `export-headers` fail `credentialless`;
section 8 is what `require-corp` costs.

Without them the first synchronous call fails and the app shows its crash screen (measured:
`ReferenceError: SharedArrayBuffer is not defined` at `invokeWorkerSync`). Three places send them:

| Where | How |
|---|---|
| `npx expo start --web` | `withWebSqlite` adds both in Metro's `enhanceMiddleware` |
| EAS Hosting | the expo-router plugin: `['expo-router', { headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS } }]` from `scripts/metro/web-sqlite-metro.ts`, or the two literals (`'Cross-Origin-Embedder-Policy': 'require-corp'`, `'Cross-Origin-Opener-Policy': 'same-origin'`). Export writes them into `dist/_expo/.routes.json` **only for `static` and `server` output**; a `single` export writes no manifest (measured), so EAS Hosting cannot send them |
| Any other host | the host's headers file or server config (hosting-and-headers.md) |

**Only in a secure context.** Browsers apply the two headers, and expose `SharedArrayBuffer` and the
origin private file system, only on `https` or `localhost`. The same export opened over plain http on a
LAN address (`http://192.168.x.y:8081/` from a phone, `http://10.0.2.2:8081/` from the Android emulator)
is not isolated and shows the gate's "unsupported" notice (measured in headless Chrome on 2026-10-16:
`crossOriginIsolated` true on `http://localhost`, false on a LAN IP with the same headers). Test on a
device through `localhost` (`adb -s <serial> reverse tcp:8081 tcp:8081`) or over https
(testing-web.md section 5).

`browser-isolation` in the export check reads `self.crossOriginIsolated` in the served page.

## 4. Synchronous calls and the warm-up

Even when isolated, the **first** synchronous call times out: the spin loop gives up after a fixed
number of iterations (`Atomics.pause` one million times in Chrome), while the worker is still fetching
and compiling the wasm and opening the file systems (measured: `Error: Sync operation timeout` from
`openDatabaseSync`, then the crash screen). The canonical app makes synchronous calls on its first
render (the direction guard's `Storage.getItemSync`, the data layer's `openDatabaseSync`).

One asynchronous open before any synchronous call fixes it, because the worker initializes everything
once (`maybeInitAsync` loads wa-sqlite and both file systems on the first open of any database):

```ts
const database = await openDatabaseAsync(':memory:');
await database.closeAsync();
```

The skill ships this as a gate, not as entry-file code (the entry stays thin, architecture-and-boundaries):

- `src/data/expo-sqlite-warm-up-adapter.ts` (`createExpoSqliteWarmUpAdapter()` returns `null` on iOS and
  Android) and `.web.ts` (the asynchronous open above, after the tab lock of section 5);
- `src/data/open-device-web-storage.ts`: `openDeviceWebStorage()`, the composition-root seam the root
  layout calls once;
- `src/features/root-navigator/web-storage-gate.tsx`: renders nothing until the warm-up settles, then
  the app, `inUseElsewhere` (another tab holds the storage) or `unsupported` (the page is not
  cross-origin isolated, or the browser gives it no origin private file system); on iOS and Android it
  renders the children on the first render;
- `src/features/root-navigator/web-storage-notice.tsx`: what the gate shows instead of the app, one
  testID per reason (`web-storage.other-tab`, `web-storage.unsupported`).

**The order and the hand-off.** app-startup-and-bootstrap owns the root layout and its startup order,
in which `DirectionGate` is the outermost element and only its child (`AppRoot`) opens storage. A web
build adds one step outside it: **`WebStorageGate` outermost, `DirectionGate` directly inside it.** Two
measured reasons:

- DirectionGate's first render reads the direction guard (`Storage.getItemSync`, a synchronous
  expo-sqlite call), which times out before the warm-up.
- With `static` output the layout also renders in Node at export time, where the gate renders nothing.
  The gate renders nothing on the browser's first render too, so hydration matches. With DirectionGate
  outermost instead, a right-to-left visitor's first render is the restart screen while the static
  HTML holds the left-to-right page: React throws hydration error #418 (measured on 2026-10-16 with
  Chrome `--lang=ar`; `browser-exception` fails it).

On iOS and Android `warmUp` is null, the gate renders its children on the first render and its effect
does nothing, so the native order and behaviour are unchanged. Two consequences for the other skills:

- **rtl-and-direction's `direction-before-render`** fails anything with effects around DirectionGate
  (a restart would repeat them). The web's restart is a page reload, which runs the warm-up again
  anyway, so list the gate in `contracts/rtl.json`, keeping the defaults:
  `"gateWrappers": ["Fragment", "React.Fragment", "GestureHandlerRootView", "SafeAreaProvider", "WebStorageGate"]`.
- **The root layout's own first render runs before the gate.** `useState(decideStartup)` creates
  adapters (no I/O, as app-startup-and-bootstrap requires), but a synchronous read the layout makes
  itself, such as settings-and-preferences' `readSavedLanguage(createKvSettingsStorageAdapter(...))`,
  reads kv-store before the warm-up. Give that adapter a `.web` sibling that keeps the settings text
  in `localStorage` (a preference, never a secret; settings-and-preferences owns the adapter):

  ```ts
  // src/services/settings-storage/kv-settings-storage-adapter.web.ts
  import type * as Native from './kv-settings-storage-adapter';
  // read and write the same text through localStorage.getItem / setItem, inside attempt(...)
  ```

  `web-sqlite-warm-up` fails a root layout that imports an adapter which reads expo-sqlite
  synchronously and has no `.web` sibling.

The root layout stays one component (`react/no-multi-comp`) and keeps `createDeviceServices` in its
state initializer (architecture-and-boundaries):

```tsx
const reportStorageError = (error: unknown): void => {
  appErrorNet.report({ source: 'render', error, isFatal: false });
};

export default function RootLayout(): React.JSX.Element {
  const [startup] = useState(decideStartup);
  const [storageWarmUp] = useState(openDeviceWebStorage);
  // handleGiveUp and handleGuardFailure as before
  return (
    <WebStorageGate
      warmUp={storageWarmUp}
      onError={reportStorageError}
      inUseElsewhere={
        <WebStorageNotice
          reason="in-use-elsewhere"
          titleKey="web-storage.other-tab.title"
          bodyKey="web-storage.other-tab.body"
          onMessageError={reportStorageError}
        />
      }
      unsupported={
        <WebStorageNotice
          reason="unsupported"
          titleKey="web-storage.unsupported.title"
          bodyKey="web-storage.unsupported.body"
          onMessageError={reportStorageError}
        />
      }
    >
      <DirectionGate
        language={startup.language}
        guard={startup.services.directionGuard}
        onGiveUp={handleGiveUp}
        onGuardFailure={handleGuardFailure}
      >
        <AppRoot services={startup.services} language={startup.language} />
      </DirectionGate>
    </WebStorageGate>
  );
}
```

The four catalog keys go into every catalog (i18n-strings-and-catalogs). Measured after the change
(2026-10-16): the Tasks screen renders in Chrome, also with `--lang=ar` (`<html dir="rtl" lang="ar">`),
and the console stays empty. `web-sqlite-warm-up` fails a web bundle that opens expo-sqlite
(synchronously or not) whose root layout does not return the gate as its outermost element.

## 5. One tab at a time

The persistent file system holds exclusive access handles, so a second tab of the app cannot open the
same database: measured, the second tab's `openDatabaseSync` throws and it shows the crash screen. The
web warm-up takes an exclusive Web Lock first (`navigator.locks.request('app-storage', { ifAvailable: true }, ...)`)
and holds it for the life of the page; a second tab gets no lock, touches no storage, and the gate shows
`inUseElsewhere` (measured: "open in another tab" in the second tab, the first tab unaffected). This
holds for an app that opens expo-sqlite only asynchronously too: the access handles are exclusive either
way, which is why `web-sqlite-warm-up` asks for the gate whenever expo-sqlite is in the web bundle. When the
first tab closes, reloading the second one takes the lock. The notice is the app's component with its
own copy (i18n-strings-and-catalogs); it renders outside the providers, like the crash fallback, so it
translates with `createTranslateNow`.

## 6. Persistence and eviction

Data survives reloads (measured: a kv-store counter and a table row count grew 1, 2 across a reload).
The origin private file system is still **best-effort storage**: `navigator.storage.persisted()` answered
`false`, so the browser may evict it under storage pressure, and clearing site data deletes it. Ask for
persistent storage once the person has data worth keeping (`navigator.storage.persist()`, in the web
adapter of a settings or backup feature; browsers grant it by their own heuristics), and offer
data-export-and-restore's export on the web.

## 7. kv-store and localStorage

- `expo-sqlite/kv-store` uses the same worker and the same rules (its synchronous calls need the warm-up).
- `import 'expo-sqlite/localStorage/install'` is a no-op on the web: the browser's own `localStorage` is
  used (persistence-and-migrations documents the install). Never put secrets there (module-support.md,
  `web-token-storage`).

## 8. What isolation costs

`Cross-Origin-Embedder-Policy: require-corp` blocks every cross-origin subresource that does not opt in.
A cross-origin image, script, font, stylesheet, video or iframe loads only when its response carries
`Cross-Origin-Resource-Policy: cross-origin` (or `same-site`), or when it is requested with CORS (the
`crossorigin` attribute) and answered with `Access-Control-Allow-Origin`. A blocked resource shows as a
failed request (`net::ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep` in
Chrome), which `browser-console` fails. What it touches in an Expo app:

- **Remote images** (`expo-image` or `Image` with an `https://` URL on another origin): the image server
  or CDN must send `Cross-Origin-Resource-Policy: cross-origin`, or serve CORS. Images bundled with the
  app (`require('@/assets/...')`) are same-origin and unaffected.
- **Fonts and scripts from a CDN**: same rule; self-host them in the export instead (Expo bundles fonts
  loaded with expo-font).
- **Iframes** (a video embed, a payment form, an ad): the framed page must send
  `Cross-Origin-Embedder-Policy` and `Cross-Origin-Resource-Policy` itself, which most third parties
  do not; expect them not to load.
- **`Cross-Origin-Opener-Policy: same-origin`** cuts the link to popups from other origins (some OAuth
  popup flows); use a redirect flow.

This departs from Expo's expo-sqlite documentation, which shows `credentialless` (cross-origin
resources load without cookies, no opt-in needed): that value leaves every WebKit visitor without
storage (section 3), which costs more than asking the few cross-origin hosts for a header. Test every
cross-origin feature in the isolated export before shipping (the browser smoke catches blocked
requests on the smoke routes; the checks by hand cover the rest). If one cannot work isolated, the web
build keeps its data elsewhere (a server through the `ApiClient`, networking-and-server-state) instead of
expo-sqlite.

## 9. The failure ladder

What each missing step looks like, in the order they appear:

| Missing | Symptom | Rule |
|---|---|---|
| `wasm` in `assetExts` | the web export fails: `Unable to resolve module ./wa-sqlite/wa-sqlite.wasm` | `web-sqlite-setup`, `export-wasm` |
| the isolation headers | crash screen; console `ReferenceError: SharedArrayBuffer is not defined` | `web-sqlite-setup`, `export-headers`, `browser-isolation` |
| a secure context (served over plain http on a LAN address, not `localhost` or https) | the "unsupported" notice although the headers are sent; `self.crossOriginIsolated` is `false` | none: serve on `localhost` (`adb reverse`) or https (section 3) |
| the warm-up gate | crash screen; console `Error: Sync operation timeout` | `web-sqlite-warm-up`, `browser-console` |
| the tab lock | the second tab: crash screen, `openDatabaseSync` throws | testing-web.md two-tab check |
