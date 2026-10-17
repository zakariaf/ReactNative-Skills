The task row now shows the due date under the title, and an empty list says "Nothing due today" in every language.

Evidence: tasks slice on 2026-10-09, commit 1a2b3c4

Checks
- Types, lint, format: pass
- Tests: 230/230 pass (unit 207, golden 23), random seed 48213

What changed for users
- The due date sits under the task title, so a long title no longer cuts it off (TASK-52).
- An empty list reads "Nothing due today" instead of "No tasks" (TASK-53).

Please look at (at most 5)
- The task row in dark mode, Arabic, because the due date moved.

Goldens and baselines changed on purpose
- src/features/tasks/__snapshots__/task-row.golden.test.ts.snap: the due date moved under the title (Gate-Change trailer in 7d3e9a1)
- .maestro/baselines/: 4 task-list screenshots after the row change (Gate-Change trailer in 8c2f4b0)

Texts changed in every locale
- tasks.empty.title (en, ar): the source text now reads "Nothing due today"; ar changed with it, and the ar draft goes to a native-language review, listed under "Human checks (not blocking)".

Human checks (not blocking)
- On-device check: look at a long task title on a small phone, still open
- Native-language review of changed texts: the ar draft of tasks.empty.title

Not tested or not verified
- Nothing device-specific beyond the on-device check.

Details
- Red run: Expected: "Nothing due today", Received: "No tasks"
