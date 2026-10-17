Tasks 1.4.0 is in TestFlight and Play internal testing: drafts survive a restart, overdue tasks stay overdue across time zones, and reminders can repeat weekly.

Please say "ship" when Tasks 1.4.0 (iOS build 14, Android build 31) may go to review. Until then the builds stay in testing and I keep working on the shared lists.

Evidence: tasks release 1.4.0 on 2026-10-09, commit 9f3c2ab

Checks
- Types, lint, format: pass
- Tests: 612/612 pass (unit 571, golden 41), random seed 90211
- Coverage: lines 93.4% (gate 90), logic folders 97.1% (gate 95)   reports/coverage/coverage-summary.json
- Mutation: 84% (break 75), survivors explained under Details   reports/stryker/mutation.json
- End-to-end: iOS 14/14, Android 14/14 flows pass, quarantined: none   reports/e2e/ios/junit.xml, reports/e2e/android/junit.xml

What changed for users
- A task title you were typing is still there after the app is closed (TASK-12).
- A task due yesterday stays overdue after you travel to another time zone (TASK-31).
- A reminder can repeat every week, skipping public holidays (TASK-40).

Please look at (at most 5)
- The task row in dark mode, Arabic, because the due date now sits under the title.
- The repeat picker at 200% text, because the labels now wrap.

Goldens and baselines changed on purpose
- src/ui/__snapshots__/task-row.golden.test.ts.snap: the due date moved under the title (Gate-Change trailer in 7a1b2c3)

Human checks (not blocking)
- On-device check: set a weekly reminder on a phone with TestFlight or internal testing and hear it fire, still open
- Native-language review of changed texts: none pending in this release

Not tested or not verified
- Sound and haptics of the reminder on a real phone: the on-device check above
- Purchases against the real stores: TestFlight sandbox and Play license testers
- TalkBack and VoiceOver spot check of the repeat picker

Details
- Mutation survivors: 3 in the repeat calendar, equivalent mutants (a zero-day step changes nothing).
- Upload tags: v1.4.0+ios.14, v1.4.0+android.31
