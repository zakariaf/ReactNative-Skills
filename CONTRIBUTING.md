# Contributing

This repository holds **general, reusable, self-verifying** agent skills for React Native apps built
with Expo. This file is the authoring standard every skill follows. `tools/DECISIONS.md` holds the
binding house decisions (stack, app layout, vocabulary) and wins when the two disagree;
`tools/standard.json` holds the standard's constants; `node tools/validate-skills.mjs` enforces
everything here that a machine can check. A skill is finished only when the validator and the skill's
own self-test print `RESULT: PASS`.

The reader of a skill is often an agent working with no human review. The checks are the review, so
every rule below exists because a missing one went wrong somewhere.

## Contents

1. Scope
2. Repository layout and the development loop
3. Self-contained, always
4. Skill anatomy
5. Frontmatter
6. SKILL.md body
7. Scripts
8. Self-test fixtures and the overlay format
9. Templates, examples and the harness
10. Descriptions and routing
11. Catalogue and plugins
12. The stack table
13. Quality bar
14. Before opening a pull request

## 1. Scope

**In scope:** anything that applies to any React Native + Expo app: project setup, architecture and
boundaries, TypeScript and lint rules, naming, UI structure, navigation, state and server state,
persistence, i18n and RTL, accessibility, performance, platform features, monetization and privacy,
testing, builds and releases, and the process that keeps a codebase honest (TDD, gates, commits). An
optional games plugin covers game rules engines, level generation, session hosts, balance bots and
real-time loops.

**Out of scope:** design-token values (colours, radii, fonts, durations; teaching how a token system
is *structured* is in scope), and app-domain skills tied to one product.

- **Neutral domains only.** Core examples use a Tasks app (tasks, lists, reminders, a Premium
  entitlement) and the nouns `Note`, `Product`, `Order`, `Account`. Game examples use public-domain
  mechanics (Lights Out as `lights-out`, a sliding puzzle, a simple arena chase). Never a real app's
  nouns.
- **One canonical stack** (section 12 and `tools/DECISIONS.md` section 2). A skill teaches one default;
  an alternative goes in a fenced appendix.
- **Single app first.** Skills, templates and checkers assume one Expo app at the repo root (the layout
  in `tools/DECISIONS.md` section 3). Monorepo guidance sits under a heading "When multi-package", and
  every checker accepts directory options for it.
- **iOS and Android are both first-class.** State both platforms wherever behaviour differs (TalkBack
  next to VoiceOver, `adb` next to `simctl`, Play next to the App Store). A fact verified on one
  platform only is marked as such.
- **Complementary to Expo's official skills** (`expo/skills`). Never reuse one of their names
  (`tools/standard.json` reserves them); name them as a hand-off where they are the better API
  reference.

## 2. Repository layout and the development loop

```
skills/<name>/          one folder per skill, one level deep; nothing else lives in skills/
tools/                  maintainer tooling, never installed: validator, sync, catalogue, checks, tests
tools/shared/           the one canonical copy of every file more than one skill carries
docs/                   the GitHub Pages catalogue (docs/skills-data.js is generated)
skills.json  README.md  AGENTS.md  .claude-plugin/  .codex-plugin/   generated or release metadata
```

- `skills/` holds only skill folders: no README, no `_library/`, no templates of the repo. The skills
  CLI scans `skills/<child>` and one level deeper, so anything else there would be offered as a skill.
- No file under `tools/` or `docs/` is named `SKILL.md` (a deep scan would install it). Scaffolds are
  `SKILL.md.tmpl`; the validator's sample skills are generated in a temporary folder at test time.
- No symlinks anywhere in `skills/`, and no committed `.claude/skills/`. Installers copy or dereference
  links unpredictably, and Windows checkouts break them.
- **Development loop:** `claude --plugin-dir .` from the repo root loads every skill in place (as one plugin named after
  the folder); run the commands in section 14 before every pull request. To test the real install, add the marketplace
  from a clean clone (`claude plugin marketplace add <clone>`; a working copy with `tools/harness/node_modules` would be
  copied whole into the plugin cache) and install `react-native@react-native-skills` and
  `react-native-games@react-native-skills`, with `CLAUDE_CONFIG_DIR` pointing at a scratch folder.

## 3. Self-contained, always

A skill is installed alone (`npx skills add zakariaf/ReactNative-Skills --skill <name>`), into a
plugin cache, or into `.agents/skills/` of someone's app. It must work there with nothing else.

