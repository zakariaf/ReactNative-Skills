# First install and verification of the skeleton

The exact commands after `scaffold-app.mjs --write`, what each prints when things are right, what to
do when they are not, and the evidence recorded when the skeleton was built end to end. Read it at
workflow steps 6 to 9.

## Contents

- Install and approve install scripts
- When Expo published patches after the policy's date
- No format step
- The gate runs, one by one
- The Expo config for every variant
- Other skills' checkers on a fresh skeleton
- The first commit
- Pending gates (not failures)
- Known traps
- Verified on 2026-10-14

## Install and approve install scripts

```sh
git rev-parse --is-inside-work-tree        # true: "prepare" installs the git hooks only in a repository
npm install                                # writes package-lock.json; later installs and CI: npm ci
npm approve-scripts --allow-scripts-pending   # must print: No packages with unreviewed install scripts.
npm ls react react-native @typescript-eslint/eslint-plugin   # one version each (19.2.3, 0.86.3, 8.70.1)
```

- `npm install` runs `prepare` (`node scripts/hooks/install-git-hooks.ts`), which prints
  `sync hooks: ✔️(pre-commit, commit-msg, pre-push)` at the git top level and skips by itself
  elsewhere (an app nested inside another repository).
- `strict-allow-scripts=true` stops an install with `ESTRICTALLOWSCRIPTS` before anything runs when a
  package's install script is not in `allowScripts`. The skeleton's manifest already lists the three
  reviewed ones (`lefthook`, `unrs-resolver`, `fsevents`; root-files.md says what each does). When a
  later install lists another: read it first (`npm view <pkg>@<version> scripts`), then approve that
  one package (`npm approve-scripts <pkg>`, which works once the package is installed; before that,
  add `"<pkg>@<version>": true` by hand after reading it). Never `--dangerously-allow-all-scripts`.
- `npm install` prints an audit count ("69 vulnerabilities (18 moderate, 51 high)" on 2026-10-14; the
  number changes daily). `npm audit` is not a gate: the advisories sit in build tooling, and
  `npm audit fix --force` would move `expo` off the SDK. Never run `npm audit fix`; note the count in
  the report. Fixes arrive with Expo patch releases through dependency-management.
- `ETARGET No matching version found for <pkg>@<v> with a date before <date>`: the version is younger
  than the 7-day release age. Do not delete the lockfile or loosen `.npmrc`; dependency-management has
  the dated-exception procedure. With `--prefer-offline`, npm may read a cached package document older
  than the release it needs and report the same error for a version that is old enough: run a plain
  `npm install`.

## When Expo published patches after the policy's date

The skeleton's specifiers come from the policy seed (verified 2026-10-03). A fresh install resolves the
newest Expo patch that is at least 7 days old (on 2026-10-14: `expo` 57.0.27), whose module map may
expect newer minimums for some modules (`expo-router` `~57.0.25`, `expo-constants` `~57.0.21`,
`expo-linking` `~57.0.12`). <!-- stack-pin-ignore --> The installed versions satisfy both, so every gate
passes, but expo-sdk-upgrade's `check-sdk-alignment.mjs` (`module-map`) and dependency-management's
`check-deps-policy.mjs` (`table-map`) name each specifier to move. Follow dependency-management's
"Expo patch" procedure in the bootstrap commit: `npx expo install --fix`, move the matching policy
rows, rerun the gates. `npm run check:deps` prints patches younger than 7 days as `WARN ... refuses it
until <date>` and exits 0; on that date they become due.

## No format step

