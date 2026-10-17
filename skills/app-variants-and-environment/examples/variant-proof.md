# Variant proof: a worked run

The proof this skill asks for after a change to variants, the test-only gate, `metro.config.js` or the
variables: the merge checked by a config diff, the icons drawn, a prebuild per variant, both checkers
on the repo, then two exports made back to back and checked against their variant. This is a real run
from 2026-10-03 in a copy of the reference app (Expo SDK 57, expo 57.0.26, `@expo/cli` 57.0.27, Node
26.4), whose identity is `Harness` / `com.example.harness`. It had no `app.json`, no `metro.config.js`
and no eas.json; its icons were the SDK 57 template's (`assets/images/icon.png`, `assets/expo.icon/`,
`assets/images/android-icon-*.png`). A test-only gate and entry like the ones
`debug-menu-and-test-hooks` writes were added before the exports
(`TEST_BUILD_SENTINEL = 'HARNESS_TEST_BUILD_ONLY'`). The exports ran with `TMPDIR` pointed at an empty
folder, so the Metro cache started cold.

## 1. The merge and the icons

The production config was saved before the merge and after it (Workflow step 2). The diff holds only
the intended keys:

```text
$ diff dist/config-before.json dist/config-after.json
<   "icon": "./assets/images/icon.png",
>   "icon": "./assets/icons/production/icon.png",
<     "icon": "./assets/expo.icon",
>     "icon": "./assets/icons/production/expo.icon",
<       "foregroundImage": "./assets/images/android-icon-foreground.png",
<       "backgroundImage": "./assets/images/android-icon-background.png",
<       "monochromeImage": "./assets/images/android-icon-monochrome.png"
>       "foregroundImage": "./assets/icons/production/android-foreground.png",
>       "backgroundImage": "./assets/icons/production/android-background.png",
>       "monochromeImage": "./assets/icons/production/android-monochrome.png"
>       "expo-dev-client",
>       {
>         "addGeneratedScheme": false
>       }
<     "appVariant": "production",
```

The colours, splash, web output and experiments stayed. Then the badged icons:

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/make-variant-icons.mjs .
note: assets/icons/production/expo.icon (Icon Composer) stays the production iOS icon; development and preview use their badged icon.png on iOS
wrote assets/icons/development/icon.png (development badge, 1024 x 1024, the fallback icon and the iOS icon of development and preview)
wrote assets/icons/preview/icon.png (preview badge, 1024 x 1024, the fallback icon and the iOS icon of development and preview)
wrote assets/icons/development/android-foreground.png (development badge, 512 x 512, the adaptive icon foreground)
...
make-variant-icons: 4 source icons checked, 0 problems
RESULT: PASS
```

`APP_VARIANT=preview EXPO_PUBLIC_APP_VARIANT=preview npx expo prebuild --no-install --clean` then
finished on both platforms (`PRODUCT_BUNDLE_IDENTIFIER = "com.example.harness.preview"`,
`applicationId 'com.example.harness.preview'`, launcher icons generated). The production prebuild kept
the Icon Composer icon (`ASSETCATALOG_COMPILER_APPICON_NAME = expo`); the development one registered
`exp+harness`. `ios/` and `android/` were deleted afterwards.

## 2. The repo

eas.json used Expo's shared-base layout: `"base": { "node": "26.4.0", "ios": { "image": "latest" } }`
and the three variant profiles each with `"extends": "base"`.

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-variants.mjs .
check-variants: 8 config evaluations checked, 0 problems
RESULT: PASS

$ node ${CLAUDE_SKILL_DIR}/scripts/check-env.mjs .
check-env: 17 files checked, 0 problems
RESULT: PASS
```

The eight evaluations are the three variants, the four environments that must fail (an unknown name,
`APP_VARIANT` without `EXPO_PUBLIC_APP_VARIANT`, no variant with `NODE_ENV=production`, no variant with
`EAS_BUILD=true`), and the local default with the committed env files loaded. `npm run typecheck`,
`npx eslint . --max-warnings 0` and `npx jest src/config scripts/metro --ci --maxWorkers=2` (3 suites,
30 tests) passed. Without eas.json the same run prints
`SKIP eas.json [eas-profile] not yet created (eas-build-and-submit creates it)`.

Before the test-only gate existed, a production export checked as:

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-variant-bundle.mjs . --bundle dist/variant-proof/production --variant production
SKIP src/test-only.ts [bundle-sentinel] not yet created (debug-menu-and-test-hooks creates it)
check-variant-bundle: 1 bundle files checked, 0 problems, 1 skipped
RESULT: PASS
```

## 3. The exports, back to back

```sh
APP_VARIANT=development EXPO_PUBLIC_APP_VARIANT=development npx expo export --platform ios --output-dir dist/variant-proof/development
APP_VARIANT=production EXPO_PUBLIC_APP_VARIANT=production npx expo export --platform ios --output-dir dist/variant-proof/production
```

```text
dist/variant-proof/development/_expo/static/js/ios/entry-afb9aba6c9986e51dcd21514fa7b856e.hbc
dist/variant-proof/production/_expo/static/js/ios/entry-229f1b4bdba2125049a5ec4cdfba4616.hbc
```

Two different Hermes bundles. The sentinel is in the development bytecode once and in the production
bytecode zero times (`grep -a -c HARNESS_TEST_BUILD_ONLY <file>`).

## 4. The bundles against their variants

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-variant-bundle.mjs . --bundle dist/variant-proof/development --variant development
check-variant-bundle: 1 bundle files checked, 0 problems
RESULT: PASS

$ node ${CLAUDE_SKILL_DIR}/scripts/check-variant-bundle.mjs . --bundle dist/variant-proof/production --variant production
check-variant-bundle: 1 bundle files checked, 0 problems
RESULT: PASS
```

