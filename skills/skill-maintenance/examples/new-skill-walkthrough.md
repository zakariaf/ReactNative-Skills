# Worked example: a new project skill, then a new rule

Two real runs with the commands and the output they printed (2026-10-14; the routing part of step 4 and Part B rerun with the current scripts on 2026-10-16; in a scratch Tasks app repo with no `skills/` folder yet, this skill and `troubleshooting-playbook` installed under `.agents/skills/`, `skillListingBudgetFraction` 0.04 in its `.claude/settings.json`; `i18n-strings-and-catalogs` was installed after step 3). Part A adds a project skill end to end; Part B adds a rule to its checker. `<maint>` stands for this skill's folder (`${CLAUDE_SKILL_DIR}`) and `<new>` for the new skill's folder (`skills/store-listing-texts`); everything runs from the app's repo root. Long lines are cut.

## Contents

- Part A: a new skill, store-listing-texts
- Part B: a second rule, and the case it needs

## Part A: a new skill, store-listing-texts

The task: "review must never reject a build for its listing; add a skill that checks the store texts." No installed skill owns listing texts (`i18n-strings-and-catalogs` owns in-app copy).

**1. Who wins the task today, then scaffold.**

```text
$ node <maint>/scripts/check-routing.mjs . --prompt "add a skill that checks our App Store and Play listing texts for prices"
NOT APPLICABLE: only installed skills (skill-maintenance, troubleshooting-playbook under .agents/skills/), which their authors own: pass .agents/skills to check them
RESULT: PASS
$ node <maint>/scripts/check-routing.mjs .agents/skills --prompt "add a skill that checks our App Store and Play listing texts for prices"
rank #1 skill-maintenance (score 4.05)
rank #2 troubleshooting-playbook (score 0.00)
check-routing: 1 prompt (offline, top 3; add --expect <skill> to judge it) checked, 0 problems
RESULT: PASS
$ node <maint>/scripts/new-skill.mjs store-listing-texts --skills-root skills
created the skills root skills (the repo had no skills folder yet)
created skills/store-listing-texts (12 files)
next: fill every __FILL_...__, then run validate-skill.mjs, the new skill's scripts/selftest.mjs and check-skill.mjs on it
RESULT: PASS
```

**2. Fill every placeholder.** The scaffold passes the validator as it is (its structure is complete), but `check-skill.mjs` reports every `__FILL_...__`, so nothing half-written can ship. What was written:

- The description, 217 characters, verb first, trigger words, one hand-off:
  `Checks App Store and Play listing texts (name, subtitle, description, keywords, release notes) for prices and other platforms. Use when writing or changing store texts. Not for in-app copy (i18n-strings-and-catalogs).`
- Two rules with reasons: "**No prices in any listing text.** Prices differ per storefront and change, and App Store review rejects metadata that states them." and "**No other platforms.** Naming the other store in a listing breaks both stores' metadata rules and blocks the release."
- The reference renamed to `references/listing-rules.md` (the two review rules with the date they were read, where texts live, a worked example), with the Files table and workflow step 1 following the new name.
- The checker's first rule in `scripts/check-rules.mjs`: `no-price`, `include: ['store/**/*.txt']`, pattern `/[€$£]\s?\d|\d+[.,]\d{2}\s?(?:€|EUR|USD|\$)/`, and plain-text files scanned without comment masking (a URL's `//` is not a comment).
- The overlay fixtures: `good/store/en/description.txt` (a clean text), the planted copies of a demo skill under the case's `skills/` and `.agents/skills/` folders (a price the scan must skip), the vendored `SKILL.md` that `SUITE.json` writes at run time, and `bad-price/mutation.json`, which writes `store/de/description.txt` with "Premium ohne Werbung für nur 1,99 €." on line 2 (EXPECT `[no-price]` and `store/de/description.txt:2`).

**3. Prove it.**

```text
$ node <new>/scripts/selftest.mjs
ok   check-rules.mjs --help
ok   check-rules.mjs bad-price (exit 1, found "[no-price]", "store/de/description.txt:2")
ok   check-rules.mjs error-missing-root (exit 2, found "ERROR [bad-input] nothing to check: repo root no-such-folder ...")
ok   check-rules.mjs good (exit 0)
RESULT: PASS
$ node <maint>/scripts/validate-skill.mjs <new>
skill store-listing-texts: passes
RESULT: PASS
$ node <maint>/scripts/check-skill.mjs <new>
FAIL store-listing-texts/SKILL.md:3 [desc-neighbours] "Not for" names i18n-strings-and-catalogs, which is not a known skill
FAIL store-listing-texts/SKILL.md:43 [related-names] i18n-strings-and-catalogs is not a known skill
RESULT: FAIL (2 problems)
```

That first `check-skill.mjs` run happened before the i18n skill was installed: hand-offs are checked against every skill folder of the repo (`skills/`, `.claude/skills/`, `.agents/skills/`), so a hand-off to a skill the app does not have fails. After installing it, the same command printed `check-skill: 16 files checked, 0 problems` and `RESULT: PASS`.

