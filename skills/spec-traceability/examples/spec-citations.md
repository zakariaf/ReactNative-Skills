# One requirement, cited everywhere

A shape to imitate: requirement REQ-2 of the Tasks app's spec followed from the printed entry to the
report, with each place where an ID appears and what the checker does with it. The spec is the one
in the skill's `templates/docs/spec/`.

## 1. Print the entry (never retell it)

```text
$ node <skill>/scripts/spec-lookup.mjs . REQ-2 DEC-1
== REQ-2 · Complete a task  [requirement, planned]  (docs/spec/requirements.md:18)
- Status: planned

Completing a task moves it to the Done section and shows an Undo action for the time DEC-1 sets.

- Acceptance: Undo puts the task back where it was.

== DEC-1 · How long Undo stays on screen  [decision, open]  (docs/spec/decisions.md:6)
- Status: open
- Options: 4 seconds, 5 seconds, until the next action
- Default: 5 seconds

Used by REQ-2.

spec-lookup: 2 IDs checked, 0 problems
RESULT: PASS
```

DEC-1 is open, so the slice uses its default and says so; nobody is asked.

## 2. The first failing test quotes it

```ts
// src/features/tasks/complete-task.test.ts
describe('completeTask', () => {
  // REQ-2: "Completing a task moves it to the Done section and shows an Undo action."
  it('moves the task to the Done section (REQ-2)', () => {
    // ...
  });

  it('keeps Undo for 5 seconds, the DEC-1 default (REQ-2)', () => {
    // ...
  });
});
```

This file matches `traceGlobs`, so it **traces** REQ-2. Set `Status: built` on REQ-2 in the commit
that turns these tests green; with no citing test, `untraced-requirement` fails.

## 3. Code comments and constants cite, but do not trace

```ts
// src/features/tasks/undo-window.ts
/** How long Undo stays on screen (DEC-1 default; REQ-2). */
export const UNDO_MS = 5000;
```

The checker proves `DEC-1` and `REQ-2` exist (`dangling-id` otherwise). Settling DEC-1 differently is
now a one-line change plus a `Spec-Change:` commit.

## 4. The end-to-end flow names the screen by name and ID

```yaml
# .maestro/complete-task.yaml
# Task list (SCR-1): completes a task and undoes it (REQ-2), on the iOS simulator and the Android emulator.
appId: com.example.tasks
---
- launchApp
```

`Task list (SCR-1)` is a name pair: `Settings (SCR-1)` would fail `screen-name-mismatch`. The flow
traces both SCR-1 and REQ-2.

## 5. The commit body names the IDs

```text
feat(tasks): complete a task with undo

REQ-2: completing moves the task to Done and shows Undo. Undo stays
5 seconds, the default of the open decision DEC-1.
```

With `--range <base>..HEAD` the checker reads this body too: `REQ-22` here would be a
`dangling-id` on the commit's short SHA. When the requirement later changes, one commit changes the
spec entry, the test expectation and the code together. Its body says why (git-commits-and-reporting
requires a body on every `fix` and `feat`), and the `Spec-Change:` trailer sits alone in the last
paragraph:

```text
fix(tasks): keep Undo until the next action

DEC-1 is now decided: Undo stays on screen until the next action, so
the 5-second timer is removed, the Undo test expects the new behaviour
and docs/spec/decisions.md records the decision.

Spec-Change: DEC-1 decided as "until the next action" (was the 5-second default)
```

The same commit edits the entry in `docs/spec/decisions.md`:

```diff
 ## DEC-1 · How long Undo stays on screen
-- Status: open
+- Status: decided
 - Options: 4 seconds, 5 seconds, until the next action
-- Default: 5 seconds
+- Decided: until the next action (was the 5-second default)
```

Before committing, check the planned message the way git-commits-and-reporting describes: it applies
the commit-msg hook's rules, so a message that passes there is not rejected. `Spec-Change:` belongs
only on a commit whose test expectation changed because the requirement changed; a spec edit with no
test change (a typo, a new `planned` entry) carries no trailer.

## 6. The report

```text
Done: completing a task (REQ-2) on Task list (SCR-1), iOS and Android.
Decision used: DEC-1 is open; Undo uses its default, 5 seconds.
Trace: TRACE REQ-2 [built] Complete a task: .maestro/complete-task.yaml, src/features/tasks/complete-task.test.ts
```

## 7. A requirement question

When the spec is silent about something a user sees, the question quotes the lines and offers a
default (the message shape is git-commits-and-reporting's request template):

```text
The spec does not say what Undo does when the user completes a second task while the first Undo is still showing.

Please pick A or B (a one-word answer, about 1 minute). Until then I build A behind one constant.
- REQ-2: "shows an Undo action for the time DEC-1 sets"
- Option A (my default): the newer Undo replaces the older one; the first completion stays done.
- Option B: both stay undoable, stacked.
```

## What the checker would flag

| Written | Rule |
|---|---|
| `it('completes a task (REQ-22)')` | `dangling-id` |
| `// Settings (SCR-1)` | `screen-name-mismatch` |
| `// see spec 7.3` in a spec that numbers its sections but has no 7.3 (the shipped template spec has no numbered sections, so there it is not read) | `unknown-spec-section` |
| `it('shows the widget (OOS-3)')` | `out-of-scope-traced` |
| REQ-2 `Status: built` with no citing test | `untraced-requirement` |
| `const CODES = ['S16']` | nothing: not a configured prefix, and a code string |
