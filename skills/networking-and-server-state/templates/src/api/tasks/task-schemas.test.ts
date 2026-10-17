// src/api/tasks/task-schemas.test.ts
import * as v from 'valibot';

import { taskListSchema, taskSchema } from './task-schemas';

const TASK = {
  id: 't1',
  title: 'Buy milk',
  isDone: false,
  priority: 'high',
  updatedAt: '2026-10-03T09:30:00.000Z',
};

describe('taskSchema', () => {
  it('drops fields this app version does not know', () => {
    expect(v.parse(taskSchema, { ...TASK, assignee: 'sam' })).toStrictEqual(TASK);
  });

  it('reads an unknown priority as normal instead of failing', () => {
    expect(v.parse(taskSchema, { ...TASK, priority: 'urgent' }).priority).toBe('normal');
  });

  it('rejects a missing field and a malformed instant', () => {
    const withoutTitle = {
      id: TASK.id,
      isDone: TASK.isDone,
      priority: TASK.priority,
      updatedAt: TASK.updatedAt,
    };

    expect([
      v.safeParse(taskSchema, withoutTitle).success,
      v.safeParse(taskSchema, { ...TASK, updatedAt: 'yesterday' }).success,
    ]).toStrictEqual([false, false]);
  });
});

describe('taskListSchema', () => {
  it('unwraps the items of a page', () => {
    expect(v.parse(taskListSchema, { items: [TASK], total: 1 })).toStrictEqual([TASK]);
  });
});
