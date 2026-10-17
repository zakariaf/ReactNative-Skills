# Intl, catalogs, RTL and fonts

Failures with Intl on Hermes, message catalogs, right-to-left layout and direction switches, and fonts. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npm ls react-intl expo-localization`.

<!-- Generated from assets/known-failures/i18n.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Intl
- Catalogs
- RTL layout
- Direction
- Locale
- Fonts

## Intl

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `i18n-hermes-intl` | Plural forms wrong, Intl.PluralRules or Intl.Locale undefined, -u-nu- digits ignored, or dates in an unexpected calendar on the device while Jest passes | Hermes implements only part of Intl natively (no PluralRules or Locale on some builds), drops the numbering system, and some locales (fa) default to a non-Gregorian calendar | Load the FormatJS polyfills (getcanonicallocales, locale, pluralrules, numberformat with the app's locale data) first in the entry and in Jest; format at the edge through react-intl; pass an explicit calendar (-u-ca-gregory) where the product needs one | verified |  | `i18n-strings-and-catalogs` |
| `i18n-device-locale-format` | A date or number shows in the device's language instead of the language chosen in the app | toLocaleDateString() / toLocaleString() without a locale argument format in the device locale | Format through react-intl (formatDate, formatNumber) with the app's current locale; never call toLocale* without arguments in app code | verified |  | `i18n-strings-and-catalogs` |

## Catalogs

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `i18n-formatjs-lint-blind` | eslint-plugin-formatjs never reports ICU problems in the catalogs | Its content rules skip calls without defaultMessage, and the messages live only in JSON catalogs | Register the app's translate helpers in settings.formatjs and run the catalog checker plus formatjs verify --structural-equality | verified |  | `i18n-strings-and-catalogs` |
| `i18n-enforce-id-pattern` | formatjs/enforce-id demands hash ids | idInterpolationPattern requires defaultMessage and hashed ids, which conflicts with semantic keys | Use enforce-id without the pattern, or drop the rule | verified |  | `i18n-strings-and-catalogs` |
| `i18n-system-text-plain` | A usage-description text (Info.plist, InfoPlist.strings) shows a literal {placeholder} in the system dialog | iOS shows usage strings straight from Info.plist, where nothing formats ICU | Write system texts as plain sentences without braces (iOS already names the app in the dialog title) | verified | iOS | `i18n-strings-and-catalogs` |
| `i18n-system-text-missing` | A <lang>.lproj/InfoPlist.strings has no translation for a usage description, so the system dialog shows English | The catalogs lack the system text the config plugin writes into each language | Add the key to every catalog, then prebuild again; the privacy and release gates check every language | verified | iOS | `i18n-strings-and-catalogs` |

## RTL layout

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `i18n-nested-isolates` | A date inside a sentence shows its parts in the wrong order in an RTL language | A text that already carries bidi isolates (FSI ... PDI) was passed into another message as a value, which isolates it again | Strip the inner isolates before passing it (stripIsolates), so the sentence holds one isolate per value | verified |  | `rtl-and-direction` |
| `i18n-textalign-rtl` | Text stays left-aligned in an RTL layout, or right-aligned text lands on the left | textAlign 'auto' stays physical left on iOS unless the app language itself is RTL, and 'left'/'right' are swapped to start/end in RTL | Align through the text primitive (AppText align start/end) with writingDirection set; never 'right' for Arabic | verified |  | `rtl-and-direction` |

## Direction

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `i18n-force-rtl-reload` | forceRTL(true) has no visible effect | I18nManager changes apply on the next JS load | Change direction only through the direction module: record the pending direction, allowRTL and forceRTL together, save state first, then reloadAppAsync() from expo (Updates.reloadAsync rejects where expo-updates is disabled, as in development builds) | verified |  | `rtl-and-direction` |
| `i18n-double-write-before-reload` | Data is written twice on a direction switch | Module-level and startup code run once before the reload and once after it | Run the direction check first at startup, before any write, and reload only from a mounted component | verified |  | `rtl-and-direction` |
| `i18n-isrtl-drift` | Direction flips back or disagrees with the saved language | I18nManager.isRTL is captured at JS load and persists natively (it can drift after a device restore) | Compute the desired direction from the saved language, correct drift at startup, and read the layout direction from I18nManager | verified |  | `rtl-and-direction` |
| `i18n-localization-rtl-flags` | The app follows the device language for direction and undoes the in-app language choice at every launch | expo-localization's supportsRTL / forcesRTL plugin options re-apply direction from the device language at every module creation | Give expo-localization supportedLocales only; never forcesRTL; supportsRTL only for an app without its own language choice | verified |  | `rtl-and-direction` |
| `i18n-system-sheet-language` | A consent form or purchase sheet shows the device language, not the language chosen in the app | Google UMP and the store sheets follow the device or per-app system language | Expected: nothing to fix in app code; say so in the release notes for testers | open |  | `i18n-strings-and-catalogs` |
| `i18n-rtl-defaults-upgrade` | RTL behaviour changes after an SDK upgrade | Expo's localization guide announces RTL default changes for SDK 58 | Rerun the RTL screenshots and the direction tests after the upgrade | open |  | `expo-sdk-upgrade` |

## Locale

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `i18n-locale-code-variants` | A language is not detected on a real device | Devices report some languages under several codes (ckb or ku-Arab; zh-Hant-TW or zh-TW) | Resolve the device locale through a mapping that accepts each known form, with a test per form | open |  | `i18n-strings-and-catalogs` |

## Fonts

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `i18n-bidi-marks` | Tofu boxes around interpolated values | The font lacks FSI U+2068 / PDI U+2069 | Check each new font for the isolate characters, or pick one that draws them invisibly | verified |  | `rtl-and-direction` |
| `i18n-arabic-line-height` | Marks or digit tops of Arabic-script text are clipped | Arabic-script fonts need more line height, and iOS clips a Text at its frame while browsers let it overflow | Give Arabic-script text about 1.5x line height in the type scale (the text primitive applies it per script); check in screenshots | verified |  | `design-system-structure` |
| `i18n-font-coverage` | A character renders as tofu in one language | The font lacks the glyph (letter-like marks, rare capitals, tabular digits) | Check every font against the catalogs, avoid those characters, or add a fallback font | verified |  | `design-system-structure` |
| `i18n-font-plugin-partial` | Every screen renders in the system font; the design fonts never appear | The expo-font plugin entry embeds only some of the font files | One expo-font plugin entry that embeds every font file the theme names; prebuild with --clean | verified |  | `design-system-structure` |
