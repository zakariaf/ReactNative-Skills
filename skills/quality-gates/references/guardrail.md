# The guardrail: quality-gates.json

The likeliest failure of an unsupervised agent is quietly relaxing a threshold to get green. The
guardrail makes that impossible to do silently: `node scripts/quality/check-quality-gates.ts` (step 6
of `verify`) compares what the tools actually resolve with a checked-in expectation,
`quality-gates.json`. The comparison of resolved values, not file text, is the point: a later ESLint
block, an `extends`, a CLI flag or a local override changes what runs without changing the line a
reviewer would look at.

## Contents

- What the guardrail compares
- What quality-gates.json holds
- The gated paths
- Changing a gate (the only way)
- Adding a folder, a program or a package
- This skill's static check

## What the guardrail compares

- `eslint --print-config <probe>` for four probe paths (`src/core/gate-probe.ts` and
  `src/features/gate-probe/gate-probe.ts` against the `logic` rule set, `src/ui/gate-probe.tsx`
  against `component`, `src/ui/gate-probe.test.tsx` against `test`; the files need not exist) and
  the linter options.
- `tsc -p <project> --showConfig` for every program (`tsconfig.json`, `src/tsconfig.json`) against
  the shared strict options plus each program's `types`. A key may be a glob; a key that matches
  nothing is an error.
- `jest --showConfig` → `coverageThreshold`. A folder key may be absent only while that folder has no
  source files, because Jest fails on a threshold key that matches nothing.
- `jest --showConfig` → the scope: `collectCoverageFrom` must equal `jest.collectCoverageFrom`; each
  project (`unit`, `android`, `golden`) must be listed under `jest.projects` with its `roots`,
  `testMatch`, `testPathIgnorePatterns` and `modulePathIgnorePatterns` exactly (the absolute folder
  Jest resolves `<rootDir>` to is turned back into the tag); and each project's
  `coveragePathIgnorePatterns` must be exactly `/node_modules/` plus one pattern per file that carries
  the device-only marker (`deviceOnlyCoveragePatterns`). A wider `!` glob, an ignored test path or a
  hand-written coverage exclusion hides code or a failing test as surely as a lower threshold.
  Verified 2026-10-10 against the reference app's resolved config (Jest 29.7).
- The gate scripts in `package.json`, the `permissions` and `hooks` of `.claude/settings.json`, the
  `rules` of `knip.json`, the merged hooks of `lefthook dump --format json`, and the `.npmrc` policy
  lines.
- Local switches: a `skip`, `only`, `exclude` or `exclude_tags` in the merged lefthook config that the
  expectation does not have, and `disableAllHooks` in `.claude/settings.json` or the git-ignored
  `.claude/settings.local.json`.

Objects are compared as subsets (tools add defaults), arrays by position, values exactly; the one
exception is `claudeSettings`, whose lists only need to contain every expected entry (the app may keep
its own deny rules and hooks), each hook command still byte for byte. A mismatch prints the path and
both values and exits 1, with the reminder "Restore the gate; never edit the JSON to match." The pure
comparisons live in `gate-diff.ts` (`diffSubset`, `diffContains`, `addedKeys`, `withRootDirTag`) with
their own tests.
Every tool runs through `npx --no --`, so the guardrail never downloads a tool. A tool that cannot
start or fails prints one line, `quality-gates: could not run <command>: <its first output lines>`,
with the fix, and the guardrail exits 1 (never a stack trace): run `npm ci` when the tool is missing
(lefthook gets no `.bin` link while its install script is not approved in `allowScripts`), otherwise
fix the tool's own error (`lefthook dump` needs a git repository; verified 2026-10-10: exit 128 outside
one).

## What quality-gates.json holds

