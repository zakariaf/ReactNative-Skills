# Agent skills that do not load, trigger or run

Symptoms of skills that never load, never trigger or whose scripts misbehave; skill-maintenance owns the full procedure. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `claude --version`.

<!-- Generated from assets/known-failures/skills.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Loading
- Invocation
- Listing
- Scripts
- Session

## Loading

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `skills-grouping-folder` | A skill placed in a grouping sub-folder (two levels below the skills folder) never appears | Skills are discovered exactly one folder deep | Keep <skills folder>/<name>/SKILL.md | verified |  | `skill-maintenance` |
| `skills-frontmatter-line1` | The skill is listed with the description "---" | The opening --- is not line 1 (a blank line or byte-order mark before it), so the whole file became the body | Put --- on line 1 | verified |  | `skill-maintenance` |
| `skills-yaml-parse` | The skill is listed with its first body line as the description | The frontmatter YAML does not parse, so every field is dropped silently | One-line values only; quote values that contain ": " or " #" | verified |  | `skill-maintenance` |
| `skills-missing-description` | The skill is listed with its first body line and never triggers | The description field is missing or misspelled (unknown keys are ignored silently) | Write a description of at most 300 characters: verb first, trigger words, Not for | verified |  | `skill-maintenance` |
| `skills-nested-skills` | A skill in a sub-folder's own .claude/skills is missing from the / menu | Nested skills load only after the agent reads or edits a file in that folder | Install skills at the repo root (.claude/skills/<name> or .agents/skills/<name>) | verified |  | `skill-maintenance` |
| `skills-reload` | A skill folder created mid-session does not appear | A new top-level skills folder is not watched until it is re-scanned | Run /reload-skills or start a new session | documented |  | `skill-maintenance` |

## Invocation

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `skills-allowed-tools-approval` | The agent's Skill call is denied in headless runs (permission_denials: [Skill]) | A skill with allowed-tools or hooks needs approval to be invoked by the model | No allowed-tools in skills; allow the scripts with a project Bash rule instead | verified |  | `skill-maintenance` |
| `skills-disable-model-invocation` | The agent says to type /name instead of using the skill | disable-model-invocation: true removes the description and blocks the Skill tool | Use it only on side-effecting run-* runbooks that stop and ask before the irreversible step | verified |  | `skill-maintenance` |
| `skills-hidden-by-keys` | A skill is missing from the listing, or /name does nothing | paths: hides it until a matching file is read; user-invocable: false hides it from the menu | Use only the keys the standard allows (name, description, metadata ...) | verified |  | `skill-maintenance` |
| `skills-injection-abort` | Shell command failed for pattern ... and the skill never loads | A !`command` injection in SKILL.md exited non-zero or was not pre-approved | Run checks as normal shell calls from the instructions, not as injected commands | verified |  | `skill-maintenance` |
| `skills-bundled-name` | A skill named like a bundled command replaced it, or a different skill loads than expected | Same-name skills shadow bundled commands, and a personal skill wins over a project skill of the same name | Never use bundled names (verify, run, debug, review, simplify, init, loop ...); keep names unique | verified |  | `skill-maintenance` |

## Listing

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `skills-listing-budget` | Some skills show only their name, no description | The skill listing exceeded its character budget and dropped the least-used descriptions | Keep descriptions short (aim for 250 characters); raise skillListingBudgetFraction in settings only if needed | verified |  | `skill-maintenance` |
| `skills-compaction` | After a long session a skill's later sections are forgotten | After compaction only the first part of each invoked skill (about 5,000 tokens) is re-attached | Keep rules and the definition of done near the top; re-invoke the skill before verifying | verified |  | `skill-maintenance` |

## Scripts

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `skills-cwd-relative-script` | A skill script path works in one session and not another | Commands run in the session folder, not the skill folder | Call scripts through the skill folder: node ${CLAUDE_SKILL_DIR}/scripts/<x>.mjs | verified |  | `skill-maintenance` |
| `skills-checker-root-flag` | A skill checker prints ERROR [bad-input] Unknown option '--root' | Every checker takes the repo root as its first positional argument, never --root | Run node <skill>/scripts/<checker>.mjs . [options]; the error's fix text prints the positional form | verified |  | `skill-maintenance` |
| `skills-exit-2-is-not-a-pass` | A checker exits 2 with ERROR [bad-input] nothing to check | Exit 2 means bad input or nothing to check; it is never a pass (NOT APPLICABLE and SKIP lines with RESULT: PASS are the passing forms) | Rerun with the full command; if the target is created by a later step, name the check as not run yet in the report | verified |  | `react-native-conventions-index` |
| `skills-checker-scans-skills` | A repo checker reports findings inside skills/ or .agents/skills/ | The checker walked the whole repo, including installed skills whose fixtures plant findings on purpose | A library bug: repo scans use walkRepo (it prunes every folder holding a SKILL.md); report it to skill-maintenance | verified |  | `skill-maintenance` |
| `skills-long-output` | A script's output arrives as a file path plus a preview | Shell output over about 30,000 characters is not shown inline | Checkers print short problem lines and a RESULT line; long reports go to files | documented |  | `skill-maintenance` |

## Session

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `skills-bash-every-call-exits-1` | Every shell call exits 1 with no output, even true (file reads and writes still work) | The agent session's shell tool broke after hours of long runs (exhausted processes or descriptors); nothing in the repo causes it | Stop at once and report what is done and what is left; the session needs a restart. Prevent it: stop your own simulators, emulators, Metro, Maestro drivers and log streams when done | verified, needs a human |  | `troubleshooting-playbook` |
