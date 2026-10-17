// src/data/migrations/v0002-create-reminders.ts (example: a Tasks app's reminder tables)
// The reminder rows are the source of truth; the OS pending set is rebuilt from them by the sync.
// A recurring time is stored as a wall-clock minute plus a rule, never as a UTC instant; only a
// snooze ("in one hour") stores an instant. persistence-and-migrations owns the migration format.
import type { Migration } from '@/data/migrations/migration-runner';

export const CREATE_REMINDERS: Migration = {
  version: 2,
  name: 'create-reminders',
  up: (driver) => {
    driver.exec(`
CREATE TABLE reminders (
  id            INTEGER PRIMARY KEY,
  task_id       INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL CHECK (kind IN ('at', 'once', 'daily', 'weekly')),
  at_ms         INTEGER,
  day           TEXT    CHECK (day IS NULL OR length(day) = 10),
  minute_of_day INTEGER CHECK (minute_of_day IS NULL OR minute_of_day BETWEEN 0 AND 1439),
  iso_weekdays  TEXT,
  channel_id    TEXT    NOT NULL DEFAULT 'reminders',
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX reminders_by_task ON reminders (task_id);
CREATE TABLE reminder_skip_days (
  reminder_id INTEGER NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  day         TEXT    NOT NULL CHECK (length(day) = 10),
  PRIMARY KEY (reminder_id, day)
) STRICT;
`);
  },
};
