# When multi-package: one game, one white-label app

Some studios ship each game as its own store app from one monorepo (npm workspaces `apps/*` and
`packages/*`): one shared code base, one app per game, each with its own name, bundle id, icon and
store listing. This page is that fenced variant. A single app that hosts several games needs none of
it: the game is a module in `src/games/<id>/` and the app's identity belongs to
app-variants-and-environment.

## Contents

- The apps block of contracts/games.json
- What the generator writes
- Why each file looks the way it does
- The composer
- Dependencies in lockstep
- Store identifiers and placeholders
- Adding the next app

## The apps block of contracts/games.json

```json
"apps": {
  "dir": "apps",
  "scope": "@acme",
  "bundlePrefix": "com.acme",
  "products": ["premium"],
  "locales": ["en", "ar"],
  "composer": { "import": "@acme/app-config/with-app-settings.ts", "name": "withAppSettings", "type": "AppSettings" },
  "fontsDir": "packages/brand/fonts",
  "adUnits": ["banner", "rewarded"]
}
```

| Key | Meaning |
|---|---|
| `dir` | the apps folder; the root `package.json` `workspaces` must include `<dir>/*` |
| `scope` | every app package is `<scope>/<game id>` |
| `bundlePrefix` | every app's iOS bundle id and Android package is `<bundlePrefix>.<id without hyphens>`; set once, never per app |
| `products` | in-app product suffixes, each product `<bundle id>.<suffix>` (`[]` when nothing is sold) |
| `locales` | the language tags every app has a catalog for |
| `composer` | the shared function in a package that turns one app's settings into the Expo config, and its settings type |
| `fontsDir` | optional: the shared font files and licence texts every app bundles byte for byte |
| `adUnits` | `null` without ads, else the unit names (`banner`, `interstitial`, `rewarded`, `appOpen`, `native`, `rewardedInterstitial`) |

Each game that is its own app has `"app": "apps/<id>"` in its entry; `scaffold-game.mjs --app` writes it.

## What the generator writes

```
apps/<id>/
  package.json        <scope>/<id>, private, main index.ts, dependencies copied from the other apps
  tsconfig.json       extends ../../tsconfig.base.json; "@/*": ["./src/*"]
  metro.config.js     cacheVersion keyed on the EXPO_PUBLIC_* values
  app.config.ts       export default <composer>(appSettings, process.env);
  app-settings.ts     id, appName per locale, bundleId, version, buildNumber, products, links, ads
  index.ts            a placeholder entry until the app's root layout exists
  .gitignore          /ios /android /build /dist /.expo (anchored)
  src/i18n/catalogs/<locale>.json   <id>.name and the lose keys (the approved copy wins)
  assets/fonts/*      every file of apps.fontsDir, byte for byte
```

The game itself then lives in `apps/<id>/src/games/<id>/`, built by the same skills in the same order
as in a single app; its registry is `apps/<id>/src/games/game-registry.ts`.

## Why each file looks the way it does

- **`metro.config.js` keys Metro's cache on the public variables.** Metro inlines every
  `EXPO_PUBLIC_*` value at transform time but leaves them out of its cache key, and the cache is
  shared by every build on the machine: a production export made after a development export reused
  the development transforms and shipped development-only code (verified on SDK 57;
  app-variants-and-environment owns the rule for the single app). Rule `metro-cache`.
- **`app.config.ts` is one statement.** Every native setting comes from the shared composer and its
  config plugins (Continuous Native Generation), so no app drifts: a fix to the composer reaches every
  app. The `.ts` extension on `./app-settings.ts` is required because Node loads the file with type
  stripping. Rule `app-config`.
- **`app-settings.ts` holds every per-app value; only `app.config.ts` reads it.** App code reads the
  runtime subset from `expo.extra` through one typed reader, never this file (it is Node-side config,
  and importing it would bundle store values into JavaScript). **No value is `null`**: a `null` in
  `expo.extra` reached the device as `{}` and broke a strict parser; leave the key out. Rules
  `app-settings`, `settings-null`.
- **`package.json` has no `"type"` field.** `metro.config.js` is CommonJS, and app code is not Node
  code. Rule `package-json`. Without the field, Node prints `MODULE_TYPELESS_PACKAGE_JSON` when
  tooling imports app code with type stripping; `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON`
  silences it (never add `"type"` instead).
- **`/ios` and `/android` are ignored, anchored.** Prebuild regenerates them: never edit or commit them.
  An unanchored `ios/` would also hide a local Expo module's `modules/<name>/ios/` source. Rule
  `gitignore`.
- **Fonts are byte-for-byte copies with their licence texts.** A different file changes the look, the
  text metrics in pixel goldens and the licence list in the about screen. Rule `fonts`.
