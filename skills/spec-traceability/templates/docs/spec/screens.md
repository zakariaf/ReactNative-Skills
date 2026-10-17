# Screens

Every screen the app has, with what it shows, what the user can do there, its states and its route.
Name a screen by its title and ID together, for example "Task list (SCR-1)". A new screen is a
product decision: add its entry here first.

## SCR-1 · Task list

- Status: planned
- Route: `src/app/(app)/index.tsx`

Shows the open tasks of the current list, the due ones first, and a Done section below.

- Actions: add a task (REQ-1), complete a task (REQ-2), open a task in the Task editor (SCR-2).
- States: loading, empty (one sentence and the add button), list, error with a retry.

## SCR-2 · Task editor

- Status: planned
- Route: `src/app/(app)/tasks/[id].tsx`

Edits one task: title, notes, due date and reminder.

- Actions: save, delete with confirmation, set or clear the due date (REQ-3) and the reminder (REQ-4).
- States: new task, existing task, saving, title invalid.

## SCR-3 · Settings

- Status: planned
- Route: `src/app/(app)/settings.tsx`

Theme, language, reminders and the Premium row (REQ-5).

- Actions: change a setting (saved at once), open the system notification settings.
- States: one state; every row reflects the stored value.
