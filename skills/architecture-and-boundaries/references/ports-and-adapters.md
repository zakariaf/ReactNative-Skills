# Ports, adapters, fakes and the composition root

Every side effect sits behind a port; only its adapter touches the SDK; every port has an in-memory fake;
one composition root creates the adapters and hands them down. Read this before adding or changing a
service, an adapter or a fake, when a screen or store needs a service, or when a test needs to control one.

## Contents

- Why ports, and when not
- The anatomy of a port
- Expected failures are values
- Platform differences live in the adapter
- The ports this skill ships: clock and error log
- The composition root
- Injection rules
- Testing with fakes
- Work at import time
- Recipe: add a port
- What the checkers prove

## Why ports, and when not

- **Jest never touches native code.** Tests pass a fake; no `jest.mock()` of the app's own modules.
- **A vendor swap touches one file.** The SDK's types never leave the adapter.
- **Failure behaviour is decided once.** Offline, timeouts, a cancelled system sheet: the adapter maps each
  to a value the rest of the app handles.
- **The lint and checker bans exempt exactly the adapter files,** so an SDK cannot leak into a screen.

A port wraps what cannot run in Jest or must be controlled in tests: an SDK, a device API, the network,
storage, the wall clock. Pure logic gets **no** port: a function in `src/core` already runs in a test. An
interface around code that needs no seam is ceremony, and the checkers do not ask for one.

## The anatomy of a port

One folder per concern, `src/services/<concern>/`:

| File | Holds | Rule |
|---|---|---|
| `<concern>-port.ts` | the port type and its value types; vendor-neutral, no SDK type | `port-triple` requires it next to an adapter |
| `<library>-<concern>-adapter.ts` | `create<Library><Concern>Adapter(): <Concern>Port`; the only SDK importer | `vendor-sdk`, `adapter-import` |
| `fake-<concern>.ts` | `createFake<Concern>(options)`: in memory, scriptable, with counters for assertions | `port-triple` |
| `fake-<concern>.test.ts` | tests that the fake behaves like the port promises | `port-triple` |
| `<name>.ts` (optional) | a service: logic over the port, a small factory taking the port | |

The clock in `templates/src/services/clock/` is the finished example (port, system adapter, fake, both
tests). `templates/port/` holds the four files with placeholders for a new concern:

| Placeholder | Meaning | Example |
|---|---|---|
| `__CONCERN__` | the kebab-case folder | `clipboard` |
| `__PORT_NAME__` | the PascalCase port name without `Port` | `Clipboard` |
| `__VENDOR__` | the adapter's library prefix | `expo` |
| `__ADAPTER_PASCAL__` | the factory name between `create` and `Adapter` | `ExpoClipboard` |
| `__VENDOR_SDK__`, `__VENDOR_CALL__` | the SDK package and the call the adapter wraps | `expo-clipboard`, `getStringAsync` |
| `__QUERY__`, `__VALUE_TYPE__` | the port member and its value | `readText`, `string` |
| `__MAPPING_EXPRESSION__` | maps the SDK answer to the value | `answer` |
| `__SAMPLE_VALUE__` | a value for the fake's test | `'Buy milk'` |
| `__PORT_SUMMARY__`, `__QUERY_SUMMARY__` | TSDoc sentences | |

When the value is a `boolean`, give the test constant and any parameter a boolean prefix (`IS_ONLINE`,
`isConnected`), which the naming rule requires. Run Prettier on the filled files.

Two more homes count as adapters (the `adapterFiles` defaults):

- **The data layer's adapters** in `src/data/`: `*-sql-driver.ts`, `*-save-store.ts` and any
  `*-adapter.ts`, such as persistence-and-migrations' file adapter over `expo-file-system`
  (`src/data/expo-file-system-database-files-adapter.ts`; named without `-adapter`, the file is ordinary data code and
  its SDK import fails `vendor-sdk`). The data layer keeps its own driver and file ports there, and its
  device opener composes them.
