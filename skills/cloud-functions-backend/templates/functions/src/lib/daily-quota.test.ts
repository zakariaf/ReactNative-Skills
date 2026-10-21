// functions/src/lib/daily-quota.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { quotaDay } from './daily-quota.ts';

describe('quotaDay', () => {
  it('counts against the UTC day and resets at the next UTC midnight', () => {
    assert.deepEqual(quotaDay(new Date('2026-03-31T23:59:59.000Z')), { dayKey: '2026-03-31', resetsAt: '2026-04-01T00:00:00.000Z' });
    assert.deepEqual(quotaDay(new Date('2026-12-31T00:00:00.000Z')), { dayKey: '2026-12-31', resetsAt: '2027-01-01T00:00:00.000Z' });
  });
});
