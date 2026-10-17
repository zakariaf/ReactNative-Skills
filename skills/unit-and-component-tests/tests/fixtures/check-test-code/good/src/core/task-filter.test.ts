// src/core/task-filter.test.ts
import fc from 'fast-check';

import { openTaskCount } from './task-filter';

describe('openTaskCount', () => {
  it('counts the tasks that are not done', () => {
    expect(openTaskCount([true, false, false])).toBe(2);
  });

  it('never exceeds the number of tasks', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean()), (flags) => {
        expect(openTaskCount(flags)).toBeLessThanOrEqual(flags.length);
      }),
    );
  });
});
