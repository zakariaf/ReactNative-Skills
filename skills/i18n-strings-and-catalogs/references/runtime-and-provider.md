# Runtime: polyfills, entry, provider, t() and T

How text gets from a catalog to the screen at runtime, and why each piece is shaped the way it is.
The code is in `templates/src/i18n/` (copy to `src/i18n/`), `templates/index.ts` and
`templates/scripts/i18n/`.

## Contents

- Packages and versions
- Why the Intl polyfills are forced (and the optional blocks)
- Regional and script languages (pt-BR, zh-Hant, es-419)
- The app entry (Expo Router custom entry)
- The i18n folder
- Language resolution and expo-localization (iOS and Android)
- Declaring the languages (app.config.ts)
- The locale tag (digits)
- t(), T and the provider
- Text outside the provider (translate-now.ts)
- Missing keys and errors
- Jest setup and the tests to keep
- On-device probe (iOS simulator and Android emulator)
- Appendix: React Navigation 7 static API
- When multi-package

## Packages and versions

Verified on 2026-10-03 (`npm view <package> version`, Expo SDK 57, React Native 0.86.3, Hermes):

| Package | Version | Where | How |
|---|---|---|---|
| `react-intl` | 12.1.3 exact | dependencies | `npm install -E react-intl@12.1.3` (not in the Expo map) |
| `@formatjs/intl-getcanonicallocales` | 3.2.12 exact | dependencies | `npm install -E` |
| `@formatjs/intl-locale` | 5.3.12 exact | dependencies | `npm install -E` |
| `@formatjs/intl-pluralrules` | 6.3.15 exact | dependencies | `npm install -E` |
| `@formatjs/intl-numberformat` | 9.4.3 exact | dependencies | `npm install -E` |
| `@formatjs/intl-datetimeformat` | 7.8.0 exact | dependencies, only when `src/i18n/` uses `Intl.DateTimeFormat` | `npm install -E` (same release train as the three above: shares `@formatjs/bigdecimal` 0.2.7 and `@formatjs/intl-localematcher` 0.9.0) |
| `@formatjs/intl-relativetimeformat` | 12.3.15 exact | dependencies, only when `src/i18n/` uses `Intl.RelativeTimeFormat` | `npm install -E` (shares `@formatjs/intl-localematcher` 0.9.0) |
| `@formatjs/intl-listformat` | 8.3.15 exact | dependencies, only when `src/i18n/` uses `Intl.ListFormat` | `npm install -E` (same) |
| `@formatjs/intl-displaynames` | 7.3.15 exact | dependencies, only when `src/i18n/` uses `Intl.DisplayNames` | `npm install -E` (same) |
| `@formatjs/intl-segmenter` | 12.2.15 exact | dependencies, only when `src/i18n/` uses `Intl.Segmenter` | `npm install -E` (same; no locale data) |
| `expo-localization` | ~57.0.2 | dependencies | `npx expo install expo-localization` |
| `@formatjs/cli` | 6.16.32 exact | devDependencies | `npm install -D -E` (for `npm run i18n:verify`) |
| `@formatjs/icu-messageformat-parser` | 3.5.20 exact | devDependencies | `npm install -D -E` (the project linter imports it) |
| `eslint-plugin-formatjs` | 8.1.0 exact | devDependencies | part of the canonical ESLint config |

Re-verify before relying on a number: `npm view react-intl version`, `npm view
@formatjs/intl-pluralrules version` (and the other polyfills), `npx expo install --check`. Pick the
newest release that is at least 7 days old and shares its `@formatjs/*` dependencies with the other
polyfills (`npm view @formatjs/intl-datetimeformat@<v> dependencies`), so npm installs one copy.

## Why the Intl polyfills are forced (and the optional blocks)

Facts found on an iOS 26.5 Release build (Hermes 250829098.0.17, Expo SDK 57, 2026-09-26):

- Hermes has **no `Intl.PluralRules` and no `Intl.Locale`**, and it **ignores `-u-nu-`** (digit
  selection). Every plural and every non-Latin digit would be wrong on the phone while Jest (Node,
  full ICU) passes.
- `fa` dates came out in the Solar Hijri calendar (native `Intl.DateTimeFormat` follows the device).

Android: Hermes's documented Intl coverage is `Intl.Collator`, `Intl.NumberFormat`,
`Intl.DateTimeFormat` and the locale-aware `toLocale*` methods, implemented on each platform's own
libraries (`formatToParts` on Android only); `PluralRules` and `Locale` are not implemented on either
platform. Not probed on an Android device for this skill: run the probe below on an emulator.

