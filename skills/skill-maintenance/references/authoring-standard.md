# The skill authoring standard

The rules every skill follows, restated in full so this skill stands alone. `validate-skill.mjs` in this skill enforces the checkable parts (constants in `assets/standard.json`); `check-skill.mjs` checks the finishing parts; a skill is finished only when both, and the skill's own self-test, print `RESULT: PASS`.

## Contents

- 1. Where skills live
- 2. Self-contained, always
- 3. Folder anatomy
- 4. Frontmatter
- 5. SKILL.md body and section order
- 6. Writing
- 7. References, templates, examples, assets
- 8. Quality bar
- 9. Every validator rule
- 10. What check-skill.mjs adds

## 1. Where skills live

- **Authored skills** live at `skills/<name>/` in the repo, exactly one folder deep. `skills/` holds only skill folders: no README, no tooling, no templates of the repo, because installers scan `skills/<child>` and one level deeper and would offer anything else as a skill.
- **Installed skills** live elsewhere, and a skill must work in each place: a Claude Code plugin cache (`claude plugin install`, or `claude --plugin-dir .` while developing), the skills CLI's `.agents/skills/<name>/` inside an app (`npx skills add <github-user>/<repo> --skill <name>`), or a project's `.claude/skills/<name>/` (a copy or a symlink). Never author straight into `.claude/skills/`: every write there asks the developer.
- A skill library keeps its maintainer tools (validator, shared-file sync, catalogue build) outside `skills/`, and no file outside a skill folder is named `SKILL.md` (a deep scan would install it). Scaffolds are `SKILL.md.tmpl`.

## 2. Self-contained, always

A skill is loaded alone. It must finish and verify its job with nothing but its own folder.

