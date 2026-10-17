// src/features/tasks/task-list.test.ts
import fc from 'fast-check';

import { countOpen, sortTasks, toggleTask } from './task-list';

import type { Task } from './task-list';

// Plain objects, as the app creates them: fc.record may also build null-prototype objects, which a
// spread turns into plain ones that toStrictEqual then tells apart.
const taskArb: fc.Arbitrary<Task> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 6 }),
    title: fc.string({ maxLength: 12 }),
    isDone: fc.boolean(),
  })
  .map((task) => ({ ...task }));
const tasksArb = fc.array(taskArb, { maxLength: 20 });

describe('sortTasks', () => {
  it('puts open tasks before done tasks', () => {
    const sorted = sortTasks(
      [
        { id: 'task-1', title: 'Answer email', isDone: true },
        { id: 'task-2', title: 'Buy milk', isDone: false },
      ],
      'en',
    );

    expect(sorted.map((task) => task.id)).toStrictEqual(['task-2', 'task-1']);
  });

  it('orders each group by title', () => {
    const sorted = sortTasks(
      [
        { id: 'task-1', title: 'Water the plants', isDone: false },
        { id: 'task-2', title: 'Buy milk', isDone: false },
        { id: 'task-3', title: 'Pay rent', isDone: true },
        { id: 'task-4', title: 'Call the bank', isDone: true },
      ],
      'en',
    );

    expect(sorted.map((task) => task.title)).toStrictEqual([
      'Buy milk',
      'Water the plants',
      'Call the bank',
      'Pay rent',
    ]);
  });

  it('orders titles the way the UI language does, not by code point', () => {
    const sorted = sortTasks(
      [
        { id: 'task-1', title: 'Zebra crossing', isDone: false },
        { id: 'task-2', title: 'Äpfel kaufen', isDone: false },
      ],
      'en',
    );

    expect(sorted.map((task) => task.id)).toStrictEqual(['task-2', 'task-1']);
  });

  it('keeps tasks with equal titles in their order (a stable sort)', () => {
    const sorted = sortTasks(
      [
        { id: 'task-1', title: 'Buy milk', isDone: false },
        { id: 'task-2', title: 'Buy milk', isDone: false },
      ],
      'en',
    );

    expect(sorted.map((task) => task.id)).toStrictEqual(['task-1', 'task-2']);
  });

  it('returns an empty list for an empty list', () => {
    expect(sortTasks([], 'en')).toStrictEqual([]);
  });

  it('leaves the list it is given unchanged', () => {
    const tasks: readonly Task[] = [
      { id: 'task-1', title: 'B', isDone: true },
      { id: 'task-2', title: 'A', isDone: false },
    ];

    sortTasks(tasks, 'en');

    expect(tasks.map((task) => task.id)).toStrictEqual(['task-1', 'task-2']);
  });

  describe('properties', () => {
    it('keeps every task and puts no done task before an open one', () => {
      fc.assert(
        fc.property(tasksArb, (tasks) => {
          const sorted = sortTasks(tasks, 'en');
          expect(sorted).toHaveLength(tasks.length);
          expect(sorted).toStrictEqual(expect.arrayContaining([...tasks]));
          expect(countOpen(sorted.slice(0, countOpen(tasks)))).toBe(countOpen(tasks));
        }),
      );
    });

    it('is idempotent', () => {
      fc.assert(
        fc.property(tasksArb, (tasks) => {
          expect(sortTasks(sortTasks(tasks, 'en'), 'en')).toStrictEqual(sortTasks(tasks, 'en'));
        }),
      );
    });
  });
});

describe('countOpen', () => {
  it('counts only the open tasks', () => {
    expect(
      countOpen([
        { id: 'task-1', title: 'A', isDone: false },
        { id: 'task-2', title: 'B', isDone: true },
        { id: 'task-3', title: 'C', isDone: false },
      ]),
    ).toBe(2);
  });

  it('is 0 for an empty list and for a list of done tasks', () => {
    expect(countOpen([])).toBe(0);
    expect(countOpen([{ id: 'task-1', title: 'A', isDone: true }])).toBe(0);
  });
});

describe('toggleTask', () => {
  it('flips the named task and leaves the others alone', () => {
    const toggled = toggleTask(
      [
        { id: 'task-1', title: 'A', isDone: false },
        { id: 'task-2', title: 'B', isDone: true },
      ],
      'task-2',
    );

    expect(toggled).toStrictEqual([
      { id: 'task-1', title: 'A', isDone: false },
      { id: 'task-2', title: 'B', isDone: false },
    ]);
  });

  it('returns an equal list when no task has the id', () => {
    const tasks: readonly Task[] = [{ id: 'task-1', title: 'A', isDone: false }];

    expect(toggleTask(tasks, 'task-9')).toStrictEqual(tasks);
  });

  it('pins the open count after a known sequence of toggles', () => {
    const start: readonly Task[] = [
      { id: 'task-1', title: 'A', isDone: false },
      { id: 'task-2', title: 'B', isDone: false },
      { id: 'task-3', title: 'C', isDone: true },
    ];
    const end = ['task-1', 'task-3', 'task-1', 'task-2'].reduce(toggleTask, start);

    expect(countOpen(end)).toBe(2);
    expect(end.map((task) => task.isDone)).toStrictEqual([false, true, false]);
  });

  it('restores the list when the same task is toggled twice', () => {
    fc.assert(
      fc.property(tasksArb, fc.string({ maxLength: 6 }), (tasks, id) => {
        expect(toggleTask(toggleTask(tasks, id), id)).toStrictEqual(tasks);
      }),
    );
  });
});
