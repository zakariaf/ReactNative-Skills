# Quality gates, hooks, commits and agent hooks

Failures of the gates themselves, git hooks, commit rules, reports and Claude Code hooks and settings. Match the text you see in the Symptom column, or run `find-fix.mjs --text "<first error line>"`.

Status: **verified** = seen and fixed in a real run; **documented** = read in the tool's own source or docs; **open** = not settled, the fix is the current fallback. **needs a human** = a stop: send one message and wait, never work around it. Platform: blank = both. Skill = where the full procedure lives. Reviewed on 2026-10-17 against Expo SDK 57 (expo 57.0.27), React Native 0.86.3, React 19.2.3, Xcode 26.6, Android compileSdk and targetSdk 36, Jest 29.7, Maestro 2.10; re-verify the versions with `npm run verify`.

<!-- Generated from assets/known-failures/gates.json by scripts/check-catalogue.mjs --write. Edit the JSON, not this file. -->

## Contents

- Commits
- Reports
- Hooks
- Guardrail
- Agent hooks
- Test history

## Commits

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `gates-gate-change-trailer` | A commit is rejected: gated files changed without a Gate-Change trailer (gate-change-missing) | The commit-msg hook requires Gate-Change: <reason> when a gated path changes (configs, limits, goldens, baselines) | Get the reviewer's agreement, then commit the gate change with the trailer; never split the file out to dodge it | verified |  | `git-commits-and-reporting` |
| `gates-gate-change-unneeded` | [gate-change-unneeded] a Gate-Change trailer but no gated file | The trailer was added to a commit that touches no gated path, or a path that should be gated is missing from gatedPaths | Drop the trailer; if the file really sets a limit (a perf baseline, a golden), add it to gatedPaths in quality-gates.json with its own Gate-Change commit | verified |  | `quality-gates` |
| `gates-commit-header` | Commit rejected: "Updated stuff." or a scope the rules do not know | Conventional Commits with a known scope are required | feat(<scope>): <imperative summary>, with a scope from the commit rules (a feature folder or one of the repo scopes) | verified |  | `git-commits-and-reporting` |
| `gates-requirement-ref-missing` | A commit check fails because the body names no requirement reference, although the hook accepted it | An older hook used a weaker rule set than the repo-wide commit check | Use the canonical commit-message rules for both the hook and the check (one rule set, same ids); report commits already made instead of rewriting shared history | verified |  | `git-commits-and-reporting` |
| `gates-gated-paths-in-skills` | A commit that touches only an installed skills folder is rejected for a missing Gate-Change trailer | The gated-path globs (**/tsconfig.json, **/__image_snapshots__/**) matched skill templates and fixtures | Match gated paths against whole repo paths and let files under skills/ or the agent folders count only for patterns that start with that folder (the canonical gated-paths helper does) | verified |  | `quality-gates` |
| `gates-no-secrets-hook` | Commit refused: a key or signing file is staged (*.p8, *.p12, *.jks, .env) | Keys and signing files are never committed, even with git add -f | Remove the file from the commit; keys live outside the repo. If it was ever pushed, treat it as leaked | verified |  | `quality-gates` |
| `gates-commit-msg-enobufs` | The commit-msg hook fails with spawnSync git ENOBUFS | The hook read the staged diff with the default 1 MB buffer; a large commit exceeds it | Raise maxBuffer on that spawnSync (the canonical check-commit-message.ts does) | verified |  | `git-commits-and-reporting` |
| `gates-first-commit-add-all` | The first commit swept in unrelated files (someone's uncommitted edits, design folders, installed skills) | The bootstrap staged with git add -A | Stage only the files the step created and ask about the rest | verified |  | `expo-project-bootstrap` |

## Reports

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `gates-report-outcome-limits` | [outcome-first] first line is 255 characters, the limit is 240 | The outcome line has limits: at most 240 characters, at most 2 sentences, ending in . or ! | Shorten the first line to one plain sentence; move the rest to the next lines | verified |  | `git-commits-and-reporting` |

## Hooks

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `gates-bare-tsc-root` | The pre-commit typecheck passes although the app program has errors | A bare tsc --noEmit checks only the root program | Run npm run -s typecheck (both programs) | verified |  | `quality-gates` |
| `gates-eslint-rule-override` | A rule was switched off for one run with eslint --rule | The CLI flag overrides the config | Hooks and CI call only the canonical npm scripts | verified |  | `quality-gates` |

## Guardrail

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `gates-guardrail-drift` | The gate guardrail reports "max-params[1]: expected 3, got 5" | A limit in eslint.config.mjs was raised | Restore the limit; limits change only with the reviewer and a Gate-Change trailer | verified |  | `quality-gates` |
| `gates-sim-no-tests-found` | npm run verify stops at test:sim: "No tests found, exiting with code 1" | The app has no *.sim.test.ts yet, so the simulation project has nothing to run | Remove test:sim from the verify plan until the app has simulations (games plugin), or write them; never add --passWithNoTests to a gate | verified |  | `quality-gates` |
| `gates-script-target-missing` | npm run <script> fails with Cannot find module <repo>/scripts/... (or the gate-wiring check reports script-target) | package.json names a script whose tooling file is not in the repo yet | Copy the tooling from the skill that owns it (with its test), or remove the script until then | verified |  | `quality-gates` |

## Agent hooks

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `gates-posttooluse-exit-code` | Lint errors after an edit never reach the agent | A Claude Code PostToolUse hook that exits 0 or 1 is not shown to the model | Print to stderr and exit 2 | verified |  | `quality-gates` |
| `gates-stop-hook-cap` | The Stop hook keeps blocking and the agent stops anyway | Claude Code caps consecutive Stop-hook continuations | Read stop_hook_active; after the cap, report the failing gate to the developer instead of working around it | verified |  | `quality-gates` |
| `gates-settings-overwrite` | Permissions or plugin entries vanished from .claude/settings.json | The file was replaced instead of merged | Merge keys; never overwrite the file | verified |  | `quality-gates` |
| `gates-untrusted-workspace` | Project allow rules are ignored: "Dropped N project-scoped permissions.allow entries - workspace not yet trusted" | Claude Code drops project allow rules until the workspace is trusted | Human step: the developer accepts the trust dialog in the project folder once | verified, needs a human |  | `skill-maintenance` |

## Test history

| ID | Symptom | Cause | Fix | Status | Platform | Skill |
|---|---|---|---|---|---|---|
| `gates-test-edits-comments` | The test-edit check reports a disabled or focused test inside a comment or a string | An older checker read prose ("fit (") as a call | Use the current tdd-workflow check (it masks comments and strings); report lines from older history instead of rewriting it | verified |  | `tdd-workflow` |
| `gates-device-only-code-without-test` | The test-edit check reports code-without-test for a fix to a device-only wrapper | The checker saw no device-only marker in the diff | Keep "// device-only: covered by <check>" in the first 6 lines and check with --range or --staged | verified |  | `tdd-workflow` |
