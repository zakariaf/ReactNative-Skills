# Maintainer tools

`tools/` holds what keeps the skill library honest. Nothing here is installed with a skill, and no
file here is named `SKILL.md`. Every tool is Node 22+ ESM with zero dependencies, takes `--help`, exits
0 (pass), 1 (problems found) or 2 (bad input or environment), and ends with `RESULT: PASS` or
`RESULT: FAIL (<n> problems)`. Run them from the repo root.

Binding decisions: [DECISIONS.md](DECISIONS.md). The authoring standard: the repo's `CONTRIBUTING.md`.

## Contents

- Folder map
- The order to run things
- Commands
- validate-skills and standard.json
- Shared files and assets/shared.json
- selftest-all
- check-repo-hygiene
- check-stack-pins and stack.json
- build-catalog
- Plugin manifests
- check-routing-evals and routing-evals.json
- The tools' own tests
- Recommended settings
- CI

## Folder map

| Path | What it is |
|---|---|
| `DECISIONS.md` | The binding house decisions (stack, app layout, repo layout, vocabulary, owners) |
| `standard.json` | Every constant of the skill standard: description cap, section names, key allow-list, reserved names, ban lists, fixture and repo budgets, device-binding helpers |
| `stack.json` | The canonical verified versions (packages and toolchain), each with how it was verified and a re-verify command |
| `catalog.json` | Every skill: category, plugin (`core`/`games`), manual flag and a one-line summary |
| `routing-evals.json` | Realistic task prompts and the skill each should load (or `null`), with near misses |
| `validate-skills.mjs` | The standard's checker |
| `sync-shared.mjs` | Copies `shared/` files into the skills that declare them |
| `selftest-all.mjs` | Runs every self-test (tools, shared helpers, skills) |
| `check-repo-hygiene.mjs` | Whole-repo checks (ignored files under `skills/`, stray `SKILL.md`, budgets, symlinks, `.DS_Store`) |
| `check-stack-pins.mjs` | Finds version statements in skills that disagree with `stack.json` |
| `check-routing-evals.mjs` | Checks `routing-evals.json`: structure, known skills, duplicates, coverage, near misses |
| `fixtures-pack.mjs`, `fixtures-to-overlay.mjs` | Move a skill's fixture cases to the overlay format and pack them into `CASES.json`, proving every case unchanged (each has a `*.selftest.mjs`) |
| `build-catalog.mjs` | Writes `skills.json`, `docs/skills-data.js`, the marketplace entries, the README tables and the AGENTS.md intent map |
| `verify-templates.mjs`, `harness/` | The template proof: a skill's templates compiled, linted and tested inside the reference Expo SDK 57 app (DECISIONS.md section 8; documented in its own `--help`) |
| `lib/library.mjs` | Shared plumbing: repo paths, skill discovery, the `assets/shared.json` manifest |
| `lib/frontmatter.mjs` | The strict one-line YAML subset parser for SKILL.md frontmatter |
| `shared/` | The one canonical copy of every file more than one skill carries: `scripts/` (check-lib, the `lib/` helpers, their self-tests and `API.md`), `repo-templates/` (the app files and configs DECISIONS.md section 9 assigns to owners), `games/` (the games plugin's contract kit) and `expo-sdk-57-module-map.json` (dependency-management). Nothing else lives here: a file no skill declares, no tool reads and no self-test runs is deleted |
| `tests/selftest.mjs`, `tests/build-cases.mjs` | The tools' own self-test and the generator of the validator's sample skills |
| `tests/check-routing-evals.selftest.mjs`, `tests/plugin-manifests.test.mjs`, `tests/verify-templates.selftest.mjs` | The self-tests of check-routing-evals and verify-templates, and the manifests test |

## The order to run things

After changing a skill or a shared file:

```sh
node tools/sync-shared.mjs <skill>...      # 1. copy shared files into the skills you name (never a blanket sync)
node tools/validate-skills.mjs <skill>     # 2. check the skill against the standard
node tools/selftest-all.mjs <skill>        # 3. prove its checkers
node tools/check-stack-pins.mjs <skill>    # 4. versions agree with stack.json
node tools/build-catalog.mjs               # 5. regenerate the catalogue files
node tools/check-repo-hygiene.mjs          # 6. whole-repo hygiene and budgets
node tools/check-routing-evals.mjs         # 7. routing prompts still cover every skill
```

After changing anything under `tools/`: `node tools/tests/selftest.mjs`.

## Commands

| Command | What it does | Exit 1 means |
|---|---|---|
| `validate-skills.mjs [skill...] [--no-run] [--rule <id>] [--summary] [--json] [--standard <file>]` | Checks skills against the standard (next section). A skill is a folder name in `skills/` or a path. With no arguments: every folder in `skills/` plus the layout of `skills/` itself. `--no-run` skips running skill scripts; `--rule` (repeatable, or comma-separated) reports only those rules; `--summary` prints one line per skill and the problem count per rule, plus description statistics | a rule is broken |
| `sync-shared.mjs [skill...] [--check]` | Copies `shared/<from>` to `<skill>/<to>` for each `assets/shared.json` entry; a folder entry mirrors the folder (extra files removed). `--check` changes nothing | a manifest is invalid, or (with `--check`) a copy is missing, changed or extra |
| `selftest-all.mjs [skill...] [--shard i/n] [--skip-library] [--timeout s]` | Runs `tests/selftest.mjs`, every `shared/scripts/**/*.selftest.mjs`, and every skill's `scripts/selftest.mjs`, then prints a table | a self-test failed or is missing |
| `check-repo-hygiene.mjs [repo-root] [--standard <file>]` | Whole-repo hygiene (section below) | a hygiene rule is broken |
| `check-stack-pins.mjs [skill...] [--strict] [--summary] [--verbose] [--stack <file>]` | Version statements versus `stack.json` (section below) | a statement disagrees |
| `build-catalog.mjs [--check] [--repo <dir>] [--catalog <file>]` | Writes the generated catalogue files; `--check` writes nothing | (with `--check`) a generated file is missing or stale; a skill folder is not catalogued; a manual flag disagrees; a root `.claude-plugin/plugin.json` exists |
| `fixtures-pack.mjs <skill-dir> [--dry-run] [--verify] [--expect] [--suite <rel>]...` | Packs a skill's overlay cases into one `CASES.json` per suite (with `--expect` each case's `EXPECT.txt` lines too, so a case is one entry and needs no folder; DECISIONS.md section 7), after proving with the skill's `selftest.mjs --materialize` that every assembled case is byte for byte unchanged (`--verify`: the case outcomes too); restores tests/ on any difference. Its own test: `node tools/fixtures-pack.selftest.mjs` | an assembled case or outcome changed (tests/ restored) |
| `tests/build-cases.mjs <out-dir>` | Writes the validator's sample skills into a folder, for inspection | never |
| `tests/selftest.mjs` | The tools' own self-test | a tool misbehaves |
| `check-routing-evals.mjs [--evals <file>] [--catalog <file>] [--min-per-skill n] [--min-near n] [--min-null n]` | Structure and coverage of the routing evals (section below) | an eval is malformed, names an unknown skill or repeats one; a skill lacks prompts or a near miss |
| `tests/check-routing-evals.selftest.mjs` | check-routing-evals against one planted bug per rule | the tool misses a bug |
| `tests/plugin-manifests.test.mjs [--repo <dir>]` | The manifests against the catalogue (section below), then one planted bug per rule | a manifest disagrees, or a rule misses its bug |

