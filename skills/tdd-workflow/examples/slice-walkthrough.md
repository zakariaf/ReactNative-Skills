# Worked slice: how urgent an open task is (TASKS-12)

One complete behaviour slice of a Tasks app, from the requirement to the commit, as it actually ran on
2026-10-10 in an Expo SDK 57 app with the canonical stack (Jest 29.7.0 with jest-expo 57.0.5,
fast-check 4.10.2, TypeScript 6.0.3, the canonical ESLint and Prettier configs). The module is small on
purpose. Copy the shape, not the file.

## Contents

- 1. The plan
- 2. The first failing test, and its red run
- 3. The minimum code, then the rest of the rule
- 4. Refactor and the fast gate
- 5. The commit and the history check
- 6. What goes into the report

## 1. The plan

```text
TASKS-12: "A task due today is today, due within 2 days soon, later later, past its date overdue."
Behaviour: an open task's urgency follows from the whole days left until its due date.
First test: src/features/tasks/task-urgency.test.ts
            it('returns today for a task due today (TASKS-12)')
Code: src/features/tasks/task-urgency.ts
Layer: pure feature logic - nothing below it to test first.
Evidence: red run, examples + properties + a pinned value, check:fast green, both checkers pass.
```

## 2. The first failing test, and its red run

The test comes first, with the requirement quoted at the top. Run before the unit exists, Jest stops on
the import, which proves nothing about the behaviour:

```text
FAIL unit src/features/tasks/task-urgency.test.ts
  ● Test suite failed to run

    Cannot find module './task-urgency' from 'src/features/tasks/task-urgency.test.ts'
```

So the unit gets a stub that returns a wrong but well-typed value, and the run reaches the assertion:

```ts
// src/features/tasks/task-urgency.ts (stub)

/** How urgent an open task is, from the whole days left until its due date (TASKS-12). */
export type Urgency = 'overdue' | 'today' | 'soon' | 'later';

/** Returns the urgency of an open task due in `daysLeft` whole days. */
export function taskUrgency(daysLeft: number): Urgency {
  return 'later'; // stub: wrong on purpose so the first run reaches the assertion
}
```

(The edit hook reports the stub's unused parameter as a lint error. That is expected for the minute
until the real code uses it; never silence it, and never commit a stub. Jest does not run the linter,
so the red run still reaches the assertion.)

```ts
// src/features/tasks/task-urgency.test.ts
// TASKS-12: a task due today is "today", due within 2 days "soon", later "later", past its date "overdue".
import { taskUrgency } from './task-urgency';

describe('taskUrgency', () => {
  it('returns today for a task due today (TASKS-12)', () => {
    expect(taskUrgency(0)).toBe('today');
  });
});
```

`npx jest --ci src/features/tasks/task-urgency.test.ts`: red for the right reason (an assertion diff):

```text
FAIL unit src/features/tasks/task-urgency.test.ts (6.93 s)
  taskUrgency
    ✕ returns today for a task due today (TASKS-12) (2 ms)

  ● taskUrgency › returns today for a task due today (TASKS-12)

    expect(received).toBe(expected) // Object.is equality

    Expected: "today"
    Received: "later"
```

## 3. The minimum code, then the rest of the rule

Make that one test pass with the least code, rerun, then add the next example (overdue, the soon band,
the later band, impossible input) one at a time, each seen red first. The finished test file has
examples, a table for the band edges, the impossible inputs and two properties:

```ts
// src/features/tasks/task-urgency.test.ts
// TASKS-12: a task due today is "today", due within 2 days "soon", later "later", past its date "overdue".
import fc from 'fast-check';

import { taskUrgency } from './task-urgency';

import type { Urgency } from './task-urgency';

const RANK: Readonly<Record<Urgency, number>> = { overdue: 3, today: 2, soon: 1, later: 0 };
const daysArb = fc.integer({ min: -400, max: 400 });

describe('taskUrgency', () => {
  it('returns today for a task due today (TASKS-12)', () => {
    expect(taskUrgency(0)).toBe('today');
  });

  it('returns overdue for a task past its date', () => {
    expect(taskUrgency(-1)).toBe('overdue');
  });

  it.each([
    [1, 'soon'],
    [2, 'soon'],
    [3, 'later'],
    [30, 'later'],
  ] as const)('returns the right urgency %i days ahead', (daysLeft, urgency) => {
    expect(taskUrgency(daysLeft)).toBe(urgency);
  });

  describe('when the input is impossible', () => {
    it.each([[0.5], [Number.NaN], [Number.POSITIVE_INFINITY]])('throws for %d days', (daysLeft) => {
      expect(() => taskUrgency(daysLeft)).toThrow(RangeError);
    });
  });

  describe('properties', () => {
    it('keeps urgency from rising as the due date moves away', () => {
      fc.assert(
        fc.property(daysArb, (daysLeft) => {
          expect(RANK[taskUrgency(daysLeft + 1)]).toBeLessThanOrEqual(RANK[taskUrgency(daysLeft)]);
        }),
      );
    });

    it('returns overdue exactly for negative days', () => {
      fc.assert(
        fc.property(daysArb, (daysLeft) => {
          expect(taskUrgency(daysLeft) === 'overdue').toBe(daysLeft < 0);
        }),
      );
    });
  });
});
```

