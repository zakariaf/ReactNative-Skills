// src/features/__FEATURE__/__FEATURE__-digest.golden.test.ts
// DATA GOLDEN (Jest 'golden' project). A diff here means the digest users get changed. Create or
// update it only with `npx jest <this file> --selectProjects golden -u`, read the .snap.ios diff
// line by line, and commit with a `Gate-Change:` trailer. The [contract] entries never change and
// are never deleted (adding a key is fine); never rename their titles, the key is the title.
import { goldenText, headerLine } from '@test/goldens/golden-text';

import { digestNotificationId, planDigest } from './__FEATURE__-digest';

import type { DigestTask } from './__FEATURE__-digest';

/** A realistic list: one overdue, one due on the first sample day, one undated, one done, one later. */
const TASKS: readonly DigestTask[] = [
  { id: 't1', title: 'Renew passport', isDone: false, dueKey: '2026-09-30' },
  { id: 't2', title: 'Water the plants', isDone: false, dueKey: '2026-10-03' },
  { id: 't3', title: 'Book the dentist', isDone: false, dueKey: null },
  { id: 't4', title: 'Pay rent', isDone: true, dueKey: '2026-10-01' },
  { id: 't5', title: 'Send the invoice', isDone: false, dueKey: '2026-10-05' },
];

function describeGroup(label: string, group: readonly DigestTask[]): string {
  const items = group.map((task) => `${task.id} ${task.title} (${task.dueKey ?? 'no date'})`);
  return `${label}: ${items.length === 0 ? '-' : items.join(', ')}`;
}

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
  it.each(['2026-10-03', '2026-10-05', '2026-12-31'])(
    'groups the sample list on %s',
    (todayKey) => {
      expect(describeDigest(TASKS, todayKey)).toMatchSnapshot();
    },
  );

  it('plans an empty list', () => {
    expect(describeDigest([], '2026-10-03')).toMatchSnapshot();
  });
});

describe('[contract] digestNotificationId goldens', () => {
  // At least three keys with a year-end/new-year pair and a leap day: date bugs live at the edges.
  it.each(['2026-10-03', '2026-12-31', '2027-01-01', '2028-02-29'])(
    'names the digest of the inbox list on %s',
    (dateKey) => {
      expect(digestNotificationId('inbox', dateKey)).toMatchSnapshot();
    },
  );
});
