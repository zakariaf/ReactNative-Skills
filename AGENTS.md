# AGENTS.md

How any AI coding agent (Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf, Cline, OpenCode, ...)
uses the skills in this repository on a React Native app built with Expo. Copy the sections "How to
work with the skills" and "Which skill to load" into your app's own `AGENTS.md` when the skills are
installed there.

## What the skills are

Each skill is a folder with a `SKILL.md` (at `skills/<name>/SKILL.md` here, or wherever your agent
installs skills). Its frontmatter `description` says what it does and when it applies ("Use when ...")
and which neighbour owns the nearby work ("Not for ... (other-skill)"). Its body has, in order: Rules
that must hold (numbered, each with its reason), Workflow, Definition of done, Anti-patterns, Files in
this skill, Related skills. Most skills also carry `references/` (read on demand), `templates/` (real
files to copy into the app; line 1 names the repo path), `scripts/` (the checkers) and
`tests/fixtures/` (the checkers' own planted-bug self-test).

## How to work with the skills

1. **Start at the front door.** Read `react-native-conventions-index` first for any task. Its task
   table names the skills each kind of task needs (the first one leads) and its build orders say what
   to build first for a new app, a new feature and a release.
2. **Load every skill the matching rows name, the lead first,** and read each one's Rules and
   Definition of done before writing code. Several rows can apply: load the union. When no row fits,
   use the intent map below and load every skill whose "Use when" matches; never guess a skill's
   content from its name. Skills the developer names in the task are binding.
3. **Follow the workflow and copy the templates** instead of improvising: the templates already
   compile under the canonical configs and their tests ship with them.
4. **Prove the work.** Every definition of done ends in commands such as
   `node ${CLAUDE_SKILL_DIR}/scripts/<check>.mjs .` that must print `RESULT: PASS`. Run them, fix every
   `FAIL <file>:<line> [<rule>] <message> Fix: <fix>` line, and rerun until they pass.
5. **Report with evidence** (below), and stop to ask where a skill says so.

`${CLAUDE_SKILL_DIR}` in a skill means the folder that contains that SKILL.md. Claude Code expands it;
agents that do not expand it substitute that path. Scripts take the app's repo root as an optional
first argument (default `.`), never `--root`; they need Node 22.18 or newer and no packages.

### Reading check results

| Output | Meaning |
|---|---|
| `RESULT: PASS`, exit 0 | The rule set holds. |
| `SKIP <file> [<rule>] not yet created (<skill> creates it)` | One rule waits for a file another skill or a later step creates. Counts as a pass; name it in the report. |
| `NOT APPLICABLE: <fact>`, exit 0 | A repo fact proves the whole check does not apply (for example, no ads package). Counts as a pass. |
| `RESULT: FAIL (<n> problems)`, exit 1 | Fix each `FAIL` line; never weaken the check or edit a test to pass. |
| `ERROR [...]`, exit 2 | Bad input or nothing to check (wrong folder, missing target). Never a pass. |

Release, store-artifact and completeness gates never SKIP. Their only relaxation is `--rehearsal`, which
prints `REHEARSAL: not a release gate` and is never release evidence.

### Loading in Claude Code

Installed from the marketplace, the skills are namespaced by plugin: `/react-native:<skill>` for the 73
core skills and `/react-native-games:<skill>` for the 6 optional game skills. They load on their own
when a task matches; a task can also name them ("Skills: forms-and-input tdd-workflow"). The `run-*`
skills (`run-migration`, `run-goldens-rebaseline`) are side-effecting runbooks that load only when
invoked by name; they stop and ask before the irreversible step.

## House rules

Each rule is stated once, in its owner skill. Every task keeps them:

- Test-first, one behaviour per commit, no test edited to pass: `tdd-workflow`.
- Gates (`check:fast`, `verify`, hooks) are never weakened or bypassed: `quality-gates`.
- One Expo app with a `src/` layout and the `@/` alias, ports with fakes, one composition root:
  `architecture-and-boundaries`.
- Expo Router for navigation, thin route files: `navigation-and-routing`.
- Typed results at boundaries, no swallowed errors: `error-handling-typed-results`.
- Every visible string in the catalogs, RTL-correct layout, accessible controls:
  `i18n-strings-and-catalogs`, `rtl-and-direction`, `accessibility-as-code`.
- Versions from the verified stack, exact pins, a 7-day release age: `dependency-management`.
- No secrets in the repo or the bundle; `EXPO_PUBLIC_*` is public: `app-variants-and-environment`,
  `privacy-and-store-declarations`.
- iOS and Android both (web is opt-in: `web-support`); devices and simulators always named, never
  "the booted one": `e2e-maestro`, `ios-simulator-build`, `android-emulator-build`.
- Nothing outward-facing (push, tag push, store upload, production OTA update) without the
  developer's word in this session; never read, print or commit a key, keystore or token:
  `git-commits-and-reporting`.

## How to report

Every finished task ends with a short report (`git-commits-and-reporting` has the templates and a
checker for it):

1. The outcome first, in users' words (what now works).
2. The skills used and their `RESULT` lines, copied from the runs, with any SKIP or NOT APPLICABLE line.
3. What was not tested or not verified, and why (for example, a device-only check, one platform only).
4. Human checks that do not block (on-device review, a native-language review of new texts).
5. At most one question, answerable in a word, with the default that applies meanwhile.

When something needs a person (signing, store agreements, a 401/403 from a store API, a missing
requirement), send one message with one request and keep working on everything else. Never retry a
release stop.

## Which skill to load

The intent map below is generated from each skill's description; the index skill's task table is the
fuller router.

<!-- generated:intents:start -->
<!-- Generated by tools/build-catalog.mjs from tools/catalog.json and each SKILL.md; do not edit by hand. -->

### Start here

- `react-native-conventions-index`: use when starting or planning a task, or unsure which skill applies.

### How every change is made

- `tdd-workflow`: use when writing or changing product code or deciding what to test.
- `quality-gates`: use when a gate, hook or verify fails or a gate file changes.
- `git-commits-and-reporting`: use when committing, tagging, reporting a slice or release, or blocked on a person.
- `spec-traceability`: use when a task cites a spec ID (REQ-4, SCR-2), asks what is required or in scope, or hits a spec gap.
- `troubleshooting-playbook`: use when something errors, crashes, hangs or renders wrong, or a log needs explaining.
- `skill-maintenance`: use when creating, editing or checking a skill, or one does not load or trigger.

### Project setup & code rules

- `expo-project-bootstrap`: use when bootstrapping, setting up or scaffolding an app or repo.
- `architecture-and-boundaries`: use when adding a file, folder, port or adapter, or on an import error.
- `typescript-and-lint-rules`: use when writing or splitting .ts/.tsx or fixing tsc, ESLint or Prettier errors.
- `naming-conventions`: use when adding or renaming anything or on a naming lint error.
- `dependency-management`: use when adding or bumping a package or on ETARGET.
- `expo-sdk-upgrade`: use when an SDK, Xcode or targetSdk upgrade is due.
- `expo-prebuild-and-config-plugins`: use when adding a plugin, an Info.plist or AndroidManifest entry, or a prebuild step.
- `app-variants-and-environment`: use when adding a variant, env var, .env or secret.
- `scaffold-feature-screen`: use when adding a screen, page or feature folder, or checking one is done.

### UI, design & interaction

- `react-components-and-hooks`: use when writing a component, hook, effect or list.
- `design-system-structure`: use when touching colours, dark mode, fonts or theme files.
- `ui-component-library`: use when adding or changing a shared component.
- `screen-contracts`: use when building or changing a screen, dialog, testID or state.
- `ui-states-and-feedback`: use when a screen loads data, shows a spinner, toast, retry or delete prompt.
- `forms-and-input`: use when adding a form, text field or validation, or the keyboard hides a field.
- `adaptive-layout`: use when making screens responsive or for tablets, iPad, foldables, rotation, split screen, orientation lock.
- `motion-and-animation`: use when animating a transition, sheet, loop, drag, spring or celebration, or one ignores Reduce Motion or blocks taps.
- `audio-and-haptics-feedback`: use when adding or tuning sounds, SFX, music or haptics, or sound ignores the silent switch, stops the user's music or a pulse fails on Android.
- `icons-app-icon-and-splash`: use when adding an icon, logo, app icon or splash, or an image or emoji appears.
- `skia-canvas-rendering`: use when drawing a chart, grid or board, or canvas animation freezes.
- `canvas-gestures-and-hit-testing`: use when a Skia canvas takes touch or a tap hits the wrong cell.
- `design-visual-parity`: use when a screen is built or changed, or for visual parity, design match, screenshot compare.
- `design-review-workflow`: use when a release nears or needs a QA sweep or sign-off.

### Navigation & app lifecycle

- `navigation-and-routing`: use when adding a route, link or guard, or Back acts up.
- `deep-links-and-universal-links`: use when adding a deep link, scheme, associated domain or share link.
- `app-startup-and-bootstrap`: use when editing the root _layout.tsx or the app root, or the splash hangs or flashes.
- `settings-and-preferences`: use when adding a setting or toggle, or a setting is ignored or lost on restart.

### State & data

- `state-management-zustand`: use when adding a store, action or selector, deciding where state lives, leaving Redux or persist+AsyncStorage, or on Maximum update depth.
- `networking-and-server-state`: use when calling an API, adding a query or mutation, or data is stale.
- `auth-and-secure-storage`: use when adding login, tokens, 401 retries, logout or account deletion.
- `persistence-and-migrations`: use when adding a table, column or saved data, leaving AsyncStorage, or data is lost after an update.
- `run-migration` (runbook: only when asked by name): use when shipping a migration.
- `data-export-and-restore`: use when adding backup, restore, import, export or CSV files.
- `error-handling-typed-results`: use when writing try/catch, .catch or a Result, or fixing swallowed errors or unhandled rejections.
- `async-safety`: use when writing useEffect, setTimeout, listeners or cancellation.
- `dates-streaks-and-statistics`: use when code reads today, counts days, shows a streak or stats, or a date is a day off.
- `value-objects-money-and-units`: use when adding a price, currency, tax, split, unit or timestamp, or a total is a cent off.
- `seeded-determinism-and-golden-vectors`: use when code shuffles, replaces Math.random, picks daily content or replays a seed or share code.

### Languages, access & speed

- `i18n-strings-and-catalogs`: use when adding UI text or a hard-coded string, a message key, a plural, a translation or a language (i18n).
- `rtl-and-direction`: use when adding Arabic or Hebrew, a row, icon, number, language switch or RTL test.
- `accessibility-as-code`: use when adding a pressable, swipe or a11y label, text clips when large, contrast fails or Reduce Motion is missed.
- `performance-budgets`: use when adding animation, Skia, lists, packages, startup work, or the app lags.

### Platform features

- `local-notifications`: use when adding a reminder, snooze or local notification.
- `push-notifications`: use when adding push, push tokens, FCM/APNs setup or notification taps.
- `permissions-and-system-prompts`: use when adding a camera, photo, location or contacts ask, or a dialog misbehaves.
- `media-images-and-files`: use when adding photos, avatars, attachments, uploads or save-to-Photos, or images flicker.
- `background-tasks`: use when adding periodic sync, TaskManager.defineTask, leaving expo-background-fetch, or a background task never runs.
- `native-modules-and-new-architecture`: use when adding Swift or Kotlin, a local or Turbo module, codegen, or checking a library for New Architecture.
- `web-support`: use when adding web, a .web.tsx file or expo export --platform web.

### Monetization, privacy & observability

- `admob-ads-and-consent`: use when touching ads, consent, ATT, ad IDs or rewarded perks.
- `in-app-purchases`: use when touching IAP, buy, restore, paywall or Premium state.
- `privacy-and-store-declarations`: use when an SDK lands, a release nears or an audit fails.
- `crash-reporting-and-observability`: use when adding Sentry or a DSN, or stacks are minified.
- `analytics-and-consent`: use when adding analytics, events, screen views or a usage-data toggle.

### Testing

- `unit-and-component-tests`: use when writing a test or mock, or Jest fails or flakes.
- `golden-and-snapshot-tests`: use when adding a golden or snapshot test or a .snap diff appears.
- `run-goldens-rebaseline` (runbook: only when asked by name): use when many goldens must be re-accepted.
- `e2e-maestro`: use when adding a flow or an e2e or screenshots run fails.
- `debug-menu-and-test-hooks`: use when adding a debug screen, a test hook, a debug link or a fake date for E2E or QA.

### Build, release & delivery

- `ios-simulator-build`: use when smoke-testing on the iOS simulator, or xcodebuild, simctl or CocoaPods fails.
- `android-emulator-build`: use when trying the app on the Android emulator, or Gradle, adb, an AVD or the SDK fails.
- `eas-build-and-submit`: use when editing eas.json, running eas build/submit, or a build fails.
- `ios-release-testflight`: use when releasing, signing or uploading an iOS build, or an upload fails.
- `android-release-play`: use when releasing or signing for Play, or an upload, rollout or version code fails.
- `ota-updates`: use when running eas update, setting runtimeVersion or channels, or an update never arrives.
- `ci-pipeline-and-gates`: use when editing .github/workflows or CI fails.

### Games (optional plugin)

- `game-rules-engine`: use when writing game rules, moves, scoring or in-game randomness.
- `level-generation-and-solvers`: use when adding levels, a solver, par, stars, packs or daily levels.
- `game-session-host`: use when assembling a game or wiring the Game screen or registry.
- `game-balance-and-bots`: use when balancing, tuning pacing or adding bots or sims.
- `realtime-game-loop`: use when adding live motion, bouncing balls, a physics shot or a replay test.
- `new-game-scaffold`: use when adding or starting a new game or checking one is complete.

<!-- generated:intents:end -->

## Working on this repository

For agents that edit the skills themselves: [CONTRIBUTING.md](CONTRIBUTING.md) is the authoring
standard and [tools/DECISIONS.md](tools/DECISIONS.md) the binding house decisions; load
`skill-maintenance`. Never edit generated output by hand (the README tables, this intent map,
`skills.json`, `docs/skills-data.js`, the marketplace entries): change `tools/catalog.json` or the
skill's frontmatter and run `node tools/build-catalog.mjs`. Never edit a synced copy of a shared file:
change it under `tools/shared/` and run `node tools/sync-shared.mjs <skill>...`, naming each skill.
