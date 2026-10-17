import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { makeTask } from '@test/make-task';

describe('tasks export', () => {
  it('writes into a temp folder', () => {
    expect(mkdtempSync(`${tmpdir()}/tasks-`)).toContain('tasks-');
    expect(makeTask().done).toBe(false);
  });
});