Then `rm -rf dist/variant-proof`.

## 5. Planted: the Metro cache key removed

`config.cacheVersion = '1.0'` in `metro.config.js`, a cold cache, then the same two exports:

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-variants.mjs .
FAIL metro.config.js:13 [metro-cache-key] cacheVersion is not derived from the EXPO_PUBLIC_* values: it stays "1.0" when only EXPO_PUBLIC_RNSKILLS_PROBE changes, so a changed public value (a variant, an API URL) reuses the old transforms Fix: Derive it from every EXPO_PUBLIC_* name and value (publicEnvCacheVersion in templates/scripts/metro/).
RESULT: FAIL (1 problems)

$ node ${CLAUDE_SKILL_DIR}/scripts/check-variant-bundle.mjs . --bundle dist/variant-proof/production --variant production
FAIL dist/variant-proof/production/_expo/static/js/ios/entry-afb9aba6c9986e51dcd21514fa7b856e.hbc [bundle-sentinel] the production bundle contains the test-only sentinel "HARNESS_TEST_BUILD_ONLY": test-only code shipped Fix: Gate it with process.env.EXPO_PUBLIC_APP_VARIANT === 'production' ? null : require(...) in one expression, key Metro's cacheVersion on the EXPO_PUBLIC_* values, then export again.
RESULT: FAIL (1 problems)
```

The production export carries the development bundle's own file name (`entry-afb9aba6...`): Metro
reused the development transforms, test-only code included. A key built from the variant alone
(`config.cacheVersion = process.env.EXPO_PUBLIC_APP_VARIANT ?? 'development'`) fails the same rule
(`it stays "production" when only EXPO_PUBLIC_RNSKILLS_PROBE changes`). Restoring the template line
fixed both.

## 6. Planted: an LLM key behind EXPO_PUBLIC_

`EXPO_PUBLIC_OPENAI_API_KEY=sk-proj-...` (a random fake value) in `.env.local`, read by
`src/config/ai.ts` and used by the root layout:

```text
$ node ${CLAUDE_SKILL_DIR}/scripts/check-env.mjs .
FAIL .env.local:1 [public-env-secret] EXPO_PUBLIC_OPENAI_API_KEY holds an OpenAI API key, and EXPO_PUBLIC_ values are inlined into the JS bundle Fix: ...
FAIL src/config/ai.ts:2 [public-env-secret] EXPO_PUBLIC_OPENAI_API_KEY is named like a secret, but every EXPO_PUBLIC_ value is inlined into the JS bundle and readable by anyone Fix: Call your server instead (an Expo Router API route reads the key from process.env), ...
RESULT: FAIL (2 problems)

$ node ${CLAUDE_SKILL_DIR}/scripts/check-variant-bundle.mjs . --bundle dist/variant-proof/production --variant production
FAIL dist/variant-proof/production/_expo/static/js/ios/entry-b8a7316da6a68dd7e11a99dd13bc4630.hbc [bundle-secret] the bundle contains an OpenAI API key Fix: Find where it enters (an EXPO_PUBLIC_ variable, a committed file, the app config), remove it, export again, and rotate the secret: anything in a bundle is public.
RESULT: FAIL (1 problems)
```

In Hermes bytecode a key can sit inside the packed string table sharing characters with its
neighbour (an earlier run found one as `...createRenderMask-proj-...`), which is why
`check-variant-bundle` matches bytecode without word boundaries. With the call moved into an API route
that reads `OPENAI_API_KEY`, and its helper in a `serverDirs` folder, `check-env` passes: that is
server code.

## 7. Planted in source only

Each of these failed with its own rule and passed again once removed:

| Plant | Result |
|---|---|
| `assets/icons/preview/icon.png` deleted | `FAIL assets/icons/preview/icon.png [variant-icon] icon of the preview variant names ... which does not exist: npx expo prebuild and EAS Build stop with ENOENT` |
| `developmentClient: true` on the shared base | `FAIL eas.json:6 [eas-profile] build.base (a shared base extended by development, preview, production): sets developmentClient: true, but preview builds preview`, plus the inherited flag on preview and production |
| A committed `.env` with both variables set to production | `[variant-resolve] with no variant exported locally the config builds com.example.harness / ...: .env sets the variant` and `[variant-env-file]` for both lines |
| Storybook gated by `STORYBOOK_ENABLED` imported from `src/config/` | `[inclusion-gate] the require() of ../../.rnstorybook is decided by STORYBOOK_ENABLED ...`; the literal `process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true' ? require(...) : null` passed |
| `EXPO_PUBLIC_CLAUDE_API_KEY` passed to a plugin in `app.config.ts`, `EXPO_PUBLIC_OPEN_AI_API_KEY` in `src/config/` | two `[public-env-secret]` problems |
| `src/server/llm-client.ts` reading `OPENAI_API_KEY` | `[env-reader]` until `"serverDirs": ["src/server"]`, then `[server-import]` when a feature imported it |

## What the report says

```text
Variants: development com.example.harness.dev "Harness (Dev)", preview com.example.harness.preview
"Harness (Preview)", production com.example.harness "Harness".
Still to do by the developer: eas env:set APP_VARIANT and EXPO_PUBLIC_APP_VARIANT (plain text) in the
development, preview and production EAS environments (eas build will then warn that both are set in
the profile and the environment; the profile's equal value wins).
Expected SKIPs: none.
check-variants RESULT: PASS · check-env RESULT: PASS ·
check-variant-bundle (development) RESULT: PASS · check-variant-bundle (production) RESULT: PASS
```
