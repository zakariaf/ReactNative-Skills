# Writing data goldens and contract entries

How to pin a unit's output as readable text, and how to pin output that every installed version must
reproduce.

## Contents

- What deserves a data golden
- Make the snapshot readable
- The template pair, line by line
- What the snapshot file looks like
- Reading a data golden diff
- Writing a contract
- Changing a unit that has a contract
- Formats worth pinning
- Appendix: games

## What deserves a data golden

A data golden pins the exact output of a pure unit for a few realistic inputs, on top of its ordinary
tests. Good subjects:

- a planner or scheduler: which tasks are overdue, today and upcoming; the next five occurrences of a
  recurring reminder; the notifications a sync would schedule;
- a formatter or serializer whose output users or other programs read: a share text, a CSV export, a
  backup file, a deep link;
- a parser or migration: a stored document of format 1 read into today's model;
- a generator's readable rendering (a grid, a list), next to the vectors that pin its fingerprints.

The unit's properties (sorted, complete, idempotent) stay in its `<unit>.test.ts` with examples and
fast-check (unit-and-component-tests); the golden adds "and exactly this, for these inputs", which
catches the change nobody wrote an assertion for.

## Make the snapshot readable

A golden is reviewed by reading its diff, so it should read like what users get:

- **Snapshot one string per case.** Build it with `test/goldens/golden-text.ts`: `headerLine(fields)`
  writes the inputs and the headline numbers (`today 2026-10-03 tasks 5 done 1`), `goldenText(header,
  lines)` joins the header and short lines, `renderGrid(cells, cols, glyphOf)` draws a grid as text
  rows (a week strip, a month heatmap, a board) with one character per cell and the legend in a comment
  where you call it. An object snapshot prints a pretty-format tree; a string prints as lines.
- **One header line, then short lines.** `JSON.stringify` of a small piece is fine; a 300-line dump is
  not. Aim for 60 lines per entry; `check-goldens.mjs` fails entries over 120 (`--max-entry-lines`).
- **Fixed inputs only.** Date keys or instant literals instead of the clock, a seed instead of
  `Math.random()`, an explicit locale for any formatting, ids written in the test. The canonical Jest
  config pins `TZ=UTC`, but not the locale.
- **Titles start with a third-person verb** (`groups the sample list on %s`), like every test title
  (the canonical ESLint `jest/valid-title` rule checks it). A title is part of the snapshot key.
- **No rendering.** A golden imports no `react-native`, no RNTL, no test renderer and no render helper:
  UI is asserted by role and text in component tests.

## The template pair, line by line

`templates/src/features/__FEATURE__/__FEATURE__-digest.ts` is a small pure unit of the Tasks app: the
digest plan (open tasks grouped as overdue, due today or upcoming on one date key) and the identifier
the digest notification is scheduled under. `__FEATURE__-digest.golden.test.ts` pins it:

```ts
// src/features/tasks/tasks-digest.golden.test.ts
import { goldenText, headerLine } from '@test/goldens/golden-text';

import { digestNotificationId, planDigest } from './tasks-digest';

/** What the digest holds on `todayKey`: the inputs and counts, then one line per group. */
function describeDigest(tasks: readonly DigestTask[], todayKey: string): string {
  const plan = planDigest(tasks, todayKey);
  return goldenText(headerLine({ today: todayKey, tasks: tasks.length, done: plan.doneCount }), [
    describeGroup('overdue', plan.overdue),
    describeGroup('today', plan.dueToday),
    describeGroup('upcoming', plan.upcoming),
  ]);
}

describe('planDigest goldens', () => {
  it.each(['2026-10-03', '2026-10-05', '2026-12-31'])('groups the sample list on %s', (todayKey) => {
    expect(describeDigest(TASKS, todayKey)).toMatchSnapshot();
  });
});

describe('[contract] digestNotificationId goldens', () => {
  it.each(['2026-10-03', '2026-12-31', '2027-01-01', '2028-02-29'])(
    'names the digest of the inbox list on %s',
    (dateKey) => {
      expect(digestNotificationId('inbox', dateKey)).toMatchSnapshot();
    },
  );
});
```

- The header comment says what a diff means and the only way to update the file.
- `describeDigest` is the one place that turns output into text; every case calls it.
- The sample list covers each group, an undated task (sorted last) and a done task.
- The dates are chosen: a normal day, a day where a due date becomes overdue, the year end.
- The contract describe pins the notification id for a normal day, the year-boundary pair and a leap
  day: installed versions cancel and replace a scheduled digest by this exact string.

Copy the pattern, not the unit: replace the digest with the unit you pin, keep the shape.

## What the snapshot file looks like

