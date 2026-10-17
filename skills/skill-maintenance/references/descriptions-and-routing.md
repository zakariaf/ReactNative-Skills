# Descriptions and routing

How to write a description that makes the agent load the skill for the right tasks and leave it for its neighbours, and how to prove it with routing evals. Read this before writing or changing any description, and when a skill loads for the wrong task or not at all.

## Contents

- Why the description is everything
- The formula
- Rules
- Good and bad examples
- Keeping a set apart
- Routing evals
- Writing eval prompts
- When an eval fails

## Why the description is everything

The agent sees only names and descriptions until it invokes a skill; the body is read afterwards. A rule written only in the body cannot make the skill load. The listing is budgeted (the how-skills-load reference has the numbers): long descriptions push other skills down to name-only, and the set shares that listing with the developer's other installed skills. Agents also under-use skills for tasks that look easy, so a description names situations, not just a topic.

## The formula

`<Verb>s <what, packed with the concrete nouns of the job>. Use when <the intents and trigger words a task would contain>. Not for <the neighbour's work> (<neighbour-skill>).`

- At most 300 characters, aiming for 250 on average across the set. Third person, starting with a verb ("Builds", "Checks", "Ships", "Diagnoses", "Adds"). No `<` or `>`, no "I" or "you".
- The first 8 to 12 words are unique across the set: a distinct verb and object.
- "Use when" lists what a task would say: file names, commands, symptoms ("upload fails", "renders wrong"), error words.
- "Not for" names the neighbouring work and, in parentheses, the exact folder name of the skill that owns it. It is how the agent tells two close skills apart, and `check-skill.mjs` and `check-skill-set.mjs` check that the named skill exists.

## Rules

1. State both what the skill does and when to use it.
2. Put the key use first: when the listing is over budget whole descriptions disappear, and the agent reads the lead first.
3. Be a little pushy: name contexts where the skill helps even when the task does not name its domain ("a gate fails", "renders wrong", "a date is a day off").
4. Use the words the developer and the tasks use (TestFlight, Play Console, simulator, emulator, RTL, Premium), including synonyms.
5. Describe intent, not implementation ("Ships a build to TestFlight", not "runs release-ios.ts").
6. Never fix a missed eval by pasting its words into the description (overfitting); generalise to the category of intent.
7. Keep "when to use" guidance out of the body; it is read too late.
8. One controlled vocabulary across the set: words like screen, route, store, golden, contract mean one thing everywhere.

## Good and bad examples

Good (each splits the space with its neighbour):

```yaml
description: Ships an iOS build to TestFlight - signing, archive, export, store-artifact gate, upload, processing wait, build numbers, tags. Use when releasing, uploading or signing an iOS build or an upload fails. Not for simulator builds (ios-simulator-build).
description: Builds and runs the app as a Release iOS simulator build - clean prebuild, xcodebuild, named simulators, launch, screenshot. Use when building, running or smoke-testing on the simulator or xcodebuild fails. Not for TestFlight (ios-release-testflight).
```

Bad, and why:

```yaml
description: Helps with apps.                                        # vague, no "Use when", no boundary
description: I can help you build Expo screens.                      # first person
description: Use for all React Native, Expo, TypeScript and UI tasks.   # swallows every sibling
description: Runs release-ios.ts and patches app.json.               # implementation, not intent
description: Builds screens following the design chapter of the handbook.   # points at project files
```

## Keeping a set apart

- `check-skill-set.mjs .` (the repo root, so installed skills count) flags two descriptions that share more than 30% of their content words (before "Not for"), two that start with the same five content words, a "Not for" hand-off to a skill that does not exist or to the skill itself, a listing over 20,000 characters (two thirds of the 30,000 measured at the default budget on a 1,000,000-token context window, so the set leaves room for the developer's other skills; scaled by the repo's `skillListingBudgetFraction`, so 0.04 allows 80,000; pass `--budget` for a smaller window, or when plugin-installed skills, which are not counted, take a share), and an average description over 250 characters. Installed skills count toward the listing, but only authored skills that push it over fail; installed ones that overflow it alone print a note. Skills with `disable-model-invocation: true` leave the listing and count for neither.
- When two skills keep colliding, sharpen both: each description names what it owns and puts the other in its "Not for". If two skills always load together and share one check, merge them; if one skill has two unrelated checks, split it.
- The index skill (a skill whose name ends in `-index`, or `--index <skill>`) must name every skill in its SKILL.md, its references or its `assets/*.json` data; `check-skill-set.mjs` checks that.

