# Loading skills and reporting

How an agent picks up these skills, how the developer names them, how to read every checker's result,
and how every task ends: the report the reviewer reads instead of the diff.

## Contents

- How skills load
- The developer's "Skills:" line
- Loading order, long sessions and compaction
- When no row fits
- Reading check results: PASS, SKIP, NOT APPLICABLE, exit 2
- Reporting
- When to stop and ask

## How skills load

An agent sees only the name and the one-line description of each skill until it loads one; the full
`SKILL.md` arrives on loading. Descriptions decide whether a skill is used at all, which is why this
index names skills explicitly instead of trusting description matching alone.

| Where the skills come from | How a skill is named | How to load it |
|---|---|---|
| Claude Code plugin `react-native` (the core skills) | `react-native:<skill>` | The Skill tool with that name, `/react-native:<skill>` in the prompt, or a prompt that names the skill |
| Claude Code plugin `react-native-games` (the optional games skills) | `react-native-games:<skill>` | The same; if the listing shows a game skill under `react-native:` instead, use the name the listing shows |
| A standalone install (`npx skills add zakariaf/ReactNative-Skills --skill <skill>`, into `.claude/skills/`, `.agents/skills/` or another agent's folder) | `<skill>` | The agent's skill loader, `/<skill>` in Claude Code |
| Agents without skill loading (they read `AGENTS.md`) | `<skill>` | Open `skills/<skill>/SKILL.md` (or the installed copy) and follow it; `AGENTS.md` holds the same intent map as [intent-map.md](intent-map.md) |

- Inside a skill, `${CLAUDE_SKILL_DIR}` is the folder that holds that `SKILL.md`. Agents that do not
  expand it substitute the path. Scripts run from the repo root:
  `node ${CLAUDE_SKILL_DIR}/scripts/<script>.mjs . <options>`.
- Start every session at the repo root: project skills, hooks and settings load from there.
- Install the core plugin in Claude Code with `/plugin marketplace add zakariaf/ReactNative-Skills`, then
  `/plugin install react-native@react-native-skills` (and `react-native-games@react-native-skills` for
  games). A standalone install takes the skills a project needs, always including this index.
- A skill that does not show up, will not load or never triggers: load `skill-maintenance`, whose
  pitfalls table covers the known causes (frontmatter, listing budget, install location).

## The developer's "Skills:" line

The developer may start a task with a line such as:

```text
Skills: /react-native:forms-and-input /react-native:tdd-workflow
```

- Load every named skill before anything else, in the order given. Their rules and definitions of done
  are binding for this task.
- Then add the other skills of the task's rows; never drop a named skill in favour of a row skill.
- A name that does not exist: say so in one line of the report, pick the closest skill from
  [skill-table.md](skill-table.md), and continue. Never invent a skill's content.
- Without a "Skills:" line, the task table decides.

## Loading order, long sessions and compaction

- Load the lead skill (the first of the row) first, then the others. Read each skill's "Rules that must
  hold" and "Definition of done" before writing code: those are the parts the checks enforce.
- When a long session is compacted, only about the first 5,000 tokens of each loaded skill survive. The
  rules and the definition of done sit there on purpose; before running a skill's checks late in a long
  session, load the skill again so its workflow and file table are complete.
- Reference files are read when the skill's workflow says so, not all at once.
- A skill that is routed but not installed (a standalone install of a subset): install it, or tell the
  developer which skill the task needs. Never do its part from memory.

## When no row fits

1. Read [intent-map.md](intent-map.md) and load every skill whose "Use when" matches a part of the task;
   its "Not for" names the neighbour to load instead.
2. A question of what the app must do (a screen, a rule, a feature): load `spec-traceability`.
3. A failure or an error message: load `troubleshooting-playbook` and let its entry name the owning skill.
4. When a task pattern repeats, add a row to `assets/index.json` and regenerate (`build-index.mjs --write`,
   then `check-index.mjs`).

## Reading check results: PASS, SKIP, NOT APPLICABLE, exit 2

Every skill script runs from the repo root with the root as its optional first argument
(`node <skill folder>/scripts/check-navigation.mjs .`), never `--root`; a guessed `--root` exits 2 and
the error prints the positional form. The build orders write every command out in full. The last line
decides:

| Output | Exit | Counts as |
|---|---|---|
| `RESULT: PASS` | 0 | a pass |
| `SKIP <file> [<rule>] not yet created (<skill> creates it)` lines, then `RESULT: PASS` | 0 | a pass: the named file belongs to another skill or a later build step, and from that step on the rule is strict. Quote the SKIP count in the report; a SKIP line still printed after the step that creates the file is a failure of that step |
| `NOT APPLICABLE: <fact>`, then `RESULT: PASS` | 0 | a pass: the fact proves the whole check does not apply (`react-native-google-mobile-ads` is not in `package.json`, so the ads checker has nothing to judge). Quote the fact in the report |
| `RESULT: FAIL (<n> problems)` | 1 | a failure: fix every `FAIL <file>:<line> [<rule>] ... Fix: ...` line and rerun |
| `ERROR [bad-input] ...`, then `RESULT: FAIL (1 problems)` | 2 | never a pass: nothing to check (a missing folder, zero files) or bad arguments. Fix the command (the build order has it) or build the missing target |
| `REHEARSAL: not a release gate` first | 0 or 1 | a keyless dry run of a ship gate: useful practice, never release evidence. It goes under "Not verified" in a report |

Ship gates (a store artifact, a release setup, a completeness check) never print SKIP or NOT APPLICABLE.
`npm run verify` ends with its own summary line; quote it as it is.

## Reporting

Every task ends with one message to the developer. The reader may never open the diff or the logs, so
this message is the review. `git-commits-and-reporting` owns the full format, its templates and its
checker (`check-report.mjs`); in short:

1. **Outcome first, in the user's words,** with screens named by name and spec ID when the app keeps a
   spec ("The task list (SCR-2) now shows overdue tasks first").
2. **Evidence, copied, never retyped:** test counts from the Jest summary, numbers from report files
   (naming each file), and the `RESULT` line of every loaded skill's check, for example
   `check-screens.mjs . --screen task-list: RESULT: PASS`, with the SKIP count or the NOT APPLICABLE
   fact when there were any.
3. **Design match** for every changed screen: light and dark, LTR and RTL, on iOS and Android, against
   the approved design baseline, with any waiver and its reason.
4. **Not verified:** an honest list (sound, haptics, purchases, a screen reader's speech, a platform
   that was not run); a rehearsal goes here, never under the checks.
5. **Human checks (not blocking):** what only a person can judge (a translation review, a feel test),
   one line each, listed and never waited for.
6. **At most one question,** with the default that applies until the developer answers.
7. **Details last:** commits, commands, the red test runs.

A short report, for shape:

```text
The task list now sorts overdue tasks first, in light and dark, English and Arabic, on iOS and Android.
Skills: screen-contracts, ui-states-and-feedback, i18n-strings-and-catalogs, rtl-and-direction,
accessibility-as-code, design-visual-parity, tdd-workflow.
Checks: check-screens.mjs . --all PASS; check-ui-states.mjs . PASS; check-i18n-code.mjs . PASS;
check-rtl.mjs . PASS; check-a11y-code.mjs . PASS; check-signoff.mjs . --screen task-list PASS;
check:fast green.
Tests: 214/214 (reports/jest-summary.txt).
Not verified: TalkBack speech on a physical device.
Human checks (not blocking): the Arabic copy review.
Question: none.
```

## When to stop and ask

Stop and ask, in one message with one question answerable in a word and the default that applies
meanwhile, before anything that cannot be undone or that faces the outside world:

- a push, a tag push, an upload, a store submission, a rollout change, an OTA publish;
- deleting user data or a migration that drops it, rotating keys, spending money;
- a change to a quality gate, a golden, a baseline, a budget or a pinned version;
- account steps (store consoles, signing keys, agreements, `sudo`, toolchain installs);
- a spec gap a user would notice, a new screen, route, setting or permission nobody asked for.

Keep working on everything that does not depend on the answer.