The skill-level tools accept `--skills-root <dir>` (default `<repo>/skills`) and, where shared files
matter, `--shared <dir>` (default `tools/shared`), so the tests can run them on throwaway folders and
CI can run them on an installed copy.

## validate-skills and standard.json

`validate-skills.mjs` reads every constant from `standard.json` (pass `--standard <file>` to try a
change, or to reuse the validator for another library). `node tools/validate-skills.mjs --help` prints
the full rule list; in short:

| Group | Rules |
|---|---|
| Frontmatter | `skill-md`, `fm-line1`, `fm-close`, `fm-yaml`, `fm-key`, `fm-dmi-runbook` (`disable-model-invocation: true` only in a `run-*` skill whose body has a stop-and-ask step), `fm-no-allowed-tools` |
| Name and description | `name-format`, `name-match`, `name-reserved` (bundled commands, Expo's skill names, "claude"/"anthropic"), `desc-length` (300, aim 250), `desc-angle`, `desc-verb`, `desc-person`, `desc-trigger` |
| Body | `skill-lines` (300), `sections` (Rules that must hold > Workflow > Definition of done > Anti-patterns > Files in this skill > Related skills), `section-format`, `dod-position`, `dod-script`, `link-resolve`, `files-listed`, `files-exist`, `ref-toc`, `no-shouting` |
| Self-contained | `no-project-ref` (absolute home paths incl. `/home/` and `C:\Users\`, scratch paths, `../` in markdown, `../../` in scripts, other skills' folders, `tools/...` and `skills/_library/...`), `no-runtime-env` (`CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, ...; scripts read no `CLAUDE_*` variable) |
| Devices | `device-explicit` (maestro `--device`, simctl UDID, xcodebuild `id=`, `adb -s`; helper names from `standard.json` `device.bindingHelpers`) |
| Layout and fixtures | `layout`, `fixture-hygiene` (no `.gitignore`, `metadata.json`, `.git`, `__pycache__`, `__pypackages__` anywhere), `fixture-budget` (`tests/` 1 MB and 600 files, every file 256 KB, binary allow-list), `fixtures` (suites, EXPECT.txt, overlay files: `mutation.json` ops, `DELETE.txt`, `overlay/`, `SUITE.json`) |
| Scripts | `script-lib`, `script-deps`, `script-help`, `script-result` (each script is run with `--help` and with no arguments in an empty temporary folder, 30 s limit), `selftest-missing` |
| Shared files | `shared-json`, `shared-drift`, `shared-undeclared` |
| The skills folder | `library-layout` (only skill folders: no README.md, no `_library/`, no stray files or links) |

Every folder in `skills/` is validated as a skill (discovery skips nothing but non-directories), so a
leftover folder fails loudly. Long per-file findings are capped at 25 per rule per skill with a "N more"
line. `--summary` gives the per-rule counts across the library (all zero on a green main).

`standard.json` keys: `frontmatter` (allowed keys, banned keys, advice, the runbook rule), `names`
(pattern, reserved names), `description` (cap, target, trigger phrases, words that look like verbs but
are not), `skillMd` (line cap, section order, Files header, ToC threshold, compaction limit, shouting
words), `layout`, `projectRefs` (patterns, repo tooling entries), `runtimeEnv`, `device`, `scripts`
(timeout, Node built-ins), `fixtures` (case kinds, overlay files and ops mirrored from check-lib,
hygiene names and renames, budgets, binary allow-list), `listing` (set budget), `repo` (whole-repo
budget, folders that must hold no `SKILL.md`).

## Shared files and assets/shared.json

`shared/` holds the one canonical copy of every file more than one skill ships; DECISIONS.md section 9
names each file's owner skill. A skill declares what it copies:

```json
[
  { "from": "scripts/check-lib.mjs", "to": "scripts/check-lib.mjs" },
  { "from": "repo-templates/__mocks__/", "to": "templates/__mocks__/" }
]
```

`from` is relative to `shared/`, `to` to the skill folder; a folder entry ends both with `/` and
mirrors the folder. Never edit a copy: change the canonical file, run `sync-shared.mjs`, then validate.
A shared helper may carry its own self-test as `shared/scripts/**/<name>.selftest.mjs`.

## selftest-all

- Runs each self-test from the folder above the skills root, 600 s each, and prints `SKILL SELFTEST
  RESULT TIME NOTE` rows plus the last 20 lines of every failure.
- `--shard i/n` keeps every n-th row (round-robin, 1-based), so `--shard 1/4` ... `--shard 4/4` cover
  everything once across four CI jobs.
- `--skills-root /tmp/app/.claude/skills --skip-library` runs the skills as an installer copied them
  (links to `.agents/skills/<n>` are followed), which proves installed self-tests still work.
- When the `CI` environment variable is set, every failure is also printed as a GitHub annotation:
  `::error file=<path>,title=<rule>: <row>::<message>`.

## check-repo-hygiene

| Rule | What it checks |
|---|---|
| `ignored-under-skills` | No file under `skills/` matches an ignore rule, so a fresh clone and every installed copy keep it. In a git repo it asks `git check-ignore --no-index`; in a plain folder it evaluates every `.gitignore` itself (anchoring, `**`, dir-only rules, negation, nested files, a file in an ignored folder). Installed `node_modules/` are skipped |
| `skill-md-misplaced` | No file named `SKILL.md` under `tools/` or `docs/` (`standard.json` `repo.noSkillMdUnder`) |
| `repo-budget` | The files a commit would hold (tracked plus untracked, minus ignored) stay within 30 MB of unique content and 8,000 files (`standard.json` `repo`; measured 2026-10-17 after every case moved into its suite's `CASES.json`: 7,461 files, 28.7 MB) |
| `skills-symlink` | No symlink anywhere under `skills/` |
| `ds-store` | No `.DS_Store` anywhere outside `.git/`, `node_modules/` and git-ignored folders |

The repo `.gitignore` re-includes `skills/**/*.log` after ignoring `*.log`, because fixture logs are
test content. It also ignores the local-only folders `.attic/` (unpublished maintainer material),
`.skill-tooling/` (pinned package installs) and `.claude/workflows/` (maintainer automation); every rule
above skips them, so nothing there counts toward the budget or fails a check.

## check-stack-pins and stack.json

`stack.json` has one entry per tracked package (`packages`) and tool (`toolchain`):

```json
"expo-sqlite": {
  "version": "57.0.4", "range": "~57.0.4", "spec": "~57.0.4", "accept": ["57.0.3"],
  "names": ["expo-sqlite"], "published": "2026-10-06",
  "how": "npx expo install --check in tools/harness expects ~57.0.4 ...",
  "verified": "2026-10-17", "reverify": "npm view expo-sqlite@~57.0.4 version"
}
```

`version` is what a fresh install resolves; `range` is what counts as consistent (Expo's specifier for
SDK-bundled packages, the exact pin otherwise; `>=` for a minimum such as Node); `spec` is what a
`package.json` writes; `names` are the prose names; optional `published`, `jsonKeys` (`engines.node`),
`assign` (`XCODE_VERSION = '26.6'`, `compileSdkVersion = 36`), `notAfter` (words that make a name mean
something else: "iOS SDK" is not "Expo SDK"), `accept` (other exact versions also verified).

`check-stack-pins.mjs` reads markdown outside `tests/`, and `templates/`, `examples/`, `assets/` (not
test files), and reports only explicit name+version statements:

- `"zustand": "^5.0.15"` (a `package.json` entry: its floor must lie in the range, and a specifier that
  is neither the table's spec nor its range is `stack-spec`), `zustand@5.0.15` (lines with `npm view`
  are queries and are skipped), and prose such as `React Native 0.86.3`, `Expo SDK 57`, `Xcode 26.6`,
  `Node >= 22.18`, `Jest 29+`.
- Not reported unless `--strict`: prose or npm statements of a version newer than the range (an
  upcoming or held-back release), statements in a clause with contrast wording (`stack.json`
  `contrastWords`: "not", "never", "beta", "upgrade", "->", ...), a prose statement on a line that also
  states the verified version (a comparison), and markdown Anti-patterns sections. The summary line
  counts what each context rule skipped.
- Markers: `stack-pin-ignore` on a line, `stack-pin-ignore-next-line`, a `stack-pin-ignore-start` /
  `stack-pin-ignore-end` block, or `stack-pin-ignore-file` in the first ten lines (in JSON, inside a
  `"$comment"` string).

To refresh the table (for example for Expo SDK 58): create a fresh app with `npx create-expo-app@latest`,
read its `package.json` and `node_modules/expo/bundledNativeModules.json`, run each entry's
`reverify` command, update `version`, `range`, `spec`, `how` and `verified`, then run
`node tools/check-stack-pins.mjs --summary` and fix the skills.

## build-catalog

Reads `catalog.json` and each skill's frontmatter and writes:

| Output | Content |
|---|---|
| `skills.json` | `name, repo, standard, count, planned, categories, plugins, skills[]` with `name, description, category, categoryLabel, plugin, manual, rich (has references/, templates/ or scripts/), checker (has scripts/selftest.mjs), path` |
| `docs/skills-data.js` | `window.SKILL_CATEGORIES` and `window.SKILLS` (the same skills) for the Pages site |
| `.claude-plugin/marketplace.json` | The `react-native` (core) and `react-native-games` entries: `source: "./"`, the description, the shared metadata (`PLUGIN_META`: version, author, homepage, repository, license) with keywords, and a `skills` list of `./skills/<name>` paths; every other field and entry is kept |
| `README.md` | The skill tables between `<!-- generated:skills:start -->` and `<!-- generated:skills:end -->` |
| `AGENTS.md` | The intent map between `<!-- generated:intents:start -->` and `<!-- generated:intents:end -->` |

A missing README.md or AGENTS.md is created as a placeholder with the markers; a file without markers
gets the block appended. Skills planned in `catalog.json` but not on disk yet are listed as a note.
Plugin facts (Claude Code plugin reference, read 2026-10-03; namespaces verified 2026-10-17 with
`claude plugin install` from a local copy and `claude plugin details`): when a marketplace entry whose `source` is the
marketplace root lists `skills`, only those folders load and the default `skills/` scan is skipped. There is no
`.claude-plugin/plugin.json`: both entries share the root, so its name would replace both entry names and every games
skill would load as `react-native:<skill>`. Without it each entry is its own manifest: `react-native:<skill>` and
`react-native-games:<skill>`.

## Plugin manifests

`tests/plugin-manifests.test.mjs` checks what an install reads: `.claude-plugin/marketplace.json` (named
`react-native-skills`, both entries present with `source: "./"`, the repository URL, MIT, one semver version, every
built skill in exactly one plugin and in the plugin `catalog.json` gives it, every path a skill folder), no root
`plugin.json`, `.codex-plugin/plugin.json` (name, URLs, `skills: "./skills/"`, the same version), `skills.json` and
`docs/skills-data.js` against the catalogue, `docs/index.html` loading the data, the README install lines and
`LICENSE`. It then plants one bug per rule in a temporary copy. `claude plugin validate . --strict` is Claude Code's
own check of the same files. Release a new version by changing `PLUGIN_META.version` in `build-catalog.mjs` and
`.codex-plugin/plugin.json` together, then `node tools/build-catalog.mjs`.

## check-routing-evals and routing-evals.json

`routing-evals.json` is `{ "evals": [{ "prompt", "expect", "near"? }] }`: a task written the way a developer writes it
(without the skill's name, except for `run-*` runbooks, which are invoked by name), the skill that should load
(`null` when no skill in the library should), and for a near miss the skill whose words it shares. The checker
needs at least 3 prompts per catalogue skill, one near miss per model-invocable skill and one `null` prompt, and
fails on unknown skills, `"none"` instead of `null`, duplicates (case and punctuation ignored) and local machine
paths. It ranks nothing: skill-maintenance's `check-routing.mjs` does (offline in seconds, or `--live --runs 3`
with Claude Code, by hand):

```sh
node skills/skill-maintenance/scripts/check-routing.mjs . --evals tools/routing-evals.json          # offline ranking
node skills/skill-maintenance/scripts/check-routing.mjs . --evals tools/routing-evals.json --live --runs 3 --plugin-dir .
```

When an eval fails, fix the category of intent in the skill's description, never paste the prompt's words into it.

## The tools' own tests

`tests/selftest.mjs` covers every tool: each validator rule has a planted-bug case that fails exactly
that rule and the good cases pass (the cases are generated into a temporary folder by
`tests/build-cases.mjs`; nothing is committed), the detectors (project references, runtime variables,
devices), the layout and overlay rules, sync-shared, selftest-all (shards, annotations, an installed
copy), check-repo-hygiene in a plain folder and a git repo, check-stack-pins, and build-catalog.
check-lib has its own self-test, `shared/scripts/check-lib.selftest.mjs`; selftest-all runs both. The newer tools
keep their tests beside them and CI runs each: `tests/check-routing-evals.selftest.mjs`,
`tests/plugin-manifests.test.mjs`, `tests/verify-templates.selftest.mjs`, `fixtures-pack.selftest.mjs` and
`fixtures-to-overlay.selftest.mjs`.

## Recommended settings

For people who use the skills in Claude Code, in `.claude/settings.json` (verify the plugin path on
your machine):

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

Project allow rules are dropped while the workspace is untrusted, and `*` also matches spaces. The
listing budget is about 1% of the context window (`skillListingBudgetFraction`); the library keeps its
descriptions short so it leaves room for other skills.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main` (Linux, `contents: read`, actions pinned to
full commit SHAs, Node from `.nvmrc`, older runs of a pull request cancelled):

| Job | Runs |
|---|---|
| catalogue | `sync-shared --check`, `build-catalog --check`, the index skill's `build-index.mjs --check`, `check-repo-hygiene`, `check-stack-pins`, skill-maintenance's `check-skill-set` (listing budget), `check-routing-evals` and its self-test, the manifests test, the fixture tools' self-tests |
| validate-skills | `validate-skills` on every skill |
| selftest (4 shards) | `selftest-all --shard i/4` |
| harness (4 shards) | `npm ci` in `tools/harness` under its `.npmrc` policy; on shard 1 the harness gates (npm config, typecheck, ESLint, Prettier, knip, Jest with coverage), the verify-templates self-test and the drift check; on every shard `verify-templates` for a quarter of the skills |

Nothing in CI runs a device, a simulator, a native build or a release gate (design-review-workflow's `check-signoff`
needs a signed device review). Live routing evals run only by hand: they cost model calls and need secrets that fork
pull requests must not get. Validate a workflow change with `actionlint .github/workflows/ci.yml`.
