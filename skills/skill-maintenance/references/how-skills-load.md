# How Claude Code finds, lists, loads and runs a skill

The mechanics behind the standard's rules, verified with Claude Code 2.1.283 on 2026-09-28 (headless `claude -p` runs in throwaway repos) and read in the Claude Code documentation; re-verify a fact with the diagnostics at the end before relying on it after a Claude Code upgrade. Other agents (Codex, Cursor, the skills CLI's targets) read the same `SKILL.md` format but differ in discovery and budget; the facts below are Claude Code's. Read this when a skill does not load, does not trigger, loses its rules in a long session, or its script is denied.

## Contents

- Discovery
- Frontmatter parsing
- The listing and its budget
- Invocation
- What the body can do
- Compaction
- Permissions
- Diagnostics
- Pitfalls, by symptom

## Discovery

- Project skills are found at `.claude/skills/<name>/SKILL.md`, exactly one folder below `.claude/skills`. A skill inside a grouping folder (two levels below `.claude/skills`) is not discovered. A flat `name.md` is not a skill.
- Plugin skills come from an installed plugin (`claude plugin install`) or a folder loaded with `claude --plugin-dir <dir>`; they are listed and invoked as `<plugin>:<skill>`. The skills CLI (`npx skills add <github-user>/<repo> --skill <name>`) installs a skill into `.agents/skills/<name>/` inside the app, or into the folder of the agent it targets (read from its documentation, not verified here); either way the skill sits inside the app repo, which is why checkers prune installed skills.
- A skill folder may be a symlink (`.claude/skills/<name>` to `../../skills/<name>`). Tested: linked skills appear in the listing and in `/` commands, and the Skill tool loads them.
- Claude Code walks up from the start folder to the repo root, so root skills load from any subfolder. Nested `.claude/skills` folders below the start folder (for example in `apps/mobile/` of a monorepo) load only after Claude reads or edits a file there; until then they are absent from the listing and `/name` does nothing. Keep every skill at the root.
- Folders named `synced` or `anthropic-skills` are skipped.
- Claude Code watches `.claude/skills/` and picks up added, edited and deleted skills during a session (it watches the `SKILL.md` text; other files are read on demand anyway). A `.claude/skills` folder that did not exist when the session started needs `/reload-skills` or a new session; do the same when a newly linked skill does not show up in `/skills`.
- A skill whose folder name differs from `name:` is listed under the folder name and both names invoke it; keep them equal.
- Precedence for a shared name: enterprise, then personal (`~/.claude/skills`), then project. A project skill with a bundled command's name replaces that command. So never reuse a bundled name, and check that no personal skill has the same name as a project skill.

## Frontmatter parsing

- The opening `---` must be line 1. With a blank line or a byte-order mark first, the whole file becomes the body and the listing shows the description as `---`.
- If the YAML does not parse, every field is dropped silently: no description (the first body line is used instead) and the skill is missing from the SDK's `init.skills` list.
- Misspelled keys (`allowed_tools`, `disableModelInvocation`) are ignored without a warning.
- `claude plugin validate .claude/skills` reports YAML parse errors and a missing description only. It does not check name format, name versus folder, description length, unknown keys, reserved words or angle brackets; this skill's `validate-skill.mjs` does.

## The listing and its budget

