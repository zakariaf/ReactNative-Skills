import { makeTask } from '@test/make-task';

import { isTaskDone } from './task';

describe('isTaskDone', () => {
  it('reads the done flag', () => {
    expect(isTaskDone(makeTask({ done: true }))).toBe(true);
  });
});