One polyfill module, forced, fixes both, and forcing makes Jest identical to the phone.
`intl-polyfills.ts` imports, in this exact order: `@formatjs/intl-getcanonicallocales/polyfill.js`
(conditional: Hermes has it, so it is normally a no-op), then **forced** `intl-locale`,
`intl-pluralrules` + one locale-data file per language, `intl-numberformat` + one locale-data file
per language. Locale data is imported statically because Metro cannot resolve template-string
imports. No other locale data: each extra locale is startup weight. `check-i18n-code.mjs` rule
`polyfill-locales` compares the imports with `LANGUAGES` and fails a missing, extra or unforced one.

When a file under `src/i18n/` uses `Intl.DateTimeFormat` (rule 10), a fifth block follows:
**forced** `intl-datetimeformat/polyfill-force.js`, one `locale-data/<lang>.js` per language, then
exactly one time-zone file (`add-golden-tz.js`, or `add-all-tz.js` for arbitrary zones). The rule then
requires the block, and fails a partial one at any time. The polyfill defaults to UTC whatever the
device says, so every formatter passes `timeZone` (from `getCalendars()[0]?.timeZone`); full shape,
sizes and verified outputs in the skill's `examples/intl-date-time.md`.

### The other Intl APIs Hermes lacks

Hermes implements `Intl.Collator`, `Intl.NumberFormat` and `Intl.DateTimeFormat` only (Hermes
`doc/IntlAPIs.md`). `new Intl.RelativeTimeFormat(…)`, `Intl.ListFormat`, `Intl.DisplayNames` and
`Intl.Segmenter` therefore throw `not a constructor` on the phone, while Jest on Node (full ICU)
passes: exactly the gap the forced polyfills exist to close. `check-i18n-code.mjs` rule `intl-api`
holds the line:

- **Outside `src/i18n/`** any of the four, and `Intl.PluralRules` (code never picks a plural form;
  the catalogs hold every form), fails.
- **Inside `src/i18n/`** each needs its forced block in `intl-polyfills.ts`, after the NumberFormat
  (and DateTimeFormat) block, in this order: `@formatjs/intl-relativetimeformat`,
  `@formatjs/intl-listformat`, `@formatjs/intl-displaynames` (each `polyfill-force.js` plus one
  `locale-data/<file>.js` per language), then `@formatjs/intl-segmenter/polyfill-force.js` (no locale
  data). `polyfill-locales` fails a partial block, as for DateTimeFormat. A language without data does
  not throw: it silently formats in English (`new Intl.RelativeTimeFormat('fr')` resolved to `en`
  with only en and ar data).
- **Prefer the catalog.** A relative time is usually a catalog plural
  (`{daysCount, plural, =0 {today} =1 {yesterday} one {# day ago} other {# days ago}}`, every CLDR
  category of each language), a list of a few names one message per shape, a language name an
  autonym. Take the Intl path when the catalog cannot say it (every unit from seconds to years,
  arbitrary lists). Verified on Node 26.4 with the forced blocks above and en/ar data (2026-10-03):
  `new Intl.RelativeTimeFormat('ar-u-nu-arab').format(-3, 'day')` -> `قبل ٣ أيام`, `('en', { numeric:
  'auto' }).format(-1, 'day')` -> `yesterday`, `new Intl.ListFormat('en').format(['a', 'b', 'c'])` ->
  `a, b, and c`. Not probed on a device: show one result on the debug screen of a test build.
- Weight on disk: relativetimeformat's `polyfill-force.js` 24 KB (7 KB gzip) plus 15-35 KB per
  language, listformat 22 KB plus 3 KB, displaynames 24 KB plus about 150 KB per language,
  segmenter 139 KB (33 KB gzip).

- Cost (measured in the source app with four languages on the iOS simulator): about 578 KB of raw
  locale data (70 KB gzip), 0.85 MB of minified polyfill JS, loaded in 11 ms. Measure your own with
  performance-budgets when the language list grows.
- `areIntlPolyfillsActive()` (`intl-status.ts`) is true only when the forced polyfills are the
  active implementations; a debug screen and `intl-status.test.ts` use it.
- If Hermes ever ships `PluralRules`, keep forcing the polyfills (Jest parity) unless a measured
  cold-start problem says otherwise.

## Regional and script languages

A language in `LANGUAGES` may carry a region or a script: `pt-BR`, `es-419`, `en-GB`, `zh-Hans`,
`zh-Hant`. The catalog is `catalogs/pt-BR.json`, the `digits.ts` row and the autonym are keyed by
the same code, and the locale tag is `pt-BR` (or `pt-BR-u-nu-latn`).

**Locale data by truncation fallback.** The FormatJS packages do not ship a file for every tag. Each
language imports, per package, the first of its tag and its truncations (the tag, then the tag minus
its last subtag) that the package ships. This is how the FormatJS polyfills and Node's ICU find plural
data (`new Intl.PluralRules('es-MX').resolvedOptions().locale` is `es` on Node 26.4); it is not CLDR's
`parentLocales`, where the parent of `es-MX` is `es-419`, of `en-AU` is `en-001` and of `zh-Hant` is
the root. Today's packages ship the regional number files that matter (`es-MX.js`, `en-AU.js`,
`en-IN.js`, `es-419.js` in intl-numberformat 9.4.3), so the difference changes no import. Listed from
the installed packages (2026-10-03):

