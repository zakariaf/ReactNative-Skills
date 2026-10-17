# The TDD loop

How every behaviour of an Expo app gets built: one failing test, the minimum code, a refactor, the fast
gate, one commit. When an agent writes most of the code, the reviewer reads the report first and the
code rarely; the tests are the specification the agent builds against and the evidence the reviewer
signs off.

Verified on 2026-10-10 with Jest 29.7.0, jest-expo 57.0.5, fast-check 4.10.2, TypeScript 6.0.3 and
React Native Testing Library 14.0.1 (Expo SDK 57). Re-verify: `npm ls jest jest-expo fast-check
typescript @testing-library/react-native`.

## Contents

- Why the loop is strict
- The loop, step by step
- Where the requirement comes from
- Red for the right reason
- Commands used all day
- Discipline rules
- Pure logic: examples, properties and one pinned value
- Determinism inside tests
- Android-only behaviour
- When fast-check finds a counterexample

## Why the loop is strict

- One agent writes both the code and the tests. A test written after the code tends to assert what the
  code does, not what the requirement says. Seeing it fail first is the only proof the test can catch
  the bug.
- Coverage alone cannot show that tests would catch a bug, so mutation testing (Stryker) audits the
  logic tests, and goldens catch what assertions forget.
- Determinism is a feature: daily content, streaks and replays must give the same answer on every
  device and every day. Tests enforce it with an injected clock and a seeded random-number generator;
  they never add randomness of their own.

## The loop, step by step

```text
1. Pick the next behaviour (quote the requirement in the test title or a comment above it).
2. Write ONE failing test.                    npx jest --ci <path>
3. Read the failure. Right reason = an assertion diff. Wrong reason = import/type/syntax error: fix that.
4. Write the minimum code.                    npx jest --ci <path>   -> green
5. Refactor by responsibility (size limits), tests stay green.
6. npm run -s check:fast                      (also the agent's Stop hook)
7. Commit the slice (red and green together). The pre-commit hook reruns related tests.
```

A slice is one behaviour a user, a screen or another module can observe: "a task due today shows as
today", "the first completion of the day counts for the streak", "pressing a task's checkbox toggles
it". One slice is one commit.

Before step 2, write the plan in a few lines (`assets/slice-plan.md`): the requirement, the behaviour
in one sentence, the first test's title, the files the code will touch, the evidence the slice needs.

## Where the requirement comes from

- **The app has a spec with IDs** (`TASKS-12`, `REQ-4.2`): print the entry from the spec file and quote
  it word for word; never quote from memory (spec-traceability keeps the IDs and their checker). Set
  `requirementIdPattern` in `contracts/tdd.json` and check-test-edits then fails a new test of a
  feat/fix commit that quotes no ID, and a `Spec-Change:` trailer that cites none. Use the same
  pattern as `requirementRef.pattern` in `contracts/commits.json` (git-commits-and-reporting) when the
  app sets both. Without a pattern, a `Spec-Change:` trailer still has to name some reference
  (`TASKS-12`, `#41`, `issue 41`, `spec 4.2`), the commit-msg hook's default.
