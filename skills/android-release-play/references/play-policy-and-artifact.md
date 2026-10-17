# Play policy and the store artifact

What Google Play requires of a bundle, what `check-store-aab.mjs` reads to prove it, and the Play
Console declarations a person fills in. Facts carry their source; the numbers the checker compares
with live in `assets/play-facts.json` (verified 2026-10-14).

## Contents

- What the gate reads
- Signing and identity
- Version code and name
- Target SDK
- 16 KB pages and 64-bit libraries
- Permissions and declarations
- Data safety, ads and App content
- Test-only code, debuggable and cleartext
- Template values
- The contract fields

## What the gate reads

An `.aab` is a ZIP file. The gate reads, with Node built-ins only (`scripts/lib/aab.mjs`):

| Entry | Format | Read for |
|---|---|---|
| `base/manifest/AndroidManifest.xml` | aapt2's protobuf XmlNode (not text, not binary AXML) | package, versionCode, versionName, target SDK, permissions, debuggable, cleartext, meta-data |
| `META-INF/*.RSA` / `*.EC` / `*.DSA` | PKCS#7 SignedData (a JAR signature) | the signer certificate's subject and SHA-256 |
| `base/lib/<abi>/*.so` | ELF | PT_LOAD alignment, 64-bit twins |
| `BundleConfig.pb` | protobuf (bundletool `config.proto`) | page alignment of uncompressed native libraries |
| `base/assets/index.android.bundle` | Hermes bytecode or JS | test-only sentinels (strings stay plain bytes) |
| `base/assets/app.config` | JSON (expo-constants embeds it) | the package the JS side believes in, `extra`, template values |

The reader was verified against real tool output on 2026-10-14: a manifest compiled by aapt2 36.0.0
(`link --proto-format`), libraries linked by NDK r28.2 with 16 KB and 4 KB pages, and signatures
written by the JDK 17 `jarsigner`; `keytool -printcert` printed the same fingerprints. The self-test
keeps those bytes (`tests/real-tools.json`). The gate checks identity, not cryptographic validity:
Play verifies the signature itself at upload (`jarsigner -verify` shows it locally).

## Signing and identity

- **signing**: signed, never by the debug keystore (`CN=Android Debug`), and by the certificate whose
  SHA-256 the contract registers (signing-and-keys.md, The registered fingerprint).
- **package**: the manifest package equals the contract `applicationId`, is a valid Android package,
  and is not a testing variant's id (`.dev`, `.preview` from app-variants-and-environment's
  `variantIdentity`). Play binds an app to its package forever.
- **constants-variant**: `base/assets/app.config` exists and agrees with the manifest (and
  `extra.appVariant`, when set, is production). A mismatch means `APP_VARIANT` changed between
  prebuild and Gradle.

## Version code and name

- **version-code**: an integer from 1 to 2100000000 (developer.android.com/studio/publish/versioning),
  equal to `--version-code` when given, above every Android upload tag.
- **version-name**: equals `--version`, else the app config's literal `version`.

## Target SDK

Google Play's requirement (developer.android.com/google/play/requirements/target-sdk, page updated
2026-10-01): from 2026-08-31, new apps and app updates must target Android 16 (API 36) or higher
(Wear OS and Android Automotive 35, TV and XR 34), with extension forms to 2026-11-01. Existing apps
that target API 34 or lower stop being offered to new users on newer Android versions.

Expo SDK 57 (React Native 0.86.3) targets 36 and compiles against 36, minimum 24
(`node_modules/react-native/gradle/libs.versions.toml`). The **target-sdk** rule fails a bundle
below `max(36, contract minTargetSdk)`; `check-play-release-setup.mjs` rule `target-sdk-config`
fails an `expo-build-properties` override below that floor before anything is built.

## 16 KB pages and 64-bit libraries

Android 15 devices may use 16 KB memory pages. Google Play
(developer.android.com/guide/practices/page-sizes): apps targeting API 35 and higher must support
16 KB pages on 64-bit devices; from 2027-02-01 updates that do not are refused. A library built
with 4 KB alignment fails to load (the app crashes at start) on such devices.