- **Never point at a file outside the skill:** no repo docs, specs, design files, research notes, other skills' folders, maintainer tool paths, absolute home paths (macOS, Linux or Windows), scratch or temporary paths, no `../` link in markdown and no `../../` in a script. Copy the knowledge into `references/`, `assets/` or `scripts/lib/` instead.
- **No runtime variables that only some agents or install scopes set:** never the plugin-root, plugin-data, project-dir or env-file variables, and no script reads a `CLAUDE_*` environment variable. Scripts find themselves with `import.meta.url` and take the repo root as an argument.
- `${CLAUDE_SKILL_DIR}` is the one allowed variable, in markdown only. It means "the folder that contains this SKILL.md"; agents that do not expand it substitute that path (say so once in the repo's AGENTS.md).
- **Paths the skill creates or checks in the app** (`src/features/tasks/tasks-screen.tsx`, `contracts/screens.json`) are content, not dependencies.
- **Another skill may be named for a hand-off** ("then load `e2e-maestro`"), never depended on: never call its scripts, never read its files.
- **Shared files** (the script helper, a template two skills ship for the same repo path) have one canonical copy in the library's shared folder. Each skill declares its copies in `assets/shared.json` (`[{ "from": "<path in the shared folder>", "to": "<path in the skill>" }]`, a trailing `/` mirrors a folder) and the library's sync copies them. Never edit a synced copy: `validate-skill.mjs --shared <folder>` fails on drift. One skill owns each shared file and states its rule; the others cross-reference that skill by name.

## 3. Folder anatomy

```
<name>/
  SKILL.md            required, at most 300 lines
  references/         knowledge read on demand (.md; a Contents list when over 100 lines)
  templates/          real files copied into the app; line 1 names the repo path; __UPPER_SNAKE__ placeholders
  examples/           complete, small shapes to imitate; never copied
  scripts/            checkers and generators (Node .mjs); scripts/lib/ for helpers
  scripts/selftest.mjs   proves every checker against tests/fixtures/
  tests/fixtures/     overlay cases (good/, bad-*/, pass-*/, error-*/); tests/bases/ for shared bases
  assets/             data (JSON tables, shared.json, a few reviewed goldens)
```

- Create only the folders the skill needs; an empty folder fails the validator. No other top-level entry, no symlinks.
- **Every file is listed** in the "Files in this skill" table with when to read or run it; a row ending in `/` covers a folder.
- References are linked one level deep from SKILL.md: a reference never sends the reader to another reference for the rule itself.

## 4. Frontmatter

```yaml
---
name: kebab-case-name
description: Builds X for any Expo app. Use when <concrete intents and trigger words>. Not for <neighbour work> (other-skill).
---
```

- `---` is exactly line 1 (no blank line, no byte-order mark), or no agent reads the frontmatter.
- **One-line values only**, double-quoted when they hold `: ` or ` #`. No block scalars (`|`, `>`), no continuation lines, tabs or anchors: every agent's YAML reader agrees on this subset.
- **Keys:** `name`, `description`, and only when needed `argument-hint`, `arguments`, `metadata` (one level), `license`, `compatibility`. Never `allowed-tools` or `hooks` (the agent's own Skill call then needs approval and is denied in headless runs), never `paths` (it hides the skill until a matching file is read), `user-invocable`, `when_to_use`, `context` or `model`.
- **`disable-model-invocation: true`** only on a side-effecting runbook named `run-*` (`run-migration`, `run-store-upload`) whose workflow stops and asks the developer before the irreversible step. It leaves the listing (it costs no budget) and runs only when named. Split the knowledge skill (model-invocable, with the gates) from its action runbook.
- **`name`** equals the folder name: 1 to 64 characters of `a-z`, `0-9` and single hyphens. Never a bundled command or skill (`verify`, `run`, `debug`, `review`, `simplify`, `init`, `loop`, `help`, `doctor`, `skills`, `batch`, `schedule` and the rest of `names.reserved` in `assets/standard.json`), never an Expo skill name (all 24 of `expo/skills` are reserved, from `eas-app-stores` to `expo-web-to-native`, verified on 2026-10-16; re-verify with `curl -s https://api.github.com/repos/expo/skills/contents/plugins/expo/skills`, and add a new one to `names.reserved`), never containing `claude` or `anthropic`.
- **`description`:** third person, starts with a verb, at most 300 characters (aim for 250), no `<` or `>`, no "I" or "you", contains "Use when", ends with "Not for ... (neighbour-skill)". The descriptions-and-routing reference has the formula and examples.

## 5. SKILL.md body and section order

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
- Expo's official `expo-router` skill - the API reference (only for Expo's own skills)
```

- The six sections appear once each, in this order; extra sections may sit between them.
- Rules and the definition of done sit at the top: after context compaction only the first 5,000 tokens (about 20,000 characters) of each invoked skill survive, so the Definition of done must end inside that window.
- A skill with scripts ends its Definition of done with a `${CLAUDE_SKILL_DIR}/scripts/` command that prints `RESULT: PASS`, and lists every SKIP line a passing run may print (or says it prints none).

## 6. Writing

- Write calmly and explain why. No capitalised shouting (the validator rejects the capitalised forms of must, never, always, important, critical, mandatory, warning, do not); bold is enough.
- One default, not a menu; an alternative goes in a fenced appendix ("When multi-package", "Appendix: React Navigation"). Prescriptive where the work is fragile (configs, pins, thresholds), flexible where judgement matters (copy, feel).
- Say plainly what a human must do by hand and when. Stop and ask before anything irreversible or outward-facing: store uploads, publishing, deleting real data, spending money, rotating keys.
- One vocabulary: "the developer" or "the reviewer" for people, "the app" for the product, "the app's locales" for languages (examples use `en` and an RTL locale such as `ar`), devices named `<project>-<purpose>`. Examples use a neutral domain (a Tasks app: tasks, lists, reminders, a Premium entitlement; or Note, Product, Order, Account), never a real app's nouns.
- Both platforms where behaviour differs: TalkBack next to VoiceOver, `adb` next to `simctl`, Play next to the App Store, edge-to-edge and predictive back. A fact verified on one platform only says so.

## 7. References, templates, examples, assets

- **References** are copied, adapted knowledge rewritten to make sense inside the skill: no "see chapter N". Over 100 lines, a `## Contents` heading with a list sits in the first 40 lines. Every version-sensitive fact carries "verified on <date>" and the command that re-checks it.
- **Provenance:** when a reference is copied from a project document (a store guideline, a design note, a research write-up), name the source in words, never by path ("the App Store Review Guidelines, section 2.3", "the team's release checklist"), and the date it was read. When the source changes, re-copy the knowledge and then update the date; a new date on old content claims a freshness it does not have. No checker reads this; it is how the next maintainer knows what to refresh.
- **Templates** are complete, real files that compile and lint under the app's rules (strict TypeScript, the ESLint flat config, naming and size limits, named exports, logical style keys, message keys instead of literal UI strings). Line 1 names the repo path the file is copied to (`// src/features/tasks/use-tasks-model.ts`, `# .maestro/flows/smoke.yaml`; line 2 after a `#!` line); a JSON file sits at its repo path under `templates/` (`templates/contracts/screens.json`). Placeholders are `__UPPER_SNAKE__`.
- **Template closure:** a template's relative imports resolve to templates of the same skill or of a named prerequisite skill, and its test ships with it. Prove each template in a reference app: copy it to the path line 1 names, then `tsc --noEmit`, ESLint with `--max-warnings 0` and the copied Jest tests.
- **Contracts:** where a checker needs the app's own facts (screens and testIDs, settings fields, budgets), it reads a repo-owned `contracts/<name>.json`; the skill ships its template and a JSON Schema beside it (`templates/contracts/<name>.json`, `templates/contracts/<name>.schema.json`). The checker stays strict; the facts belong to the app.
- **Examples** are complete, realistic and small; one good example beats three partial ones. They are shapes to imitate, never copied verbatim.
- **Assets** are data the scripts or the agent use. Data another skill also needs belongs in the shared folder and is synced.

## 8. Quality bar

- **Complete:** someone with only this skill does the job right the first time.
- **Correct:** versions and APIs match the libraries' versioned docs, never memory. For the Expo stack this library verified Expo SDK 57, React Native 0.86.3, React 19.2.3 and TypeScript 6.0.3 on 2026-10-03 (re-verify: `npm view expo@57 version`, then `npx expo install --check` in the app).
- **Deep:** rules with reasons, the traps that actually happened, checkers with teeth. A rule that encoded one app's product decision is restated as a general default or an opt-in profile, not deleted.
- **Self-verifying:** the definition of done ends in a script that proves the work, and the script proves itself against planted bugs.
- **Honest:** a fact verified on one platform, by reading source, or not at all says so.

## 9. Every validator rule

`node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs <path>` reports each problem as `FAIL <skill>/<file>:<line> [<rule>] <message> Fix: <fix>`. A path is a skill folder, a skills folder (plus `library-layout`), or a repo root (its `skills/`, `.claude/skills/` and `.agents/skills/`). `--standard <file>` swaps the constants; `--shared <dir>` turns on `shared-drift`; `--no-run` skips the script runs; `--rule <id>` narrows the report.

| Rule | Holds when |
|---|---|
| `skill-md` | the folder has a `SKILL.md` |
| `fm-line1` | `---` is exactly line 1 |
| `fm-close` | the frontmatter has a closing `---` line |
| `fm-yaml` | the frontmatter is one-line values, quoted when they hold `: ` or ` #`, flow lists, one-level `metadata:` |
| `fm-key` | only the allowed keys (section 4) |
| `fm-dmi-runbook` | `disable-model-invocation` only as `true`, only in a `run-*` skill whose body has a stop-and-ask step |
| `fm-no-allowed-tools` | no `allowed-tools` |
| `name-format` | 1-64 characters of `[a-z0-9-]`, no leading, trailing or double hyphen |
| `name-match` | name equals the folder name |
| `name-reserved` | not a bundled command or skill, not an Expo skill, no `claude` or `anthropic` |
| `desc-length` | description present, at most 300 characters |
| `desc-angle` | no `<` or `>` |
| `desc-verb` | starts with a third-person verb |
| `desc-person` | no "I" or "you" |
| `desc-trigger` | contains "Use when" |
| `skill-lines` | `SKILL.md` has at most 300 lines |
| `sections` | H1 title, intro line, then the six sections in order, each once |
| `section-format` | numbered rules and steps, `- [ ]` done items, the Files header `\| File \| What it is \| Read/run when \|`, list items under Related skills |
| `dod-position` | the Definition of done ends within the first 20,000 characters |
| `dod-script` | a skill with scripts ends its Definition of done with a skill-script command that prints `RESULT: PASS` |
| `link-resolve` | every relative markdown link and every `${CLAUDE_SKILL_DIR}` path (code included) resolves inside the skill |
| `files-listed` | every file except `SKILL.md` is in the Files table (a `dir/` row covers the folder) |
| `files-exist` | every file the table lists exists |
| `ref-toc` | a `references/*.md` over 100 lines has a Contents heading with a list in its first 40 lines |
| `no-project-ref` | no paths that leave the skill (section 2); URLs are ignored; `tests/fixtures/` is exempt |
| `no-runtime-env` | no agent- or scope-specific variables; scripts read no `CLAUDE_*` variable |
| `no-shouting` | no capitalised shouting outside code |
| `device-explicit` | every maestro, simctl, xcodebuild and adb command line in markdown code or a script names its device: `--device <id>` before a maestro `test`, `hierarchy`, `record` or `start-device`; a simctl UDID or variable, never `booted` or `all`; `-destination id=<udid>` (or `generic/platform=iOS` for an archive); `adb -s <serial>` before the command. A sentence that forbids a command and the Anti-patterns section may still name it |
| `layout` | only the seven top-level entries, no symlinks, no empty folders, no nested `SKILL.md` outside `tests/` |
| `fixture-hygiene` | no file or folder named `.gitignore`, `metadata.json`, `.git`, `__pycache__` or `__pypackages__` (store `dot-gitignore`, `dot-metadata.json`) |
| `fixture-budget` | `tests/` at most 1 MB and 600 files; every file at most 256 KB; binaries only from the allow-list (images, fonts, audio, PDF, small `.plist`/`.jsbundle`/`.hbc`/`.car` audit inputs) |
| `script-lib` | top-level `scripts/*` are `.mjs` entry points importing `./check-lib.mjs`; `selftest.mjs` uses `runSelftest` |
| `script-deps` | imports are `node:` built-ins, relative files, or packages pinned exactly in `scripts/package.json` and loaded with `await import()` |
| `script-help` | `node <script> --help` in an empty folder exits 0 and prints `Usage:` |
| `script-result` | `node <script>` with no arguments in an empty folder exits 0, 1 or 2 and ends with the RESULT line (30-second limit) |
| `selftest-missing` | a skill with scripts has `scripts/selftest.mjs` |
| `fixtures` | each suite has a `bad-*` case and a `good/` case or a declared base; every `bad-*`, `pass-*` and `error-*` case has a non-empty `EXPECT.txt`; overlay files are well formed |
| `shared-json` | `assets/shared.json` is a valid list of `{ "from", "to" }` |
| `shared-drift` | with `--shared`: every declared copy equals the canonical file |
| `shared-undeclared` | a `check-lib.mjs` copy is declared in `assets/shared.json` |
| `library-layout` | an authored `skills/` folder holds only skill folders |

**Heuristic limits** (review items, also in the Report step of the workflow): `no-project-ref` catches only paths that provably leave the skill (absolute, scratch, `../`, other skills' folders, library tools). A repo-relative pointer to a project document in prose ("see docs/store-guidelines.md in the repo") looks exactly like an app content path (`contracts/screens.json`), so it passes; read the prose for it. `check-skill.mjs` has similar limits, listed in section 10.

A checker that must itself detect text the validator bans (a home path, a booted simulator, a runtime variable) builds the pattern from parts or regex escapes, so its own source stays clean; the writing-scripts reference shows how.

## 10. What check-skill.mjs adds

The validator proves the structure; `check-skill.mjs` proves the content is finished and usable:

| Rule | Holds when |
|---|---|
| `desc-not-for` | the description has a "Not for" boundary |
| `desc-neighbours` | skills named in the "Not for" parentheses exist (or are bundled or Expo skills) |
| `rule-why` | each rule is a bold statement followed by a reason of at least four words |
| `workflow-mentions` | each reference, example and script is named in the body, not only in the Files table |
| `files-when` | each Files row has a non-empty "Read/run when" cell |
| `related-names` | each Related skills item starts with an existing skill name in backticks, or leads with "Expo's `<name>` skill" (optionally "Expo's official") when every backticked name before the item's first ` - ` is one of Expo's skills (the reserved names starting `expo-` or `eas-`) |
| `placeholder-left` | no upper-snake placeholder stands alone in markdown prose, and no `__FILL_...__` token is left in scripts |
| `template-markers` | templates hold no TODO, FIXME or XXX and no mixed-case double-underscore placeholder |
| `template-path-header` | a code or YAML template names a repo-relative path with its own extension on line 1 |
| `selftest-covers` | the self-test runs every checker script |
| `expect-rule-id` | every `bad-*` EXPECT.txt names a rule id (a line that is the id, or `[rule-id]` inside a line) |
| `rule-has-bad-case` | every rule id a checker lists under `Rules:` in its `--help` (two-space indent, the id, two or more spaces, the text) appears as `[id]` in a line, or as a line that is the id alone, in a `bad-*` EXPECT.txt of that checker's own suites (a bare word does not count, so a path such as `src/layout/x.ts:3` never stands in for a rule named `layout`), read from the literal `{ script, fixtures }` entries of `scripts/selftest.mjs` (a rule id two checkers share needs a case in each); check-skill runs each checker's `--help` to read them. A checker the self-test names no other way falls back to every `bad-*` case of the skill |
| `dod-skips` | a skill whose scripts print SKIP lines lists them in its Definition of done: each literal rule id passed to `report.skip({ rule: '<id>' })` (or the skip's literal file path) appears in a Definition of done item that says SKIP. A skip whose file is derived or imported (`casesRel`, `DEFAULT_DEBUG_LINKS`) is matched by its rule id or by any path (or its basename) written as a string literal in the skill's scripts. A ship gate's `--rehearsal` skip is exempt |
| `contract-documented` | every `contracts/<name>.json` a script reads ships in the skill (`templates/`, `assets/`, `examples/`) or is named in SKILL.md or a reference (with the skill that owns it) |
| `deprecated-api` | no script uses a check-lib export marked `@deprecated` |
| `repo-scan-walk` | a repo scan uses `walkRepo()`, never `walk()` with `REPO_SCAN_IGNORES`, `repoScanIgnores()` or a constant built from either, at any nesting depth; a deliberately wider scan carries `// repo-scan-walk: deliberate (<why>)` on the call's line or the line above |

These rules read source text, not a parsed program, so some shapes stay review items: a skip whose rule id is a variable (`rule: RULE_ID`) only needs some SKIP item in the Definition of done; a skip whose file is a variable or an expression is matched loosely (any literal path of the scripts named in a SKIP item counts), so read the Definition of done against the checker's real SKIP lines; ignores built by a helper function, or a `walk` imported under another name, are not followed; a quote inside a regex literal can hide the rest of that line from the scan.