**4. Check the set and the routing.**

```text
$ node <maint>/scripts/check-skill-set.mjs .
note: troubleshooting-playbook (installed) hands off to quality-gates, which is not in this set; its author owns it
(three more notes like it)
listing: 4 listed skills (0 run-only, 3 installed), 1151 of 80000 characters (skillListingBudgetFraction 0.04 in .claude/settings.json), average authored description 217 (target 250)
RESULT: PASS
$ cp <maint>/templates/contracts/routing-evals.json <maint>/templates/contracts/routing-evals.schema.json contracts/
$ node <maint>/scripts/check-routing.mjs .
FAIL contracts/routing-evals.json [eval-coverage] store-listing-texts has 0 evals (needs 2) Fix: ...
FAIL contracts/routing-evals.json [eval-placeholder] evals[0] still holds the template placeholder __FIRST_TASK_PROMPT_FOR_THE_NEW_SKILL__ Fix: ...
(two more eval-placeholder lines, for evals[1] and evals[2])
RESULT: FAIL (4 problems)
$ # the three seeds replaced: two prompts for the new skill and a near miss for i18n-strings-and-catalogs
$ node <maint>/scripts/check-routing.mjs .
ok   evals[0] store-listing-texts #1
ok   evals[1] store-listing-texts #2
ok   evals[2] i18n-strings-and-catalogs #2
check-routing: 4 evals (offline, top 3) checked, 0 problems
RESULT: PASS
```

The template's seeds are placeholders on purpose: they fail until the repo's own skills replace them, whether this skill sits in the repo or comes from a plugin.

The installed skills' own hand-offs are notes, not problems: the app installed a subset of a library, and their author owns them. The near miss ("translate the empty-state message on the lists screen into Arabic") still goes to `i18n-strings-and-catalogs`, so the new description steals nothing.

Only the installed skills existed at step 1, so the repo root was `NOT APPLICABLE` and the ranking ran over `.agents/skills`: no installed skill owned listing texts (only this skill, for the word "skill"), so a new one was right.

Then one live confirmation. Without `--plugin-dir .` the session (Claude Code 2.1.299) never sees a skill authored in `skills/`, and the run stops before any model call:

```text
$ node <maint>/scripts/check-routing.mjs . --live --only store-listing-texts
ERROR [bad-input] skill store-listing-texts is not loaded in this session (claude listed 34 skills without it) Fix: Pass --plugin-dir . when the repo authors its skills in skills/, ...
$ node <maint>/scripts/check-routing.mjs . --live --only store-listing-texts --plugin-dir .
ok   evals[0] store-listing-texts (1/1)
ok   evals[1] store-listing-texts (1/1)
check-routing: 2 evals (live, 1 run(s) each) checked, 0 problems
RESULT: PASS
```

**5. Report:** the skill, its description, what the checker checks, and the RESULT lines. `--runs 3` on the live check was left to the developer (it costs model calls).

## Part B: a second rule, and the case it needs

The second rule went into `RULES` of `scripts/check-rules.mjs`:

```js
{
  id: 'no-other-platform',
  include: ['store/**/*.txt'],
  pattern: /\b(?:Android|Google Play|App Store|iPhone|iPad)\b/,
  message: 'a listing text names a platform or store',
  fix: 'Describe what the app does; each store already shows where it runs.',
},
```

The skill's own self-test still passed, because no case exercised the new rule. `check-skill.mjs` did not:

```text
$ node <new>/scripts/selftest.mjs
selftest: 4 runs checked, 0 problems
RESULT: PASS
$ node <maint>/scripts/check-skill.mjs <new>
FAIL store-listing-texts/scripts/check-rules.mjs [rule-has-bad-case] rule no-other-platform (listed in --help) has no bad-* case in the self-test suites of check-rules.mjs (tests/fixtures) whose EXPECT.txt names it Fix: ...
check-skill: 16 files checked, 1 problems
RESULT: FAIL (1 problems)
```

The fix is one small overlay case, `tests/fixtures/bad-other-platform/`:

```text
mutation.json   [{ "write": { "file": "store/en/release-notes.txt", "lines": ["Faster lists and calmer reminders.", "Also on Google Play."] } }]
EXPECT.txt      [no-other-platform]
                store/en/release-notes.txt:2
```

```text
$ node <new>/scripts/selftest.mjs
ok   check-rules.mjs bad-other-platform (exit 1, found "[no-other-platform]", "store/en/release-notes.txt:2")
selftest: 5 runs checked, 0 problems
RESULT: PASS
$ node <maint>/scripts/check-skill.mjs <new>
check-skill: 18 files checked, 0 problems
RESULT: PASS
```

Then the validator again (`RESULT: PASS`), and the rule added to SKILL.md's rules with its reason, so the agent that loads the skill knows why the checker fails.
