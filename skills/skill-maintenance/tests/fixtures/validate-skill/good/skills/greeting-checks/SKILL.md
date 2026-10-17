---
name: greeting-checks
description: Checks sample greetings for the validator self-test. Use when testing the skill validator. Not for real apps (greeting-checks).
---

# Sample greetings

A small, valid skill that the validator self-test changes one rule at a time.

## Rules that must hold

1. **Greet first.** Every greeting starts with "Hello", so the reader knows what it is.

## Workflow

1. Read [references/guide.md](references/guide.md).
2. Copy [templates/greeting.ts](templates/greeting.ts) into the app and fill in the placeholder.
3. Run `node ${CLAUDE_SKILL_DIR}/scripts/check-greeting.mjs greetings` and fix every FAIL line until it prints `RESULT: PASS`.

## Definition of done

- [ ] The greeting is copied and filled in.
- [ ] `node ${CLAUDE_SKILL_DIR}/scripts/check-greeting.mjs greetings` prints `RESULT: PASS`.

## Anti-patterns

- Skipping the guide and guessing the wording.

## Files in this skill

| File | What it is | Read/run when |
|---|---|---|
| [references/guide.md](references/guide.md) | How greetings are written | Workflow step 1 |
| [templates/greeting.ts](templates/greeting.ts) | Greeting function to copy | Workflow step 2 |
| `scripts/check-greeting.mjs` | Checker for the greeting rule | Workflow step 3 |
| `scripts/selftest.mjs` | Proves the checker | After changing the checker |
| `scripts/check-lib.mjs` | Shared script helper (synced) | Never by hand |
| `assets/shared.json` | Shared files this skill copies in | When adding a shared file |
| `tests/fixtures/` | Good and planted-bad inputs | When adding a rule |

## Related skills

- None
