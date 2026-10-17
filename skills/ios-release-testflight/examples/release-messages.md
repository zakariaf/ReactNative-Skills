# Example messages: a finished release, a stop, a missing app record

Three messages the developer receives, written the way the release pipeline and this skill produce them. The developer reads these, not the logs: the message is the review.

## 1. A production build is ready (after `release:ios` printed VALID)

```text
Tasks 1.4.0 (build 14) is in TestFlight as a production build.

What I checked before uploading: the build contains no debug menu or test hooks, carries the
app's own id com.acme.tasks and its real AdMob app id, every permission text in English and
Arabic, no StoreKit test files and no debug entitlement, and was built by Xcode 26.6
(store-artifact gate: PASS). Apple validated and processed it (state VALID).

What testers see under "What to Test":
  Tasks 1.4.0 (14) · production build
  What changed
  - feat(lists): sort a list by due date
  - fix(reminders): weekday reminders repeat again
  Please check
  - sort a list by due date, then reopen the app
  - Switch the language to Arabic once: layout mirrored, nothing cut off.
  Known issues
  - none

Your turn: install it from TestFlight and answer "ship" or "don't ship".
Meanwhile I keep working on shared lists on the simulator; nothing else is uploaded.

Human steps (not blocking):
- Read the 4 new Arabic strings in reports/i18n/review-ar.csv when you have time.

Evidence: tag v1.4.0+ios.14; logs in build/ios-release/logs/;
check-store-artifact.mjs . --ipa build/ios-release/export/Tasks.ipa --variant production --version 1.4.0 --build 14: RESULT: PASS.
Not verified by me: the real purchase sheet and haptics (only a device shows them).
```

## 2. A stop (the keychain is locked)

`release:ios` printed this and exited; the agent forwards it as is and does not retry:

```text
Release stopped at step "archive" (human step: unlock the keychain).
Error: error: errSecInternalComponent
Needed: Unlock the login keychain on the Mac (security unlock-keychain ~/Library/Keychains/login.keychain-db in Terminal), or start the run from the logged-in desktop.
I will resume from this step once you confirm.
```

Below it the run printed two lines for the agent, not for the developer: `(log: build/ios-release/logs/archive.log)` and `Resume: rerun the same command with --resume build ...`. Build 14 was already bumped and committed and nothing was uploaded, so after the developer confirms, the agent runs `npm run release:ios -- --variant production --resume build`: it checks that HEAD is still `chore(release): build 14`, reuses 14 and starts again at the prebuild.

## 3. The app record is missing (first upload of a variant)

```text
Before the first TestFlight upload of the preview build, App Store Connect needs an app record
for com.acme.tasks.preview, and the public API cannot create one (about 3 minutes):

App Store Connect > Apps > + > New App:
  Platform: iOS   Name: Tasks Preview   Primary language: English (U.S.)
  Bundle ID: com.acme.tasks.preview   SKU: tasks-preview
Then, in the new app: TestFlight > Internal Testing > +, add a group with automatic
distribution and add yourself, so every build I upload appears in TestFlight on your iPhone.

Reply "done" when both exist. Until then I keep testing on the simulator; nothing is uploaded
and no build number is used.
```

## What is wrong in these bad versions

- "Release failed, retrying..." after `errSecInternalComponent`: a stop is never retried; retries can lock the account.
- "Uploaded! Should be in TestFlight soon." right after `altool --upload-package` or `eas submit`: an upload is not done until processing says VALID.
- A report that pastes the JWT or the `Authorization` header "for debugging": tokens are secrets.
- "I switched to manual signing to get past the error": never change the signing method; follow the playbook row or stop.
- "Store gate: PASS (REHEARSAL)" in a release report: a rehearsal is never release evidence.
- "I used support@example.com until you send the real address": a placeholder never ships; ask instead.