- **A local Expo module** in `modules/<name>/` is an SDK the app wrote: its adapter
  (`src/services/<concern>/<module>-<concern>-adapter.ts`) is the only file that imports it, through the
  `@/modules/<name>` alias or by binding it by name inside the adapter
  (`requireOptionalNativeModule<T>('Name')` as the factory's default parameter: no alias, no lookup at
  import time, `null` in Jest, on web and in an older binary; native-modules-and-new-architecture), and
  the fake stands in for it in Jest exactly as for a vendor SDK. A native view from a local module
  reaches UI through the port too, as a component type (`readonly TaskChart: ComponentType<Props>`,
  with a plain `View` stand-in in the fake).

## Expected failures are values

Ports return expected failures as `Result` values (`src/core/result.ts`, owned by
error-handling-typed-results): `{ ok: true, value } | { ok: false, error }`, where `error` is a
kebab-case `kind` union, never a string or a thrown `Error`.

- An adapter catches every SDK error and maps it: `{ kind: 'unavailable', reason }`, `{ kind:
  'cancelled' }`, `{ kind: 'denied' }`. `attemptAsync(task, toFailure)` from `src/core/result.ts` wraps
  one vendor call and turns a throw (or a rejection) into the failure value, as the adapter template does.
- A call that can hang (network, a store sheet, a consent form) gets a timeout in the adapter that ends
  in a value (`{ kind: 'timed-out' }`); the app never waits on the network to continue.
- A port that only notifies (`record`, `play`, a haptic pulse) returns `void` and never throws.
- Programmer errors (a missing provider, an impossible state) still throw: they are bugs, not outcomes.

## Platform differences live in the adapter

iOS and Android differ in permissions, capabilities and SDK behaviour. The port states the one behaviour
both platforms give; the adapter absorbs the difference:

- `Platform.OS` branches, or platform files beside the adapter, live in the concern's folder, never in a
  feature. Platform files are named `<library>-<concern>-adapter.ios.ts` and
  `<library>-<concern>-adapter.android.ts` (or `.native.ts` / `.web.ts`); the composition root imports
  `@/services/<concern>/<library>-<concern>-adapter` and Metro picks the file for the platform. Both
  checkers treat them as adapters: they may import the SDK, only the composition root imports them, and
  their folder needs the port and the fake (`port-triple`). The canonical ESLint `ADAPTERS` globs name
  `*-adapter.ts` only; the lint config needs the platform globs too (typescript-and-lint-rules).
- A capability one platform lacks becomes a port member (`isSupported: boolean`), so the screen hides a
  row instead of checking the OS.
- Permission outcomes become kinds: Android's "don't ask again" and iOS's single prompt both map to
  `'blocked'`, a fresh refusal to `'denied'` (permissions-and-system-prompts owns the flow).
- Platform-only SDKs (App Tracking Transparency is iOS-only) still go through the port; the Android
  adapter answers `'unavailable'` without asking.

## The ports this skill ships: clock and error log

Both are canonical files of this library, used by persistence, dates and error-handling skills:

```ts
// src/services/clock/clock-port.ts
export type ClockPort = {
  readonly nowMs: () => number;               // epoch ms: timestamps, durations; never seeded logic
  readonly today: () => DateKey;              // local 'YYYY-MM-DD'; changes at local midnight
  readonly msUntilNextLocalDay: () => number; // 1 .. one local day (25 h when clocks fall back)
};

// src/services/error-log/error-log-port.ts
export type ErrorLogPort = {
  readonly record: (source: ErrorSource, error: unknown) => void; // never throws, never rejects
  readonly entries: () => readonly ErrorLogEntry[];               // newest first
};
```