`tasks-digest.golden.test.ts.snap.ios` next to the test (entries sorted by key):

```
exports[`[contract] digestNotificationId goldens names the digest of the inbox list on 2026-12-31 1`] = `"digest:inbox:2026-12-31"`;

exports[`planDigest goldens groups the sample list on 2026-10-03 1`] = `
"today 2026-10-03 tasks 5 done 1
overdue: t1 Renew passport (2026-09-30)
today: t2 Water the plants (2026-10-03)
upcoming: t5 Send the invoice (2026-10-05), t3 Book the dentist (no date)"
`;
```

The key is the describe title, the test title and a counter. Renaming either title makes the old entry
obsolete and the new one missing, which `jest --ci` reports as a failure: a renamed golden test is a
Gate-Change commit too, and a renamed contract test is a contract violation.

## Reading a data golden diff

```
- Snapshot  - 1
+ Received  + 1

  "today 2026-10-03 tasks 5 done 1
  overdue: t1 Renew passport (2026-09-30)
  today: t2 Water the plants (2026-10-03)
- upcoming: t5 Send the invoice (2026-10-05), t3 Book the dentist (no date)
+ upcoming: t3 Book the dentist (no date), t5 Send the invoice (2026-10-05)"
```

Undated tasks moved first. If that is the point of the commit, update the file with `-u` and say so in
the trailer; if not, it is a bug (here, a comparator that no longer puts `null` last). Read every
changed entry, not the count: an entry nobody meant to change is exactly what goldens exist to catch.

## Writing a contract

1. Decide that the output is a promise: will an installed version, another device or a file a user
   kept still read or compare it after the next release? Then it is a contract.
2. Put its cases in `describe('[contract] <unit> goldens', ...)`. Keep them in the unit's golden file
   or a file of their own; the marker is what counts.
3. Pin at least three keys with the edges: a year-end/new-year pair and a leap day for date keys; an
   empty, a full and a non-ASCII or right-to-left value for formats.
4. Register the test in `contracts/goldens.json`. The first time, copy the skill's
   `templates/contracts/goldens.json` and `goldens.schema.json` to `contracts/` and replace the sample
   entry (it names the digest template's test, which your app may not have) with yours; also add
   `contracts/goldens.json` to `quality-gates.json` `gatedPaths`:

   ```json
   { "id": "digest-notification-id", "test": "src/features/tasks/tasks-digest.golden.test.ts",
     "why": "Installed versions cancel and replace the scheduled digest notification by this identifier." }
   ```

5. Create the snapshot (`-u` on that file), read every entry, commit with a trailer that names the
   contract.

`examples/backup-envelope.golden.test.ts` shows a format contract: backup format 1 for an empty list,
two tasks and a right-to-left title, each with a fixed `exportedAt`.

## Changing a unit that has a contract

- A refactor keeps every contract entry identical: run the goldens before committing; a red contract
  entry means the refactor changed behaviour.
- A new behaviour goes next to the old one: `encodeBackupV2` with `"format": 2`, while the reader still
  accepts format 1 (data-export-and-restore); a new id scheme only for notifications scheduled from now
  on, with a migration that reschedules the old ones (local-notifications). Pin the new output in new
  `[contract]` cases; the old entries stay.
- Content picked by date switches from a future date, so past and present days keep their output
  (seeded-determinism-and-golden-vectors' cutovers).
- When none of that is possible, stop and ask the reviewer before touching the entries.

## Formats worth pinning

- A share text or deep link: `tasks://list/inbox?task=t2` for a few ids, including one that needs
  escaping.
- A CSV export header and two rows (the header is a contract for spreadsheets users built on it).
- A recurrence expansion: the next five occurrences of "every weekday at 09:00" from a Friday, across a
  daylight-saving change (dates-streaks-and-statistics owns the rules).
- The notification plan a sync produces for three reminders (local-notifications owns the sync).
- Frozen migration fixtures are pinned by checksum tests in persistence-and-migrations, not by
  snapshots; list their folder in `goldenPaths` so their changes need a trailer here too.

## Appendix: games

In the games plugin, data goldens pin generated levels and the daily level of a date. For Lights Out
(`lights-out`), a golden renders the starting board with `renderGrid(cells, 5, (isLit) => (isLit ? '#' :
'.'))` under a header `seed 7 difficulty 2 moves 5`, for a few seeds across the difficulty range, and a
`[contract] lights-out daily goldens` describe pins at least three dates with the year-boundary pair
through the seeded core (`dailySeed`, seeded-determinism-and-golden-vectors). Level generation and the
daily contract belong to level-generation-and-solvers; this skill's policy and checkers apply as is.