| Section | Holds | Owner of the values |
|---|---|---|
| `eslint.linterOptions` | `noInlineConfig: true`, `reportUnusedDisableDirectives: 2`, `reportUnusedInlineConfigs: 2` | typescript-and-lint-rules |
| `eslint.ruleSets.logic` | the limits (250 lines per file, 40 per function, complexity 10 modified, cognitive 15, depth 3, 3 parameters, 3 nested callbacks, 1 class), no floating promises, strict booleans, no `any`, described ts-comments, no default export, the banned `Math.random` / `Date.now` / `performance.now` / `I18nManager.isRTL` with their messages | typescript-and-lint-rules |
| `eslint.ruleSets.component` | 80 lines per component, JSX depth 5, one component per file, no JSX string literals, no inline styles or colour literals, exhaustive deps | typescript-and-lint-rules |
| `eslint.ruleSets.test` | 400 lines per test file, 4 nested callbacks, expect-expect, no identical titles, no focused or disabled tests, third-person-verb titles | typescript-and-lint-rules, unit-and-component-tests |
| `eslint.probes` | the four probe paths and their rule set | this skill |
| `typescript.shared` / `projects` | the strict compiler options and each program's `types` | typescript-and-lint-rules |
| `jest.coverageThreshold` | global 90/90/90/85; `./src/core/`, `./src/data/` and `./src/games/*/rules/**/*.ts` 95/95/95/90 | unit-and-component-tests |
| `jest.collectCoverageFrom`, `jest.projects` | the resolved coverage scope and each project's test scope (roots, testMatch, ignore patterns) | unit-and-component-tests |
| `npmScripts` | the exact gate scripts `verify` runs | this skill |
| `verifyExtraSteps` | npm scripts other skills appended as verify steps (empty by default) | the skill that adds each |
| `claudeSettings` | the deny and ask rules and both hooks | this skill |
| `knip`, `lefthook`, `npmrcLines` | the knip rules, the three git hooks, the `.npmrc` policy lines | this skill (knip config: typescript-and-lint-rules; `.npmrc`: dependency-management) |
| `perf`, `a11y` | performance budgets and accessibility minimums; tests and checkers read them from here, so the file's `Gate-Change:` rule protects them | performance-budgets, accessibility-as-code |
| `gatedPaths` | the files whose change needs a `Gate-Change:` trailer | this skill, extended by the skills that own each path |

## The gated paths

A commit that stages any of these needs a `Gate-Change: <reason>` trailer (the commit-msg check
enforces it through `gated-paths.ts`), and the configs among them also prompt the developer on edit:

- **Gate configs:** `quality-gates.json`, `eslint.config.mjs`, `tsconfig.base.json`, `tsconfig.json`,
  `src/tsconfig.json`, `tsconfig.stryker.json`, `src/app-env.d.ts`, `jest.config.js`,
  `jest.sim.config.js`, `jest.setup.ts`, `babel.config.js`, `stryker.config.json`, `knip.json`,
  `lefthook.yml`, `.prettierrc.json`, `.prettierignore`, `.npmrc`, `.claude/settings.json`.
- **Contracts that decide what a gate accepts:** `contracts/architecture.json` (the dependency zones),
  `contracts/dependency-policy.json` (versions, bans, licence exceptions),
  `contracts/knip-ignores.json` (every knip ignore entry), `contracts/seeded-generators.json` (frozen
  salts and cutovers).
