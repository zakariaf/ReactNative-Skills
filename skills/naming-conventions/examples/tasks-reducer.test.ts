// src/stores/tasks-reducer.test.ts
// Test naming shape: describe('<exported name>') -> describe('when ...') -> it('<third-person verb> ...').
import { DEFAULT_TASKS_STATE, tasksReducer } from './tasks-reducer';

describe('tasksReducer', () => {
  describe('when a filter is set', () => {
    it('stores the new filter', () => {
      const next = tasksReducer(DEFAULT_TASKS_STATE, { type: 'set-filter', filter: 'done' });

      expect(next.filter).toBe('done');
    });

    it('keeps the selected task', () => {
      const selected = tasksReducer(DEFAULT_TASKS_STATE, { type: 'select-task', taskId: 'task-1' });

      expect(tasksReducer(selected, { type: 'set-filter', filter: 'open' }).selectedTaskId).toBe('task-1');
    });
  });

  it('can toggle editing off and on', () => {
    const on = tasksReducer(DEFAULT_TASKS_STATE, { type: 'toggle-editing' });

    expect(tasksReducer(on, { type: 'toggle-editing' })).toStrictEqual(DEFAULT_TASKS_STATE);
  });
});
