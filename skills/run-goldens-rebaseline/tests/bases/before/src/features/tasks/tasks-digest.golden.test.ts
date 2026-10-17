// src/features/tasks/tasks-digest.golden.test.ts
// DATA GOLDEN (Jest 'golden' project). The [contract] entries never change and are never deleted.
import { goldenText, headerLine } from '@test/goldens/golden-text';

import { digestNotificationId, planDigest } from './tasks-digest';

describe('planDigest goldens', () => {
  it.each(['2026-10-03', '2026-12-31'])('groups the sample list on %s', (todayKey) => {
    const plan = planDigest([], todayKey);
    expect(goldenText(headerLine({ today: todayKey, done: plan.doneCount }), [])).toMatchSnapshot();
  });
});

describe('[contract] digestNotificationId goldens', () => {
  it.each(['2026-10-03', '2026-12-31', '2027-01-01'])('names the digest of the inbox list on %s', (dateKey) => {
    expect(digestNotificationId('inbox', dateKey)).toMatchSnapshot();
  });
});