- **Frozen evidence:** `**/*.vectors.json` (golden vectors), `src/data/**/fixtures/**` (frozen
  migration fixture databases and checksums), `test/goldens/skia-golden.ts` (the pixel tolerance),
  `**/__snapshots__/*.golden.test.ts.snap`, `**/*.golden.test.ts.snap.ios`,
  `**/*.golden.test.ts.snap.android` (jest-expo writes one snapshot per platform beside the test),
  `contracts/goldens.json` (golden-and-snapshot-tests' list of golden paths), `**/__image_snapshots__/**`,
  `.maestro/baselines/**` (screenshot baselines), `perf-baselines/**` (the measured cold-start
  baseline that sets the next runs' limit).
- **The gate scripts:** `scripts/quality/check-quality-gates.ts`, `gate-diff.ts`, `gated-paths.ts`,
  `verify-plan.ts`, `run-verify.ts`, `device-only.ts`, and `scripts/hooks/after-edit.ts`.

A skill that adds a gate adds its evidence here in the same change (a visual-parity waiver list, a
network baseline under the `offline-only` profile, an installer checksum); the list only grows.
Installed agent skills are knowledge, not gates: `isGatedFile` never lets a pattern that starts with a
wildcard reach into `skills/`, `.agents/`, `.claude/`, `.codex/`, `.cursor/`, `.windsurf/`, `.roo/`,
`.cline/`, `.continue/` or `.kiro/`, while a pattern that names the folder itself
(`.claude/settings.json`) still gates it. `check-gate-wiring.mjs` reports a lost exclusion or an
unanchored `ask` rule as `gate-scope`.

## Changing a gate (the only way)

1. A gate looks wrong (a false positive, a rule that contradicts a requirement or a platform
   decision, a tool bug). Stop that line of work.
2. Send the developer one short note: the gate, the file and line, the exact message, why it looks
   wrong, and the smallest proposed change (`assets/gate-question.md`). Continue with other work if
   possible.
3. Only after the developer agrees: change the gate and `quality-gates.json` together, in one commit,
   with `Gate-Change: <reason>`. The `ask` permission prompt appears for the configs; that prompt is
   the developer's approval.
4. Run the guardrail and this skill's `check-gate-wiring.mjs`. A tightened number (a higher
   threshold, a lower limit, a new gated path or logic key) and an added test project listed in
   `jest.projects` pass both. A loosened value passes the guardrail (the JSON now says so) but keeps
   failing the wiring check, whose baseline is this skill's template: the library's values are a
   floor, so a looser value is a decision to leave the standard, reported to the developer as such,
   never a quiet edit. A change to a canonical Jest scope value (a new ignore pattern, a new test
   root in the single-app layout, a canonical project's `testMatch`) also keeps failing `jest-scope`,
   even when it is stricter: the static check compares scope values exactly, because it cannot tell
   a narrower glob from a wider one. Make that change in unit-and-component-tests' canonical
   `jest.config.js` (an issue or pull request to the skill library), or accept the one `jest-scope`
   line as the recorded difference and say so in the report; the guardrail is the authority.

Never edit `quality-gates.json` to match a weakened config, never add `eslint-disable` or `@ts-ignore`,
never lower a threshold, never widen an exemption glob.

## Adding a folder, a program or a package

- A new folder of pure logic that deserves the 95% threshold: add its key to `jest.coverageThreshold`
  in `jest.config.js` (`LOGIC_THRESHOLDS`) and `quality-gates.json` together, with a trailer.
- A new tsconfig program: add it under `typescript.projects` and to the `typecheck` script, in the
  same commit.
- When multi-package: a new workspace is covered by a glob key (`apps/*/tsconfig.json`), needs its own
  `typecheck` script, a knip `workspaces` entry, the workspace tsconfig `ask` rules
  (`Edit(/apps/*/tsconfig*.json)`, `Edit(/packages/*/tsconfig*.json)`, in `.claude/settings.json` and
  `claudeSettings` alike) and the same tsconfigs in `gatedPaths` (`apps/*/tsconfig*.json`,
  `packages/*/tsconfig*.json`), so a commit that loosens a workspace program needs the trailer too,
  all in one commit with a trailer. Its Jest scope takes the workspace form: the root
  `jest.config.js` writes `<rootDir>/apps/*/src/**/` and `<rootDir>/packages/*/src/**/` where
  `TEST_ROOTS` had `<rootDir>/src/**/`, `<rootDir>/{apps,packages}/*/src/**/*.{ts,tsx}` as the
  coverage glob, may add `<rootDir>/(apps|packages)/[^/]+/(ios|android|build|dist|web-build)/` next to
  the root ignore pattern, and names each package's logic folder (`./packages/core/src/` for
  `./src/core/`, or `./apps/*/src/data/`); `quality-gates.json` restates the same values under
  `jest.collectCoverageFrom`, `jest.projects` and `jest.coverageThreshold` in the same gate change.
  `check-gate-wiring.mjs` strips the workspace prefixes and compares the result with the canonical
  scope, so an added `!` glob still fails, and it fails a workspace with a `src/` folder that coverage
  or a test root no longer reaches.
- A new test project (a `web` project under `jest-expo/web`): add it next to the canonical `unit`,
  `android` and `golden` projects in `jest.config.js` and under `jest.projects` in
  `quality-gates.json`, in one gate change. Additions only: the canonical projects keep their
  `displayName` and scope, and the guardrail compares the new project's resolved scope.

## This skill's static check

`scripts/check-gate-wiring.mjs` runs without any installed tool (before `npm ci`, in review, and in
this skill's self-test). It compares the repo's `quality-gates.json` with this skill's baseline in the
direction that matters: coverage and accessibility minimums and option floors (`minimum...`) may only
rise, limits and budgets may only fall, lists (gated paths, deny and ask rules, secret globs, extra
steps) may only grow, a lefthook `exclude` list may only shrink, TypeScript and Jest lists must be
equal (multi-package: the Jest lists in their single-app form, workspace prefixes stripped), every
logic threshold key keeps the logic floors (multi-package: its workspace or package form), any other
path key keeps at least the global floors (a path key takes its files out of the global count), and
everything else must be equal. A test project the app adds under `jest.projects` is not compared
with the baseline. It also
checks the scripts and their targets, the hooks, the settings, the `.npmrc` lines, the ESLint linter
options, the Jest thresholds and scope, the knip reasons and the gate scripts. The guardrail stays the authority
on what the tools resolve.