Nothing the generator writes needs formatting: the templates are Prettier-clean (the `PRE_EXISTING`
line and the `exclude` additions are written in Prettier's layout), `package.json` is never merged,
and a merged `.claude/settings.json` sits in `.claude/`, which `.prettierignore` lists, so Prettier
never reads it. `npm run -s check:fast` (its `format:check`) proves it in the next section.

## The gate runs, one by one

`npm run verify` stops at `i18n:verify` until i18n-strings-and-catalogs builds its script ("Pending
gates"), so run the gates that exist one by one and keep each output for the report:

```sh
npm run -s check:fast                         # Prettier, ESLint (cached), both tsc programs, jest --onlyChanged
npm run -s lint
npm run -s typecheck
npm run -s test:coverage                      # 19 suites, 239 tests on the skeleton; thresholds met
npm run -s check:unused                       # knip: configuration hints are fine, issues are not
EXPO_NO_TELEMETRY=1 npm run -s export:audit   # expo export, iOS and Android, with source maps, into dist-audit/
npm run -s audit:licenses                     # prints: audit:licenses: 57 shipped packages checked
rm -rf dist-audit                             # build output (git-ignored); repo scans should not read it
node scripts/quality/check-quality-gates.ts   # prints: all resolved configs match quality-gates.json
npm run -s check:npm-config
EXPO_NO_TELEMETRY=1 npm run -s check:deps     # needs the network; WARN lines for young Expo patches
npx lefthook validate                         # All good
node ${CLAUDE_SKILL_DIR}/scripts/check-skeleton.mjs .
```

`export:audit` is the only step that bundles the app: it loads `metro.config.js` (and through it the
`.ts` cache-key helper), runs Babel with the React Compiler and writes a Hermes bundle per platform
(`_expo/static/js/ios/entry-<hash>.hbc` about 1.9 MB and `android/` about 2.1 MB on the skeleton, each
with its `.map`). tsc, ESLint, Jest and `expo config` never load `metro.config.js`, so a Metro or Babel
break passes all of them. `audit:licenses` reads the export's source maps, so it runs right after
`export:audit`: every package that ships in the bundle must carry a licence the dependency policy's
`licenses` block allows (build tools never reach the bundle and are not audited). Then delete
`dist-audit/`: it is git-ignored, but a checker that walks the repo would still read the bundles
(expo-prebuild-and-config-plugins' `check-native-generation` reports the `dist-audit/` ignore line as
hiding source while the folder exists). `check:deps` runs `npx expo install --check` and `npx expo-doctor`,
the dated-exclude check, the banned-package check on the lockfile and the install-script check.

## The Expo config for every variant

```sh
export EXPO_NO_TELEMETRY=1 CI=1
APP_VARIANT=development EXPO_PUBLIC_APP_VARIANT=development npx expo config --type public --json
APP_VARIANT=preview     EXPO_PUBLIC_APP_VARIANT=preview     npx expo config --type public --json
APP_VARIANT=production  EXPO_PUBLIC_APP_VARIANT=production  npx expo config --type public --json
APP_VARIANT=production npx expo config --type public --json      # must fail
```

Expect, for `com.acme.tasks` / "Tasks": `Tasks (Dev)`, `com.acme.tasks.dev` as both
`ios.bundleIdentifier` and `android.package`, scheme `tasks-dev`, icons from
`assets/icons/development/`; `Tasks (Preview)`, `.preview`, `tasks-preview`; `Tasks`,
`com.acme.tasks`, `tasks`, `assets/icons/production/`. Every variant: `updates.enabled: false`,
`android.predictiveBackGestureEnabled: true`, three plugins (`expo-router`, `expo-dev-client` with its
generated scheme only in development, `expo-splash-screen`). The last command fails with
`EXPO_PUBLIC_APP_VARIANT= must equal APP_VARIANT=production: the JS bundle and the native app must
agree`. `--type introspect` resolves the generated Info.plist and AndroidManifest values the same
way; prebuild itself belongs to the build skills.

## Other skills' checkers on a fresh skeleton

Run on the installed skeleton of 2026-10-14. These pass: quality-gates (`check-gate-wiring`,
`check-bypasses`), typescript-and-lint-rules (`check-configs`, `check-source`),
architecture-and-boundaries (`check-layout`, `check-boundaries`), naming-conventions,
app-variants-and-environment (`check-variants`, `check-env`), unit-and-component-tests
(`check-test-setup`, `check-test-code`), expo-prebuild-and-config-plugins (`check-native-generation`,
with `dist-audit/` deleted after the export),
tdd-workflow (`check-tests`), react-components-and-hooks, async-safety, motion-and-animation and
rtl-and-direction. Their expected SKIP lines:

```
SKIP scripts/i18n/verify-catalogs.ts [script-target] not yet created (i18n-strings-and-catalogs creates it)
SKIP .maestro [maestro-selector] not yet created (e2e-maestro creates it)
SKIP src/i18n/catalogs [i18n-key] not yet created (i18n-strings-and-catalogs creates it)
SKIP eas.json [eas-profile] not yet created (eas-build-and-submit creates it)
SKIP src/ui/a11y/motion-config.tsx [reduce-motion-root] not yet created (accessibility-as-code creates it)
SKIP src/i18n/languages.ts [direction-module] not yet created (i18n-strings-and-catalogs creates it)
SKIP src/i18n/languages.ts [direction-before-render] not yet created (i18n-strings-and-catalogs creates it)
```

These report the foundation their skill adds next (project-layout.md, "What the bootstrap leaves
out"); each finding disappears at that skill's step: error-handling-typed-results `check-error-net`
(`net-single`, `root-boundary`), i18n-strings-and-catalogs `check-i18n-code` (`polyfill-first`,
`verify-script`, `i18n-runtime`), design-system-structure `check-design-system` (exit 2: no
`src/theme`), accessibility-as-code `check-a11y-code` (`screen-test-audit` on the starter test),
app-startup-and-bootstrap `check-startup` (`splash-hold`, `provider-order`), navigation-and-routing
`check-navigation` (`contract`, `not-found`). dependency-management `check-deps-policy` and
expo-sdk-upgrade `check-sdk-alignment` pass once the specifiers match the installed SDK patch (the
section above).

## The first commit

```sh
git status --short        # anything else uncommitted is the developer's and stays out of this commit
git add package.json package-lock.json .npmrc .nvmrc .gitignore .prettierrc.json .prettierignore \
  tsconfig.base.json tsconfig.json tsconfig.stryker.json eslint.config.mjs knip.json lefthook.yml \
  quality-gates.json .claude/settings.json AGENTS.md CLAUDE.md babel.config.js jest.config.js \
  jest.setup.ts jest.sim.config.js stryker.config.json app.config.ts metro.config.js contracts scripts src assets
git commit -m "chore(repo): scaffold the app and its gates" -m "Gate-Change: initial quality gates"
```

Stage exactly the files the generator wrote, never `git add -A`: pre-existing folders and the
developer's own changes belong in their own commits, which the developer decides; name them in the
report. The commit stages gated files, so the trailer is required: without it the commit-msg hook
fails with `[gate-change-missing] gated files changed without Gate-Change: ...`, and a header such as
"Updated stuff." is rejected. The pre-commit hooks (no-secrets, format, lint, typecheck,
test-related) and commit-msg run; never `--no-verify` (the agent settings deny it anyway). Pushing is
outward-facing: only when the developer asks, and then `pre-push` runs `npm run verify`.

## Pending gates (not failures)

| Gate | State after the bootstrap | Green when |
|---|---|---|
| `npm run i18n:verify` | `scripts/i18n/verify-catalogs.ts` does not exist (`MODULE_NOT_FOUND`) | i18n-strings-and-catalogs writes it with the first catalogs |
| `npm run verify` | `verify: step "i18n:verify" failed (exit 1); later steps did not run` | the script above exists |
| `npm run test:sim` | not part of verify until a `*.sim.test.ts` exists | the first simulation (games plugin) |

Report them in plain words ("the full pre-push check stops at the translation check, which arrives
with the first texts; every check that exists passes on its own"). Never stub a script so `verify`
passes.

## Known traps

- Dev tools never go through `npx expo install`: `-- --save-dev` puts the package into
  `dependencies`, and `--dev` writes Expo's `~` range into `devDependencies`, which `pin-exact`
  rejects (every devDependency is exact). Install a dev tool with `npm install -D <pkg>@<policy
  version>`; an Expo-map dev tool (`typescript`, `jest-expo`, `eslint-config-expo`) is pinned exactly
  inside Expo's range. For a runtime package outside Expo's module map, `npx expo install` runs
  `npm install` at npm `latest`: use `npm install <pkg>@<exact>`. dependency-management owns this rule
  and the policy rows.
- Every ESLint run crashes with `Cannot redefine plugin "@typescript-eslint"`: two copies of
  `@typescript-eslint/eslint-plugin` are installed. Restore the ten `overrides` rows at the
  `typescript-eslint` pin, make sure no `.npmrc` exclude names `typescript-eslint`, `npm install`, and
  check `npm ls @typescript-eslint/eslint-plugin` (`root-overrides`).
- knip failing with hundreds of "Unlisted dependencies" under `skills/` or `.agents/`: `knip.json`
  lost an agent folder from `"ignore"`; restore it from the template.
- knip reporting `expo-updates` as unlisted for `app.config.ts`: the config lost
  `updates: { enabled: false }`; restore it until ota-updates installs expo-updates.
- `ESTRICTALLOWSCRIPTS` for `fsevents@2.3.3` on the first macOS install: the manifest lost its
  `allowScripts` row; restore it (root-files.md).
- A first Jest run takes about 40 s (cold transform cache); later runs a few seconds.
- `npm ls --parseable` redacts UUID-like path segments as `***`; read `package-lock.json` instead.
- `expo config` failing with "Cannot find module ./src/config/app-variant": an import in
  `app.config.ts` lost its `.ts` extension (`app-config`).
- `export:audit` is the step that proves Metro, Babel and the React Compiler bundle for both
  platforms. A broken `metro.config.js`, or a Node without type stripping (older than 22.18, so the
  `.ts` cache-key helper cannot load), fails there and nowhere earlier: with a misspelt helper path,
  `typecheck`, `lint` and `expo config` all exited 0 and only the export failed with
  `Cannot find module './scripts/metro/...'`.

## Verified on 2026-10-14

In an empty git repository with a pre-existing `docs/notes.md`, Node 26.4.0, npm 11.17.0, macOS:

- `scaffold-app.mjs . --app-id com.acme.tasks --name "Tasks" --write` wrote 96 files; the dry run
  afterwards printed `0 new, 0 merged` and `RESULT: PASS`; `docs/` went into the three ignore lists.
- `npm install`: 1,308 packages in 24 s, hooks synced; before `fsevents@2.3.3` joined `allowScripts`
  the install stopped with `ESTRICTALLOWSCRIPTS` and `npm approve-scripts fsevents` answered
  `ENOMATCH` (nothing installed yet). Afterwards `--allow-scripts-pending` printed
  `No packages with unreviewed install scripts.`; one `react` (19.2.3), one `react-native` (0.86.3),
  one `@typescript-eslint/eslint-plugin` (8.70.1, overridden).
- Green: `format:check`, `lint`, `typecheck`, `test:coverage` (19 suites, 239 tests; 96.55 %
  statements, 95.45 % branches, 91.66 % functions, 96.29 % lines), `check:unused`, `export:audit`
  (about 6 s; `entry-<hash>.hbc` 1.9 MB for iOS and 2.1 MB for Android, each with a source map),
  `audit:licenses` (`57 shipped packages checked`), the guardrail
  (`all resolved configs match quality-gates.json`), `check:npm-config`, `check:deps` (exit 0 with
  WARN lines for five patches published 2026-10-12), `lefthook validate` (`All good`),
  `check-skeleton.mjs .` `RESULT: PASS`.
- `expo config` for the three variants as above; `APP_VARIANT=production` alone failed.
- The first commit: "Updated stuff." rejected; the commit without the trailer rejected with
  `gate-change-missing`; the real commit went through typecheck, test-related, lint and commit-msg in
  5.5 s. `npm run verify` stopped at `i18n:verify` as expected; the PostToolUse hook command exited 0
  on the starter screen and the Stop hook command exited 0.
- On top of an unpacked `create-expo-app` default template (SDK 57), the dry run planned 89 new files,
  merged `.gitignore`, kept the template's splash and favicon images, and reported 23 leftovers (the
  demo code, `app.json`, the root `assets/expo.icon/` and 13 demo images) and 4 conflicts (`package.json`, `src/app/_layout.tsx`, `src/app/index.tsx`, `tsconfig.json`).
- Not run here: prebuild and native builds (the build skills own them).
