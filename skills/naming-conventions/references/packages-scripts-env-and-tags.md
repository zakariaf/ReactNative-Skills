# App ids, product ids, scripts, env variables, packages and tags

The names outside the source files: the iOS bundle id and Android package, store product ids, the
slug and scheme, build variants, npm scripts, environment variables, workspace packages, commit headers
and release tags. Read this when creating an app, adding a product, a script, a variable, a workspace
or a release step.

## Contents

- App ids, slug and scheme
- Ids that are already live
- Store product ids
- Variants, EAS profiles and update channels
- npm scripts
- Environment variables
- When multi-package: packages
- Commits, branches and tags (names only)

## App ids, slug and scheme

| Thing | Rule | Example |
|---|---|---|
| iOS bundle id (`ios.bundleIdentifier`) and Android package (`android.package`) | one lowercase reverse-DNS id for both, every segment starting with a letter, letters and digits only, no Java keyword segment | `com.acme.tasks` |
| Variant ids | the production id plus a variant suffix | `com.acme.tasks.dev`, `com.acme.tasks.preview` |
| Slug (`slug`) | kebab-case, stable forever (it names the EAS project) | `tasks`, `task-planner` |
| Display name (`name`) | the product's real name; variants add a marker | `Tasks`, `Tasks (Preview)` |
| iOS project (generated) | prebuild names it after `name` with spaces and punctuation removed | `Task Planner` → `TaskPlanner.xcworkspace`, scheme `TaskPlanner` |
| URL scheme (`scheme`) | lowercase letters and digits, `-` allowed; variants differ so they install side by side | `tasks`, `tasks-dev` |

Why the id is this strict: Apple allows letters, digits, `-` and `.` in a bundle id; Android allows
letters, digits and `_`, and wants each segment to start with a letter (Expo's `android.package`
documentation). Lowercase letters and digits are the intersection, so one id works on both stores and
in both projects that prebuild generates. The Android package also becomes the namespace of generated
Java and Kotlin sources (`BuildConfig`, `R`, `MainActivity`), so a segment that is a Java keyword
(`com.acme.new`, `com.acme.class`) breaks the Android build even though the store would accept it; this
comes from the Java package rules, not from a build run here. Keep iOS and Android on the same id: deep
link files (`apple-app-site-association`, `assetlinks.json`), support tooling and store listings then
name the app the same way.

The generated iOS project name matters to anything that calls `xcodebuild` itself (the local build
lane, a CI script): `-workspace ios/TaskPlanner.xcworkspace -scheme TaskPlanner`. Because it follows
`name`, a variant that changes the display name changes it too: a clean prebuild with
`Tasks (Preview)` writes `ios/TasksPreview.xcworkspace`. Find the workspace in `ios/` instead of
hard-coding it, and never rename the display name to rename a script's target. Verified on 2026-10-03
by reading `@expo/cli` 57.0.27 (`build/src/prebuild/renameTemplateAppName.js` replaces the
template's `HelloWorld` with `IOSConfig.XcodeUtils.sanitizedName(name)`, which drops every
non-word character and `_`; the same pass renames the Gradle root project, while the folders stay
`android/` and `android/app/`). Re-verify: in a scratch
copy, `npx expo prebuild --platform ios --clean --no-install`, then `ls ios`.

`check-file-names.mjs` (`app-id`) reads the ids in `app.config.ts` (or `.js`/`.mjs`) and `app.json`, and
checks the shape, the keyword segments, iOS = Android, and the slug:

