import { makeTask } from '@test/make-task';

import { openTasks } from './task-filter';

describe('openTasks', () => {
  it('drops done tasks', () => {
    expect(openTasks([makeTask({ done: true }), makeTask({ done: false })])).toHaveLength(1);
  });
});
