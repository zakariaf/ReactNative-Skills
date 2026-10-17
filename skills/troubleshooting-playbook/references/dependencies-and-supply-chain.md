# Dependencies, pinning and knip

Failures while installing, pinning or upgrading packages, held-back majors, install scripts, and knip findings. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npm ls expo react-native typescript eslint jest && npx expo install --check`.

<!-- Generated from assets/known-failures/deps.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Pinning
- Held-back majors
- Install scripts
- Packages
- knip

## Pinning

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `deps-release-age-etarget` | npm install fails with ETARGET (No matching version found) for a version that exists | min-release-age=7 in .npmrc refuses versions younger than 7 days | Wait until the version is 7 days old, or pin the previous one; an exception goes only into a dated min-release-age-exclude block that expires (the dependency check enforces the date); never set min-release-age=0 | verified |  | `dependency-management` |
| `deps-npmrc-release-age-override` | A package younger than 7 days installs although .npmrc sets min-release-age=7 | npm keeps the last value, so a later min-release-age=0 switches the policy off; a malformed exclude line is honoured too | One min-release-age line; exceptions only as min-release-age-exclude[]=<pkg>@<version> in the dated block; the dependency check in npm run verify catches both loopholes | verified |  | `dependency-management` |
| `deps-expo-install-range` | npx expo install writes ~57.0.x (or a caret range for a third-party package) despite save-exact=true | expo install writes the SDK range for Expo-managed packages and a caret for packages outside its map | Keep Expo's ~ ranges for SDK packages; change caret pins of packages outside Expo's module map (ads, IAP, audio libraries) to exact versions | verified |  | `dependency-management` |
| `deps-expo-patch-younger-than-7-days` | verify turns red with no change in the repo: expo install --check prints "expected version: ~57.0.x" or expo-doctor fails "Patch version mismatches" | Expo published a patch less than 7 days ago; the fix the tools print (install it) is refused by the release-age rule | The dependency check reads the publish time (npm view <pkg> time) and prints a warning with the due date instead of failing; on that date run npx expo install <pkg>@~<version> and update the versions table in the same commit; never add an exclude block for it | verified |  | `dependency-management` |
| `deps-expo-same-day-patch` | The dependency check fails right after npx expo install: the installed SDK package is one patch above the versions table | A bare npx expo install takes a same-day patch from Expo's online versions list | Install with the table spec (npx expo install <pkg>@<table spec>); the newer patch stays a warning until it is 7 days old | verified |  | `dependency-management` |
| `deps-typescript-eslint-two-copies` | ESLint crashes: ConfigError: ... Key "plugins": Cannot redefine plugin "@typescript-eslint" | Two copies of @typescript-eslint/eslint-plugin: eslint-config-expo's caret range resolved a newer release while typescript-eslint nested its own | Pin every @typescript-eslint/* package to the typescript-eslint version with root overrides, npm install, and check npm ls @typescript-eslint/eslint-plugin shows one version | verified |  | `dependency-management` |
| `deps-duplicate-native-peer` | npx expo-doctor prints "Found duplicates for <native module>" (react-native-screens, react-native-safe-area-context ...) | Two versions of one native module in node_modules: a peer or a workspace pulled the newest release next to the one the app installs | Add a root override at the version the app installs (npx expo install chooses it), npm install, then npm ls <pkg> shows one copy | verified |  | `dependency-management` |

## Held-back majors

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `deps-hand-installed-rn` | npm latest react or react-native differs from the SDK pins | Only the Expo SDK decides the React and React Native versions | Never install either by hand; npx expo install --fix | verified |  | `dependency-management` |
| `deps-eslint-10-crash` | ESLint 10: contextOrFilename.getFilename is not a function (eslint-plugin-react) | eslint-config-expo 57 pulls eslint-plugin-react and eslint-plugin-import releases whose peers stop at ESLint 9 | Pin eslint 9.39.5; move only when eslint-config-expo ships ESLint-10-ready plugins | verified (eslint-config-expo 57.x) |  | `dependency-management` |
| `deps-typescript-7` | TypeScript 7 installed: typescript-eslint and other tools break | TypeScript 7 ships no compiler API yet; typescript-eslint 8 peers typescript below 6.1; Expo pins ~6.0 | Stay on TypeScript ~6.0.3 until typescript-eslint supports 7 and Expo lists it | verified (typescript-eslint 8.x) |  | `dependency-management` |
| `deps-jest-30` | Jest 30 breaks the jest-expo preset | jest-expo 57 depends on Jest 29 packages; SDK 57 pins jest ~29.7 | Stay on Jest 29.7 until the jest-expo of the SDK depends on Jest 30 | documented (jest-expo 57.x) |  | `dependency-management` |
| `deps-test-renderer-1-3` | Component tests fail oddly after installing @testing-library/react-native alone (npm ls shows test-renderer 1.3) | npm's automatic peer install picks test-renderer 1.3, which targets React 19.3 (SDK 58); SDK 57 is React 19.2, whose companion is test-renderer 1.2.0 | Install both in one command: npm install --save-dev --save-exact @testing-library/react-native@14.0.1 test-renderer@1.2.0; npm ls test-renderer shows 1.2.0 | verified (expo 57.x) |  | `unit-and-component-tests` |
| `deps-rngh-legacy-tag` | npm offers a newer react-native-gesture-handler 2.x (legacy tag) or 3.x | It is outside Expo SDK 57's ~2.32 range; Gesture Handler 3 renames the callbacks | Stay on what npx expo install picks; move with the SDK upgrade | documented (expo 57.x) |  | `dependency-management` |
| `deps-rn-plugin-stale` | eslint-plugin-react-native blocks an ESLint upgrade | It has had no release for a long time and caps its peer range at ESLint 9 | Drop the plugin when it blocks an upgrade; its rules are nice to have | documented |  | `dependency-management` |

## Install scripts

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `deps-approve-scripts-exit` | npm approve-scripts --allow-scripts-pending exits 0 even with unreviewed install scripts | The command reports but never fails | Fail unless its output says "No packages with unreviewed install scripts." (the dependency check does) | verified |  | `dependency-management` |
| `deps-lefthook-postinstall` | npm flags lefthook's postinstall as an unreviewed install script, or lefthook writes lefthook.yml into an enclosing repo from a nested app | lefthook installs its hooks in postinstall, and from a nested folder it finds the outer repo's .git | Install hooks with the guarded prepare script (node scripts/hooks/install-git-hooks.ts) that installs only at the repo root; keep lefthook in allowScripts (npm 11.17 omits .bin/lefthook when its script is denied) | verified |  | `quality-gates` |
| `deps-skia-postinstall` | The Skia install needs an approved install script | @shopify/react-native-skia downloads prebuilt binaries in an install step on SDK 57 | Read the script, approve it in allowScripts, and drop the approval when an upgrade no longer has it | verified (@shopify/react-native-skia 2.6.x) |  | `dependency-management` |
| `deps-fsevents-install-script` | fsevents appears as a pending install script after an install | An optional macOS file-watcher dependency of Jest ships a node-gyp rebuild script (npm explain fsevents shows the path) | Approve it like the other known install scripts (it never ships in the app), then rerun the dependency check | verified |  | `dependency-management` |

## Packages

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `deps-npm-audit-fix` | npm install prints "N moderate severity vulnerabilities" and suggests npm audit fix | The advisories are usually in build tooling (config plugins, test tools) that never ships in the app | Never run npm audit fix (with --force it moves expo off the SDK); review each advisory and upgrade the owning package deliberately | verified |  | `dependency-management` |
| `deps-fresh-packages` | A just-published package (hours or days old) breaks after install | Brand-new releases of fast-moving packages (ads, IAP, audio) regularly ship regressions | Respect the 7-day release age, pin exactly, test risky ones on their test tiers, and note the rollback version | documented |  | `dependency-management` |
| `deps-pre1-pinning` | A 0.x native package behaves differently after a minor bump, or npx expo install picks no version for it | It is pre-1.0 (0.x minors break) and outside Expo's module map | Pin the exact version, read the release notes on every bump, override its plugin defaults deliberately, and rerun the device smoke test | verified |  | `dependency-management` |
| `deps-companion-types` | error TS7016: Could not find a declaration file for module '<package>' | The package was installed without its companion @types package | Install both in one command (npm install -D -E <package>@<v> @types/<package>@<v>) | verified |  | `dependency-management` |
| `deps-fast-check-missing` | TS2307: Cannot find module 'fast-check' right after copying property tests | The property tests import fast-check, which a fresh app does not have | npm install -D -E fast-check@4.10.2 at the repo root, then review pending install scripts | verified |  | `unit-and-component-tests` |

## knip

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `deps-knip-skills-folder` | knip reports hundreds of unlisted dependencies or unused files in a repo that holds installed skills | knip's Jest plugin falls back to test patterns anywhere in the repo, so it reads the skills' templates and fixtures | Ignore the agent skill folders (skills/**, .agents/**, .claude/** ...) in knip.json, as the canonical knip.json does; never a wider ignore | verified |  | `quality-gates` |
| `deps-knip-expo-updates` | knip reports expo-updates as unlisted or unused | knip's Expo plugin assumes an app ships expo-updates unless the config says otherwise | Wire OTA with ota-updates (updatesConfig()), or list expo-updates in ignoreDependencies with its reason until then | verified |  | `ota-updates` |
| `deps-knip-plugin-only` | knip reports a package as unused although the app needs it | The package is used only through an app.config.ts plugin entry or native code | Check that it is really used; then list it in ignoreDependencies with its reason (contracts/knip-ignores.json) and a Gate-Change trailer | documented |  | `quality-gates` |
| `deps-knip-unlisted-binaries` | knip reports "Unlisted binaries" (plutil, pgrep, sqlite3, footprint) in scripts/ | The tooling starts macOS system tools by name; they are not npm packages | List them in ignoreBinaries with their reason; any other unlisted binary is a real finding (install it or stop calling it) | verified |  | `quality-gates` |
| `deps-knip-root-mocks` | knip reports unlisted dependencies inside __mocks__/ | Root mocks import the real libraries' types and helpers | Make sure the library is a dependency of the app; a mock for a package the app does not use is deleted | verified |  | `quality-gates` |
| `deps-knip-test-only-exports` | knip reports unused exports in src/test-only-entry.ts | Those exports are reached only through the gated require() in src/test-only.ts, which knip does not follow | Type the gate from the entry (typeof import of the entry, as the debug-menu template does) so knip sees every export as used; never ignore the file | verified |  | `debug-menu-and-test-hooks` |
| `deps-knip-template-api` | knip reports unused exports of an adopted template's API that the app never calls | knip counts only imports; the app adopted a module but uses part of it | Delete what the app does not use, or use it; never add a knip ignore for app code | verified |  | `quality-gates` |
