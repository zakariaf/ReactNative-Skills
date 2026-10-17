# The variant matrix

What the three variants are, what each one changes in the app, and how a variant reaches the binary on
iOS and Android. Verified on 2026-10-03 with Expo SDK 57 (expo 57.0.26), React Native 0.86.3 and Node
26.4; re-verify with `npx expo config --type public` per variant (commands below) after an SDK move.

## Contents

- The three variants
- Why one variable and one resolver
- Identity per variant: ids, names, schemes
- Icons per variant
- Services keyed by the app id
- EAS commands that read the config outside a build
- How a variant enters the binary (iOS and Android)
- Switching variants locally
- Seeing the variants side by side
- Decisions and their reasons

## The three variants

| | development | preview | production |
|---|---|---|---|
| Purpose | daily work with Metro and the dev client | internal testing of a release build | the App Store and Google Play |
| EAS profile and EAS environment | `development` | `preview` | `production` |
| Build type | Debug, `developmentClient: true` | Release, `distribution: "internal"` | Release, store distribution |
| App id (iOS and Android) | `<base>.dev` | `<base>.preview` | `<base>` |
| Home-screen name | `Tasks (Dev)` | `Tasks (Preview)` | `Tasks` |
| Icon | badged | badged differently | the store icon |
| URL scheme | `tasks-dev` | `tasks-preview` | `tasks` |
| Dev client `exp+<slug>` scheme | registered | not registered | not registered |
| Test-only code (debug menu, hooks) | compiled in | compiled in | compiled out |
| `__DEV__` in the bundle | true while Metro serves a debug bundle | false | false |

The table in code is `variantIdentity(BASE, variant)` from `src/config/app-variant.ts`; the icons live
in `app.config.ts` (`iconsFor`). The variant names match EAS's three built-in environments, so one word
names the profile, the EAS environment and the app variant.

## Why one variable and one resolver

Two processes read the variant, and they never share memory:

- **The config process** evaluates `app.config.ts` and reads `APP_VARIANT`. It decides the id, name,
  icons, scheme and plugins.
- **Metro** transforms the JS and inlines `process.env.EXPO_PUBLIC_APP_VARIANT` into the bundle. It
  decides whether test-only code is in the bundle and what `currentAppVariant()` returns.

`app.config.ts` cannot hand its variant to Metro (Metro runs later, often in a native build phase
with its own environment), so every build exports both variables with the same value and
`resolveAppVariant` throws when they differ. Its full contract:

| Environment | Result | Why |
|---|---|---|
| both set, equal, a known name | that variant | the normal build |
| a name outside development, preview, production | throws `APP_VARIANT=staging is not one of ...` | a typo never builds the store app |
| only one of the two set, or two different values | throws `... must equal ...` | the native app and its JS bundle would disagree |
| both unset, `NODE_ENV=production` | throws `... are not set ...` | `npx expo export` (every platform, `--platform web` for API routes too), `eas update` (which runs it) and `npx expo start --no-dev --minify` set `NODE_ENV=production`; an update without a variant would ship development code to users |
| both unset, `EAS_BUILD=true` | throws | an EAS profile that forgot its env |
| both unset otherwise | `development` | `npx expo start`, `expo config`, `expo-doctor` and knip work without setup; so do `eas submit` and `eas metadata:push`, which then see the development id (see "EAS commands that read the config outside a build") |