- **page-alignment**: every `arm64-v8a` and `x86_64` library has all PT_LOAD segments aligned to
  2^14 (16384) or more (`llvm-objdump -p lib.so | grep LOAD` shows `align 2**14`), and when bundletool
  stores native libraries uncompressed, `BundleConfig.pb` asks for `PAGE_ALIGNMENT_16K` (or 64K)
  (`bundletool dump config --bundle app.aab | grep alignment`; bundletool's default is 4K).
- AGP 8.5.1+ writes the 16 KB zip alignment (Expo SDK 57 uses AGP 8.12.0); NDK r28+ links 16 KB by
  default, and React Native's own libraries are 16 KB ready. A FAIL almost always names a
  third-party package's prebuilt `.so`: update that package, or ask its maintainers; never ship it.
- Runtime check on a 16 KB emulator image: `adb -s <serial> shell getconf PAGE_SIZE` prints 16384
  (android-emulator-build creates named devices).
- **abi-64bit**: Play requires the 64-bit version of every native library
  (developer.android.com/google/play/requirements/64-bit): an `armeabi-v7a` library needs its
  `arm64-v8a` twin, `x86` its `x86_64`.

## Permissions and declarations

- **permissions**: every `uses-permission` of the merged manifest is listed in the contract with a
  reason (the app's own `<package>.*` permissions, such as androidx's
  `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, are exempt). Libraries add permissions silently; the
  merged manifest in the bundle is the only place they all show. A new entry is a reviewed change:
  it changes the Data safety answers.
- Remove what the app does not use with `android.blockedPermissions` (expo-prebuild-and-config-plugins).
  The React Native template keeps `SYSTEM_ALERT_WINDOW` in the main manifest for the development
  overlay (seen in the reference app's production prebuild on 2026-10-14); block it for release unless
  the app draws over other apps. `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` with
  `maxSdkVersion="32"` come from expo-file-system; block them unless the app reads shared storage on
  Android 12 and older.
- **permission-declaration**: a permission Play reviews against a Play Console declaration needs the
  contract entry's `playDeclaration` (what was declared). The list is in
  `assets/play-facts.json` `declarationPermissions`: broad package visibility, all-files access,
  photo and video (prefer the system photo picker), background location, SMS and call log, exact
  alarms (`USE_EXACT_ALARM`), full-screen intents, foreground service types, the advertising ID,
  accessibility and VPN services. QUERY_ALL_PACKAGES and photo/video were verified on Play Console
  Help; re-check the rest there before a release that adds one.

## Data safety, ads and App content

Play Console, Policy and programs, App content, filled in by a person (human-steps.md):

- **Data safety**: what the app and its SDKs collect and share. The answers come from
  privacy-and-store-declarations (its `contracts/privacy.json` and the answers it prints); this skill
  only refuses a bundle whose permissions are not in the release contract, so a permission change
  never ships without that review.
- **Advertising ID**: an app whose bundle holds `com.google.android.gms.permission.AD_ID` (the Google
  Mobile Ads SDK adds it) declares that it uses the advertising ID and why.
- **Ads**: "contains ads" when it shows any. **ad-app-id**: with `react-native-google-mobile-ads`
  installed, `com.google.android.gms.ads.APPLICATION_ID` must be present (the SDK stops the app at
  launch without it) and well formed; the production value is the app's own (admob-ads-and-consent).
- **Target audience, content rating, privacy policy URL, app access** (a test account when features
  sit behind a login), **account deletion** (an in-app path and a web URL when the app has accounts:
  auth-and-secure-storage, privacy-and-store-declarations).

## Test-only code, debuggable and cleartext

- **test-code**: the embedded JS holds no test-only sentinel (debug-menu-and-test-hooks exports
  `TEST_BUILD_SENTINEL = '<APP>_TEST_BUILD_ONLY'`; the gate finds every exported `*SENTINEL*` string
  under `src/`, plus `testOnlySentinels` in `rn-skills.config.json`, or `--sentinel`). A test-only gate
  with no known sentinel is a problem: the gate could not prove anything.
- **debuggable**: `android:debuggable` is not true (Play refuses such bundles; it means a debug build).
- **cleartext**: `android:usesCleartextTraffic` is not true in the release manifest. The template's
  cleartext lives in the debug manifest for Metro only; an `expo-build-properties`
  `usesCleartextTraffic: true` would ship plain HTTP.

## Template values

**ship-placeholder** (shared ship-placeholders library): no template value in the package, the
manifest meta-data or anywhere in the embedded app config: `com.example.*`, Google's sample AdMob ids
(`ca-app-pub-3940256099942544~...`), the all-zero template publisher (`ca-app-pub-0000000000000000`),
`example.com` links and addresses, unfilled `__NAME__` tokens. A placeholder is often format-valid, so
the gate compares values; no flag turns one into a pass.

## The contract fields

`contracts/android-release.json` (schema beside it):

| Field | Meaning |
|---|---|
| `lane` | `eas` or `local` |
| `applicationId` | the production `android.package` |
| `uploadCertificateSha256` | the registered upload certificate's SHA-256, `null` before the first upload |
| `minTargetSdk` | 36 or higher |
| `uploadTrack` | `internal`, `alpha` or `beta` |
| `rollout` | rising production fractions, first ≤ 0.2, last 1 |
| `releaseBranch` | optional, default `main`: the branch the local lane's `build` releases from |
| `releaseNotesLanguage` | optional, default `en-US`: the Play language code of `--notes` (the app's default store listing language, for example `de-DE`) |
| `permissions` | `{ "<permission>": { "reason": "...", "playDeclaration"?: "..." } }` |

`rn-skills.config.json` keys read by the checkers: `androidReleaseContract` (another contract path),
`testOnlySentinels` (extra sentinel strings).