- **Never point at a file outside the skill folder:** no repo docs, no `tools/` paths, no other
  skill's files, no `skills/_library/...`, no absolute paths (`/Users/`, `/home/`, `C:\Users\`), no
  scratch paths (`/private/tmp/`, scratchpads), no `../` link in markdown and no `../../` in a script.
  Copy what the skill needs into its own `references/`, `assets/` or `scripts/lib/` instead.
- **No runtime variables that exist only in some agents or install scopes:** never
  `${CLAUDE_PLUGIN_ROOT}`, `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_ENV_FILE`, and no script
  reads a `CLAUDE_*` environment variable. Scripts find themselves with `import.meta.url` and take the
  repo root as an argument.
- `${CLAUDE_SKILL_DIR}` is the one allowed variable, in markdown only. It means "the folder that
  contains this SKILL.md"; agents that do not expand it substitute that path (AGENTS.md says so once).
- **Paths the skill creates or checks in the user's app** (`src/features/tasks/tasks-screen.tsx`,
  `contracts/screens.json`) are content, not dependencies, and are fine.
- **Another skill may be named for a hand-off** ("then load `e2e-maestro`"), never depended on: this
  skill still finishes and verifies its own job. Never call another skill's scripts.
- **Shared files** have one canonical copy in `tools/shared/`, declared per skill in
  `assets/shared.json` (`[{ "from": "<path in tools/shared>", "to": "<path in the skill>" }]`, a
  trailing `/` mirrors a folder) and copied by `node tools/sync-shared.mjs`. Never edit a synced copy:
  the validator fails on drift. `tools/DECISIONS.md` section 9 names the owner of each shared file; a
  rule is stated once, in its owner skill, and other skills cross-reference it by name.

## 4. Skill anatomy

```
<name>/
  SKILL.md            required, at most 300 lines
  references/         knowledge read on demand (.md); a table of contents when over 100 lines
  templates/          real files copied into the app; line 1 names the repo path; __UPPER_SNAKE__ placeholders
  examples/           complete, small shapes to imitate; never copied
  scripts/            checkers and generators (Node .mjs), scripts/lib/ for helpers
  scripts/selftest.mjs  proves every checker against tests/fixtures/
  tests/fixtures/     the self-test cases (section 8); tests/bases/ for shared base trees
  assets/             data files (JSON tables, the shared.json manifest, a few reviewed goldens)
```

- Create only the folders the skill needs, and no other top-level entries. No empty folders.
- **Every file is listed** in SKILL.md's "Files in this skill" table with when to read or run it. A
  row ending in `/` covers a folder (`tests/fixtures/`).
- **Fixture hygiene:** no file or folder named `.gitignore`, `metadata.json`, `.git`, `__pycache__` or
  `__pypackages__` anywhere in a skill. The skills CLI drops `.git`, `__pycache__`, `__pypackages__`
  and every `metadata.json` when it installs a skill, so a fixture that needs one fails after install;
  git obeys a nested `.gitignore`, so a fixture one silently untracks files and a fresh clone fails.
  Store them as `dot-gitignore` and `dot-metadata.json`; check-lib's case assembly renames them back.
- **Fixture budget** (constants in `tools/standard.json`): `tests/` at most 1 MB and 600 files per
  skill, every file in the skill at most 256 KB, binary files only from the allow-list (images, fonts,
  audio, PDF). Generate large inputs at test time (`writePng`, overlay ops) instead of committing them.
- **Whole-repo budget:** `node tools/check-repo-hygiene.mjs` keeps the files a commit would hold under
  30 MB of unique content and 8,000 files (`tools/standard.json` `repo`), and fails on anything under `skills/` that
  the repo ignores. Keep each case as one entry of the suite's `CASES.json` (its ops and its `"expect"` lines, section 8).

## 5. Frontmatter

```yaml
---
name: state-management-zustand
description: Builds Zustand stores ... Use when adding app state, a store or a selector, or a component re-renders too often. Not for server data (networking-and-server-state).
---
```

- `---` is exactly line 1 (no blank line, no byte-order mark): otherwise agents read no frontmatter.
- **One-line YAML values only**, quoted with `"..."` when they contain `: ` or ` #`. No block scalars
  (`|`, `>`), no continuation lines, no tabs, no anchors. Every agent's YAML reader agrees on this
  subset; a folded description that parses in one agent is a broken skill in another.
