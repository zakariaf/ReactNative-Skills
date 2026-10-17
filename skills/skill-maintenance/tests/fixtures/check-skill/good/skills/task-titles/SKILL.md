---
name: task-titles
description: Checks task title helpers in the app. Use when writing or reviewing a task title helper. Not for file names (file-naming).
---

# Task titles

Keeps task title helpers pure and proves it with a checker.

## Rules that must hold

1. **Named exports only.** A default export lets every importer rename the function, so searches miss call sites.
2. **No clock in title helpers.** Reading `Date.now()` makes the same task render different titles in tests and on devices.

## Workflow

1. Read [references/guide.md](references/guide.md) before writing the helper.
2. Copy `templates/src/features/tasks/task-title.ts` and compare it with [examples/worked.md](examples/worked.md).
3. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-titles.mjs .` and fix every FAIL line.

## Definition of done

- [ ] The helper has named exports only.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-titles.mjs .` prints `RESULT: PASS`

## Anti-patterns

- **Silencing the checker.** Fix the helper instead; the check exists because the mistake is easy to make.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/guide.md](references/guide.md) | The rules and a worked example | Workflow step 1 |
| [examples/worked.md](examples/worked.md) | A finished helper | Workflow step 2 |
| `templates/src/features/tasks/task-title.ts` | The helper template | Workflow step 2 |
| `scripts/check-titles.mjs` | The checker | Workflow step 3 |
| `scripts/selftest.mjs` | Proves the checker | After changing it |
| `scripts/check-lib.mjs` | Shared script helper (synced) | Never by hand |
| `tests/fixtures/` | Self-test inputs | When adding a rule |

## Related skills

- `file-naming` - naming files and exports.