| Language | intl-pluralrules 6.3.15 | intl-numberformat 9.4.3 (and the optional blocks) |
|---|---|---|
| `pt-BR` | `pt.js` (only `pt.js` and `pt-PT.js` exist) | `pt.js` (no `pt-BR.js`) |
| `pt-PT` | `pt-PT.js` | `pt-PT.js` |
| `zh-Hans` / `zh-Hant` | `zh.js` | `zh-Hans.js` / `zh-Hant.js` |
| `es-419`, `en-GB` | `es.js`, `en.js` | `es-419.js`, `en-GB.js` |

Importing a file that does not exist (`intl-pluralrules/locale-data/pt-BR.js`) fails Metro and Jest
with `Cannot find module`. `check-i18n-code.mjs` rule `polyfill-locales` resolves every file from
the app's `node_modules` and names the exact import in its fix, and fails an imported `@formatjs`
package that `node_modules` lacks (with its `npm install -E` line); only a repo with no
`node_modules` at all gets the lenient reading, where the tag or a truncation is accepted. The polyfills then resolve the full tag: with `pt.js` data,
`new Intl.PluralRules('pt-BR')` reports locale `pt-BR` and categories `one, many, other`, and
`new Intl.NumberFormat('pt-BR').format(1234.5)` gives `1.234,5` (verified on Node 26.4).

**Matching the device.** `resolveLanguage` reads each `getLocales()` entry's `languageTag` (the
preferred language's own tag on both platforms) and tries, most specific first, the full tag
(`zh-Hant-TW`, extensions such as Android's `-u-fw-mon` dropped), then language-Script (`zh-Hant`),
then the language (`zh`), each through `DEVICE_CODE_ALIASES` first. `regionCode` is not read: on iOS
it is the Region setting, the same for every entry (expo-localization 57.0.2 `getLocales()` source,
read 2026-10-03), so an English (UK) speaker in a US region would match `en-US`. Android reports
Taiwan's Chinese as `zh-TW` with no script: an app shipping `zh-Hant` adds the decision
`'zh-TW': 'zh-Hant'` (and `zh-HK`, `zh-MO`) to the aliases. An app shipping only `pt-BR` decides
whether European Portuguese speakers get it (`pt: 'pt-BR'`) or the source language (no entry).
Never ship a bare `zh`: it would serve Simplified text to Traditional readers.

## The app entry (Expo Router custom entry)

With `"main": "expo-router/entry"`, Expo Router loads the route modules before any app code can run.
Expo documents a custom entry for side effects that must come first, polyfills among them (Expo
Router installation guide, "Custom entry point to initialize and load", verified 2026-10-03):

```ts
// index.ts  ("main": "index.ts" in package.json)
import '@/i18n/intl-polyfills';

import 'expo-router/entry';
```

- The polyfills are the first import; `expo-router/entry` is the last (it registers the app).
- `test/i18n/app-entry-imports.test.ts` guards both lines; `check-i18n-code.mjs` rule
  `polyfill-first` reads `package.json` `main`, fails `expo-router/entry` or Expo's default, and
  fails an entry whose first import is not the polyfill module (`--entry <file>` for another entry).
- app-startup-and-bootstrap owns the rest of the startup order; the polyfills stay first. Other
  side-effect imports go between the two lines, never after the router: background-tasks' task
  registry (`import '@/services/background-tasks/define-background-tasks';`) is the usual one, and the
  guard test stays green because it pins only the first and the last import.

## The i18n folder

```
src/i18n/
  catalogs/en.json ar.json        one per language in LANGUAGES
  intl-polyfills.ts intl-status.ts
  languages.ts digits.ts bidi.ts language-context.tsx
  resolve-language.ts messages.ts create-t.ts t-context.ts t-bridge.tsx i18n-provider.tsx t.tsx
  translate-now.ts                t() without React context (the root crash fallback)
  format-date.ts
scripts/i18n/                     verify-catalogs.ts catalog-lint*.ts icu-walk.ts app-languages.ts native-locales.ts i18n-contract.ts review-sheet.ts
package.json                      "main": "index.ts", "i18n:verify": "node scripts/i18n/verify-catalogs.ts"
test/i18n/app-entry-imports.test.ts
contracts/i18n.json               untranslated prefixes, review languages, isolated formatters, package catalogs
index.ts                          the app entry
```

**A moved i18n folder.** The Node tooling learns the folder from one constant,
`export const I18N_DIR = 'src/i18n'` in `scripts/i18n/app-languages.ts`; `native-locales.ts`
(app.config), `i18n-contract.ts`, `verify-catalogs.ts` and `review-sheet.ts` read it from there. The
checkers read `rn-skills.config.json` `"i18nDir"` (or `--i18n-dir`). Change both together;
`check-i18n-code.mjs` rule `tooling-dir` fails while they disagree, so `app.config.ts` and
`npm run i18n:verify` never read other catalogs than the checkers. Three more places name the folder:

- `jest.config.js` `const INTL_POLYFILLS = 'src/i18n/intl-polyfills.ts'`. The canonical config lists
  it only when the file exists, so a stale path silently runs Jest on Node's ICU; rule
  `jest-polyfills` fails a literal setup path that is not the checkers' folder (the config itself
  belongs to unit-and-component-tests).
