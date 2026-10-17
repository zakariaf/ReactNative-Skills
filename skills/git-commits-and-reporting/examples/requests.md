# Messages that ask the developer for something

Three filled-in requests, one per kind. Each passes `scripts/check-report.mjs . --report <file> --kind request` when saved on its own (without the headings of this page). One request per message, answerable in a word, with the default that applies until the developer answers.

## A human step (from `templates/reports/request.md`)

```text
Tasks cannot be uploaded to Google Play yet because the app does not exist in Play Console.

Please create the app in Play Console with the application id com.example.tasks (about 5 minutes). Until then I keep working on the shared lists.
```

## A requirement question (from `templates/reports/request.md`)

```text
The requirement does not say whether a task completed after midnight still counts for yesterday's streak.

Please answer A or B. Until then I use option A.
- TASK-60: "A day counts when at least one task due that day is completed."
- Option A (my default): a task counts for the day it was due, whenever it is completed.
- Option B: a task counts for the day it is completed.
```

## A release stop (from `templates/reports/release-stop.md`)

```text
The Android upload of Tasks 1.4.0 stopped at the submit step and I have not retried it.

Error: `403 The caller does not have permission`

Please give the Play service account the release permission for Tasks in Play Console under Users and permissions (about 5 minutes). Until then the build stays unsent and I keep working on the shared lists; I resume from the submit step once you confirm.
```

## What each part does

| Part | Why |
|---|---|
| First sentence | says what is blocked in plain words, so the developer knows why the message matters |
| One "Please ..." line | one action, roughly how long it takes, and the app's own step id when it keeps a list |
| "Until then ..." | the default that applies meanwhile, so no answer never blocks everything |
| Quoted requirement lines and options (questions only) | the developer decides from the requirement's own words, with the default marked |
| The exact error line (release stops only) | the developer or a later session can match it to the failure table without guessing |
