# Layout direction: the decision, the restart and the guard

How an Expo app decides between left-to-right and right-to-left at startup, and how it changes
direction safely when the person picks another language. The code is in `templates/src/i18n/`
(`direction.ts`, `direction-plan.ts`, `direction-gate.tsx`, `direction-restart.tsx`,
`direction-context.tsx`) and `templates/src/services/direction-guard/`.

## Contents

- Facts the design rests on
- The modules
- The root layout: decide first, start the app after
- The three flows
- Text direction, layout direction
- Navigation follows the layout
- Roots outside the app's providers
- expo-localization: supportsRTL and forcesRTL
- Android specifics
- An app that only follows the device
- What is verified and what is not
- Appendix: React Navigation 7 (static API)
- When multi-package

## Facts the design rests on

- **`I18nManager.isRTL` is a constant for the whole JS run.** React Native reads the direction once
  when the module loads. Changing it takes `I18nManager.allowRTL(rtl)` **and**
  `I18nManager.forceRTL(rtl)` (both persist in native storage: `NSUserDefaults` on iOS,
  `SharedPreferences` on Android), then a reload of the JS bundle.
- **What React Native computes** (read in the React Native 0.86.3 source, `RCTI18nUtil.m` and
  `I18nUtil.kt`): iOS lays out right to left when RTL is forced, or when RTL is allowed (default:
  allowed) and the app's preferred localization is right to left. Android additionally needs
  `android:supportsRtl="true"` in the manifest (Expo's prebuild template sets it) and uses the
  device locale, not the app's supported locales. So a phone set to Hebrew running an app that
  ships only English and Arabic can open right to left on Android while the app shows English;
  the startup decision below repairs that.
- **`reloadAppAsync()` from `expo` reloads the same bundle** (it does not fetch an update; with
  EAS Update, `Updates.reloadAsync()` would also apply a downloaded update). Verified on
  2026-09-26 in a Release build on an iOS 26.5 simulator (Expo SDK 57, React Native 0.86.3):
  after `allowRTL(true) + forceRTL(true) + reloadAppAsync()`, `isRTL` was true, a row with
  `marginStart` mirrored, and the forced direction survived relaunch and reinstall.
- **Reloading while the bundle is still being evaluated crashed a Release build** ("startSurface
  failed. Global was not installed"). Reloading from a **mounted component** (an effect or a press
  handler) worked for both flips (same run).
- **Module code runs again after a reload**, so anything that writes at import time writes twice.
  The direction is therefore decided before any startup work with effects, and nothing in the app
  runs at import time (architecture-and-boundaries' `import-time-work`).
- `allowRTL(false)` is what keeps a left-to-right language left to right on a right-to-left phone;
  both calls are always made.

## The modules

| File | Job |
|---|---|
| `src/i18n/direction.ts` | The **only** module that touches `I18nManager` (the lint config exempts this file alone): `readLayoutDirection()`, `forceLayoutDirection(d)` (allowRTL + forceRTL), `restartForDirection(d, guard, beforeReload?)` (records the guard, forces, awaits the optional `beforeReload` hook, reloads; without the record it does not reload and returns the failure). The hook is where the caller that has the services closes native work before the bundle goes: an app with audio passes `() => services.audio.dispose()` (audio-and-haptics-feedback's `dispose-before-reload` rule asks for it). The reload follows the flip even when the hook rejects (the native flags are already set), and the rejection then reaches the caller. A platform sibling (`direction.web.ts`, web-support's) counts as the same module for `i18nmanager` and `reload-outside-direction` and keeps the same contract: the guard first, then the flip (on the web, `<html dir>`), then one reload. |
| `src/i18n/direction-plan.ts` | Pure `planDirection({ language, layout, pendingRestart })` → `keep` / `restart` / `give-up`. |
| `src/i18n/direction-gate.tsx` | `DirectionGate`: the root layout's first element; plans once (a state initializer), clears the guard on keep and give-up (a record it cannot clear goes to the required `onGuardFailure`, since a stale record can turn a later first flip into a give-up), reports a give-up once through `onGiveUp`, renders the app under `DirectionProvider` with the layout direction. Its optional `beforeReload` prop (`(() => Promise<void>) | undefined`, so a conditional value type-checks) goes through `DirectionRestart` to `restartForDirection`; an app with audio passes `() => services.audio.dispose()` from the root layout (examples/root-layout.md). |
| `src/i18n/direction-restart.tsx` | `DirectionRestart`: the restart root; flips from its effect, once per mount (a ref survives Strict Mode's replay), inside its own `TextLocaleProvider` and `DirectionProvider` for the language it restarts into. |
| `src/i18n/direction-context.tsx` | `DirectionProvider` / `useDirection()`: the layout direction for layout decisions (icon flips, coordinate maps). |
| `src/services/direction-guard/` | `DirectionGuardPort` (sync `readPending` returning the direction, `null` or `'unreadable'`, `writePending` returning a `Result`), the `expo-sqlite/kv-store` adapter (key `direction.pending-restart`, a small key-value database apart from the app's data) and the fake (canonical files of the library, owned by this skill and synced into architecture-and-boundaries, whose composition root creates the adapter). The adapter's test runs kv-store's real SQL on `node:sqlite` (`test/direction-guard/`). |

`planDirection`:

- the language's direction equals the layout → `keep`;
- the last reload was for this very direction and the layout still does not match → `give-up`:
  continue in the current layout and record it in the error log, never a restart loop;
- the guard cannot be read (`'unreadable'`) and the layout does not match → `give-up` with reason
  `guard-unreadable`: a guard the gate cannot read could not stop a flip that never takes, so the
  gate never restarts on it (a store whose reads fail while writes succeed would otherwise restart
  at every launch);
- otherwise → `restart`. This also repairs drift: a forced direction left by an older build, a
  device restore, the Android device-locale case above.

## The root layout: decide first, start the app after

With Expo Router the root layout (`src/app/_layout.tsx`) is the first component that renders, so it
is where the decision lives (examples/root-layout.md has both files, verified in the reference app):

1. `RootLayout` does only what the decision needs, in one `useState` initializer: the composition
   root (`createDeviceServices()`: adapters, no I/O, now with `directionGuard`), the saved language
   read synchronously (settings-and-preferences' storage is synchronous for exactly this reason),
   and `resolveLanguage(saved, getLocales())`.
2. It renders `<DirectionGate language guard onGiveUp onGuardFailure>` as its first element.
3. The gate's child, `AppRoot` (its own file, `src/features/root-navigator/app-root.tsx`), does the
   startup work with effects: the database open and migrations, the error net's sink, the stores,
   then the providers (services, data, i18n, theme, text locale) and the root Stack.

A JS run that is about to be replaced therefore opens nothing and writes nothing but the guard.

Never ship a language setting that calls `restartForDirection` while the root layout still passes
`null` for the saved language (the shape examples/root-layout.md ships until settings exist).
Choosing Arabic on an English phone reloads into right to left, the gate then resolves the device
language (`en`), sees the pending `'rtl'` differ from the wanted `'ltr'` and restarts again: two
restarts and the person's choice silently undone. Wire the saved language into the decision first.
`check-rtl` rule `direction-before-render` fails a root layout that renders no gate, any
startup call (`startupCalls`: `openDeviceData`, `openDeviceDatabase`, `openDatabaseSync`,
`openDatabaseAsync` by default) in the component that renders the gate, directly or through a
helper it calls (`useState(startApp)` with `startApp` opening the database), and any JSX element
around the gate in that component except the effect-free `gateWrappers` (default `Fragment`,
`GestureHandlerRootView`, `SafeAreaProvider`, and web-support's `WebStorageGate`: on the web the
restart is a page reload that runs the warm-up again, on devices it renders its children): `<SQLiteProvider onInit={migrate}>` around the gate
opens and migrates the database in a run that is about to restart. `StrictMode` is not a default on
purpose: around the gate it also wraps `AppRoot`, and React runs AppRoot's startup initializer twice
in development, opening the database twice; put Strict Mode inside AppRoot, around the root stack
(app-startup-and-bootstrap). A hook with
effects called in the deciding component (`useMigrations(db)`) is caught only when its name is in
`startupCalls`; add the app's own startup hooks there.

The Intl polyfills stay the first import of the app entry `index.ts` (i18n-strings-and-catalogs);
the error net stays the first import of the root layout (error-handling-typed-results). A launch
that flips direction is slower by design: performance runs label it and leave it out of the
cold-start budget.

## The three flows

| When | What happens |
|---|---|
| **Every startup** | The gate plans. `keep`: clear the guard, render the app. `restart`: render `DirectionRestart`, which flips once it is mounted (one extra frame, no dialog). `give-up`: clear the guard, render the app in the current layout, record the give-up. |
| **First-run language choice** | Choosing a language previews the text at once. **Continue** saves the choice (synchronous write, complete on return) and, when `directionOf(choice) !== readLayoutDirection()`, calls `restartForDirection(directionOf(choice), services.directionGuard)` from the press handler. After the reload the first-run flow sees the saved choice and continues. |
| **Settings → Language** | Selecting saves the language and switches the text at once. If its direction differs from the layout, ask with a dialog: title "Restart to apply", body "The layout direction changes after a quick restart. Your tasks are saved.", actions **Restart** (primary) and **Later**. Restart calls `restartForDirection`; Later keeps the current layout until the next cold start, where the gate fixes it. |

Always save **before** `restartForDirection`, finish or flush pending work (an async write queue,
an upload), and release native resources that do not survive a reload cleanly (stop audio, close a
camera session); call it only from a mounted component's handler or effect. The dialog's texts are
catalog keys like every other text.

`check-rtl` rule `reload-outside-direction` recognises a direction reload by words: a reload call
(`reloadAppAsync`, `Updates.reloadAsync`, `DevSettings.reload`) outside `direction.ts` whose reason
string, enclosing function name or file name mentions language, locale, direction, rtl or ltr. A
bare `reloadAppAsync()` after a language save in `use-settings-model.ts`, inside a function called
`apply`, passes it. Give every reload a reason (`reloadAppAsync('crash-recovery')`), keep language
handling in files and functions named for it, and when you review a reload, ask whether a
language or direction change can reach it: if so it must be `restartForDirection`.

System sheets (the permission prompts, the store purchase sheet, a consent form) follow the device
language, not the in-app choice; a person who picks Arabic on an English phone sees them in English.
Nothing in the app changes that; say so in the release notes if it matters.

## Text direction, layout direction

Two values, two jobs:

- **Layout direction** (`readLayoutDirection()`, `useDirection()`): what React Native mirrors rows,
  start/end keys and absolute start/end positions by, fixed for the JS run. Icon flips, navigator
  direction, coordinate maps and anything that computes positions follow it.
- **Text direction** (`TextLocaleProvider`'s `direction`, from design-system-structure): the base
  direction of a paragraph, from the language of the text, `directionOf(language)`. The app root
  passes `{ language, direction: directionOf(language) }`.

In the steady state they agree. They differ between a language change and the restart (Later), and
after a give-up: Arabic text then still reads right to left (its full stop at its own end) while the
layout stays left to right. Deriving the **layout** from the language is the bug `check-rtl` rule
`layout-direction` catches: the icons would flip while the rows do not.

## Navigation follows the layout

Expo Router's navigation container defaults its `direction` to `I18nManager.getConstants().isRTL`
(read in expo-router 57.0.24, `fork/NavigationContainer.js`), which is the layout direction: pass
nothing. Stack slides and the back gesture then follow the layout, and fade instead of slide when
reduce motion is on (accessibility-as-code). The back arrow is a directional icon (it flips).

## Roots outside the app's providers

A root that renders text outside the app's providers sets the text locale of its own language:
`<TextLocaleProvider value={{ language, direction: directionOf(language) }}>` around everything it
draws. Without it `AppText` falls back to the design system's default (`en`, left to right), so
Arabic text is laid left to right in the Latin line height. Three such roots exist:

- `DirectionRestart` (the template mounts it, with `DirectionProvider` too);
- the root layout's `ErrorBoundary` fallback: Expo Router renders it in place of the layout, so
  outside every provider the layout mounts (error-handling-typed-results' crash fallback). Its
  language is the one its copy is in: `languageNow()` from `src/i18n/translate-now.ts`, the
  language `createTranslateNow` reads (the one I18nProvider showed last, else the device's), never
  `resolveLanguage(null, getLocales())`, which disagrees with the copy once the person picked a language;
- anything the app lists in `contracts/rtl.json` `outsideRoots` (a second root, a custom splash).

`check-rtl` rule `root-direction-provider` finds the first two by itself and fails a root without
the provider. For the ErrorBoundary it follows only the `Fallback:` of `createRouteErrorBoundary`,
or the one component an `export function ErrorBoundary` returns, through its import. A boundary
that draws its own JSX (Expo Router's documented inline form, `({ retry }: ErrorBoundaryProps) =>
<View>…</View>`) is checked in the root layout itself and reported at its line; the text primitive,
the text-locale module and providers it renders are never followed as if they were the fallback. The `Fallback`
file itself must mount the provider, with one exception followed one level: when its only JSX is one
screen component imported from a local file (`CrashFallback` returning `<CrashScreen … />`), that
screen may mount it instead. A fallback that draws anything beside that screen, or a screen that
hands off again, keeps the provider in the `Fallback` file. The rule sees that a provider fed by
`directionOf(` is there, not which language feeds it: that the crash fallback reads `languageNow()`
(and the restart screen its target language) is a review item. The layout root
follows `readLayoutDirection()` for layout; a restart screen has no gap between text and layout,
because it is drawn for the language it restarts into. The verified failure behind the rule: a
restart splash with the theme but no direction drew a right-to-left tagline left to right, its full
stop at the wrong end of the second line.

## expo-localization: supportsRTL and forcesRTL

The plugin entry is `['expo-localization', { supportedLocales: { ios: LANGUAGES, android:
LANGUAGES } }]` (i18n-strings-and-catalogs builds it from the catalogs) and nothing about RTL.
Read in expo-localization 57.0.2's source (`LocalizationModule.swift`, `LocalizationModule.kt`,
the plugin) on 2026-10-10, not device-verified: `supportsRTL` and `forcesRTL` become `ExpoLocalization_*` entries in Info.plist and
Android string resources, and the native module applies them **at every launch, before React
loads**. `forcesRTL: true` forces right to left always, on both platforms. Otherwise:

- **iOS** (`setRTLPreferences`) sets `allowRTL(supportsRTL)` and `forceRTL(supportsRTL && the
  device's first language is right to left)`. `forcesRTL: false` takes the same path as
  `supportsRTL: true` (`setRTLPreferences(true, false)`), so it too re-derives the direction from
  the device language at every launch.
- **Android** (`setRTLFromStringResources`) only calls `allowRTL(supportsRTL)`; it never touches
  `forceRTL` unless `forcesRTL` is `"false"` (and `supportsRTL` is set), which forces left to right.
  So `supportsRTL: true` undoes an in-app left-to-right choice made on a right-to-left phone, while a
  forced right-to-left choice survives; `supportsRTL: false` disables right to left entirely.

Either way a flag overwrites some in-app choice made through `direction.ts` on the next launch,
which is why the rule bans both keys on both platforms. The plugin also reads both keys from the
config's `extra`, so `extra: { supportsRTL: true }` has the same effect. `check-rtl` rule
`expo-localization-rtl` fails either key in `app.config.*`, `app.json`, `plugins/` or the config
folder. Expo's localization guide describes these flags for apps that only follow the device; this
skill's default is an in-app choice (the settings store has a `language` field), which needs neither.

## Android specifics

- `android:supportsRtl="true"` must stay in the generated manifest (Expo's prebuild template has
  it; a custom template or config plugin that drops it disables right to left entirely).
- **Per-app language** (Android 13+): `supportedLocales` writes `locales_config.xml`, so the system
  Settings list the app's languages. By default the activity is **not** recreated when the person
  changes it there: expo-localization's plugin defaults `allowDynamicLocaleChangesAndroid` to true
  and adds `|locale|layoutDirection` to `MainActivity`'s `configChanges`, so the activity handles
  the change itself, the JS run continues, and `getLocales()` updates through expo-localization's
  locale-change event (`onLocaleSettingsChanged`). Setting the option to `false` makes Android
  recreate the activity instead; the JS run still continues. Either way `isRTL` stays what it was
  until the process restarts, and the gate fixes the layout at the next cold start: force-stop and
  relaunch before judging the layout (testing-rtl.md). Read in the expo-localization 57.0.2 plugin
  (`plugin/build/withExpoLocalization.js`) on 2026-10-10; not device-verified here. On iOS,
  changing the app's language in Settings terminates the app, so the next launch is a cold start.
- **System back and predictive back** work from both screen edges in every direction; the
  predictive-back preview follows the layout direction react-native-screens lays out.
- **Edge-to-edge** insets are physical: in landscape the navigation bar sits on a physical side.
  Take them symmetrically (`paddingInline: Math.max(gutter, insets.left, insets.right)`) or let
  `SafeAreaView edges={['left', 'right']}` apply them; never as style keys, neither start/end nor
  left/right (React Native swaps `paddingLeft` onto the start edge in a right-to-left layout).
- `reloadAppAsync()` with `forceRTL` on Android has not been device-verified in this library;
  check the restart flow on an emulator (testing-rtl.md) before the first Android release.

## An app that only follows the device

The default (`contracts/rtl.json` `directionSource` left out, or `"app"`) keeps the gate even in an
app with no language setting: it plans from the resolved language and repairs the cases the system
gets wrong. The system's own rule differs per platform (read in React Native 0.86.3's and
expo-localization 57.0.2's source, not device-verified):

- **iOS without an expo-localization RTL flag** lays out right to left when RTL is allowed (React
  Native's default) and the bundle's preferred localization is right to left, so it follows the
  languages the app declares (`supportedLocales` becomes `CFBundleLocalizations`): an `en` + `ar`
  app on a Hebrew iPhone runs in English, left to right.
- **iOS with `supportsRTL: true`** behaves like Android: expo-localization's `OnCreate` calls
  `forceRTL(the device's first preferred language is right to left)` at every launch, so the same
  `en` + `ar` app on a Hebrew iPhone lays its English out right to left.
- **Android** lays out right to left when RTL is allowed and the **device's** first locale is right
  to left, whatever the app declares: an `en` + `ar` app on a Hebrew phone falls back to English
  and still lays it out right to left.

An app that accepts that may declare `"directionSource": "device"`: it drops `direction.ts`'s
restart half, the gate and the guard (keep `readLayoutDirection()` / `useDirection()` as the one
reader) and sets **no** expo-localization RTL flag: React Native allows right to left by default.
`check-rtl` then prints a note instead of checking `direction-module` and
`direction-before-render`, tolerates `supportsRTL: true` (Expo's localization guide documents it,
but it only adds the Hebrew-phone case above on iOS) and still fails `forcesRTL`, which forces
right to left for every language. Every other rule (logical styles, text, roots outside the providers, mirroring, digits,
isolation) applies either way. Adding a language setting later means switching back to `"app"`
and copying the direction layer.

## What is verified and what is not

- Verified on iOS (iOS 26.5 simulator, Release, 2026-09-26): the reload from a mounted component,
  the crash when reloading during bundle evaluation, `forceRTL` persisting across relaunch and
  reinstall, `-AppleLanguages` launch arguments setting `getLocales()[0]`.
- Verified in Jest in a copy of the reference app (2026-10-10): every template and its test, the
  guard on kv-store's real SQL over `node:sqlite` (a failed read included), the gate's five paths
  with the global `expo.reloadAppAsync` spied.
- Read in source, not device-verified: everything Android above, expo-localization's flag handling
  and its Android plugin default, expo-router's navigation direction default.

Re-verify after an SDK upgrade: `grep -n "allowRTL\|forceRTL" node_modules/expo-localization/ios/*.swift node_modules/expo-localization/android/src/main/java/expo/modules/localization/*.kt`,
`grep -n -A18 "fun setRTLFromStringResources" node_modules/expo-localization/android/src/main/java/expo/modules/localization/LocalizationModule.kt`,
`grep -n -A8 "OnCreate" node_modules/expo-localization/ios/LocalizationModule.swift`,
`grep -n "allowDynamicLocaleChangesAndroid" node_modules/expo-localization/plugin/build/withExpoLocalization.js`,
`grep -n "direction =" node_modules/expo-router/build/fork/NavigationContainer.js`, then the
restart flow on one simulator and one emulator (testing-rtl.md).

## Appendix: React Navigation 7 (static API)

With React Navigation instead of Expo Router, the root is `App.tsx` (`check-rtl` uses it when the
routes folder holds no `_layout.tsx`; or set `contracts/rtl.json` `rootLayout`). Render `DirectionGate` there
the same way, and either pass nothing to `<Navigation />` (it defaults to `I18nManager`) or
`direction={readLayoutDirection()}`. Never `direction={directionOf(language)}` (rule
`layout-direction`).

## When multi-package

The direction module, gate and guard live in the Expo app's workspace (`apps/mobile/src/i18n/`);
a shared UI package reads `useDirection()` from it through props or its own context seam, never
`I18nManager`. Run `check-rtl` with `--app-dir apps/mobile`; paths in `contracts/rtl.json` are
relative to the app folder.