- **No spec yet**: quote the issue or the acceptance criterion you were given ("#41: three days ahead
  counts as soon"). If there is nothing written, write the one-sentence behaviour into the plan and ask
  the developer to confirm it before the first test; a guessed requirement makes a confident wrong test.

## Red for the right reason

A red run for the right reason fails on an assertion and shows expected against received (real output,
`npx jest --ci src/features/tasks/task-urgency.test.ts` with a stub that returns `'later'`):

```text
FAIL unit src/features/tasks/task-urgency.test.ts
  taskUrgency
    ✕ returns today for a task due today (TASKS-12) (2 ms)

  ● taskUrgency › returns today for a task due today (TASKS-12)

    expect(received).toBe(expected) // Object.is equality

    Expected: "today"
    Received: "later"
```

Wrong reasons, which prove nothing about the behaviour:

- `Cannot find module './task-urgency' from 'src/features/tasks/task-urgency.test.ts'` or a
  `SyntaxError`: the test never reached an assertion. Create a stub that exports the function with the
  right type and returns a wrong value (`return 'later'`, `return 0`, `return []`), then rerun until the
  failure is an assertion. (The edit hook reports the stub's unused parameter as a lint error for the
  minute until the real code uses it: expected, never silenced, never committed.)
- A TypeScript error: fix the types in the test or the stub first.
- A test that passes immediately: the behaviour already exists, or the test asserts nothing that
  matters. Check with a quick deliberate break of the code, then choose a sharper test.

Copy the red lines into the slice notes; they are part of the evidence.

## Commands used all day

Run every command from the repo root.

| Need | Command |
|---|---|
| One file | `npx jest --ci src/features/tasks/task-urgency.test.ts` |
| One title | `npx jest --ci -t 'returns today'` |
| An Android-only test | `npx jest src/features/tasks/task-editor.android.test.tsx --ci --selectProjects android` |
| Tests related to changed files | `npx jest --ci --findRelatedTests <files>` |
| The fast gate (format, lint, types, changed tests) | `npm run -s check:fast` |
| Only goldens | `npm run test:golden` |
| Coverage with the gate (random order, prints the seed) | `npm run test:coverage` |
| Coverage of one slice, no verdict (paths first) | `npx jest src/features/tasks --ci --selectProjects unit --coverage --collectCoverageFrom='src/features/tasks/**/*.ts' --coverageThreshold='{}'` |
| Replay an order-dependent failure | `npx jest --ci --randomize --seed=<printed seed> -i` |
| Mutants of one file | `npx stryker run --mutate src/features/tasks/task-urgency.ts` |
| The tree check of this skill | `node ${CLAUDE_SKILL_DIR}/scripts/check-tests.mjs .` |
| The history check of this skill | `node ${CLAUDE_SKILL_DIR}/scripts/check-test-edits.mjs . --range <base>..HEAD` |

Run Jest from the repo root only: jest-expo finds the Babel config and the tsconfig aliases from the
working directory, and without them every suite fails on syntax or on `@/` imports.

Only `npm run test:coverage` judges the coverage thresholds. A subset run with plain `--coverage`
counts every file the root config collects, so the global threshold fails even when every file of the
subset passes. For a subset, put the paths first (`--selectProjects` reads every following word as a
project name), limit `--collectCoverageFrom` to the slice's folder and switch the thresholds off with
`--coverageThreshold='{}'`; read the per-file numbers, then run `npm run test:coverage` for the verdict.

## Discipline rules

1. **One failing test first, run, read.** Never write product code for a behaviour that has no red test.
2. **Red and green in the same commit.** Never commit a failing test; never use `it.skip`, `it.only`,
   `it.failing`, `it.todo`, `xit`, `xdescribe`, `fit` or `jest.retryTimes`. Skipped tests rot, and the
   pre-commit hook runs the related tests anyway.
3. **Never edit an existing assertion to make it pass** unless the requirement changed. When it did,
   say which requirement changed in a `Spec-Change: <requirement ID or issue> <what changed>` commit
   trailer (git-commits-and-reporting owns the trailer format). "The test was wrong" is never a
   Spec-Change: it means the test was written without reading the requirement, so reread it and ask
   the developer if you disagree.
4. **Never weaken a gate to go green:** no lowered threshold, tolerance or lint rule, no
   `eslint-disable`, `@ts-ignore`, `--no-verify`, `jest -u` without a reason. If a gate looks wrong,
   stop and ask (quality-gates has the note to send).
5. **Finish every slice with `npm run -s check:fast`**, then commit with a Conventional Commits header
   and the requirement in the body.
6. **Refactor by responsibility, never by line count:** extract a named pure function, a sub-component
   or a module with its own test when a size or complexity limit trips.
7. **Test behaviour, not implementation:** roles, accessible names and visible text for UI; returned
   values and emitted events for logic.

## Pure logic: examples, properties and one pinned value

Every pure module (domain rules, reducers, policies, selectors, date maths, parsers) gets three kinds of
test in the same file:

1. **Examples**: concrete inputs and outputs that read like the requirement ("a task due today is
   today"), every limit at exactly its value and one past it, in an `it.each` table.
2. **Properties** with fast-check: determinism (same input, same output), invariants over any valid
   input or any sequence of actions (playActions from unit-and-component-tests), a JSON round trip for
   anything persisted, a migration of any valid old persisted document, monotonicity where the
   requirement implies it ("urgency never rises as the due date moves away").
3. **At least one pinned exact value**: one exact output for one fixed input, written as a literal.

Why all three: on a seeded random-number generator, determinism and range properties alone left 3 of 8
mutants alive; the pinned value killed them. Properties find the cases nobody thought of; examples
document intent; the pinned value fixes behaviour that properties cannot see.

## Determinism inside tests

- Never read real time, real randomness or the machine's time zone. Inject the clock port (`fake-clock`
  in tests) and the seeded random-number generator; every Jest config pins `TZ=UTC`.
- `Math.random`, `Date.now`, `new Date()` and `performance.now()` stay banned in tests too. The one
  exception is a perf budget test (`test/**/<name>.perf.test.ts`), which times real work with
  `performance` imported from `node:perf_hooks`, because jest-expo replaces the global
  `performance.now` with a 1 ms `Date.now` mock.
- Domain logic takes the injected clock and never needs fake timers. `jest.useFakeTimers()` drives code
  that schedules real timers: UI timers, the system clock adapter, timeout and delay helpers
  (`with-timeout`, `delay-or-abort`); restore real timers in `afterEach`. The system clock adapter is
  not device-only: Jest's fake timers drive it, so it has its own test.
- Fixed fast-check seeds are fine for pinned cases; ordinary properties run with the default random
  seed, and a failure prints the seed and path to replay.

## Android-only behaviour

The `unit` Jest project runs under the iOS preset. Behaviour that exists only on Android (an
`.android.tsx` file, the hardware back button and predictive back, a `Platform.select` branch, an
Android permission result) gets its own `<unit>.android.test.ts(x)`, which the `android` project runs
under `jest-expo/android`. Never overwrite `Platform.OS` in an iOS test: it leaks into later tests and
`.android.tsx` files still resolve to iOS. The red-for-the-right-reason rule is the same.

## When fast-check finds a counterexample

1. Copy the printed counterexample into a new example test
   (`it('returns overdue for -1 days')`) and watch it fail.
2. Fix the code; the example and the property both go green.
3. Reproduce the property run with the printed `{ seed, path }` if needed:
   `fc.assert(property, { seed: <seed>, path: '<path>' })` for the run only; do not commit the seed.

fast-check is never flaky by definition: a new failure is a new counterexample.