- **`index.ts` is a placeholder** that registers an empty component, so a fresh app type-checks,
  lints and prebuilds while the game is built. When the root layout exists
  (`src/app/_layout.tsx`, app-startup-and-bootstrap), replace it with that skill's entry: the forced
  Intl polyfills first (`import '@/i18n/intl-polyfills'`, i18n-strings-and-catalogs: Hermes has no
  `Intl.PluralRules` or `Intl.Locale`), `import 'expo-router/entry'` last, `"main"` staying
  `index.ts`. Only an app without forced polyfills may set `"main": "expo-router/entry"` and delete
  `index.ts`. The complete stage fails `entry` until then: `index.ts` still registers
  `PlaceholderApp`, `"main": "index.ts"` but `index.ts` never imports `expo-router/entry`, `main` is
  neither form, or `src/app/_layout.tsx` is missing; an app on the placeholder ships a blank screen.
  `--add-missing` never writes the placeholder back into an app on its real entry (either form).

## The composer

No skill ships the composer: the monorepo writes it once, in a shared package (the apps block's
`composer`, for example `withAppSettings` in `@acme/app-config/with-app-settings.ts`), and every app's
`app.config.ts` calls it. It is plain Expo config code; app-variants-and-environment owns the
variant and environment patterns it uses (`APP_VARIANT`, per-variant names and identifiers) and
expo-prebuild-and-config-plugins owns the plugins it adds. Each `app-settings.ts` field maps to:

| Field | Expo config |
|---|---|
| `id` | `slug`, the `scheme` and the E2E names (`<project>-<purpose>` simulators) |
| `appName` (per locale) | `name` (the source language), and the per-locale display names through `locales` (iOS `CFBundleDisplayName`, Android `app_name`) |
| `bundleId` | `ios.bundleIdentifier` and `android.package` (with the variant suffix for development and preview) |
| `version` | `version` (the marketing version both stores show) |
| `buildNumber` | `ios.buildNumber` and `android.versionCode`, for the local release lane only. Under EAS remote versioning (`cli.appVersionSource: "remote"` in `eas.json`) EAS owns the build number and this field is ignored: leave it as the starting value |
| `products` | `extra` (the runtime subset the IAP layer reads through the typed reader) |
| `links` | `extra` (privacy policy and support links shown in settings), never `null` |
| `ads` | the `react-native-google-mobile-ads` config plugin's `iosAppId` and `androidAppId`, and the unit ids in `extra` for the ads layer; with `isEnabled: false` the plugin is left out and `extra` has no ad ids |

Everything the app reads at runtime goes through `extra` and the one typed reader; a key with no
value is left out, never set to `null`. A change to the composer reaches every app at the next
`npx expo config --json` (run it per app and per variant after changing it).

## Dependencies in lockstep

Every app lists the **same dependency set at the same versions**. Native modules autolink per app and
`npx expo install --check` sees only the app's own list, so an app that misses a native module the
shared packages import crashes at launch, and two versions of one native module cannot both compile
into a build. The generator copies the existing apps' list (never the stack table) and refuses
(`deps-lockstep`) when the existing apps disagree; the checker fails an app whose list differs. Install
or upgrade in every app in one change (dependency-management owns the one-specifier-per-package rule
across workspaces). The first app gets the SDK 57 runtime set: `expo` `~57.0.26`, `react` `19.2.3`,
`react-native` `0.86.3` (verified on 2026-10-03; re-verify: `npm view expo version`); every other
package arrives with the skill that first imports it.

## Store identifiers and placeholders

The bundle id and the Android package are derived (`bundle-id`), products too (`product-id`); both
are permanent once uploaded. Account-bound values stay documented placeholders until a human supplies
them: `com.example.*` (when `bundlePrefix` is still the template's), `example.com` and
`support@example.com` in `links`, and Google's sample AdMob ids (they serve test ads only) in `ads`.
The complete stage reports each as a `ship-placeholder` line, with the field and the fix, from the one
shared placeholder list every ship gate uses; no option turns one into a pass. With ads off
(`isEnabled: false`) the ad ids are not reported.

A finished app before the human steps ends exactly like this (Fix texts shortened):

```text
FAIL apps/lights-out/app-settings.ts:14 [ship-placeholder] bundleId is the template bundle id (com.example.*): com.example.lightsout Fix: ...
FAIL apps/lights-out/app-settings.ts:22 [ship-placeholder] links.privacyPolicy.host is a placeholder domain (example.com): example.com Fix: ...
FAIL apps/lights-out/app-settings.ts:25 [ship-placeholder] links.supportEmail is a placeholder email address (@example.com): support@example.com Fix: ...
FAIL apps/lights-out/app-settings.ts:30 [ship-placeholder] ads.ios.appId is Google's sample AdMob app id: ca-app-pub-3940256099942544~1458002511 Fix: ...
...
RESULT: FAIL (10 problems)
```

Report these lines as open human steps (`examples/developer-request.md`), never as a pass; any other
FAIL line is a real problem to fix first.

## Adding the next app

`node ${CLAUDE_SKILL_DIR}/scripts/scaffold-game.mjs . --game <id> --name "<Name>" --hints ... --continue ... --app`
plans it; `--write` writes it; `npm install` links the new workspace. Never `cp -R apps/<other>`: old
ids, texts, settings and art survive in corners. An app that exists but misses files is completed with
`--add-missing`, which writes only absent files and prints `keep <file>` for each existing file with
other content.