The code that makes all of them green:

```ts
// src/features/tasks/task-urgency.ts

/** How urgent an open task is, from the whole days left until its due date (TASKS-12). */
export type Urgency = 'overdue' | 'today' | 'soon' | 'later';

/** The last day ahead that still counts as soon (TASKS-12: "due within 2 days"). */
const SOON_DAYS = 2;

/** Returns the urgency of an open task due in `daysLeft` whole days; throws for a day count that cannot happen. */
export function taskUrgency(daysLeft: number): Urgency {
  if (!Number.isInteger(daysLeft)) {
    throw new RangeError(`daysLeft ${String(daysLeft)} must be a whole number of days`);
  }
  if (daysLeft < 0) {
    return 'overdue';
  }
  if (daysLeft === 0) {
    return 'today';
  }
  return daysLeft <= SOON_DAYS ? 'soon' : 'later';
}
```

Green (`npx jest --ci src/features/tasks/task-urgency.test.ts --verbose`):

```text
PASS unit src/features/tasks/task-urgency.test.ts
  taskUrgency
    ✓ returns today for a task due today (TASKS-12) (1 ms)
    ✓ returns overdue for a task past its date (1 ms)
    ✓ returns the right urgency 1 days ahead
    ✓ returns the right urgency 2 days ahead
    ✓ returns the right urgency 3 days ahead
    ✓ returns the right urgency 30 days ahead
    when the input is impossible
      ✓ throws for 0.5 days (2 ms)
      ✓ throws for NaN days (1 ms)
      ✓ throws for Infinity days
    properties
      ✓ keeps urgency from rising as the due date moves away (3 ms)
      ✓ returns overdue exactly for negative days (4 ms)

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

Notes on the choices:

- The examples pin exact values (`taskUrgency(0)` is `'today'`); the properties cover the whole input
  space. Both are needed: properties alone let boundary mutants survive.
- The band edges (1, 2 and 3 days) are in a table so every limit is tested at exactly its value and one
  past it.
- Impossible input is a programmer error, so it throws; an expected failure (a task without a due date)
  would be a returned value or a `Result` instead (error-handling-typed-results).
- The day count comes in as a number: the caller computes it from the injected clock and the due date
  key, so this unit never reads the time.
- The margin is a named constant quoting the requirement, not a bare `2`.

## 4. Refactor and the fast gate

Nothing to split here (one function, well under the size limits). ESLint (`--max-warnings 0`),
Prettier and both TypeScript programs passed on the two files. Run the fast gate and the tree check
before committing:

```sh
npm run -s check:fast
node ${CLAUDE_SKILL_DIR}/scripts/check-tests.mjs .
```

```text
check-tests: 221 test files and logic modules checked, 0 problems
RESULT: PASS
```

## 5. The commit and the history check

Test and code go into one commit; the body names the requirement:

```text
feat(tasks): show how urgent each open task is

TASKS-12: due today is "today", within 2 days "soon", later "later",
past its date "overdue". Examples cover each band edge; properties check
that urgency never rises as the due date moves away and that only
negative day counts are overdue.
```

After committing, prove the slice kept the history rules:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check-test-edits.mjs . --range HEAD~1..HEAD
```

```text
check-test-edits: 1 commits checked, 0 problems
RESULT: PASS
```

If the product later widens the soon band to three days, the commit that moves `toBe('later')` to
`toBe('soon')` carries `Spec-Change: TASKS-12 soon now reaches 3 days ahead (issue #41)`; without that
trailer, or with "Spec-Change: the test was wrong", check-test-edits fails it.

## 6. What goes into the report

The slice's evidence lines (git-commits-and-reporting owns the full template):

```text
- Tests: 11/11 pass in task-urgency.test.ts (red run seen first: Expected "today", Received "later")
- Pure logic: 9 examples, 2 properties, pinned value taskUrgency(0) = 'today'
- check:fast: pass; check-tests: PASS; check-test-edits HEAD~1..HEAD: PASS
```
