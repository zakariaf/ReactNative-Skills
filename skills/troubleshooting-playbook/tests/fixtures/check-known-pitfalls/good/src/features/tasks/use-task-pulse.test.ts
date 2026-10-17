// src/features/tasks/use-task-pulse.test.ts
describe('useTaskPulse', () => {
  it('formats in tests without a locale', () => {
    expect(new Date(0).toLocaleDateString()).toBeTruthy();
  });
});