`system-clock-adapter.ts` is the one app file allowed to read `Date` (the ESLint `CLOCK_ADAPTERS`
exemption); `createFakeClock` moves only when a test says so (`advance`, `setToday`).
`memory-error-log-adapter.ts` keeps the newest 200 entries of the session from the first line of startup
(its one `catch`, which turns an unprintable value into text, carries the `// best-effort:` marker
error-handling-typed-results' `check-error-spine` asks of an adapter that swallows a failure);
persistence-and-migrations adds a persistent adapter, and the composition root picks one. `ErrorSource`
is a union the app extends when a new boundary records errors (`render`, `global-handler`,
`unhandled-rejection`, `startup`, `storage`, `network`, `service`, `i18n`): the database records as
`storage`, the error net's global handlers as `global-handler`, `unhandled-rejection` and `render`. Skills
that need these ports sync the canonical files (never a local copy with a different union).

Other skills define their own ports with this anatomy (the names are theirs): `SqlDriver`
(persistence-and-migrations), `ApiClient` and `ConnectivityPort` (networking-and-server-state),
`PurchasePort` (in-app-purchases), `AdsPort` and `ConsentPort` (admob-ads-and-consent),
`CrashReporterPort` (crash-reporting-and-observability), `AudioPort` and `HapticsPort`
(audio-and-haptics-feedback).

## The composition root

The composition root is the one place that creates device adapters and wires them together:

- `src/services/services-context.tsx`: the `Services` type (every port the app uses), `ServicesProvider`
  and `useServices()`, which throws when the provider is missing (a programmer error).
- `src/services/create-device-services.ts`: `createDeviceServices(): Services` creates each adapter once.
  A new port adds one member to `Services` and one line here. The canonical factory takes no
  parameters; when an adapter needs a value known only at startup (settings-and-preferences hands the
  haptics adapter an `isEnabled` gate), the app's copy takes one options object and the root layout
  calls it as `useState(() => createDeviceServices({ haptics: { isEnabled } }))`.
- `src/services/create-test-services.ts`: `createTestServices(given)` returns the ports a test gives and,
  for every other member, a stand-in that throws on first use and names the missing port.

The canonical root ships three ports: `clock`, `errorLog` and `directionGuard` (rtl-and-direction's
restart guard on `expo-sqlite/kv-store`, which its `DirectionGate` reads before the first render; the
canonical stack has `expo-sqlite`, and the adapter does no I/O until the gate calls it). An app that
never shows a right-to-left language and follows rtl-and-direction's `directionSource: "device"`
profile may drop that member, its two factory lines and `src/services/direction-guard/`. Every other
port joins when the app adopts the skill that owns it (settings storage, connectivity, haptics, audio).

The canonical root stays at those three on purpose: the library cannot know which skills an app
adopts, and a member for a port the app does not use would need a fake and a test for nothing. The
adopting app edits its own copy: one member in `Services`, one line in `createDeviceServices`, one in
`createTestServices`, and the key in `create-device-services.test.ts`'s list. The members the skills
add, so names stay the same across apps:

| Members | Ports | Skill |
|---|---|---|
| `perf` | PerfPort | performance-budgets |
| `ads`, `consent`, `connectivity`, `fullscreenAd` | AdsPort, ConsentPort, ConnectivityPort, FullscreenAdGate | admob-ads-and-consent (`connectivity`: networking-and-server-state) |
| `secureStorage`, `installMarker`, `oauth`, `appleSignIn` | SecureStoragePort, InstallMarkerPort, OauthPort, AppleSignInPort | auth-and-secure-storage |
| `exportFiles`, `shareSheet`, `filePicker` | ExportFilesPort, ShareSheetPort, FilePickerPort | data-export-and-restore |
| `permissions` | PermissionsPort (`{ access, openSettings }`, built from per-kind adapters) | permissions-and-system-prompts |
| `updates`, `updateChecker` | UpdatesPort, UpdateChecker | ota-updates |

An adapter call that needs other members (ads wait for consent) stays inside the composition root,
through the owning skill's factory (`createAdsPort(...)`), so no other file imports an adapter.

**Root kits keep their ports out of `Services`.** Crash reporting (CrashReporterPort), analytics
(AnalyticsPort), local notifications (LocalNotificationsPort, LocalZonePort, the reminder sync) and
push (PushPort, PushRegistrationService) plug into app-startup-and-bootstrap's root slots: the app's
registry `src/services/create-root-kits.ts`, part of the composition root (it may import adapters),
creates each adapter once from `startApp` and hands it to the kit. Code that needs the port reads it
through the kit's own provider (`useAnalytics()`, `usePushServices()`, `useReminderSyncService()`),
which throws outside it like `useServices()`; tests wrap the code in that provider with a fake. So the
canonical `Services` stays the three ports and adding a kit edits one registry line, not the root.

The root layout calls `createDeviceServices` once, through a `useState` initializer, and wraps the
navigator in `ServicesProvider` (`examples/root-layout.tsx`). Both checkers hold it to that:

- Only the root layout (`src/app/_layout.tsx`), the composition root and tests import
  `create-device-services` (`adapter-import`): every call builds fresh adapters, so a feature hook that
  calls it re-creates the device on every render. A startup module the root layout calls goes into the
  contract's `compositionRoot`.
- Once `create-device-services.ts` exists, the root layout (or a file it imports) calls it as a lazy state
  initializer, `useState(createDeviceServices)`, `useState(() => createDeviceServices())`, or through a
  helper passed the same way (`useState(startApp)`), and renders `<ServicesProvider>` (`composition-root`).
  `useState(createDeviceServices())` and `useRef(createDeviceServices())` run the factory on every render.
  A helper imported from a startup file (`src/startup/start-app.ts`, recorded in `compositionRoot`) is held
  to the same form: `const app = startApp()` in the layout body is reported, `useState(startApp)` passes, and
  so does a startup component that calls `useState(createDeviceServices)` itself.
- `createTestServices` is test code like a fake (`fake-import`): its stand-ins throw in the app. Startup work around it (polyfills, opening
storage, hydrating stores, holding the splash screen) and its order belong to app-startup-and-bootstrap.
Keep adapter factories cheap and free of side effects: they only build an object, and start work on the
first call (under React's StrictMode, development calls a state initializer twice and keeps one result).

Stores are made by factories too (state-management-zustand): a stores factory receives what it reads
and writes through as arguments (`createStores({ tasks: data.tasks })`, the repositories the data layer
opened over the ports), and the root layout creates services, data and stores once, in that order.

## Injection rules

- A feature's model hook reads ports with `useServices()`; the screen gets plain values and callbacks.
- Stores and services receive ports as factory arguments: `createReminderService({ clock, notifications })`.
- Pure functions receive plain values: `nowMs: number`, `today: DateKey`, `seed: number`.
- Context carries dependencies (services, theme, locale), never state that changes; state lives in stores.
- Nothing imports an adapter except the composition root, tests and the test-only entry
  (`adapter-import`); no service locator, no module-level singleton that touches native code, no mutable
  module-level registry. The data layer is the one relief: its device opener `src/data/open-device-*.ts`
  (persistence-and-migrations' `open-device-database.ts`) is part of the composition root, so it creates
  the SQL driver, the file adapter and the adapters that need the open database (a SQLite error log in
  `src/services/error-log/`); the root layout calls it once, after `createDeviceServices()`. Any other
  `src/data/` file may import the data layer's own driver adapters (a read-only `peek-database.ts` opens its
  own connection); that relief is wider than it needs to be, so a repository that creates its own driver
  is the reviewer's to catch, or the app lists its openers in `compositionRoot` and keeps repositories on
  factory arguments.

## Testing with fakes

- A component or hook test renders through the test wrapper (unit-and-component-tests owns
  `renderWithProviders`), which puts `createTestServices({ clock: createFakeClock(...) })` into
  `ServicesProvider`. A port the test did not give throws on first use, so a test cannot silently depend
  on a device adapter.
- A store or service test passes fakes to the factory directly.
- Every fake has its own test (`port-triple`): every test that uses it relies on it behaving like the port.
- A fake never reaches runtime code (`fake-import`): a store built on `createFakeClock()` at module level
  ships a frozen clock to users. Only tests, `test/`, other fakes, `createTestServices()` and the
  test-only entry (with its `testOnlyFolders`) import fakes.
- Root `__mocks__/<package>.ts` exist only for vendor SDKs that crash when Jest imports them (for example
  `react-native-keyboard-controller` and `react-native-audio-api` in an Expo SDK 57 app with the canonical
  stack installed); they keep the
  import from crashing, while tests still talk to fakes.
- Adapters are thin enough to need little testing in Jest; a device-only adapter carries the
  `// device-only: covered by <the E2E flow or simulator check>` marker in its first lines so coverage
  leaves it out (unit-and-component-tests).

## Work at import time

A reload (`reloadAppAsync`, a right-to-left switch that restarts the app, a development reload) re-runs
every module on iOS and Android, and Fast Refresh re-runs edited modules and their importers. Work done
at module level therefore runs twice, and module-level state leaks between Jest tests. `import-time-work`
reports module-level code that opens a database (`openDatabaseSync`), creates an adapter, driver,
repository or the services (`create*Adapter(`, `create*Services(`), a store (`create` from `zustand`,
`createStore` from `zustand/vanilla`, or a project factory such as `createTasksStore()` or
`createStores()`), an `AudioContext`, switches the layout direction (`I18nManager.forceRTL`) or reloads
the app. Pure module-level values (constants, frozen tables) are fine, and so is an **OS mirror**: a
vanilla store whose initial state is a plain object literal, in a file that subscribes to a platform
event (`AccessibilityInfo.addEventListener`, `Appearance.addChangeListener`), like accessibility-as-code's
`src/ui/a11y/system-a11y-store.ts`. The operating system's state is global already, so its mirror may be
too, and it may sit beside the code it serves instead of in `src/stores/`. A polyfill installer that must
run on import goes into `importTimeExempt`.

## Recipe: add a port

1. Stop and ask before adding a new vendor SDK (an architecture decision); install it with
   `npx expo install <package>` (dependency-management). Until it is in `vendorSdks`, every import of it
   fails `unclassified-sdk`, the adapter's included.
2. Name the concern and copy `templates/port/` into `src/services/<concern>/`, filling every placeholder;
   keep the port vendor-neutral.
3. Write `fake-<concern>.ts` and its test first, then the service logic test-first against the fake.
4. Write the adapter: the only file importing the SDK; map every answer and error to the port's values;
   add timeouts where a call can hang; keep platform branches here.
5. Add the port to `Services`, one line to `createDeviceServices`, one line to `createTestServices`.
6. Add the SDK to `vendorSdks` in `contracts/architecture.json` and to `VENDOR_SDK_PATHS` in
   `eslint.config.mjs` (typescript-and-lint-rules, with a `Gate-Change:` trailer); add
   `__mocks__/<package>.ts` only if importing it crashes Jest.
7. If the SDK has a config plugin, add it to `app.config.ts` (expo-prebuild-and-config-plugins); if it
   talks to the network or collects data, update the privacy declarations (privacy-and-store-declarations).
8. Run `npm run lint`, `npm run typecheck`, the tests, and both checkers.

## What the checkers prove

| Rule | Checker | Catches |
|---|---|---|
| `port-triple` | check-layout | an adapter without `<concern>-port.ts`, without a `fake-*.ts`, or a fake without its test |
| `composition-root` | check-layout | adapters exist but no `create-device-services.ts` (or a contract-declared root); the root layout never calls it in a `useState` initializer, or never renders `<ServicesProvider>` |
| `import-time-work` | check-layout | the module-level work listed above (OS mirrors allowed) |
| `vendor-sdk` | check-boundaries | an SDK (or its subpath) or a local Expo module imported outside its adapter, or outside the only files allowed |
| `unclassified-sdk` | check-boundaries | an SDK (by name, or by the native code it ships) in neither `vendorSdks` nor `portlessSdks` |
| `adapter-import` | check-boundaries | an adapter (platform files included) imported by a feature, store, service or route; `create-device-services` imported outside the root layout and the composition root |
| `fake-import` | check-boundaries | a fake or `createTestServices` imported by runtime code |
| `banned-package` | check-boundaries | a package a port replaced, or one in the install policy's `doNotAdd` |
