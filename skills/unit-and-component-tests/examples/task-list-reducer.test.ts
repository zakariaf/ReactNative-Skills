// src/stores/task-list-reducer.test.ts — EXAMPLE (a shape to imitate): pure logic gets examples for
// the spec sentences, an invalid-input case, fast-check properties for everything else, and one
// pinned value. playActions (test/play-actions.ts) turns fast-check integers into legal action
// sequences, so the properties explore orders nobody wrote down.
import fc from 'fast-check';

import { playActions } from '@test/play-actions';

import { INITIAL_TASK_LIST, legalActions, reduceTaskList } from './task-list-reducer';

import type { TaskList, TaskListAction } from './task-list-reducer';

const MODEL = { listActions: legalActions, apply: reduceTaskList };
const choicesArb = fc.array(fc.nat(), { maxLength: 40 });

/** Open count, done count and ids agree with the tasks themselves. */
function expectConsistent(list: TaskList): void {
  const open = list.tasks.filter((task) => !task.isDone).length;
  expect(list.openCount).toBe(open);
  expect(new Set(list.tasks.map((task) => task.id)).size).toBe(list.tasks.length);
}

function play(choices: readonly number[]): readonly TaskList[] {
  return playActions<TaskList, TaskListAction>(MODEL, INITIAL_TASK_LIST, choices).states;
}

describe('reduceTaskList', () => {
  it('adds a task at the end with the next id', () => {
    const next = reduceTaskList(INITIAL_TASK_LIST, { type: 'add-task', title: 'Buy milk' });

    expect(next.tasks).toStrictEqual([{ id: 'task-1', title: 'Buy milk', isDone: false }]);
    expect(next.openCount).toBe(1);
  });

  it('completes a task once, however often it is completed', () => {
    const added = reduceTaskList(INITIAL_TASK_LIST, { type: 'add-task', title: 'Buy milk' });
    const done = reduceTaskList(added, { type: 'complete-task', id: 'task-1' });

    expect(reduceTaskList(done, { type: 'complete-task', id: 'task-1' })).toStrictEqual(done);
  });

  describe('when the action names a task that does not exist', () => {
    it('throws a RangeError and names the id', () => {
      expect(() =>
        reduceTaskList(INITIAL_TASK_LIST, { type: 'complete-task', id: 'task-9' }),
      ).toThrow(new RangeError('no task task-9'));
    });
  });

  it('pins the state after a known sequence', () => {
    expect(play([0, 0, 1, 2]).at(-1)).toStrictEqual({
      nextId: 3,
      openCount: 1,
      tasks: [
        { id: 'task-1', title: 'Task 1', isDone: true },
        { id: 'task-2', title: 'Task 2', isDone: false },
      ],
    });
  });

  describe('properties', () => {
    it('replays identically for the same choices', () => {
      fc.assert(
        fc.property(choicesArb, (choices) => {
          expect(play(choices)).toStrictEqual(play(choices));
        }),
      );
    });

    it('keeps the counts consistent after any sequence', () => {
      fc.assert(
        fc.property(choicesArb, (choices) => {
          play(choices).forEach(expectConsistent);
        }),
        { numRuns: 200 },
      );
    });

    it('survives a JSON round trip unchanged (the list is saved as JSON)', () => {
      fc.assert(
        fc.property(choicesArb, (choices) => {
          const last = play(choices).at(-1);
          expect(JSON.parse(JSON.stringify(last)) as unknown).toStrictEqual(last);
        }),
      );
    });
  });
});