- Every turn Claude sees each skill's name and description. That listing is all it uses to decide whether a skill fits; the body is read only after invoking.
- Each entry is cut at 1,536 characters (description plus `when_to_use`).
- The whole listing has a budget: `skillListingBudgetFraction` of the context window, default 0.01. Measured on 2026-10-16 with Claude Code 2.1.299 on Opus 5.5, Sonnet 5.5 and Haiku 5.5, each with a 1,000,000-token context window (the debug log's `effectiveWindow=980000`): 30,000 characters at 0.01, 15,000 at 0.005, 60,000 at 0.02, so the budget is linear in the fraction and, being a share of the window, shrinks with it: a model or setting with a smaller window gets a proportionally smaller budget (a 200,000-token window would give about 6,000 characters; inferred, not measured). Re-verify: put 130 skills with long descriptions in a scratch `.claude/skills/`, run `claude -p "Reply ok." --debug-file <log>` and read the `Skill listing over budget` and `effectiveWindow` lines. Skills from plugins and the developer's own folders share the same listing (the measurement's 156 listed skills were 130 test skills plus 26 of the machine's own). When over budget, Claude Code drops whole descriptions, starting with the least-used skills, which keep only their name ("Skill listing over budget: 73 skills, 37308 chars > 30000 budget" in the debug log; 15 of 60 test skills became name-only). Descriptions are never cut halfway.
- A name-only skill can still be invoked when the developer names it, but Claude will not pick it for an unnamed task. Hence the 300-character limit, trigger words first, and `skillListingBudgetFraction: 0.04` for a large set (the library-round reference has the settings).
- `disable-model-invocation` skills are left out of the listing; `paths` skills are left out until a matching file is read.

## Invocation

- The developer types `/name` or `/name arguments`. Up to six skills can be stacked in one message (`/a /b task`).
- The developer names the skill in prose ("use the troubleshooting-playbook skill") and Claude calls the Skill tool. This works whenever the skill is listed, even name-only.
- Claude picks a skill itself when the task matches a description. It tends to skip skills for tasks that look easy, so descriptions name the situations, not only the topic.
- `disable-model-invocation: true` blocks Claude from invoking the skill at all (it tells the developer to type `/name`); that is right only for a side-effecting `run-*` runbook. `user-invocable: false` hides it from the `/` menu.
- When the skill loads, Claude receives "Base directory for this skill: <absolute path>" and then the body.

## What the body can do

- `${CLAUDE_SKILL_DIR}` expands to the skill's own folder (for a linked skill: the `.claude/skills/<name>` link path). Scripts are always called as `node ${CLAUDE_SKILL_DIR}/scripts/<x>.mjs`; a relative `scripts/x.mjs` runs from the session folder and fails.
- `@${CLAUDE_SKILL_DIR}/references/<file>.md` in the body attaches that file automatically; `@references/<file>.md` does not. Prefer normal links with a sentence saying when to read each reference: an attached file costs context on every load.
- `` !`command` `` injection runs at load time in the session folder. A non-zero exit, a command that is not pre-approved, or a run over 2 minutes aborts the whole invocation and Claude never sees the skill. Run checks as normal Bash calls from the instructions, never as injections.
- `context: fork` runs the skill in a separate context; on a guidelines skill that returns nothing useful, which is why the standard bans the key.
- Bash output over about 30,000 characters reaches Claude as a file path plus a preview, so checkers print short problem lines and write long reports to files.

## Compaction

- In a long session, auto-compaction keeps the most recent invocation of each skill, but only its first 5,000 tokens (about 20,000 characters), with 25,000 tokens in total, most recent skill first. Older skills can disappear entirely; the listing itself is not re-injected.
- So the rules and the definition of done sit at the top of SKILL.md, and a long session re-invokes a skill before its verification step.

## Permissions

- Claude's Skill tool call is allowed without a prompt for skills without `allowed-tools` or `hooks`. A skill with either needs a `Skill` or `Skill(<exact-name>)` allow rule; in headless runs it was denied (`permission_denials: [Skill]`), and a wildcard `Skill(prefix-*)` did not match.
- Skill scripts run as ordinary Bash calls under the normal rules. The project allow rules in the library-round reference let them run without prompts; without them a script call was denied ("This command requires approval").
- Project allow rules are dropped while the workspace is untrusted ("Dropped 2 project-scoped permissions.allow entries - workspace not yet trusted"); the developer accepts the trust dialog once.
- Writes under `.claude/` are protected paths and always ask, whatever the allow rules say. That is why skills are written in `skills/` and loaded as a plugin or linked.

## Diagnostics

| Tool | Shows |
|---|---|
| `/skills` | the loaded skills, with a search box |
| `/context` | the listing size after the budget is applied |
| `/doctor`, `/skill-doctor` | listing cost and the biggest entries; skills that are never used |
| `/reload-skills` | re-scans the skill folders |
| `claude --debug` | parse errors and the over-budget warning |
| `claude -p "..." --output-format stream-json --verbose` | the `init` event lists `skills` and `slash_commands`; assistant events show each `tool_use` (a Skill call carries `input.skill`) |

## Pitfalls, by symptom

| Symptom | Cause | Fix |
|---|---|---|
| The skill never appears | grouping folder, nested folder not yet touched, reserved folder name, created mid-session | root `skills/<name>` loaded as a plugin or linked from `.claude/skills/<name>`; `/reload-skills` |
| Listed with description `---` | `---` not on line 1 | put it on line 1, no BOM |
| Listed with its first body line | YAML parse error or no description | one-line values, quote `: ` and ` #` |
| Only the name is listed | listing over budget | shorter description; `skillListingBudgetFraction` |
| Claude tells the developer to type `/name` | `disable-model-invocation` | remove it (keep it only on a `run-*` runbook) |
| `/name` does nothing | `paths`, `user-invocable: false`, nested skill | remove the key; root placement |
| A plugin skill is not found by its bare name | plugin skills are namespaced | invoke `<plugin>:<skill>`; routing evals strip the prefix |
| Live routing stops with "skill <x> is not loaded in this session" | the skill is authored in `skills/` but neither linked nor loaded as a plugin | `--plugin-dir .`, or link `.claude/skills/<x>` |
| A repo scan in a checker fails on planted bugs | it walked into an installed skill's fixtures | `walkRepo()` prunes every folder holding a `SKILL.md` |
| The Skill call is denied in a headless run | `allowed-tools` or `hooks` in frontmatter | remove them; project Bash rules for scripts |
| "Shell command failed for pattern" and no skill | a failing or unapproved `!` injection | run the check as a normal Bash step |
| Rules forgotten late in a session | compaction kept only the first 5,000 tokens | rules and done list at the top; re-invoke before verifying |
| A script works in one session only | relative script path | `node ${CLAUDE_SKILL_DIR}/scripts/<x>.mjs` |
| Another skill with the same name loads | a personal skill shadows it | unique project names |