- **`bundleIdentifier` and `package`:** a literal value, or the literal the expression comes from,
  followed back through the file: a const (`package: id` with `const id = \`${BASE_ID}${suffix}\``
  leads to `BASE_ID`) or an id property (`bundleIdentifier: identity.appId` leads to
  `appId: 'com.acme.tasks'` in app-variants-and-environment's identity object). A literal both
  platforms share is reported once.
- **Expo's variant shapes:** every literal the expression can take. Both branches of a ternary
  (`bundleIdentifier: IS_DEV ? 'com.myapp.dev' : 'com.myapp'`, Expo's variants guide, also when
  Prettier breaks it over lines), the operands of `??` and `||` (`process.env.IOS_BUNDLE_ID ??
  'com.acme.tasks'`), the static start of a template literal (`` `com.acme.tasks${suffix}` `` checks
  `com.acme.tasks`; a last segment the template may continue is not judged as a Java keyword), and
  the `return` literals of a function in the same file the expression calls
  (`bundleIdentifier: getUniqueIdentifier()`, Expo's EAS tutorial). Inside such an expression only a
  literal that could be an id counts (not empty, no vendor characters; a template start needs two
  dot-separated parts). iOS and Android are compared literal by literal when both sides resolve to
  whole literals of the same count (the two branches of one ternary, the returns of one function);
  the product-id base is then the shortest valid id (`com.myapp`, not `com.myapp.dev`).
- **Id constants and properties:** a const named exactly like an id (`BASE_ID`, `APP_ID`,
  `BUNDLE_ID`, `PACKAGE_NAME`, `APPLICATION_ID`, `bundleId`, `appId`) unless its value is a vendor id;
  a longer name that ends like one (`IOS_BUNDLE_ID`) and an `appId`/`bundleId`/`applicationId`
  property only when the value looks like reverse-DNS (two or more dot-separated parts). A vendor id
  is never read as the app id: AdMob's `ca-app-pub-…~…`, Firebase's `1:…:ios:…`, Facebook's numeric
  `FACEBOOK_APP_ID`, an `appId: 'a1b2c3d4'` in a plugin's options.
- **`app.json` and `app.config.ts` together:** Expo passes `app.json` to the code config as `config`,
  and a key the code config sets, literal or computed, wins over `app.json`.

Limits: the checker reads the file, it does not run it. Not checked: an id with no literal in the
expression chain (`process.env.BUNDLE_ID` alone), an id built in another file (an imported
`variantIdentity()` whose literal lives in `src/config/`, unless the app config also holds the
`appId: '...'` property it reads), a member of a call's result (`variantIdentity(BASE, variant).appId`),
and the part of a template literal after its first `${...}`. iOS and Android are not compared when
one side is a template start or the two sides resolve to different numbers of literals. When several
`appId` properties look alike (none reverse-DNS) the first in the file is taken as the one
`bundleIdentifier` reads. Verified on 2026-10-03 against the two shapes Expo documents,
<https://docs.expo.dev/build-reference/variants/> (a ternary) and
<https://docs.expo.dev/tutorial/eas/multiple-app-variants/> (`getUniqueIdentifier()`); the self-test
cases `bad-app-id-ternary`, `bad-app-id-function`, `bad-app-id-fallback` and
`pass-app-id-variant-shapes` hold them (re-verify: reread both pages, then
`node ${CLAUDE_SKILL_DIR}/scripts/selftest.mjs --case 'bad-app-id-*'`). The app-variants-and-environment
skill owns how variants derive their ids (`com.acme.tasks.dev`); a placeholder such as `com.example.*`
is a release-gate problem that the release skills catch.

## Ids that are already live

The shapes above are for new apps. Once an id is live it is permanent, whatever its shape: Apple
allows capitals and `-` in a bundle id (`com.Acme.Tasks`), Android allows `_` (`com.acme.tasks_app`),
and many published apps carry different ids on the two platforms. Changing a live bundle id or
package publishes a different app: existing installs never update, purchases and subscriptions stay
with the old listing, and universal links and app links stop matching. Changing a live slug detaches
the EAS project (builds, updates, credentials). So an agent never "fixes" one: it stops, asks the
developer, and records the confirmed facts in `contracts/naming.json`:

```json
"publishedAppIds": [
  { "id": "com.Acme.Tasks", "platform": "ios", "why": "live on the App Store since 2023" },
  { "id": "com.acme.tasks_app", "platform": "android", "why": "live on Google Play since 2023" }
],
"publishedSlugs": [{ "slug": "TasksApp", "why": "the EAS project since 2023" }],
"publishedProductIds": [{ "id": "Premium-Monthly", "why": "App Store only, sold since 2023" }]
```

`app-id` then accepts each listed id for its platform (`both` covers a shared id), skips the
iOS = Android check when both ids are live (or when the live one could never be matched by a valid
new id), and still checks every other id: a new variant (`com.acme.tasks.preview`), a second app, or
the platform that is not live yet. `product-id` accepts a listed product as it is. Each entry needs
a `why`, so the reviewer sees what was decided and when.

## Store product ids

In-app products and subscriptions are `<app id>.<product>`: `com.acme.tasks.premium`,
`com.acme.tasks.premium_yearly`. Each store keeps product ids unique within one app only, so the
prefix is for everything that sees several apps' products side by side: a receipt server, a
subscription dashboard, analytics, store reports.

- **Valid on both stores:** lowercase letters, digits, `_` and `.`, starting with a letter or a digit.
  Google Play allows exactly these ("Create an in-app product"); the App Store also allows capitals
  and hyphens, up to 100 characters ("In-App Purchase information"), so the intersection is the rule.
- **At most 40 characters:** Google Play's limit for subscription product ids ("Create and manage
  subscriptions"); one limit for every kind keeps a later conversion possible.
- **Never `android.test*`:** Google reserves `android.test` and every id that starts with it.
- **Permanent:** Google Play ids cannot be changed or reused once created; an App Store id is not
  editable after it is saved and cannot be reused in the same app, even after its product is deleted
  (App Store Connect help, re-read on 2026-10-03). So a product id is created only after the
  developer confirms it (in-app-purchases owns the products), and one that already exists in another
  shape is recorded in `publishedProductIds`, never renamed.

**A long app id.** The two rules can collide: with `com.acmecorporation.taskplanner` (31 characters),
`com.acmecorporation.taskplanner.premium_yearly` is 46. When `<app id>.<product>` would pass 40
characters, the product id is `<last app-id segment>.<product>`: `taskplanner.premium_yearly`. The short
form is accepted only then, so `taskplanner.pro` fails while `com.acmecorporation.taskplanner.pro`
(35) fits, and the `product-id` fix names the short form whenever the full one is too long.

Verified on 2026-10-03 against Play Console help "Create and manage subscriptions" and "Create an
in-app product" (support.google.com/googleplay/android-developer, answers 140504 and 1153481) and App
Store Connect help "In-App Purchase information" (developer.apple.com/help/app-store-connect). Store
rules change without notice: re-read those three pages before creating the first product of an app,
and update `assets/naming-rules.json` (`productId`, `productIdMaxLength`, `reservedProductPrefix`) and
this list together.

List them in `contracts/naming.json` `storeProductIds`; `product-id` checks each against the rules and
against the app id read from `app.config.ts` (the first valid id it finds), and names the short form
in its fix when the full one is too long.

## Variants, EAS profiles and update channels

| Name | Values | Rule |
|---|---|---|
| `APP_VARIANT` | `development`, `preview`, `production` | the EAS convention; one name per build kind |
| `eas.json` build profiles | `development`, `preview`, `production` | the same words as the variants |
| EAS Update channels | `development`, `preview`, `production` | one channel per profile, same name |
| Branches of EAS Update | `<channel>` or `<channel>-<topic>` | kebab-case |

One word per build kind everywhere (variant, profile, channel, icon set, store track) means a grep for
`preview` finds every piece of that lane. The app-variants-and-environment, eas-build-and-submit and
ota-updates skills own what each does.

## npm scripts

A script name is `<verb>` or `<area>:<verb>`, kebab-case words joined by `:` (`npm-script-name`; regex
`^[a-z0-9]+(-[a-z0-9]+)*(:[a-z0-9]+(-[a-z0-9]+)*)*$`):

| Script | Runs |
|---|---|
| `start`, `ios`, `android`, `web` | Expo's defaults (the template writes them) |
| `lint`, `typecheck`, `test`, `format`, `format:check` | the base gates |
| `check:fast`, `verify` | the pre-commit and pre-push gate bundles (quality-gates owns them) |
| `test:golden`, `test:sim`, `test:coverage`, `test:mutation` | the Jest projects and extra runs |
| `check:unused` | knip (expo-doctor flags a script named like a binary, such as `knip`) |
| `i18n:verify`, `audit:licenses`, `e2e:ios`, `e2e:android`, `build:android:emulator` | area tasks |

Scripts that CI, git hooks or docs call by name are canonical: list them in `contracts/naming.json`
`canonical.npmScripts`, and `canonical-name` fails when one disappears.

## Environment variables

- UPPER_SNAKE_CASE always (`env-var`).
- A value the app reads at run time is prefixed `EXPO_PUBLIC_` (Expo inlines those, only with dot
  access: `process.env.EXPO_PUBLIC_API_URL`) and declared in `src/env.d.ts`. Everything in an
  `EXPO_PUBLIC_` variable ships inside the bundle on both platforms: never a secret.
- Read each variable by name at the place it is used. Destructuring (`const { EXPO_PUBLIC_API_URL } =
  process.env`), a copy (`const env = process.env`), a spread, passing `process.env` as an argument,
  and a computed or template key (`` process.env[`EXPO_PUBLIC_${name}`] ``) are never inlined, so each
  is `undefined` in a release build on iOS and Android; `env-var` fails them in app code. Expo's
  environment-variables guide names destructuring and bracket access as invalid. The canonical ESLint
  config (through eslint-config-expo 57.0.2) adds `expo/no-env-var-destructuring` for destructuring
  and `expo/no-dynamic-env-var` for `const x = process.env[key]`; `env-var` also catches a copy, a
  spread, an argument and a computed key anywhere, and runs without `node_modules`. Verified on
  2026-10-03 by transforming each form with babel-preset-expo 57.0.13 (Metro caller, iOS, production
  and development): dot access, optional chaining (`process.env?.EXPO_PUBLIC_X`) and, today, a plain
  string key (`process.env['EXPO_PUBLIC_X']`) were inlined; destructuring, a copy, a spread, a
  variable key and a template key were not. The checker keeps failing the plain string key because
  the guide calls it invalid and the bundler may stop accepting it. Re-verify: read
  `node_modules/babel-preset-expo/build/plugins/inline-env-vars.js`, or run `@babel/core`
  `transformSync` with `babel-preset-expo` on a probe file.
- Expo also inlines its own variables, and app code may read them with dot access:
  `process.env.EXPO_OS` (`'ios'`, `'android'` or `'web'`; Expo's skills prefer it to `Platform.OS`),
  `process.env.EXPO_SERVER`, `process.env.EXPO_BASE_URL`, and `process.env.NODE_ENV` (inlined as
  `'production'` in production builds). Verified on 2026-10-03 by reading babel-preset-expo 57.0.13
  (`build/configs/expo.js`, `getInlinesFromOptions`). Re-verify:
  `grep -n "process.env" node_modules/babel-preset-expo/build/configs/expo.js`, and keep
  `assets/naming-rules.json` `expoInlinedEnv` in step.
- App code reading any other variable, or reading one with `process.env['X']`, fails `env-var`: the
  bundler does not inline it, so it is `undefined` in a release build. The fix is never to rename a
  secret to `EXPO_PUBLIC_`: move server-only code to the server, or declare a Node-only file.
- **Server code** runs in Expo's server runtime, never in the app bundle: Expo Router API routes
  (`src/app/**/<name>+api.ts`), server middleware (`src/app/+middleware.ts`) and the `src/server/`
  folder of helpers they share. Expo's API-routes guide: server routes "have access to all environment
  variables, not just the ones prefixed with `EXPO_PUBLIC_`", and a secret in an `+api.ts` file is not
  included in the client bundle (verified on 2026-10-03 at docs.expo.dev/router/web/api-routes and
  /router/web/middleware). Server code reads secrets under plain names (`process.env.DATABASE_URL`;
  `env-var` accepts any form there, but write dot access anyway, because
  `expo/no-env-var-destructuring` lints every file). An `EXPO_PUBLIC_` name whose words say it holds a
  secret (`SECRET`, `PRIVATE`, `PASSWORD`, `PASSWD`, `TOKEN`, `CREDENTIAL`, `KEY`, `APIKEY`, `SALT`:
  `assets/naming-rules.json` `secretEnvWords`) fails `env-var` there: the prefix means the value is
  inlined into the app too, so a secret carrying it has already shipped (rename it and rotate it). A
  public value may keep the prefix on the server as in the app (`process.env.EXPO_PUBLIC_SITE_URL` in
  a redirect): server routes "have access to all environment variables", the `EXPO_PUBLIC_` ones
  included. A public SDK key the server needs is rare: read it under a plain name.
- **The `src/server/` exemption holds only while nothing bundled imports `src/server/`:** an app
  file that imports a server helper pulls it into the app bundle, where its plain `process.env` reads
  are `undefined` and anything secret written in it ships ("Client code that imports code with a
  secret is included in the client bundle", the API-routes guide, re-read on 2026-10-03). That import
  is a boundary, not a name, so architecture-and-boundaries checks it: record `src/server/**` in its
  contract's `serverFiles`, and its `server-boundary` rule fails any bundled import of a server file.
  Import server helpers only from `+api.ts` routes and middleware.
- Node-run code (`app.config.ts`, `plugins/`, `scripts/`, tests, and any `src/` file listed in
  `contracts/naming.json` `nodeCode`, such as a module only `app.config.ts` imports) may read any
  variable.
- Build-time variables have plain names (`APP_VARIANT`); EAS secrets and credentials are referenced by
  name only (`SENTRY_AUTH_TOKEN`, `EXPO_TOKEN`), never their values.
- Variables the build depends on are canonical: list them in `canonical.envVars`; `canonical-name`
  fails when nothing reads one any more (a renamed variable silently becomes `undefined`).

## When multi-package: packages

| Thing | Rule | Example |
|---|---|---|
| Workspace package | `@<scope>/<folder>`, one scope for all | `@acme/ui`, `@acme/billing` |
| App workspace | `apps/<name>/`, kebab-case; the slug is its own stable name unless `slugMatchesAppFolder` is on | `apps/mobile` with `slug: 'acme-tasks'` |
| Package catalog keys | start with the package folder name | `billing.paywall.title` |

`check-file-names.mjs` reads `package.json` `workspaces` and checks each package's name and the one
scope (`package-name`). Renaming the scope is one search-and-replace over the manifests and imports.
Renaming a slug is not: it names the EAS project (builds, updates, credentials), so `app-id` never
asks for it. With `"slugMatchesAppFolder": true` in `contracts/naming.json` (for a repo that wants one
name per app), a mismatch fails and the fix is to rename the folder.

## Commits, branches and tags (names only)

The git-commits-and-reporting skill owns commit bodies, trailers and reports; these are the name
formats:

| Name | Format | Example |
|---|---|---|
| Commit header | `<type>(<scope>): <subject>`, at most 72 characters, imperative, lowercase start, no trailing period | `feat(tasks): add due dates` |
| Commit type | `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `style`, `revert` | |
| Commit scope | a feature folder (`tasks`, `settings`), a layer (`ui`, `data`, `i18n`), or `repo`, `deps`, `ci`, `release` | |
| Branch (when used) | `<type>/<scope>-<slug>` | `feat/tasks-due-dates` |
| Release tag | `v<X.Y.Z>` (multi-package: `<app>/v<X.Y.Z>`) | `v1.4.0`, `planner/v1.4.0` |
| Build tag (optional) | `v<X.Y.Z>+<build>` | `v1.4.0+57` |

`X.Y.Z` is `version` in `app.config.ts`; `<build>` is the iOS build number / Android version code.
Both tag forms pass `git check-ref-format`. Never move or reuse a tag.