- `index.ts` `import '@/i18n/intl-polyfills'` (rule `polyfill-first` follows the alias).
- The canonical `eslint.config.mjs` zones (typescript-and-lint-rules owns them): the react-intl
  import ban that exempts `src/i18n/`, `FORMATTERS = ['src/i18n/**/*.{ts,tsx}']` (where Intl date and
  number formatting is allowed) and `DIRECTION_MODULE = ['src/i18n/direction.ts']` (the one file that
  touches `I18nManager`, rtl-and-direction). An app that moves the folder changes them there; this
  skill's checkers already follow `"i18nDir"`.

`npm run i18n:verify` is the in-repo catalog gate: quality-gates' `npm run verify` runs it after the
type check, so CI catches a broken catalog without this skill installed. `check-i18n-code.mjs` rule
`verify-script` fails a `package.json` without the script, or one whose target file is missing.
Each linter problem prints as `<file>:<line> [<id> <name>] <key>: <message>` with the checker's rule
ids and messages (L1-L13, P4, P5, F1); FormatJS prints its own report for missing and extra keys and
placeholder differences (what `check-catalogs.mjs` calls P1-P3). Verified on 2026-10-03 in the
reference app (`@formatjs/cli` 6.16.32): a deleted key, an added placeholder and an Arabic plural
without its six categories each fail it, and the clean catalogs print `0 catalog folder(s) failing`.

knip (the unused-code gate) flags `useLanguage` (`language-context.tsx`) and `directionOf`
(`languages.ts`) until a screen reads the language or rtl-and-direction lands: they are the shared
API that skill, settings-and-preferences and ui-component-library build on. Use them there rather
than deleting them; `@formatjs/icu-messageformat-parser` is an unlisted dependency until it is in
`devDependencies` (step 1 installs it).

`react-intl` is imported only inside `src/i18n/` (the canonical ESLint config's
`no-restricted-imports` and `check-i18n-code.mjs` rule `react-intl-import`). Everything else uses
`useT()` / `<T>`. `check-i18n-code.mjs` rule `i18n-runtime` fails when one of the runtime files is
missing, because every other rule relies on them.

## Language resolution and expo-localization

- `resolveLanguage(saved, getLocales())`: the saved choice first (`null` = follow the device, stored
  by settings-and-preferences), then the first device locale that maps to a language in
  `LANGUAGES`, else `SOURCE_LANGUAGE`.
- Each device locale is tried as its full `languageTag`, then language-Script, then the language
  ("Regional and script languages" above), so `pt-BR`, `es-419` and `zh-Hant` resolve.
- Mappings are explicit decisions in `DEVICE_CODE_ALIASES`: individual codes of a macro-language
  (`arb` -> `ar`, `prs` -> `fa`), script-qualified codes (`ku-Arab` -> `ckb`: Kurdish in Arabic
  script is Sorani; Kurdish in Latin script is Kurmanji and must not match) and full tags
  (`es-MX` -> `es-419`, `zh-TW` -> `zh-Hant`). Never map by guessing.
- `LANGUAGE_AUTONYMS` (English, العربية) are code, not catalog text; translators never change them,
  and a unit test pins them.
- **Declare the languages to the system** with the expo-localization config plugin's
  `supportedLocales` (Expo localization guide, verified 2026-10-03). On iOS it writes
  `CFBundleLocalizations`, so iOS Settings offers a per-app language; on Android 13 and newer it
  declares the app's locales so Settings > Apps > Language lists them. On iOS the device language
  must also be in this list for the layout to turn right-to-left; layout direction itself is
  rtl-and-direction's job. See "Declaring the languages" below for the app.config.ts code.
- **When the system language changes:** iOS restarts the app; Android does not, so re-read
  `getLocales()` when `AppState` becomes active (or use `useLocales()`), and resolve again when the
  saved choice is `null` (Expo localization guide).
- System dialogs, purpose strings and store purchase sheets follow the system (or per-app) language,
  not an in-app choice. A person who picks Arabic inside an English phone still sees iOS's and
  Android's own sheets in English.

### Declaring the languages (app.config.ts)

