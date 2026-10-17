# Commands, the library round and settings

Every command of this skill in the order a change needs them, what a repo that is itself a skill library adds around them, the development loop, and the settings that let skill scripts run without prompts. All commands run from the repo root with Node 22 or newer and no dependencies; all print `--help`, exit 0 (pass), 1 (problems found) or 2 (bad input or environment) and end with `RESULT: PASS` or `RESULT: FAIL (<n> problems)`.

## Contents

- This skill's commands, in order
- Options worth knowing
- When the repo is a skill library
- Shared files and assets/shared.json
- The development loop
- Settings for .claude/settings.json

## This skill's commands, in order

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-routing.mjs . --prompt "<the task>"         # 1. which skill wins this task today (prints the top 3)
node ${CLAUDE_SKILL_DIR}/scripts/new-skill.mjs <name> --skills-root skills          # 2. scaffold (or --dry-run first; creates skills/ if missing)
node ${CLAUDE_SKILL_DIR}/scripts/validate-skill.mjs skills/<name>                   # 3. the standard
node skills/<name>/scripts/selftest.mjs                                             # 4. the skill's own checkers
node ${CLAUDE_SKILL_DIR}/scripts/check-skill.mjs skills/<name>                      # 5. finished, not just well formed
node ${CLAUDE_SKILL_DIR}/scripts/check-skill-set.mjs .                              # 6. the set: overlap, hand-offs, budget (installed skills count)
node ${CLAUDE_SKILL_DIR}/scripts/check-routing.mjs .                                # 7. routing evals, offline
node ${CLAUDE_SKILL_DIR}/scripts/check-routing.mjs . --live --only <name> --runs 3 --plugin-dir .  # 8. the agent itself (costs model calls)
```

Each of steps 3 to 7 also takes a repo root: the scripts then read every skill in `skills/`, `.claude/skills/` and `.agents/skills/` (a `.claude/skills` link to `.agents/skills` counts once). Skills the repo authors are judged; skills an installer put under `.agents/skills/` (or linked in) belong to their authors, so the validator and check-skill only note them, and check-skill-set counts them toward the listing budget and toward collisions with an authored skill but notes their own hand-offs. Name an installed skill's folder explicitly to check it anyway (`.agents/skills`, or one skill in it). A repo whose only skills are installed ones has nothing of its own to judge, so all four scripts print `NOT APPLICABLE: only installed skills (...)`: an app that wires these checks into CI before writing its first skill stays green on code it does not own. A repo with no skill folders is `NOT APPLICABLE: no project skills` (exit 0); any other folder without skills is exit 2.

## Options worth knowing

| Script | Option | What it does |
|---|---|---|
| validate-skill | `--shared <dir>` | The library's canonical shared folder: turns on `shared-drift` (each copy must equal its canonical file) |
| validate-skill | `--standard <file>` | Another constants file (a project that tightens the description cap or adds reserved names); default `assets/standard.json` |
| validate-skill | `--no-run`, `--rule <id>` | Skip the `--help` and no-argument script runs; report only some rules |
| new-skill | `--runbook`, `--title`, `--shared <dir>`, `--dry-run` | A `run-*` runbook with the flag and a stop-and-ask step; the H1 title; copy check-lib from the library's shared folder; list the files without writing |
| check-skill | `--skills-root <dir>` | The folder whose skills hand-offs may name (default: the folders holding the checked skills) |
| check-skill-set | `--max-overlap`, `--budget`, `--average`, `--index <skill>` or `--index none` | Thresholds (0.3 word overlap; 20,000 listing characters at the default `skillListingBudgetFraction` 0.01 on a 1,000,000-token context window, scaled by the repo's own setting; lower it with `--budget` for a smaller window or for skills installed from plugins, which live outside the repo and are not counted; 250 average) and the index skill that must name every skill (default: the one skill whose name ends in `-index`). The listing note names the budget's source |
| check-routing | `--prompt "<task>"` (with or without `--expect <skill>`) | One ad-hoc prompt: alone it prints the ranking (`rank #1 <skill> (score ...)`, live: `chose: <skill>`) and passes; with `--expect` it is an eval |
| check-routing | `--evals <file>`, `--top <n>`, `--only <skill>`, `--min-per-skill <n>`, `--skip-missing` | The evals file (default `contracts/routing-evals.json`, through the layout's `contractsDir`), the rank that counts as a hit (3), one skill's evals, the coverage floor (2; 0 turns it off), notes instead of problems for skills not built yet |
| check-routing | `--live`, `--runs <n>`, `--repo <dir>`, `--plugin-dir <dir>`, `--claude <command>` | Ask Claude Code instead of the offline ranker, the runs per prompt (pass at half or more), the folder it runs in, a plugin folder to load (`--plugin-dir .` for skills authored in `skills/`; without it or a `.claude/skills/<name>` link the session never sees them, and the run stops with exit 2 naming the missing skill), another `claude` binary (a `.mjs` stand-in runs with Node: that is how the self-test proves the live mode) |

## When the repo is a skill library

A library (many skills, a shared folder, a catalogue, release metadata) keeps its own maintainer tools outside `skills/`, and a skill never names their paths. Around this skill's commands, a library round usually is:

1. **Sync shared files** into the skills that declare them, then check there is no drift (the library's sync tool with its check mode, or `validate-skill.mjs <skill> --shared <shared folder>`).
2. **Validate** every changed skill (the library's validator, or this skill's `validate-skill.mjs skills`, which also checks the `skills/` folder layout).
3. **Run every changed self-test** (the library's all-self-tests runner, or each `node skills/<name>/scripts/selftest.mjs`).
4. **Prove the templates** in the library's reference app (copy each to the path its line 1 names; `tsc`, ESLint, Jest).
5. **Check version statements** against the library's stack table, if it keeps one.
6. **Regenerate the catalogue** (README tables, the agents intent map, plugin manifests) from the frontmatter, never by hand.

Only the owner of a shared file or a generated output changes it; everyone else proposes the change in their report.

## Shared files and assets/shared.json

- When a second skill needs a file another skill already ships at the same repo path (or the same data), move it into the shared folder instead of copying it, declare it in both skills' `assets/shared.json`, and sync. From then on change only the canonical copy.
- Before editing a shared file, list the skills that declare it (search their `assets/shared.json` for the path) and rerun their self-tests: the edit reaches all of them at once.
- `assets/shared.json` is a JSON array:

  ```json
  [
    { "from": "scripts/check-lib.mjs", "to": "scripts/check-lib.mjs" },
    { "from": "scripts/lib/source-scan.mjs", "to": "scripts/lib/source-scan.mjs" },
    { "from": "repo-templates/contracts/", "to": "templates/contracts/" }
  ]
  ```

  `from` is relative to the shared folder, `to` to the skill folder; neither contains `..`. A folder entry ends both paths with `/` and mirrors the folder (extra files in the copy are removed). `to` may not be `SKILL.md` or `assets/shared.json`. List the manifest and every copied file (or its folder) in the Files table. A skill with no scripts and no shared data has no `assets/shared.json`.

## The development loop

- In a library: `claude --plugin-dir .` from the repo root loads every skill as the plugin would, with no links and no writes under `.claude/`.
- In an app repo: author project skills in `skills/<name>/` and load them as a local plugin, or link `.claude/skills/<name>` to `../../skills/<name>` (one approval per link instead of one per file). Linked skills appear in the listing, `/name` works, and `${CLAUDE_SKILL_DIR}` expands to the link path (verified with Claude Code 2.1.283 on 2026-09-28; re-verify: `claude -p "list your skills" --output-format stream-json --verbose` and read the `init` event).
- A skills folder created after the session started needs `/reload-skills` or a new session.

## Settings for .claude/settings.json

A write under `.claude/` needs the developer's approval; merge keys, never overwrite the file.

```json
{
  "skillListingBudgetFraction": 0.04,
  "permissions": {
    "allow": ["Bash(node skills/*/scripts/*)", "Bash(node */.claude/skills/*/scripts/*)", "Bash(node */.agents/skills/*/scripts/*)"]
  }
}
```

- The listing budget: at the default fraction 0.01 the measured budget was 30,000 characters (Claude Code 2.1.299 on 2026-10-16, Opus 5.5, Sonnet 5.5 and Haiku 5.5, each with a 1,000,000-token context window); 0.04 gives 120,000. The budget is a share of the context window, so a smaller window shrinks it in proportion; the how-skills-load reference has the measurement and its re-verify run. A large skill set plus the bundled and personal skills would otherwise overflow and lose whole descriptions. `check-skill-set.mjs` reads the fraction from `.claude/settings.local.json`, then `.claude/settings.json`, and scales its 20,000-character set budget with it (0.04 gives 80,000); it does not read the developer's `~/.claude/settings.json` (pass `--budget` for that). It counts only the skills inside the repo (`skills/`, `.claude/skills/`, `.agents/skills/`): skills installed from a plugin (this library's own plugin among them) live in the plugin cache and share the listing uncounted, so a developer who has them installed lowers `--budget` by their share, and so does one working on a model with a smaller context window. Installed skills that overflow the budget on their own print a note naming this setting; only authored skills pushing the set over fail.
- The allow rules let skill scripts run without prompts, whether called through `${CLAUDE_SKILL_DIR}` (which expands to the installed folder) or directly. Tested headlessly: without them a skill script was denied ("This command requires approval"). Plugin installs live outside the repo; add the plugin cache path the `init` event shows if those scripts prompt.
- Claude Code drops project allow rules while the workspace is untrusted; the developer accepts the trust dialog in the project folder once.
