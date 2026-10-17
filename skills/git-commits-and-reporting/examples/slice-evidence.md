A task title you were typing is still there after the app is closed or killed.

Evidence: tasks slice on 2026-10-08, commit 5d64fbf

Checks
- Types, lint, format: pass
- Tests: 214/214 pass (unit 192, golden 22), random seed 48213
- Coverage: lines 92.8% (gate 90), logic folders 96.4% (gate 95)   reports/coverage/coverage-summary.json

What changed for users
- The new-task sheet keeps an unsaved title across a restart (TASK-12).

Human checks (not blocking)
- On-device check: type a title, swipe the app away on a phone and reopen it, still open
- Native-language review of changed texts: none pending from this slice

Not tested or not verified
- Nothing device-specific beyond the on-device check: a repository test on real SQL proves the draft is stored.

Details
- Red run: Expected: "Buy milk", Received: undefined (loadDraft before the draft table existed)
- Commit: 5d64fbf feat(tasks): keep a draft when the app is killed