## Routing evals

The repo keeps its evals in `contracts/routing-evals.json` (copy this skill's `templates/contracts/routing-evals.json` and replace its `__PLACEHOLDER__` seeds, which fail as `eval-placeholder` until you do; a library may keep them elsewhere and pass `--evals <file>`): realistic task prompts, at least two per authored skill, each with the skill that should handle it, or `"expect": null` for a prompt that should load none of the project skills.

```json
{
  "evals": [
    { "prompt": "the task list screen jumps when I check a task off", "expect": "react-components-and-hooks" },
    { "prompt": "What is 2 + 2?", "expect": null }
  ]
}
```

- **Offline** (default, free, seconds): `node ${CLAUDE_SKILL_DIR}/scripts/check-routing.mjs .` ranks all listed skills for each prompt with a lexical stand-in for the agent (description words weighted by rarity, name words double, words only in "Not for" counting against) and fails when the expected skill is not in the top 3. It also fails an authored, model-invocable skill with fewer than two evals (`eval-coverage`; installed third-party skills under `.agents/skills/` are exempt). It is an early warning that a description lost its words, not proof. The word "skill" counts like any other word, so a task about skills themselves ("add a skill for ...") reaches this skill.
- **One prompt, no judgement:** `check-routing.mjs . --prompt "<the task>"` without `--expect` prints the top three skills with their scores (`rank #1 store-listing-texts (score 7.42)`) and passes; it answers "does a skill already own this?" before a new skill is scaffolded. With `--live` it prints the skill the agent chose (`chose: <skill>` or `chose: no skill`). Add `--expect <skill>` to turn it into an eval.
- **Live** (one short model call per prompt and run): add `--live` (with `--runs 3` and `--only <skill>`) to run `claude -p "<prompt>" --output-format stream-json --verbose` in the repo and read the first tool call; a Skill call names the chosen skill (a plugin skill arrives as `<plugin>:<skill>` and counts as `<skill>`), any other first tool counts as no skill. An eval passes when at least half the runs choose the expected skill; an `expect: null` eval fails (`route-false-positive`) when most runs load a skill. Verified on 2026-09-28 with Claude Code 2.1.283: in a throwaway repo two skills both routed correctly, "What is 2 + 2?" loaded none, and a planted mismatch failed as `route-miss`. The agent sees only skills loaded in that repo (`.claude/skills/`, or a plugin folder passed with `--plugin-dir`; for skills authored in `skills/`, pass `--plugin-dir .`). The stream's `init` event lists the session's skills (plugin skills as `<plugin>:<skill>`; verified with Claude Code 2.1.299 on 2026-10-14, re-verify by reading that event of `claude -p "hi" --output-format stream-json --verbose`), and check-routing stops with exit 2 when an expected skill is missing there, instead of failing every eval as `route-miss`. Use it after a description rewrite of your skill and its neighbours, not on every change.
- A prompt that names the skill always routes (a developer naming a skill is the normal case); evals test the unnamed case.
- While a skill is still being built, `--skip-missing` turns its evals into notes.

## Writing eval prompts

- Write them as tasks are written: casual, specific, with file names, screens and symptoms. "the banner ad still shows after I buy Premium" beats "configure ads".
- Leave out the skill's name and its most unusual words; include the words a task would really use.
- Add near misses: a prompt that shares words with the skill but belongs to a neighbour, with the neighbour as `expect`. They are the valuable ones ("the Release build crashes on launch in the simulator" belongs to the simulator build skill, not to the release upload skill).
- Two prompts per skill at least; more for skills that border many others.

## When an eval fails

1. Read which skills won. If the winner is a better home for that task, the eval's `expect` is wrong: fix the eval.
2. Otherwise change the description of the expected skill (its lead words) or add a "Not for" boundary to the winner. Change the category of intent, not the eval's exact words.
3. Rerun the offline evals for the whole set (a description change can steal other skills' prompts), then `--live --only <skill> --runs 3` for the skills you touched.
4. Keep the description at most 300 characters; rerun the validator and `check-skill-set.mjs`.
