<div align="center">

# React Native Agent Skills

**Deep, self-verifying engineering skills for React Native apps built with Expo, for Claude Code, Codex and any agent that reads skills.**

Project setup · architecture · UI and design · navigation · state and data · i18n, RTL and accessibility · platform features · monetization and privacy · testing · builds and releases · optional games

[Browse the catalogue](https://zakaria.dev/ReactNative-Skills/) · [Agent guide](AGENTS.md) · [Contributing](CONTRIBUTING.md) · [Agent Skills standard](https://agentskills.io)

`79 skills` · `Expo SDK 57` · `React Native 0.86` · `iOS + Android` · `MIT`

</div>

---

Each skill is a playbook an agent loads only when a task matches its description: rules with their
reasons, a step-by-step workflow, templates to copy, and a definition of done that ends in a checker.
The agent does not just follow advice; it proves the work.

## Why this library is different

- **Every skill ends in a checker.** The definition of done is a zero-dependency Node script that
  inspects your repo and prints `RESULT: PASS` or `RESULT: FAIL (<n> problems)`, each problem with a
  file, a line, a rule id and a fix. Agents, CI and people read the result the same way.
- **The checkers are tested against planted bugs.** Every skill with scripts ships a self-test:
  thousands of fixture cases, each planting one bug that must fail for exactly its rule, plus clean
  cases that must pass. A checker that stops catching its bug fails CI.
- **Templates compile in a real app.** Templates are complete files, not snippets. They are copied
  into a reference Expo SDK 57 app (`tools/harness/`) and must pass strict TypeScript, ESLint with zero
  warnings, Jest and Prettier there before they ship.
- **One canonical stack, both platforms.** Expo Router, Zustand, TanStack Query, expo-sqlite,
  react-intl, Reanimated, Skia and EAS, reconciled so 79 skills never contradict each other. iOS and
  Android are both first-class (TalkBack next to VoiceOver, `adb` next to `simctl`, Play next to the
  App Store).
- **Self-contained and safe.** A skill works when installed alone, never points outside its folder,
  never reads secrets, names every device it touches, and stops to ask before anything irreversible
  or outward-facing (store uploads, deleting data, publishing).

## Install

### Claude Code (plugin marketplace)

```text
/plugin marketplace add zakariaf/ReactNative-Skills
/plugin install react-native@react-native-skills
/plugin install react-native-games@react-native-skills    # optional: game skills
```

On Claude Code 2.1.275 or later one line does both steps:
`/plugin install react-native --marketplace zakariaf/ReactNative-Skills`.

Skills load on their own when a task matches. To run one by name, use its namespace:
`/react-native:forms-and-input`, `/react-native-games:game-rules-engine`. The `react-native` plugin
holds 73 skills; `react-native-games` adds 6 for game rules, levels, sessions, balance bots and
real-time loops.

### Codex

The repository is also a Codex plugin (`.codex-plugin/plugin.json`, skills in `./skills/`). Add it the
way your Codex version installs plugins from a Git repository. The Codex manifest ships all 79 skills,
games included; the game skills load only for game tasks.

### Any other agent

```bash
npx skills add zakariaf/ReactNative-Skills                          # every skill
npx skills add zakariaf/ReactNative-Skills --skill forms-and-input  # one skill
```

Or copy folders from `skills/` into the place your agent reads skills from (`.claude/skills/`,
`.agents/skills/`, ...). Give your agent [`AGENTS.md`](AGENTS.md): it explains how to pick and load
skills and carries the intent map. Tools can read the machine-readable catalogue in
[`skills.json`](skills.json).

### Let the checkers run

Skills run their checkers with `node <skill>/scripts/<check>.mjs`. In Claude Code, allow that once in
`.claude/settings.json` (adjust the paths to where your skills are installed):

```json
{
  "permissions": {
    "allow": [
      "Bash(node */.claude/skills/*/scripts/*)",
      "Bash(node */.agents/skills/*/scripts/*)",
      "Bash(node */.claude/plugins/cache/*/skills/*/scripts/*)"
    ]
  }
}
```

## Start here

Begin every task with **`react-native-conventions-index`**. It routes the task to the skills that
apply (a generated task table and intent map), gives build orders for a new app, a new feature and a
release, and states the house rules once with a pointer to each owner skill. For a new app from an
empty repo it starts with `expo-project-bootstrap`.

A skill folder looks like this:

```text
<skill>/
  SKILL.md          rules that must hold, workflow, definition of done, anti-patterns, files, related skills
  references/       knowledge read on demand
  templates/        real files copied into the app (line 1 names the repo path)
  examples/         shapes to imitate
  scripts/          the checkers, plus scripts/selftest.mjs
  tests/fixtures/   the planted-bug and clean cases the self-test runs
  assets/           data: tables, contracts, the shared-file manifest
```

## The stack

The skills teach one default and fence alternatives in appendices. Exact versions, how each was
verified and a re-verify command live in [`tools/stack.json`](tools/stack.json); moving to the next
Expo SDK is a data refresh.

| Concern | Default |
|---|---|
| Platform | Expo SDK 57, React Native 0.86, React 19.2, Hermes, New Architecture only, React Compiler on |
| Language and lint | TypeScript 6 (strict), ESLint 9 flat config with typescript-eslint strictTypeChecked, Prettier |
| Native projects | Continuous Native Generation: `ios/` and `android/` generated from `app.config.ts` and config plugins |
| Navigation | Expo Router (typed routes, layouts, protected groups) |
| State | Zustand 5 for client state, TanStack Query 5 over a typed `ApiClient` port for server state |
| Validation and forms | valibot, react-hook-form |
| Persistence | expo-sqlite behind a small `SqlDriver` port, forward-only migrations; expo-secure-store for secrets |
| UI | `StyleSheet` with a typed theme, logical (start/end) styles, Reanimated 4, Gesture Handler, Skia 2 |
| i18n | react-intl (ICU messages, catalogs per locale, RTL) |
| Tests | Jest 29 with jest-expo and React Native Testing Library 14, fast-check, Maestro for E2E |
| Builds and updates | EAS Build, EAS Submit and EAS Update, with a fully documented local lane (`xcodebuild`, Gradle) |
| Observability, ads, purchases | Sentry behind a port, consent-gated analytics, AdMob with UMP and ATT, expo-iap |
| Toolchain | Node 22.18 or newer (projects pin 26), npm 11.17 or newer, Xcode 26.6, Android SDK 36, JDK 17 |

## Skills

<!-- generated:skills:start -->
<!-- Generated by tools/build-catalog.mjs from tools/catalog.json and each SKILL.md; do not edit by hand. -->

**79 skills** (`react-native` 73 · `react-native-games` 6)

### Start here

| Skill | What it does |
|---|---|
| [`react-native-conventions-index`](skills/react-native-conventions-index/SKILL.md) | Routes any React Native or Expo task to its skills - house rules, a task table, build orders for an app, a feature, a release. |

### How every change is made

| Skill | What it does |
|---|---|
| [`tdd-workflow`](skills/tdd-workflow/SKILL.md) | Drives changes test-first (TDD, red-green-refactor) - one behaviour per commit, test names, layer order, no test edited to pass. |
| [`quality-gates`](skills/quality-gates/SKILL.md) | Installs and repairs quality gates (check:fast, verify, lefthook, Claude Code hooks, the guardrail) without weakening them. |
| [`git-commits-and-reporting`](skills/git-commits-and-reporting/SKILL.md) | Writes and checks Conventional Commits, Gate-Change trailers, release tags, evidence reports and stop-and-ask requests. |
| [`spec-traceability`](skills/spec-traceability/SKILL.md) | Keeps spec IDs traced in tests, code, commits and reports; flags dangling or untraced IDs. |
| [`troubleshooting-playbook`](skills/troubleshooting-playbook/SKILL.md) | Diagnoses React Native/Expo errors, red boxes, crashes, hangs and failed builds from known failures. |
| [`skill-maintenance`](skills/skill-maintenance/SKILL.md) | Builds and repairs agent skills (SKILL.md) - scaffold, descriptions, self-tested checkers, routing evals. |

### Project setup & code rules

| Skill | What it does |
|---|---|
| [`expo-project-bootstrap`](skills/expo-project-bootstrap/SKILL.md) | Creates a new Expo app from empty - SDK 57 stack, Expo Router, root configs, gates, variants, icons - proven by a checker. |
| [`architecture-and-boundaries`](skills/architecture-and-boundaries/SKILL.md) | Places app code in the src/ layout and checks import boundaries: one-way zones, pure core, ports with fakes, one composition root. |
| [`typescript-and-lint-rules`](skills/typescript-and-lint-rules/SKILL.md) | Enforces strict tsconfig, ESLint flat config, size limits, forbidden patterns, TSDoc. |
| [`naming-conventions`](skills/naming-conventions/SKILL.md) | Names files, routes, exports, hooks, booleans, kinds, testIDs, message keys, app ids and env vars. |
| [`dependency-management`](skills/dependency-management/SKILL.md) | Adds, upgrades and removes npm packages in Expo apps under a written policy - expo install, exact pins, 7-day release age, script review, licences. |
| [`expo-sdk-upgrade`](skills/expo-sdk-upgrade/SKILL.md) | Moves an Expo app to the next SDK and Xcode/Android toolchain in one proven commit - expo install --fix, overrides, breaking changes. |
| [`expo-prebuild-and-config-plugins`](skills/expo-prebuild-and-config-plugins/SKILL.md) | Keeps ios/ and android/ generated from app.config.ts and tested config plugins. |
| [`app-variants-and-environment`](skills/app-variants-and-environment/SKILL.md) | Wires APP_VARIANT builds: per-variant ids, names, icons, schemes, EXPO_PUBLIC_* as public, secrets in EAS/CI, test code out of store bundles. |
| [`scaffold-feature-screen`](skills/scaffold-feature-screen/SKILL.md) | Scaffolds one Expo Router feature - thin route, pure view, model hook, tests, message keys, typed params - and proves it. |

### UI, design & interaction

| Skill | What it does |
|---|---|
| [`react-components-and-hooks`](skills/react-components-and-hooks/SKILL.md) | Writes React components and hooks - model hooks, effects, React Compiler, lists, safe areas, error boundaries. |
| [`design-system-structure`](skills/design-system-structure/SKILL.md) | Structures a design system: two-tier tokens, contrast-proven light/dark palettes, the theme provider, makeStyles, text roles, fonts. |
| [`ui-component-library`](skills/ui-component-library/SKILL.md) | Builds shared src/ui components (buttons, rows, dialogs, toasts, cards): token sizes, every state, a required testID, a test each. |
| [`screen-contracts`](skills/screen-contracts/SKILL.md) | Builds screens, dialogs and overlays to a contract (testIDs, copy keys, states in contracts/screens.json) and proves it. |
| [`ui-states-and-feedback`](skills/ui-states-and-feedback/SKILL.md) | Builds loading, empty, failed and offline states, delayed skeletons, toasts, banners, confirms, Undo. |
| [`forms-and-input`](skills/forms-and-input/SKILL.md) | Builds react-hook-form + valibot forms: one schema, catalog-key errors, TextField kinds (keyboard, autofill), focus chain. |
| [`adaptive-layout`](skills/adaptive-layout/SKILL.md) | Lays screens out by window, not device: breakpoints, master-detail panes, readable widths, grids. |
| [`motion-and-animation`](skills/motion-and-animation/SKILL.md) | Catalogs each animation as a Reanimated 4 moment. |
| [`audio-and-haptics-feedback`](skills/audio-and-haptics-feedback/SKILL.md) | Builds SFX and haptics behind ports. |
| [`icons-app-icon-and-splash`](skills/icons-app-icon-and-splash/SKILL.md) | Draws icons and app art in code - a Skia-path icon set, a brand mark, adaptive icons, splash, store art. |
| [`skia-canvas-rendering`](skills/skia-canvas-rendering/SKILL.md) | Builds hand-drawn Skia canvases - pure worklet draw() in one Picture, scene clock, timelines, canvas text, goldens. |
| [`canvas-gestures-and-hit-testing`](skills/canvas-gestures-and-hit-testing/SKILL.md) | Turns canvas taps, swipes, drags and aim into typed intents: one gesture module, hit-testing on the drawn layout. |
| [`design-visual-parity`](skills/design-visual-parity/SKILL.md) | Proves built screens match approved design references (iOS, Android, light/dark, RTL) per element. |
| [`design-review-workflow`](skills/design-review-workflow/SKILL.md) | Runs the end-of-build design review: every screen x theme x direction x text size x device, graded findings, a fix round, a sign-off. |

### Navigation & app lifecycle

| Skill | What it does |
|---|---|
| [`navigation-and-routing`](skills/navigation-and-routing/SKILL.md) | Builds and checks Expo Router routes and layouts against a contract: typed hrefs, params, protected flows, modals, back guards. |
| [`deep-links-and-universal-links`](skills/deep-links-and-universal-links/SKILL.md) | Gates every incoming link: custom schemes, universal links (AASA), App Links (assetlinks), a route allow-list. |
| [`app-startup-and-bootstrap`](skills/app-startup-and-bootstrap/SKILL.md) | Orders an Expo app's cold start - polyfills, error net, splash hold, storage open, providers, splash release, background flush. |
| [`settings-and-preferences`](skills/settings-and-preferences/SKILL.md) | Builds app settings - saved fields, defaults, rows, each setting's effect, resets that keep them. |

### State & data

| Skill | What it does |
|---|---|
| [`state-management-zustand`](skills/state-management-zustand/SKILL.md) | Builds Zustand 5 stores - pure reducers. |
| [`networking-and-server-state`](skills/networking-and-server-state/SKILL.md) | Builds TanStack Query server state over an ApiClient - validated responses, keys, retries, optimistic writes, offline. |
| [`auth-and-secure-storage`](skills/auth-and-secure-storage/SKILL.md) | Builds sign-in - tokens in expo-secure-store, shared refresh, protected routes, OAuth PKCE, Apple sign-in. |
| [`persistence-and-migrations`](skills/persistence-and-migrations/SKILL.md) | Builds the expo-sqlite database: tables, repositories, migrations. |
| [`run-migration`](skills/run-migration/SKILL.md) | Runs the release ritual for a SQLite schema version - snapshot proven, one pending step, shipped steps frozen in a ledger, every from-to path, a forced-failure drill. *(runbook, invoked by name)* |
| [`data-export-and-restore`](skills/data-export-and-restore/SKILL.md) | Builds data export and restore - a versioned, checksummed backup file, all-or-nothing restore, safe CSV. |
| [`error-handling-typed-results`](skills/error-handling-typed-results/SKILL.md) | Builds a typed Result spine - failures converted at boundaries, exhaustive handling. |
| [`async-safety`](skills/async-safety/SKILL.md) | Prevents silent async bugs: effect races, stale results, lost promises, leaked listeners and timers, AbortSignal gaps. |
| [`dates-streaks-and-statistics`](skills/dates-streaks-and-statistics/SKILL.md) | Builds calendar-day logic: local date keys, an injected clock, midnight, DST, streaks, stats. |
| [`value-objects-money-and-units`](skills/value-objects-money-and-units/SKILL.md) | Stores money as ISO 4217 minor units, quantities in canonical units, instants as epoch ms. |
| [`seeded-determinism-and-golden-vectors`](skills/seeded-determinism-and-golden-vectors/SKILL.md) | Makes seeded output identical on every device: one PRNG, date keys, cutovers, golden vectors. |

### Languages, access & speed

| Skill | What it does |
|---|---|
| [`i18n-strings-and-catalogs`](skills/i18n-strings-and-catalogs/SKILL.md) | Puts all visible text in react-intl catalogs - semantic keys, CLDR plurals, Intl polyfills, parity. |
| [`rtl-and-direction`](skills/rtl-and-direction/SKILL.md) | Makes Expo apps right-to-left correct - logical styles, guarded direction restart, mirroring, digits, bidi. |
| [`accessibility-as-code`](skills/accessibility-as-code/SKILL.md) | Enforces a11y labels, 44pt targets, 200% text, VoiceOver, TalkBack. |
| [`performance-budgets`](skills/performance-budgets/SKILL.md) | Measures cold start, hitches, draw calls, storage writes, bundle and memory against budgets on iOS and Android. |

### Platform features

| Skill | What it does |
|---|---|
| [`local-notifications`](skills/local-notifications/SKILL.md) | Schedules on-device reminders with expo-notifications: rows as truth, one idempotent sync, DST-safe triggers, Android channels. |
| [`push-notifications`](skills/push-notifications/SKILL.md) | Builds remote push on expo-notifications: in-context permission, token sync, server contract, channels, tap routing. |
| [`permissions-and-system-prompts`](skills/permissions-and-system-prompts/SKILL.md) | Builds OS permission asks - on the press, pre-prompt, denied vs blocked, Settings link, purpose strings, Android rules. |
| [`media-images-and-files`](skills/media-images-and-files/SKILL.md) | Shows, picks and stores images - expo-image, picker, camera, a media store. |
| [`background-tasks`](skills/background-tasks/SKILL.md) | Builds expo-background-task jobs: idempotent, budgeted runs. |
| [`native-modules-and-new-architecture`](skills/native-modules-and-new-architecture/SKILL.md) | Writes New Architecture native code in typed local Expo modules. |
| [`web-support`](skills/web-support/SKILL.md) | Ships the web build of an Expo app: platform files, APIs missing in react-native-web, expo-sqlite headers. |

### Monetization, privacy & observability

| Skill | What it does |
|---|---|
| [`admob-ads-and-consent`](skills/admob-ads-and-consent/SKILL.md) | Builds AdMob ads behind a port - banners, interstitials, rewarded, UMP consent then ATT, pacing, ADS_MODE test IDs. |
| [`in-app-purchases`](skills/in-app-purchases/SKILL.md) | Sells a Premium unlock with expo-iap behind a PurchasePort - saved entitlement, paywall states, restore, refunds, store testing. |
| [`privacy-and-store-declarations`](skills/privacy-and-store-declarations/SKILL.md) | Proves an app's privacy - network via the API port or offline-only, SDK inventory, privacy manifest, App Privacy and Data safety answers. |
| [`crash-reporting-and-observability`](skills/crash-reporting-and-observability/SKILL.md) | Wires Sentry crash reporting behind a port: start on consent, PII scrubbing, releases, source maps per build and update. |
| [`analytics-and-consent`](skills/analytics-and-consent/SKILL.md) | Gates analytics on opt-in consent: no SDK before a yes, typed events without personal data, ATT. |

### Testing

| Skill | What it does |
|---|---|
| [`unit-and-component-tests`](skills/unit-and-component-tests/SKILL.md) | Sets up Jest, checks unit, component and route tests (RNTL 14, renderWithProviders, SDK mocks, fakes, fast-check, Stryker). |
| [`golden-and-snapshot-tests`](skills/golden-and-snapshot-tests/SKILL.md) | Guards data and pixel goldens - *.golden.test.ts snapshots, append-only [contract] entries, Skia tolerance, jest -u rules. |
| [`run-goldens-rebaseline`](skills/run-goldens-rebaseline/SKILL.md) | Runs the golden rebaseline ritual - assertions green first, triage, one-file jest -u runs, every diff inspected, recorded, orphans deleted, proof without -u. *(runbook, invoked by name)* |
| [`e2e-maestro`](skills/e2e-maestro/SKILL.md) | Writes and runs Maestro E2E flows on iOS simulators and Android emulators - testID steps, debug-link setup, screenshot baselines. |
| [`debug-menu-and-test-hooks`](skills/debug-menu-and-test-hooks/SKILL.md) | Gates test-only code behind one literal TEST_ONLY switch: debug menu, debug link, simulated clock and offline. |

### Build, release & delivery

| Skill | What it does |
|---|---|
| [`ios-simulator-build`](skills/ios-simulator-build/SKILL.md) | Builds Release iOS simulator apps (clean prebuild, pinned Xcode, UDID-named simulator) and proves the .app. |
| [`android-emulator-build`](skills/android-emulator-build/SKILL.md) | Assembles Release APKs with Gradle on an AVD started by name (pinned JDK and SDK) and inspects them. |
| [`eas-build-and-submit`](skills/eas-build-and-submit/SKILL.md) | Configures EAS Build and Submit: eas.json profiles, remote build numbers, fingerprints, gated store submits. |
| [`ios-release-testflight`](skills/ios-release-testflight/SKILL.md) | Ships iOS builds to TestFlight: API-key signing, archive, export, store gate on the .ipa, upload, VALID wait, build numbers. |
| [`android-release-play`](skills/android-release-play/SKILL.md) | Ships Android App Bundles to Google Play: upload key, Play App Signing, AAB gate, versionCode, tracks, rollout. |
| [`ota-updates`](skills/ota-updates/SKILL.md) | Ships EAS Update over-the-air updates - fingerprint runtimes, a channel per variant, rollout, rollback. |
| [`ci-pipeline-and-gates`](skills/ci-pipeline-and-gates/SKILL.md) | Builds GitHub Actions CI for Expo apps - verify on every PR, SHA-pinned actions, pinned runners and Node, device lanes, manual EAS releases. |

### Games (optional plugin)

| Skill | What it does |
|---|---|
| [`game-rules-engine`](skills/game-rules-engine/SKILL.md) | Builds game rules as a pure seeded engine: create, listMoves, applyMove, outcome, events, property tests. *(plugin `react-native-games`)* |
| [`level-generation-and-solvers`](skills/level-generation-and-solvers/SKILL.md) | Generates level tables proven winnable by a solver or witness bot: par, stars, pack unlocks, a daily level. *(plugin `react-native-games`)* |
| [`game-session-host`](skills/game-session-host/SKILL.md) | Hosts a game module through one typed seam: game screen, pause, undo, hints, a rescue, saved runs, results. *(plugin `react-native-games`)* |
| [`game-balance-and-bots`](skills/game-balance-and-bots/SKILL.md) | Tunes game difficulty with seeded headless bots: sim reports, balance bands, tuning knobs, a fun-in-seconds test. *(plugin `react-native-games`)* |
| [`realtime-game-loop`](skills/realtime-game-loop/SKILL.md) | Runs real-time play: a fixed-step UI-thread loop, typed-array sims, (tick, command) replays, replayable physics. *(plugin `react-native-games`)* |
| [`new-game-scaffold`](skills/new-game-scaffold/SKILL.md) | Starts a new game by script - contracts/games.json entry, catalog keys, a white-label app when multi-package - and proves it complete. *(plugin `react-native-games`)* |

<!-- generated:skills:end -->

The [catalogue site](https://zakaria.dev/ReactNative-Skills/) has search and filters by category and
plugin.

## Verify locally

The maintainer tools are zero-dependency Node scripts (Node 22.18 or newer). From the repo root:

```bash
node tools/validate-skills.mjs              # every skill against the standard (runs each script's --help)
node tools/selftest-all.mjs                 # every checker against its planted-bug fixtures
node tools/sync-shared.mjs --check          # shared files match their canonical copy
node tools/build-catalog.mjs --check        # README tables, AGENTS.md, skills.json, site data, marketplace
node tools/check-repo-hygiene.mjs           # nothing ignored under skills/, budgets, no stray SKILL.md
node tools/check-stack-pins.mjs             # every version a skill states agrees with tools/stack.json
node tools/check-routing-evals.mjs          # the routing prompts cover every skill
node tools/tests/plugin-manifests.test.mjs  # plugin manifests agree with the catalogue
claude plugin validate . --strict           # Claude Code's own manifest check
```

Proving the templates needs the reference app's packages (`cd tools/harness && npm ci`), then
`node tools/verify-templates.mjs`. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs
all of the above on every pull request. [`tools/README.md`](tools/README.md) documents every tool.

## Repository layout

```text
skills/<name>/            one folder per skill (nothing else lives in skills/)
.claude-plugin/           the Claude Code marketplace: plugins react-native and react-native-games
.codex-plugin/            the Codex plugin manifest
AGENTS.md                 the guide for any agent, with the generated intent map
skills.json               the machine-readable catalogue
docs/                     the catalogue site (GitHub Pages)
tools/                    maintainer tooling, never installed: validator, catalogue, checks, the harness app
```

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) is the authoring standard: skill anatomy, frontmatter, the checker
contract, fixtures, templates, descriptions and routing, and the checks to run before a pull request.
The binding house decisions are in [`tools/DECISIONS.md`](tools/DECISIONS.md).

These skills complement [Expo's official skills](https://github.com/expo/skills), which teach Expo's
APIs; this library enforces engineering rules around them and proves them with checkers.

## License

[MIT](LICENSE) © 2026 Zakaria Fatahi