- **Keys:** `name` and `description`, plus `argument-hint`, `arguments`, `metadata` (one level, for
  example `metadata:` then `  internal: true`), `license`, `compatibility`. Never `allowed-tools` (it
  makes Claude's own invocation ask for permission, which headless runs deny). No `paths`, `hooks`,
  `user-invocable`, `when_to_use`, `context` or `model`: each hides the skill, costs listing budget,
  forks away the conversation, or works in one agent only.
- **`disable-model-invocation: true`** only on a side-effecting runbook named `run-*` (for example
  `run-migration`, `run-goldens-rebaseline`) whose workflow stops and asks the developer before the
  irreversible step. Such a skill leaves the listing (it costs no budget) and runs only when named.
  Split the knowledge skill (model-invocable, with the gates) from its action runbook.
- **`name`:** 1 to 64 characters of `[a-z0-9-]`, no leading, trailing or double hyphen, equal to the
  folder name. Never a bundled command or skill name (`verify`, `run`, `debug`, `review`, `simplify`,
  `init`, `loop`, ...), never an Expo skill name, never containing "claude" or "anthropic".
- **`description`:** see section 10. Third person, starts with a verb, at most 300 characters (aim for
  250), `Use when ...` with concrete trigger words, `Not for ... (other-skill)`. No `<` or `>`, never
  "I" or "you".

## 6. SKILL.md body

This order, because after context compaction only the first ~5,000 tokens (about 20,000 characters) of
a skill survive: the rules and the definition of done must sit at the top.

```markdown
# Title

One or two sentences: what this skill makes true.

## Rules that must hold
1. **Rule.** Why it matters (one line).     numbered, testable, most important first

## Workflow
1. Step: which reference to read, which template to copy, which script to run, at which step.
N. Run the checks: run, fix, rerun until RESULT: PASS.

## Definition of done
- [ ] Concrete, checkable items ...
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/<check>.mjs <args>` prints `RESULT: PASS`

## Anti-patterns
- What goes wrong, and what to do instead.

## Files in this skill
| File | What it is | Read/run when |

## Related skills
- `other-skill` - when to hand off (names only)
```

- A Related skills item names one of Expo's official skills in one of two forms:
  "- Expo's [official] `<expo-skill>` skill(s) - when to hand off" or "- `<expo-skill>` - (Expo's
  official skill) when to hand off". skill-maintenance's `check-skill.mjs` accepts both only for the
  reserved `expo-`/`eas-` names in `tools/standard.json`.
- A skill with scripts ends its definition of done with the script run that must print
  `RESULT: PASS`, and lists every SKIP line it expects (section 7).
- **Write calmly and explain why.** No ALL-CAPS shouting (`MUST`, `NEVER`, `IMPORTANT`); bold is
  enough. Give one default, not a menu. Be prescriptive where the work is fragile (configs, pins,
  thresholds) and flexible where judgement matters (copy, feel).
- **Say plainly what a human must do by hand** and when. Stop and ask before anything irreversible or
  outward-facing: store uploads, deleting data, spending money, publishing, rotating keys.
- Use the house vocabulary of `tools/DECISIONS.md` section 10: "the developer" or "the reviewer" (never
  "the owner"), "the app", "the app's locales" (examples use `en` and an RTL locale such as `ar`),
  simulators named `<project>-<purpose>`.

## 7. Scripts

The contract every checker keeps, so an agent, CI and the index read every result the same way.

- **Node ESM `.mjs`, Node 22 or newer, zero dependencies** (`node:` built-ins only), importing
  `./check-lib.mjs` (synced from `tools/shared/scripts/`). A skill that truly needs packages
  (Playwright, image diff) ships a pinned `scripts/package.json` and lock, loads them with
  `await import()` (or check-lib's `importPackage`) so `--help` works before installation, and accepts
  `--tooling <dir>`; installs default to `<repo>/.skill-tooling/<skill>` (git-ignored), because the
  skill folder may be read-only, shared, or wiped on a plugin update.
- **Invocation:** `node ${CLAUDE_SKILL_DIR}/scripts/<name>.mjs [repo-root] [options]`. The repo root is
  an optional **positional** argument (default `.`), never `--root`; check-lib answers a guessed
  `--root` with the positional form. Workflows, definitions of done and the index write every command
  out in full.
- **`--help`** prints `Usage:` and exits 0. **Exit codes:** `0` pass, `1` problems found, `2` bad input
  or environment. **The last line** is always `RESULT: PASS` or `RESULT: FAIL (<n> problems)`. Each
  problem line is `FAIL <file>:<line> [<rule>] <message> Fix: <fix>`.
- **Nothing to check is never a pass:** a missing target exits 2. A target that should exist by now is
  a problem (exit 1). Run with no arguments in an empty folder, every script still exits 0, 1 or 2 with
  the RESULT line (the validator checks this).
- **SKIP** (`report.skip`) is for one rule whose target is legitimately not created yet in an app
  adopted incrementally: `notYetCreated(root, { file, owner })` prints
  `SKIP <file> [<rule>] not yet created (<owner> creates it)` and does not count as a problem. Use it
  only for a file another skill or a later step creates, never for the checker's own target.
- **NOT APPLICABLE** (`report.notApplicable('<repo fact>')`, exit 0) is for a whole check that a repo
  fact proves does not apply, for example `react-native-google-mobile-ads` is not in `package.json`.
  Never for a target that is simply missing. SKIP lines and NOT APPLICABLE count as a pass wherever
  results are read; exit 2 never does.
- **Ship gates never skip.** A release, store-artifact or completeness gate has no SKIP and no NOT
  APPLICABLE. Its only relaxation is `--rehearsal` (a keyless dry run): it prints
  `REHEARSAL: not a release gate` first, skips only the signing rule, keeps every other rule strict,
  and a report never cites a rehearsal as release evidence.
- **Layout and config:** resolve paths through check-lib's `resolveLayout(root)` (the canonical layout,
  `tsconfig.json` `paths`, `package.json` `workspaces`, an optional repo file `rn-skills.config.json`,
  per-script options). App-specific facts (screens and testIDs, settings fields, contrast pairs, perf
  budgets) live in a repo-owned `contracts/<name>.json` whose template the skill ships: the checker
  stays strict, the facts belong to the app.
- **Repo scans** use check-lib's repo walk, which applies `REPO_SCAN_IGNORES` (node_modules, generated
  native folders, build output) and prunes every folder that holds a `SKILL.md`, because installed
  skills live inside the app (`.agents/skills/`, `.claude/skills/`, ...) and their fixtures plant bugs on
  purpose. Every scanning checker has a fixture with planted findings under `.agents/skills/` and
  `skills/` that must stay silent.
- **Devices are always named.** Several sessions share one machine, and a call that picks "the booted
  simulator" or "the only device" can reach someone else's. Every `maestro` call passes
  `--device <id>` before the command (in code, through a binding helper such as `maestroGlobalArgs()`);
  `xcrun simctl` targets a UDID, never `booted` or `all`; `xcodebuild -destination id=<udid>` (an
  archive uses `generic/platform=iOS`); `adb -s <serial>` before the command; emulators by AVD name.
  A sentence that forbids a command and the Anti-patterns section may still name it.
- Scripts write only into the app repo (reports, caches), never next to themselves.

## 8. Self-test fixtures and the overlay format

`scripts/selftest.mjs` calls check-lib's `runSelftest(import.meta.url, suites)` over `tests/fixtures/`.
A suite is `tests/fixtures/` itself or `tests/fixtures/<checker>/`. Case folders, by name:

| Case | Must | `EXPECT.txt` |
|---|---|---|
| `good/` | exit 0 with `RESULT: PASS` | optional |
| `pass-<case>/` | exit 0 and print every line of `EXPECT.txt` (a SKIP line, a NOT APPLICABLE fact) | required |
| `bad-<case>/` | exit 1 and print every line (the rule id and `file:line`); one planted bug per rule, at least one per suite | required |
| `error-<case>/` | exit 2 and print every line (the ERROR text) | required |

An optional `ARGS.txt` replaces the suite's arguments for that case.

**The overlay format is the default.** A suite declares a base tree (`tests/bases/<name>/`, the
skill's `templates/`, or `good/`, named in `SUITE.json` or in the suite's `base` option), and a case
folder holds only `EXPECT.txt` plus `mutation.json` (ordered ops: `replace`, where the find string must
exist; `json`, set or delete a path; `write`; `delete`; `rename`; `png`, a generated image; check-lib
also knows `copy`, `mkdir`, `symlink`, `plant` and the legacy `reformat`) and/or overlay files and
`DELETE.txt`. runSelftest assembles each case in a temporary folder; every op must apply, so a stale
fixture fails loudly. `--materialize <dir>` writes the assembled cases for a human to read. Assembling
from `templates/` also proves that the shipped templates pass their own checker.

**One entry per case (preferred):** keep every case in the suite's `CASES.json`, its `EXPECT.txt` lines as
`"expect"` (`{ "bad-x": { "expect": ["[rule-x]", "src/a.ts:3"], "ops": [...] }, "pass-y": { "expect": ["NOT APPLICABLE"], "args": ". --strict", "ops": [...] } }`),
so the case needs no folder at all; `node tools/fixtures-pack.mjs <skill-dir> --expect --verify` packs existing
cases and proves every assembled case and outcome unchanged. A key without `"expect"` names a case folder that
holds its `EXPECT.txt`; a key with neither, a case with both an entry and its own `mutation.json`, or both
`"expect"` and `EXPECT.txt`, fails loudly.

Planted secrets are stored defused and assembled at run time (push protection blocks real-looking
keys). PNGs are generated with check-lib's `writePng`, not committed, except a few reviewed goldens.

## 9. Templates, examples and the harness

- **Templates are complete, real files** that compile and lint under the canonical configs: strict
  TypeScript 6, the ESLint flat config, the naming and size limits, named exports, logical style keys,
  message keys instead of literal UI strings. Line 1 names the repo path the file is copied to
  (`// src/features/tasks/use-tasks-model.ts`), or the template sits at that path under `templates/`.
  Placeholders are `__UPPER_SNAKE__`.
- **Template closure:** a template's relative imports resolve to templates of the same skill or of a
  named prerequisite skill; its test ships with it.
- **The harness** (`tools/DECISIONS.md` section 8, `tools/harness/README.md`): `tools/harness/` is the reference
  Expo SDK 57 app, a small Tasks app with the canonical files and every adopted kit wired in. `node tools/verify-templates.mjs <skill>` copies a skill's templates into a temporary copy of it at the paths their first line names,
  then runs `tsc --noEmit`, ESLint with `--max-warnings 0` and the copied Jest tests. A template that
  does not pass there does not ship.
- **Examples** are complete, realistic and small; one good example beats three partial ones. They are
  shapes to imitate, never copied verbatim.
- **References** are knowledge rewritten to make sense inside the skill (no "see the handbook"), with a
  table of contents near the top when longer than 100 lines. Every version-sensitive fact carries a
  "verified on <date>" and a re-verify command.

## 10. Descriptions and routing

An agent sees only names and descriptions until it loads a skill; the body is read afterwards, so a
rule written only in the body can never make the skill load. The listing is budgeted (Claude Code
keeps names and descriptions within about 1% of the context window and drops whole descriptions of
the least-used skills when over), and this library shares that listing with the user's other skills.

**The formula:** `<Verb>s <what, packed with the concrete nouns of the job>. Use when <the intents and
trigger words a task would contain>. Not for <the neighbour's work> (<neighbour-skill>).`

- At most 300 characters (`tools/standard.json`), aiming for 250 on average across the set. Third
  person, starting with a verb ("Builds", "Checks", "Ships", "Diagnoses", "Adds").
- The first 8 to 12 words are unique across the set: a distinct verb and object. Put the key use first.
- "Use when" lists what a task would say: file names, commands, symptoms ("upload fails", "renders
  wrong"), error words. Be a little pushy: agents under-use skills for tasks that look easy.
- "Not for" names the neighbouring work and, in parentheses, the exact folder name that owns it; it is
  how an agent tells two close skills apart.
- Describe intent, not implementation ("Ships a build to TestFlight", not "runs release-ios.ts").
- **Routing evals:** `tools/routing-evals.json` holds at least three realistic prompts per skill
  (`{ "prompt": "...", "expect": "<skill>" }`, or `"expect": null` when no skill should load), including near misses
  that share words with a skill but belong to its neighbour (`"near": "<that skill>"`); `node tools/check-routing-evals.mjs`
  checks structure and coverage. skill-maintenance's `check-routing.mjs` ranks them
  offline (free, seconds); `--live --runs 3` asks the model (manual, costs calls). When an eval fails,
  fix the category of intent in the description, never paste the prompt's words into it.

## 11. Catalogue and plugins

`tools/catalog.json` is the single source for each skill's category, plugin (`core` or `games`) and
manual-only flag. `node tools/build-catalog.mjs` writes `skills.json`, `docs/skills-data.js`, the
skill tables in README.md, the intent map in AGENTS.md (between `<!-- generated:... -->` markers) and
the two plugin entries of `.claude-plugin/marketplace.json`: `react-native` (core) and
`react-native-games`, each listing its `skills`, which replaces the default `skills/` scan, and carrying the plugin
metadata. There is no `.claude-plugin/plugin.json`: both entries share the repo root, so its name would replace both
entry names and load every games skill as `react-native:<skill>` (build-catalog fails on one). Installed, skills load
as `react-native:<skill>` and `react-native-games:<skill>`. `.codex-plugin/plugin.json` is the one Codex manifest
(every skill). `node tools/tests/plugin-manifests.test.mjs` checks all of them against the catalogue. **Never edit generated output by hand;** change the catalogue or
the frontmatter and rebuild. The index skill renders its own task table from its `assets/index.json`.

## 12. The stack table

The verified versions live in `tools/stack.json`: each entry has the version a fresh install resolves,
the range of statements that count as consistent (Expo's own specifier for SDK-bundled packages, the
exact pin otherwise), the `package.json` specifier skills write, how it was verified, the date and the
re-verify command. Defaults on 2026-10-03 (Expo modules refreshed 2026-10-17): Expo SDK 57 (`expo`
57.0.27), React Native 0.86.3, React 19.2.3, TypeScript 6.0.3, Expo Router, Reanimated 4.5.1, Gesture
Handler 2.32, Skia 2.6.2, Zustand 5, TanStack Query 5, valibot, react-hook-form, react-intl, Jest 29.7
with jest-expo 57 and React Native Testing Library 14, ESLint 9, Maestro 2.10, EAS CLI, Node 22.18 or
newer (projects pin 26), Xcode 26.6, Android compileSdk and targetSdk 36.

- A skill cites versions from the table and says "verified on <date>" with the re-verify command.
- `node tools/check-stack-pins.mjs` fails on a skill that states another version
  (`"zustand": "^5.0.10"`, `expo 57.0.20`, `Xcode 26.4`). A line that deliberately names another
  version (an upgrade guide, a known-failure entry) carries a `stack-pin-ignore` marker.
- Moving to the next Expo SDK is a data refresh: update `tools/stack.json`, rerun the check, fix what
  it reports.

## 13. Quality bar

- **Complete:** someone with only this skill does the job right the first time.
- **Correct:** versions and APIs match the stack table and the libraries' versioned docs, never
  memory. Expo, React Native and TypeScript move faster than training data.
- **Deep:** rules with reasons, the traps that actually happened, and checkers with teeth. A rule that
  encoded one app's product decision is restated as a general default or an opt-in profile, not
  deleted.
- **Self-verifying:** the definition of done ends in a script that proves the work, and the script
  proves itself against planted bugs.
- **Honest:** a fact verified on one platform, by reading source, or not at all says so.

## 14. Before opening a pull request

Run from the repo root; every command must end with `RESULT: PASS`.

```sh
node tools/sync-shared.mjs --check          # every synced copy matches tools/shared/ (fix with: sync-shared.mjs <skill>...)
node tools/validate-skills.mjs <skill>      # the standard, including --help and no-argument script runs
node tools/selftest-all.mjs <skill>         # the skill's self-test (drop <skill> to run everything)
node tools/check-stack-pins.mjs <skill>     # versions agree with tools/stack.json
node tools/build-catalog.mjs --check        # generated catalogue files are current
node tools/check-repo-hygiene.mjs           # nothing ignored under skills/, budgets, no stray SKILL.md
node tools/check-routing-evals.mjs          # routing prompts cover every skill
node skills/skill-maintenance/scripts/check-skill-set.mjs .   # descriptions fit the listing budget
node tools/tests/selftest.mjs               # when you changed anything under tools/
node tools/verify-templates.mjs <skill>     # when you changed templates (needs: cd tools/harness && npm ci)
```

Also run `node tools/check-routing-evals.mjs` when you add a skill or change a description (add at least three
prompts that should load the skill and a near miss to `tools/routing-evals.json`), and
`node tools/tests/plugin-manifests.test.mjs` plus `claude plugin validate . --strict` when you touch the catalogue or the
manifests. CI (`.github/workflows/ci.yml`) runs all of these, the full self-test and the template proof in the harness.