Wrap the config the app already builds, so the existing function stays short and the i18n part is
one place. Verified on 2026-10-03 in the reference app (Expo SDK 57) with
`APP_VARIANT=development EXPO_PUBLIC_APP_VARIANT=development npx expo config --json` and
`npx expo prebuild --no-install`: `locales.en`/`locales.ar` came from the catalogs,
`en.lproj/InfoPlist.strings` held `CFBundleDisplayName = "Tasks (Dev)"`, `ar.lproj` held
`"المهام (Dev)"` (Android: `values-b+en` and `values-b+ar` `app_name` the same), the base
`NSCameraUsageDescription` was the catalog's English text, `CFBundleLocalizations` was
`["en", "ar"]` and Android got `res/xml/locales_config.xml` with both languages.

```ts
// app.config.ts (excerpt; BASE, resolveAppVariant and variantIdentity are app-variants-and-environment's)
import { readAppLanguages } from './scripts/i18n/app-languages.ts';
import { nativeLocales, sourceText } from './scripts/i18n/native-locales.ts';
import { resolveAppVariant, variantIdentity } from './src/config/app-variant.ts';

/** The catalog keys the native projects read: the app name and iOS permission purpose strings. */
const NATIVE_TEXT_KEYS = {
  displayName: 'app.name',
  usageDescriptions: { NSCameraUsageDescription: 'permissions.camera.usage-description' },
};

type I18nInput = {
  readonly projectRoot: string;
  /** The catalog's app name -> this variant's name ('المهام' -> 'المهام (Dev)'). */
  readonly variantName: (name: string) => string;
};

/** Native texts from the catalogs, and the languages declared to iOS and Android 13+. */
function withI18n(config: ExpoConfig, { projectRoot, variantName }: I18nInput): ExpoConfig {
  const infoPlist = { ...config.ios?.infoPlist, CFBundleAllowMixedLocalizations: true };
  const { languages } = readAppLanguages(projectRoot);
  const supportedLocales = { ios: [...languages], android: [...languages] };
  const camera = sourceText(projectRoot, 'permissions.camera.usage-description');
  return {
    ...config,
    ios: { ...config.ios, infoPlist },
    locales: nativeLocales(projectRoot, NATIVE_TEXT_KEYS, { variantName }),
    plugins: [
      ...(config.plugins ?? []),
      ['expo-localization', { supportedLocales }],
      ['expo-image-picker', { cameraPermission: camera, photosPermission: false, microphonePermission: false }],
    ],
  };
}

export default function appConfig({ config, projectRoot }: ConfigContext): ExpoConfig {
  const variant = resolveAppVariant(process.env);
  const variantName = (name: string): string => variantIdentity({ ...BASE, name }, variant).name;
  return withI18n(baseConfig(config, variantIdentity(BASE, variant)), { projectRoot, variantName });
}
```

- **The variant label.** `nativeLocales` writes `CFBundleDisplayName`/`app_name` for every declared
  language, which overrides the variant name of the base config on those phones. `variantName` keeps
  it: app-variants-and-environment owns the label, so the function calls its `variantIdentity`
  instead of spelling `(Dev)` here. Keep `BASE.name` equal to the source catalog's `app.name`
  (`sourceText(projectRoot, 'app.name')` reads it), so the base Info.plist and the catalogs agree.
- **Base texts of config plugins.** A plugin that requests a permission writes its own option into
  the base Info.plist (expo-image-picker's default is `Allow $(PRODUCT_NAME) to access your camera`),
  so pass `sourceText(projectRoot, '<key>')`. `false` removes a permission the app does not use. The
  options and the keys they set (read from the SDK 57 plugin sources): `cameraPermission`
  (NSCamera…), `microphonePermission` (NSMicrophone…), `photosPermission` (NSPhotoLibrary…),
  `savePhotosPermission` (NSPhotoLibraryAdd…), `locationWhenInUsePermission`,
  `locationAlwaysPermission`, `locationAlwaysAndWhenInUsePermission`, `motionPermission` /
  `motionUsagePermission` (NSMotion…), `contactsPermission`, `calendarPermission`,
  `writeOnlyCalendarPermission`, `remindersPermission`, `faceIDPermission`, `userTrackingPermission`
  and react-native-google-mobile-ads' `userTrackingUsageDescription` (NSUserTracking…).
- **Plugins that run unlisted.** `@expo/prebuild-config` 57 applies the plugin of an installed
  expo-image-picker, expo-camera, expo-media-library, expo-location, expo-sensors,
  expo-local-authentication, expo-contacts or expo-calendar on its own (`withLegacyExpoPlugins` /
  `withVersionedExpoSDKPlugins`, verified in its sources on 2026-10-10), and each writes the default
  of every permission it knows (expo-calendar writes NSCalendarsWriteOnlyAccess… in place of
  NSCalendarsFullAccess… under `writeOnlyAccess: true`, so pass `writeOnlyCalendarPermission` then):
  expo-image-picker alone adds NSCamera…, NSMicrophone… and NSPhotoLibrary… in English, which
  `nativeLocales` never translates (a reference-app build once shipped `ar.lproj/InfoPlist.strings`
  without them). List every such package with an option per permission: `sourceText(...)` plus its
  key in `NATIVE_TEXT_KEYS`, or `false`. A bare `'expo-audio'` or `'expo-tracking-transparency'`
  entry writes its default the same way.
- `check-i18n-code.mjs` enforces the four parts: `supported-locales` (expo-localization with
  `supportedLocales` from `readAppLanguages`), `system-text-literal` (no literal
  `NS…UsageDescription`, `*Permission` or `*UsageDescription` value, and no permission plugin left to
  write its English default), `system-text-locales` (`locales`
  is set, no catalog text repeated, every purpose key the config sets, directly or through one of
  the options above, is listed in `NATIVE_TEXT_KEYS.usageDescriptions`, and a config with variants
  passes `variantName`).
- Node tooling never imports `src/` code other than the pure, Node-safe `src/config/app-variant.ts`:
  an Expo app's `package.json` has no `"type"`, so Node reparses `src/i18n/languages.ts` as an ES
  module and warns (`MODULE_TYPELESS_PACKAGE_JSON`) on every `expo config`, prebuild and EAS build.
  `scripts/i18n/app-languages.ts` reads the two literals from the file instead (any layout Prettier
  writes, a 13-language list one code per line included); keep `LANGUAGES` and `SOURCE_LANGUAGE`
  literal.
- `baseConfig` is the app's existing config function (app-variants-and-environment owns its
  variants); the canonical ESLint limits (40 lines per function, 3 parameters) are why the i18n part
  is a wrapper taking one input object.

