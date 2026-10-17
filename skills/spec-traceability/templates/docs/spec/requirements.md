# Requirements

Each entry is one behaviour that a test can prove. Numbers are exact; a requirement that says "about"
or "fast" is a question for the reviewer, not a target.

## Tasks

### REQ-1 · Add a task

- Status: planned

A task needs a title of 1 to 200 characters after trimming spaces. The Save button stays disabled
while the title is empty.

- Acceptance: a new task appears at the top of the open tasks of the current list.
- Acceptance: a title of 201 characters is refused with the message key `tasks.title.too-long`.

### REQ-2 · Complete a task

- Status: planned

Completing a task moves it to the Done section and shows an Undo action for the time DEC-1 sets.

- Acceptance: Undo puts the task back where it was.

### REQ-3 · Due dates

- Status: planned

A task due today shows "Today"; a task due before today is overdue and shown in the overdue style
with the word "Overdue" in its accessibility label (NN-3).

## Reminders

### REQ-4 · Remind at the due time

- Status: planned
- Platforms: ios, android

A task with a reminder schedules one local notification at its due time. Editing the due date
reschedules it; completing or deleting the task cancels it.

#### REQ-4.1 · Ask for notification permission on first use

- Status: planned
- Platforms: ios, android

The app asks for notification permission the first time a reminder is set, never at launch. On
Android 13 and later this is the `POST_NOTIFICATIONS` runtime permission; on iOS it is the system
notification prompt. If the user declines, the reminder row explains why and opens the system
settings.

## Premium

### REQ-5 · Free lists limit

- Status: planned

Without Premium the app keeps up to 3 lists; adding a fourth opens the Premium offer. Premium removes
the limit.