Verified on 2026-10-03 in the reference app: `npx expo config` evaluates the config with
`NODE_ENV=development`; `npx expo export` evaluates it once with `NODE_ENV` unset and then several
times with `NODE_ENV=production`, and the export failed with the "are not set" error when neither
variable was set (not run: `eas update`, documented to run `expo export`, and the release bundling
inside native builds, `expo export:embed`, are expected to behave the same; no EAS account or native
build was used). `npx expo start --no-dev --minify` failed the same way (verified 2026-10-03): the
start command runs `setNodeEnv(!args['--no-dev'] ? 'development' : 'production')` (read in
`@expo/cli` 57.0.27 `build/src/start/index.js`; re-verify with
`grep -n "setNodeEnv(" node_modules/expo/node_modules/@expo/cli/build/src/start/index.js`). knip calls
the config function with a dummy context (read in knip 6.38's Expo plugin), which is why an unset
variant is not an error everywhere.

## Identity per variant: ids, names, schemes

- **One id per variant for both platforms.** `ios.bundleIdentifier` and `android.package` get the same
  value. iOS allows letters, digits, hyphens and dots. Android needs at least two dot-separated
  segments of letters, digits and underscores, each starting with a letter, and no segment may be a
  Java keyword or literal (`new`, `case`, `class`, `true`, ...): that is Expo's own validator
  (`validateApplicationId` in `@expo/cli` 57.0.27, regex `^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$`
  plus the keyword list), and `check-variants` applies the same rules. Uppercase is valid but lowercase
  is the convention on both stores, so the safe intersection is lowercase letters and digits:
  `com.example.tasks`, `com.example.tasks.dev`.
- **Development and preview extend the production id by one segment.** The variant is visible in the
  id, sorting keeps the three together in device settings and store consoles, and a store record for
  `com.example.tasks` never collides with a test build. Keep every variant's id distinct: other skills
  rely on it, for example admob-ads-and-consent turns ads off when an OTA update's config names
  another id than the binary's own (`readAdsExtraForBinary`), which catches an update published with
  the wrong variant's environment only while no two variants share an id.
- **Names are what a tester sees.** iOS truncates long home-screen names, so the marker goes at the
  end in a short form: `Tasks (Dev)`.
- **Schemes are per variant.** When two installed apps register one scheme, iOS opens one of them and
  does not define which; Android resolves the link like any implicit intent with several matching
  activities and shows a chooser so the user picks the app (unless a default was set).
  `expo-dev-client` adds a second scheme, `exp+<slug>`, used by QR
  codes and `npx expo start` links; the template turns it on only for development
  (`addGeneratedScheme: variant === 'development'`, from Expo's "install app variants on the same
  device" guide).
- **`slug` stays the same.** One EAS project serves all three variants.

`check-variants` evaluates the config for each variant and fails on a missing, invalid, shared or
non-derived id (`variant-id`), equal names or a production name with a testing marker (`variant-name`),
and a scheme two variants share or the dev-client scheme outside development (`variant-scheme`).

## Icons per variant

A badged icon is the fastest way to tell builds apart on a home screen, in a screenshot and in a
crash report. The template points each variant at its own folder (`iconsFor` in `app.config.ts`):

```
assets/icons/production/icon.png                 the store icon, 1024 x 1024 (fallback; Android legacy icon)
assets/icons/production/expo.icon/               the Icon Composer icon (iOS 26), when the app has one
assets/icons/production/android-foreground.png   adaptive icon layers, from the app's
assets/icons/production/android-background.png     android-icon-*.png files, renamed
assets/icons/production/android-monochrome.png     (Android 13+ themed icon)
assets/icons/development/icon.png                badged: an amber band (iOS and the fallback)
assets/icons/development/android-*.png           the same three layers, badged
assets/icons/preview/...                         the same four files, a violet hatched band
```

- iOS reads `ios.icon` (a PNG, an object with light, dark and tinted PNGs, or an Icon Composer
  `.icon` folder) and falls back to `icon`. Production keeps the app's `.icon` folder
  (`STORE_IOS_ICON = 'expo.icon'`, or `'icon.png'` when the app has none); development and preview
  use their badged `icon.png` (the script badges PNG files, not Icon Composer layers).
- Android reads `android.adaptiveIcon` (`foregroundImage`, `backgroundImage`, `monochromeImage`,
  `backgroundColor`) and falls back to `android.icon`, then `icon`. Keep the app's `backgroundImage`
  and `backgroundColor`: dropping either changes the production icon.
- The SDK 57 template ships `assets/images/icon.png`, `assets/expo.icon/` and
  `assets/images/android-icon-{foreground,background,monochrome}.png`; Workflow step 2 moves them into
  `assets/icons/production/` under the names above, so production stays byte-for-byte the same icon.
- `make-variant-icons.mjs` (this skill's `scripts/`) writes the development and preview copies from
  those files with zero dependencies: a band across the lower part, inside the adaptive-icon safe zone
  (19 % to 81 % of the canvas), solid amber for development and violet with white hatching for preview,
  so the two differ without colour too. Android 13+ themed icons draw `android-monochrome.png` from
  its alpha channel alone, so on that layer the preview hatching is cut out of the band (transparent
  stripes): the masks differ, and the script checks it (`icon-badge`). Kept files from an older run
  with one mask get a `note:`; `--force` redraws them. It refuses a source that is not a square, non-interlaced PNG,
  or an `icon.png` under 1024 x 1024. `icons-app-icon-and-splash` may redraw the badges at the same
  paths.

`variant-icon` fails when an icon file a variant names does not exist (Expo's icon plugins read every
one during prebuild, so a missing file stops `npx expo prebuild` and every EAS Build with ENOENT), when
a testing variant uses the production descriptor for a platform, and when its files are
byte-identical copies of the production files.

## Services keyed by the app id

Each of these is registered per id. A `.dev` or `.preview` build talks to its own registration, or
the feature is tested on a production-id build (TestFlight internal testing, a Play internal track):

| Service | Keyed by | What to do |
|---|---|---|
| In-app purchase products | the App Store Connect app record, the Play listing | test purchases on production-id internal builds, or with StoreKit configuration files and Play license testers (`in-app-purchases`) |
| Push (APNs, FCM) | bundle id, Android package (google-services.json) | one Firebase app per id, or push tested on production-id builds (`push-notifications`) |
| Sign in with Apple, Google sign-in | bundle id, package plus signing certificate | register each id (`auth-and-secure-storage`) |
| Universal links and app links | AASA `appIDs`, assetlinks `package_name` | list every id that should open links (`deep-links-and-universal-links`) |
| AdMob | AdMob app per platform | test ad units outside production (`admob-ads-and-consent`) |
| Crash reporting | release and environment names | `<id>@<version>+<build>` separates them (`crash-reporting-and-observability`) |
| App Groups, iCloud containers, keychain access groups (iOS entitlements) | identifiers registered per app id, conventionally `group.<id>`, `iCloud.<id>`, `$(AppIdentifierPrefix)<id>` | derive them from `variantIdentity(BASE, variant).appId` in `app.config.ts` (`ios.entitlements`) or in the config plugin that adds them, and register each variant's identifiers; a hard-coded production group gives the dev build no access (or the store app's data) |
| App extensions: widgets, share extensions, notification service extensions | an extension's bundle id must start with its containing app's id (Xcode refuses to embed one that does not) | build the extension id from the variant's app id (`<appId>.widget`) in the extension's config plugin, never from the production literal |
| Firebase (`google-services.json`, `GoogleService-Info.plist`) | each file lists the package or bundle id it was made for; the Google services Gradle plugin fails with "No matching client found for package name" when the variant's id is missing | one Firebase app per id; choose the file per variant: `android.googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './firebase/google-services.json'` with an EAS file variable per environment (`eas env:set --type file`), or a file that lists every variant's id |

## EAS commands that read the config outside a build

`eas build` applies the profile's `env` before it evaluates `app.config.ts`, so the profile's variant
decides the id. Commands that are not builds do not, and with nothing exported the resolver returns
`development` (read in eas-cli 24.10.0; re-verify with
`npm pack eas-cli@24.10.0 && tar -xzf eas-cli-24.10.0.tgz` and the files named here):

| Command | What it evaluates the config with | Consequence |
|---|---|---|
| `eas submit --profile production` (standalone) | no profile env: `build/commands/submit.js` says "this command doesn't make use of env when getting the project config" | the iOS bundle id for the App Store Connect lookup (`AppProduce.js`) and the Android `applicationId` come from the config unless the submit profile pins them: `com.example.tasks.dev` |
| `eas build --auto-submit` | the build's own id, passed to the submission | correct |
| `eas metadata:push` / `metadata:pull` | the plain project config, no profile env | the development app record |
| `eas credentials` | asks for a build profile and applies its `env` (`credentials/manager/ManageIos.js`, `ManageAndroid.js`) | correct when the profiles set the variant (they do) |

So run a standalone `eas submit` or `eas metadata` with the pair exported
(`APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production eas submit --profile production`), and pin
the store ids in the submit profile: `submit.production.ios.ascAppId` (or `bundleIdentifier`) and
`submit.production.android.applicationId`. `eas-build-and-submit` owns submit profiles;
`check-variants` prints a `note:` line when `submit.production` pins neither.

## How a variant enters the binary (iOS and Android)

The variant reaches a native build at three moments, each in its own process:

1. **Prebuild** evaluates `app.config.ts` and writes the native projects (bundle id, name, icons,
   schemes, plugin output).
2. **The embedded config step** evaluates `app.config.ts` again during the native build and writes the
   public config the app reads through `expo-constants`: on iOS the build phase "Generate app.config
   for prebuilt Constants.manifest" (`EXConstants.bundle/app.config`), on Android the Gradle task
   `createExpoConfig` at `preBuild` (from `expo-constants/scripts/get-app-config-android.gradle`,
   read in the SDK 57 package source).
3. **The JS bundling step** runs Metro (`expo export:embed`), which inlines `EXPO_PUBLIC_*`.

On EAS, the profile `env` and the EAS environment apply to the whole job, so all three moments see
the variables. Each of them loads `.ts` files with Node's type stripping (`app.config.ts` imports
`src/config/app-variant.ts`, `metro.config.js` requires `scripts/metro/public-env-cache-version.ts`),
so the build machine needs **Node 22.18 or newer**. The SDK 57 EAS images ship Node 22.23.1 (SDK 55
images shipped 20.19.4; read on docs.expo.dev/build-reference/infrastructure, 2026-10-03), so the
default works; an eas.json profile, often a shared `base`, that still pins an older `"node"` fails when
Metro loads its config, and `check-variants` reports it (`eas-profile`). In a local build the shell must keep both variables exported from prebuild to the end
of `xcodebuild` or `gradlew` (`ios-simulator-build` and `android-emulator-build` own those commands).
A shell that loses them mixes variants; `resolveAppVariant` then throws during the embedded config
step instead of producing the mix.

## Switching variants locally

`ios/` and `android/` are generated and git-ignored (Continuous Native Generation). They keep the
variant they were generated for, and `npx expo run:ios` compiles an existing native folder as it is
(Expo's variants guide). Switch with the same two variables on both commands:

```sh
APP_VARIANT=preview EXPO_PUBLIC_APP_VARIANT=preview npx expo prebuild --clean
APP_VARIANT=preview EXPO_PUBLIC_APP_VARIANT=preview npx expo run:ios --configuration Release --device <udid>
```

## Seeing the variants side by side

```sh
for v in development preview production; do
  APP_VARIANT=$v EXPO_PUBLIC_APP_VARIANT=$v npx expo config --type public --json \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(c.name,c.ios.bundleIdentifier,c.android.package,c.scheme)})'
done
# Tasks (Dev) com.example.tasks.dev com.example.tasks.dev tasks-dev
# Tasks (Preview) com.example.tasks.preview com.example.tasks.preview tasks-preview
# Tasks com.example.tasks com.example.tasks tasks
```

On devices, list what is installed on a named device only:

```sh
adb -s <serial> shell pm list packages com.example.tasks
xcrun simctl listapps <udid> | grep com.example.tasks
```

## Decisions and their reasons

| Decision | Reason | Alternative kept |
|---|---|---|
| `development`, `preview`, `production` | the EAS convention: one word for profile, EAS environment and variant | — |
| Distinct ids per variant | side-by-side installs; a test build can never overwrite the store app | one id with a TestFlight-only flow, when every tester only ever uses store-track builds |
| Unset is development locally, an error for production bundles and EAS | local tools run without setup; anything that ships names its variant | fail-closed everywhere: make `resolveAppVariant` throw when unset (`check-variants` accepts both). The cost of the default: EAS commands outside a build need the pair exported |
| Two variables, equal | the config process and Metro are separate processes | — |
| No `app.json` beside `app.config.ts` | Expo passes it in as the config context and its values leak into every variant | — |
| Variant read in app code from the inlined variable | it is the only source that can strip code; `extra` would be a second truth | — |
| No `null` in `extra`; omit the key | `null` values arrived as `{}` in `npx expo config --json` and in the embedded config `expo-constants` reads, and a strict parser threw at launch (verified in the source app on the iOS simulator, an earlier SDK; not re-run on SDK 57 or Android) | — |