## The locale tag (digits)

`localeTagFor(language, digits)` (in `digits.ts`) gives the BCP 47 tag passed to `IntlProvider` and to
every `Intl.NumberFormat`, so messages and stand-alone numbers show the same digits:

| Language | `automatic` | `latin` | `local` |
|---|---|---|---|
| en | `en` | `en` | `en` |
| ar | `ar-u-nu-arab` | `ar-u-nu-latn` | `ar-u-nu-arab` |

- The `NUMBERING` table is an explicit decision per language. CLDR's defaults move: CLDR 48 (Node
  26.4) formats plain `ar` with Latin digits, `fa` with Extended Arabic-Indic (`۱۲`), `ckb` with
  Arabic-Indic (`١٢`). An app for Morocco may set `ar: { automatic: 'latn', local: 'arab' }`.
- Numbers outside a catalog sentence (badges, inputs) use a formatter built from the same tag; that
  and the digits setting are rtl-and-direction and settings-and-preferences work.

## t(), T and the provider

```tsx
// src/app/_layout.tsx (excerpt): the root layout renders the providers and nothing that needs t()
<I18nProvider language={language} digits={digits} onError={(error) => errorLog.record('i18n', error)}>
  <AppThemeProvider preference={themePreference}>
    <TextLocaleProvider value={{ language, direction: directionOf(language) }}>
      <Stack screenOptions={{ headerShown: false }} />
    </TextLocaleProvider>
  </AppThemeProvider>
</I18nProvider>
```

`TextLocaleProvider` (`src/theme/text-locale.tsx`, design-system-structure) tells `AppText` the
language and direction for its font and alignment; the root layout mounts it under `I18nProvider`
with the same `language`, and design-system-structure's `text-locale-provided` rule checks that it
is mounted once `src/i18n/` exists.

```tsx
// src/app/(app)/_layout.tsx: a group layout under the provider titles the screens
export default function AppLayout(): React.JSX.Element {
  const t = useT();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t('tasks.list.title') }} />
    </Stack>
  );
}
```

`useT()` throws outside `<I18nProvider>`, so the component that renders the provider cannot call it,
and the canonical ESLint config (`react/no-multi-comp`) keeps a second component out of the root
layout file. Titled screens therefore live in a group (`src/app/(app)/index.tsx` and its
`_layout.tsx`); a group's parentheses do not appear in the URL. Both excerpts lint and type-check
in the reference app (2026-10-03).

- `I18nProvider` = react-intl's `IntlProvider` (locale tag, this language's catalog,
  `defaultLocale={SOURCE_LANGUAGE}`) + `LanguageContext` + `TBridge`, which puts `t()` into
  `TContext`.
- `t(key, values)` wraps `formatMessage` and adds two things: FSI/PDI isolation of `*Name`/`*Text`
  values, and an `onError` report when a number is passed to a text placeholder.
- In JSX use `<T id="…" values={…} />`; `T` renders the design system's `AppText` (style,
  alignment, font scaling come with it).
- Where a string is needed (accessibility labels, navigation options, props of UI components, Skia
  paragraphs), call `const t = useT()` in the route's layout, the screen or its model hook
  (`use-<feature>-model.ts`) and pass `t('…')`. Components receive translated strings; they never
  build them.
