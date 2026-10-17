# Pitfalls, and every checker rule

Symptoms with their cause and fix (error texts as Expo SDK 57, Node 26 and the platforms print them,
verified on 2026-10-04 unless marked), then every rule of the two checkers, their options and their
SKIP and NOT APPLICABLE lines.

## Contents

- Symptoms
- check-native-generation rules
- check-native-snapshot rules
- Options, config keys and expected lines

## Symptoms

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_MODULE_NOT_FOUND: Cannot find module '<root>/node_modules/expo/config-plugins' imported from <root>/plugins/<file>.ts` with `Did you mean to import "expo/config-plugins.js"?` | SDK 57's `expo` has no exports map; a plugin file Node loads as an ES module (imported by `app.config.ts` or by another plugin file) used the bare specifier | `'expo/config-plugins.js'` everywhere, type imports too, until the SDK 58 move (`plugin-import`) |
| `Cannot find module '<root>/node_modules/expo/config-plugins.js.js'` or `TS2307 'expo/config-plugins.js'` after an upgrade | SDK 58's exports map adds `.js` itself | `'expo/config-plugins'` (expo-sdk-upgrade's move step) |
| `Cannot find package '@/config' imported from <root>/app.config.ts` | a tsconfig alias in a file Node loads | relative import with the `.ts` extension |
| `Config file <root>/app.config.ts cannot return a Promise.` | an `async` default export | return the object synchronously (`config-evaluates`) |
| `Unexpected: Config \`_internal.projectRoot\` isn't defined by expo-cli, this is a bug.` | the config dropped `...config` and then applied a string plugin inside the file | spread the incoming config; list plugins in `plugins` instead of applying them (`config-mods`) |
| `Failed to resolve plugin for module "x" relative to "<root>". Do you have node modules installed?` | the package is not a dependency (or not installed), or a local path is wrong | `npx expo install x`, or fix the path (`plugin-entry`) |
| `Package "x" does not contain a valid config plugin.` | the package ships no `app.plugin.js` and its main exports no function | drop the entry: autolinking needs none (`plugin-entry`) |
| A plugin's options seem ignored | the plugin is listed twice; the run-once guard applied only the first entry (verified) | one entry, merged options (`plugin-duplicate`) |
| The app asks for the microphone, or Play lists microphone access, though nothing records | `expo-image-picker` is installed and not listed, so prebuild applied it with defaults (`RECORD_AUDIO`, an English microphone string) | `['expo-image-picker', { microphonePermission: false, ... }]` (`auto-plugin-listed`) |
| Signing fails because the provisioning profile lacks the push (`aps-environment`) or Sign in with Apple entitlement (Xcode's wording varies; not reproduced here) | `expo-notifications` or `expo-apple-authentication` is installed, and its auto-applied plugin added the entitlement | list the package deliberately, enable the capability for every variant's id, or remove the package if unused (`auto-plugin-listed`) |
| Google Play hides the app from tablets and Chromebooks without a camera | the CAMERA permission implies `android.hardware.camera` as required | `with-android-optional-features.ts` with the camera features (Android docs, "Permissions that imply feature requirements") |
| An `extra` value read with `Constants.expoConfig.extra` is `{}` instead of `null`, and a strict parser throws at launch | the config serializer turns `null` into `{}` (verified) | leave the key out (`config-null`) |
| OTA updates never match the installed build; the fingerprint changes on every run | a non-deterministic config (`Date.now()`, `Math.random()`, a machine path) | derive values from the environment and committed files only (`config-deterministic`) |
| A manifest entry, Gradle line or AppDelegate edit appears twice after a local run | a mod that appends without checking, run onto existing folders (`--no-clean`, `expo run:*`) | replace by identity, `CodeGenerator.mergeContents`, a test that applies twice (`text-mod-idempotent`) |
| A local build still has the old name, id, permission or plugin effect | `npx expo run:*` builds an existing `ios/`/`android/` without prebuilding (verified source); or the folders came from another variant | `npx expo prebuild --clean --platform <p>` with the build's variant variables, then build |
| EAS Build ignores a config change | a stale local `ios/` or `android/` was uploaded (an `.easignore` without `/ios` and `/android`), so EAS skipped prebuild | add both lines to `.easignore` (`easignore-native`) |
| A teammate's clone cannot build a local Expo module: its Swift or Kotlin files are missing | `.gitignore` has an unanchored `ios/` or `android/` line, which also ignores `modules/<name>/ios/` | `/ios` and `/android`, then `git add modules` (`native-ignore-scope`) |
| `package.json` changes after a prebuild (`"ios": "expo run:ios"`) | prebuild rewrites `expo start --ios/--android` scripts and adds template dependencies | commit the two scripts in their `expo run:*` form once |
| A hand fix in Xcode or `AndroidManifest.xml` vanished | the next prebuild regenerated the folder | move the fix into a config key or a plugin (`native-edit`, `native-tracked`) |
| A plugin test never fails, even when broken | Jest's `testMatch` does not reach `plugins/` and `--passWithNoTests` hides it | add `'<rootDir>/plugins/**/'` to the Jest test roots (`plugin-test`) |
| A test sees mods from another test | the `with*` helpers mutate the config object; the tests share one | a `baseConfig()` function per test |
| expo-doctor fails "Check for app config fields that may not be synced in a non-CNG project" | native folders are committed (not ignored) while the config still sets native keys | generated mode: ignore and untrack the folders; committed mode: mirror changes by hand (`native-mode`) |

## check-native-generation rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-native-generation.mjs [repo-root] [options]` evaluates
`app.config.ts` with Node (development, preview and production when it reads `APP_VARIANT`), reads
`package.json`, `.gitignore`, `.easignore`, `eas.json` (build profiles' `prebuildCommand`),
`plugins/` (and the local modules its plugins import), `scripts/`, `.github/workflows/`, `.eas/`,
the Jest config and `contracts/native-generation.json`. Every rule in generated mode unless noted.

| Rule | Fails when | Why |
|---|---|---|
| `single-config` | `app.json` or `app.config.json` exists; the dynamic config is not `app.config.ts`; a second `app.config.*` exists | one source; Expo reads `.ts` first and ignores the others |
| `config-evaluates` | the default export throws, returns a Promise, or returns no object, for any evaluated variant | Expo refuses it; every command that reads the config fails |
| `config-deterministic` | two evaluations with the same environment differ (the path is printed) | the fingerprint and runtime version hash the config |
| `config-null` | a `null` anywhere in the config (outside `plugins`) | serialized as `{}` |
| `config-mods` | `app.config.ts` or a local file it imports value-imports `expo/config-plugins(.js)`/`@expo/config-plugins`, or imports a file under `plugins/` | a native change applied in code is invisible in the plugin list |
| `plugin-entry` | an imported function in `plugins`; a local path outside `plugins/`, missing, or without a default export; a package that is not a dependency or (when installed) ships no `app.plugin.*` and no main | prebuild and EAS fail, or a reviewer cannot find the plugin |
| `plugin-duplicate` | the same package or local file listed twice in one evaluation | the second entry's options are silently dropped |
| `auto-plugin-listed` | a dependency in `package.json` from `assets/auto-plugins.json` is missing from `plugins` in any evaluated variant (one installed only through another package gets a note, see the limits below) | prebuild applies it with defaults: entitlements, permissions, English purpose strings |
| `plugin-import` | a file under `plugins/` imports `@expo/config-plugins`, `@expo/config-types`, `@expo/config` or `@expo/prebuild-config`; or the wrong spelling for the installed SDK (`.js` up to 57, bare from 58) | a second copy of Expo's internals; `ERR_MODULE_NOT_FOUND` |
| `plugin-test` | a plugin file directly in `plugins/` has no sibling `*.test.ts`; the test never imports its plugin (a relative import of `./with-x.ts` or `./with-x`); or the repo's Jest config does not select that test | "local ones tested" is the point; an unreached test is no test |
| `dangerous-mod` | `withDangerousMod`/`withFinalizedMod` without `// dangerous-mod: <reason>` (8+ characters) on one of the 3 lines above; a file write outside such a call and outside the helpers it calls (in the file or a local module it imports) | they run first, skip introspection and break on template changes; a write at config time runs on every evaluation |
| `text-mod-idempotent` | a file calls a text mod (`withAppDelegate`, `withPodfile`, `withAppBuildGradle`, `withProjectBuildGradle`, `withSettingsGradle`, `withMainActivity`, `withMainApplication`) and that call has no guard (`mergeContents`, `removeContents`, `.includes`, `.test`, `.indexOf`, `.match`, `.search`, `.startsWith`, `.endsWith`) inside its own arguments or inside a function that it names or calls, declared in the same file or imported from a local module (`./lib/gradle-blocks.ts`; named, default and namespace imports and re-exports, followed transitively); options validation elsewhere in the file does not count. A `withDangerousMod` needs the guard only when it appends (`appendFileSync`, flag `'a'`) or reads a file and writes the same path expression back; whole-file writes (`mkdirSync` + `writeFileSync`/`copyFileSync`) pass | reruns duplicate the edit |
| `builtin-first` | a plugin sets what a key or expo-build-properties owns: deployment target, Android SDK and Kotlin versions, `use_frameworks!`, cleartext, iOS query schemes, Android `<queries>`, `uses-permission`, `allowBackup`, `CFBundleURLSchemes`, `NS*UsageDescription`, entitlements, keyboard mode, ABIs, predictive back; `maven { url ... }` in a file that calls `withProjectBuildGradle` or `withSettingsGradle` (`android.extraMavenRepos`) | keys are validated, introspectable and maintained by Expo |
| `native-ignored` | `.gitignore` does not ignore the root `ios/` or `android/` | generated output in git goes stale |
| `native-tracked` | `git ls-files ios android` lists a file (inside a git work tree; `--no-git` skips it) | the next prebuild overwrites it |
| `native-ignore-scope` | an ignore line also matches a nested `ios/` or `android/` folder that exists (outside node_modules and installed skills), unless a parent folder is ignored anyway (build output such as `dist-audit/_expo/static/js/ios/`); a note when a line is merely unanchored | source silently never committed |
| `easignore-native` | `.easignore` exists and does not ignore `ios/` and `android/` | EAS uploads stale folders and skips prebuild |
| `native-edit` | an npm script, a `scripts/` file or a workflow writes into `ios/` or `android/`: `sed -i`, `perl -i`, `PlistBuddy -c Set/Add/Delete/...`, `plutil -replace/-insert/-remove/-convert`, `Xcodeproj::Project` on a line that names a native path; `tee`, `patch` or `git apply` whose own argument (or `-d`/`--directory`) is a native path; a redirect, `cp`/`mv`/`rsync`/`install`/`ln` with a native destination; `writeFileSync`/`copyFileSync`/... with a native destination; the same shell commands run from a Node script through `exec`/`execSync`/`execFile`/`execFileSync`/`spawn`/`spawnSync` (command string and argument array joined) | the edit is lost at the next prebuild and differs by machine; reads are fine (`cp android/... dist/`, `plutil -extract`, `PlistBuddy -c Print`, `xcodebuild -project ios/App.xcodeproj ... > build/x.json`, `... \| tee build/x.log`) |
| `prebuild-clean` | a script or workflow runs `expo prebuild --no-clean`, or an `eas.json` build profile's `prebuildCommand` holds `--no-clean` (both modes) | the result depends on earlier runs |
| `native-mode` | the contract is not `"generated"`/`"committed"`; committed without `reason` (20+ characters) or `decidedOn`; committed with a missing or ignored folder; committed while a script runs `expo prebuild`; committed while an `eas.json` build profile sets `prebuildCommand` (EAS skips prebuild when both folders exist, so the override never runs) | a committed model is a recorded decision, and prebuild would overwrite it |

Heuristic limits (by design; review catches the rest, and a regex that tried harder would flag
ordinary build lines):

- `native-edit` reads one line or one call at a time. It misses a write whose native path is only in
  a variable (`const plist = 'ios/App/Info.plist'; execFileSync('plutil', ['-replace', ..., plist])`),
  a command run after `cd ios &&` with a relative path, and a patch file applied from the root whose
  hunks touch `ios/`. Keep native paths literal in scripts, and keep the rule's spirit: scripts read
  the native folders, plugins change them.
- `text-mod-idempotent` accepts any guard-shaped call reached from the mod, so a validation such as
  `POD_NAME.test(pod)` done inside the mod callback (instead of before it, as the template does)
  still counts as a guard, and so does a check on a path string (`file.includes(...)`) instead of
  the file's contents. The plugin's test that applies the mod twice (`testing-and-proof.md`) is
  the real proof.
- The guard search follows functions declared in the plugin file and functions imported from local
  modules by relative path (`./lib/...`, siblings; named, default and namespace imports,
  `export { x } from` and `export * from`). It does not follow a helper from a package, a value
  passed in as an argument, or an object method (`helpers.add(...)` on a plain object): keep a
  shared guard helper a plain exported function in `plugins/lib/`.
- A dangerous mod's read-modify-write is recognised when the read and the write name the same path
  expression (`readFileSync(file)` ... `writeFileSync(file, ...)`). Two different expressions for
  one path (`readFileSync(join(root, 'x'))`, then `writeFileSync(target, ...)`) read as a whole-file
  write and pass; the twice-applied test catches it.
- `auto-plugin-listed` reads direct dependencies only. Since SDK 54 autolinking also links Expo
  modules another package depends on, and prebuild applies their plugin defaults too (verified in
  `@expo/prebuild-config` 57: `shouldSkipAutoPlugin` checks the autolinked list, not
  `package.json`). `expo` itself depends on `expo-file-system`, so every app gets its Android
  `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` and `INTERNET` permissions unless it blocks them
  (`android.blockedPermissions`). Listing the package does not remove them: `withFileSystem` adds all
  three whatever its options (verified in `expo-file-system` 57 `plugin/build/withFileSystem.js`);
  listing only makes the defaults explicit and sets its iOS options (`enableFileSharing`,
  `supportsOpeningDocumentsInPlace`). The checker prints a note for an auto-plugin package installed
  at the top of `node_modules` without being a dependency (the `expo-dev-launcher`/`expo-dev-menu`
  pair under `expo-dev-client` excepted); the note goes away when `android.blockedPermissions` names
  every permission `assets/auto-plugins.json` lists under `blockable` for that package (for
  `expo-file-system` the two storage ones; `INTERNET` stays, every React Native app needs it). To set
  such a package's options, make it a direct dependency first (`npx expo install <pkg>`), then list
  it: a listed package that resolves only through hoisting fails `plugin-entry`. A package nested
  deeper in `node_modules` is not seen. `check-native-snapshot` is the net: the defaults show as
  drift.
- `builtin-first` reads one file at a time: a Maven repository string built in a `plugins/lib/`
  helper and inserted by a plugin elsewhere is not tied to the Gradle mod; review it.

## check-native-snapshot rules

`node ${CLAUDE_SKILL_DIR}/scripts/check-native-snapshot.mjs [repo-root] [--write] [--variant <name>] [--from <file>]`

| Rule | Fails when |
|---|---|
| `native-snapshot` | `contracts/native-config.json` is missing, is not JSON, or was written for another variant |
| `native-drift` | the normalized introspection differs from the snapshot; one line per added, removed or changed key (at most 40, then a note) |

Bad input (exit 2): Expo not installed and no `--from`; a `--from` file that is missing or holds no
`_internal.modResults` (a `--type public` output); introspection itself failing (run
`check-native-generation.mjs` for the reason).

## Options, config keys and expected lines

- `check-native-generation.mjs`: `--app-dir <dir>` (multi-package; default the root or the one
  workspace with an app config), `--plugins-dir <dir>`, `--variant <name>` (repeatable), `--env
  KEY=VALUE` (repeatable), `--no-git`, `--json`.
- `rn-skills.config.json` key read: `"pluginsDir"` (default `"plugins"`, relative to the app folder).
  `contractsDir` (from the shared layout) places `native-generation.json` and `native-config.json`.
- Expected SKIP line while the app has no Jest config:
  `SKIP jest.config.js [plugin-test] not yet created (unit-and-component-tests creates it)`.
- Expected note lines (not problems): an unanchored ignore line with no nested native folder yet;
  in committed mode, the native keys prebuild no longer applies; a Jest config the checker cannot
  read; an auto-plugin package installed only through another package; an `eas.json` that does not
  parse.
- NOT APPLICABLE when `package.json` has no `expo` dependency (both scripts).