- Navigation titles: `<Stack.Screen name="index" options={{ title: t('tasks.list.title') }} />` in the
  group layout above; a literal there is `literal-prop-text`.
- **An app that ships the web** (web-support) also calls `syncDocumentLanguage(language)` (web-support's
  `src/i18n/document-language(.web).ts`) inside the provider's existing effect, next to
  `recordShownLanguage`, so `<html lang dir>` follows the language; and it adds web-support's four
  storage-notice keys (`web-storage.other-tab.{title,body}`, `web-storage.unsupported.{title,body}`)
  to every catalog. iOS and Android get the no-op native file.
- Changing the language re-renders `I18nProvider` with the new catalog, so every text switches at
  once. Layout direction does not (it needs a reload; rtl-and-direction).

## Text outside the provider (translate-now.ts)

A few texts render where no `I18nProvider` is mounted: the root crash fallback (Expo Router's
`ErrorBoundary` export replaces the root layout and every provider it mounts) and a startup failure
screen. `useT()` throws there. `createTranslateNow(onError)` from `src/i18n/translate-now.ts` builds a
`t()` from the same pieces (`createIntl`, `messagesFor`, `createT`) and reads no React context:

```tsx
// src/features/crash-recovery/crash-fallback.tsx (excerpt; error-handling-typed-results owns the file)
const t = createTranslateNow(reportMessageError); // onError reaches the error log, never a throw
return <CrashScreen title={t('crash.title')} body={t('crash.body')} actionLabel={t('crash.restart')} … />;
```

- **The language is the one the app showed.** `I18nProvider` calls `recordShownLanguage({ language,
  digits })` after each commit, and the value outlives the provider on purpose, so a person who chose
  Arabic with Latin digits on an English phone gets the crash screen in Arabic with Latin digits.
  Before any provider has committed (a crash in the first render) it follows the device's languages
  (`resolveLanguage(null, getLocales())`), then the source language. `languageNow()` returns the
  pair, for a fallback that also sets the text direction.
- **It lags one effect pass behind a language switch.** `recordShownLanguage` runs in the provider's
  own effect, and React runs child effects before parent effects, so a child's effect in the commit
  that switched the language still reads the old one. It is for out-of-tree fallbacks only; code
  inside the tree takes `t` from `useT()` (local-notifications' reminder sync receives that `t`).
- Build it in the render that needs it: it reads the language when it is called.
- It never throws by itself: a missing message or a number passed to a text placeholder goes to
  `onError` and a missing message renders its key. In a crash fallback `onError` must record, never
  throw, because nothing catches an error thrown there.
- The file is in `src/i18n/` because only that folder imports react-intl. It is a shared file (this
  skill owns it; error-handling-typed-results and the reference app use it): change it here.

## Missing keys and errors

react-intl calls `onError` and renders the key. In the app `onError` goes to the error log
(`ErrorLogPort.record('i18n', error)`; the port belongs to architecture-and-boundaries); in tests it
throws, so a missing key fails the run. `check-catalogs.mjs` and `npm run i18n:verify` catch it
earlier.

## Jest setup and the tests to keep

- The canonical `jest.config.js` lists `<rootDir>/src/i18n/intl-polyfills.ts` in `setupFiles` of every
  project once the file exists, and its `transformIgnorePatterns` lets Babel transpile `react-intl`,
  `@formatjs` and `intl-messageformat` (they ship ESM only). `check-i18n-code.mjs` rule
  `jest-polyfills` fails a `setupFiles` that does not reach the polyfill module.
- Component tests render through the app's `renderWithProviders` (unit-and-component-tests). When
  the app gains catalogs, its `test/test-app.tsx` mounts this skill's `I18nProvider` with the real
  catalogs and a throwing `onError`, in place of a bare react-intl `IntlProvider`: `<T>` and `useT()`
  read `TContext`, which only `I18nProvider` provides (through `TBridge`), so under a bare
  `IntlProvider` every screen that uses them throws `useT() must be used inside <I18nProvider>`.

  ```tsx
  // test/test-app.tsx (excerpt; unit-and-component-tests owns the file)
  const failOnError = (error: Error): never => {
    throw error;
  };
  // inside Providers, where the bare IntlProvider was:
  <I18nProvider language={locale} digits="automatic" onError={failOnError}>
    {children}
  </I18nProvider>
  ```

- `t.test.tsx` is the one component test that renders without the helper: it tests `I18nProvider`
  itself, so it mounts `<I18nProvider><T /></I18nProvider>` with plain `render` and says so with
  unit-and-component-tests' `// no-providers: <why>` comment (the helper would add a second provider).

| Unit | Test (template) | Asserts |
|---|---|---|
| polyfills | `intl-status.test.ts` | polyfills active; `١٬٢٣٤٫٥` for `ar-u-nu-arab`; Arabic's six categories |
| `resolveLanguage` | `resolve-language.test.ts` | saved wins; `ar-EG`, `AR`+script, `arb`, a later supported locale, unsupported -> source; regional and script tags (`pt-BR`, `es-419`, `en-GB` vs `en-US`, `zh-Hant-TW`, Android `zh-TW` through an alias, `ku-Arab` vs `ku-Latn`); autonyms pinned |
| `t()` | `create-t.test.ts` | Arabic plurals for 0, 1, 2, 3, 11, 100; Latin digits; percent; FSI/PDI; number to a text placeholder reported |
| dates | `format-date.test.ts` | `formatDayMonth` in en and ar, nested isolates, the weekday helpers |
| `<T>` | `t.test.tsx` | English and Arabic text with digits; the provider records the language and digits it shows |
| outside the provider | `translate-now.test.ts` | device languages then the source before a provider commits; the shown language and digits win over the device; problems go to `onError` |
| entry | `test/i18n/app-entry-imports.test.ts` | polyfills first, `expo-router/entry` last |
| linter | `catalog-lint-rules.test.ts`, `catalog-lint.test.ts` | the rules fire with the checker's ids (L6 for a German source, never for Japanese); `<file>:<line> [<id> <name>]` lines; untranslated keys; parity; BCP 47 casing and exact file names |
| native strings | `native-locales.test.ts`, `app-languages.test.ts` | app name and purpose strings per language, the variant label, `sourceText`; plain text only; the literal language list in every Prettier layout; `I18N_DIR` |
| catalog gate | `verify-catalogs.test.ts` | a stubbed FormatJS binary gets every language file; lint problems (paths relative to the app), a failing FormatJS run and a missing binary fail; contracts and package catalogs at the workspace root |
| review queue | `review-sheet.test.ts` | pending rows, hashes, the CSV, marking, exit codes |

## On-device probe

After every React Native, Hermes or Expo SDK upgrade, show these in a test build's debug screen (or
log them once): `typeof Intl.PluralRules`, `typeof Intl.Locale` (natively `undefined`, verified on
iOS), then with the polyfills `new Intl.NumberFormat('ar-u-nu-arab').format(1234.5)` (`١٬٢٣٤٫٥`) and
`areIntlPolyfillsActive()` (`true`). Always on a named device, never the booted one:

```sh
xcrun simctl launch <udid> <bundle-id> -AppleLanguages '(ar)' -AppleLocale ar_EG     # iOS simulator, app in Arabic
adb -s <serial> shell cmd locale set-app-locales <package> --locales ar-EG           # Android 13+ per-app language
```

The `simctl` launch arguments were verified on iOS 26.5 (`getLocales()[0].languageTag` followed
them). The `adb` command is Android's per-app language test command, not run for this skill; check
`adb -s <serial> shell cmd locale help` on the emulator image first. Simulators and emulators are
named `<project>-<purpose>` (for example `tasks-i18n`).

## Appendix: React Navigation 7 static API

The static API declares `options` outside components, so a hook cannot run there. Set translated
titles from the screen instead (`navigation.setOptions({ title: t('tasks.list.title') })` in a layout
effect of the screen's model hook), or render `headerTitle: () => <T id="tasks.list.title" />`.
Everything else in this skill is the same.

## When multi-package

- Each package with texts keeps `packages/<pkg>/src/i18n/<lang>.json` with a `keyPrefix`, declared
  in `contracts/i18n.json` "catalogs" (catalogs reference, "When multi-package").
- The app merges them in `messages.ts`: `{ ...appCatalogs[language], ...billingCatalogs[language] }`.
- A package hands its texts to the app as plain literal ids (it cannot import the app's
  `MessageKey`). `messages.ts` exports the one cast,
  `export function asMessageKey(id: string): MessageKey { return id as MessageKey; }`, and the app
  calls it in one function that turns a package message into text. `check-i18n-code.mjs` allows a
  cast only in `src/i18n/messages.ts` and looks every package id up in its catalog.
- Run the checkers with `--app-dir apps/mobile` when the app is a workspace (checkers reference,
  "When multi-package"); `scripts/i18n/`, `index.ts` and the `i18n:verify` script live in the app's
  folder.
- **One place for contracts.** `contracts/` (i18n.json, copy-source.json) sits at the repo root for
  the checkers and the tooling alike. The tooling runs from the app folder (npm runs workspace
  scripts there) and finds the root with `repoRootOf` (`i18n-contract.ts`): the nearest folder above
  the app whose `package.json` `workspaces` lists it, else the app folder. Package catalog `dir`s are
  relative to that root; `reports/i18n/` and `scripts/i18n/review-state.json` stay in the app folder.
- `verify-catalogs.ts` resolves `@formatjs/cli` the way Node resolves packages from the app folder,
  so a binary hoisted to the workspace root works (verified with the CLI only in a parent
  `node_modules`).
